//! UI Parts and Component Assets Storage Commands (Issue K01).

use crate::model::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicU64, Ordering};

static UIPART_WRITE_LOCK: Mutex<()> = Mutex::new(());
static MEDIA_NONCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct StagedAssetOwner {
    base_dir: PathBuf,
    part_id: String,
    target: String,
}

fn staged_owners() -> &'static Mutex<HashMap<String, StagedAssetOwner>> {
    static OWNERS: OnceLock<Mutex<HashMap<String, StagedAssetOwner>>> = OnceLock::new();
    OWNERS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UIPartsIndex {
    schema_version: u32,
    revision: u64,
    updated_at: String,
    parts: Vec<UIPartIndex>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UIPartIndex {
    id: String,
    title: String,
    lifecycle: String,
    kind: String,
    sources: Vec<UIPartIndexSource>,
    preview: serde_json::Value,
    tags: Vec<String>,
    created_at: String,
    updated_at: String,
    assets: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct UIPartIndexSource {
    id: String,
    title: String,
    #[serde(rename = "type")]
    source_type: String,
    primary: bool,
}

fn index_references(content: &str) -> AppResult<(HashSet<String>, HashMap<String, String>)> {
    let index: UIPartsIndex = serde_json::from_str(content)
        .map_err(|e| AppError::InvalidRequest { reason: format!("UI Parts 索引结构无效: {e}") })?;
    if index.schema_version != 1 || index.revision < 1 || index.updated_at.trim().is_empty() {
        return Err(AppError::InvalidRequest { reason: "UI Parts 索引版本、修订号或时间缺失".into() });
    }
    let mut parts = HashSet::new();
    let mut refs = HashMap::new();
    for part in index.parts {
        if part.id.trim().is_empty() || part.id.chars().any(char::is_control)
            || !parts.insert(part.id.clone()) || part.title.trim().is_empty()
            || part.created_at.trim().is_empty() || part.updated_at.trim().is_empty()
            || !["raw", "enriched", "prototyped", "validated"].contains(&part.lifecycle.as_str())
            || !["component", "layout", "composition", "navigation", "interaction", "typography", "status",
                "search", "card", "data-viz", "motion", "visual-rule", "other"].contains(&part.kind.as_str())
            || !part.preview.is_object() {
            return Err(AppError::InvalidRequest { reason: format!("零件 {} 的必填字段或身份无效", part.id) });
        }
        let _ = &part.tags;
        for source in &part.sources {
            if source.id.trim().is_empty() || source.title.trim().is_empty()
                || !["official", "product", "documentation", "engineering-blog", "repository", "archive",
                    "article", "screenshot", "local", "other"].contains(&source.source_type.as_str()) {
                return Err(AppError::InvalidRequest { reason: format!("零件 {} 的来源字段无效", part.id) });
            }
            let _ = source.primary;
        }
        let mut media = Vec::new();
        if let Some(value) = part.preview.get("thumbnail") {
            media.push(value.as_str().ok_or_else(|| AppError::InvalidRequest { reason: "thumbnail 必须为字符串".into() })?.to_string());
        }
        for key in ["screenshots", "sourceImages"] {
            if let Some(value) = part.preview.get(key) {
                let values = value.as_array().ok_or_else(|| AppError::InvalidRequest { reason: format!("{key} 必须为数组") })?;
                for value in values {
                    media.push(value.as_str().ok_or_else(|| AppError::InvalidRequest { reason: format!("{key} 包含非字符串") })?.to_string());
                }
            }
        }
        if let Some(assets) = part.assets {
            if !assets.is_object() { return Err(AppError::InvalidRequest { reason: "assets 必须为对象".into() }); }
            if let Some(value) = assets.get("mediaAssets") {
                for asset in value.as_array().ok_or_else(|| AppError::InvalidRequest { reason: "mediaAssets 必须为数组".into() })? {
                    media.push(asset.get("relativePath").and_then(|v| v.as_str())
                        .ok_or_else(|| AppError::InvalidRequest { reason: "媒体缺少 relativePath".into() })?.to_string());
                }
            }
        }
        for path in media {
            if !path.starts_with("assets/") { continue; }
            let prefix = format!("assets/{}/", part.id);
            if !path.starts_with(&prefix) || path[prefix.len()..].contains('/') || path.contains('\\') {
                return Err(AppError::InvalidRequest { reason: format!("媒体不属于零件 {}: {path}", part.id) });
            }
            if refs.get(&path).is_some_and(|owner| owner != &part.id) {
                return Err(AppError::InvalidRequest { reason: "媒体引用归属冲突".into() });
            }
            refs.insert(path, part.id.clone());
        }
    }
    Ok((parts, refs))
}

fn preflight_assets(dir: &Path, items: &[UIPartAssetCommitItem], owners: &HashMap<String, StagedAssetOwner>)
    -> AppResult<Vec<(PathBuf, PathBuf)>> {
    let mut sources = HashSet::new();
    let mut targets = HashSet::new();
    let mut resolved = Vec::new();
    for item in items {
        if !sources.insert(&item.staging_path) || !targets.insert(&item.relative_path) {
            return Err(AppError::InvalidRequest { reason: "重复暂存源或目标媒体".into() });
        }
        let owner = owners.get(&item.staging_path).ok_or_else(|| AppError::InvalidRequest { reason: "媒体暂存不属于本次后端产生的资源".into() })?;
        if owner.base_dir.as_path() != dir || owner.target != item.relative_path
            || !item.relative_path.starts_with(&format!("assets/{}/", owner.part_id)) {
            return Err(AppError::InvalidRequest { reason: "媒体暂存归属或目标不匹配".into() });
        }
        let source = resolve_uipart_asset_path(dir, &item.staging_path).map_err(AppError::Internal)?;
        let target = resolve_uipart_asset_path(dir, &item.relative_path).map_err(AppError::Internal)?;
        let meta = std::fs::symlink_metadata(&source).map_err(|e| AppError::Internal(format!("暂存文件不存在或不可读取: {e}")))?;
        if !meta.is_file() || meta.file_type().is_symlink() || target.exists() {
            return Err(AppError::InvalidRequest { reason: "暂存资源无效或正式媒体目标已存在，拒绝覆盖".into() });
        }
        resolved.push((source, target));
    }
    Ok(resolved)
}

fn promote_new_asset(source: &Path, target: &Path) -> AppResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        // MoveFileW refuses an existing destination; media can never replace an older asset.
        if unsafe { windows_sys::Win32::Storage::FileSystem::MoveFileW(source_wide.as_ptr(), target_wide.as_ptr()) } == 0 {
            return Err(AppError::Internal(format!("提交新媒体失败，未覆盖旧文件: {}", std::io::Error::last_os_error())));
        }
    }
    #[cfg(not(windows))]
    {
        std::fs::hard_link(source, target).map_err(|e| AppError::Internal(format!("提交新媒体失败: {e}")))?;
        std::fs::remove_file(source).map_err(|e| AppError::Internal(format!("移除已提交暂存失败: {e}")))?;
    }
    Ok(())
}


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
#[serde(rename_all = "camelCase")]
pub struct UIPartAssetCommitItem {
    #[serde(alias = "staging_path")]
    pub staging_path: String,
    #[serde(alias = "relative_path")]
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UIPartTransactionResult {
    pub success: bool,
    pub storage_path: String,
    pub committed_assets: usize,
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
    let committed = commit_uipart_transaction(app, content, Vec::new())?;
    Ok(UIPartsSaveResult { success: committed.success, storage_path: committed.storage_path })
}

#[tauri::command]
pub fn save_uipart_asset(
    app: tauri::AppHandle, part_id: String, file_name: String, base64_data: String,
) -> AppResult<UIPartAssetSaveResult> {
    let staged = stage_uipart_asset(app.clone(), part_id, file_name, base64_data)?;
    let dir = get_uiparts_base_dir(&app)?;
    commit_uipart_assets(app, vec![UIPartAssetCommitItem {
        staging_path: staged.staging_path, relative_path: staged.relative_path.clone(),
    }])?;
    let absolute = resolve_uipart_asset_path(&dir, &staged.relative_path).map_err(AppError::Internal)?;
    Ok(UIPartAssetSaveResult { relative_path: staged.relative_path, absolute_path: absolute.to_string_lossy().into() })
}

#[tauri::command]
pub fn stage_uipart_asset(
    app: tauri::AppHandle,
    part_id: String,
    file_name: String,
    base64_data: String,
) -> AppResult<UIPartAssetStageResult> {
    let _guard = UIPART_WRITE_LOCK.lock().map_err(|e| AppError::Internal(format!("UI Parts 提交锁损坏: {e}")))?;
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
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let nonce = format!("{timestamp}-{}-{}", std::process::id(), MEDIA_NONCE.fetch_add(1, Ordering::Relaxed));
    let target_filename = format!("asset-{nonce}.{detected_ext}");
    let staging_filename = format!(".staging-{nonce}.{detected_ext}");
    let staging_file = part_dir.join(&staging_filename);

    use std::io::Write;
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&staging_file)
        .map_err(|e| AppError::Internal(format!("创建新暂存文件失败: {e}")))?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(&staging_file);
        return Err(AppError::Internal(format!("写入暂存媒体失败: {error}")));
    }
    drop(file);

    let rel_target = format!("assets/{part_id}/{target_filename}");
    let staging_rel = format!("assets/{part_id}/{staging_filename}");
    staged_owners().lock().map_err(|e| AppError::Internal(format!("暂存归属锁损坏: {e}")))?
        .insert(staging_rel.clone(), StagedAssetOwner { base_dir: dir, part_id, target: rel_target.clone() });

    Ok(UIPartAssetStageResult {
        staging_path: staging_rel,
        relative_path: rel_target,
    })
}

#[tauri::command]
pub fn commit_uipart_assets(app: tauri::AppHandle, items: Vec<UIPartAssetCommitItem>) -> AppResult<bool> {
    let _guard = UIPART_WRITE_LOCK.lock().map_err(|e| AppError::Internal(format!("UI Parts 提交锁损坏: {e}")))?;
    let dir = get_uiparts_base_dir(&app)?;
    let mut owners = staged_owners().lock().map_err(|e| AppError::Internal(format!("暂存归属锁损坏: {e}")))?;
    let resolved = preflight_assets(&dir, &items, &owners)?;
    for (item, (source, target)) in items.iter().zip(resolved) {
        promote_new_asset(&source, &target)?;
        owners.remove(&item.staging_path);
    }
    Ok(true)
}

#[tauri::command]
pub fn commit_uipart_transaction(
    app: tauri::AppHandle, content: String, staged_items: Vec<UIPartAssetCommitItem>,
) -> AppResult<UIPartTransactionResult> {
    let _guard = UIPART_WRITE_LOCK.lock().map_err(|e| AppError::Internal(format!("UI Parts 提交锁损坏: {e}")))?;
    let dir = get_uiparts_base_dir(&app)?;
    let target_index = dir.join("index.json");
    let (parts, references) = index_references(&content)?;
    let mut owners = staged_owners().lock().map_err(|e| AppError::Internal(format!("暂存归属锁损坏: {e}")))?;
    let resolved = preflight_assets(&dir, &staged_items, &owners)?;
    let staged_targets: HashSet<String> = staged_items.iter().map(|item| item.relative_path.clone()).collect();
    for item in &staged_items {
        let owner = owners.get(&item.staging_path).ok_or_else(|| AppError::InvalidRequest { reason: "未知暂存媒体".into() })?;
        if !parts.contains(&owner.part_id) || references.get(&item.relative_path) != Some(&owner.part_id) {
            return Err(AppError::InvalidRequest { reason: "索引未引用本次媒体，或引用零件归属不符".into() });
        }
    }
    let old_refs = match std::fs::read_to_string(&target_index) {
        Ok(old) => index_references(&old).map(|(_, refs)| refs).unwrap_or_default(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
        Err(error) => return Err(AppError::Internal(format!("读取旧索引失败，未开始提交: {error}"))),
    };
    for (path, part_id) in &references {
        let target = resolve_uipart_asset_path(&dir, path).map_err(AppError::Internal)?;
        if old_refs.get(path) != Some(part_id) && !staged_targets.contains(path) && !target.is_file() {
            return Err(AppError::InvalidRequest { reason: format!("新媒体引用没有对应文件: {path}") });
        }
    }
    let mut committed_assets = 0;
    for (item, (source, target)) in staged_items.iter().zip(resolved) {
        promote_new_asset(&source, &target)?;
        owners.remove(&item.staging_path);
        committed_assets += 1;
    }
    // New files may remain orphaned if index write fails; old files are never touched.
    crate::modules::atomic_file::write_atomic(&target_index, content.as_bytes())
        .map_err(|e| AppError::Internal(format!("原子写入 UI Parts 索引失败: {e}")))?;
    Ok(UIPartTransactionResult { success: true, storage_path: target_index.to_string_lossy().into(), committed_assets })
}

#[tauri::command]
pub fn discard_uipart_assets(app: tauri::AppHandle, staging_paths: Vec<String>) -> AppResult<bool> {
    let _guard = UIPART_WRITE_LOCK.lock().map_err(|e| AppError::Internal(format!("UI Parts 提交锁损坏: {e}")))?;
    let dir = get_uiparts_base_dir(&app)?;
    let mut owners = staged_owners().lock().map_err(|e| AppError::Internal(format!("暂存归属锁损坏: {e}")))?;
    let mut files = Vec::new();
    for path in staging_paths {
        let file = resolve_uipart_asset_path(&dir, &path).map_err(AppError::Internal)?;
        if !file.file_name().and_then(|n| n.to_str()).is_some_and(|name| name.starts_with(".staging-")) {
            return Err(AppError::InvalidRequest { reason: "清理命令只接受后端暂存媒体，不能删除正式文件".into() });
        }
        match owners.get(&path) {
            Some(owner) if owner.base_dir.as_path() == dir.as_path() => files.push((path, file)),
            None if !file.exists() => {}
            _ => return Err(AppError::InvalidRequest { reason: "暂存不属于本次后端创建的资源，拒绝清理".into() }),
        }
    }
    for (path, file) in files {
        match std::fs::remove_file(&file) {
            Ok(()) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(AppError::Internal(format!("清理暂存失败: {error}"))),
        }
        owners.remove(&path);
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
