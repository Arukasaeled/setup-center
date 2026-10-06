//! Storage & Installation Policy Module
//!
//! Controls where Setup Center temporarily downloads installers and where
//! software is installed, distinguishing between temporary download cache
//! and final software installation locations.
//!
//! Three storage modes:
//! 1. SystemDefault: keeps standard OS/vendor/winget default paths.
//! 2. PreferSecondary: automatically finds an available non-system disk
//!    with sufficient space and writes to `<Drive>:\SetupCenterApps`.
//! 3. Custom: user specifies a custom folder root (e.g. `D:\Apps`).

use crate::model::*;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

/// Storage policy modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StorageMode {
    SystemDefault,
    PreferSecondary,
    Custom,
}

impl Default for StorageMode {
    fn default() -> Self {
        StorageMode::SystemDefault
    }
}

/// Capability of an application regarding custom install locations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallLocationSupport {
    /// Supports `winget install --location <target_path>`
    WingetLocation,
    /// Handled by vendor installer (GUI or interactive installer)
    InstallerManaged,
    /// System, Store, MSIX, WSL or Windows Terminal component
    SystemManaged,
    /// Node / npm / cargo / python / shell script managed
    ScriptManaged,
    /// Fixed default path (vendor installer ignores custom location without undocumented flags)
    FixedDefault,
}

impl Default for InstallLocationSupport {
    fn default() -> Self {
        InstallLocationSupport::FixedDefault
    }
}

/// The effective storage policy for installations.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoragePolicy {
    pub mode: StorageMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_drive: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
}

/// Minimum recommended free space for secondary drive (1 GiB).
pub const MIN_RECOMMENDED_FREE_BYTES: u64 = 1024 * 1024 * 1024;

/// Returns the system drive letter (e.g. "C:").
pub fn detect_system_drive() -> String {
    let work = super::detect::work_directory();
    let letter = work
        .to_string_lossy()
        .chars()
        .next()
        .unwrap_or('C')
        .to_ascii_uppercase();
    format!("{}:", letter)
}

/// Default download directory in AppData.
pub fn default_download_directory() -> PathBuf {
    super::detect::work_directory().join("downloads")
}

/// Resolves the download cache directory given the storage policy.
pub fn resolve_download_directory(policy: &StoragePolicy) -> PathBuf {
    if let Some(ref dl) = policy.download_root {
        PathBuf::from(dl)
    } else {
        default_download_directory()
    }
}

/// Resolves the storage policy against the detected machine disks.
pub fn resolve_storage_policy(
    disks: &[DiskInfo],
    mode: StorageMode,
    custom_root: Option<String>,
) -> StoragePolicy {
    let system_drive = detect_system_drive();
    resolve_storage_policy_with_system(disks, mode, custom_root, &system_drive)
}

/// Resolves the storage policy with an explicit system drive string (e.g. "C:").
pub fn resolve_storage_policy_with_system(
    disks: &[DiskInfo],
    mode: StorageMode,
    custom_root: Option<String>,
    system_drive: &str,
) -> StoragePolicy {
    let sys_prefix = system_drive
        .trim_end_matches(['\\', '/', ':'])
        .to_ascii_uppercase();
    let default_dl = default_download_directory().to_string_lossy().to_string();

    match mode {
        StorageMode::SystemDefault => StoragePolicy {
            mode: StorageMode::SystemDefault,
            custom_root: None,
            resolved_root: None,
            system_drive: Some(format!("{}:", sys_prefix)),
            download_root: Some(default_dl),
            fallback_reason: None,
        },

        StorageMode::PreferSecondary => {
            // Find non-system disk with sufficient free space and writable
            let mut candidates: Vec<&DiskInfo> = disks
                .iter()
                .filter(|d| {
                    let d_letter = d
                        .root
                        .chars()
                        .next()
                        .unwrap_or('C')
                        .to_ascii_uppercase();
                    let is_sys = d_letter.to_string() == sys_prefix;
                    !is_sys && d.writable && d.free_bytes >= MIN_RECOMMENDED_FREE_BYTES
                })
                .collect();

            // Sort by free space descending
            candidates.sort_by_key(|d| std::cmp::Reverse(d.free_bytes));

            if let Some(best) = candidates.first() {
                let letter = best
                    .root
                    .chars()
                    .next()
                    .unwrap_or('D')
                    .to_ascii_uppercase();
                let resolved = format!("{}:\\SetupCenterApps", letter);
                let download = format!("{}\\.setup-center\\downloads", resolved);
                StoragePolicy {
                    mode: StorageMode::PreferSecondary,
                    custom_root: None,
                    resolved_root: Some(resolved),
                    system_drive: Some(format!("{}:", sys_prefix)),
                    download_root: Some(download),
                    fallback_reason: None,
                }
            } else {
                StoragePolicy {
                    mode: StorageMode::PreferSecondary,
                    custom_root: None,
                    resolved_root: None,
                    system_drive: Some(format!("{}:", sys_prefix)),
                    download_root: Some(default_dl),
                    fallback_reason: Some(
                        "未检测到可用的其他磁盘，将使用系统默认位置。".into(),
                    ),
                }
            }
        }

        StorageMode::Custom => {
            let Some(raw_path) = custom_root else {
                return StoragePolicy {
                    mode: StorageMode::Custom,
                    custom_root: None,
                    resolved_root: None,
                    system_drive: Some(format!("{}:", sys_prefix)),
                    download_root: Some(default_dl),
                    fallback_reason: Some(
                        "未指定自定义安装路径，将使用系统默认位置。".into(),
                    ),
                };
            };

            match validate_custom_path(&raw_path, system_drive) {
                Ok(valid_path) => {
                    let download = format!("{}\\.setup-center\\downloads", valid_path);
                    StoragePolicy {
                        mode: StorageMode::Custom,
                        custom_root: Some(valid_path.clone()),
                        resolved_root: Some(valid_path),
                        system_drive: Some(format!("{}:", sys_prefix)),
                        download_root: Some(download),
                        fallback_reason: None,
                    }
                }
                Err(reason) => StoragePolicy {
                    mode: StorageMode::Custom,
                    custom_root: Some(raw_path),
                    resolved_root: None,
                    system_drive: Some(format!("{}:", sys_prefix)),
                    download_root: Some(default_dl),
                    fallback_reason: Some(format!("自定义路径不可用（{reason}），将使用系统默认位置。")),
                },
            }
        }
    }
}

/// Pure syntactic & security validator for custom folder paths.
pub fn validate_custom_path_syntax(path_str: &str, system_drive: &str) -> Result<String, String> {
    let trimmed = path_str.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err("路径不能为空".into());
    }

    if trimmed.starts_with(r"\\") {
        return Err("不支持网络路径或 UNC 路径".into());
    }

    if trimmed.contains(['<', '>', '"', '|', '?', '*']) {
        return Err("路径包含非法字符（不允许包含 < > \" | ? *）".into());
    }

    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() < 2 || !chars[0].is_ascii_alphabetic() || chars[1] != ':' {
        return Err("路径必须包含有效的盘符（如 D:\\SetupCenterApps）".into());
    }

    let drive_letter = chars[0].to_ascii_uppercase();
    let norm_sys_drive = system_drive
        .trim_end_matches(['\\', '/', ':'])
        .chars()
        .next()
        .unwrap_or('C')
        .to_ascii_uppercase();

    // Check system drive root directory: C:\ or C: is dangerous
    if drive_letter == norm_sys_drive {
        let after_colon = trimmed[2..].trim_matches(['\\', '/']);
        if after_colon.is_empty() {
            return Err("不允许直接使用系统盘根目录作为安装路径，请指定子目录（例如 C:\\SetupCenterApps）".into());
        }
    }

    let lower = trimmed.to_lowercase().replace('/', "\\");
    if lower.contains(r"\windows")
        || lower.contains(r"\system32")
        || lower.contains(r"\syswow64")
        || lower.contains(r"\program files")
        || lower.contains(r"\programdata")
        || lower.ends_with(r"\windows")
        || lower.ends_with(r"\system32")
    {
        return Err("不允许使用 Windows 或系统保留目录作为安装路径".into());
    }

    let normalized = trimmed.trim_end_matches(['\\', '/']).to_string();
    if normalized.len() == 2 && normalized.ends_with(':') {
        Ok(format!("{}:\\", drive_letter))
    } else {
        Ok(normalized)
    }
}

/// Full validator including filesystem accessibility checks.
pub fn validate_custom_path(path_str: &str, system_drive: &str) -> Result<String, String> {
    let valid_syntax = validate_custom_path_syntax(path_str, system_drive)?;
    let path = PathBuf::from(&valid_syntax);

    if path.exists() && path.is_file() {
        return Err("指定路径是一个已存在的文件，而不是目录".into());
    }

    let drive_letter = valid_syntax.chars().next().unwrap_or('C').to_ascii_uppercase();
    let drive_root = PathBuf::from(format!("{}:\\", drive_letter));
    if !drive_root.exists() {
        return Err(format!("磁盘 {}:\\ 不存在或当前不可用", drive_letter));
    }

    // Try creating or testing writability
    if path.exists() {
        let probe = path.join(".setup-center-write-test");
        match std::fs::write(&probe, b"ok") {
            Ok(_) => {
                let _ = std::fs::remove_file(&probe);
            }
            Err(e) => {
                return Err(format!("指定目录不可写：{e}"));
            }
        }
    } else {
        match std::fs::create_dir_all(&path) {
            Ok(_) => {
                let probe = path.join(".setup-center-write-test");
                if let Ok(_) = std::fs::write(&probe, b"ok") {
                    let _ = std::fs::remove_file(&probe);
                }
            }
            Err(e) => {
                return Err(format!("无法创建指定目录：{e}"));
            }
        }
    }

    Ok(valid_syntax)
}

/// Builds the winget CLI arguments. Pure function with no side effects.
pub fn build_winget_args(
    package_id: &str,
    capability: InstallLocationSupport,
    policy: &StoragePolicy,
    subdir: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "install".to_string(),
        "--id".to_string(),
        package_id.to_string(),
        "-e".to_string(),
        "--silent".to_string(),
        "--accept-package-agreements".to_string(),
        "--accept-source-agreements".to_string(),
        "--disable-interactivity".to_string(),
    ];

    if capability == InstallLocationSupport::WingetLocation {
        if let Some(ref root) = policy.resolved_root {
            let target_path = if let Some(sub) = subdir {
                let clean_root = root.trim_end_matches(['\\', '/']);
                format!("{clean_root}\\{sub}")
            } else {
                root.clone()
            };
            args.push("--location".to_string());
            args.push(target_path);
        }
    }

    args
}

/// Location of persisted policy file.
pub fn storage_policy_file() -> PathBuf {
    super::detect::work_directory().join("storage-policy.json")
}

/// Loads the persisted policy from disk, if present.
pub fn load_persisted_policy() -> Option<StoragePolicy> {
    let path = storage_policy_file();
    if !path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Saves the given storage policy to disk.
pub fn save_persisted_policy(policy: &StoragePolicy) -> Result<(), String> {
    let path = storage_policy_file();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(policy).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Gets the effective storage policy, reading persisted preferences if available.
pub fn load_effective_policy() -> StoragePolicy {
    let disks = super::detect::probe_disks(1024);
    get_effective_storage_policy(&disks)
}

/// Resolves the effective storage policy against current disks using persisted preferences.
pub fn get_effective_storage_policy(disks: &[DiskInfo]) -> StoragePolicy {
    let saved = load_persisted_policy().unwrap_or_default();
    resolve_storage_policy(disks, saved.mode, saved.custom_root)
}

/// Sets and saves the storage policy.
pub fn set_storage_policy(
    disks: &[DiskInfo],
    mode: StorageMode,
    custom_root: Option<String>,
) -> StoragePolicy {
    let resolved = resolve_storage_policy(disks, mode, custom_root);
    let _ = save_persisted_policy(&resolved);
    resolved
}

/// Cleans downloads using the given policy.
pub fn clean_downloads_with_policy(policy: &StoragePolicy) {
    let default_dir = default_download_directory();
    if default_dir.exists() {
        let _ = std::fs::remove_dir_all(&default_dir);
    }
    if let Some(ref dl) = policy.download_root {
        let custom_dir = PathBuf::from(dl);
        if custom_dir.exists() && custom_dir != default_dir {
            let _ = std::fs::remove_dir_all(&custom_dir);
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests covering all 12 cases specified in prompt §23
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_disks_with_secondary() -> Vec<DiskInfo> {
        vec![
            DiskInfo {
                root: "C:\\".into(),
                label: Some("OS".into()),
                total_bytes: 512 * 1024 * 1024 * 1024,
                free_bytes: 120 * 1024 * 1024 * 1024,
                writable: true,
                low_space: false,
            },
            DiskInfo {
                root: "D:\\".into(),
                label: Some("Data".into()),
                total_bytes: 1024 * 1024 * 1024 * 1024,
                free_bytes: 800 * 1024 * 1024 * 1024,
                writable: true,
                low_space: false,
            },
        ]
    }

    fn fake_disks_single_drive() -> Vec<DiskInfo> {
        vec![DiskInfo {
            root: "C:\\".into(),
            label: Some("OS".into()),
            total_bytes: 512 * 1024 * 1024 * 1024,
            free_bytes: 120 * 1024 * 1024 * 1024,
            writable: true,
            low_space: false,
        }]
    }

    // Case 1: system-default builds winget args without --location
    #[test]
    fn test_case_01_system_default_builds_winget_args_without_location() {
        let disks = fake_disks_with_secondary();
        let policy = resolve_storage_policy_with_system(
            &disks,
            StorageMode::SystemDefault,
            None,
            "C:",
        );
        let args = build_winget_args(
            "Microsoft.VisualStudioCode",
            InstallLocationSupport::WingetLocation,
            &policy,
            Some("VSCode"),
        );
        assert!(!args.contains(&"--location".to_string()));
        assert_eq!(policy.resolved_root, None);
    }

    // Case 2: prefer-secondary with secondary drive appends --location <drive>\SetupCenterApps\<subdir>
    #[test]
    fn test_case_02_prefer_secondary_appends_location_to_secondary_drive() {
        let disks = fake_disks_with_secondary();
        let policy = resolve_storage_policy_with_system(
            &disks,
            StorageMode::PreferSecondary,
            None,
            "C:",
        );
        assert_eq!(policy.resolved_root.as_deref(), Some("D:\\SetupCenterApps"));
        let args = build_winget_args(
            "Microsoft.VisualStudioCode",
            InstallLocationSupport::WingetLocation,
            &policy,
            Some("VSCode"),
        );
        assert!(args.contains(&"--location".to_string()));
        let loc_idx = args.iter().position(|a| a == "--location").unwrap();
        assert_eq!(args[loc_idx + 1], "D:\\SetupCenterApps\\VSCode");
    }

    // Case 3: prefer-secondary without secondary drive falls back to system-default with reason
    #[test]
    fn test_case_03_prefer_secondary_without_secondary_falls_back_with_reason() {
        let disks = fake_disks_single_drive();
        let policy = resolve_storage_policy_with_system(
            &disks,
            StorageMode::PreferSecondary,
            None,
            "C:",
        );
        assert_eq!(policy.resolved_root, None);
        assert!(policy.fallback_reason.is_some());
        assert!(policy.fallback_reason.as_ref().unwrap().contains("未检测到可用的其他磁盘"));

        let args = build_winget_args(
            "Microsoft.VisualStudioCode",
            InstallLocationSupport::WingetLocation,
            &policy,
            Some("VSCode"),
        );
        assert!(!args.contains(&"--location".to_string()));
    }

    // Case 4: custom mode with valid path appends --location <custom>\<subdir>
    #[test]
    fn test_case_04_custom_mode_appends_location_with_subdir() {
        let policy = StoragePolicy {
            mode: StorageMode::Custom,
            custom_root: Some("D:\\Apps".into()),
            resolved_root: Some("D:\\Apps".into()),
            system_drive: Some("C:".into()),
            download_root: Some("D:\\Apps\\.setup-center\\downloads".into()),
            fallback_reason: None,
        };
        let args = build_winget_args(
            "Git.Git",
            InstallLocationSupport::WingetLocation,
            &policy,
            Some("Git"),
        );
        assert!(args.contains(&"--location".to_string()));
        let loc_idx = args.iter().position(|a| a == "--location").unwrap();
        assert_eq!(args[loc_idx + 1], "D:\\Apps\\Git");
    }

    // Case 5: custom mode rejects Windows/System32
    #[test]
    fn test_case_05_custom_mode_rejects_windows_and_system32() {
        assert!(validate_custom_path_syntax("C:\\Windows", "C:").is_err());
        assert!(validate_custom_path_syntax("C:\\Windows\\System32", "C:").is_err());
        assert!(validate_custom_path_syntax("D:\\Windows", "C:").is_err());
        assert!(validate_custom_path_syntax("C:\\Program Files", "C:").is_err());
    }

    // Case 6: custom mode rejects root-only dangerous system paths
    #[test]
    fn test_case_06_custom_mode_rejects_root_only_dangerous_system_paths() {
        assert!(validate_custom_path_syntax("C:\\", "C:").is_err());
        assert!(validate_custom_path_syntax("C:", "C:").is_err());
        assert!(validate_custom_path_syntax("c:\\", "C:").is_err());
    }

    // Case 7: fixed-default software does not append --location even in prefer-secondary
    #[test]
    fn test_case_07_fixed_default_does_not_append_location() {
        let policy = StoragePolicy {
            mode: StorageMode::PreferSecondary,
            resolved_root: Some("D:\\SetupCenterApps".into()),
            ..Default::default()
        };
        let args = build_winget_args(
            "OpenJS.NodeJS",
            InstallLocationSupport::FixedDefault,
            &policy,
            None,
        );
        assert!(!args.contains(&"--location".to_string()));
    }

    // Case 8: system-managed software does not append --location
    #[test]
    fn test_case_08_system_managed_does_not_append_location() {
        let policy = StoragePolicy {
            mode: StorageMode::PreferSecondary,
            resolved_root: Some("D:\\SetupCenterApps".into()),
            ..Default::default()
        };
        let args = build_winget_args(
            "9PLM9XGG6VKS",
            InstallLocationSupport::SystemManaged,
            &policy,
            None,
        );
        assert!(!args.contains(&"--location".to_string()));
    }

    // Case 9: script-managed software does not append --location
    #[test]
    fn test_case_09_script_managed_does_not_append_location() {
        let policy = StoragePolicy {
            mode: StorageMode::PreferSecondary,
            resolved_root: Some("D:\\SetupCenterApps".into()),
            ..Default::default()
        };
        let args = build_winget_args(
            "claude-code",
            InstallLocationSupport::ScriptManaged,
            &policy,
            None,
        );
        assert!(!args.contains(&"--location".to_string()));
    }

    // Case 10: download directory resolves correctly for each mode
    #[test]
    fn test_case_10_download_directory_resolves_for_each_mode() {
        let disks = fake_disks_with_secondary();

        let sys_policy = resolve_storage_policy_with_system(
            &disks,
            StorageMode::SystemDefault,
            None,
            "C:",
        );
        assert!(sys_policy.download_root.unwrap().contains("downloads"));

        let sec_policy = resolve_storage_policy_with_system(
            &disks,
            StorageMode::PreferSecondary,
            None,
            "C:",
        );
        assert_eq!(
            sec_policy.download_root.as_deref(),
            Some("D:\\SetupCenterApps\\.setup-center\\downloads")
        );

        let custom_policy = StoragePolicy {
            mode: StorageMode::Custom,
            download_root: Some("D:\\Apps\\.setup-center\\downloads".into()),
            ..Default::default()
        };
        assert_eq!(
            resolve_download_directory(&custom_policy),
            PathBuf::from("D:\\Apps\\.setup-center\\downloads")
        );
    }

    // Case 11: safe path validator accepts D:\Apps, D:\SetupCenterApps
    #[test]
    fn test_case_11_safe_path_validator_accepts_valid_paths() {
        let r1 = validate_custom_path_syntax("D:\\Apps", "C:");
        assert_eq!(r1, Ok("D:\\Apps".into()));

        let r2 = validate_custom_path_syntax("D:\\SetupCenterApps", "C:");
        assert_eq!(r2, Ok("D:\\SetupCenterApps".into()));

        let r3 = validate_custom_path_syntax("E:\\Development\\Tools", "C:");
        assert_eq!(r3, Ok("E:\\Development\\Tools".into()));
    }

    // Case 12: safe path validator rejects files, non-existent drives, invalid characters
    #[test]
    fn test_case_12_safe_path_validator_rejects_invalid_inputs() {
        // UNC path
        assert!(validate_custom_path_syntax(r"\\server\share", "C:").is_err());

        // Invalid characters
        assert!(validate_custom_path_syntax("D:\\Apps<test>", "C:").is_err());
        assert!(validate_custom_path_syntax("D:\\Apps|test", "C:").is_err());
        assert!(validate_custom_path_syntax("D:\\Apps*test", "C:").is_err());

        // Empty path
        assert!(validate_custom_path_syntax("", "C:").is_err());

        // Non-existent drive via full validator
        let r_drive = validate_custom_path("Z:\\NonExistentDrivePath", "C:");
        assert!(r_drive.is_err());
        assert!(r_drive.unwrap_err().contains("不存在"));

        // File path via full validator
        let temp_file = std::env::temp_dir().join("setup_center_test_file.txt");
        let _ = std::fs::write(&temp_file, b"content");
        let r_file = validate_custom_path(&temp_file.to_string_lossy(), "C:");
        assert!(r_file.is_err());
        assert!(r_file.unwrap_err().contains("已存在的文件"));
        let _ = std::fs::remove_file(&temp_file);
    }
}
