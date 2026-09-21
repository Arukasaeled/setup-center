//! Author-side ledger management: `license_admin`.
//!
//! ```text
//! cargo run --example license_admin -- list
//! cargo run --example license_admin -- list --unused
//! cargo run --example license_admin -- status
//! cargo run --example license_admin -- verify SC-XXXXX-XXXXX-XXXXX-XXXXX
//! cargo run --example license_admin -- mark 137 activated dbe44ff0
//! ```
//!
//! ## Why this exists at all
//!
//! The brief's answer to "how do I manage 500 codes" is a CSV — and it is the
//! right answer. But a CSV alone leaves three questions unanswerable without
//! hand-editing a file that is the only record of who owns what:
//!
//! * *"Which code is row 137?"* — `verify` recomputes the hash and finds the
//!   row, so a code can be identified without putting plaintext in the ledger.
//! * *"How many are left?"* — `status` counts them.
//! * *"Customer X activated on machine Y"* — `mark` fills in the row.
//!
//! ## Why `mark` rewrites the file
//!
//! Every other operation appends. Updating a row's status necessarily rewrites,
//! which is the one destructive operation in this tool, so it goes through a
//! backup: `license_inventory.csv.bak` is written first and the original is only
//! replaced on success. Losing the ledger means losing the ability to tell an
//! issued code from an unissued one, and that is not a thing to risk for
//! tidiness.
//!
//! ## What this deliberately is not
//!
//! No web UI, no database, no cloud sync, no server. It reads and writes one
//! CSV on the author's own machine, and it is never bundled (see `issue.rs` for
//! the three properties that make that structural).

use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;

use ai_student_setup_lib::modules::license::inventory_file as ledger;
use ai_student_setup_lib::modules::license::validator::{self, CodeFormat};
use ai_student_setup_lib::modules::license::Tier;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.is_empty() || matches!(args[0].as_str(), "-h" | "--help") {
        println!("{USAGE}");
        return ExitCode::SUCCESS;
    }

    // `--ledger` may appear anywhere; strip it before dispatching so each
    // subcommand sees only its own arguments.
    let (ledger_path, rest) = match extract_ledger(&args) {
        Ok(pair) => pair,
        Err(message) => {
            eprintln!("error: {message}");
            return ExitCode::from(2);
        }
    };

    let path = ledger_path.unwrap_or_else(ledger::default_path);
    let book = match ledger::open(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::from(1);
        }
    };

    for (line, text) in &book.unreadable {
        eprintln!("warning: line {line} could not be parsed and was ignored: {text}");
    }

    let outcome = match rest.first().map(String::as_str) {
        Some("list") => list(&book, &rest[1..]),
        Some("status") => status(&book),
        Some("verify") => verify(&book, &rest[1..]),
        Some("mark") => mark(&book, &rest[1..]),
        Some(other) => {
            eprintln!("error: unknown command {other:?}\n\n{USAGE}");
            return ExitCode::from(2);
        }
        None => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
    };

    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("error: {message}");
            ExitCode::from(1)
        }
    }
}

/// Lists ledger rows, optionally filtered.
fn list(book: &ledger::Ledger, args: &[String]) -> Result<(), String> {
    let mut only_unused = false;
    let mut only_activated = false;
    for arg in args {
        match arg.as_str() {
            "--unused" => only_unused = true,
            "--activated" => only_activated = true,
            other => return Err(format!("unrecognised option {other:?} for `list`")),
        }
    }

    let rows: Vec<&ledger::Entry> = book
        .entries
        .iter()
        .filter(|e| !only_unused || e.status == ledger::Status::Unused)
        .filter(|e| !only_activated || e.status == ledger::Status::Activated)
        .collect();

    println!(
        "{:<5} {:<8} {:<4} {:<5} {:<20} {:<10} {:<12} {}",
        "id", "tier", "fmt", "state", "created", "activated", "device", "hash (first 12)"
    );
    println!("{}", "-".repeat(110));
    for entry in &rows {
        println!(
            "{:<5} {:<8} {:<4} {:<5} {:<20} {:<10} {:<12} {}",
            entry.id,
            entry.tier.canonical(),
            entry.format.label(),
            entry.status.as_str(),
            shorten(&entry.created_at, 19),
            shorten(&entry.activated_at, 10),
            shorten(&entry.device_hash, 12),
            // Truncated for readability; `verify` does the full comparison. The
            // prefix is enough to spot a duplicate row by eye.
            &entry.code_hash[..entry.code_hash.len().min(12)],
        );
    }
    println!();
    println!(
        "{} row(s) shown, {} in the ledger",
        rows.len(),
        book.entries.len()
    );
    Ok(())
}

/// Counts the ledger.
fn status(book: &ledger::Ledger) -> Result<(), String> {
    let unused = book.count_status(ledger::Status::Unused);
    let activated = book.count_status(ledger::Status::Activated);
    let revoked = book.count_status(ledger::Status::Revoked);
    let v1 = book
        .entries
        .iter()
        .filter(|e| e.format == CodeFormat::V1)
        .count();
    let pro = book.entries.iter().filter(|e| e.tier == Tier::Pro).count();
    let free = book.entries.iter().filter(|e| e.tier == Tier::Free).count();

    println!("ledger    : {}", book.path.display());
    println!("total     : {}", book.entries.len());
    println!("unused    : {unused}  (available to hand out)");
    println!("activated : {activated}");
    println!("revoked   : {revoked}");
    println!("by tier   : {pro} pro, {free} free");
    println!(
        "by format : {} v2, {v1} v1 (pre-tier)",
        book.entries.len() - v1
    );
    println!("next id   : {:03}", book.next_number());
    if unused == 0 && !book.entries.is_empty() {
        println!();
        println!("note: no unused codes remain — run `issue <n> pro` to mint more.");
    }
    Ok(())
}

/// Identifies a code by recomputing its ledger hash.
///
/// The code is never stored, so this is the only way to answer "do I know this
/// code, and if so whose is it". It also re-runs the client's own validation, so
/// a code that would be rejected at activation time is reported as such here
/// rather than after it has been sold.
fn verify(book: &ledger::Ledger, args: &[String]) -> Result<(), String> {
    let code = args.first().ok_or("`verify` needs a code")?;

    // The validated form is kept, not just printed, because the ledger lookup
    // below needs the code's tier to cross-check the row against the signature.
    let validated = match validator::validate_tiered(code) {
        Ok(validated) => {
            println!("code       : {}", validated.code);
            println!("format     : {}", validated.format.label());
            println!("tier       : {}", validated.tier.canonical());
            println!(
                "valid      : yes — this code would activate a PRO/FREE machine as the tier above"
            );
            validated
        }
        Err(rejection) => {
            // A code that fails validation here will fail on the customer's
            // machine, so it must not be reported as merely "unknown".
            println!("code       : (as typed)");
            println!("valid      : NO — {}", rejection.message());
            println!();
            println!(
                "This code will not activate. If it came from an export, that export is corrupt."
            );
            return Ok(());
        }
    };

    let hash = validator::code_fingerprint(code);
    println!("ledger hash: {hash}");
    match book.find_by_hash(&hash) {
        Some(entry) => {
            println!();
            println!("FOUND in ledger");
            println!("  id           : {}", entry.id);
            println!("  issued       : {}", entry.created_at);
            println!("  status       : {}", entry.status.as_str());
            println!("  tier recorded: {}", entry.tier.canonical());
            if entry.status == ledger::Status::Activated {
                println!("  activated at : {}", entry.activated_at);
                println!("  device       : {}", entry.device_hash);
            }
            if entry.note.is_empty() {
                println!("  note         : (none)");
            } else {
                println!("  note         : {}", entry.note);
            }
            if entry.tier != validated.tier {
                // A ledger row disagreeing with the code's own signature means
                // one of them was tampered with. The code wins, because the
                // signature is what the client trusts — but say so.
                println!();
                println!(
                    "  WARNING: the ledger says {} but the code's signature says {}. \
                     The signature is what the client enforces.",
                    entry.tier.canonical(),
                    validated.tier.canonical()
                );
            }
        }
        None => {
            println!();
            println!("NOT FOUND in the ledger.");
            println!(
                "This code is cryptographically valid but was not issued by this ledger — \
                 either it came from a different ledger, or the ledger was replaced."
            );
        }
    }
    Ok(())
}

/// `mark <id> unused|activated|revoked [device_hash] [--note <text>]`
///
/// The only operation that rewrites the ledger, so it backs up first.
fn mark(book: &ledger::Ledger, args: &[String]) -> Result<(), String> {
    let id = args
        .first()
        .ok_or("`mark` needs an id (e.g. `mark 137 activated`)")?;
    let state = args
        .get(1)
        .ok_or("`mark` needs a status: unused, activated or revoked")?;
    let device = args.get(2).filter(|a| !a.starts_with("--")).cloned();

    let new_status = ledger::Status::parse(state).ok_or_else(|| {
        format!("unknown status {state:?}; expected unused, activated or revoked")
    })?;

    let note = extract_note(args)?;

    let mut entries = book.entries.clone();
    let index = entries
        .iter()
        .position(|e| e.id == *id || e.id.trim_start_matches('0') == id.trim_start_matches('0'))
        .ok_or_else(|| format!("no ledger row with id {id}"))?;

    let entry = &mut entries[index];
    entry.status = new_status;
    if let Some(device) = device {
        entry.device_hash = device;
    }
    if let Some(note) = note {
        entry.note = note;
    }
    if new_status == ledger::Status::Activated && entry.activated_at.is_empty() {
        entry.activated_at = ai_student_setup_lib::modules::detect::now_iso8601();
    }
    if new_status != ledger::Status::Activated {
        // Clearing these keeps "unused" and "revoked" rows from carrying stale
        // device data, which would make a revoked code look like it is in use.
        entry.activated_at.clear();
        entry.device_hash.clear();
    }

    // Read the fields to report *before* `entries` is consumed by `rewrite`,
    // which otherwise leaves `entry` borrowed out of a moved value.
    let marked_id = entry.id.clone();
    let marked_device = entry.device_hash.clone();

    rewrite(book, &entries)?;

    println!("marked {} as {}", marked_id, new_status.as_str());
    if !marked_device.is_empty() {
        println!("device : {marked_device}");
    }
    println!("backup : {}.bak", book.path.display());
    Ok(())
}

/// Rewrites the ledger after backing it up.
///
/// Write-to-temp-then-replace would be tidier, but the backup must be readable
/// by a human who has just lost the file, so it keeps the original name with a
/// `.bak` suffix and the bytes are copied *before* the original is touched.
fn rewrite(book: &ledger::Ledger, entries: &[ledger::Entry]) -> Result<(), String> {
    let backup = PathBuf::from(format!("{}.bak", book.path.display()));
    std::fs::copy(&book.path, &backup)
        .map_err(|e| format!("could not back up to {}: {e}", backup.display()))?;

    let mut payload = String::from(
        "id,code_hash,tier,format,created_at,status,activated_at,device_hash,note\r\n",
    );
    for entry in entries {
        payload.push_str(&entry.to_csv());
        payload.push_str("\r\n");
    }

    let mut file =
        std::fs::File::create(&book.path).map_err(|e| format!("{}: {e}", book.path.display()))?;
    file.write_all(payload.as_bytes())
        .map_err(|e| format!("{}: {e}", book.path.display()))?;
    file.flush()
        .map_err(|e| format!("{}: {e}", book.path.display()))?;
    Ok(())
}

/// Pulls `--ledger <path>` out of the argument list.
fn extract_ledger(args: &[String]) -> Result<(Option<PathBuf>, Vec<String>), String> {
    let mut path = None;
    let mut rest = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--ledger" {
            i += 1;
            let Some(value) = args.get(i) else {
                return Err("--ledger needs a file path".into());
            };
            path = Some(PathBuf::from(value));
        } else {
            rest.push(args[i].clone());
        }
        i += 1;
    }
    Ok((path, rest))
}

fn extract_note(args: &[String]) -> Result<Option<String>, String> {
    if let Some(i) = args.iter().position(|a| a == "--note") {
        let note = args.get(i + 1).ok_or("--note needs a value")?;
        return Ok(Some(note.clone()));
    }
    Ok(None)
}

fn shorten(text: &str, max: usize) -> String {
    if text.is_empty() {
        return String::new();
    }
    text.chars().take(max).collect()
}

const USAGE: &str = "\
license_admin — Setup Center issuance ledger (author side, never bundled)

usage:
  license_admin <command> [args] [--ledger <file>]

commands:
  status                       counts: unused / activated / revoked, by tier
  list [--unused|--activated]  show rows
  verify <code>                validate a code AND find its ledger row
  mark <id> <status> [device] [--note <text>]
                               update a row (backs up the ledger first)

examples:
  cargo run --example license_admin -- status
  cargo run --example license_admin -- list --unused
  cargo run --example license_admin -- verify SC-ABCDE-23456-FGHJK-23456
  cargo run --example license_admin -- mark 137 activated dbe44ff0 --note alice

notes:
  The ledger stores HASHES, not codes, so `verify` identifies a code by
  recomputing its hash. `mark` is the only command that rewrites the file and
  it writes <ledger>.bak first.
";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ledger_flag_is_stripped_from_subcommand_arguments() {
        let args: Vec<String> = ["list", "--ledger", "D:\\x.csv", "--unused"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let (path, rest) = extract_ledger(&args).unwrap();
        assert_eq!(path, Some(PathBuf::from("D:\\x.csv")));
        assert_eq!(
            rest,
            vec!["list", "--unused"],
            "the subcommand must not see --ledger"
        );
    }

    #[test]
    fn a_dangling_ledger_flag_is_an_error_not_a_silent_default() {
        let args: Vec<String> = ["list", "--ledger"].iter().map(|s| s.to_string()).collect();
        assert!(extract_ledger(&args).is_err());
    }

    #[test]
    fn the_note_flag_is_found_wherever_it_appears() {
        let args: Vec<String> = ["137", "activated", "--note", "alice"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(extract_note(&args).unwrap().as_deref(), Some("alice"));

        let args: Vec<String> = ["137", "--note", "alice", "activated"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(extract_note(&args).unwrap().as_deref(), Some("alice"));
    }

    #[test]
    fn a_note_flag_without_a_value_is_an_error() {
        let args: Vec<String> = ["137", "--note"].iter().map(|s| s.to_string()).collect();
        assert!(extract_note(&args).is_err());
    }
}
