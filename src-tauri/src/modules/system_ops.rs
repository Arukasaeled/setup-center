//! System Operations — Command runner, Winget Search & Show, Streaming Execution, Explorer reveal, and Editor launching.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use tauri::Emitter;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

static PROCESS_TABLE: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

pub fn run_command(
    program: &str,
    args: &[String],
    cwd: Option<&str>,
) -> Result<CommandOutput, String> {
    let mut cmd = if cfg!(windows) && matches!(program, "npm" | "npx" | "pnpm" | "yarn") {
        let mut c = Command::new("cmd");
        c.args(["/c", program]);
        c.args(args);
        c
    } else {
        let mut c = Command::new(program);
        c.args(args);
        c
    };

    if let Some(dir) = cwd {
        if !dir.is_empty() {
            cmd.current_dir(dir);
        }
    }

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(out) => {
            let stdout = crate::modules::detect::decode_console_output(&out.stdout);
            let stderr = crate::modules::detect::decode_console_output(&out.stderr);
            Ok(CommandOutput {
                success: out.status.success(),
                exit_code: out.status.code(),
                stdout,
                stderr,
            })
        }
        Err(e) => Err(format!("无法启动进程 '{program}': {e}")),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamLinePayload {
    pub execution_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamExitPayload {
    pub execution_id: String,
    pub exit_code: Option<i32>,
    pub success: bool,
}

pub fn spawn_streaming_command(
    window: tauri::Window,
    execution_id: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    let mut cmd = if cfg!(windows) && matches!(program.as_str(), "npm" | "npx" | "pnpm" | "yarn") {
        let mut c = Command::new("cmd");
        c.args(["/c", &program]);
        c.args(&args);
        c
    } else {
        let mut c = Command::new(&program);
        c.args(&args);
        c
    };

    if let Some(ref dir) = cwd {
        if !dir.is_empty() {
            cmd.current_dir(dir);
        }
    }

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("无法启动 '{program}': {e}"))?;
    let pid = child.id();

    {
        if let Ok(mut map) = PROCESS_TABLE.lock() {
            map.insert(execution_id.clone(), pid);
        }
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let win_out = window.clone();
    let exec_out = execution_id.clone();
    let t_out = std::thread::spawn(move || {
        if let Some(out) = stdout {
            let reader = BufReader::new(out);
            for line in reader.lines() {
                if let Ok(l) = line {
                    let _ = win_out.emit("native://stdout", StreamLinePayload {
                        execution_id: exec_out.clone(),
                        text: l,
                    });
                }
            }
        }
    });

    let win_err = window.clone();
    let exec_err = execution_id.clone();
    let t_err = std::thread::spawn(move || {
        if let Some(err) = stderr {
            let reader = BufReader::new(err);
            for line in reader.lines() {
                if let Ok(l) = line {
                    let _ = win_err.emit("native://stderr", StreamLinePayload {
                        execution_id: exec_err.clone(),
                        text: l,
                    });
                }
            }
        }
    });

    let win_exit = window;
    let exec_exit = execution_id.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        let _ = t_out.join();
        let _ = t_err.join();

        if let Ok(mut map) = PROCESS_TABLE.lock() {
            map.remove(&exec_exit);
        }

        let (exit_code, success) = match status {
            Ok(s) => (s.code(), s.success()),
            Err(_) => (Some(-1), false),
        };

        let _ = win_exit.emit("native://exit", StreamExitPayload {
            execution_id: exec_exit,
            exit_code,
            success,
        });
    });

    Ok(())
}

pub fn cancel_process(execution_id: &str) -> Result<bool, String> {
    let pid = {
        let map = PROCESS_TABLE.lock().map_err(|e| e.to_string())?;
        map.get(execution_id).copied()
    };

    if let Some(pid) = pid {
        #[cfg(windows)]
        {
            let mut cmd = Command::new("taskkill");
            cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            let _ = cmd.output();
        }
        #[cfg(not(windows))]
        {
            let mut cmd = Command::new("kill");
            cmd.args(["-9", &pid.to_string()]);
            let _ = cmd.output();
        }
        Ok(true)
    } else {
        Ok(false)
    }
}

pub fn download_file(url: &str, destination_path: &str) -> Result<(), String> {
    let p = Path::new(destination_path);
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    #[cfg(windows)]
    {
        let mut cmd = Command::new("curl.exe");
        cmd.args(["-fL", "--create-dirs", "-o", destination_path, url]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        match cmd.output() {
            Ok(out) => {
                if out.status.success() {
                    Ok(())
                } else {
                    let err = crate::modules::detect::decode_console_output(&out.stderr);
                    Err(format!("下载失败: {err}"))
                }
            }
            Err(e) => Err(format!("无法调用 curl 下载: {e}")),
        }
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("curl");
        cmd.args(["-fL", "-o", destination_path, url]);
        match cmd.output() {
            Ok(out) => {
                if out.status.success() {
                    Ok(())
                } else {
                    Err("下载失败".to_string())
                }
            }
            Err(e) => Err(format!("curl 未找到: {e}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WingetSearchResultItem {
    pub name: String,
    pub id: String,
    pub version: String,
    pub match_type: Option<String>,
    pub source: Option<String>,
}

pub fn search_winget(query: &str) -> Result<Vec<WingetSearchResultItem>, String> {
    let mut cmd = Command::new("winget");
    cmd.args([
        "search",
        query,
        "--accept-source-agreements",
        "-n",
        "25",
    ]);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = match cmd.output() {
        Ok(o) => o,
        Err(e) => return Err(format!("winget 未找到或无法执行: {e}")),
    };

    let text = crate::modules::detect::decode_console_output(&out.stdout);
    let mut results = Vec::new();
    let lines: Vec<&str> = text.lines().collect();

    let mut header_idx = None;
    for (i, line) in lines.iter().enumerate() {
        if line.contains("---") && i > 0 {
            header_idx = Some(i - 1);
            break;
        }
    }

    let Some(h_idx) = header_idx else {
        return Ok(results);
    };

    let header_line = lines[h_idx];

    // Find column offsets
    let id_pos = header_line.find("Id").or_else(|| header_line.find("ID"));
    let ver_pos = header_line.find("Version").or_else(|| header_line.find("版本"));
    let source_pos = header_line.find("Source").or_else(|| header_line.find("源"));

    for line in &lines[(h_idx + 2)..] {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let (Some(id_p), Some(ver_p)) = (id_pos, ver_pos) {
            if line.len() > id_p {
                let name = line[..id_p].trim().to_string();
                let rest_from_id = &line[id_p..];

                let (id, version, source) = if let Some(src_p) = source_pos {
                    let id_part = if line.len() > ver_p {
                        line[id_p..ver_p].trim()
                    } else {
                        rest_from_id.trim()
                    };
                    let ver_part = if line.len() > src_p && ver_p < src_p {
                        line[ver_p..src_p].trim()
                    } else {
                        ""
                    };
                    let src_part = if line.len() > src_p {
                        line[src_p..].trim()
                    } else {
                        "winget"
                    };
                    (
                        id_part.to_string(),
                        ver_part.to_string(),
                        Some(src_part.to_string()),
                    )
                } else {
                    let id_part = if line.len() > ver_p {
                        line[id_p..ver_p].trim()
                    } else {
                        rest_from_id.trim()
                    };
                    let ver_part = if line.len() > ver_p {
                        line[ver_p..].trim()
                    } else {
                        ""
                    };
                    (
                        id_part.to_string(),
                        ver_part.to_string(),
                        Some("winget".to_string()),
                    )
                };

                if !name.is_empty() && !id.is_empty() {
                    results.push(WingetSearchResultItem {
                        name,
                        id,
                        version: if version.is_empty() {
                            "latest".to_string()
                        } else {
                            version
                        },
                        match_type: None,
                        source,
                    });
                    continue;
                }
            }
        }

        // Fallback token split
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 2 {
            results.push(WingetSearchResultItem {
                name: parts[0].to_string(),
                id: parts[1].to_string(),
                version: parts.get(2).copied().unwrap_or("latest").to_string(),
                match_type: None,
                source: parts.get(3).copied().map(String::from),
            });
        }
    }

    Ok(results)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WingetPackageDetails {
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    pub publisher: Option<String>,
    pub description: Option<String>,
    pub homepage: Option<String>,
    pub license: Option<String>,
    pub installer_type: Option<String>,
    pub installer_url: Option<String>,
    pub installer_sha256: Option<String>,
    pub source: Option<String>,
}

pub fn show_winget(package_id: &str) -> Result<WingetPackageDetails, String> {
    let mut cmd = Command::new("winget");
    cmd.args([
        "show",
        "--id",
        package_id,
        "-e",
        "--accept-source-agreements",
    ]);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = match cmd.output() {
        Ok(o) => o,
        Err(e) => return Err(format!("winget 执行异常: {e}")),
    };

    let text = crate::modules::detect::decode_console_output(&out.stdout);
    if text.trim().is_empty() {
        return Err(format!("未查询到软件包: {package_id}"));
    }

    let mut details = WingetPackageDetails {
        id: package_id.to_string(),
        name: package_id.to_string(),
        version: None,
        publisher: None,
        description: None,
        homepage: None,
        license: None,
        installer_type: None,
        installer_url: None,
        installer_sha256: None,
        source: Some("winget".to_string()),
    };

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.starts_with("Found ") || trimmed.starts_with("已找到 ") {
            if let Some(start) = trimmed.find(' ') {
                let rest = trimmed[start..].trim();
                if let Some(bracket) = rest.find('[') {
                    details.name = rest[..bracket].trim().to_string();
                }
            }
        }

        if let Some((k, v)) = trimmed.split_once(':') {
            let key = k.trim().to_lowercase();
            let val = v.trim().to_string();
            if val.is_empty() {
                continue;
            }

            match key.as_str() {
                "version" | "版本" => details.version = Some(val),
                "publisher" | "发布者" => details.publisher = Some(val),
                "author" | "作者" if details.publisher.is_none() => details.publisher = Some(val),
                "description" | "描述" => details.description = Some(val),
                "homepage" | "主页" | "publisher url" => details.homepage = Some(val),
                "license" | "许可证" => details.license = Some(val),
                "installer type" | "安装程序类型" => details.installer_type = Some(val),
                "installer url" | "安装程序 url" => details.installer_url = Some(val),
                "installer sha256" | "安装程序 sha256" => details.installer_sha256 = Some(val),
                _ => {}
            }
        }
    }

    Ok(details)
}

pub fn reveal_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("目标路径不存在: {path}"));
    }

    #[cfg(windows)]
    {
        let mut cmd = Command::new("explorer");
        cmd.creation_flags(CREATE_NO_WINDOW);
        if p.is_file() {
            cmd.arg(format!("/select,\"{}\"", path));
        } else {
            cmd.arg(path);
        }
        cmd.spawn()
            .map_err(|e| format!("打开资源管理器失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("open").arg(path).spawn();
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedEditor {
    pub id: String,
    pub name: String,
    pub command: String,
    pub installed: bool,
    pub executable_path: Option<String>,
}

pub fn probe_editors() -> Vec<DetectedEditor> {
    let mut result = Vec::new();

    // 1. VS Code
    let (vscode_installed, vscode_path) = find_editor(
        "code",
        &[
            r"Microsoft VS Code\Code.exe",
            r"Programs\Microsoft VS Code\Code.exe",
        ],
    );
    result.push(DetectedEditor {
        id: "vscode".to_string(),
        name: "VS Code".to_string(),
        command: "code".to_string(),
        installed: vscode_installed,
        executable_path: vscode_path,
    });

    // 2. Cursor
    let (cursor_installed, cursor_path) = find_editor(
        "cursor",
        &[
            r"Programs\cursor\Cursor.exe",
            r"Cursor\Cursor.exe",
            r"Programs\Cursor\Cursor.exe",
        ],
    );
    result.push(DetectedEditor {
        id: "cursor".to_string(),
        name: "Cursor".to_string(),
        command: "cursor".to_string(),
        installed: cursor_installed,
        executable_path: cursor_path,
    });

    // 3. Windsurf
    let (windsurf_installed, windsurf_path) = find_editor(
        "windsurf",
        &[
            r"Programs\Windsurf\Windsurf.exe",
            r"Windsurf\Windsurf.exe",
        ],
    );
    result.push(DetectedEditor {
        id: "windsurf".to_string(),
        name: "Windsurf".to_string(),
        command: "windsurf".to_string(),
        installed: windsurf_installed,
        executable_path: windsurf_path,
    });

    // 4. Zed
    let (zed_installed, zed_path) = find_editor(
        "zed",
        &[
            r"Programs\Zed\Zed.exe",
            r"Zed\Zed.exe",
        ],
    );
    result.push(DetectedEditor {
        id: "zed".to_string(),
        name: "Zed".to_string(),
        command: "zed".to_string(),
        installed: zed_installed,
        executable_path: zed_path,
    });

    result
}

fn find_editor(cmd: &str, subpaths: &[&str]) -> (bool, Option<String>) {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let program_files = std::env::var("ProgramFiles").unwrap_or_default();
    let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();

    let roots = [&local_app_data, &program_files, &program_files_x86];
    for root in roots {
        if root.is_empty() {
            continue;
        }
        for sub in subpaths {
            let full = PathBuf::from(root).join(sub);
            if full.exists() {
                return (true, Some(full.to_string_lossy().to_string()));
            }
        }
    }

    let mut command = Command::new("where");
    command.arg(cmd);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    if let Ok(out) = command.output() {
        if out.status.success() && !out.stdout.is_empty() {
            let decoded = crate::modules::detect::decode_console_output(&out.stdout);
            let first_line = decoded.lines().next().unwrap_or("").trim();
            if !first_line.is_empty() {
                return (true, Some(first_line.to_string()));
            }
            return (true, None);
        }
    }

    (false, None)
}

pub fn launch_in_editor(editor: &str, target_path: &str, executable_path: Option<&str>) -> Result<(), String> {
    if let Some(path) = executable_path {
        if Path::new(path).exists() {
            let mut cmd = Command::new(path);
            cmd.arg(target_path);
            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.spawn().map_err(|e| format!("启动编辑器 '{path}' 失败: {e}"))?;
            return Ok(());
        }
    }

    let binary = match editor {
        "vscode" | "code" => "code",
        "cursor" => "cursor",
        "windsurf" => "windsurf",
        "zed" => "zed",
        other => other,
    };

    let mut cmd = Command::new(binary);
    cmd.arg(target_path);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.spawn()
        .map_err(|e| format!("启动编辑器 '{binary}' 失败: {e}"))?;
    Ok(())
}

/// Resolves the user's authentic Downloads directory.
pub fn get_downloads_dir() -> Result<String, String> {
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let p = Path::new(&profile).join("Downloads");
            if p.exists() {
                return Ok(p.to_string_lossy().to_string());
            }
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = Path::new(&home).join("Downloads");
        if p.exists() {
            return Ok(p.to_string_lossy().to_string());
        }
    }
    Ok(std::env::temp_dir().to_string_lossy().to_string())
}

/// Verifies a file's SHA256 checksum against an expected hash string.
pub fn verify_file_sha256(path: &str, expected_hash: &str) -> Result<bool, String> {
    let clean_expected = expected_hash.trim().to_lowercase().replace(" ", "").replace("-", "");
    if clean_expected.is_empty() {
        return Ok(true);
    }
    #[cfg(windows)]
    {
        let mut cmd = Command::new("certutil");
        cmd.args(["-hashfile", path, "SHA256"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let out = cmd.output().map_err(|e| format!("certutil 校验失败: {e}"))?;
        let text = crate::modules::detect::decode_console_output(&out.stdout);
        for line in text.lines() {
            let clean_line = line.trim().to_lowercase().replace(" ", "").replace("-", "");
            if !clean_line.is_empty() && clean_line == clean_expected {
                return Ok(true);
            }
        }
        Ok(false)
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("sha256sum");
        cmd.arg(path);
        let out = cmd.output().map_err(|e| format!("sha256sum 校验失败: {e}"))?;
        let text = String::from_utf8_lossy(&out.stdout);
        Ok(text.to_lowercase().contains(&clean_expected))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_simple_command_succeeds() {
        let res = run_command("cmd", &["/c".to_string(), "echo hello".to_string()], None);
        assert!(res.is_ok());
        let out = res.unwrap();
        assert!(out.success);
        assert!(out.stdout.contains("hello"));
    }

    #[test]
    fn probe_editors_returns_expected_entries() {
        let editors = probe_editors();
        assert_eq!(editors.len(), 4);
        assert!(editors.iter().any(|e| e.id == "vscode"));
        assert!(editors.iter().any(|e| e.id == "cursor"));
        assert!(editors.iter().any(|e| e.id == "windsurf"));
        assert!(editors.iter().any(|e| e.id == "zed"));
    }
}
