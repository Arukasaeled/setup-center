//! Storage policy and disk management commands (Issue K01).

use crate::model::{AppError, AppResult, StoragePolicy};
use crate::modules::{detect, storage};
use crate::state::AppState;
use tauri::State;

/// Gets the effective installation storage policy.
#[tauri::command]
pub fn get_storage_policy(state: State<'_, AppState>) -> StoragePolicy {
    let disks = state
        .last_environment()
        .map(|e| e.disks)
        .unwrap_or_else(|| detect::probe_disks(1024));
    storage::get_effective_storage_policy(&disks)
}

/// Sets and persists the installation storage policy.
#[tauri::command]
pub fn set_storage_policy(
    policy: StoragePolicy,
    _state: State<'_, AppState>,
) -> AppResult<StoragePolicy> {
    storage::set_storage_policy(policy).map_err(AppError::Internal)
}

/// Invokes a native folder browser dialog to pick a custom installation directory.
#[tauri::command]
pub async fn select_storage_folder() -> AppResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(|| {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "选择软件安装目录"
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
}
"#;
        let mut cmd = std::process::Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(detect::CREATE_NO_WINDOW);
        }
        let out = cmd.output().ok()?;
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if stdout.is_empty() {
            None
        } else {
            Some(stdout)
        }
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))
}

/// Validates a custom directory path before user confirms.
#[tauri::command]
pub fn validate_storage_path(path: String) -> Result<String, String> {
    let sys = storage::detect_system_drive();
    storage::validate_custom_path(&path, &sys)
}

/// Cleans temporary download files in the download directory.
#[tauri::command]
pub fn clean_download_cache() -> AppResult<storage::CleanupResult> {
    let policy = storage::load_effective_policy();
    Ok(storage::clean_downloads_with_policy(&policy))
}
