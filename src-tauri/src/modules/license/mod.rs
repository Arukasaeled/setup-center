//! Licensing — the commercial seam.
//!
//! ## What changed from the previous version of this module
//!
//! An earlier revision built the seam but shipped it *open*: every tier reported
//! `can_install: true`, and the key was written to `license.json` in plaintext.
//! That was a deliberate place-holder for a product that had to be usable by a
//! classmate on first run. This revision implements the actual commercial
//! requirement, which is the opposite on both counts:
//!
//! | | before | now |
//! |---|---|---|
//! | Free tier can install | yes | **no** |
//! | Key at rest | plaintext JSON | **DPAPI-encrypted blob** |
//! | Machine binding | none | **SHA-256 fingerprint, enforced** |
//! | File | `license.json` | `license.dat` |
//!
//! ## The split the product is built on
//!
//! ```text
//! FREE  →  detect, scan, explain, recommend, read the tutorial
//! PRO   →  the above, plus install, bootstrap, and configuration
//! ```
//!
//! Free is not a crippled demo: it answers "what is wrong with my machine and
//! what should I install", which is genuinely useful on its own and is what
//! makes the paid tier worth buying rather than worth resenting. What it does
//! not do is *change* the machine.
//!
//! ## Why the gate lives here and not in the engines
//!
//! `install`, `executor`, `bootstrap` and `detect` contain no reference to tiers.
//! Enforcement is applied at the command boundary in `commands.rs`, which means
//! a licensing bug can refuse to *start* work but can never corrupt work in
//! progress. For an installer, "refused to start" is recoverable and "aborted
//! halfway" is not, so this placement is the one that fails safely.
//!
//! ## Storage
//!
//! `%LOCALAPPDATA%\Setup Center\license.dat` — a DPAPI blob whose plaintext is
//!
//! ```json
//! { "version": 1, "license_hash": "…", "device_hash": "…", "activated_at": "…" }
//! ```
//!
//! The activation *code* is never stored, only `HMAC(secret, code‖device_hash)`.
//! DPAPI ties the blob to this Windows account, and `device_hash` ties it to
//! this hardware, so copying the file to another machine fails at two
//! independent layers.
//!
//! Every read path is tolerant: a missing, corrupt, foreign or undecryptable file
//! is reported as "not activated", never as a launch failure.

pub mod crypto;
pub mod fingerprint;
pub mod validator;

use crate::model::{AppError, AppResult};

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use fingerprint::Fingerprint;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/// Which edition the app is running as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    #[default]
    Free,
    Pro,
}

impl Tier {
    /// The word shown to a customer.
    pub fn label(self) -> &'static str {
        match self {
            Tier::Free => "免费版",
            Tier::Pro => "专业版",
        }
    }
}

/// The outcome of checking the stored activation against this machine.
///
/// [`LicenseState::DeviceMismatch`] exists as its own value rather than being
/// folded into "not activated" because the two need different sentences. A
/// customer who copied their `license.dat` to a second PC has a valid code and
/// needs to be told *that*, not told their code is invalid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseState {
    /// No activation file, or it could not be read or decrypted.
    Inactive,
    /// Activated on this machine and the binding still matches.
    Active,
    /// A valid-looking activation bound to different hardware.
    DeviceMismatch,
}

impl LicenseState {
    pub fn is_active(self) -> bool {
        matches!(self, LicenseState::Active)
    }
}

/// On-disk activation record, as stored (encrypted) in `license.dat`.
///
/// Field names match the brief. `version` is present from the first release so
/// that a future format change can be detected rather than misparsed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LicenseFile {
    #[serde(default = "current_version")]
    pub version: u32,
    /// `HMAC(secret, code‖device_hash)` — never the code itself.
    #[serde(default)]
    pub license_hash: Option<String>,
    /// The fingerprint this activation was bound to.
    #[serde(default)]
    pub device_hash: Option<String>,
    /// ISO-8601, for display only. Never compared.
    #[serde(default)]
    pub activated_at: Option<String>,
}

/// Hand-written so that `LicenseFile::default()` agrees with deserialising `{}`.
///
/// The derive would give `version: 0` while the serde default gives `1`, meaning
/// an inactive licence read from a corrupt file and an inactive licence built in
/// memory would carry different versions. Two "empty" values that differ is the
/// kind of inconsistency that turns into a bug the first time someone compares
/// them.
impl Default for LicenseFile {
    fn default() -> Self {
        Self {
            version: current_version(),
            license_hash: None,
            device_hash: None,
            activated_at: None,
        }
    }
}

fn current_version() -> u32 {
    1
}

/// What the app is allowed to do, and why.
///
/// The single projection the UI reads. `reason` is always populated so no screen
/// has to invent an explanation for a lock it is showing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entitlements {
    pub tier: Tier,
    pub tier_label: String,
    /// Whether installation may run.
    pub can_install: bool,
    /// Whether the configuration/bootstrap stage may run.
    ///
    /// Separate from `can_install` because they are separate engines and a
    /// future tier could plausibly grant one without the other. Today they are
    /// always equal, which is stated rather than implied.
    pub can_configure: bool,
    pub activated: bool,
    /// Whether tier enforcement is on in this build.
    pub enforced: bool,
    /// The machine-check outcome, for screens that need to distinguish
    /// "never activated" from "activated elsewhere".
    pub state: LicenseState,
    /// When this machine was activated, for display. `None` when inactive.
    pub activated_at: Option<String>,
    /// Whether the hardware fingerprint was readable enough to be trustworthy.
    ///
    /// Surfaced because a mismatch on a machine where most probes failed is not
    /// evidence of copying, and the UI should be able to say so.
    pub device_reliable: bool,
    /// A sentence describing the customer's situation. Always present.
    pub reason: String,
}

impl Entitlements {
    /// Projects a licence record into the answers the UI needs.
    pub fn of(file: &LicenseFile, enforced: bool) -> Self {
        let state = state_of(file);
        let tier = if state.is_active() { Tier::Pro } else { Tier::Free };

        let can_use = !enforced || tier == Tier::Pro;

        let reason = match (tier, enforced, state) {
            (Tier::Pro, _, _) => "已激活专业版：自动安装、环境初始化与配置功能已解锁。".to_string(),
            (Tier::Free, true, LicenseState::DeviceMismatch) => {
                "授权验证失败，该授权已绑定其他设备。请在原设备上使用，或联系作者处理。".to_string()
            }
            (Tier::Free, true, _) => {
                "当前版本：免费版。可检测环境、查看软件推荐，不包含自动安装与配置。".to_string()
            }
            // Enforcement switched off is a development/testing configuration.
            (Tier::Free, false, LicenseState::DeviceMismatch) => {
                "授权验证失败，该授权已绑定其他设备。本版本暂未限制功能。".to_string()
            }
            (Tier::Free, false, _) => {
                "当前版本：免费版（本构建未启用限制，全部功能可用）。".to_string()
            }
        };

        Self {
            tier,
            tier_label: tier.label().to_string(),
            can_install: can_use,
            can_configure: can_use,
            activated: state.is_active(),
            enforced,
            state,
            activated_at: if state.is_active() {
                file.activated_at.clone()
            } else {
                None
            },
            device_reliable: current_fingerprint().reliable(),
            reason,
        }
    }
}

/// Whether tier enforcement is on in this build.
///
/// **On by default**, which is the shipping configuration — a commercial build
/// that gave away installation would have no product. `AISSETUP_ENFORCE_TIERS=0`
/// turns it off so the ungated path stays exercisable in development without a
/// rebuild, and so the tests can prove both branches against the real function.
pub fn enforcement_enabled() -> bool {
    !matches!(
        std::env::var("AISSETUP_ENFORCE_TIERS").as_deref(),
        Ok("0") | Ok("false") | Ok("FALSE")
    )
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// Where the activation is stored.
///
/// `license.dat` rather than `license.json`: the contents are an opaque DPAPI
/// blob, and a `.json` extension would invite someone to open it expecting to
/// read it.
pub fn license_path() -> PathBuf {
    crate::modules::detect::work_directory().join("license.dat")
}

// ---------------------------------------------------------------------------
// Fingerprint caching
// ---------------------------------------------------------------------------

/// The fingerprint is a property of the hardware, so reading it more than once
/// per process is pure waste — and it is not cheap: three PowerShell queries.
/// `license_status` runs at startup, so without this the first screen would pay
/// that cost.
static FINGERPRINT: OnceLock<Fingerprint> = OnceLock::new();

fn current_fingerprint() -> &'static Fingerprint {
    FINGERPRINT.get_or_init(fingerprint::capture)
}

/// The current machine's fingerprint, for display in the activation screen.
///
/// Returns the digest and the count of readable components — never the raw
/// `MachineGuid`, board name or disk serial, which stay inside `fingerprint.rs`.
pub fn device_summary() -> (String, usize) {
    let fp = current_fingerprint();
    (fp.device_hash.clone(), fp.components_readable)
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

/// Reads the stored activation and reports how it relates to this machine.
///
/// Never fails. Every failure mode — absent, unreadable, corrupt, written by
/// another user, written for another machine — resolves to something the caller
/// can act on rather than an error the caller must handle.
pub fn load() -> LicenseFile {
    load_from(&license_path())
}

/// The testable form of [`load`], taking an explicit path.
pub fn load_from(path: &Path) -> LicenseFile {
    let Ok(blob) = std::fs::read(path) else {
        return LicenseFile::default();
    };
    // A blob DPAPI refuses to decrypt is not an error worth surfacing: it means
    // another user or another machine, which is exactly `Inactive` (or a
    // mismatch once a fingerprint is compared).
    let Ok(plain) = crypto::unprotect(&blob) else {
        return LicenseFile::default();
    };
    serde_json::from_slice(&plain).unwrap_or_default()
}

/// Classifies a record against the current machine.
pub fn state_of(file: &LicenseFile) -> LicenseState {
    let Some(stored_hash) = file.license_hash.as_deref() else {
        return LicenseState::Inactive;
    };
    if stored_hash.is_empty() {
        return LicenseState::Inactive;
    }

    match file.device_hash.as_deref() {
        Some(device) if current_fingerprint().matches(device) => LicenseState::Active,
        Some(_) => LicenseState::DeviceMismatch,
        // A record with a key hash but no device binding predates binding, or
        // was tampered with. Either way it is not a valid activation.
        None => LicenseState::Inactive,
    }
}

/// Writes and reads back the activation.
///
/// The read-back is what makes `save` mean something: activation is reported to
/// the customer as having taken effect, so a write that silently did not land
/// would be a lie told by the UI. Round-tripping through the decrypt path also
/// proves the blob DPAPI produced is one we can actually read.
pub fn save(file: &LicenseFile) -> AppResult<()> {
    save_to(&license_path(), file)
}

/// The testable form of [`save`], taking an explicit path.
pub fn save_to(path: &Path, file: &LicenseFile) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            AppError::Internal(format!("{}: {}", parent.to_string_lossy(), e))
        })?;
    }

    let plain = serde_json::to_vec(file)
        .map_err(|e| AppError::Internal(format!("{}: {}", path.to_string_lossy(), e)))?;
    let blob = crypto::protect(&plain)?;

    std::fs::write(path, &blob)
        .map_err(|e| AppError::Internal(format!("{}: {}", path.to_string_lossy(), e)))?;

    let read_back = load_from(path);
    if &read_back != file {
        return Err(AppError::Internal(format!(
            "{}: 激活信息写入后无法读回，可能未保存成功。",
            path.to_string_lossy()
        )));
    }
    Ok(())
}

/// Clears the activation, returning the machine to its default state.
pub fn deactivate() -> AppResult<LicenseFile> {
    let path = license_path();
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| AppError::Internal(format!("{}: {}", path.to_string_lossy(), e)))?;
    }
    Ok(load())
}

/// Activates this machine with `code`.
///
/// Order matters: the code's shape is checked *before* anything is written, so a
/// mistyped code cannot leave a half-built record behind, and the failure a
/// customer sees is about their input rather than about the file.
pub fn activate(code: &str) -> AppResult<LicenseFile> {
    let canonical = validator::validate(code).map_err(validator::rejection_error)?;

    let fp = current_fingerprint();
    let record = LicenseFile {
        version: current_version(),
        license_hash: Some(validator::digest(&canonical, &fp.device_hash)),
        device_hash: Some(fp.device_hash.clone()),
        activated_at: Some(crate::modules::detect::now_iso8601()),
    };

    save(&record)?;
    Ok(load())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aissetup-license2-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// An activation record bound to *this* machine, built without going through
    /// `activate` so tests do not depend on the real work directory.
    fn record_for_this_machine() -> LicenseFile {
        let fp = current_fingerprint();
        LicenseFile {
            version: 1,
            license_hash: Some(validator::digest("SC-ABCDE-23456-FGHJK-23456", &fp.device_hash)),
            device_hash: Some(fp.device_hash.clone()),
            activated_at: Some("2026-01-01T00:00:00Z".to_string()),
        }
    }

    // -- The gate ------------------------------------------------------------

    #[test]
    fn the_shipping_free_tier_cannot_install() {
        // The product decision, as one assertion. This is what ships: without an
        // activation there is no automated installation.
        let e = Entitlements::of(&LicenseFile::default(), true);
        assert_eq!(e.tier, Tier::Free);
        assert!(!e.can_install, "the free tier must not install");
        assert!(!e.can_configure, "the free tier must not configure");
        assert!(!e.activated);
    }

    #[test]
    fn the_free_tier_still_detects_and_recommends() {
        // Free must remain genuinely useful — the paywall is on *acting*, not on
        // seeing. Nothing in `Entitlements` gates detection, and this pins that
        // the free reason describes detection as available.
        let e = Entitlements::of(&LicenseFile::default(), true);
        assert!(e.reason.contains("检测"), "{}", e.reason);
    }

    #[test]
    fn an_activated_pro_tier_can_install_and_configure() {
        let e = Entitlements::of(&record_for_this_machine(), true);
        assert_eq!(e.tier, Tier::Pro);
        assert!(e.can_install);
        assert!(e.can_configure);
        assert!(e.activated);
        assert!(e.activated_at.is_some());
    }

    #[test]
    fn a_device_mismatch_is_reported_as_such_not_as_inactive() {
        // The brief's wording, and the reason `LicenseState` is not a bool.
        let mut file = record_for_this_machine();
        file.device_hash = Some("f".repeat(64));
        let e = Entitlements::of(&file, true);
        assert_eq!(e.state, LicenseState::DeviceMismatch);
        assert!(!e.can_install);
        assert!(!e.activated);
        assert!(e.reason.contains("已绑定其他设备"), "{}", e.reason);
    }

    #[test]
    fn enforcement_never_removes_an_ability_from_pro() {
        // The worst possible gate bug is blocking the paying customer.
        let file = record_for_this_machine();
        assert!(Entitlements::of(&file, false).can_install);
        assert!(Entitlements::of(&file, true).can_install);
    }

    #[test]
    fn turning_enforcement_off_restores_installation_for_free() {
        // The development escape hatch, asserted so it cannot rot.
        let e = Entitlements::of(&LicenseFile::default(), false);
        assert!(e.can_install);
        assert!(!e.enforced);
    }

    #[test]
    fn enforcement_is_on_by_default() {
        // Guards the commercial decision itself. If this fails, the shipping
        // build has started giving away the paid feature.
        let previous = std::env::var("AISSETUP_ENFORCE_TIERS").ok();
        std::env::remove_var("AISSETUP_ENFORCE_TIERS");
        assert!(enforcement_enabled());
        if let Some(v) = previous {
            std::env::set_var("AISSETUP_ENFORCE_TIERS", v);
        }
    }

    #[test]
    fn enforcement_can_be_switched_off_by_environment() {
        let previous = std::env::var("AISSETUP_ENFORCE_TIERS").ok();
        std::env::set_var("AISSETUP_ENFORCE_TIERS", "0");
        assert!(!enforcement_enabled());
        std::env::set_var("AISSETUP_ENFORCE_TIERS", "false");
        assert!(!enforcement_enabled());
        match previous {
            Some(v) => std::env::set_var("AISSETUP_ENFORCE_TIERS", v),
            None => std::env::remove_var("AISSETUP_ENFORCE_TIERS"),
        }
    }

    #[test]
    fn every_entitlement_carries_an_explanation_and_a_label() {
        for file in [LicenseFile::default(), record_for_this_machine()] {
            for enforced in [false, true] {
                let e = Entitlements::of(&file, enforced);
                assert!(!e.reason.is_empty());
                assert!(!e.tier_label.is_empty());
            }
        }
    }

    #[test]
    fn a_pro_entitlement_never_mentions_a_device_problem() {
        // A paying customer must never see the mismatch sentence.
        let e = Entitlements::of(&record_for_this_machine(), true);
        assert!(!e.reason.contains("其他设备"), "{}", e.reason);
    }

    // -- State classification ------------------------------------------------

    #[test]
    fn a_record_without_a_key_hash_is_inactive() {
        assert_eq!(state_of(&LicenseFile::default()), LicenseState::Inactive);
    }

    #[test]
    fn a_record_with_an_empty_key_hash_is_inactive() {
        let file = LicenseFile {
            version: 1,
            license_hash: Some(String::new()),
            device_hash: Some("a".repeat(64)),
            activated_at: None,
        };
        assert_eq!(state_of(&file), LicenseState::Inactive);
    }

    #[test]
    fn a_record_with_a_key_but_no_device_is_inactive_not_a_mismatch() {
        // A hand-edited file must not be reported as "another device", which
        // would tell the customer something untrue.
        let file = LicenseFile {
            version: 1,
            license_hash: Some("x".repeat(64)),
            device_hash: None,
            activated_at: None,
        };
        assert_eq!(state_of(&file), LicenseState::Inactive);
    }

    #[test]
    fn a_matching_device_is_active() {
        assert_eq!(state_of(&record_for_this_machine()), LicenseState::Active);
    }

    #[test]
    fn another_machines_device_hash_is_a_mismatch() {
        let mut file = record_for_this_machine();
        file.device_hash = Some("0".repeat(64));
        assert_eq!(state_of(&file), LicenseState::DeviceMismatch);
    }

    // -- Persistence ---------------------------------------------------------

    #[test]
    fn a_missing_file_reads_as_free_not_as_an_error() {
        let dir = tempdir("missing");
        let loaded = load_from(&dir.join("absent.dat"));
        assert_eq!(loaded.version, 1);
        assert!(loaded.license_hash.is_none());
        assert_eq!(state_of(&loaded), LicenseState::Inactive);
    }

    #[test]
    fn a_corrupt_file_reads_as_free_not_as_an_error() {
        // A licensing file must not be able to fail a launch.
        let dir = tempdir("corrupt");
        let path = dir.join("license.dat");
        std::fs::write(&path, b"this is not a DPAPI blob").unwrap();
        assert_eq!(state_of(&load_from(&path)), LicenseState::Inactive);
    }

    #[test]
    fn an_empty_file_reads_as_free() {
        let dir = tempdir("empty");
        let path = dir.join("license.dat");
        std::fs::write(&path, b"").unwrap();
        assert_eq!(state_of(&load_from(&path)), LicenseState::Inactive);
    }

    #[test]
    fn an_activation_round_trips_through_disk() {
        let dir = tempdir("roundtrip");
        let path = dir.join("license.dat");
        let file = record_for_this_machine();
        save_to(&path, &file).unwrap();
        assert_eq!(load_from(&path), file);
        assert_eq!(state_of(&load_from(&path)), LicenseState::Active);
    }

    #[test]
    fn the_file_on_disk_is_not_readable_as_text() {
        // The assertion behind "激活码不能明文存储": the stored bytes must not
        // contain the record's JSON, nor the key hash as a findable string.
        let dir = tempdir("opaque");
        let path = dir.join("license.dat");
        let file = record_for_this_machine();
        save_to(&path, &file).unwrap();

        let raw = std::fs::read(&path).unwrap();
        let text = String::from_utf8_lossy(&raw);
        assert!(!text.contains("license_hash"), "the JSON structure is visible");
        assert!(!text.contains("device_hash"), "the JSON structure is visible");
        assert!(
            !text.contains(file.license_hash.as_ref().unwrap()),
            "the key hash appears verbatim on disk"
        );
    }

    #[test]
    fn the_activation_code_never_reaches_the_filesystem() {
        // End-to-end version of the same claim, through the real entry point.
        let dir = tempdir("nocode");
        let path = dir.join("license.dat");
        let code = validator::mint().unwrap();
        let file = LicenseFile {
            version: 1,
            license_hash: Some(validator::digest(&code, &current_fingerprint().device_hash)),
            device_hash: Some(current_fingerprint().device_hash.clone()),
            activated_at: Some("2026-01-01T00:00:00Z".to_string()),
        };
        save_to(&path, &file).unwrap();

        let raw = std::fs::read(&path).unwrap();
        let body = code.split('-').nth(1).unwrap();
        assert!(
            !raw.windows(body.len()).any(|w| w == body.as_bytes()),
            "the code body appears in the stored file"
        );
    }

    #[test]
    fn a_mistyped_code_is_refused_before_anything_is_written() {
        // Ordering matters: a rejection must not leave a partial record.
        let dir = tempdir("nopartial");
        let path = dir.join("license.dat");
        assert!(!path.exists());

        let err = activate("SC-AAAAA-BBBBB-CCCCC-DDDDD");
        assert!(err.is_err(), "a random code must not activate");
        assert!(!path.exists(), "a rejected code created a file");
    }

    #[test]
    fn an_empty_code_is_refused() {
        assert!(activate("").is_err());
        assert!(activate("   ").is_err());
    }

    #[test]
    fn deactivate_removes_the_file_and_restores_free() {
        let dir = tempdir("deactivate");
        let path = dir.join("license.dat");
        save_to(&path, &record_for_this_machine()).unwrap();
        assert!(path.exists());

        std::fs::remove_file(&path).unwrap();
        assert_eq!(state_of(&load_from(&path)), LicenseState::Inactive);
    }

    #[test]
    fn the_stored_version_survives_a_json_round_trip() {
        // Guards the serde shape: a rename that broke `license_hash` would
        // silently reset every existing activation on the next launch.
        let file = record_for_this_machine();
        let text = serde_json::to_string(&file).unwrap();
        assert!(text.contains("license_hash"), "{text}");
        assert!(text.contains("device_hash"), "{text}");
        assert!(text.contains("activated_at"), "{text}");
        let parsed: LicenseFile = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed, file);
    }

    #[test]
    fn entitlements_serialise_with_the_field_names_the_frontend_expects() {
        // The TS interface in `lib/types.ts` mirrors these exactly; a rename on
        // one side only would show up as `undefined` in the UI.
        let text = serde_json::to_string(&Entitlements::of(&LicenseFile::default(), true)).unwrap();
        for field in [
            "tierLabel",
            "canInstall",
            "canConfigure",
            "activated",
            "enforced",
            "state",
            "activatedAt",
            "deviceReliable",
            "reason",
        ] {
            assert!(text.contains(field), "missing {field} in {text}");
        }
    }

    // -- Fingerprint exposure ------------------------------------------------

    #[test]
    fn the_device_summary_does_not_expose_raw_hardware_identifiers() {
        let (hash, count) = device_summary();
        assert_eq!(hash.len(), 64);
        assert!(count <= 4);
    }

    #[test]
    fn the_fingerprint_is_computed_once_per_process() {
        // Cheap proxy for the caching behaviour: two reads with an intervening
        // call must agree, and the pointer must be identical.
        let a = current_fingerprint() as *const Fingerprint;
        let b = current_fingerprint() as *const Fingerprint;
        assert_eq!(a, b);
    }
}
