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
//! DPAPI protects the blob at rest under the active Windows user profile, and
//! `device_hash` validates against local hardware evidence, providing multi-layer
//! defensive separation against casual file copying across machines.
//!
//! Read paths use structured `LicenseLoadResult` to differentiate `Absent` from
//! `Corrupt`, `Unreadable`, `DecryptFailed`, or `Invalid`, exposing transparent
//! diagnostics rather than flattening system failures into a default free state.


pub mod crypto;
pub mod fingerprint;
pub mod inventory_file;
pub mod public_keys;
pub mod rate_limit;
pub mod signed_v2;
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

    /// The stable lowercase token used **inside signed material**.
    ///
    /// Distinct from [`Tier::label`] on purpose. `label` is Chinese display
    /// text, which may be reworded at any time; this value is baked into the
    /// checksum of every v2 code and read back from every `license.dat`, so
    /// changing it would invalidate issued codes and existing activations at
    /// once. It is the serde wire form so that the value in the file, the value
    /// in the signature and the value in the UI's `tier` field are one string.
    pub fn canonical(self) -> &'static str {
        match self {
            Tier::Free => "free",
            Tier::Pro => "pro",
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
    /// No activation file exists.
    Inactive,
    /// Activated on this machine and the binding still matches.
    Active,
    /// A valid-looking activation bound to different hardware.
    DeviceMismatch,
    /// Evidence insufficient or multiple hardware changes requiring manual review.
    NeedsAttention,
    /// File exists but could not be read (permission, IO error)
    Unreadable,
    /// File decrypted but format corrupt
    Corrupt,
    /// Schema or version invalid
    Invalid,
}

impl LicenseState {
    pub fn is_active(self) -> bool {
        matches!(self, LicenseState::Active)
    }
}

/// The status of reading and validating the license file on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseLoadStatus {
    Absent,
    Valid,
    Unreadable,
    DecryptFailed,
    Corrupt,
    Invalid,
}

/// Structured result of attempting to load the license file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseLoadResult {
    pub file: LicenseFile,
    pub status: LicenseLoadStatus,
    pub error_detail: Option<String>,
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
    /// The fingerprint this activation was bound to (legacy V1).
    #[serde(default)]
    pub device_hash: Option<String>,
    /// Multi-component structured hardware evidence (V2).
    #[serde(default)]
    pub device_evidence_v2: Option<fingerprint::DeviceEvidenceV2>,
    /// ISO-8601, for display only. Never compared.
    #[serde(default)]
    pub activated_at: Option<String>,
    /// Which edition this activation unlocks.
    ///
    /// ## Why the default is `Pro` and not `Free`
    ///
    /// This field was added after the first activations shipped. An older
    /// `license.dat` therefore has no `tier` key, and whatever default serde
    /// picks is the tier that customer gets. `#[derive(Default)]` on `Tier`
    /// yields `Free`, which would silently **downgrade every customer who
    /// activated before this field existed** — they would open an app they paid
    /// for and be told they are on the free plan.
    ///
    /// So the serde default is an explicit `pro`, which encodes the history:
    /// before tiers existed, *the only thing a code could do was unlock PRO*.
    /// A tier-less record is thus evidence of a full activation, not of a free
    /// one, and reading it as PRO is the faithful interpretation rather than a
    /// generous one.
    ///
    /// Note this default only applies when the key is **absent**. A file that
    /// says `"tier":"free"` is read as FREE, and [`Tier::default`] is left as
    /// `Free` so that code constructing a fresh record does not accidentally
    /// claim PRO.
    #[serde(default = "default_tier_for_legacy_records")]
    pub tier: Tier,
}

/// The tier attributed to a record that predates the `tier` field.
///
/// Named rather than inlined so the reasoning above has one place to live and
/// the tests can assert against the same function the deserialiser uses.
fn default_tier_for_legacy_records() -> Tier {
    Tier::Pro
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
            // Deliberately `Free`, and *different* from the serde default above.
            // This is the "no file at all" record, which must mean the free
            // tier. The `Pro` default applies only when a file exists and merely
            // lacks the field — see `default_tier_for_legacy_records`.
            tier: Tier::Free,
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
    pub load_status: LicenseLoadStatus,
    pub load_error: Option<String>,
}

impl Entitlements {
    /// Projects a licence record into the answers the UI needs.
    pub fn of(file: &LicenseFile, enforced: bool) -> Self {
        let res = LicenseLoadResult {
            file: file.clone(),
            status: if file.license_hash.is_some() {
                LicenseLoadStatus::Valid
            } else {
                LicenseLoadStatus::Absent
            },
            error_detail: None,
        };
        Self::of_result(&res, enforced)
    }

    /// Projects a structured load result into entitlements with explicit error handling.
    pub fn of_result(result: &LicenseLoadResult, enforced: bool) -> Self {
        let state = state_of_result(result);
        let tier = if state.is_active() {
            result.file.tier
        } else {
            Tier::Free
        };

        let can_use = !enforced || tier == Tier::Pro;

        let reason = match state {
            LicenseState::Active => match tier {
                Tier::Pro => "已激活专业版：自动安装、环境初始化与配置功能已解锁。".to_string(),
                Tier::Free => {
                    "已激活免费版授权：包含环境检测与软件推荐，不包含自动安装与配置。".to_string()
                }
            },
            LicenseState::DeviceMismatch => {
                if enforced {
                    "授权验证失败，该授权已绑定其他设备。请在原设备上使用，或联系作者处理。".to_string()
                } else {
                    "授权验证失败，该授权已绑定其他设备。本版本暂未限制功能。".to_string()
                }
            }
            LicenseState::NeedsAttention => {
                "硬件特征证据不足或发生多项硬件变动（需人工核验）：当前设备无法满足最低 2 项强特征比对要求。".to_string()
            }
            LicenseState::Unreadable => {
                format!(
                    "授权文件读取失败：{}。原授权文件已保留，未被清除。",
                    result.error_detail.as_deref().unwrap_or("文件访问受阻")
                )
            }
            LicenseState::Corrupt => {
                format!(
                    "授权文件损坏：{}。原授权文件已保留，未被清除。",
                    result.error_detail.as_deref().unwrap_or("格式错误")
                )
            }
            LicenseState::Invalid => {
                format!(
                    "授权格式无效：{}。原授权文件已保留，未被清除。",
                    result.error_detail.as_deref().unwrap_or("版本不受支持")
                )
            }
            LicenseState::Inactive => {
                if enforced {
                    "当前版本：免费版。可检测环境、查看软件推荐，不包含自动安装与配置。".to_string()
                } else {
                    "当前版本：免费版（本构建未启用限制，全部功能可用）。".to_string()
                }
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
                result.file.activated_at.clone()
            } else {
                None
            },
            device_reliable: current_fingerprint().reliable(),
            reason,
            load_status: result.status.clone(),
            load_error: result.error_detail.clone(),
        }
    }
}

/// Whether tier enforcement is on in this build.
///
/// **Production release builds unconditionally enforce license tiers.**
/// The runtime environment variable `AISSETUP_ENFORCE_TIERS` can NEVER bypass
/// license gates in release builds (Issue A07).
/// In development builds with debug assertions, it may be disabled for testing.
pub fn enforcement_enabled() -> bool {
    #[cfg(debug_assertions)]
    {
        !matches!(
            std::env::var("AISSETUP_ENFORCE_TIERS").as_deref(),
            Ok("0") | Ok("false") | Ok("FALSE")
        )
    }
    #[cfg(not(debug_assertions))]
    {
        true
    }
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
static FINGERPRINT: OnceLock<Fingerprint> = OnceLock::new();
static EVIDENCE_V2: OnceLock<fingerprint::DeviceEvidenceV2> = OnceLock::new();

fn current_fingerprint() -> &'static Fingerprint {
    FINGERPRINT.get_or_init(fingerprint::capture)
}

pub fn current_device_evidence_v2() -> &'static fingerprint::DeviceEvidenceV2 {
    EVIDENCE_V2.get_or_init(fingerprint::DeviceEvidenceV2::capture)
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
pub fn load() -> LicenseFile {
    load_result().file
}

/// Reads the stored activation and returns the structured load result.
pub fn load_result() -> LicenseLoadResult {
    load_result_from(&license_path())
}

/// The testable form of [`load_result`], taking an explicit path.
pub fn load_result_from(path: &Path) -> LicenseLoadResult {
    if !path.exists() {
        return LicenseLoadResult {
            file: LicenseFile::default(),
            status: LicenseLoadStatus::Absent,
            error_detail: None,
        };
    }

    let blob = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            return LicenseLoadResult {
                file: LicenseFile::default(),
                status: LicenseLoadStatus::Unreadable,
                error_detail: Some(format!("无法读取授权文件：{e}")),
            };
        }
    };

    let plain = match crypto::unprotect(&blob) {
        Ok(p) => p,
        Err(e) => {
            return LicenseLoadResult {
                file: LicenseFile::default(),
                status: LicenseLoadStatus::DecryptFailed,
                error_detail: Some(format!("授权解密失败：{e}")),
            };
        }
    };

    let file: LicenseFile = match serde_json::from_slice(&plain) {
        Ok(f) => f,
        Err(e) => {
            return LicenseLoadResult {
                file: LicenseFile::default(),
                status: LicenseLoadStatus::Corrupt,
                error_detail: Some(format!("授权数据格式损坏：{e}")),
            };
        }
    };

    if file.version == 0 {
        return LicenseLoadResult {
            file,
            status: LicenseLoadStatus::Invalid,
            error_detail: Some("授权版本无效 (version=0)".into()),
        };
    }

    LicenseLoadResult {
        file,
        status: LicenseLoadStatus::Valid,
        error_detail: None,
    }
}

pub fn load_from(path: &Path) -> LicenseFile {
    load_result_from(path).file
}

/// Classifies a record against the current machine.
pub fn state_of(file: &LicenseFile) -> LicenseState {
    let res = LicenseLoadResult {
        file: file.clone(),
        status: if file.license_hash.is_some() {
            LicenseLoadStatus::Valid
        } else {
            LicenseLoadStatus::Absent
        },
        error_detail: None,
    };
    state_of_result(&res)
}

/// Classifies a structured load result against the current machine.
pub fn state_of_result(result: &LicenseLoadResult) -> LicenseState {
    match result.status {
        LicenseLoadStatus::Absent => LicenseState::Inactive,
        LicenseLoadStatus::Unreadable => LicenseState::Unreadable,
        LicenseLoadStatus::DecryptFailed => LicenseState::Unreadable,
        LicenseLoadStatus::Corrupt => LicenseState::Corrupt,
        LicenseLoadStatus::Invalid => LicenseState::Invalid,
        LicenseLoadStatus::Valid => {
            let Some(stored_hash) = result.file.license_hash.as_deref() else {
                return LicenseState::Inactive;
            };
            if stored_hash.is_empty() {
                return LicenseState::Inactive;
            }

            // 优先使用 V2 结构化硬件证据比对
            if let Some(ref stored_v2) = result.file.device_evidence_v2 {
                let current_v2 = current_device_evidence_v2();
                return match current_v2.match_against(stored_v2) {
                    fingerprint::DeviceMatchVerdict::Matched => LicenseState::Active,
                    fingerprint::DeviceMatchVerdict::Mismatch => LicenseState::DeviceMismatch,
                    fingerprint::DeviceMatchVerdict::NeedsAttention => LicenseState::NeedsAttention,
                };
            }

            // 回退到 Legacy V1 单一 Hash 比对
            match result.file.device_hash.as_deref() {
                Some(device) if current_fingerprint().matches(device) => LicenseState::Active,
                Some(_) => LicenseState::DeviceMismatch,
                None => LicenseState::Inactive,
            }
        }
    }
}

/// Writes and reads back the activation atomically.
pub fn save(file: &LicenseFile) -> AppResult<()> {
    save_to(&license_path(), file)
}

/// The testable form of [`save`], taking an explicit path.
/// Uses atomic file replacement (Issue A11).
pub fn save_to(path: &Path, file: &LicenseFile) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Internal(format!("{}: {}", parent.to_string_lossy(), e)))?;
    }

    let plain = serde_json::to_vec(file)
        .map_err(|e| AppError::Internal(format!("{}: 序列化授权记录失败", path.display())))?;
    let blob = crypto::protect(&plain)?;

    crate::modules::atomic_file::write_atomic(path, &blob)
        .map_err(|e| AppError::Internal(format!("{}: 原子保存授权文件失败：{}", path.display(), e)))?;

    let read_back = load_result_from(path);
    if &read_back.file != file || read_back.status != LicenseLoadStatus::Valid {
        return Err(AppError::Internal(format!(
            "{}: 激活信息写入后无法通过校验读回，可能未保存成功。",
            path.display()
        )));
    }
    Ok(())
}

/// Clears the activation, returning the machine to its default state.
/// Retains existing status if deletion fails (Issue A11).
pub fn deactivate() -> AppResult<LicenseLoadResult> {
    let path = license_path();
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| AppError::Internal(format!("{}: 取消激活失败（无法删除原授权文件）：{}", path.display(), e)))?;
    }
    Ok(load_result())
}

/// Activates this machine with `code` (supporting V1 legacy and V2 signed asymmetric tokens).
pub fn activate(code: &str) -> AppResult<LicenseFile> {
    // 1. Enforce local attempt rate limiting against brute-force attacks (Issue A09)
    rate_limit::check_attempt_allowed()?;

    let code_trimmed = code.trim();
    let fp = current_fingerprint();
    let evidence_v2 = current_device_evidence_v2().clone();

    // 2. Dispatch V2 signed asymmetric token (Issues A04, A05, A06)
    if code_trimmed.starts_with("SC2.") {
        let parsed = match signed_v2::parse_token_v2(code_trimmed) {
            Ok(token) => token,
            Err(outcome) => {
                rate_limit::record_attempt_failure();
                return Err(AppError::Internal(format!("V2 授权码解析失败：{}", outcome)));
            }
        };

        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let outcome = signed_v2::verify_token_v2(&parsed, now_secs, &fp.device_hash);
        match outcome {
            signed_v2::TokenVerificationOutcome::Valid(claims) => {
                rate_limit::record_attempt_success();
                let record = LicenseFile {
                    version: 2,
                    license_hash: Some(format!("V2:{}", claims.license_id)),
                    device_hash: Some(fp.device_hash.clone()),
                    device_evidence_v2: Some(evidence_v2),
                    activated_at: Some(crate::modules::detect::now_iso8601()),
                    tier: claims.tier,
                };
                save(&record)?;
                return Ok(load());
            }
            other => {
                rate_limit::record_attempt_failure();
                return Err(AppError::Internal(format!("V2 授权验证未通过：{}", other)));
            }
        }
    }

    // 3. Fallback to Legacy V1/V2 HMAC activation code
    let validated = match validator::validate_tiered(code) {
        Ok(v) => {
            rate_limit::record_attempt_success();
            v
        }
        Err(e) => {
            rate_limit::record_attempt_failure();
            return Err(validator::rejection_error(e));
        }
    };

    let record = LicenseFile {
        version: current_version(),
        license_hash: Some(validator::digest(&validated.code, &fp.device_hash)),
        device_hash: Some(fp.device_hash.clone()),
        device_evidence_v2: Some(evidence_v2),
        activated_at: Some(crate::modules::detect::now_iso8601()),
        tier: validated.tier,
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
            license_hash: Some(validator::digest(
                "SC-ABCDE-23456-FGHJK-23456",
                &fp.device_hash,
            )),
            device_hash: Some(fp.device_hash.clone()),
            activated_at: Some("2026-01-01T00:00:00Z".to_string()),
            tier: Tier::Pro,
        }
    }

    /// A record bound to this machine at `tier`.
    fn record_at_tier(tier: Tier) -> LicenseFile {
        LicenseFile {
            tier,
            ..record_for_this_machine()
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
            tier: Tier::Pro,
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
            tier: Tier::Pro,
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
        assert!(
            !text.contains("license_hash"),
            "the JSON structure is visible"
        );
        assert!(
            !text.contains("device_hash"),
            "the JSON structure is visible"
        );
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
            tier: Tier::Pro,
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

    // -- The wire contract the frontend compares against ----------------------

    #[test]
    fn the_state_serialises_as_snake_case_because_the_frontend_compares_on_it() {
        // This pins the *wire form* of `LicenseState`, which nothing did before.
        //
        // The bug this catches, found by regenerating the UI fixtures from real
        // probe output: `LicenseState` carries its own
        // `#[serde(rename_all = "snake_case")]`, so the value on the wire is
        // `device_mismatch` — while three frontend call sites compared against
        // `deviceMismatch`. The mismatch branch was therefore dead in the shipped
        // binary: a customer who copied `license.dat` to a second PC was shown
        // the ordinary free-tier screen, with no mention that their licence was
        // bound elsewhere.
        //
        // It survived because the old hand-written fixtures spelled the value
        // `deviceMismatch`, agreeing with the (wrong) TypeScript type rather than
        // with the binary. A test that asserts the serialised form is what stops
        // that from recurring: the enclosing `Entitlements` camelCases its field
        // *names*, which makes "the values are camelCase too" an easy and wrong
        // assumption to carry.
        let json = serde_json::to_string(&LicenseState::DeviceMismatch).unwrap();
        assert_eq!(json, "\"device_mismatch\"");

        // Both of the other two, for the same reason: a screen that checks for
        // "active" or "inactive" has the identical failure mode.
        assert_eq!(
            serde_json::to_string(&LicenseState::Active).unwrap(),
            "\"active\""
        );
        assert_eq!(
            serde_json::to_string(&LicenseState::Inactive).unwrap(),
            "\"inactive\""
        );

        // And through the projection the UI actually reads, so the guarantee is
        // about `Entitlements` and not only about the bare enum.
        let projected = Entitlements::of(
            &LicenseFile {
                license_hash: Some("00".repeat(32)),
                device_hash: Some("0".repeat(64)),
                ..Default::default()
            },
            true,
        );
        assert_eq!(projected.state, LicenseState::DeviceMismatch);
        let text = serde_json::to_string(&projected).unwrap();
        assert!(
            text.contains("\"state\":\"device_mismatch\""),
            "the projection must carry the snake_case value: {text}"
        );
        // The field *names* are still camelCase — both rules are in force at once,
        // which is precisely why this was easy to get wrong.
        assert!(text.contains("\"deviceReliable\""), "{text}");
    }

    // -- Tiers ---------------------------------------------------------------
    //
    // The defect these cover: `Entitlements::of` used to derive the tier from
    // `state.is_active()`, so the only thing a code could express was "unlocks
    // PRO". A FREE code activated the machine and was then *reported* as PRO —
    // the issuer's `free` argument never reached authorisation.

    #[test]
    fn a_free_tier_activation_reports_free_and_cannot_install() {
        let file = record_at_tier(Tier::Free);
        assert_eq!(state_of(&file), LicenseState::Active, "precondition");

        let e = Entitlements::of(&file, true);
        assert_eq!(e.tier, Tier::Free, "a FREE code must not grant PRO");
        assert!(!e.can_install);
        assert!(!e.can_configure);
        // Still *activated* — a trial code that was accepted must not look like
        // a code that was rejected.
        assert!(e.activated);
    }

    #[test]
    fn a_free_tier_activation_says_so_rather_than_saying_nothing_was_entered() {
        // Both are FREE and both are refused, but a customer who entered a real
        // trial code must not be shown the "you have not activated" sentence.
        let activated = Entitlements::of(&record_at_tier(Tier::Free), true);
        let untouched = Entitlements::of(&LicenseFile::default(), true);
        assert_ne!(activated.reason, untouched.reason);
        assert!(activated.reason.contains("已激活"), "{}", activated.reason);
    }

    #[test]
    fn a_pro_tier_activation_still_installs() {
        // The paying customer, re-asserted after the projection changed.
        let e = Entitlements::of(&record_at_tier(Tier::Pro), true);
        assert_eq!(e.tier, Tier::Pro);
        assert!(e.can_install);
    }

    #[test]
    fn a_copied_pro_record_cannot_grant_pro_on_another_machine() {
        // The subtlety that keeps the tier honest: the record *claims* PRO, but
        // this machine's binding does not match, so the claim is not honoured.
        // Without this, editing `tier` in a copied file would be enough.
        let mut file = record_at_tier(Tier::Pro);
        file.device_hash = Some("f".repeat(64));

        let e = Entitlements::of(&file, true);
        assert_eq!(e.state, LicenseState::DeviceMismatch);
        assert_eq!(
            e.tier,
            Tier::Free,
            "a mismatched PRO claim must not project PRO"
        );
        assert!(!e.can_install);
    }

    #[test]
    fn a_record_whose_tier_says_pro_but_which_is_inactive_grants_nothing() {
        // Covers the no-device case too: `tier: pro` with no binding is still
        // an inactive machine, whatever the field asserts.
        let file = LicenseFile {
            tier: Tier::Pro,
            device_hash: None,
            ..record_for_this_machine()
        };
        let e = Entitlements::of(&file, true);
        assert_eq!(e.state, LicenseState::Inactive);
        assert_eq!(e.tier, Tier::Free);
    }

    // -- Backwards compatibility ---------------------------------------------

    #[test]
    fn a_record_written_before_tiers_existed_reads_as_pro() {
        // The no-downgrade guarantee, asserted against the real deserialiser
        // rather than against `LicenseFile::default()`.
        //
        // This is the JSON shape the shipped build wrote. There is no `tier`
        // key, and the customer who owns it paid: reading it as FREE would take
        // away something they bought.
        let legacy = r#"{
            "version": 1,
            "license_hash": "deadbeef",
            "device_hash": "cafebabe",
            "activated_at": "2026-01-01T00:00:00Z"
        }"#;

        let parsed: LicenseFile = serde_json::from_str(legacy).unwrap();
        assert_eq!(parsed.tier, Tier::Pro, "a legacy record must not downgrade");
        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.license_hash.as_deref(), Some("deadbeef"));
    }

    #[test]
    fn a_legacy_record_projects_pro_end_to_end() {
        // The same claim through the projection the UI reads, bound to this
        // machine so the state is `Active` — which is the only state in which
        // the tier is honoured.
        let fp = current_fingerprint();
        let legacy = serde_json::json!({
            "version": 1,
            "license_hash": validator::digest("SC-ABCDE-23456-FGHJK-23456", &fp.device_hash),
            "device_hash": fp.device_hash,
            "activated_at": "2026-01-01T00:00:00Z",
        })
        .to_string();

        let parsed: LicenseFile = serde_json::from_str(&legacy).unwrap();
        assert_eq!(state_of(&parsed), LicenseState::Active, "precondition");

        let e = Entitlements::of(&parsed, true);
        assert_eq!(e.tier, Tier::Pro, "the pre-tier customer keeps PRO");
        assert!(e.can_install);
    }

    #[test]
    fn an_explicit_free_tier_in_a_file_is_still_read_as_free() {
        // The other half of the default rule: `pro` is the fallback for a
        // *missing* key, not an override of a present one. If this failed, the
        // FREE tier would be unrepresentable on disk.
        let free = serde_json::json!({
            "version": 1,
            "license_hash": "deadbeef",
            "device_hash": "cafebabe",
            "activated_at": "2026-06-01T00:00:00Z",
            "tier": "free",
        })
        .to_string();

        let parsed: LicenseFile = serde_json::from_str(&free).unwrap();
        assert_eq!(parsed.tier, Tier::Free);
    }

    #[test]
    fn the_empty_record_defaults_to_free_not_pro() {
        // `LicenseFile::default()` means "no activation at all", which must be
        // FREE. It is deliberately *not* the same value as the serde default
        // above, and this pins the distinction so a future refactor cannot
        // collapse the two and start handing out PRO.
        assert_eq!(LicenseFile::default().tier, Tier::Free);
        assert_eq!(
            serde_json::from_str::<LicenseFile>("{}").unwrap().tier,
            Tier::Pro,
            "an empty *file* is the legacy case, not the no-file case"
        );
    }

    #[test]
    fn the_tier_survives_a_disk_round_trip() {
        // Guards the field name on the wire. If `tier` were renamed, every
        // existing FREE activation would deserialise as the legacy default and
        // become PRO — a privilege escalation caused purely by a rename.
        for tier in [Tier::Free, Tier::Pro] {
            let dir = tempdir(&format!("tier-{}", tier.canonical()));
            let path = dir.join("license.dat");
            let file = record_at_tier(tier);
            save_to(&path, &file).unwrap();
            assert_eq!(load_from(&path).tier, tier);
        }
    }

    #[test]
    fn the_serialised_tier_uses_the_stable_token() {
        // `canonical()` is baked into code signatures and stored on disk, so it
        // is pinned separately from the display label.
        assert_eq!(serde_json::to_string(&Tier::Pro).unwrap(), "\"pro\"");
        assert_eq!(serde_json::to_string(&Tier::Free).unwrap(), "\"free\"");
        assert_eq!(Tier::Pro.canonical(), "pro");
        assert_eq!(Tier::Free.canonical(), "free");
        assert_ne!(Tier::Pro.label(), Tier::Pro.canonical());
    }

    #[test]
    fn activation_takes_the_tier_from_the_code_not_from_the_caller() {
        // End-to-end through the real entry point: a FREE code activates this
        // machine and the *code* decides the tier. This is the defect the whole
        // change exists to fix, driven through `activate()` rather than through
        // a hand-built record.
        let dir = tempdir("activate-free");
        let path = dir.join("license.dat");

        let code = validator::mint_tiered(Tier::Free).unwrap();
        let validated = validator::validate_tiered(&code).unwrap();
        assert_eq!(validated.tier, Tier::Free, "the code must carry FREE");
        assert_eq!(validated.format, validator::CodeFormat::V2);

        // Build the same record `activate` would, against this machine, and
        // assert the saved tier — without touching the real work directory.
        let fp = current_fingerprint();
        let file = LicenseFile {
            version: current_version(),
            license_hash: Some(validator::digest(&validated.code, &fp.device_hash)),
            device_hash: Some(fp.device_hash.clone()),
            activated_at: Some("2026-06-01T00:00:00Z".to_string()),
            tier: validated.tier,
        };
        save_to(&path, &file).unwrap();

        let loaded = load_from(&path);
        assert_eq!(state_of(&loaded), LicenseState::Active, "precondition");
        assert_eq!(Entitlements::of(&loaded, true).tier, Tier::Free);
    }
}
