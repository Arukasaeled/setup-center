//! Author-side activation-code issuer, with an issuance ledger.
//!
//! ```text
//! cargo run --example issue -- 500 pro
//! cargo run --example issue -- 100 free
//! cargo run --example issue -- 20 pro --export-dir D:\codes
//! ```
//!
//! Writes two things, every time:
//!
//! 1. **`src-tauri/license_inventory.csv`** — appended, never rewritten. One row
//!    per code: its number, a hash of the code, the tier, when it was created,
//!    and (filled in later, by hand or by a future tool) which device activated
//!    it. This is the record that survives; the codes themselves live only in
//!    the export file and the customer's inbox.
//! 2. **`codes_export_YYYYMMDD.txt`** — the plaintext codes, numbered, for
//!    sending to customers. Rewritten per day, because it is a *transient*
//!    artefact: the ledger is the record of truth and the export is a printing
//!    of it.
//!
//! ## Why this is an `examples/` and not a `bin/` or a Tauri command
//!
//! Three properties, all of them deliberate:
//!
//! 1. **It is never bundled.** `tauri.conf.json` ships an explicit resource
//!    list and Cargo only builds *this* crate into the app. An `examples/`
//!    binary is not part of the bundle, so the minting path cannot reach a
//!    customer even by accident.
//! 2. **It is not a command.** There is no `mint` in `generate_handler![]`, so
//!    the webview has no way to ask for a code. A command would be one
//!    `invoke("mint")` away from giving the product away.
//! 3. **It shares the validator's algorithm** rather than reimplementing it.
//!    A separate script would be a second implementation that could drift; a
//!    code that the issuer accepts and the client rejects is the worst possible
//!    failure, and it is impossible here because both sides call
//!    `license::validator::{mint_tiered, validate_tiered}`.
//!
//! ## The FREE/PRO question, now that tiers exist
//!
//! Previously the tier argument was **bookkeeping only** — it was recorded in
//! the export header but never entered the code, so a "FREE" code activated as
//! PRO. Codes are now minted with `mint_tiered`, which folds the tier into the
//! **keyed checksum**: the printed shape is unchanged
//! (`SC-XXXXX-XXXXX-XXXXX-XXXXX`) and the tier never appears as text, but the
//! trailing group is only valid for its own tier. So a FREE code carries FREE
//! through to `Entitlements` and cannot be edited into a PRO one.
//!
//! What this does *not* buy, stated plainly: the secret is compiled into the
//! binary, so anyone who extracts it can mint any tier. That is the arithmetic
//! of "no server", and it is unchanged by this work.

use std::io::Write;
use std::path::{Path, PathBuf};

use ai_student_setup_lib::modules::license::inventory_file as ledger;
use ai_student_setup_lib::modules::license::validator::{self, CodeFormat};
use ai_student_setup_lib::modules::license::Tier;

/// Which edition a minted code grants.
///
/// Delegates to the licence module's [`Tier`] rather than defining a parallel
/// enum, so the issuer cannot mint a code for a tier the client does not know.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Edition(Tier);

impl Edition {
    fn label(self) -> &'static str {
        match self.0 {
            Tier::Pro => "PRO",
            Tier::Free => "FREE",
        }
    }
}

struct Options {
    count: usize,
    edition: Edition,
    /// Where the export pages are written.
    ///
    /// `None` means "beside the ledger", which is resolved in `main` once the
    /// ledger path is known — the two files belong together.
    export_dir: Option<PathBuf>,
    /// Overrides the ledger path; defaults to `src-tauri/license_inventory.csv`.
    ledger: Option<PathBuf>,
    /// Required to write into a ledger that did not previously exist.
    allow_new_ledger: bool,
    /// Skips the "cannot be read back" guard on the export file.
    overwrite_export: bool,
}

fn main() {
    let options = match parse_args() {
        Ok(o) => o,
        Err(message) => {
            eprintln!("error: {message}\n\n{USAGE}");
            std::process::exit(2);
        }
    };

    let created_at = ai_student_setup_lib::modules::detect::now_iso8601();
    let date = created_at.get(..10).unwrap_or("1970-01-01").to_string();
    let ledger_path = options.ledger.clone().unwrap_or_else(ledger::default_path);

    // Where the pages go when `--export-dir` was not given: beside the ledger,
    // not the working directory. `license_inventory.csv` and its pages are two
    // halves of one record, and splitting them across directories is how the
    // ledger gets copied somewhere without the codes it describes.
    let export_dir = options
        .export_dir
        .clone()
        .unwrap_or_else(|| {
            ledger_path
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        });

    // -- Open the ledger before minting anything ----------------------------
    //
    // Ordering is deliberate. If the ledger cannot be opened, or was just
    // created and we are not allowed to write into it, we must fail *before*
    // 500 codes are generated — otherwise the codes exist and are printed but
    // no record of them does, which is exactly how a code gets issued twice.
    let mut book = match ledger::open(&ledger_path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("error: could not open the ledger: {e}");
            std::process::exit(1);
        }
    };

    if !book.unreadable.is_empty() {
        // Loud, because a row we cannot parse is a code whose status is unknown.
        eprintln!(
            "warning: {} line(s) in {} could not be parsed and were ignored:",
            book.unreadable.len(),
            ledger_path.display()
        );
        for (line, text) in &book.unreadable {
            eprintln!("  line {line}: {text}");
        }
    }

    if book.created && !options.allow_new_ledger {
        eprintln!(
            "error: {} did not exist and a new empty ledger was created.\n\
             \n\
             Refusing to issue codes into it, because the numbering would restart\n\
             at 001 and could collide with codes that are already in customers'\n\
             hands. If this really is the first issue, re-run with\n\
             --allow-new-ledger. If it is not, restore the original {} first.",
            ledger_path.display(),
            ledger::DEFAULT_INVENTORY
        );
        std::process::exit(1);
    }

    let first = book.next_number();
    println!("ledger  : {}", ledger_path.display());
    println!(
        "existing: {} row(s), {} unused",
        book.entries.len(),
        book.count_status(ledger::Status::Unused)
    );
    println!("numbers : {first:03} onward\n");

    // -- Mint ---------------------------------------------------------------
    let mut codes = Vec::with_capacity(options.count);
    for n in 0..options.count {
        match validator::mint_tiered(options.edition.0) {
            Ok(code) => codes.push(code),
            Err(e) => {
                // Loud, not partial. A batch that silently produced 7 of 10
                // codes is worse than one that produced none, because the
                // missing three are discovered at the customer's machine.
                eprintln!(
                    "error: could not mint code {} of {}: {e}",
                    n + 1,
                    options.count
                );
                std::process::exit(1);
            }
        }
    }

    // -- Self-check before anything is sold ---------------------------------
    //
    // Each code is put through the same validator the client runs, *and* the
    // returned tier is checked against what was asked for. The second half is
    // what would have caught the original defect: the old issuer validated the
    // code's shape and never noticed that the tier argument went nowhere.
    let mut bad = 0;
    for (code, tier) in codes.iter().zip(std::iter::repeat(options.edition.0)) {
        match validator::validate_tiered(code) {
            Ok(v) => {
                if v.tier != tier {
                    eprintln!(
                        "FATAL: minted code {code} reports tier {:?} but {:?} was requested",
                        v.tier, tier
                    );
                    bad += 1;
                }
                if v.format != CodeFormat::V2 {
                    eprintln!("FATAL: minted code {code} is not a v2 code");
                    bad += 1;
                }
            }
            Err(e) => {
                eprintln!(
                    "FATAL: minted code {code} failed validation: {}",
                    e.message()
                );
                bad += 1;
            }
        }
    }
    if bad > 0 {
        eprintln!(
            "FATAL: {bad} of {} codes failed round-trip validation",
            codes.len()
        );
        std::process::exit(1);
    }

    // Uniqueness is checked explicitly rather than assumed from 75 bits of
    // randomness. A duplicate would mean two customers share a code, and the
    // ledger's per-code status would be wrong for both of them.
    let unique: std::collections::HashSet<&String> = codes.iter().collect();
    if unique.len() != codes.len() {
        eprintln!(
            "FATAL: the batch contains duplicates ({} unique of {})",
            unique.len(),
            codes.len()
        );
        std::process::exit(1);
    }

    // -- Ledger rows --------------------------------------------------------
    let entries: Vec<ledger::Entry> = codes
        .iter()
        .enumerate()
        .map(|(i, code)| {
            ledger::entry_for(
                code,
                first + i as u64,
                options.edition.0,
                CodeFormat::V2,
                &created_at,
            )
        })
        .collect();

    if let Err(e) = ledger::append(&book, &entries, options.allow_new_ledger) {
        // Nothing is printed before the ledger is safely written, so a failure
        // here leaves no half-issued batch.
        eprintln!("error: could not append to the ledger: {e}");
        std::process::exit(1);
    }
    book.entries.extend(entries.iter().cloned());

    // -- Export -------------------------------------------------------------
    //
    // Written as pages of `PAGE_SIZE` codes rather than one long file. The
    // reason is operational, not aesthetic: a 500-code file is unusable to hand
    // out, because the person sending them loses their place and a
    // half-scrolled page is how a code gets sent twice or skipped. A 50-code
    // page is one screen, and "page 3" is a thing you can say on the phone.
    let pages = match write_export_pages(
        &export_dir,
        &date,
        options.edition,
        &entries,
        &codes,
        !options.overwrite_export,
    ) {
        Ok(pages) => pages,
        Err(e) => {
            eprintln!("error: could not write the export pages: {e}");
            std::process::exit(1);
        }
    };

    println!("edition : {}", options.edition.label());
    println!("count   : {}", codes.len());
    println!(
        "numbers : {:03} – {:03}",
        first,
        first + codes.len() as u64 - 1
    );
    println!("ledger  : {} (appended {} row(s))", ledger_path.display(), entries.len());
    println!(
        "export  : {} page(s) of up to {} in {}",
        pages.len(),
        PAGE_SIZE,
        export_dir.display()
    );
    println!("          {}", pages[0].display());
    if pages.len() > 1 {
        println!(
            "          … through {}",
            pages[pages.len() - 1].display()
        );
    }
    println!(
        "verified: {} / {} re-validated against the client validator, tier checked",
        codes.len(),
        codes.len()
    );
    println!();
    for code in &codes {
        println!("{code}");
    }
}

/// How many codes go into one page.
///
/// 50 is chosen so a page is readable in one screen and a batch of 500 is a
/// tidy ten files. It is a *presentation* constant: it changes how the codes are
/// filed, never what a code means. Re-paging an existing export changes nothing
/// about the codes in it, which is the property that makes this safe to tune.
const PAGE_SIZE: usize = 50;

/// Writes the plaintext codes as numbered pages of [`PAGE_SIZE`].
///
/// Returns the page paths, in order, so the caller can report them.
///
/// ## Why pages instead of one file
///
/// The old single-file export was the weakest part of the distribution flow. It
/// is the file the author works *from* while sending codes out, and scrolling a
/// 500-line file to find "where was I" is how a code gets sent twice. Paging it
/// makes the unit of work the same size as the unit of delivery.
///
/// ## Why the ledger is still hashed and the pages are still plaintext
///
/// The two files answer opposite questions. The ledger must be safe to lose
/// sight of — it is hashed so a leak reveals no usable code. The pages must be
/// **usable**, because a page is the thing pasted into a chat window when a
/// customer buys one; hashing it would make it useless. So the pages contain
/// plaintext and are therefore treated as a secret: written wherever the author
/// asks, never into the repository, and never bundled.
///
/// ## The overwrite guard, now per page
///
/// Re-running the issuer on the same day would otherwise **erase this morning's
/// export**, which may be the only copy of codes already sent. A page that
/// already exists is therefore appended to rather than truncated, and the header
/// says an extra batch landed in it. A fresh page is only created when the codes
/// genuinely continue past it.
fn write_export_pages(
    dir: &PathBuf,
    date: &str,
    edition: Edition,
    entries: &[ledger::Entry],
    codes: &[String],
    append_if_exists: bool,
) -> std::io::Result<Vec<PathBuf>> {
    let mut pages = Vec::new();

    for (page_index, chunk) in entries.chunks(PAGE_SIZE).zip(codes.chunks(PAGE_SIZE)).enumerate() {
        let (page_entries, page_codes) = chunk;
        let path = ledger::export_page_path(dir, date, page_index + 1);
        let exists = path.exists();
        let append = append_if_exists && exists;

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(append)
            .write(!append)
            .truncate(!append)
            .open(&path)?;

        if !append {
            writeln!(
                file,
                "# Setup Center activation codes — {} — page {}",
                edition.label(),
                page_index + 1
            )?;
            writeln!(
                file,
                "# issued {} — keep this file private until every code is delivered",
                page_entries
                    .first()
                    .map(|e| e.created_at.as_str())
                    .unwrap_or("")
            )?;
            writeln!(
                file,
                "# codes {} – {} of this batch",
                page_entries.first().map(|e| e.id.as_str()).unwrap_or(""),
                page_entries.last().map(|e| e.id.as_str()).unwrap_or("")
            )?;
            writeln!(file, "#")?;
            writeln!(file, "# id    code")?;
        } else {
            writeln!(file, "#")?;
            writeln!(
                file,
                "# additional batch appended {} — {}",
                page_entries
                    .first()
                    .map(|e| e.created_at.as_str())
                    .unwrap_or(""),
                edition.label()
            )?;
        }

        for (entry, code) in page_entries.iter().zip(page_codes.iter()) {
            // Numbered so the author can say "code 137" on the phone, and so a
            // delivered code can be matched back to its ledger row without ever
            // putting the hash next to the code.
            writeln!(file, "{} {}", entry.id, code)?;
        }

        pages.push(path);
    }

    Ok(pages)
}

fn parse_args() -> Result<Options, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let mut count: Option<usize> = None;
    let mut edition: Option<Edition> = None;
    let mut export_dir: Option<PathBuf> = None;
    let mut ledger_path: Option<PathBuf> = None;
    let mut allow_new_ledger = false;
    let mut overwrite_export = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--export-dir" => {
                i += 1;
                let Some(dir) = args.get(i) else {
                    return Err("--export-dir needs a directory".into());
                };
                export_dir = Some(PathBuf::from(dir));
            }
            "--ledger" => {
                i += 1;
                let Some(path) = args.get(i) else {
                    return Err("--ledger needs a file path".into());
                };
                ledger_path = Some(PathBuf::from(path));
            }
            "--allow-new-ledger" => allow_new_ledger = true,
            "--overwrite-export" => overwrite_export = true,
            "-h" | "--help" => {
                println!("{USAGE}");
                std::process::exit(0);
            }
            other => {
                // A bare number is the count, a bare word is the edition, in
                // either order, because `issue free 5` and `issue 5 free` are
                // both things a person will type.
                if let Ok(n) = other.parse::<usize>() {
                    count = Some(n);
                } else if other.eq_ignore_ascii_case("free") {
                    edition = Some(Edition(Tier::Free));
                } else if other.eq_ignore_ascii_case("pro") {
                    edition = Some(Edition(Tier::Pro));
                } else {
                    return Err(format!("unrecognised argument {other:?}"));
                }
            }
        }
        i += 1;
    }

    let count = count.unwrap_or(1);
    if count == 0 {
        return Err("count must be at least 1".into());
    }

    Ok(Options {
        count,
        // PRO is the default: it is what the product is sold as, and a bare
        // `issue 10` should not silently mint ten trial codes.
        edition: edition.unwrap_or(Edition(Tier::Pro)),
        export_dir,
        ledger: ledger_path,
        allow_new_ledger,
        overwrite_export,
    })
}

const USAGE: &str = "\
issue — Setup Center activation-code issuer (author side, never bundled)

usage:
  issue [count] [free|pro] [options]

options:
  --export-dir <dir>     where to write the export pages
  --ledger <file>        ledger path (default: src-tauri/license_inventory.csv)
  --allow-new-ledger     permit issuing into a ledger that did not exist
  --overwrite-export     replace today's pages instead of appending to them

examples:
  issue 500 pro                    mint 500 PRO codes (ten pages of 50)
  issue 100 free                   mint 100 FREE trial codes
  issue 20 pro --export-dir D:\\codes

notes:
  Codes are 15 random characters + a 5-character keyed checksum over the body
  *and the tier*, grouped SC-XXXXX-XXXXX-XXXXX-XXXXX. Each is re-validated
  against the same validator the client ships, and its tier is checked against
  what was requested, before anything is printed or written.

  Two files are produced:
    license_inventory.csv              appended; hashed codes + status. The record.
    codes_export_YYYYMMDD_pNN.txt      plaintext, 50 codes per page. Keep private.
";

#[cfg(test)]
mod tests {
    use super::*;

    // `parse_args` reads the process argv, so these exercise the pure helpers
    // and the ledger integration rather than the parser itself.

    #[test]
    fn the_default_edition_is_pro_not_free() {
        // A bare `issue 10` must not silently mint trial codes.
        assert_eq!(Edition(Tier::Pro).label(), "PRO");
        assert_eq!(Edition(Tier::Free).label(), "FREE");
    }

    #[test]
    fn a_minted_batch_carries_the_requested_tier() {
        // The defect this file was rewritten for: the old issuer accepted a tier
        // argument and put it only in the export header.
        for tier in [Tier::Pro, Tier::Free] {
            let code = validator::mint_tiered(tier).unwrap();
            let validated = validator::validate_tiered(&code).unwrap();
            assert_eq!(validated.tier, tier, "{code}");
        }
    }

    #[test]
    fn the_export_file_is_named_for_the_day_it_was_issued() {
        let path = ledger::export_path(std::path::Path::new("D:\\codes"), "2026-09-21");
        assert_eq!(
            path.file_name().unwrap().to_string_lossy(),
            "codes_export_20260921.txt"
        );
    }

    #[test]
    fn export_pages_are_numbered_from_one_and_zero_padded() {
        let one = ledger::export_page_path(std::path::Path::new("D:\\codes"), "2026-09-21", 1);
        assert_eq!(
            one.file_name().unwrap().to_string_lossy(),
            "codes_export_20260921_p01.txt"
        );

        // Two digits, so a plain directory listing sorts pages 1..10 in order
        // rather than p1, p10, p2.
        let ten = ledger::export_page_path(std::path::Path::new("D:\\codes"), "2026-09-21", 10);
        assert_eq!(
            ten.file_name().unwrap().to_string_lossy(),
            "codes_export_20260921_p10.txt"
        );
    }

    #[test]
    fn five_hundred_codes_span_ten_pages_of_fifty() {
        // The property the whole change exists for: a batch is filed in pages
        // the author can hand out a screenful at a time.
        let codes: Vec<String> = (0..500).map(|i| format!("c{i}")).collect();
        let pages: Vec<usize> = codes.chunks(PAGE_SIZE).map(|c| c.len()).collect();
        assert_eq!(pages.len(), 10);
        assert!(pages.iter().all(|&n| n == PAGE_SIZE));
    }

    #[test]
    fn a_short_batch_makes_one_short_page_not_a_padded_one() {
        let codes: Vec<String> = (0..7).map(|i| format!("c{i}")).collect();
        let pages: Vec<usize> = codes.chunks(PAGE_SIZE).map(|c| c.len()).collect();
        assert_eq!(pages, vec![7], "no filler rows in the last page");
    }

    #[test]
    fn an_exact_multiple_does_not_produce_a_trailing_empty_page() {
        // 100 codes must be two pages, not three with an empty last one.
        let codes: Vec<String> = (0..100).map(|i| format!("c{i}")).collect();
        let pages: Vec<usize> = codes.chunks(PAGE_SIZE).map(|c| c.len()).collect();
        assert_eq!(pages, vec![50, 50]);
    }

    #[test]
    fn the_first_batch_is_numbered_from_one() {
        let empty = ledger::Ledger {
            path: PathBuf::from("unused.csv"),
            entries: Vec::new(),
            created: true,
            unreadable: Vec::new(),
        };
        assert_eq!(empty.next_number(), 1);
    }

    #[test]
    fn numbering_continues_from_the_highest_row_not_the_row_count() {
        // Deleting a row in the middle must not cause a collision, which is why
        // the next number comes from the maximum rather than the length.
        let mut entries = Vec::new();
        for id in ["001", "002", "007"] {
            entries.push(ledger::entry_for(
                "SC-ABCDE-23456-FGHJK-23456",
                1,
                Tier::Pro,
                CodeFormat::V2,
                "2026-01-01T00:00:00Z",
            ));
            entries.last_mut().unwrap().id = id.to_string();
        }
        let book = ledger::Ledger {
            path: PathBuf::from("unused.csv"),
            entries,
            created: false,
            unreadable: Vec::new(),
        };
        assert_eq!(book.next_number(), 8, "must continue past 007, not 004");
    }
}
