//! Author-side activation-code issuer.
//!
//! Run with:
//!   cargo run --example issue                    # one PRO code
//!   cargo run --example issue -- 10              # ten codes
//!   cargo run --example issue -- 5 free          # five FREE codes
//!   cargo run --example issue -- --export codes.txt 20
//!
//! ## Why this is an `example/` and not a `bin/` or a Tauri command
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
//!    `license::validator::{mint, validate}`.
//!
//! ## The FREE/PRO question, stated honestly
//!
//! The argument is accepted and recorded in the output header, but it does not
//! change the code's bytes. That is not an oversight — see the long note in
//! `modules/license/mod.rs`: a code is *authentication*, not *authorisation*.
//! The body is `<HMAC(secret, body)>` over 15 random characters, so every code
//! is cryptographically independent of every other and none of them carries a
//! tier. Adding a tier would mean giving the code a parseable meaning, and there
//! is then only one shared secret between a FREE code and a PRO one — anyone
//! who extracted the secret could mint PRO codes regardless of what the tier
//! field said.
//!
//! So the tier lives in the **issuer's bookkeeping** (which code was sold to
//! whom), and possession of a valid code is what unlocks PRO. `free` here
//! therefore means "a code to hand out for trials" without pretending the code
//! itself is weaker — if you need a genuinely limited artefact, that is a
//! time-limited or device-count feature, which this MVP deliberately does not
//! have (the brief says not to build a complex anti-piracy system).

use std::io::Write;
use std::path::PathBuf;

use ai_student_setup_lib::modules::license::validator;

/// Which edition a minted code is intended for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Edition {
    Free,
    Pro,
}

impl Edition {
    fn label(self) -> &'static str {
        match self {
            Edition::Free => "FREE",
            Edition::Pro => "PRO",
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let mut count: usize = 1;
    let mut edition = Edition::Pro;
    let mut export: Option<PathBuf> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--export" => {
                i += 1;
                let Some(path) = args.get(i) else {
                    eprintln!("error: --export needs a file path");
                    std::process::exit(2);
                };
                export = Some(PathBuf::from(path));
            }
            "-h" | "--help" => {
                println!("{USAGE}");
                return;
            }
            other => {
                // A bare number is the count, a bare word is the edition, in
                // either order, because `issue free 5` and `issue 5 free` are
                // both things a person will type.
                if let Ok(n) = other.parse::<usize>() {
                    count = n;
                } else if other.eq_ignore_ascii_case("free") {
                    edition = Edition::Free;
                } else if other.eq_ignore_ascii_case("pro") {
                    edition = Edition::Pro;
                } else {
                    eprintln!("error: unrecognised argument {other:?}\n\n{USAGE}");
                    std::process::exit(2);
                }
            }
        }
        i += 1;
    }

    if count == 0 {
        eprintln!("error: count must be at least 1");
        std::process::exit(2);
    }

    let mut codes = Vec::with_capacity(count);
    for n in 0..count {
        match validator::mint() {
            Ok(code) => codes.push(code),
            Err(e) => {
                // Loud, not partial. A batch that silently produced 7 of 10
                // codes is worse than one that produced none, because the
                // missing three are discovered at the customer's machine.
                eprintln!("error: could not mint code {} of {}: {e}", n + 1, count);
                std::process::exit(1);
            }
        }
    }

    // Self-check before anything is sold. Each code is put through the same
    // validator the client runs, so an issuer bug is caught here rather than by
    // a customer who paid.
    let mut bad = 0;
    for code in &codes {
        if let Err(e) = validator::validate(code) {
            eprintln!("FATAL: minted code {code} failed validation: {}", e.message());
            bad += 1;
        }
    }
    if bad > 0 {
        eprintln!("FATAL: {bad} of {} codes failed round-trip validation", codes.len());
        std::process::exit(1);
    }

    println!("edition : {}", edition.label());
    println!("count   : {}", codes.len());
    println!("verified: {} / {} re-validated against the client validator", codes.len(), codes.len());
    println!();
    for code in &codes {
        println!("{code}");
    }

    if let Some(path) = export {
        match write_export(&path, edition, &codes) {
            Ok(()) => println!("\nexported {} codes to {}", codes.len(), path.display()),
            Err(e) => {
                eprintln!("\nerror: could not write {}: {e}", path.display());
                std::process::exit(1);
            }
        }
    }
}

/// Writes the code library, appending rather than replacing.
///
/// Append is the safe default for a ledger: re-running the issuer to add ten
/// more codes must not erase the ten already sold. The edition is stamped per
/// batch so the bookkeeping records what each code was intended for, which is
/// where the FREE/PRO distinction actually lives.
fn write_export(path: &PathBuf, edition: Edition, codes: &[String]) -> std::io::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;

    let stamp = ai_student_setup_lib::modules::detect::now_iso8601();
    for code in codes {
        writeln!(file, "{stamp}\t{}\t{code}", edition.label())?;
    }
    Ok(())
}

const USAGE: &str = "\
issue — Setup Center activation-code issuer (author side, never bundled)

usage:
  issue [count] [free|pro] [--export <file>]

examples:
  issue                          mint 1 PRO code
  issue 10                       mint 10 PRO codes
  issue 5 free                   mint 5 FREE codes
  issue 20 --export codes.txt    mint 20 PRO codes and append to codes.txt

notes:
  Codes are 15 random characters + a 5-character keyed checksum, grouped
  SC-XXXXX-XXXXX-XXXXX-XXXXX. They are verified against the same validator the
  client ships before being printed, so a code that cannot activate never
  reaches a customer.
";
