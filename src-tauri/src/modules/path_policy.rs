//! Unified Path Policy & Security Boundary Module
//!
//! Enforces path validity, directory containment, Windows path semantics,
//! safe identifier / filesystem component validation, and junction / reparse point rejection.

use std::path::{Component, Path, PathBuf};
use serde::{Deserialize, Serialize};

/// Errors returned by path policy checks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PathPolicyError {
    EmptyPath,
    InvalidIdentifier { reason: String },
    InvalidComponent { reason: String },
    InvalidDriveRoot { reason: String },
    UncNotAllowed,
    DeviceNamespaceNotAllowed,
    AlternateDataStreamNotAllowed,
    ReservedDeviceName { name: String },
    TrailingDotOrSpace,
    ParentTraversalNotAllowed,
    ReparsePointEncountered { path: String, reason: String },
    PathEscapesRoot { path: String, root: String },
    TargetIsFile { path: String },
    RootDoesNotExist { path: String },
    IoError { path: String, reason: String },
}

impl std::fmt::Display for PathPolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PathPolicyError::EmptyPath => write!(f, "路径不能为空"),
            PathPolicyError::InvalidIdentifier { reason } => write!(f, "受控标识符无效：{reason}"),
            PathPolicyError::InvalidComponent { reason } => write!(f, "路径组件无效：{reason}"),
            PathPolicyError::InvalidDriveRoot { reason } => write!(f, "磁盘根路径无效：{reason}"),
            PathPolicyError::UncNotAllowed => write!(f, "不支持网络路径或 UNC 路径"),
            PathPolicyError::DeviceNamespaceNotAllowed => write!(f, "不支持设备命名空间路径（\\\\?\\ 或 \\\\.\\）"),
            PathPolicyError::AlternateDataStreamNotAllowed => write!(f, "不支持备用数据流 (ADS) 路径"),
            PathPolicyError::ReservedDeviceName { name } => write!(f, "不允许使用 Windows 保留设备名：{name}"),
            PathPolicyError::TrailingDotOrSpace => write!(f, "路径组件不允许以空格或点结尾"),
            PathPolicyError::ParentTraversalNotAllowed => write!(f, "不允许跨越父目录 (..)"),
            PathPolicyError::ReparsePointEncountered { path, reason } => {
                write!(f, "拒绝访问包含重解析点/符号链接/Junction 的路径 {path}：{reason}")
            }
            PathPolicyError::PathEscapesRoot { path, root } => {
                write!(f, "路径 {path} 超出受控根目录 {root}")
            }
            PathPolicyError::TargetIsFile { path } => write!(f, "指定路径是一个已存在的文件，而不是目录：{path}"),
            PathPolicyError::RootDoesNotExist { path } => write!(f, "指定驱动器或根目录不存在：{path}"),
            PathPolicyError::IoError { path, reason } => write!(f, "路径 IO 检查失败 {path}：{reason}"),
        }
    }
}

impl std::error::Error for PathPolicyError {}

/// Windows reserved DOS device names.
const RESERVED_DEVICE_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Validates strict controlled identifier: `[A-Za-z0-9_-]`, length 1..=80.
pub fn validate_identifier(input: &str) -> Result<String, PathPolicyError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(PathPolicyError::InvalidIdentifier {
            reason: "标识符不能为空".into(),
        });
    }
    if trimmed.len() > 80 {
        return Err(PathPolicyError::InvalidIdentifier {
            reason: format!("标识符长度不能超过 80 字符（当前 {}）", trimmed.len()),
        });
    }
    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(PathPolicyError::InvalidIdentifier {
            reason: "标识符仅允许 ASCII 字母、数字、下划线和连字符 [A-Za-z0-9_-]".into(),
        });
    }
    Ok(trimmed.to_string())
}

/// Validates a filesystem component (directory or file name).
/// Allows legal Unicode (e.g. Chinese), internal spaces, internal dots (e.g. settings.json).
/// Rejects control characters, Windows illegal characters, trailing dots/spaces,
/// reserved device names, and `.` / `..`.
pub fn validate_fs_component(input: &str) -> Result<String, PathPolicyError> {
    if input.is_empty() {
        return Err(PathPolicyError::InvalidComponent {
            reason: "组件名称不能为空".into(),
        });
    }

    if input == "." || input == ".." {
        return Err(PathPolicyError::ParentTraversalNotAllowed);
    }

    // Trailing dot or space is illegal in Windows NTFS/FAT
    if input.ends_with(' ') || input.ends_with('.') {
        return Err(PathPolicyError::TrailingDotOrSpace);
    }

    // Reject control characters (< 32)
    if input.chars().any(|c| (c as u32) < 32) {
        return Err(PathPolicyError::InvalidComponent {
            reason: "组件名称包含控制字符".into(),
        });
    }

    // Windows illegal chars: < > : " / \ | ? *
    if input.contains(['<', '>', ':', '"', '/', '\\', '|', '?', '*']) {
        return Err(PathPolicyError::InvalidComponent {
            reason: "组件名称包含非法字符 (< > : \" / \\ | ? *)".into(),
        });
    }

    // Check reserved device names (CON, PRN, AUX, etc., with or without extension)
    let stem = input.split('.').next().unwrap_or(input).trim();
    let stem_upper = stem.to_ascii_uppercase();
    if RESERVED_DEVICE_NAMES.contains(&stem_upper.as_str()) {
        return Err(PathPolicyError::ReservedDeviceName {
            name: input.to_string(),
        });
    }

    // Reject URL encoded sequences like %2e, %2f, %5c
    let lower = input.to_ascii_lowercase();
    if lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c") {
        return Err(PathPolicyError::InvalidComponent {
            reason: "组件名称包含 URL 编码的保留字符".into(),
        });
    }

    Ok(input.to_string())
}

/// Checks if a file or directory path contains any reparse point (junction / symlink).
/// Inspects all existing ancestors of the path.
pub fn reject_reparse_chain(path: &Path) -> Result<(), PathPolicyError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;

        let mut current = Some(path);
        while let Some(p) = current {
            if p.exists() {
                let wide: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
                let attrs = unsafe {
                    windows_sys::Win32::Storage::FileSystem::GetFileAttributesW(wide.as_ptr())
                };
                if attrs != windows_sys::Win32::Storage::FileSystem::INVALID_FILE_ATTRIBUTES {
                    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x00000400;
                    if (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
                        return Err(PathPolicyError::ReparsePointEncountered {
                            path: p.to_string_lossy().to_string(),
                            reason: "检测到符号链接或 Junction 目录，拒绝跨边界写入".into(),
                        });
                    }
                }
            }
            current = p.parent();
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
    Ok(())
}

/// Resolves a relative path strictly within `root` without escaping.
/// All relative components are checked against `validate_fs_component`.
/// Also verifies ancestor reparse points.
pub fn resolve_under_root(root: &Path, rel_path: &str) -> Result<PathBuf, PathPolicyError> {
    let trimmed = rel_path.trim();
    if trimmed.is_empty() {
        return Err(PathPolicyError::EmptyPath);
    }

    // Refuse absolute prefixes
    if trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return Err(PathPolicyError::PathEscapesRoot {
            path: trimmed.to_string(),
            root: root.to_string_lossy().to_string(),
        });
    }

    // Refuse drive letters
    if trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':' {
        return Err(PathPolicyError::PathEscapesRoot {
            path: trimmed.to_string(),
            root: root.to_string_lossy().to_string(),
        });
    }

    let mut target = root.to_path_buf();
    let normalized = trimmed.replace('/', "\\");
    for part in normalized.split('\\') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let valid_comp = validate_fs_component(part)?;
        target.push(valid_comp);
    }

    // Component-level containment check: ensure every component of root matches prefix of target
    let root_comps: Vec<_> = root.components().collect();
    let target_comps: Vec<_> = target.components().collect();

    if target_comps.len() < root_comps.len() {
        return Err(PathPolicyError::PathEscapesRoot {
            path: target.to_string_lossy().to_string(),
            root: root.to_string_lossy().to_string(),
        });
    }

    for (r, t) in root_comps.iter().zip(target_comps.iter()) {
        if r != t {
            return Err(PathPolicyError::PathEscapesRoot {
                path: target.to_string_lossy().to_string(),
                root: root.to_string_lossy().to_string(),
            });
        }
    }

    // Check reparse chain
    reject_reparse_chain(&target)?;

    Ok(target)
}

/// Validates an absolute storage root directory (e.g. `D:\SetupCenterApps`).
/// Must be an explicit drive-root format: `X:\<folder...>`.
/// Rejects UNC, device namespace, drive-relative, ADS, reserved device names, and trailing dots/spaces.
pub fn validate_absolute_storage_root(
    path_str: &str,
    system_drive: Option<&str>,
) -> Result<PathBuf, PathPolicyError> {
    let trimmed = path_str.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err(PathPolicyError::EmptyPath);
    }

    if trimmed.starts_with(r"\\") {
        return Err(PathPolicyError::UncNotAllowed);
    }

    if trimmed.starts_with(r"\??\") || trimmed.starts_with(r"\\?\") || trimmed.starts_with(r"\\.\") {
        return Err(PathPolicyError::DeviceNamespaceNotAllowed);
    }

    // Validate drive specification: exactly `X:\...`
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() < 3
        || !chars[0].is_ascii_alphabetic()
        || chars[1] != ':'
        || (chars[2] != '\\' && chars[2] != '/')
    {
        return Err(PathPolicyError::InvalidDriveRoot {
            reason: "路径必须以完整盘符根开头（如 D:\\SetupCenterApps），不允许使用驱动器相对路径（如 D:folder）".into(),
        });
    }

    // Reject additional colons (ADS)
    if trimmed[2..].contains(':') {
        return Err(PathPolicyError::AlternateDataStreamNotAllowed);
    }

    let drive_letter = chars[0].to_ascii_uppercase();
    let norm_sys_drive = system_drive.map(|s| {
        s.trim_end_matches(['\\', '/', ':'])
            .chars()
            .next()
            .unwrap_or('C')
            .to_ascii_uppercase()
    });

    // Check system drive root direct assignment (e.g. C:\)
    if let Some(sys_letter) = norm_sys_drive {
        if drive_letter == sys_letter {
            let rest = trimmed[3..].trim_matches(['\\', '/']);
            if rest.is_empty() {
                return Err(PathPolicyError::InvalidDriveRoot {
                    reason: "不允许直接使用系统盘根目录作为安装路径，请指定子目录（例如 C:\\SetupCenterApps）".into(),
                });
            }
        }
    }

    // Check system reserved directories
    let lower = trimmed.to_lowercase().replace('/', "\\");
    if lower.contains(r"\windows")
        || lower.contains(r"\system32")
        || lower.contains(r"\syswow64")
        || lower.contains(r"\program files")
        || lower.contains(r"\programdata")
        || lower.ends_with(r"\windows")
        || lower.ends_with(r"\system32")
    {
        return Err(PathPolicyError::InvalidDriveRoot {
            reason: "不允许使用 Windows 或系统保留目录作为安装路径".into(),
        });
    }

    // Validate each path component
    let path = PathBuf::from(trimmed);
    let mut normalized = PathBuf::from(format!("{}:\\", drive_letter));

    for comp in path.components() {
        match comp {
            Component::Prefix(_) | Component::RootDir => {}
            Component::CurDir => {}
            Component::ParentDir => return Err(PathPolicyError::ParentTraversalNotAllowed),
            Component::Normal(seg) => {
                let seg_str = seg.to_string_lossy();
                let valid = validate_fs_component(&seg_str)?;
                normalized.push(valid);
            }
        }
    }

    // Drive root existence
    let drive_root = PathBuf::from(format!("{}:\\", drive_letter));
    if !drive_root.exists() {
        return Err(PathPolicyError::RootDoesNotExist {
            path: format!("{}:\\", drive_letter),
        });
    }

    if normalized.exists() && normalized.is_file() {
        return Err(PathPolicyError::TargetIsFile {
            path: normalized.to_string_lossy().to_string(),
        });
    }

    // Check ancestor reparse points
    reject_reparse_chain(&normalized)?;

    Ok(normalized)
}

/// Checks whether a target path is strictly within any of the allowed roots.
/// Component-based comparison avoids prefix confusion like `C:\AllowedExtra` matching `C:\Allowed`.
pub fn is_within_allowed_roots(target: &Path, allowed_roots: &[PathBuf]) -> bool {
    let target_comps: Vec<_> = target.components().collect();

    for root in allowed_roots {
        let root_comps: Vec<_> = root.components().collect();
        if target_comps.len() < root_comps.len() {
            continue;
        }

        let mut matches = true;
        for (r, t) in root_comps.iter().zip(target_comps.iter()) {
            if r != t {
                matches = false;
                break;
            }
        }

        if matches {
            // Also reject reparse chain
            if reject_reparse_chain(target).is_ok() {
                return true;
            }
        }
    }
    false
}
