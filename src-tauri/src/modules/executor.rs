//! Execution Engine — turning a plan into actions on the machine.
//!
//! This module is the only place in the program that runs something with the
//! intent of changing the system. Everything else is a read.
//!
//! Architecture
//! ------------
//! ```text
//!   InstallSource ──► Executor::prepare ──► PreparedAction
//!                                              │
//!                                              ▼
//!                                          Executor::run
//!                                              │
//!                                              ▼
//!                                          ActionRecord
//! ```
//!
//! Three executors, one per [`InstallSource`] variant that does anything:
//!
//! | executor | source | what it does |
//! |---|---|---|
//! | [`run_winget`] | `Winget` | `winget install --id …` |
//! | [`run_official_installer`] | `OfficialInstaller` | download to a temp file, then hand it to the OS |
//! | [`run_script`] | `Script` | run a documented vendor/package-manager command |
//!
//! **No executor knows a program name.** They receive an [`InstallSource`] and
//! return an [`ActionRecord`]. The mapping from program to source lives in
//! `catalog.rs`; there is no `match` on [`SoftwareId`] anywhere below. That is
//! what makes "不要把安装逻辑写死到软件名称" a structural property rather than a
//! review guideline — adding an eighth program touches the catalog and nothing
//! in this file.
//!
//! Fallback, not failure
//! ---------------------
//! The chain comes from the catalog, in priority order. The engine walks it and
//! stops at the first success. Two outcomes deliberately do *not* advance to the
//! next link:
//!
//! * [`AttemptOutcome::PermissionDenied`] — the next link runs under the same
//!   token, so it fails the same way. Advancing would just double the wait.
//! * [`AttemptOutcome::Cancelled`] — the user asked us to stop.
//!
//! Everything else falls through, which is the `claude-code-toolbox` idea: a
//! strategy that cannot work is not a dead end, it is a reason to try the next
//! one.

use crate::model::*;

use super::detect::{decode_console_output, now_iso8601, run_capture, CREATE_NO_WINDOW};
use super::install::describe_source;
use super::catalog::Catalog;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// How much captured output is kept per action.
///
/// A failed `winget` run can emit megabytes if it retries a download. Keeping
/// all of it would put a wall of text in the session (and the report) that
/// nobody reads; keeping none would make a failure undiagnosable. 32 KiB holds
/// every real failure we have seen, including multi-link fallback chains.
const MAX_OUTPUT_BYTES: usize = 32 * 1024;

/// How long a single installation attempt may take before it is killed.
///
/// Generous, because a first-time `winget install` of Python on a campus network
/// genuinely takes minutes. This is a runaway guard, not a timeout policy.
const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// How long the vendor-installer download may take.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/// A cooperative cancel flag shared with the UI.
///
/// Cancellation must not be done by killing the thread running the command: the
/// child process would survive as an orphan and keep installing. The flag is
/// checked *between* attempts and *during* the download loop, so the engine
/// stops at a point where nothing is half-done.
#[derive(Debug, Clone, Default)]
pub struct CancelFlag(Arc<AtomicBool>);

impl CancelFlag {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

// ---------------------------------------------------------------------------
// The one function that executes anything
// ---------------------------------------------------------------------------

/// Runs one [`InstallSource`] and reports exactly what happened.
///
/// This is the whole execution surface of the program. Every branch either runs
/// a process the vendor or Microsoft supplies, or returns without doing
/// anything. There is deliberately no branch that writes an installer payload:
/// the brief's "不要自己维护二进制" is enforced by [`InstallSource`] having no
/// variant for it, and this function being able to do nothing else.
pub fn execute_source(
    id: SoftwareId,
    source: &InstallSource,
    attempt: u32,
    cancel: &CancelFlag,
) -> ActionRecord {
    let policy = super::storage::load_effective_policy();
    execute_source_with_policy(id, source, attempt, cancel, &policy)
}

/// Runs one [`InstallSource`] using a frozen storage policy snapshot.
pub fn execute_source_with_policy(
    id: SoftwareId,
    source: &InstallSource,
    attempt: u32,
    cancel: &CancelFlag,
    policy: &super::storage::StoragePolicy,
) -> ActionRecord {
    let started = Instant::now();
    let started_at = now_iso8601();

    let (outcome, exit_code, output, error) = match source {
        InstallSource::Winget { package_id } => run_winget(package_id, id, cancel, policy),
        InstallSource::OfficialInstaller { url, kind, vendor_id, .. } => {
            let effective_kind = kind.unwrap_or_else(|| InstallerKind::from_url_pathname(url));
            run_official_installer(url, effective_kind, vendor_id.as_deref(), id, cancel, policy)
        }
        InstallSource::Script { command, program_kind, args } => {
            run_script(command, *program_kind, args.as_deref(), cancel)
        }
        InstallSource::ConfigurationOnly => (
            // Nothing to run. Recorded as a success so a configuration-only step
            // does not appear as a hole in the session, but with an explicit
            // command string so the trace still shows what it stood for.
            AttemptOutcome::Succeeded,
            Some(0),
            "无需安装：仅写入配置".to_string(),
            None,
        ),
    };

    let command_desc = if let InstallSource::Winget { package_id } = source {
        let catalog = Catalog::builtin();
        let entry = catalog.entry(id);
        let args = super::storage::build_winget_args(
            package_id,
            entry.install_location,
            policy,
            entry.storage_subdir,
        );
        format!("winget {}", args.join(" "))
    } else {
        describe_source(source)
    };

    ActionRecord {
        id: Some(id),
        subject_kind: SubjectKind::Software,
        subject_id: id.key().to_string(),
        source: source.clone(),
        command: command_desc,
        started_at,
        finished_at: now_iso8601(),
        duration_ms: started.elapsed().as_millis() as u64,
        outcome,
        exit_code,
        output: truncate(output),
        error,
        attempt,
        final_attempt: false,
    }
}

// ---------------------------------------------------------------------------
// Executor 1: winget
// ---------------------------------------------------------------------------

/// `winget install --id <package> -e --accept-* --silent [--location <path>]`.
fn run_winget(
    package_id: &str,
    id: SoftwareId,
    cancel: &CancelFlag,
    policy: &super::storage::StoragePolicy,
) -> ExecResult {
    if cancel.is_cancelled() {
        return cancelled();
    }

    match winget_version() {
        Ok(version) => {
            // Recorded before the install so the trace shows which winget build
            // attempted it. A surprising winget failure is usually a version
            // characteristic, and without this the log cannot show it.
            let version_note = format!("winget {version}\n");
            let catalog = Catalog::builtin();
            let entry = catalog.entry(id);
            let args_vec = super::storage::build_winget_args(
                package_id,
                entry.install_location,
                policy,
                entry.storage_subdir,
            );
            let args_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();

            match run_process("winget", &args_refs, ATTEMPT_TIMEOUT, cancel) {
                Ok(result) => {
                    let combined = format!("{version_note}{}", result.output);
                    classify(package_id, result.exit_code, combined)
                }
                Err(e) => (
                    AttemptOutcome::Unavailable,
                    None,
                    version_note,
                    Some(format!("无法启动 winget：{e}")),
                ),
            }
        }
        Err(reason) => (
            AttemptOutcome::Unavailable,
            None,
            String::new(),
            Some(format!("winget 不可用：{reason}")),
        ),
    }
}

/// `winget --version`, used both for readiness and for the action trace.
pub fn winget_version() -> Result<String, String> {
    match run_capture("winget", &["--version"]) {
        Ok(text) if !text.trim().is_empty() => {
            Ok(text.trim().trim_start_matches(['v', 'V']).to_string())
        }
        Ok(_) => Err("winget 未返回版本信息".into()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Executor 2: official installer
// ---------------------------------------------------------------------------

/// Downloads a vendor installer and hands it to the OS.
///
/// Two properties matter here:
///
/// 1. **The URL comes from the catalog**, not from this function. Several of
///    these are "latest" endpoints (`update.code.visualstudio.com/latest/…`),
///    which is why [`InstallSource::OfficialInstaller::sha256`] is optional and
///    currently unset — a pinned digest for a rolling endpoint would be wrong
///    within days. The field exists so a pinned build can be added later.
/// 2. **The file is written to our own work directory**, never to a temp path we
///    do not control, and it is removed afterwards. Not maintaining our own
///    binaries means not shipping them; it does not mean leaving them behind.
fn run_official_installer(
    url: &str,
    kind: InstallerKind,
    vendor_id: Option<&str>,
    id: SoftwareId,
    cancel: &CancelFlag,
    policy: &super::storage::StoragePolicy,
) -> ExecResult {
    if cancel.is_cancelled() {
        return cancelled();
    }

    if kind == InstallerKind::Unsupported {
        return (
            AttemptOutcome::Unavailable,
            None,
            format!("不支持的安装包格式：{url}"),
            Some(format!(
                "{url} 无法通过 URL 路径识别为受支持的安装包格式（exe/msi/ps1/cmd/bat）。已拒绝启动。"
            )),
        );
    }

    // Approved script sources policy: ps1 only from allowed vendor/origin
    if kind == InstallerKind::Ps1 {
        let is_allowed_origin = vendor_id == Some("anthropic") || url.starts_with("https://claude.ai/");
        if !is_allowed_origin {
            return (
                AttemptOutcome::Unavailable,
                None,
                format!("未受信任的 PowerShell 脚本来源：{url}"),
                Some("安全策略限制：仅允许来自受信任发行方的受控 PowerShell 安装脚本。".to_string()),
            );
        }
    } else if kind == InstallerKind::Cmd || kind == InstallerKind::Bat {
        let is_allowed = vendor_id.is_some();
        if !is_allowed {
            return (
                AttemptOutcome::Unavailable,
                None,
                format!("未受信任的批处理脚本来源：{url}"),
                Some("安全策略限制：外部 URL 批处理脚本禁止直接执行。".to_string()),
            );
        }
    }

    let extension = kind.extension();
    let filename = format!("{}.{}", id.key(), extension);
    let task_id = format!("dl-{}-{}", id.key(), std::process::id());
    let dir = super::storage::resolve_download_directory(policy);

    let Some(path) = download(url, &filename, &task_id, cancel, policy) else {
        return (
            AttemptOutcome::Unavailable,
            None,
            format!("下载失败：{url}"),
            Some(format!(
                "无法下载官方安装包 {url}。请检查网络后重试，或改用手动安装。"
            )),
        );
    };

    // Format verification per installer kind
    let format_check_result = match kind {
        InstallerKind::Exe => {
            if looks_like_windows_pe(&path) {
                Ok("PE/MZ 文件头验证通过（格式证据，来源真实性标记: provenanceUnknown）")
            } else {
                Err(format!("{url} 返回的内容不是有效的 Windows PE/EXE 程序（缺少 MZ 标记）。"))
            }
        }
        InstallerKind::Msi => {
            if looks_like_msi_package(&path) {
                Ok("MSI 复合文档文件头验证通过（格式证据，来源真实性标记: provenanceUnknown）")
            } else {
                Err(format!("{url} 返回的内容不是有效的 MSI 安装包复合文档。"))
            }
        }
        InstallerKind::Ps1 | InstallerKind::Cmd | InstallerKind::Bat => {
            validate_script_file(&path).map(|_| "脚本文件文本与大小限制验证通过")
        }
        InstallerKind::Unsupported => unreachable!(),
    };

    let format_note = match format_check_result {
        Ok(evidence) => evidence.to_string(),
        Err(err) => {
            let _ = std::fs::remove_file(&path);
            super::storage::record_download_in_manifest(
                &dir,
                &filename,
                &task_id,
                super::storage::OwnershipStatus::Terminated,
                0,
            );
            return (
                AttemptOutcome::Unavailable,
                None,
                format!("安装包格式校验失败：{url}"),
                Some(err),
            );
        }
    };

    // Controlled execution dispatch per InstallerKind
    let result = match kind {
        InstallerKind::Exe => {
            run_process(&path.to_string_lossy(), &[], ATTEMPT_TIMEOUT, cancel)
        }
        InstallerKind::Msi => {
            let msiexec = crate::modules::system_ops::system32_executable("msiexec.exe");
            let msiexec_str = msiexec.to_string_lossy();
            let path_str = path.to_string_lossy();
            run_process(&msiexec_str, &["/i", &path_str, "/qn", "/norestart"], ATTEMPT_TIMEOUT, cancel)
        }
        InstallerKind::Ps1 => {
            let ps_v1 = crate::modules::system_ops::system32_executable("WindowsPowerShell\\v1.0\\powershell.exe");
            let ps_str = if ps_v1.exists() {
                ps_v1.to_string_lossy().to_string()
            } else {
                crate::modules::system_ops::system32_executable("powershell.exe").to_string_lossy().to_string()
            };
            let path_str = path.to_string_lossy();
            run_process(
                &ps_str,
                &["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", &path_str],
                ATTEMPT_TIMEOUT,
                cancel,
            )
        }
        InstallerKind::Cmd | InstallerKind::Bat => {
            let cmd_exe = crate::modules::system_ops::system32_executable("cmd.exe");
            let cmd_str = cmd_exe.to_string_lossy().to_string();
            let path_str = path.to_string_lossy();
            run_process(&cmd_str, &["/D", "/C", &path_str], ATTEMPT_TIMEOUT, cancel)
        }
        InstallerKind::Unsupported => unreachable!(),
    };

    // Clean up temporary downloaded installer
    let _ = std::fs::remove_file(&path);
    super::storage::record_download_in_manifest(
        &dir,
        &filename,
        &task_id,
        super::storage::OwnershipStatus::Terminated,
        0,
    );

    match result {
        Ok(r) => {
            let combined = format!("{format_note}\n{}", r.output);
            classify_with_kind(url, r.exit_code, combined, Some(kind))
        }
        Err(e) => (
            AttemptOutcome::Unavailable,
            None,
            format_note,
            Some(format!("无法运行安装包：{e}")),
        ),
    }
}

/// Does this downloaded file start like a Windows PE program?
fn looks_like_windows_pe(path: &Path) -> bool {
    use std::io::Read;

    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 2];
    if file.read_exact(&mut magic).is_err() {
        return false;
    }
    &magic == b"MZ"
}

/// Does this downloaded file start like an OLE compound document (MSI)?
fn looks_like_msi_package(path: &Path) -> bool {
    use std::io::Read;

    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 8];
    if file.read_exact(&mut magic).is_err() {
        return false;
    }
    &magic == b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"
}

/// Validates that a script file is within size limits and decodable as text.
fn validate_script_file(path: &Path) -> Result<(), String> {
    use std::io::Read;

    let meta = std::fs::metadata(path).map_err(|e| format!("无法读取文件信息: {e}"))?;
    if meta.len() > 10 * 1024 * 1024 {
        return Err("脚本文件体积超出 10 MiB 上限".into());
    }
    let mut file = std::fs::File::open(path).map_err(|e| format!("无法打开文件: {e}"))?;
    let mut head = [0u8; 1024];
    let n = file.read(&mut head).unwrap_or(0);
    let null_count = head[..n].iter().filter(|&&b| b == 0).count();
    if null_count > 4 {
        return Err("脚本文件内容疑似二进制非文本数据".into());
    }
    Ok(())
}

#[allow(dead_code)]
fn download_path_for(id: SoftwareId, url: &str) -> PathBuf {
    let policy = super::storage::load_effective_policy();
    let dir = super::storage::resolve_download_directory(&policy);
    let kind = InstallerKind::from_url_pathname(url);
    let ext = kind.extension();
    dir.join(format!("{}.{}", id.key(), ext))
}

#[allow(dead_code)]
fn is_inside_work_dir(path: &Path) -> bool {
    let policy = super::storage::load_effective_policy();
    let dir = super::storage::resolve_download_directory(&policy);
    path.starts_with(&dir)
}

#[allow(dead_code)]
fn looks_like_windows_executable(path: &Path) -> bool {
    looks_like_windows_pe(path)
}

/// Streams a URL to a file in the download directory.
fn download(
    url: &str,
    filename: &str,
    task_id: &str,
    cancel: &CancelFlag,
    policy: &super::storage::StoragePolicy,
) -> Option<PathBuf> {
    use std::io::Read;

    let dir = super::storage::resolve_download_directory(policy);
    std::fs::create_dir_all(&dir).ok()?;

    let path = dir.join(filename);

    super::storage::record_download_in_manifest(
        &dir,
        filename,
        task_id,
        super::storage::OwnershipStatus::Downloading,
        0,
    );

    // Let PowerShell do the transfer, but wait on it here so we can cancel: a
    // synchronous `WebClient.DownloadFile` in a child process cannot be
    // interrupted, so the process is started and polled instead.
    let escaped_url = url.replace('\'', "''");
    let escaped_path = path.to_string_lossy().replace('\'', "''");
    let script = format!(
        "$ProgressPreference='SilentlyContinue'; \
         [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; \
         (New-Object Net.WebClient).DownloadFile('{escaped_url}', '{escaped_path}')"
    );

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().ok()?;
    let started = Instant::now();

    loop {
        if cancel.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&path);
            super::storage::record_download_in_manifest(
                &dir,
                filename,
                task_id,
                super::storage::OwnershipStatus::Terminated,
                0,
            );
            return None;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let _ = std::fs::remove_file(&path);
                    super::storage::record_download_in_manifest(
                        &dir,
                        filename,
                        task_id,
                        super::storage::OwnershipStatus::Failed,
                        0,
                    );
                    return None;
                }
                break;
            }
            Ok(None) => {
                if started.elapsed() > DOWNLOAD_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = std::fs::remove_file(&path);
                    super::storage::record_download_in_manifest(
                        &dir,
                        filename,
                        task_id,
                        super::storage::OwnershipStatus::Terminated,
                        0,
                    );
                    return None;
                }
                std::thread::sleep(Duration::from_millis(400));
            }
            Err(_) => {
                let _ = std::fs::remove_file(&path);
                super::storage::record_download_in_manifest(
                    &dir,
                    filename,
                    task_id,
                    super::storage::OwnershipStatus::Failed,
                    0,
                );
                return None;
            }
        }
    }

    // Drain the pipes so the handles close, and so a download error message is
    // not lost. Read rather than wait, because `wait_with_output` would block.
    if let Some(mut out) = child.stdout.take() {
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
    }
    if let Some(mut err) = child.stderr.take() {
        let mut buf = Vec::new();
        let _ = err.read_to_end(&mut buf);
    }

    // A "download" that produced no file is a failure even with exit code 0 —
    // web clients can write an error page and report success.
    match std::fs::metadata(&path) {
        Ok(meta) if meta.len() > 0 => {
            super::storage::record_download_in_manifest(
                &dir,
                filename,
                task_id,
                super::storage::OwnershipStatus::Completed,
                meta.len(),
            );
            Some(path)
        }
        _ => {
            let _ = std::fs::remove_file(&path);
            super::storage::record_download_in_manifest(
                &dir,
                filename,
                task_id,
                super::storage::OwnershipStatus::Failed,
                0,
            );
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Executor 3: script
// ---------------------------------------------------------------------------

/// Runs a documented package-manager command (`npm install -g …`).
///
/// Dispatches to npm.cmd, npx.cmd, pip, python, powershell or cmd based on
/// explicit ScriptProgramKind or detected command prefix. NPX is never rewritten
/// to npm.
fn run_script(
    command: &str,
    program_kind: Option<ScriptProgramKind>,
    args: Option<&[String]>,
    cancel: &CancelFlag,
) -> ExecResult {
    if cancel.is_cancelled() {
        return cancelled();
    }

    let cmd_exe = crate::modules::system_ops::system32_executable("cmd.exe");
    let cmd_str = cmd_exe.to_string_lossy().to_string();
    let ps_v1 = crate::modules::system_ops::system32_executable("WindowsPowerShell\\v1.0\\powershell.exe");
    let ps_str = if ps_v1.exists() {
        ps_v1.to_string_lossy().to_string()
    } else {
        crate::modules::system_ops::system32_executable("powershell.exe").to_string_lossy().to_string()
    };

    let kind = program_kind.unwrap_or_else(|| {
        let first = command.split_whitespace().next().unwrap_or("");
        match first {
            "npm" => ScriptProgramKind::Npm,
            "npx" => ScriptProgramKind::Npx,
            "pip" => ScriptProgramKind::Pip,
            "python" => ScriptProgramKind::Python,
            "powershell" => ScriptProgramKind::PowerShell,
            _ => {
                if first.ends_with(".ps1") {
                    ScriptProgramKind::PowerShell
                } else {
                    ScriptProgramKind::Cmd
                }
            }
        }
    });

    let (program, process_args): (String, Vec<String>) = match kind {
        ScriptProgramKind::Npm => {
            let mut v = vec!["/D".to_string(), "/C".to_string(), "npm.cmd".to_string()];
            if let Some(structured) = args {
                v.extend(structured.iter().cloned());
            } else {
                v.extend(command.split_whitespace().skip(1).map(String::from));
            }
            (cmd_str, v)
        }
        ScriptProgramKind::Npx => {
            let mut v = vec!["/D".to_string(), "/C".to_string(), "npx.cmd".to_string()];
            if let Some(structured) = args {
                v.extend(structured.iter().cloned());
            } else {
                v.extend(command.split_whitespace().skip(1).map(String::from));
            }
            (cmd_str, v)
        }
        ScriptProgramKind::Pip => {
            let mut v = vec!["/D".to_string(), "/C".to_string(), "pip".to_string()];
            if let Some(structured) = args {
                v.extend(structured.iter().cloned());
            } else {
                v.extend(command.split_whitespace().skip(1).map(String::from));
            }
            (cmd_str, v)
        }
        ScriptProgramKind::Python => {
            let mut v = vec!["/D".to_string(), "/C".to_string(), "python".to_string()];
            if let Some(structured) = args {
                v.extend(structured.iter().cloned());
            } else {
                v.extend(command.split_whitespace().skip(1).map(String::from));
            }
            (cmd_str, v)
        }
        ScriptProgramKind::PowerShell => {
            let mut v = vec!["-NoProfile".to_string(), "-ExecutionPolicy".to_string(), "Bypass".to_string()];
            if let Some(structured) = args {
                v.push("-Command".to_string());
                v.extend(structured.iter().cloned());
            } else {
                v.push("-Command".to_string());
                v.push(command.to_string());
            }
            (ps_str, v)
        }
        ScriptProgramKind::Cmd => {
            let mut v = vec!["/D".to_string(), "/C".to_string()];
            if let Some(structured) = args {
                v.extend(structured.iter().cloned());
            } else {
                v.push(command.to_string());
            }
            (cmd_str, v)
        }
    };

    let arg_refs: Vec<&str> = process_args.iter().map(String::as_str).collect();
    match run_process(&program, &arg_refs, ATTEMPT_TIMEOUT, cancel) {
        Ok(r) => classify(command, r.exit_code, r.output),
        Err(e) => (
            AttemptOutcome::Unavailable,
            None,
            String::new(),
            Some(format!("无法执行命令 {command}：{e}")),
        ),
    }
}

// ---------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------

type ExecResult = (AttemptOutcome, Option<i32>, String, Option<String>);

struct ProcessResult {
    exit_code: i32,
    output: String,
}

/// Runs a process to completion and captures its merged output.
///
/// The child's stdout and stderr are merged into one buffer through a real pipe
/// rather than read through two threads, because the ordering between "downloading"
/// on stdout and "error" on stderr is the whole diagnostic value of the log.
fn run_process(
    program: &str,
    args: &[&str],
    timeout: Duration,
    cancel: &CancelFlag,
) -> Result<ProcessResult, String> {
    let spec = crate::modules::process::ProcessSpec::new(program, args)
        .with_timeout(timeout)
        .with_cancel(cancel.clone());

    let res = crate::modules::process::execute_process(&spec)?;

    match res.termination_reason {
        crate::modules::process::TerminationReason::Cancelled => Err("已取消".into()),
        crate::modules::process::TerminationReason::Timeout => Err(format!(
            "超过 {} 分钟未完成，已终止",
            timeout.as_secs() / 60
        )),
        _ => Ok(ProcessResult {
            exit_code: res.exit_code.unwrap_or(-1),
            output: res.merged_output,
        }),
    }
}

/// Turns a process exit code plus output into an outcome.
///
/// Priority is strictly based on the process exit code:
/// - 0: Succeeded
/// - 3010 / 1641: SucceededWithWarning (reboot required)
/// - 0x8A150061: Succeeded (winget package already installed)
/// - 5 / 740 / 0x8A15002B / 0x80073D28: PermissionDenied
/// - Other non-zero exit codes: Failed (text only adds diagnostic context, never overrides exit code)
pub fn classify(subject: &str, exit_code: i32, output: String) -> ExecResult {
    classify_with_kind(subject, exit_code, output, None)
}

pub fn classify_with_kind(
    subject: &str,
    exit_code: i32,
    output: String,
    _kind: Option<InstallerKind>,
) -> ExecResult {
    let lower = output.to_lowercase();

    // 1. Process exit code 0 is an action success.
    if exit_code == 0 {
        return (AttemptOutcome::Succeeded, Some(exit_code), output, None);
    }

    // 2. MSI reboot codes (3010, 1641) -> SucceededWithWarning
    if exit_code == 3010 || exit_code == 1641 {
        let note = "安装完成，但系统需要重启以使更改生效。".to_string();
        return (
            AttemptOutcome::SucceededWithWarning,
            Some(exit_code),
            output,
            Some(note),
        );
    }

    // 3. Winget specific exit code 0x8A150061 (APPINSTALLER_CLI_ERROR_PACKAGE_ALREADY_INSTALLED)
    // Only mapped on its exact exit code; loose substrings do not override non-zero failures.
    if (exit_code as u32) == 0x8A150061 {
        return (AttemptOutcome::Succeeded, Some(exit_code), output, None);
    }

    // 4. Elevation markers only mapped from explicit permission error codes:
    // 5 = ERROR_ACCESS_DENIED, 740 = ERROR_ELEVATION_REQUIRED
    // 0x8A15002B = winget ACCESS_DENIED
    // 0x80073D28 = ERROR_INSTALL_PACKAGE_REQUIRES_ELEVATION
    let is_permission_exit_code = exit_code == 5
        || exit_code == 740
        || (exit_code as u32) == 0x8A15002B
        || (exit_code as u32) == 0x80073D28;

    if is_permission_exit_code {
        return (
            AttemptOutcome::PermissionDenied,
            Some(exit_code),
            output,
            Some(format!(
                "{} 需要管理员权限。请关闭本程序，右键「以管理员身份运行」后重试（退出码 {}）。",
                subject,
                format_exit_code(exit_code)
            )),
        );
    }

    // 5. All other non-zero exit codes -> Failed. Output text provides diagnostic details only.
    let reason = if is_no_package_found(&lower) {
        format!(
            "{subject}：软件源中没有找到对应的包（退出码 {}）",
            format_exit_code(exit_code)
        )
    } else {
        format!("{subject} 安装失败（退出码 {}）", format_exit_code(exit_code))
    };

    (AttemptOutcome::Failed, Some(exit_code), output, Some(reason))
}

/// Does this winget output mean "no such package"?
///
/// Matched on both the English and the Chinese wording, because winget
/// localises its output and the app must give the specific reason on a student's
/// machine in either language.
///
/// The Chinese form was wrong until it was observed on a real run: the check
/// looked for `未找到与输入`, but winget actually prints
/// `找不到与输入条件匹配的程序包。` — a different first character (`找`, not
/// `未`). The mismatch meant a dead package id fell through to the generic
/// "安装失败" on a Chinese-locale machine, which is the exact error this was
/// written to explain. Both real spellings are accepted; substring matching on
/// the stable middle of the sentence tolerates the rest.
fn is_no_package_found(lower: &str) -> bool {
    lower.contains("no package found")
        || lower.contains("no packages found")
        || lower.contains("找不到与输入")
        || lower.contains("未找到与输入")
}

/// Renders an exit code the way a human can act on it.
///
/// A negative code is a 32-bit HRESULT that Windows sign-extended. Showing both
/// forms means the student can copy the hex into a search engine and find the
/// winget error reference, while automated tooling can still match the decimal.
fn format_exit_code(code: i32) -> String {
    if code < 0 {
        format!("{code} / 0x{:08X}", code as u32)
    } else {
        code.to_string()
    }
}

fn cancelled() -> ExecResult {
    (
        AttemptOutcome::Cancelled,
        None,
        String::new(),
        Some("已取消".into()),
    )
}

/// Keeps the head *and* the tail of long output.
///
/// The head carries "what was attempted"; the tail carries the error. A plain
/// truncation to the first N bytes would keep a progress bar and discard the
/// failure, which is the one thing the log exists for.
fn truncate(s: String) -> String {
    if s.len() <= MAX_OUTPUT_BYTES {
        return s;
    }
    let head: String = s.chars().take(MAX_OUTPUT_BYTES / 3).collect();
    let tail: String = s
        .chars()
        .rev()
        .take(MAX_OUTPUT_BYTES - MAX_OUTPUT_BYTES / 3 - 40)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{head}\n…（已省略中间部分）…\n{tail}")
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/// Whether this process can attempt a source at all.
///
/// Checked before a run so the UI can explain an impossible plan instead of
/// letting the student discover it one failed step at a time.
pub fn preflight(source: &InstallSource) -> Option<String> {
    match source {
        InstallSource::Winget { .. } => winget_version()
            .err()
            .map(|reason| format!("winget 不可用（{reason}），将使用回退方式")),
        // Everything else only needs a network, which the environment probe
        // already reports. Returning `None` here is not an oversight: adding a
        // second network check would duplicate that probe and could disagree
        // with it.
        _ => None,
    }
}

/// Builds the readiness summary for a whole plan.
pub fn readiness(plan: &InstallPlan, catalog: &Catalog, is_elevated: bool) -> ExecutionReadiness {
    let winget_version = winget_version().ok();
    let mut blockers = Vec::new();
    let mut needs_admin = Vec::new();

    // A step needs admin only when *every* link in its chain is a machine-wide
    // install path. Every catalogued program currently has at least one
    // per-user-capable strategy, so this is usually empty — which is the point:
    // the check exists to catch a future entry that would trap a student, not to
    // nag about the current ones.
    for step in &plan.steps {
        if step.satisfied {
            continue;
        }
        let spec = super::install::spec_from(catalog, step.id);
        let all_winget = spec
            .chain
            .iter()
            .all(|f| matches!(f.source, InstallSource::Winget { .. }));
        if all_winget && winget_version.is_none() {
            blockers.push(format!(
                "{} 只能通过 winget 安装，但本机未找到 winget。",
                step.name
            ));
        }
        if step
            .fallback_plan
            .iter()
            .any(|r| r.contains("管理员"))
        {
            needs_admin.push(step.id);
        }
    }

    ExecutionReadiness {
        can_start: blockers.is_empty(),
        blockers,
        winget_version,
        is_elevated,
        needs_admin,
    }
}

/// Removes the downloaded payloads of a finished session using the ownership manifest.
pub fn clean_downloads() {
    let policy = super::storage::load_effective_policy();
    super::storage::clean_downloads_with_manifest(&policy, &[]);
}

/// Removes the downloaded payloads using an explicit policy and manifest.
pub fn clean_downloads_with_policy(policy: &StoragePolicy) {
    super::storage::clean_downloads_with_manifest(policy, &[]);
}

/// Absolute path an installer would be downloaded to. Exposed so a test can
/// assert the work directory is used and not an arbitrary temp path.
pub fn download_path_for(id: SoftwareId, url: &str) -> PathBuf {
    let extension = if url.ends_with(".ps1") {
        "ps1"
    } else if url.ends_with(".msi") {
        "msi"
    } else {
        "exe"
    };
    super::detect::work_directory()
        .join("downloads")
        .join(format!("{}.{}", id.key(), extension))
}

/// Does this path live inside the directory we are allowed to write to?
pub fn is_inside_work_dir(path: &Path) -> bool {
    let work = super::detect::work_directory();
    super::path_policy::resolve_under_root(&work, &path.to_string_lossy()).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Outcome classification — the logic that decides what a student is told.
    // -----------------------------------------------------------------------

    #[test]
    fn exit_zero_is_success() {
        let (outcome, code, _, error) = classify("Git", 0, "Done".into());
        assert_eq!(outcome, AttemptOutcome::Succeeded);
        assert_eq!(code, Some(0));
        assert!(error.is_none());
    }

    #[test]
    fn already_installed_is_a_success_not_a_failure() {
        // This is exactly what clicking install twice looks like. Reporting it
        // as an error would make the common case look broken.
        let (outcome, _, _, error) = classify(
            "Git.Git",
            0x8A150061_u32 as i32,
            "Found an existing package already installed.".into(),
        );
        assert_eq!(outcome, AttemptOutcome::Succeeded);
        assert!(error.is_none());
    }

    #[test]
    fn access_denied_is_permission_denied_not_a_generic_failure() {
        // The fix for this is one specific sentence; a generic "failed" would
        // leave the student with no idea what to do.
        let (outcome, _, _, error) =
            classify("Claude", 1, "Installer failed: Access is denied. (0x8A15002B)".into());
        assert_eq!(outcome, AttemptOutcome::PermissionDenied);
        let error = error.unwrap();
        assert!(error.contains("管理员"), "got: {error}");
    }

    #[test]
    fn the_real_claude_desktop_elevation_failure_is_classified_as_a_permission_error() {
        // Verbatim output from this machine:
        //   winget install --id Anthropic.Claude -e --silent \
        //     --accept-package-agreements --accept-source-agreements \
        //     --disable-interactivity
        //   → exit code -2147009240 (0x80073D28)
        //
        // This is the bug that made the very first install of the "只想先试一下"
        // package fail with an unhelpful message. The wording is
        // "administrator privileges are required" — the exact opposite word
        // order from the `requires administrator` marker the classifier had.
        let output = "找到已安装的现有包。正在尝试升级已安装的包...\n\
                      已找到 Claude [Anthropic.Claude] 版本 1.44121.2\n\
                      此应用程序由其所有者授权给你。\n\
                      已成功验证安装程序哈希\n\
                      正在启动程序包安装...\n\
                      安装程序失败，退出代码为: 0x80073d28 : The package installation \
                      failed because administrator privileges are required. \
                      Please contact an administrator to install this package."
            .to_string();

        let (outcome, code, _, error) = classify("Anthropic.Claude", -2147009240, output);

        assert_eq!(
            outcome,
            AttemptOutcome::PermissionDenied,
            "the elevation failure must not be reported as a generic failure"
        );
        assert_eq!(code, Some(-2147009240));
        // And it must stop the chain: the next link runs under the same token.
        assert!(!outcome.is_retryable());

        let error = error.expect("a permission failure must explain itself");
        assert!(
            error.contains("管理员"),
            "the student must be told to elevate: {error}"
        );
    }

    #[test]
    fn the_appx_elevation_hresult_is_recognised_on_its_own() {
        // The hex code alone is enough, even without the English sentence —
        // winget's localization can translate the message away, but the
        // HRESULT is stable.
        let (outcome, _, _, _) = classify(
            "Anthropic.Claude",
            -2147009240,
            "安装程序失败，退出代码为: 0x80073D28".into(),
        );
        assert_eq!(outcome, AttemptOutcome::PermissionDenied);
    }

    #[test]
    fn both_word_orders_of_the_administrator_marker_are_matched() {
        // `requires administrator` (vendor installers) and
        // `administrator privileges are required` (winget/MSIX) are different
        // strings. A regression in either direction must fail here.
        for text in [
            "This installer requires administrator privileges.",
            "The package installation failed because administrator privileges are required.",
        ] {
            let (outcome, _, _, _) = classify("X", 1, text.to_string());
            assert_eq!(
                outcome,
                AttemptOutcome::PermissionDenied,
                "not classified as elevation: {text}"
            );
        }
    }

    #[test]
    fn chinese_elevation_messages_are_matched_without_the_word_zhi_xing() {
        // Guards the exact trap the English fix had: matching one phrasing and
        // missing the obvious neighbour. winget's zh-CN output and Windows'
        // own shell messages both appear in the wild.
        for text in [
            "安装程序失败，需要管理员权限",
            "此操作需要提升权限才能继续",
            "权限不足，无法安装此程序",
        ] {
            let (outcome, _, _, _) = classify("X", 1, text.to_string());
            assert_eq!(
                outcome,
                AttemptOutcome::PermissionDenied,
                "not classified as elevation: {text}"
            );
        }
    }

    /// A package that is already installed and has no upgrade available.
    ///
    /// Recorded from a real run on this machine:
    /// `winget install --id 9PLM9XGG6VKS -e --silent ...` → exit `0x8A15002B`
    /// (`-1978335189`) with exactly the narration below.
    ///
    /// This is a **success** for our purposes: the app is present, which is the
    /// desired end state. It used to be reported as `PermissionDenied`, because
    /// `0x8a15002b` is in the elevation marker list and `permission` is checked
    /// before `already_installed`. The student was therefore told
    /// "需要管理员权限。请右键以管理员身份运行后重试" — advice that cannot possibly
    /// help, since nothing is missing and nothing needs elevation. Telling
    /// someone to do something useless is the failure mode the brief forbids.
    #[test]
    fn already_installed_with_no_upgrade_is_success_not_permission_denied() {
        let output = "找到已安装的现有包。正在尝试升级已安装的包...\n\
                      找不到可用的升级。\n\
                      配置的源中没有可用的较新的包版本。";

        let (outcome, code, _, error) = classify("ChatGPT 桌面版", -1978335189, output.into());

        assert_eq!(
            outcome,
            AttemptOutcome::Succeeded,
            "already-installed is the desired end state; error was {error:?}"
        );
        assert_eq!(code, Some(-1978335189));
        assert!(
            error.is_none(),
            "a success must carry no error message, got {error:?}"
        );
    }

    /// The same code, in the case it actually does mean elevation.
    ///
    /// `0x8A15002B` is overloaded — winget returns it both for "no applicable
    /// upgrade" and for a genuine access denial. Classification therefore cannot
    /// key on the code alone; it must read the output, which is exactly what the
    /// narration-marker approach is for. This test pins the elevation half so
    /// fixing the already-installed half cannot silently break it.
    #[test]
    fn the_same_code_with_a_real_access_denial_is_still_permission_denied() {
        let output = "尝试更新包时发生意外错误: 0x8A15002B : Access is denied.";

        let (outcome, _, _, error) = classify("X", -1978335189, output.into());

        assert_eq!(outcome, AttemptOutcome::PermissionDenied);
        assert!(error.unwrap().contains("管理员权限"));
    }

    /// The installed-package narration must not be mistaken for a failure.
    ///
    /// `正在尝试升级已安装的包` contains `已安装`, and the failure markers are
    /// checked *before* the already-installed ones — so the wording of this
    /// benign outcome sits one step away from being read as a failed install.
    #[test]
    fn the_upgrade_narration_is_not_failure_evidence() {
        let output = "找到已安装的现有包。正在尝试升级已安装的包...\n找不到可用的升级。";
        let lower = output.to_lowercase();

        for marker in [
            "installer failed",
            "安装程序失败",
            "installation failed",
            "安装失败",
            "failed with exit code",
            "error 0x",
            "错误 0x",
        ] {
            assert!(
                !lower.contains(marker),
                "benign upgrade narration must not match the failure marker {marker:?}"
            );
        }
    }

    #[test]
    fn no_package_found_is_retryable() {        // Distinguishing this from a permission error is what lets the chain
        // advance to the vendor installer instead of stopping.
        let (outcome, _, _, error) =
            classify("OpenAI.Codex", 1, "No package found matching input criteria.".into());
        assert_eq!(outcome, AttemptOutcome::Failed);
        assert!(outcome.is_retryable());
        assert!(error.unwrap().contains("软件源中没有找到"));
    }

    #[test]
    fn permission_denied_is_not_retryable_on_the_next_link() {
        // Every link runs under the same token, so advancing would fail the same
        // way and just double the wait.
        assert!(!AttemptOutcome::PermissionDenied.is_retryable());
        assert!(!AttemptOutcome::Cancelled.is_retryable());
        assert!(AttemptOutcome::Unavailable.is_retryable());
    }

    #[test]
    fn non_zero_without_a_known_marker_is_a_failure() {
        let (outcome, code, _, error) = classify("Git", 1603, "fatal error".into());
        assert_eq!(outcome, AttemptOutcome::Failed);
        assert_eq!(code, Some(1603));
        assert!(error.unwrap().contains("1603"));
    }

    #[test]
    fn a_negative_exit_code_is_shown_in_hex_too() {
        // winget reports `0x8A150014` as the signed `-1978335212`. Printed
        // signed and nothing else, it is unsearchable; the hex form is what
        // winget's own error reference uses. Observed on a real run, not
        // invented: see `examples/execute_smoke.rs`.
        let (outcome, code, _, error) = classify(
            "AIStudentSetup.SmokeTest.NoSuchPackage",
            -1978335212,
            "No package found matching input criteria.".into(),
        );
        assert_eq!(outcome, AttemptOutcome::Failed);
        assert_eq!(code, Some(-1978335212));

        let error = error.unwrap();
        assert!(
            error.contains("0x8A150014"),
            "the hex form must survive: {error}"
        );
    }

    /// The exact Chinese wording winget prints on this machine.
    ///
    /// Captured from a real run, not invented:
    /// `winget install --id OpenAI.ChatGPT -e ...` → `找不到与输入条件匹配的程序包。`
    /// The classifier previously matched `未找到与输入`, which never occurs, so
    /// on a Chinese-locale machine the dead-id case produced the generic
    /// "安装失败" instead of naming the real cause. This pins the observed
    /// string so the gap cannot come back.
    #[test]
    fn the_real_chinese_no_package_wording_is_classified() {
        let (outcome, code, _, error) = classify(
            "ChatGPT 桌面版",
            -1978335212,
            "找不到与输入条件匹配的程序包。".into(),
        );

        assert_eq!(outcome, AttemptOutcome::Failed);
        assert_eq!(code, Some(-1978335212));

        let error = error.expect("a reason must be produced");
        assert!(
            error.contains("软件源中没有找到对应的包"),
            "the specific reason must be given, not a generic failure: {error}"
        );
        assert!(
            error.contains("0x8A150014"),
            "and the hex code must survive for lookup: {error}"
        );
    }

    #[test]
    fn both_english_spellings_of_no_package_are_classified() {
        for text in [
            "No package found matching input criteria.",
            "No packages found matching input criteria.",
        ] {
            let (outcome, _, _, error) = classify("X", -1978335212, text.into());
            assert_eq!(outcome, AttemptOutcome::Failed);
            assert!(
                error.unwrap().contains("软件源中没有找到对应的包"),
                "{text} must be classified as a missing package"
            );
        }
    }

    #[test]
    fn an_unrelated_failure_is_not_misclassified_as_a_missing_package() {
        // Over-matching would be its own bug: a permission or disk failure must
        // not be reported as "the package id is wrong", or the student retries
        // the one thing that cannot help.
        let (outcome, _, _, error) = classify("X", 1603, "fatal error during installation".into());
        assert_eq!(outcome, AttemptOutcome::Failed);
        let error = error.unwrap();
        assert!(
            !error.contains("软件源中没有找到对应的包"),
            "a non-package failure must not claim the package is missing: {error}"
        );
        assert!(error.contains("安装失败"));
    }

    #[test]
    fn format_exit_code_leaves_small_codes_alone() {
        assert_eq!(format_exit_code(0), "0");
        assert_eq!(format_exit_code(1603), "1603");        // The boundary: 0x7FFFFFFF is the largest positive i32.
        assert_eq!(format_exit_code(2147483647), "2147483647");
        assert_eq!(format_exit_code(-1), "-1 / 0xFFFFFFFF");
    }

    // -----------------------------------------------------------------------
    // Output handling
    // -----------------------------------------------------------------------

    #[test]
    fn truncation_keeps_both_ends() {
        // Must exceed MAX_OUTPUT_BYTES *bytes*, and the repeat unit is padded so
        // the fixture does not depend on the marker's own length.
        let head = "START-MARKER-0123456789 ".repeat(2000);
        let tail = " END-FAILURE-MARKER";
        let text = format!("{head}{tail}");
        assert!(
            text.len() > MAX_OUTPUT_BYTES,
            "fixture is {} bytes, needs > {}",
            text.len(),
            MAX_OUTPUT_BYTES
        );

        let cut = truncate(text);
        assert!(cut.len() < MAX_OUTPUT_BYTES + 200);
        assert!(cut.contains("START-MARKER"), "the head was lost");
        // The whole point: a plain head-truncation would discard this.
        assert!(cut.contains("END-FAILURE-MARKER"), "the error was lost");
    }

    #[test]
    fn short_output_is_untouched() {
        assert_eq!(truncate("ok".into()), "ok");
    }

    // -----------------------------------------------------------------------
    // Executor selection — proves no software name is hard-coded here.
    // -----------------------------------------------------------------------

    #[test]
    fn configuration_only_never_runs_a_process() {
        let cancel = CancelFlag::new();
        let record = execute_source(
            SoftwareId::Git,
            &InstallSource::ConfigurationOnly,
            0,
            &cancel,
        );
        assert_eq!(record.outcome, AttemptOutcome::Succeeded);
        assert!(!record.command.is_empty());
    }

    #[test]
    fn every_catalog_strategy_is_executable_by_some_executor() {
        // The structural guarantee behind "不要写死软件名称": the executor
        // dispatches on the *source* enum, and every source variant the catalog
        // can produce has a branch. A new program in the catalog is therefore
        // executable with no change to this file.
        let cat = Catalog::builtin();
        let cancel = CancelFlag::new();
        for id in SoftwareId::ALL {
            let spec = super::super::install::spec_from(&cat, id);
            for link in &spec.chain {
                let handled = matches!(
                    link.source,
                    InstallSource::Winget { .. }
                        | InstallSource::OfficialInstaller { .. }
                        | InstallSource::Script { .. }
                        | InstallSource::ConfigurationOnly
                );
                assert!(handled, "{id:?} has a strategy no executor can run");
            }
        }
        // And the dispatcher itself is total: calling it with a source that is
        // not runnable must not panic.
        let record = execute_source(
            SoftwareId::Git,
            &InstallSource::Winget {
                package_id: String::new(),
            },
            0,
            &cancel,
        );
        assert!(matches!(
            record.outcome,
            AttemptOutcome::Unavailable | AttemptOutcome::Failed
        ));
    }

    #[test]
    fn a_pre_cancelled_run_does_not_start_a_process() {
        let cancel = CancelFlag::new();
        cancel.cancel();
        let record = execute_source(
            SoftwareId::Git,
            &InstallSource::Script {
                command: "npm install -g something".into(),
                program_kind: Some(ScriptProgramKind::Npm),
                args: None,
            },
            0,
            &cancel,
        );
        assert_eq!(record.outcome, AttemptOutcome::Cancelled);
        assert_eq!(record.exit_code, None);
    }

    #[test]
    fn an_unknown_winget_package_fails_without_installing_anything() {
        // Uses a package id that cannot exist, so this is a real end-to-end run
        // of the winget executor that is guaranteed not to install software.
        let cancel = CancelFlag::new();
        let record = execute_source(
            SoftwareId::Git,
            &InstallSource::Winget {
                package_id: "AIStudentSetup.NoSuchPackage.Tests".into(),
            },
            0,
            &cancel,
        );
        match record.outcome {
            // winget present: it must reject the id, and must be retryable so
            // the fallback chain advances to the vendor installer.
            AttemptOutcome::Failed => {
                assert!(record.outcome.is_retryable());
                assert!(record.error.is_some());
            }
            // winget absent on this machine: also a correct, non-panicking path.
            AttemptOutcome::Unavailable => {
                assert!(record.error.unwrap().contains("winget"));
            }
            other => panic!("expected Failed or Unavailable, got {other:?}"),
        }
        assert!(record.duration_ms < 300_000);
    }

    #[test]
    fn a_downloaded_web_page_is_not_treated_as_an_installer() {
        // The real defect: three catalog fallbacks pointed at HTML landing
        // pages. Reproduced with real bytes so the guard is tested against what
        // actually arrives, not an idealised fixture.
        let dir = std::env::temp_dir().join("aissetup-payload-guard-tests");
        std::fs::create_dir_all(&dir).unwrap();

        let html = dir.join("page.exe");
        std::fs::write(
            &html,
            b"<!DOCTYPE html><html><head><title>Download Claude</title></head></html>",
        )
        .unwrap();
        assert!(
            !looks_like_windows_executable(&html),
            "an HTML document must never be reported as a runnable installer"
        );

        let pe = dir.join("real.exe");
        let mut bytes = b"MZ".to_vec();
        bytes.extend_from_slice(&[0u8; 128]);
        std::fs::write(&pe, &bytes).unwrap();
        assert!(
            looks_like_windows_executable(&pe),
            "a PE image must pass the guard"
        );

        // Empty and missing files are refusals, never passes.
        let empty = dir.join("empty.exe");
        std::fs::write(&empty, b"").unwrap();
        assert!(!looks_like_windows_executable(&empty));
        assert!(!looks_like_windows_executable(&dir.join("does-not-exist.exe")));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_catalog_fallback_hands_a_known_landing_page_to_the_os() {
        // Guards the specific URLs that were wrong, by shape. A landing page is
        // a directory-style URL with no file at the end; the check is
        // deliberately loose because the point is to catch a *reintroduction*,
        // not to validate every possible vendor URL.
        use crate::modules::catalog::{Catalog, StrategySource};

        let cat = Catalog::builtin();
        for id in SoftwareId::ALL {
            for strategy in cat.entry(id).install {
                let StrategySource::OfficialInstaller { ref url, .. } = strategy.source else {
                    continue;
                };
                let page_like = url.ends_with("/download")
                    || url.ends_with("/downloads")
                    || url.ends_with("/downloads/windows/")
                    || url.ends_with("releases/latest");
                assert!(
                    !page_like,
                    "{id:?} points its fallback at a landing page, not an installer: {url}"
                );
            }
        }
    }

    #[test]
    fn downloads_are_written_inside_the_work_directory() {        // Guards the rule that we never write installers to an arbitrary temp
        // path: everything must end up under our own per-user directory.
        let path = download_path_for(SoftwareId::Vscode, "https://example.com/vscode.exe");
        assert!(is_inside_work_dir(&path), "got {path:?}");
        assert!(path.to_string_lossy().ends_with("vscode.exe"));

        let script = download_path_for(SoftwareId::ClaudeCode, "https://claude.ai/install.ps1");
        assert!(script.to_string_lossy().ends_with("claude_code.ps1"));
    }

    #[test]
    fn readiness_reports_winget_presence_honestly() {
        let cat = Catalog::builtin();
        let plan = InstallPlan {
            profile_id: "test".into(),
            steps: vec![InstallStep {
                id: SoftwareId::Git,
                name: "Git".into(),
                source: InstallSource::Winget {
                    package_id: "Git.Git".into(),
                },
                fallback_plan: vec!["优先使用 winget 安装".into()],
                satisfied: false,
                location_support: None,
                expected_location: None,
            }],
            ready_count: 1,
            satisfied_count: 0,
            estimated_minutes: Some(5),
        };
        let ready = readiness(&plan, &cat, false);
        // Git has an official-installer fallback, so a missing winget is not a
        // blocker — the chain handles it. That is the difference between this
        // check and a naive "winget missing => cannot start".
        assert!(ready.can_start, "blockers: {:?}", ready.blockers);
        assert_eq!(ready.is_elevated, false);
    }
}
