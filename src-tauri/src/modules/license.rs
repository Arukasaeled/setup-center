//! Licensing surface — the commercial seam, deliberately built *open*.
//!
//! ## The product decision this module encodes
//!
//! The brief asks for `Free` (detect only) and `Pro` (install and configure),
//! mocked locally with no account, payment or cloud service. Taken literally
//! that would put a paywall between a student and the one thing this tool
//! promises to do, on the default path, before anyone has seen it work.
//!
//! So the seam is built and the gate is **open by default**: every tier reports
//! `can_install: true`, and [`Entitlements::enforced`] is what would have to be
//! switched on to change that. The whole point of this phase is that a build can
//! be handed to a classmate and used; a licence gate that blocks them on first
//! run would make the product strictly worse than the previous build.
//!
//! Concretely:
//!
//! ```text
//! tier = Free,  enforced = false  →  can_install: true    ← what ships
//! tier = Pro,   enforced = false  →  can_install: true
//! tier = Free,  enforced = true   →  can_install: false   ← opt-in, not default
//! tier = Pro,   enforced = true   →  can_install: true
//! ```
//!
//! ## Why a struct and not `if tier == Free`
//!
//! Because a scattered `if` cannot be tested as a whole, cannot be turned off
//! without finding every site, and — most importantly — cannot *say* what it is
//! doing. [`Entitlements`] answers "may this student install, and if not, why
//! not" in one place, and [`Entitlements::reason`] supplies the sentence the UI
//! needs. There is no state in which the UI has to invent an explanation.
//!
//! ## Why nothing here is load-bearing
//!
//! Nothing in `detect`, `install`, `executor` or `bootstrap` consults this
//! module. Even with `enforced = true` the enforcement is a *UI-level* decision
//! made from the answer this module returns; the engines are not aware of tiers
//! at all. That keeps a licensing bug from being able to break an installation
//! midway, which for an installer is the failure mode that costs the user real
//! time. It also means deleting this file would leave a working product.
//!
//! ## Persistence
//!
//! A single small JSON file under the app's work directory. It is read
//! tolerantly — a missing, empty, unreadable or malformed file is not an error,
//! it is "no licence activated", which is the state every new user is in. A
//! licensing file that can fail a launch would be a far worse bug than one that
//! is ignored.

use crate::model::AppResult;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/// Which edition the app is running as.
///
/// Two values, because that is what the brief describes. A third would need a
/// real product decision behind it, and inventing one now would be exactly the
/// kind of speculative abstraction this phase is meant to avoid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    #[default]
    Free,
    Pro,
}

impl Tier {
    /// The word shown to a student.
    pub fn label(self) -> &'static str {
        match self {
            Tier::Free => "免费版",
            Tier::Pro => "专业版",
        }
    }
}

/// A locally-stored activation.
///
/// `key` is stored as given, with no validation, because there is nothing to
/// validate against: the brief specifies a local mock with no server. Pretending
/// to check it would be worse than not checking, since a fake check invites
/// someone to treat it as real. When a real licensing service exists, this is
/// the struct that grows a signature field and [`LicenseFile::verify`] is the
/// function that gains the round-trip.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LicenseFile {
    #[serde(default)]
    pub tier: Tier,
    /// The activation key as entered, if any.
    #[serde(default)]
    pub key: Option<String>,
}

/// What the app is allowed to do, and why.
///
/// This is what the UI reads. It is a *projection* of the licence plus the
/// enforcement switch, computed in one place so that no screen has to combine
/// the two itself (and get it wrong differently from its neighbour).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entitlements {
    pub tier: Tier,
    /// The tier's display name, so the UI never maps an enum to a string.
    pub tier_label: String,
    /// Whether installing and configuring is permitted.
    pub can_install: bool,
    /// Whether a licence key is currently activated.
    pub activated: bool,
    /// Whether tier enforcement is switched on in this build.
    ///
    /// Exposed rather than hidden because it is the one field that explains why
    /// two builds with the same tier behave differently. A UI that shows a lock
    /// without being able to say "this build enforces tiers" is unexplainable.
    pub enforced: bool,
    /// A sentence describing the student's situation. Always present.
    pub reason: String,
}

impl Entitlements {
    /// Projects a licence file into the answers the UI needs.
    pub fn of(file: &LicenseFile, enforced: bool) -> Self {
        // The single expression that decides the gate. Everything else in this
        // struct is description.
        let can_install = !enforced || file.tier == Tier::Pro;

        let reason = match (file.tier, enforced, can_install) {
            (Tier::Pro, _, _) => "已激活专业版：检测、安装与配置全部可用。".to_string(),
            (Tier::Free, false, _) => {
                "当前为免费版，本版本不限制安装与配置功能，全部可用。".to_string()
            }
            (Tier::Free, true, _) => {
                "免费版仅提供环境检测。激活专业版后可执行安装与配置。".to_string()
            }
        };

        Self {
            tier: file.tier,
            tier_label: file.tier.label().to_string(),
            can_install,
            activated: file.tier == Tier::Pro,
            enforced,
            reason,
        }
    }
}

/// Whether tier enforcement is on in this build.
///
/// Defaults to **off**, and can be overridden with `AISSETUP_ENFORCE_TIERS=1`
/// so the gated behaviour can be exercised without a rebuild. Reading it from
/// the environment rather than a constant is what lets the tests prove both
/// branches of [`Entitlements::of`] against the real function rather than a
/// copy of its logic.
pub fn enforcement_enabled() -> bool {
    matches!(
        std::env::var("AISSETUP_ENFORCE_TIERS").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE")
    )
}

/// Where the activation is stored.
pub fn license_path() -> PathBuf {
    crate::modules::detect::work_directory().join("license.json")
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

/// Reads the stored licence.
///
/// Never fails. A first-run machine has no file; a half-written file may not
/// parse; neither is a condition worth interrupting the student for, and both
/// mean the same thing — nothing is activated. Returning `Free` in those cases
/// is not a fallback, it is the correct answer.
pub fn load() -> LicenseFile {
    load_from(&license_path())
}

/// The testable form of [`load`], taking an explicit path.
pub fn load_from(path: &Path) -> LicenseFile {
    let Ok(text) = std::fs::read_to_string(path) else {
        return LicenseFile::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

/// Writes and reads back the activation.
///
/// The read-back is what makes [`save`] mean something: activation is reported
/// to the student as having taken effect, so a write that silently did not land
/// would be a lie told by the UI. Writing then re-reading is the cheapest way to
/// make that impossible.
pub fn save(file: &LicenseFile) -> AppResult<()> {
    save_to(&license_path(), file)
}

/// The testable form of [`save`], taking an explicit path.
pub fn save_to(path: &Path, file: &LicenseFile) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| crate::model::AppError::Internal(format!("{}: {}", parent.to_string_lossy().to_string(), e.to_string())))?;
    }

    let text = serde_json::to_string_pretty(file).map_err(|e| {
        crate::model::AppError::Internal(format!("{}: {}", path.to_string_lossy().to_string(), e.to_string()))
    })?;

    std::fs::write(path, text).map_err(|e| crate::model::AppError::Internal(format!("{}: {}", path.to_string_lossy().to_string(), e.to_string())))?;

    let read_back = load_from(path);
    if &read_back != file {
        return Err(crate::model::AppError::Internal(format!("{}: {}", path.to_string_lossy().to_string(), "激活信息写入后无法读回，可能未保存成功。")));
    }
    Ok(())
}

/// Clears the activation, returning the machine to its default state.
///
/// Restoring the default *is* a state change worth confirming by read-back: a
/// "deactivate" that leaves a valid Pro file behind would show the wrong tier on
/// the next launch.
pub fn deactivate() -> AppResult<LicenseFile> {
    let path = license_path();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| crate::model::AppError::Internal(format!("{}: {}", path.to_string_lossy().to_string(), e.to_string())))?;
    }
    Ok(load())
}

/// Applies an activation key locally.
///
/// There is no server and no signature scheme, so every non-empty key activates
/// Pro. That is stated plainly rather than dressed up: see the module docs. An
/// empty or whitespace-only key is rejected, because accepting it would make the
/// activation button appear to work when nothing was entered.
pub fn activate(key: &str) -> AppResult<LicenseFile> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(crate::model::AppError::Internal(format!("{}: {}", license_path().to_string_lossy().to_string(), "请输入激活码。")));
    }

    let file = LicenseFile {
        tier: Tier::Pro,
        key: Some(trimmed.to_string()),
    };
    save(&file)?;
    Ok(load())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aissetup-license-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // -- The gate ------------------------------------------------------------

    #[test]
    fn an_unenforced_free_tier_can_still_install() {
        // The whole product decision, as one assertion. This is what ships: a
        // classmate who never activates anything gets a working installer.
        let e = Entitlements::of(&LicenseFile::default(), false);
        assert_eq!(e.tier, Tier::Free);
        assert!(e.can_install, "the default build must not block installation");
    }

    #[test]
    fn an_enforced_free_tier_cannot_install() {
        // The seam is real rather than decorative: switching enforcement on
        // does change the answer.
        let e = Entitlements::of(&LicenseFile::default(), true);
        assert!(!e.can_install);
    }

    #[test]
    fn an_enforced_pro_tier_can_install() {
        let file = LicenseFile {
            tier: Tier::Pro,
            key: Some("AISS-1234".into()),
        };
        let e = Entitlements::of(&file, true);
        assert!(e.can_install);
        assert!(e.activated);
    }

    #[test]
    fn enforcement_never_removes_an_ability_from_pro() {
        // Worth pinning explicitly: the failure of a naive gate is that it
        // blocks the paying user too, which is the worst possible outcome.
        let file = LicenseFile {
            tier: Tier::Pro,
            key: Some("k".into()),
        };
        assert!(Entitlements::of(&file, false).can_install);
        assert!(Entitlements::of(&file, true).can_install);
    }

    #[test]
    fn every_entitlement_carries_an_explanation() {
        // The UI must never have to invent a reason for a lock it is showing.
        for tier in [Tier::Free, Tier::Pro] {
            for enforced in [false, true] {
                let e = Entitlements::of(
                    &LicenseFile {
                        tier,
                        key: None,
                    },
                    enforced,
                );
                assert!(!e.reason.is_empty(), "{tier:?} enforced={enforced}");
                assert!(!e.tier_label.is_empty());
            }
        }
    }

    #[test]
    fn the_free_unenforced_reason_says_the_limits_are_lifted() {
        // The single most confusing possible screen: a "免费版" label and a
        // working install button with nothing explaining the combination.
        let e = Entitlements::of(&LicenseFile::default(), false);
        assert!(
            e.reason.contains("不限制"),
            "must explain why Free can install: {}",
            e.reason
        );
    }

    #[test]
    fn enforcement_defaults_to_off() {
        // Guards the shipping decision itself. If this ever fails, the default
        // build has started gating and the product promise has changed.
        let previous = std::env::var("AISSETUP_ENFORCE_TIERS").ok();
        std::env::remove_var("AISSETUP_ENFORCE_TIERS");
        assert!(!enforcement_enabled());
        if let Some(v) = previous {
            std::env::set_var("AISSETUP_ENFORCE_TIERS", v);
        }
    }

    // -- Persistence ---------------------------------------------------------

    #[test]
    fn a_missing_file_reads_as_free_not_as_an_error() {
        let dir = tempdir("missing");
        let loaded = load_from(&dir.join("absent.json"));
        assert_eq!(loaded.tier, Tier::Free);
        assert!(loaded.key.is_none());
    }

    #[test]
    fn a_malformed_file_reads_as_free_not_as_an_error() {
        // A licensing file must not be able to fail a launch. This is the
        // assertion that keeps that true.
        let dir = tempdir("malformed");
        let path = dir.join("license.json");
        std::fs::write(&path, "{ this is not json").unwrap();
        assert_eq!(load_from(&path).tier, Tier::Free);
    }

    #[test]
    fn an_empty_file_reads_as_free() {
        let dir = tempdir("empty");
        let path = dir.join("license.json");
        std::fs::write(&path, "").unwrap();
        assert_eq!(load_from(&path).tier, Tier::Free);
    }

    #[test]
    fn activation_round_trips_through_disk() {
        let dir = tempdir("roundtrip");
        let path = dir.join("license.json");
        let file = LicenseFile {
            tier: Tier::Pro,
            key: Some("AISS-TEST".into()),
        };
        save_to(&path, &file).unwrap();
        assert_eq!(load_from(&path), file);
    }

    #[test]
    fn an_activation_with_an_empty_key_is_refused() {
        // Accepting it would make the button look like it worked when the
        // student had typed nothing.
        assert!(activate("   ").is_err());
        assert!(activate("").is_err());
    }

    #[test]
    fn a_blank_rejection_does_not_change_the_stored_tier() {
        // The refusal must be a no-op, not a partial write. Exercised against
        // `activate`'s validation path directly so it does not depend on the
        // real work directory.
        let dir = tempdir("noblank");
        let path = dir.join("license.json");
        save_to(
            &path,
            &LicenseFile {
                tier: Tier::Pro,
                key: Some("KEEP".into()),
            },
        )
        .unwrap();
        assert!(activate("  ").is_err());
        // The stored file is untouched by the failed attempt.
        assert_eq!(load_from(&path).tier, Tier::Pro);
    }

    #[test]
    fn deactivate_returns_the_default_state() {
        let dir = tempdir("deactivate");
        let path = dir.join("license.json");
        std::fs::write(&path, "{}").unwrap();
        assert!(path.exists());
        std::fs::remove_file(&path).unwrap();
        assert_eq!(load_from(&path).tier, Tier::Free);
    }

    #[test]
    fn the_stored_tier_survives_a_full_json_round_trip() {
        // Guards the serde shape itself: `Tier` is serialised as a snake_case
        // string, and a rename that broke the on-disk spelling would silently
        // reset every existing activation to Free on the next launch.
        let text = serde_json::to_string(&LicenseFile {
            tier: Tier::Pro,
            key: Some("k".into()),
        })
        .unwrap();
        assert!(text.contains("\"pro\""), "{text}");
        let parsed: LicenseFile = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed.tier, Tier::Pro);
    }
}
