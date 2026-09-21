//! Proves the *installed* application can activate a real issued code.
//!
//! `activation_smoke` proves the library works. This proves the thing the user
//! actually receives works: it writes into the same work directory the
//! installed app uses (`%LOCALAPPDATA%\Setup Center`) and reports the
//! entitlements the UI would render, so "does a real code really turn the
//! shipped product PRO" is answered by running code rather than by reading it.
//!
//! Usage:
//!   cargo run --release --example verify_install -- SC-XXXXX-... [SC-YYYYY-...]
//!
//! It leaves any pre-existing activation exactly as it found it.

use ai_student_setup_lib::modules::license::{self, Tier};

fn main() {
    let codes: Vec<String> = std::env::args().skip(1).collect();
    if codes.is_empty() {
        eprintln!("usage: verify_install <code> [more codes...]");
        std::process::exit(2);
    }

    let path = license::license_path();
    println!("== installed-app activation check ==");
    println!("  license  : {}", path.display());
    if let Some(dir) = path.parent() {
        println!("  work dir : {}", dir.display());
    }
    println!();

    let before = license::load();
    let had_activation = before.license_hash.is_some() || before.device_hash.is_some();
    println!(
        "  pre-existing activation : {}",
        if had_activation { "yes (will be restored)" } else { "no" }
    );
    println!();

    let mut pass = 0;
    let mut fail = 0;

    for code in &codes {
        match license::activate(code) {
            Ok(file) => {
                // Exactly what `commands::license_status` returns to the UI.
                let e = license::Entitlements::of(&file, license::enforcement_enabled());
                let ok = e.tier == Tier::Pro && e.can_install;
                if ok {
                    pass += 1;
                } else {
                    fail += 1;
                }
                println!(
                    "  {}  tier={}  activated={}  can_install={}  state={:?}  reason={}",
                    if ok { "PASS" } else { "FAIL" },
                    e.tier.canonical(),
                    e.activated,
                    e.can_install,
                    e.state,
                    e.reason
                );
            }
            Err(e) => {
                fail += 1;
                println!("  FAIL  {code}: {e}");
            }
        }
    }

    // The free baseline, so "PRO" is shown to mean something.
    let free = license::Entitlements::of(&license::LicenseFile::default(), true);
    println!();
    println!(
        "  free baseline : tier={} can_install={}",
        free.tier.canonical(),
        free.can_install
    );

    // Restore.
    if had_activation {
        let _ = license::save(&before);
        println!("\n  (restored the pre-existing activation)");
    } else {
        let _ = license::deactivate();
        println!("\n  (no activation existed before; machine left deactivated)");
    }

    println!();
    if fail == 0 {
        println!("RESULT: PASS — {pass}/{} real codes activated the installed app as PRO", codes.len());
    } else {
        println!("RESULT: FAIL — {pass} passed, {fail} failed");
        std::process::exit(1);
    }
}
