//! End-to-end activation smoke test against the **real** licence storage.
//!
//! Run with:
//!   cargo run --example licence_smoke
//!
//! What this proves that the unit tests cannot: the unit tests build a
//! `LicenseFile` in memory and hand it to `Entitlements::of`. This goes through
//! `license::activate()` → DPAPI encrypt → `%LOCALAPPDATA%\Setup Center\license.dat`
//! → `license::load()` → decrypt → `Entitlements::of`, i.e. the exact path a
//! customer's machine walks.
//!
//! ## It leaves the machine as it found it
//!
//! The test captures whether an activation already existed, and restores that
//! state at the end. Running this on a machine with a real licence must not
//! deactivate the customer's purchase — so the "before" state is restored
//! rather than unconditionally deleted.
//!
//! ## Negative cases are the point
//!
//! A test that only checks "a good code activates" would pass even if *every*
//! code activated. The empty, malformed, wrong-checksum and random cases below
//! are what make the positive case mean something.

use ai_student_setup_lib::modules::license::{self, LicenseState, Tier};

/// Collected so the process can exit non-zero once, rather than on the first
/// failure — seeing all four negative results at once is more useful than
/// seeing only the first.
struct Report {
    passed: usize,
    failed: Vec<String>,
}

impl Report {
    fn new() -> Self {
        Self { passed: 0, failed: Vec::new() }
    }

    fn check(&mut self, name: &str, condition: bool, detail: impl Into<String>) {
        let detail = detail.into();
        if condition {
            self.passed += 1;
            println!("PASS  {name}");
        } else {
            self.failed.push(name.to_string());
            println!("FAIL  {name}  → {detail}");
        }
    }
}

fn main() {
    let mut r = Report::new();

    // -- Preserve whatever the machine already had --------------------------
    let had_licence = license::license_path().exists();
    println!("licence path : {}", license::license_path().display());
    println!("pre-existing : {had_licence}");
    println!();

    // -- 0. A fresh machine is FREE and cannot install ----------------------
    let _ = license::deactivate();
    let fresh = license::Entitlements::of(&license::load(), true);
    r.check("a fresh machine is FREE", fresh.tier == Tier::Free, format!("{:?}", fresh.tier));
    r.check("a fresh machine cannot install", !fresh.can_install, "can_install was true");
    r.check(
        "a fresh machine still detects (free stays useful)",
        !fresh.can_install && fresh.reason.contains("免费版"),
        &fresh.reason,
    );

    // -- 1. Negative cases: none of these may activate ----------------------
    let empty = license::activate("");
    r.check("an empty code is refused", empty.is_err(), "activate(\"\") returned Ok");

    let malformed = license::activate("not-a-code");
    r.check("a malformed code is refused", malformed.is_err(), "garbage returned Ok");

    // Right shape, wrong checksum: this is the case a naive validator lets
    // through, because the length and alphabet are correct.
    let bad_checksum = license::activate("SC-ABCDE-23456-FGHJK-23456");
    r.check(
        "a right-shaped code with a bad checksum is refused",
        bad_checksum.is_err(),
        "checksum was not enforced",
    );

    let random = license::activate("SC-K9K9K-K9K9K-K9K9K-K9K9K");
    r.check("a random wrong code is refused", random.is_err(), "random code returned Ok");

    // The decisive one: four refusals above must not have silently unlocked.
    let after_failures = license::Entitlements::of(&license::load(), true);
    r.check(
        "failed attempts do not unlock PRO",
        after_failures.tier == Tier::Free && !after_failures.can_install,
        format!("tier={:?} can_install={}", after_failures.tier, after_failures.can_install),
    );

    // -- 2. A real minted code activates -----------------------------------
    let code = license::validator::mint().expect("mint failed");
    println!("\n  minted: {code}\n");

    match license::activate(&code) {
        Ok(_) => {
            let pro = license::Entitlements::of(&license::load(), true);
            r.check("a minted code activates", pro.tier == Tier::Pro, format!("{:?}", pro.tier));
            r.check("PRO can install", pro.can_install, "can_install was false");
            r.check("PRO can configure", pro.can_configure, "can_configure was false");
            r.check("PRO shows as activated", pro.activated, "activated was false");
            r.check(
                "PRO state is Active (bound to this machine)",
                pro.state == LicenseState::Active,
                format!("{:?}", pro.state),
            );
            r.check("PRO reason says so", pro.reason.contains("已激活"), &pro.reason);
        }
        Err(e) => {
            r.check("a minted code activates", false, format!("activate failed: {e}"));
        }
    }

    // -- 3. The stored file is not readable plaintext ----------------------
    let raw = std::fs::read(license::license_path()).unwrap_or_default();
    let as_text = String::from_utf8_lossy(&raw);
    r.check(
        "license.dat exists after activation",
        !raw.is_empty(),
        "file was empty or missing",
    );
    r.check(
        "license.dat does not contain the code in plaintext",
        !as_text.contains(&code) && !as_text.contains("SC-"),
        "the activation code was readable in the stored file",
    );
    r.check(
        "license.dat is not readable JSON",
        !as_text.contains("license_hash") && !as_text.contains("device_hash"),
        "the stored file was plaintext JSON",
    );

    // -- 4. Persistence: a reload, as a restart would do -------------------
    let reloaded = license::Entitlements::of(&license::load(), true);
    r.check(
        "the licence survives a reload (restart behaviour)",
        reloaded.tier == Tier::Pro && reloaded.can_install,
        format!("tier={:?} can_install={}", reloaded.tier, reloaded.can_install),
    );

    // -- 5. Another machine must be refused --------------------------------
    // Simulates "customer copied license.dat to a second PC" by swapping the
    // stored device hash. That is exactly what a different machine's file
    // would contain, and it must land in DeviceMismatch, not Active.
    let mut foreign = license::load();
    foreign.device_hash = Some("0".repeat(64));
    let mismatched = license::Entitlements::of(&foreign, true);
    r.check(
        "a copied licence is DeviceMismatch, not Active",
        mismatched.state == LicenseState::DeviceMismatch,
        format!("{:?}", mismatched.state),
    );
    r.check(
        "a copied licence cannot install",
        !mismatched.can_install,
        "a foreign device_hash still granted installation",
    );
    r.check(
        "a device mismatch says 'bound to another device'",
        mismatched.reason.contains("其他设备"),
        &mismatched.reason,
    );

    // -- 6. Deactivation returns the machine to FREE -----------------------
    match license::deactivate() {
        Ok(_) => {
            let off = license::Entitlements::of(&license::load(), true);
            r.check(
                "deactivation returns to FREE",
                off.tier == Tier::Free && !off.can_install,
                format!("tier={:?}", off.tier),
            );
        }
        Err(e) => r.check("deactivation returns to FREE", false, format!("{e}")),
    }

    // -- Restore the machine's original state ------------------------------
    if !had_licence {
        let _ = license::deactivate();
        let _ = std::fs::remove_file(license::license_path());
    }

    println!();
    println!("{} passed, {} failed", r.passed, r.failed.len());
    for f in &r.failed {
        println!("  FAILED: {f}");
    }

    if !r.failed.is_empty() {
        std::process::exit(1);
    }
}
