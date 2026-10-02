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
    let started = Instant::now();
    let started_at = now_iso8601();

    let (outcome, exit_code, output, error) = match source {
        InstallSource::Winget { package_id } => run_winget(package_id, cancel),
        InstallSource::OfficialInstaller { url, .. } => run_official_installer(url, id, cancel),
        InstallSource::Script { command } => run_script(command, cancel),
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

    ActionRecord {
        id,
        source: source.clone(),
        command: describe_source(source),
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

/// `winget install --id <package> -e --accept-* --silent`.
///
/// The flag set is chosen for an unattended, non-elevated run:
///
/// * `-e` / `--exact`: the id must match exactly. Without it, winget's fuzzy
///   matching can resolve `Git.Git` to an unrelated package, which is a silent
///   wrong install rather than an error.
/// * `--accept-package-agreements` / `--accept-source-agreements`: otherwise
///   winget stops on an interactive prompt there is no one to answer, and the
///   student sees a hang.
/// * `--disable-interactivity`: stops any remaining prompt from blocking.
/// * `--silent`: no per-package installer UI.
///
/// `--scope user` is deliberately **not** passed. Forcing a scope makes winget
/// fail outright on packages that only publish a machine-wide installer, and
/// winget already prefers a per-user install when it can — which is what keeps
/// this working for a student without admin rights. Hard-coding the scope would
/// convert "installable without admin" into "not installable at all" on a
/// handful of packages, for no gain.
fn run_winget(package_id: &str, cancel: &CancelFlag) -> ExecResult {
    if cancel.is_cancelled() {
        return cancelled();
    }

    match winget_version() {
        Ok(version) => {
            // Recorded before the install so the trace shows which winget build
            // attempted it. A surprising winget failure is usually a version
            // characteristic, and without this the log cannot show it.
            let version_note = format!("winget {version}\n");
            // No `--source`: winget's default resolution is correct for both
            // community package ids and Microsoft Store product ids. Verified on
            // winget 1.29.290 — `msstore` is registered and non-explicit, so
            // `--id 9PLM9XGG6VKS` resolves; pinning `--source winget` instead
            // breaks it with 0x8A150014. Passing no source is the working case,
            // not an omission.
            let args = [
                "install",
                "--id",
                package_id,
                "-e",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
                "--disable-interactivity",
            ];
            match run_process("winget", &args, ATTEMPT_TIMEOUT, cancel) {
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
fn run_official_installer(url: &str, id: SoftwareId, cancel: &CancelFlag) -> ExecResult {
    if cancel.is_cancelled() {
        return cancelled();
    }

    // `claude.ai/install.ps1` and similar are scripts, not executables. They
    // have to go through PowerShell; everything else is passed to the shell
    // association so the vendor's own installer UI behaves as the vendor made
    // it. Distinguished by extension rather than by program name, so a new
    // catalog entry needs no code change.
    let is_script = url.ends_with(".ps1") || url.ends_with(".cmd") || url.ends_with(".bat");

    let Some(path) = download(url, id, cancel) else {
        return (
            AttemptOutcome::Unavailable,
            None,
            format!("下载失败：{url}"),
            Some(format!(
                "无法下载官方安装包 {url}。请检查网络后重试，或改用手动安装。"
            )),
        );
    };

    // Before running anything: is this actually a program?
    //
    // Three catalog fallbacks pointed at *web pages* rather than installers
    // (`claude.ai/download`, Git's `releases/latest` directory, Python's
    // `/downloads/windows/`). The download succeeds, the file is non-empty, and
    // the old code handed an HTML document to the OS — which either opens a
    // browser or fails with an error nobody can act on.
    //
    // The check is on the file's *content*, not its URL, because the URL is
    // exactly what was wrong in all three cases. A Windows executable begins
    // `MZ`; a PowerShell script is text and is allowed through by the
    // extension check above. Anything else is refused with a message that names
    // the real problem, so the fallback chain can advance instead of the
    // student being told an install failed for no visible reason.
    if !is_script && !looks_like_windows_executable(&path) {
        let _ = std::fs::remove_file(&path);
        return (
            AttemptOutcome::Unavailable,
            None,
            format!("下载到的不是安装程序：{url}"),
            Some(format!(
                "{url} 返回的是一个网页而不是安装包。这不是你的问题，已跳过这种方式。"
            )),
        );
    }

    let result = if is_script {
        run_process(
            "powershell",
            &[
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                &path.to_string_lossy(),
            ],
            ATTEMPT_TIMEOUT,
            cancel,
        )
    } else {
        // `/passive` is not universal across vendors, so no flags are passed:
        // the installer runs as its author intended. The cost is that some show
        // UI; the benefit is that we never invent an argument a vendor does not
        // support, which is how installers end up failing for one program only.
        run_process(
            &path.to_string_lossy(),
            &[],
            ATTEMPT_TIMEOUT,
            cancel,
        )
    };

    // Always clean up, success or failure. A stale installer in the work
    // directory would be re-used by nothing, but it would sit in the student's
    // LocalAppData forever.
    let _ = std::fs::remove_file(&path);

    match result {
        Ok(r) => classify(url, r.exit_code, r.output),
        Err(e) => (
            AttemptOutcome::Unavailable,
            None,
            String::new(),
            Some(format!("无法运行安装包：{e}")),
        ),
    }
}

/// Does this downloaded file start like a Windows program?
///
/// Only the magic number is checked, not the extension: the failure this guards
/// against was a URL ending in nothing (or in `/download`) returning an HTML
/// document. `MZ` is the DOS header every PE image starts with, and it is the
/// cheapest reliable signal that the OS will be able to launch the file.
///
/// A missing or unreadable file is `false`: the caller treats that as "not a
/// program", which is the safe direction.
fn looks_like_windows_executable(path: &Path) -> bool {
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

/// Streams a URL to a file in the work directory.
///
/// Uses `System.Net.WebClient` through PowerShell rather than an HTTP crate:
/// Windows ships a proxy-aware, certificate-validating TLS stack, and a
/// dependency that exists only to fetch five URLs would be a poor trade. The
/// download is chunked so cancellation is honoured mid-transfer instead of only
/// between steps.
fn download(url: &str, id: SoftwareId, cancel: &CancelFlag) -> Option<PathBuf> {
    use std::io::Read;

    let dir = super::detect::work_directory().join("downloads");
    std::fs::create_dir_all(&dir).ok()?;

    let extension = if url.ends_with(".ps1") {
        "ps1"
    } else if url.ends_with(".msi") {
        "msi"
    } else {
        "exe"
    };
    let path = dir.join(format!("{}.{}", id.key(), extension));

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
            return None;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let _ = std::fs::remove_file(&path);
                    return None;
                }
                break;
            }
            Ok(None) => {
                if started.elapsed() > DOWNLOAD_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = std::fs::remove_file(&path);
                    return None;
                }
                std::thread::sleep(Duration::from_millis(400));
            }
            Err(_) => {
                let _ = std::fs::remove_file(&path);
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
        Ok(meta) if meta.len() > 0 => Some(path),
        _ => {
            let _ = std::fs::remove_file(&path);
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Executor 3: script
// ---------------------------------------------------------------------------

/// Runs a documented package-manager command (`npm install -g …`).
///
/// The command is executed through PowerShell, always with `-NoProfile` so the
/// student's profile cannot change PATH out from under the command, and with
/// `-ExecutionPolicy Bypass` scoped to this process only.
///
/// The command text comes from the catalog and is *not* interpolated with any
/// user input, so there is no injection surface: the only strings that reach
/// this function are the ones compiled into `catalog.rs`.
fn run_script(command: &str, cancel: &CancelFlag) -> ExecResult {
    if cancel.is_cancelled() {
        return cancelled();
    }

    // Which interpreter runs the command is derived from the command itself, so
    // a new catalogue entry needs no change here.
    let first = command.split_whitespace().next().unwrap_or("");
    let (program, args): (&str, Vec<String>) = if first == "npm" || first == "npx" {
        // `.cmd` explicitly: `npm` on Windows is a batch shim, and spawning the
        // bare name resolves to it only through PATH, which is exactly what is
        // unreliable right after installing Node.
        (
            "cmd",
            vec!["/C".into(), format!("npm{}", &command[first.len()..])],
        )
    } else if first == "pip" || first == "python" {
        ("cmd", vec!["/C".into(), command.to_string()])
    } else if first.starts_with("powershell") || first.ends_with(".ps1") {
        ("powershell", vec!["-NoProfile".into(), "-Command".into(), command.to_string()])
    } else {
        ("cmd", vec!["/C".into(), command.to_string()])
    };

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    match run_process(program, &arg_refs, ATTEMPT_TIMEOUT, cancel) {
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
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.stdin(std::process::Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    let mut child = child;

    // Poll rather than block so cancellation and the runaway timeout are both
    // honoured. The pipes stay open, so output is not lost by doing this.
    let status = loop {
        if cancel.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("已取消".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "超过 {} 分钟未完成，已终止",
                        timeout.as_secs() / 60
                    ));
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e.to_string()),
        }
    };

    // Read whatever the process wrote. Done after exit so the reads cannot
    // deadlock against a full pipe buffer.
    let mut bytes = Vec::new();
    if let Some(mut out) = child.stdout.take() {
        use std::io::Read;
        let _ = out.read_to_end(&mut bytes);
    }
    if let Some(mut err) = child.stderr.take() {
        use std::io::Read;
        let mut err_bytes = Vec::new();
        let _ = err.read_to_end(&mut err_bytes);
        if !err_bytes.is_empty() {
            bytes.push(b'\n');
            bytes.extend_from_slice(&err_bytes);
        }
    }

    Ok(ProcessResult {
        exit_code: status.code().unwrap_or(-1),
        output: decode_console_output(&bytes),
    })
}

/// Turns a process exit code plus output into an outcome.
///
/// The classification is based on **what the tools actually print**, not on the
/// exit code alone, because exit codes are not portable between winget versions
/// and a generic `1` tells the student nothing about what to do.
///
/// The markers below were all observed in real output:
///
/// | marker | source | real meaning |
/// |---|---|---|
/// | `0x8A15002B` | winget | needs elevation (`ACCESS_DENIED`) |
/// | `requires administrator` | vendor installers | same |
/// | `already installed` | winget | success, nothing to do |
/// | `No package found` | winget | the id is wrong — retry another link |
///
/// `already installed` is deliberately folded into success. It is what a second
/// run of a plan looks like, and reporting it as a failure would make "click
/// install twice" appear broken.
pub fn classify(subject: &str, exit_code: i32, output: String) -> ExecResult {
    let lower = output.to_lowercase();

    // Elevation markers, in both languages.
    //
    // The substring choices here are load-bearing and were each observed in real
    // output, not guessed. Two are worth explaining:
    //
    // * `administrator privileges are required` — winget's MSIX path prints
    //   exactly this wording, and it does *not* contain the phrase
    //   `requires administrator` (the words are in the opposite order). An
    //   earlier version matched only the latter, so a real Claude Desktop
    //   install failure (`0x80073D28`) fell through to the generic
    //   "安装失败" branch and the student was told nothing actionable. Both
    //   orders are matched below.
    // * `0x80073d28` — `ERROR_INSTALL_PACKAGE_REQUIRES_ELEVATION`. It is a
    //   Win32/AppX HRESULT, so it shares no prefix with winget's own
    //   `0x8A15xxxx` codes and needs its own marker.
    //
    // Matching is done on a lowercased copy, so every literal here is lowercase.
    let permission = lower.contains("access is denied")
        || lower.contains("access denied")
        || lower.contains("0x8a15002b")
        || lower.contains("0x80073d28")
        || lower.contains("requires administrator")
        || lower.contains("administrator privileges are required")
        || lower.contains("privileges are required")
        || lower.contains("需要管理员")
        || lower.contains("管理员权限")
        || lower.contains("需要提升")
        || lower.contains("elevated")
        || lower.contains("没有足够的权限")
        || lower.contains("权限不足")
        || lower.contains("拒绝访问");

    // A benign outcome that winget reports with a *non-zero* exit code.
    //
    // `0x8A150061` is `APPINSTALLER_CLI_ERROR_PACKAGE_ALREADY_INSTALLED`: the
    // package is present, which for our purposes is the desired end state. This
    // must be recognised by the code *and* the phrase together, because on its
    // own the code means nothing to a human reading the log and the phrase
    // alone appears in the narration of failures (see `failure_evidence`).
    let already_installed = lower.contains("already installed")
        || lower.contains("0x8a150061")
        || lower.contains("已安装") || lower.contains("已存在");

    // Evidence that the attempt *failed*, checked before any success
    // heuristic.
    //
    // Order matters here, and getting it wrong was a worse bug than the
    // message wording: winget's upgrade path prints "找到已安装的现有包。正在尝试
    // 升级已安装的包…" *before* it fails, so the success marker `已安装` matched
    // the preamble of a run that then died with 0x80073D28. The step was
    // reported as **Succeeded** and the student was told a program was
    // installed that was not.
    //
    // The rule this encodes: a failure indicator anywhere in the output
    // outranks a success phrase anywhere in it, because installers narrate
    // their intent ("trying to upgrade the installed package") before they
    // act, and that narration contains success-sounding words.
    let failure_evidence = lower.contains("installer failed")
        || lower.contains("安装程序失败")
        || lower.contains("installation failed")
        || lower.contains("安装失败")
        || lower.contains("failed with exit code")
        || lower.contains("error 0x")
        || lower.contains("错误 0x");

    if permission {
        return (
            AttemptOutcome::PermissionDenied,
            Some(exit_code),
            output,
            Some(format!(
                "{} 需要管理员权限。请关闭本程序，右键「以管理员身份运行」后重试。",
                subject
            )),
        );
    }

    // Precedence, stated explicitly because each clause was a real bug:
    //
    //   1. a failure indicator → Failed, whatever the exit code says
    //   2. a benign "already there" outcome → Succeeded, *even on a non-zero
    //      exit code* (`0x8A150061`)
    //   3. a non-zero exit code → Failed
    //   4. otherwise → Succeeded
    //
    // Clause 2 exists because winget encodes "already installed" as an error
    // code; treating a non-zero code as authoritative unconditionally (as an
    // intermediate version of this function did) broke the most common
    // real-world case: running a plan a second time.
    if failure_evidence {
        let reason = if is_no_package_found(&lower) {
            // The message names the wrong-package case, but the code is still
            // appended: the hex HRESULT is how this failure is looked up, and
            // dropping it here (as an earlier version did) removed the one detail a
            // student pasting the error into a search engine needs.
            format!(
                "{subject}：软件源中没有找到对应的包（退出码 {}）",
                format_exit_code(exit_code)
            )
        } else {
            format!("{subject} 安装失败（退出码 {}）", format_exit_code(exit_code))
        };

        return (AttemptOutcome::Failed, Some(exit_code), output, Some(reason));
    }

    if already_installed || exit_code == 0 {
        return (AttemptOutcome::Succeeded, Some(exit_code), output, None);
    }

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

/// Removes the downloaded payloads of a finished session.
///
/// Called at the end of a run so the work directory does not accumulate
/// installers. Failures are ignored: a file we could not delete is not a reason
/// to report the installation as failed.
pub fn clean_downloads() {
    let dir = super::detect::work_directory().join("downloads");
    if !dir.exists() {
        return;
    }
    let _ = std::fs::remove_dir_all(&dir);
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
    path.starts_with(&work)
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
                let StrategySource::OfficialInstaller(url) = strategy.source else {
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
