//! UI Parts and Component Assets Storage Commands (Issue K01).

use crate::model::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UIPartsLoadResult {
    pub content: Option<String>,
    pub storage_path: String,
    pub is_corrupted: bool,
    pub corrupted_backup: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UIPartsSaveResult {
    pub success: bool,
    pub storage_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UIPartAssetSaveResult {
    pub relative_path: String,
    pub absolute_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UIPartAssetStageResult {
    pub staging_path: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UIPartAssetCommitItem {
    pub staging_path: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UIPartsInfo {
    pub storage_dir: String,
    pub index_file: String,
    pub assets_dir: String,
}

pub fn get_uiparts_base_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let local_data = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Internal(format!("无法解析应用本地数据目录: {e}")))?;
    let dir = local_data.join("uiparts");
    std::fs::create_dir_all(&dir.join("assets"))
        .map_err(|e| AppError::Internal(format!("无法创建 uiparts 目录: {e}")))?;
    Ok(dir)
}

pub fn b64_decode(input: &str) -> Result<Vec<u8>, String> {
    const B64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut table = [255u8; 256];
    for (i, &c) in B64_CHARS.iter().enumerate() {
        table[c as usize] = i as u8;
    }
    let s = input.trim().trim_end_matches('=');
    let mut out = Vec::with_capacity((s.len() * 3) / 4);
    let bytes = s.as_bytes();
    let mut buf = 0u32;
    let mut bits = 0;
    for &b in bytes {
        if b.is_ascii_whitespace() {
            continue;
        }
        let val = table[b as usize];
        if val == 255 {
            return Err("Invalid base64 character".into());
        }
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

pub fn b64_encode(data: &[u8]) -> String {
    const B64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((data.len() + 2) / 3) * 4);
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i];
        let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] } else { 0 };

        let triple = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(B64_CHARS[((triple >> 18) & 63) as usize] as char);
        out.push(B64_CHARS[((triple >> 12) & 63) as usize] as char);
        if i + 1 < data.len() {
            out.push(B64_CHARS[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < data.len() {
            out.push(B64_CHARS[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

#[cfg(windows)]
pub fn atomic_replace_file(tmp: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let tmp_wide: Vec<u16> = tmp.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

    if target.exists() {
        let success = unsafe {
            ReplaceFileW(
                target_wide.as_ptr(),
                tmp_wide.as_ptr(),
                std::ptr::null(),
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if success != 0 {
            return Ok(());
        }

        let move_res = unsafe {
            MoveFileExW(
                tmp_wide.as_ptr(),
                target_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if move_res != 0 {
            return Ok(());
        }
        return Err(std::io::Error::last_os_error());
    }

    let move_res = unsafe {
        MoveFileExW(
            tmp_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_WRITE_THROUGH,
        )
    };
    if move_res != 0 {
        Ok(())
    } else {
        std::fs::rename(tmp, target)
    }
}

#[cfg(not(windows))]
pub fn atomic_replace_file(tmp: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::rename(tmp, target)
}

/// Resolves a relative asset path and strictly ensures containment within <AppLocalData>/uiparts/assets/.
pub fn resolve_uipart_asset_path(base_dir: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let assets_root = base_dir.join("assets");
    let trimmed = rel_path.trim().replace('\\', "/");
    let clean_rel = if let Some(stripped) = trimmed.strip_prefix("assets/") {
        stripped
    } else {
        trimmed.as_str()
    };
    crate::modules::path_policy::resolve_under_root(&assets_root, clean_rel)
        .map_err(|e| e.to_string())
}

/// Resolves a part directory inside assets/, ensuring containment.
pub fn resolve_uipart_asset_dir(base_dir: &Path, part_id: &str) -> Result<PathBuf, String> {
    let assets_root = base_dir.join("assets");
    crate::modules::path_policy::resolve_under_root(&assets_root, part_id)
        .map_err(|e| e.to_string())
}

/// Generates a unique temporary file path within the same directory as target.
pub fn generate_unique_tmp_path(target: &Path) -> PathBuf {
    crate::modules::atomic_file::generate_unique_tmp_path(target)
}

#[tauri::command]
pub fn get_uiparts_info(app: tauri::AppHandle) -> AppResult<UIPartsInfo> {
    let dir = get_uiparts_base_dir(&app)?;
    Ok(UIPartsInfo {
        storage_dir: dir.to_string_lossy().to_string(),
        index_file: dir.join("index.json").to_string_lossy().to_string(),
        assets_dir: dir.join("assets").to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn load_user_uiparts(app: tauri::AppHandle) -> AppResult<UIPartsLoadResult> {
    let dir = get_uiparts_base_dir(&app)?;
    let index_path = dir.join("index.json");

    if !index_path.exists() {
        let old_in_dir = dir.join("uiparts.json");
        if old_in_dir.is_file() {
            let _ = std::fs::copy(&old_in_dir, &index_path);
        } else if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let legacy_path = PathBuf::from(local_app_data)
                .join("Setup Center")
                .join("uiparts.json");
            if legacy_path.is_file() {
                if let Ok(content) = std::fs::read_to_string(&legacy_path) {
                    let _ = std::fs::write(&index_path, content);
                }
            }
        }
    }

    if !index_path.exists() {
        return Ok(UIPartsLoadResult {
            content: None,
            storage_path: index_path.to_string_lossy().to_string(),
            is_corrupted: false,
            corrupted_backup: None,
        });
    }

    let raw = std::fs::read_to_string(&index_path)
        .map_err(|e| AppError::Internal(format!("读取 uiparts 索引文件失败: {e}")))?;

    if raw.trim().is_empty() {
        return Ok(UIPartsLoadResult {
            content: None,
            storage_path: index_path.to_string_lossy().to_string(),
            is_corrupted: false,
            corrupted_backup: None,
        });
    }

    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(_) => Ok(UIPartsLoadResult {
            content: Some(raw),
            storage_path: index_path.to_string_lossy().to_string(),
            is_corrupted: false,
            corrupted_backup: None,
        }),
        Err(_) => {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let backup_name = format!("uiparts.corrupt.{}.json", timestamp);
            let backup_path = dir.join(&backup_name);
            let _ = std::fs::copy(&index_path, &backup_path);

            Ok(UIPartsLoadResult {
                content: None,
                storage_path: index_path.to_string_lossy().to_string(),
                is_corrupted: true,
                corrupted_backup: Some(backup_path.to_string_lossy().to_string()),
            })
        }
    }
}

#[tauri::command]
pub fn save_user_uiparts(app: tauri::AppHandle, content: String) -> AppResult<UIPartsSaveResult> {
    let dir = get_uiparts_base_dir(&app)?;
    let target = dir.join("index.json");

    crate::modules::atomic_file::write_atomic(&target, content.as_bytes())
        .map_err(|e| AppError::Internal(format!("安全原子保存 index.json 失败: {e}")))?;

    Ok(UIPartsSaveResult {
        success: true,
        storage_path: target.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn save_uipart_asset(
    app: tauri::AppHandle,
    part_id: String,
    file_name: String,
    base64_data: String,
) -> AppResult<UIPartAssetSaveResult> {
    let dir = get_uiparts_base_dir(&app)?;

    crate::modules::path_policy::validate_identifier(&part_id)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    crate::modules::path_policy::validate_fs_component(&file_name)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let target_file = resolve_uipart_asset_path(&dir, &format!("{part_id}/{file_name}"))
        .map_err(AppError::Internal)?;

    const MAX_RAW_BASE64_LEN: usize = (15 * 1024 * 1024 * 4 / 3) + 512;
    if base64_data.len() > MAX_RAW_BASE64_LEN {
        return Err(AppError::Internal("媒体资源数据超出长度上限（解码前限制）".into()));
    }

    let (raw_b64, detected_ext) = if let Some(comma_pos) = base64_data.find(',') {
        let prefix = &base64_data[..comma_pos];
        let ext = if prefix.contains("image/png") {
            "png"
        } else if prefix.contains("image/jpeg") || prefix.contains("image/jpg") {
            "jpg"
        } else if prefix.contains("image/webp") {
            "webp"
        } else {
            return Err(AppError::Internal("不支持的图片格式，仅支持 PNG, JPEG, WebP（拒绝 SVG/HTML/GIF 等）".into()));
        };
        (&base64_data[comma_pos + 1..], ext)
    } else {
        (base64_data.as_str(), "png")
    };

    let req_ext = Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !req_ext.is_empty() && req_ext != detected_ext && !(req_ext == "jpeg" && detected_ext == "jpg") {
        return Err(AppError::Internal(format!("文件扩展名 (.{req_ext}) 与数据类型 (.{detected_ext}) 不一致")));
    }

    let bytes = b64_decode(raw_b64).map_err(|e| AppError::Internal(format!("Base64 解码失败: {e}")))?;

    if bytes.len() > 15 * 1024 * 1024 {
        return Err(AppError::Internal("媒体资源大小超出最大限制 (15MB)".into()));
    }

    let is_png = bytes.starts_with(b"\x89PNG\r\n\x1a\n");
    let is_jpg = bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
    let is_webp = bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP";

    if !is_png && !is_jpg && !is_webp {
        return Err(AppError::Internal("图片文件头部 Magic 验证失败，必须为有效的 PNG/JPEG/WebP 文件".into()));
    }

    crate::modules::atomic_file::write_atomic(&target_file, &bytes)
        .map_err(|e| AppError::Internal(format!("安全原子保存资源文件失败: {e}")))?;

    let rel = format!("assets/{part_id}/{file_name}");
    Ok(UIPartAssetSaveResult {
        relative_path: rel,
        absolute_path: target_file.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn stage_uipart_asset(
    app: tauri::AppHandle,
    part_id: String,
    file_name: String,
    base64_data: String,
) -> AppResult<UIPartAssetStageResult> {
    let dir = get_uiparts_base_dir(&app)?;

    crate::modules::path_policy::validate_identifier(&part_id)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    crate::modules::path_policy::validate_fs_component(&file_name)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    const MAX_RAW_BASE64_LEN: usize = (15 * 1024 * 1024 * 4 / 3) + 512;
    if base64_data.len() > MAX_RAW_BASE64_LEN {
        return Err(AppError::Internal("媒体资源数据超出长度上限（解码前限制）".into()));
    }

    let (raw_b64, detected_ext) = if let Some(comma_pos) = base64_data.find(',') {
        let prefix = &base64_data[..comma_pos];
        let ext = if prefix.contains("image/png") {
            "png"
        } else if prefix.contains("image/jpeg") || prefix.contains("image/jpg") {
            "jpg"
        } else if prefix.contains("image/webp") {
            "webp"
        } else {
            return Err(AppError::Internal("不支持的图片格式，仅支持 PNG, JPEG, WebP（拒绝 SVG/HTML/GIF 等）".into()));
        };
        (&base64_data[comma_pos + 1..], ext)
    } else {
        (base64_data.as_str(), "png")
    };

    let req_ext = Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !req_ext.is_empty() && req_ext != detected_ext && !(req_ext == "jpeg" && detected_ext == "jpg") {
        return Err(AppError::Internal(format!("文件扩展名 (.{req_ext}) 与数据类型 (.{detected_ext}) 不一致")));
    }

    let bytes = b64_decode(raw_b64).map_err(|e| AppError::Internal(format!("Base64 解码失败: {e}")))?;

    if bytes.len() > 15 * 1024 * 1024 {
        return Err(AppError::Internal("媒体资源大小超出最大限制 (15MB)".into()));
    }

    let is_png = bytes.starts_with(b"\x89PNG\r\n\x1a\n");
    let is_jpg = bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
    let is_webp = bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP";

    if !is_png && !is_jpg && !is_webp {
        return Err(AppError::Internal("图片文件头部 Magic 验证失败，必须为有效的 PNG/JPEG/WebP 文件".into()));
    }

    let part_dir = resolve_uipart_asset_dir(&dir, &part_id).map_err(AppError::Internal)?;
    std::fs::create_dir_all(&part_dir)
        .map_err(|e| AppError::Internal(format!("创建零件目录失败: {e}")))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_micros())
        .unwrap_or(0);
    let staging_filename = format!(".staging-{timestamp}-{file_name}");
    let staging_file = part_dir.join(&staging_filename);

    crate::modules::atomic_file::write_atomic(&staging_file, &bytes)
        .map_err(|e| AppError::Internal(format!("安全暂存资源文件失败: {e}")))?;

    let rel_target = format!("assets/{part_id}/{file_name}");
    let staging_rel = format!("assets/{part_id}/{staging_filename}");

    Ok(UIPartAssetStageResult {
        staging_path: staging_rel,
        relative_path: rel_target,
    })
}

#[tauri::command]
pub fn commit_uipart_assets(
    app: tauri::AppHandle,
    items: Vec<UIPartAssetCommitItem>,
) -> AppResult<bool> {
    let dir = get_uiparts_base_dir(&app)?;

    for item in items {
        let staging_file = resolve_uipart_asset_path(&dir, &item.staging_path)
            .map_err(AppError::Internal)?;
        let target_file = resolve_uipart_asset_path(&dir, &item.relative_path)
            .map_err(AppError::Internal)?;

        if staging_file.is_file() {
            atomic_replace_file(&staging_file, &target_file)
                .map_err(|e| AppError::Internal(format!("提交资源文件失败 ({} -> {}): {e}", item.staging_path, item.relative_path)))?;
        }
    }

    Ok(true)
}

#[tauri::command]
pub fn discard_uipart_assets(
    app: tauri::AppHandle,
    staging_paths: Vec<String>,
) -> AppResult<bool> {
    let dir = get_uiparts_base_dir(&app)?;

    for path in staging_paths {
        if let Ok(file_path) = resolve_uipart_asset_path(&dir, &path) {
            if file_path.is_file() {
                let _ = std::fs::remove_file(&file_path);
            }
        }
    }

    Ok(true)
}

#[tauri::command]
pub fn read_uipart_asset(app: tauri::AppHandle, relative_path: String) -> AppResult<String> {
    let dir = get_uiparts_base_dir(&app)?;
    let target = resolve_uipart_asset_path(&dir, &relative_path).map_err(AppError::Internal)?;

    if !target.is_file() {
        return Err(AppError::Internal(format!("资源文件不存在: {relative_path}")));
    }

    let meta = std::fs::metadata(&target)
        .map_err(|e| AppError::Internal(format!("获取资源文件信息失败: {e}")))?;
    if meta.len() > 15 * 1024 * 1024 {
        return Err(AppError::Internal("资源文件大小超出受控上限 (15MB)".into()));
    }

    let bytes = std::fs::read(&target)
        .map_err(|e| AppError::Internal(format!("读取资源文件失败: {e}")))?;

    let ext = target
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => return Err(AppError::Internal(format!("不支持读取非图片格式资源: {ext}"))),
    };

    let b64 = b64_encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[tauri::command]
pub fn delete_uipart_assets(app: tauri::AppHandle, part_id: String) -> AppResult<bool> {
    let dir = get_uiparts_base_dir(&app)?;
    let part_dir = resolve_uipart_asset_dir(&dir, &part_id).map_err(AppError::Internal)?;

    if part_dir.is_dir() {
        std::fs::remove_dir_all(&part_dir)
            .map_err(|e| AppError::Internal(format!("删除零件资源目录失败: {e}")))?;
        Ok(true)
    } else {
        Ok(false)
    }
}
