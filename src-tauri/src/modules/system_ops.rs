//! System Operations — Command runner, Winget Search, Explorer reveal, and Editor launching.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

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
}

pub fn probe_editors() -> Vec<DetectedEditor> {
    let mut result = Vec::new();

    // 1. VS Code
    let vscode_installed = is_command_in_path("code")
        || check_candidate_paths(&[
            r"Microsoft VS Code\Code.exe",
            r"Programs\Microsoft VS Code\Code.exe",
        ]);
    result.push(DetectedEditor {
        id: "vscode".to_string(),
        name: "VS Code".to_string(),
        command: "code".to_string(),
        installed: vscode_installed,
    });

    // 2. Cursor
    let cursor_installed = is_command_in_path("cursor")
        || check_candidate_paths(&[
            r"Programs\cursor\Cursor.exe",
            r"Cursor\Cursor.exe",
        ]);
    result.push(DetectedEditor {
        id: "cursor".to_string(),
        name: "Cursor".to_string(),
        command: "cursor".to_string(),
        installed: cursor_installed,
    });

    // 3. Zed
    let zed_installed = is_command_in_path("zed")
        || check_candidate_paths(&[
            r"Programs\Zed\Zed.exe",
            r"Zed\Zed.exe",
        ]);
    result.push(DetectedEditor {
        id: "zed".to_string(),
        name: "Zed".to_string(),
        command: "zed".to_string(),
        installed: zed_installed,
    });

    result
}

fn check_candidate_paths(subpaths: &[&str]) -> bool {
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
                return true;
            }
        }
    }
    false
}

fn is_command_in_path(cmd: &str) -> bool {
    let mut command = Command::new("where");
    command.arg(cmd);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    match command.output() {
        Ok(out) => out.status.success() && !out.stdout.is_empty(),
        Err(_) => false,
    }
}

pub fn launch_in_editor(editor: &str, target_path: &str) -> Result<(), String> {
    let binary = match editor {
        "vscode" | "code" => "code",
        "cursor" => "cursor",
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
        assert_eq!(editors.len(), 3);
        assert!(editors.iter().any(|e| e.id == "vscode"));
        assert!(editors.iter().any(|e| e.id == "cursor"));
        assert!(editors.iter().any(|e| e.id == "zed"));
    }
}
