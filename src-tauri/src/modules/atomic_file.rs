//! Atomic File Operations & Safe Backup/Restore Utility
//!
//! Provides transactional single-file atomic replacement using Windows ReplaceFileW
//! (when the destination exists) or exclusive atomic move (when destination does not exist),
//! exclusive first-backup creation, and safe atomic recovery.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AtomicFileError {
    TempFileCreateFailed { path: String, reason: String },
    WriteFailed { path: String, reason: String },
    SyncFailed { path: String, reason: String },
    ReplaceFailed { target: String, tmp: String, reason: String },
    BackupAlreadyExists { path: String },
    BackupCreateFailed { path: String, reason: String },
    SourceNotFound { path: String },
    ParentDirMissing { path: String },
    IoError { reason: String },
}

impl std::fmt::Display for AtomicFileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AtomicFileError::TempFileCreateFailed { path, reason } => {
                write!(f, "创建临时文件失败 {path}：{reason}")
            }
            AtomicFileError::WriteFailed { path, reason } => {
                write!(f, "写入临时文件数据失败 {path}：{reason}")
            }
            AtomicFileError::SyncFailed { path, reason } => {
                write!(f, "同步临时文件到磁盘失败 {path}：{reason}")
            }
            AtomicFileError::ReplaceFailed { target, tmp, reason } => {
                write!(f, "原子替换目标文件失败（目标：{target}，临时：{tmp}）：{reason}")
            }
            AtomicFileError::BackupAlreadyExists { path } => {
                write!(f, "初始备份已存在，拒绝覆盖原备份：{path}")
            }
            AtomicFileError::BackupCreateFailed { path, reason } => {
                write!(f, "创建备份文件失败 {path}：{reason}")
            }
            AtomicFileError::SourceNotFound { path } => {
                write!(f, "源文件不存在：{path}")
            }
            AtomicFileError::ParentDirMissing { path } => {
                write!(f, "文件父目录不存在且无法定位：{path}")
            }
            AtomicFileError::IoError { reason } => {
                write!(f, "IO 操作失败：{reason}")
            }
        }
    }
}

impl std::error::Error for AtomicFileError {}

static TMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Generates a unique temporary file path strictly within the same directory as `target`.
pub fn generate_unique_tmp_path(target: &Path) -> PathBuf {
    let pid = std::process::id();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let count = TMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let tmp_name = format!("{file_name}.tmp.{pid}.{now}.{count}");
    target.with_file_name(tmp_name)
}

/// Atomically writes content to `target` using an exclusive sibling temporary file.
/// If `target` exists, replaces it atomically using Windows `ReplaceFileW`.
/// If `target` does not exist, moves the temporary file to `target`.
/// On any failure, the temporary file is removed and the original file is preserved.
pub fn write_atomic(target: &Path, content: &[u8]) -> Result<(), AtomicFileError> {
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| AtomicFileError::TempFileCreateFailed {
                path: parent.to_string_lossy().to_string(),
                reason: e.to_string(),
            })?;
        }
    } else {
        return Err(AtomicFileError::ParentDirMissing {
            path: target.to_string_lossy().to_string(),
        });
    }

    let tmp_path = generate_unique_tmp_path(target);

    // Create new exclusive temporary file
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)
        .map_err(|e| AtomicFileError::TempFileCreateFailed {
            path: tmp_path.to_string_lossy().to_string(),
            reason: e.to_string(),
        })?;

    // Write all content
    if let Err(e) = file.write_all(content) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(AtomicFileError::WriteFailed {
            path: tmp_path.to_string_lossy().to_string(),
            reason: e.to_string(),
        });
    }

    // Flush to disk
    if let Err(e) = file.sync_all() {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(AtomicFileError::SyncFailed {
            path: tmp_path.to_string_lossy().to_string(),
            reason: e.to_string(),
        });
    }
    drop(file);

    // Atomic replacement
    if target.exists() {
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            let target_wide: Vec<u16> = target
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let tmp_wide: Vec<u16> = tmp_path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();

            let success = unsafe {
                windows_sys::Win32::Storage::FileSystem::ReplaceFileW(
                    target_wide.as_ptr(),
                    tmp_wide.as_ptr(),
                    std::ptr::null(),
                    0,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            };

            if success == 0 {
                let err = io::Error::last_os_error();
                let _ = std::fs::remove_file(&tmp_path);
                return Err(AtomicFileError::ReplaceFailed {
                    target: target.to_string_lossy().to_string(),
                    tmp: tmp_path.to_string_lossy().to_string(),
                    reason: err.to_string(),
                });
            }
        }
        #[cfg(not(windows))]
        {
            if let Err(e) = std::fs::rename(&tmp_path, target) {
                let _ = std::fs::remove_file(&tmp_path);
                return Err(AtomicFileError::ReplaceFailed {
                    target: target.to_string_lossy().to_string(),
                    tmp: tmp_path.to_string_lossy().to_string(),
                    reason: e.to_string(),
                });
            }
        }
    } else {
        // Target does not exist yet: safe rename
        if let Err(e) = std::fs::rename(&tmp_path, target) {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(AtomicFileError::ReplaceFailed {
                target: target.to_string_lossy().to_string(),
                tmp: tmp_path.to_string_lossy().to_string(),
                reason: e.to_string(),
            });
        }
    }

    Ok(())
}

/// Creates the very first backup copy of `target` at `backup_path`.
/// Returns `Ok(true)` if newly created, or `Ok(false)` if backup already exists (preserving original).
pub fn create_first_backup(target: &Path, backup_path: &Path) -> Result<bool, AtomicFileError> {
    if !target.exists() {
        return Ok(false);
    }
    if backup_path.exists() {
        // Already backed up initially; preserve existing initial backup!
        return Ok(false);
    }

    let content = std::fs::read(target).map_err(|e| AtomicFileError::IoError {
        reason: format!("读取原文件用于备份失败: {e}"),
    })?;

    // Write with create_new to ensure no race overwrite
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(backup_path)
        .map_err(|e| AtomicFileError::BackupCreateFailed {
            path: backup_path.to_string_lossy().to_string(),
            reason: e.to_string(),
        })?;

    f.write_all(&content)
        .map_err(|e| AtomicFileError::BackupCreateFailed {
            path: backup_path.to_string_lossy().to_string(),
            reason: e.to_string(),
        })?;

    f.sync_all()
        .map_err(|e| AtomicFileError::BackupCreateFailed {
            path: backup_path.to_string_lossy().to_string(),
            reason: e.to_string(),
        })?;

    Ok(true)
}

/// Restores `target` from `backup_path` atomically.
pub fn restore_atomic(backup_path: &Path, target: &Path) -> Result<(), AtomicFileError> {
    if !backup_path.exists() {
        return Err(AtomicFileError::SourceNotFound {
            path: backup_path.to_string_lossy().to_string(),
        });
    }

    let content = std::fs::read(backup_path).map_err(|e| AtomicFileError::IoError {
        reason: format!("读取备份文件失败: {e}"),
    })?;

    write_atomic(target, &content)
}
