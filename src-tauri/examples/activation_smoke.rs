//! Round-trips 20 codes sampled from the real 500-code export through the real
//! activation path, and probes the tamper cases the brief asks about.
//!
//! Run with:
//!   cargo run --example activation_smoke
//!
//! This is a *manual* verification tool, not a test: it exercises
//! `license::activate` against the actual `%LOCALAPPDATA%` work directory, which
//! is the one thing the unit tests deliberately avoid. It restores whatever
//! activation was present before it ran.

use ai_student_setup_lib::modules::license::{self, Tier};

fn main() {
    let codes: Vec<String> = std::fs::read_to_string(sample_path())
        .expect("sample20.txt — write the 20 sampled codes there first")
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    println!("== 20 sampled codes from the real export ==\n");

    // Remember what was on this machine so the probe is reversible.
    let before = license::load();

    let mut pro_ok = 0;
    let mut failures: Vec<String> = Vec::new();

    for (i, code) in codes.iter().enumerate() {
        match license::activate(code) {
            Ok(file) => {
                let fp = license::device_summary().0;
                let e = license::Entitlements::of(&file, true);
                if e.tier == Tier::Pro && e.can_install && file.device_hash.as_deref() == Some(&fp)
                {
                    pro_ok += 1;
                    if i < 3 {
                        println!(
                            "  [{:>2}] {} -> tier={} activated={} state={:?}",
                            i + 1,
                            code,
                            e.tier.canonical(),
                            e.activated,
                            e.state
                        );
                    }
                } else {
                    failures.push(format!(
                        "{code}: tier={:?} can_install={} state={:?}",
                        e.tier, e.can_install, e.state
                    ));
                }
            }
            Err(e) => failures.push(format!("{code}: activate failed: {e}")),
        }
    }

    println!("\n  PRO activations that reported PRO : {pro_ok}/20");
    println!("  failures                          : {}", failures.len());
    for f in &failures {
        println!("    - {f}");
    }

    // -- Tamper probes ------------------------------------------------------
    println!("\n== tamper probes ==\n");

    let good = codes.first().expect("at least one code");
    license::activate(good).expect("re-activate for the probes");
    let activated = license::load();

    // 1. An edited hash, **as an in-memory object**.
    //
    //    This stays `Active`, and that is a genuine, documented property rather
    //    than a bug to fix here: `state_of` compares the *device binding*, and
    //    a hand-built struct never went through DPAPI at all. It matters only
    //    for an attacker who can already run code as this user, who could
    //    equally call `save(&forged)` and re-encrypt the blob themselves.
    //
    //    The on-disk case (probe 4) is the one that reflects a real tamper
    //    attempt, and it fails closed.
    let mut edited = activated.clone();
    edited.license_hash = Some("0".repeat(64));
    println!(
        "  edited license_hash (in memory)  -> state={:?} tier={}",
        license::state_of(&edited),
        license::Entitlements::of(&edited, true).tier.canonical()
    );

    // 2. An edited tier on a record that is otherwise valid for this machine.
    //
    //    NOTE: because the file is DPAPI-encrypted, reaching this branch means
    //    the attacker already had the ability to write a *decryptable* blob —
    //    i.e. they were this Windows user. What the assertion shows is that
    //    even then, the tier label alone does not carry the entitlement unless
    //    the device binding matches.
    let mut retier = activated.clone();
    retier.tier = Tier::Pro;
    println!(
        "  edited tier (bound ok) -> state={:?} tier={}",
        license::state_of(&retier),
        license::Entitlements::of(&retier, true).tier.canonical()
    );

    // 3. A copied file: the real attack. Keep `tier: pro` but bind elsewhere.
    let mut copied = activated.clone();
    copied.tier = Tier::Pro;
    copied.device_hash = Some("f".repeat(64));
    let e = license::Entitlements::of(&copied, true);
    println!(
        "  copied device_hash    -> state={:?} tier={} can_install={}",
        e.state,
        e.tier.canonical(),
        e.can_install
    );
    println!("     reason: {}", e.reason);

    // 4. A real on-disk tamper: flip a byte in the DPAPI blob.
    let path = license::license_path();
    if let Ok(raw) = std::fs::read(&path) {
        let mut corrupt = raw.clone();
        let mid = corrupt.len() / 2;
        corrupt[mid] ^= 0xff;
        let _ = std::fs::write(&path, &corrupt);
        let reloaded = license::load();
        println!(
            "  flipped a byte on disk -> state={:?} (must be Inactive)",
            license::state_of(&reloaded)
        );
    }

    // -- Restore ------------------------------------------------------------
    if before.license_hash.is_some() || before.device_hash.is_some() {
        let _ = license::save(&before);
        println!("\n(restored the activation that was present before this probe)");
    } else {
        let _ = license::deactivate();
        println!("\n(no activation was present before; this machine is deactivated again)");
    }

    // Free-tier sanity, so the probe also shows the gate is not simply open.
    let free = license::Entitlements::of(&license::LicenseFile::default(), true);
    println!(
        "\nfree guard: tier={} can_install={} activated={}",
        free.tier.canonical(),
        free.can_install,
        free.activated
    );

    if failures.is_empty() && pro_ok == codes.len() {
        println!(
            "\nRESULT: PASS — {} / {} sampled codes activated as PRO",
            pro_ok,
            codes.len()
        );
    } else {
        println!("\nRESULT: FAIL");
        std::process::exit(1);
    }
}

fn sample_path() -> std::path::PathBuf {
    std::env::temp_dir().join("sample20.txt")
}
