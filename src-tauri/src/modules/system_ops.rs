//! System Operations — Command runner, Winget Search & Show, Streaming Execution, Explorer reveal, and Editor launching.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::LazyLock;
use tauri::Emitter;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Resolves an authentic absolute path within %SystemRoot%\System32.
pub fn system32_executable(name: &str) -> PathBuf {
    let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    PathBuf::from(sys_root).join("System32").join(name)
}

/// Escapes and quotes an argument safely for Windows command execution.
pub fn quote_windows_arg(arg: &str) -> String {
    if !arg.contains(' ') && !arg.contains('\t') && !arg.contains('"') && !arg.is_empty() {
        return arg.to_string();
    }
    let mut escaped = String::from("\"");
    let mut backslashes = 0;
    for c in arg.chars() {
        if c == '\\' {
            backslashes += 1;
        } else if c == '"' {
            for _ in 0..(backslashes * 2 + 1) {
                escaped.push('\\');
            }
            escaped.push('"');
            backslashes = 0;
        } else {
            for _ in 0..backslashes {
                escaped.push('\\');
            }
            backslashes = 0;
            escaped.push(c);
        }
    }
    for _ in 0..(backslashes * 2) {
        escaped.push('\\');
    }
    escaped.push('"');
    escaped
}

static PROCESS_TABLE: LazyLock<crate::modules::task::ProcessTable> =
    LazyLock::new(|| crate::modules::task::ProcessTable::new());

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
    let (prog, proc_args) = if cfg!(windows) && matches!(program, "npm" | "npx" | "pnpm" | "yarn") {
        let mut full = vec!["/c".to_string(), program.to_string()];
        full.extend_from_slice(args);
        ("cmd", full)
    } else {
        (program, args.to_vec())
    };

    let mut spec = crate::modules::process::ProcessSpec::new(prog, &proc_args)
        .with_timeout(std::time::Duration::from_secs(60));

    if let Some(dir) = cwd {
        if !dir.is_empty() {
            spec = spec.with_cwd(PathBuf::from(dir));
        }
    }

    let res = crate::modules::process::execute_process(&spec)?;

    Ok(CommandOutput {
        success: res.exit_code == Some(0),
        exit_code: res.exit_code,
        stdout: res.stdout,
        stderr: res.stderr,
    })
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
    let generation = PROCESS_TABLE.next_generation();

    let job = crate::modules::task::JobObjectGuard::new().ok().map(std::sync::Arc::new);
    #[cfg(windows)]
    if let Some(ref j) = job {
        use std::os::windows::io::AsRawHandle;
        let handle = child.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE;
        let _ = j.assign_process(handle);
    }

    if let Err(e) = PROCESS_TABLE.register(&execution_id, &execution_id, generation, pid, job) {
        let _ = child.kill();
        return Err(e);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let win_out = window.clone();
    let exec_out = execution_id.clone();
    let t_out = std::thread::spawn(move || {
        if let Some(mut stream) = stdout {
            let mut decoder = crate::modules::process::IncrementalDecoder::new();
            let mut buf = [0u8; 4096];
            loop {
                match stream.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = decoder.feed(&buf[..n]);
                        if !text.is_empty() {
                            let _ = win_out.emit("native://stdout", StreamLinePayload {
                                execution_id: exec_out.clone(),
                                text,
                            });
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            let flushed = decoder.flush();
            if !flushed.is_empty() {
                let _ = win_out.emit("native://stdout", StreamLinePayload {
                    execution_id: exec_out.clone(),
                    text: flushed,
                });
            }
        }
    });

    let win_err = window.clone();
    let exec_err = execution_id.clone();
    let t_err = std::thread::spawn(move || {
        if let Some(mut stream) = stderr {
            let mut decoder = crate::modules::process::IncrementalDecoder::new();
            let mut buf = [0u8; 4096];
            loop {
                match stream.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = decoder.feed(&buf[..n]);
                        if !text.is_empty() {
                            let _ = win_err.emit("native://stderr", StreamLinePayload {
                                execution_id: exec_err.clone(),
                                text,
                            });
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            let flushed = decoder.flush();
            if !flushed.is_empty() {
                let _ = win_err.emit("native://stderr", StreamLinePayload {
                    execution_id: exec_err.clone(),
                    text: flushed,
                });
            }
        }
    });

    let win_exit = window;
    let exec_exit = execution_id.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        let _ = t_out.join();
        let _ = t_err.join();

        PROCESS_TABLE.unregister(&exec_exit, generation);

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
    PROCESS_TABLE.cancel(execution_id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDownloadResult {
    pub success: bool,
    pub destination_path: String,
    pub size_bytes: u64,
    pub sha256_verified: bool,
}

/// Resolves and strictly validates a target destination file for downloads.
/// Enforces path policy:
/// - Filename component is verified via `validate_fs_component` (rejects traversal, reserved device names, ADS, illegal chars).
/// - Destination root must be inside an allowed directory (user Downloads, LocalAppData, UserProfile, Temp).
/// - Rejects UNC paths, Windows system directory (`%SystemRoot%`), and raw drive roots.
/// - Checks ancestor reparse points / junctions.
pub fn resolve_and_validate_download_target(
    filename: &str,
    target_dir: Option<&str>,
) -> Result<PathBuf, String> {
    let clean_filename = crate::modules::path_policy::validate_fs_component(filename)
        .map_err(|e| format!("下载文件名无效: {e}"))?;

    let base_dir = if let Some(dir) = target_dir {
        let trimmed = dir.trim();
        if trimmed.is_empty() {
            PathBuf::from(get_downloads_dir()?)
        } else {
            PathBuf::from(trimmed)
        }
    } else {
        PathBuf::from(get_downloads_dir()?)
    };

    let dir_str = base_dir.to_string_lossy().to_string();
    if dir_str.starts_with(r"\\") {
        return Err("不支持网络 UNC 或设备命名空间下载路径".into());
    }

    // Check system root
    let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string()).to_lowercase();
    if dir_str.to_lowercase().starts_with(&sys_root) {
        return Err("安全策略限制：禁止向 Windows 系统目录下载文件".into());
    }

    // Reject drive roots (e.g. C:\, D:\)
    if dir_str.trim_end_matches(['\\', '/']).len() <= 3 {
        return Err("安全策略限制：禁止直接向驱动器根目录下载文件".into());
    }

    // Verify allowed roots containment:
    let downloads_dir = get_downloads_dir().unwrap_or_default();
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    let temp_dir = std::env::temp_dir().to_string_lossy().to_string();

    let is_allowed_root = (!downloads_dir.is_empty() && dir_str.to_lowercase().starts_with(&downloads_dir.to_lowercase()))
        || (!local_app_data.is_empty() && dir_str.to_lowercase().starts_with(&local_app_data.to_lowercase()))
        || (!user_profile.is_empty() && dir_str.to_lowercase().starts_with(&user_profile.to_lowercase()))
        || (!temp_dir.is_empty() && dir_str.to_lowercase().starts_with(&temp_dir.to_lowercase()));

    if !is_allowed_root {
        return Err(format!("目标下载目录 '{dir_str}' 不在受控用户下载或工作区白名单范围内"));
    }

    crate::modules::path_policy::reject_reparse_chain(&base_dir)
        .map_err(|e| format!("下载目录包含不安全重解析点: {e}"))?;

    if !base_dir.exists() {
        std::fs::create_dir_all(&base_dir)
            .map_err(|e| format!("创建下载目标目录失败: {e}"))?;
    }

    Ok(base_dir.join(clean_filename))
}

/// Downloads a URL directly into a temporary `.part` file, performs integrity validation,
/// and atomically replaces/moves the partial file to `target_path`.
/// Ensures interrupted downloads do not overwrite or leave corrupt destination files.
pub fn download_file_stream(
    url: &str,
    target_path: &Path,
    expected_sha256: Option<&str>,
) -> Result<NativeDownloadResult, String> {
    let clean_url = url.trim();
    if !clean_url.starts_with("https://") && !clean_url.starts_with("http://") {
        return Err("仅支持通过 http 或 https 协议下载文件".into());
    }

    let parent_dir = target_path.parent().ok_or("无法解析目标目录")?;
    let pid = std::process::id();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let part_name = format!(".setup-center-download-{pid}-{now}.part");
    let part_path = parent_dir.join(&part_name);

    #[cfg(windows)]
    {
        let curl_bin = system32_executable("curl.exe");
        let mut cmd = Command::new(curl_bin);
        cmd.args(["-fL", "--silent", "--show-error", "-o", &part_path.to_string_lossy(), clean_url]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let out = match cmd.output() {
            Ok(o) => o,
            Err(e) => {
                let _ = std::fs::remove_file(&part_path);
                return Err(format!("无法调用 curl 下载: {e}"));
            }
        };

        if !out.status.success() {
            let _ = std::fs::remove_file(&part_path);
            let err = crate::modules::detect::decode_console_output(&out.stderr);
            return Err(format!("下载失败 (curl 退出码 {:?}): {err}", out.status.code()));
        }
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("curl");
        cmd.args(["-fL", "--silent", "--show-error", "-o", &part_path.to_string_lossy(), clean_url]);
        let out = match cmd.output() {
            Ok(o) => o,
            Err(e) => {
                let _ = std::fs::remove_file(&part_path);
                return Err(format!("curl 执行失败: {e}"));
            }
        };

        if !out.status.success() {
            let _ = std::fs::remove_file(&part_path);
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("下载失败: {err}"));
        }
    }

    if !part_path.exists() {
        return Err("下载未能生成文件".into());
    }

    let meta = std::fs::metadata(&part_path).map_err(|e| {
        let _ = std::fs::remove_file(&part_path);
        format!("读取下载临时文件信息失败: {e}")
    })?;

    let size_bytes = meta.len();
    if size_bytes == 0 {
        let _ = std::fs::remove_file(&part_path);
        return Err("下载内容为空 (0 字节)".into());
    }

    let mut sha256_verified = false;
    if let Some(hash) = expected_sha256 {
        let hash_clean = hash.trim();
        if !hash_clean.is_empty() {
            let match_ok = verify_file_sha256(&part_path.to_string_lossy(), hash_clean)?;
            if !match_ok {
                let _ = std::fs::remove_file(&part_path);
                return Err(format!("下载文件 SHA256 校验不匹配: 期望 {hash_clean}"));
            }
            sha256_verified = true;
        }
    }

    // Atomic replacement / promotion to destination
    if target_path.exists() {
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            let target_wide: Vec<u16> = target_path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let part_wide: Vec<u16> = part_path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();

            let success = unsafe {
                windows_sys::Win32::Storage::FileSystem::ReplaceFileW(
                    target_wide.as_ptr(),
                    part_wide.as_ptr(),
                    std::ptr::null(),
                    0,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            };

            if success == 0 {
                let err = std::io::Error::last_os_error();
                let _ = std::fs::remove_file(&part_path);
                return Err(format!("原子替换目标文件失败: {err}"));
            }
        }
        #[cfg(not(windows))]
        {
            if let Err(e) = std::fs::rename(&part_path, target_path) {
                let _ = std::fs::remove_file(&part_path);
                return Err(format!("原子替换目标文件失败: {e}"));
            }
        }
    } else {
        if let Err(e) = std::fs::rename(&part_path, target_path) {
            let _ = std::fs::remove_file(&part_path);
            return Err(format!("重命名目标文件失败: {e}"));
        }
    }

    if !target_path.exists() {
        return Err("目标文件落盘确认失败".into());
    }

    Ok(NativeDownloadResult {
        success: true,
        destination_path: target_path.to_string_lossy().to_string(),
        size_bytes,
        sha256_verified,
    })
}

pub fn download_file(url: &str, destination_path: &str) -> Result<NativeDownloadResult, String> {
    let p = Path::new(destination_path);
    let file_name = p.file_name().and_then(|n| n.to_str()).ok_or("无效的文件名")?;
    let parent_dir = p.parent().map(|d| d.to_string_lossy().to_string());
    let validated = resolve_and_validate_download_target(file_name, parent_dir.as_deref())?;
    download_file_stream(url, &validated, None)
}

pub fn download_asset_controlled(
    url: &str,
    filename: &str,
    destination_dir: Option<&str>,
    expected_sha256: Option<&str>,
) -> Result<NativeDownloadResult, String> {
    let target = resolve_and_validate_download_target(filename, destination_dir)?;
    download_file_stream(url, &target, expected_sha256)
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
        let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let explorer_bin = PathBuf::from(sys_root).join("explorer.exe");
        let mut cmd = Command::new(explorer_bin);
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

pub fn open_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("https://") {
        return Err("仅支持通过系统默认浏览器打开 https:// 安全链接，拒绝非 https 协议或本地文件".into());
    }

    if trimmed.contains('\0') || trimmed.contains('\r') || trimmed.contains('\n') || trimmed.contains('"') {
        return Err("URL 包含非法控制字符".into());
    }

    #[cfg(windows)]
    {
        let rundll = system32_executable("rundll32.exe");
        let mut cmd = Command::new(rundll);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.args(["url.dll,FileProtocolHandler", trimmed]);
        cmd.spawn()
            .map_err(|e| format!("打开系统默认浏览器失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("打开系统默认浏览器失败: {e}"))?;
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

    #[cfg(windows)]
    let mut command = Command::new(system32_executable("where.exe"));
    #[cfg(not(windows))]
    let mut command = Command::new("which");
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

pub fn launch_in_editor(editor: &str, target_path: &str) -> Result<(), String> {
    let clean_editor = editor.trim().to_lowercase();
    let allowed_editors = ["vscode", "cursor", "windsurf", "zed"];
    if !allowed_editors.contains(&clean_editor.as_str()) {
        return Err(format!("不支持的编辑器类型: '{editor}'。仅允许 vscode, cursor, windsurf, zed"));
    }

    let p = Path::new(target_path);
    if !p.exists() {
        return Err(format!("目标工程路径不存在: '{target_path}'"));
    }

    let canonical = p.canonicalize().map_err(|e| format!("路径规范化解析失败: {e}"))?;
    let canonical_str = canonical.to_string_lossy().to_string();

    // Reject drive roots (e.g. C:\, D:\)
    if canonical_str.trim_end_matches(['\\', '/']).len() <= 3 {
        return Err("禁止在编辑器中直接打开驱动器根目录".into());
    }

    // Reject Windows system directory
    let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string()).to_lowercase();
    if canonical_str.to_lowercase().starts_with(&sys_root) {
        return Err("禁止在编辑器中打开 Windows 系统目录".into());
    }

    // Resolve editor executable securely through inventory probe
    let editors = probe_editors();
    let detected = editors.into_iter().find(|e| e.id == clean_editor);
    let resolved_exe = detected.and_then(|e| e.executable_path);

    #[cfg(windows)]
    {
        if let Some(ref path) = resolved_exe {
            if Path::new(path).exists() {
                let mut cmd = Command::new(path);
                cmd.arg(&canonical);
                cmd.creation_flags(CREATE_NO_WINDOW);
                cmd.spawn().map_err(|e| format!("启动编辑器 '{path}' 失败: {e}"))?;
                return Ok(());
            }
        }

        let binary = match clean_editor.as_str() {
            "vscode" => "code",
            "cursor" => "cursor",
            "windsurf" => "windsurf",
            "zed" => "zed",
            _ => return Err("无效的编辑器类型".into()),
        };

        let mut cmd = Command::new(binary);
        cmd.arg(&canonical);
        cmd.creation_flags(CREATE_NO_WINDOW);

        cmd.spawn()
            .map_err(|e| format!("启动编辑器 '{binary}' 失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let binary = match clean_editor.as_str() {
            "vscode" => "code",
            "cursor" => "cursor",
            "windsurf" => "windsurf",
            "zed" => "zed",
            _ => return Err("无效的编辑器类型".into()),
        };
        Command::new(binary)
            .arg(&canonical)
            .spawn()
            .map_err(|e| format!("启动编辑器 '{binary}' 失败: {e}"))?;
        Ok(())
    }
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
        let certutil_bin = system32_executable("certutil.exe");
        let mut cmd = Command::new(certutil_bin);
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

    #[test]
    fn download_target_validation_rejects_illegal_components_and_traversal() {
        assert!(resolve_and_validate_download_target("..", None).is_err());
        assert!(resolve_and_validate_download_target("../evil.exe", None).is_err());
        assert!(resolve_and_validate_download_target("CON.txt", None).is_err());
        assert!(resolve_and_validate_download_target("bad:stream.txt", None).is_err());
        assert!(resolve_and_validate_download_target("trailing. ", None).is_err());
    }

    #[test]
    fn download_target_validation_rejects_system_directory_and_drive_root() {
        assert!(resolve_and_validate_download_target("test.zip", Some(r"C:\Windows\System32")).is_err());
        assert!(resolve_and_validate_download_target("test.zip", Some(r"C:\")).is_err());
        assert!(resolve_and_validate_download_target("test.zip", Some(r"\\evil\share")).is_err());
    }

    #[test]
    fn download_target_validation_accepts_clean_filename() {
        let res = resolve_and_validate_download_target("valid-asset-1.0.0.zip", None);
        assert!(res.is_ok());
        let target = res.unwrap();
        assert!(target.to_string_lossy().ends_with("valid-asset-1.0.0.zip"));
    }
}
