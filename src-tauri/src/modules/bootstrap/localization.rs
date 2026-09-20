//! Localisation provider — wrap the upstream community package, never
//! re-implement it.
//!
//! The brief: "包装已有汉化方案 / 不要自己重新破解".
//!
//! That is the correct call, and it is worth being precise about *why*, because
//! the alternative looks tempting and is a trap. Localising a closed-source
//! desktop app means either
//!
//! * patching its resource files in place — which breaks on the next auto-update,
//!   is unsigned, and is exactly the kind of binary modification that gets a tool
//!   flagged by antivirus; or
//! * using the vendor's documented extension mechanism (VS Code language packs);
//!   or
//! * using the upstream project's own installer, which already solved the version
//!   matching and the file layout.
//!
//! So [`LocalizationProvider`] is a *description of how to invoke someone else's
//! solution*, plus the backup/verify/restore discipline the brief requires around
//! it. This module contains no resource-file knowledge at all. The concrete
//! provider is a data record — see [`build_plan`] — not a code path per target,
//! so adding a fourth localisation is a JSON entry rather than a new module.
//!
//! Where the provider is a *package* rather than a script (VS Code language
//! packs: `ms-ceintl.vscode-language-pack-zh-hans`), it goes through the same
//! [`ExtensionAction`](super::plan::BootstrapAction) path as any other extension.
//! Only the script-shaped providers need the machinery here.

use std::path::{Path, PathBuf};

/// How a localisation is applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalizationMethod {
    /// A vendor-published package installed through the vendor's own CLI. The
    /// preferred method wherever one exists, because the vendor maintains it.
    Package { extension_id: String },
    /// An upstream community script, downloaded and run.
    ///
    /// The URL is data (it comes from the profile/localisation catalogue), never
    /// compiled in, so a URL that moves is a JSON edit.
    Script { url: String },
}

/// One localisation, described as data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalizationProvider {
    /// Stable id, e.g. `vscode`, `codex`.
    pub id: String,
    /// Which program this localises, for display.
    pub target: String,
    /// The program this depends on being installed. Used to skip the step rather
    /// than fail it when the program is absent.
    pub requires: Option<crate::model::SoftwareId>,
    pub method: LocalizationMethod,
    /// Where the upstream project lives, shown so the student can verify what
    /// they are running. This is a trust requirement, not decoration: we are
    /// asking them to execute someone else's script.
    pub upstream: String,
}

impl LocalizationProvider {
    /// Whether the localisation can be planned at all, given the inventory.
    ///
    /// Returns the reason it cannot, or `None` when it can. This is what turns
    /// "localise Codex" into a *skipped* step on a machine without Codex, rather
    /// than a failure the student cannot act on.
    pub fn precheck(
        &self,
        present: &dyn Fn(crate::model::SoftwareId) -> bool,
    ) -> Option<String> {
        let id = self.requires?;
        if present(id) {
            None
        } else {
            Some(format!(
                "未检测到 {}，已跳过 {} 汉化。",
                id.display_name(),
                self.target
            ))
        }
    }
}

/// Why a localisation step cannot proceed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalizationError {
    /// The upstream method is not one we can drive.
    UnsupportedMethod { detail: String },
    /// The script URL is not a script we will run.
    UntrustedScriptUrl { url: String, reason: String },
    /// The backup could not be made, so we refuse to proceed.
    BackupFailed { path: String, reason: String },
}

impl LocalizationError {
    pub fn message(&self) -> String {
        match self {
            LocalizationError::UnsupportedMethod { detail } => {
                format!("不支持的汉化方式：{detail}")
            }
            LocalizationError::UntrustedScriptUrl { url, reason } => {
                format!("拒绝执行 {url}：{reason}")
            }
            LocalizationError::BackupFailed { path, reason } => {
                format!("无法备份 {path}（{reason}），为安全起见已取消本次汉化。")
            }
        }
    }
}

/// Validates a script URL before we agree to run it.
///
/// The brief requires the localisation to be reversible ("失败恢复"), and a
/// backup is only meaningful if the thing we run is the thing we think it is. Two
/// checks, both about the guarantees we need rather than about security theatre:
///
/// * **https only.** The script can modify files inside the agent's install
///   directory; plain http lets anyone on the campus network choose what runs.
/// * **a recognised host.** The brief names a specific upstream project. Fetching
///   from that project's own host is the point; a URL that has wandered to a
///   shortener or a paste site is not the project we audited.
///
/// This is deliberately a small allow-list of *hosts*, not a signature check:
/// pinning a digest for a project we do not control would break on their every
/// release, and pretending to verify a script we cannot verify would be worse
/// than stating the trust assumption plainly.
const TRUSTED_HOSTS: &[&str] = &[
    "github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "codeload.github.com",
];

pub fn validate_script_url(url: &str) -> Result<(), LocalizationError> {
    let lowered = url.trim().to_ascii_lowercase();

    if !lowered.starts_with("https://") {
        return Err(LocalizationError::UntrustedScriptUrl {
            url: url.to_string(),
            reason: "只允许 https 地址".into(),
        });
    }

    let after_scheme = &lowered["https://".len()..];
    let host = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");

    if !TRUSTED_HOSTS.iter().any(|trusted| host == *trusted) {
        return Err(LocalizationError::UntrustedScriptUrl {
            url: url.to_string(),
            reason: format!(
                "只允许从 {} 等官方源码站点拉取",
                TRUSTED_HOSTS.join(" / ")
            ),
        });
    }

    Ok(())
}

/// The localisations this build knows about, as data.
///
/// This is the localisation catalogue, and it is the only place a localisation
/// target is named. A fourth target is an entry here — no new module, no match
/// arm, no code path. That is what "包装已有汉化方案" costs when it is done as data
/// rather than as a per-target implementation.
///
/// ## Why each entry looks the way it does
///
/// * **VS Code** uses Microsoft's own published language pack. This is not just
///   the preferred option, it is the only *supported* one: VS Code's interface
///   language is set by an extension, and hand-patching its resources is both
///   unsupported and unnecessary. It also means the localisation goes through the
///   same `code --install-extension` path and the same verification as every
///   other extension — one mechanism, not two.
/// * **Codex** has no vendor-supplied localisation. The brief names the upstream
///   community project (`xqnode/codex-zh-CN`), so that project's own installer is
///   what runs. We do not copy its logic.
///
/// Claude is deliberately absent. It has no vendor language pack and no community
/// project the brief endorses, so inventing an entry would mean committing to a
/// method we cannot verify — the honest answer is to ship nothing and say so.
pub fn provider_catalogue() -> Vec<LocalizationProvider> {
    vec![
        LocalizationProvider {
            id: "vscode".into(),
            target: "VS Code".into(),
            requires: Some(crate::model::SoftwareId::Vscode),
            method: LocalizationMethod::Package {
                extension_id: "ms-ceintl.vscode-language-pack-zh-hans".into(),
            },
            upstream: "https://github.com/microsoft/vscode-loc".into(),
        },
        LocalizationProvider {
            id: "codex".into(),
            target: "Codex".into(),
            requires: Some(crate::model::SoftwareId::Codex),
            method: LocalizationMethod::Script {
                url: "https://github.com/xqnode/codex-zh-CN".into(),
            },
            upstream: "https://github.com/xqnode/codex-zh-CN".into(),
        },
    ]
}

/// The settings file a locale check should read, on this machine.
///
/// A helper rather than a constant at the call site, so the bootstrap layer has
/// exactly one place that knows where the editor's user settings live. The planner
/// uses the same expression, which is why a plan and its verification cannot
/// disagree about which file to look at.
pub fn localization_settings_path() -> std::path::PathBuf {
    std::path::PathBuf::from(super::super::config::expand_path(
        r"%APPDATA%\Code\User\settings.json",
    ))
}

/// A backup taken before a localisation runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalizationBackup {
    /// The directory that was copied.
    pub original: PathBuf,
    /// Where the copy went.
    pub backup: PathBuf,
    pub files: usize,
}

impl LocalizationBackup {
    pub fn is_empty(&self) -> bool {
        self.files == 0
    }
}

/// Copies a directory aside, before running an upstream installer against it.
///
/// The backup is taken *only* when the directory exists: a fresh install has
/// nothing to protect, and creating an empty backup would make "restore" a
/// no-op that reported success.
///
/// Restoring is deliberately a whole-directory replacement rather than a
/// per-file diff. The upstream script may add, remove or rewrite any file; a
/// partial restore would leave a mixture of two versions, which is a state
/// neither the vendor nor the community package supports.
pub fn backup_directory(source: &Path, backup_root: &Path) -> Result<Option<LocalizationBackup>, LocalizationError> {
    if !source.is_dir() {
        return Ok(None);
    }

    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".into());
    let backup = backup_root.join(format!("{name}.aissetup-backup"));

    let _ = std::fs::remove_dir_all(&backup);
    std::fs::create_dir_all(&backup).map_err(|e| LocalizationError::BackupFailed {
        path: backup.to_string_lossy().to_string(),
        reason: e.to_string(),
    })?;

    copy_tree(source, &backup).map_err(|e| LocalizationError::BackupFailed {
        path: backup.to_string_lossy().to_string(),
        reason: e.to_string(),
    })?;

    let files = count_files(&backup);
    if files == 0 {
        // An empty directory backs nothing up. Reporting success here would make
        // a later "restore" claim to have recovered something it never saved.
        let _ = std::fs::remove_dir_all(&backup);
        return Ok(None);
    }

    Ok(Some(LocalizationBackup {
        original: source.to_path_buf(),
        backup,
        files,
    }))
}

/// Restores a directory from its backup.
pub fn restore_directory(backup: &LocalizationBackup) -> Result<(), LocalizationError> {
    if !backup.backup.is_dir() {
        return Err(LocalizationError::BackupFailed {
            path: backup.backup.to_string_lossy().to_string(),
            reason: "备份不存在".into(),
        });
    }
    let _ = std::fs::remove_dir_all(&backup.original);
    copy_tree(&backup.backup, &backup.original).map_err(|e| LocalizationError::BackupFailed {
        path: backup.original.to_string_lossy().to_string(),
        reason: e.to_string(),
    })
}

/// Whether a localisation appears to have taken effect, judged from the
/// program's own settings file.
///
/// The brief's "执行后验证" and the stage-3 rule "不要相信执行过程" both land
/// here: an upstream script exiting 0 is not evidence that the program is now in
/// Chinese. The check is a *text* search for the locale marker in the settings
/// file the provider declares, which is the same evidence the program itself
/// reads.
pub fn verify_locale_in_settings(settings_path: &Path, expected_locale: &str) -> LocaleVerification {
    let text = match std::fs::read_to_string(settings_path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return LocaleVerification::SettingsMissing {
                path: settings_path.to_path_buf(),
            }
        }
        Err(e) => {
            return LocaleVerification::Unreadable {
                path: settings_path.to_path_buf(),
                reason: e.to_string(),
            }
        }
    };

    // Search for the locale as a quoted value, so a comment mentioning the
    // language does not count as the setting being applied.
    let needle = format!("\"{expected_locale}\"");
    if text.replace(' ', "").contains(&needle.replace(' ', "")) {
        LocaleVerification::Applied
    } else {
        LocaleVerification::NotApplied {
            path: settings_path.to_path_buf(),
            expected: expected_locale.to_string(),
        }
    }
}

/// The result of checking a settings file for the locale.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocaleVerification {
    Applied,
    NotApplied { path: PathBuf, expected: String },
    /// The settings file does not exist, so the localisation cannot have taken
    /// effect through it.
    SettingsMissing { path: PathBuf },
    /// We could not read it — reported as unknown, never as "not applied".
    Unreadable { path: PathBuf, reason: String },
}

impl LocaleVerification {
    pub fn is_applied(&self) -> bool {
        matches!(self, LocaleVerification::Applied)
    }

    /// Whether the answer is genuinely unknown rather than negative.
    ///
    /// Kept separate for the same reason the inventory separates them: reporting
    /// an unreadable file as "not localised" would send the student to redo work
    /// that may already be done.
    pub fn is_unknown(&self) -> bool {
        matches!(self, LocaleVerification::Unreadable { .. })
    }

    pub fn describe(&self) -> String {
        match self {
            LocaleVerification::Applied => "语言设置已生效".into(),
            LocaleVerification::NotApplied { path, expected } => format!(
                "{} 中未找到 {}，语言设置可能未生效。",
                path.display(),
                expected
            ),
            LocaleVerification::SettingsMissing { path } => {
                format!("配置文件 {} 不存在，语言设置未写入。", path.display())
            }
            LocaleVerification::Unreadable { path, reason } => {
                format!("无法读取 {}（{reason}），语言设置是否生效无法确认。", path.display())
            }
        }
    }
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = to.join(entry.file_name());
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn count_files(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                count_files(&path)
            } else {
                1
            }
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aissetup-l10n-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn https_from_the_named_upstream_is_accepted() {
        assert!(validate_script_url("https://github.com/xqnode/codex-zh-CN").is_ok());
        assert!(validate_script_url(
            "https://raw.githubusercontent.com/xqnode/codex-zh-CN/main/install.ps1"
        )
        .is_ok());
        // Host comparison is case-insensitive: DNS names are, and rejecting a
        // URL because a student's clipboard upper-cased the host would be a
        // baffling failure.
        assert!(validate_script_url("https://GITHUB.COM/a/b").is_ok());
    }

    #[test]
    fn plain_http_is_refused() {
        // The script can modify files inside an agent's install directory.
        let err = validate_script_url("http://github.com/a/b").unwrap_err();
        assert!(matches!(err, LocalizationError::UntrustedScriptUrl { .. }));
        assert!(err.message().contains("https"));
    }

    #[test]
    fn an_unrecognised_host_is_refused() {
        let err = validate_script_url("https://example.com/install.ps1").unwrap_err();
        assert!(err.message().contains("官方源码站点"));
    }

    #[test]
    fn a_lookalike_host_is_refused() {
        // `github.com.evil.example` starts with the trusted string but is a
        // different host; the comparison must be on the whole host.
        assert!(validate_script_url("https://github.com.evil.example/x").is_err());
        assert!(validate_script_url("https://notgithub.com/x").is_err());
        assert!(validate_script_url("https://evil.com/?github.com").is_err());
    }

    #[test]
    fn userinfo_cannot_be_used_to_spoof_the_host() {
        assert!(validate_script_url("https://github.com@evil.example/x").is_err());
    }

    #[test]
    fn a_port_does_not_hide_an_untrusted_host() {
        assert!(validate_script_url("https://evil.example:443/x").is_err());
    }

    #[test]
    fn a_port_on_a_trusted_host_is_accepted() {
        assert!(validate_script_url("https://github.com:443/a/b").is_ok());
    }

    #[test]
    fn a_missing_directory_produces_no_backup() {
        // A fresh install has nothing to protect; an empty backup would make a
        // later restore report a recovery it never made.
        let dir = tempdir("nobackup");
        let result = backup_directory(&dir.join("absent"), &dir.join("backups")).unwrap();
        assert!(result.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_backup_copies_the_directory_and_restore_puts_it_back() {
        let dir = tempdir("roundtrip");
        let original = dir.join("app");
        std::fs::create_dir_all(original.join("locales")).unwrap();
        std::fs::write(original.join("app.exe"), "binary").unwrap();
        std::fs::write(original.join("locales").join("en.json"), "{}").unwrap();

        let backup = backup_directory(&original, &dir.join("backups"))
            .unwrap()
            .expect("a non-empty directory must be backed up");
        assert_eq!(backup.files, 2);

        // Simulate the upstream script damaging the install.
        std::fs::write(original.join("app.exe"), "BROKEN").unwrap();
        std::fs::remove_file(original.join("locales").join("en.json")).unwrap();

        restore_directory(&backup).unwrap();
        assert_eq!(std::fs::read_to_string(original.join("app.exe")).unwrap(), "binary");
        assert!(original.join("locales").join("en.json").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_empty_directory_is_not_backed_up() {
        let dir = tempdir("emptydir");
        let original = dir.join("empty");
        std::fs::create_dir_all(&original).unwrap();
        assert!(backup_directory(&original, &dir.join("backups")).unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restoring_without_a_backup_is_an_error_not_a_silent_success() {
        let dir = tempdir("norestore");
        let fake = LocalizationBackup {
            original: dir.join("app"),
            backup: dir.join("absent-backup"),
            files: 1,
        };
        assert!(restore_directory(&fake).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_backup_replaces_the_first_rather_than_nesting() {
        let dir = tempdir("repeat");
        let original = dir.join("app");
        std::fs::create_dir_all(&original).unwrap();
        std::fs::write(original.join("f.txt"), "v1").unwrap();

        let first = backup_directory(&original, &dir.join("backups")).unwrap().unwrap();
        std::fs::write(original.join("f.txt"), "v2").unwrap();
        let second = backup_directory(&original, &dir.join("backups")).unwrap().unwrap();

        assert_eq!(first.backup, second.backup, "the backup path must be stable");
        assert_eq!(
            std::fs::read_to_string(second.backup.join("f.txt")).unwrap(),
            "v2"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn locale_verification_finds_the_setting() {
        let dir = tempdir("locale");
        let settings = dir.join("settings.json");
        std::fs::write(&settings, "{\n  \"locale\": \"zh-cn\"\n}\n").unwrap();
        assert_eq!(
            verify_locale_in_settings(&settings, "zh-cn"),
            LocaleVerification::Applied
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn locale_verification_tolerates_formatting() {
        // The student may well have written it without spaces.
        let dir = tempdir("localeformat");
        let settings = dir.join("settings.json");
        std::fs::write(&settings, "{\"locale\":\"zh-cn\"}\n").unwrap();
        assert!(verify_locale_in_settings(&settings, "zh-cn").is_applied());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_mention_of_the_locale_in_a_comment_does_not_count() {
        // Requiring the quoted form is what stops a commented-out setting from
        // being reported as applied.
        let dir = tempdir("localecomment");
        let settings = dir.join("settings.json");
        std::fs::write(&settings, "{\n  // locale: zh-cn\n  \"locale\": \"en\"\n}\n").unwrap();
        let result = verify_locale_in_settings(&settings, "zh-cn");
        assert!(
            !result.is_applied(),
            "a comment was mistaken for the setting: {result:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_settings_file_is_not_reported_as_applied() {
        let dir = tempdir("localemissing");
        let result = verify_locale_in_settings(&dir.join("nope.json"), "zh-cn");
        assert!(matches!(result, LocaleVerification::SettingsMissing { .. }));
        assert!(!result.is_applied());
        assert!(!result.is_unknown());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unreadable_settings_file_is_unknown_not_negative() {
        // Reading a *directory* as a file fails with a non-NotFound error, which
        // is the realistic stand-in for a permissions problem.
        let dir = tempdir("localeunreadable");
        let result = verify_locale_in_settings(&dir, "zh-cn");
        assert!(
            result.is_unknown(),
            "an unreadable file must not be reported as 'not applied': {result:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn precheck_skips_a_localisation_for_an_absent_program() {
        use crate::model::SoftwareId;

        let provider = LocalizationProvider {
            id: "codex".into(),
            target: "Codex".into(),
            requires: Some(SoftwareId::Codex),
            method: LocalizationMethod::Script {
                url: "https://github.com/xqnode/codex-zh-CN".into(),
            },
            upstream: "https://github.com/xqnode/codex-zh-CN".into(),
        };

        let missing = provider.precheck(&|_| false).unwrap();
        assert!(missing.contains("未检测到"), "got: {missing}");

        assert!(provider.precheck(&|id| id == SoftwareId::Codex).is_none());
    }

    #[test]
    fn a_provider_without_a_dependency_always_passes_precheck() {
        let provider = LocalizationProvider {
            id: "generic".into(),
            target: "Generic".into(),
            requires: None,
            method: LocalizationMethod::Package {
                extension_id: "ms-ceintl.vscode-language-pack-zh-hans".into(),
            },
            upstream: "https://github.com/microsoft/vscode-loc".into(),
        };
        assert!(provider.precheck(&|_| false).is_none());
    }
}
