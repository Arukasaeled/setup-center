//! Process Runner — Concurrent pipe draining, deadline enforcement, cancel tokens,
//! and encoding-safe output decoders.
//!
//! Solves:
//! - B01: Deadlock when waiting on child before draining stdout/stderr pipes.
//! - B09: Lost newlines and dropped lines on non-UTF-8 console output.
//! - B15: Unbounded subprocess execution during detection / probes.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const DEFAULT_PROBE_TIMEOUT: Duration = Duration::from_secs(10);
pub const DEFAULT_MAX_OUTPUT_BYTES: usize = 32 * 1024;
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminationReason {
    ExitSuccess,
    ExitFailure,
    Timeout,
    Cancelled,
    SpawnFailed,
    Interrupted,
    NeedsAttention,
}

#[derive(Clone)]
pub struct ProcessSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub timeout: Duration,
    pub max_output_bytes: usize,
    pub cancel_flag: Option<crate::modules::executor::CancelFlag>,
    pub job_object: Option<std::sync::Arc<crate::modules::task::JobObjectGuard>>,
    pub task_id: Option<String>,
    pub task_manager: Option<std::sync::Arc<crate::modules::task::TaskManager>>,
}

impl std::fmt::Debug for ProcessSpec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProcessSpec")
            .field("program", &self.program)
            .field("args", &self.args)
            .field("cwd", &self.cwd)
            .field("timeout", &self.timeout)
            .field("max_output_bytes", &self.max_output_bytes)
            .field("task_id", &self.task_id)
            .field("has_task_manager", &self.task_manager.is_some())
            .finish_non_exhaustive()
    }
}

impl ProcessSpec {
    pub fn new(program: impl Into<String>, args: &[impl AsRef<str>]) -> Self {
        Self {
            program: program.into(),
            args: args.iter().map(|s| s.as_ref().to_string()).collect(),
            cwd: None,
            timeout: DEFAULT_PROBE_TIMEOUT,
            max_output_bytes: DEFAULT_MAX_OUTPUT_BYTES,
            cancel_flag: None,
            job_object: None,
            task_id: None,
            task_manager: None,
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn with_cwd(mut self, cwd: PathBuf) -> Self {
        self.cwd = Some(cwd);
        self
    }

    pub fn with_cancel(mut self, cancel: crate::modules::executor::CancelFlag) -> Self {
        self.cancel_flag = Some(cancel);
        self
    }

    pub fn with_max_output(mut self, bytes: usize) -> Self {
        self.max_output_bytes = bytes;
        self
    }

    pub fn with_job_object(
        mut self,
        job: Option<std::sync::Arc<crate::modules::task::JobObjectGuard>>,
    ) -> Self {
        self.job_object = job;
        self
    }

    pub fn with_task_context(
        mut self,
        task_id: Option<String>,
        manager: Option<std::sync::Arc<crate::modules::task::TaskManager>>,
    ) -> Self {
        self.task_id = task_id;
        self.task_manager = manager;
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResult {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub merged_output: String,
    pub termination_reason: TerminationReason,
    pub truncated: bool,
    pub encoding_warning: Option<String>,
    pub duration_ms: u64,
    pub cleanup_error: Option<String>,
}

/// Executes a process with concurrent pipe reading, deadline enforcement, and cancel token.
/// Prohibits waiting on child before draining pipes to prevent pipe buffer deadlocks (B01).
#[cfg(not(windows))]
pub fn execute_process(spec: &ProcessSpec) -> Result<ProcessResult, String> {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args);
    if let Some(ref dir) = spec.cwd {
        cmd.current_dir(dir);
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::null());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let start = Instant::now();
    let mut child = cmd.spawn().map_err(|e| format!("启动进程 '{}' 失败: {e}", spec.program))?;

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        if let Some(ref job) = spec.job_object {
            let raw_handle = child.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE;
            if let Err(e) = job.assign_process(raw_handle) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("分配进程至受管理 Job Object 失败: {e}"));
            }
        }
    }

    let pid = child.id();
    let attempt_id = format!("proc-{}-{}", pid, start.elapsed().as_nanos());
    let mut generation = 0u64;
    if let (Some(ref tm), Some(ref task_id)) = (&spec.task_manager, &spec.task_id) {
        generation = tm.next_process_generation();
        let _ = tm.register_process(task_id, &attempt_id, generation, pid, spec.job_object.clone());
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let max_bytes = spec.max_output_bytes;

    // Concurrent reader thread 1: stdout via channel
    let (tx_out, rx_out) = std::sync::mpsc::channel();
    let _t_stdout = std::thread::spawn(move || {
        let mut captured = Vec::new();
        let mut truncated = false;
        if let Some(mut stream) = stdout {
            let mut buf = [0u8; 4096];
            loop {
                match stream.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if captured.len() < max_bytes {
                            let to_copy = n.min(max_bytes - captured.len());
                            captured.extend_from_slice(&buf[..to_copy]);
                            if to_copy < n {
                                truncated = true;
                            }
                        } else {
                            truncated = true;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
        }
        let _ = tx_out.send((captured, truncated));
    });

    // Concurrent reader thread 2: stderr via channel
    let (tx_err, rx_err) = std::sync::mpsc::channel();
    let _t_stderr = std::thread::spawn(move || {
        let mut captured = Vec::new();
        let mut truncated = false;
        if let Some(mut stream) = stderr {
            let mut buf = [0u8; 4096];
            loop {
                match stream.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if captured.len() < max_bytes {
                            let to_copy = n.min(max_bytes - captured.len());
                            captured.extend_from_slice(&buf[..to_copy]);
                            if to_copy < n {
                                truncated = true;
                            }
                        } else {
                            truncated = true;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
        }
        let _ = tx_err.send((captured, truncated));
    });

    let mut termination_reason = TerminationReason::ExitSuccess;
    let mut exit_code = None;

    // Main monitor loop: monitors cancellation, try_wait, and deadline
    loop {
        if let Some(ref cancel) = spec.cancel_flag {
            if cancel.is_cancelled() {
                termination_reason = TerminationReason::Cancelled;
                if let Some(ref job) = spec.job_object {
                    let _ = job.terminate(1);
                }
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                exit_code = status.code();
                termination_reason = if status.success() {
                    TerminationReason::ExitSuccess
                } else {
                    TerminationReason::ExitFailure
                };
                break;
            }
            Ok(None) => {
                if start.elapsed() >= spec.timeout {
                    termination_reason = TerminationReason::Timeout;
                    if let Some(ref job) = spec.job_object {
                        let _ = job.terminate(1);
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_e) => {
                termination_reason = TerminationReason::ExitFailure;
                if let Some(ref job) = spec.job_object {
                    let _ = job.terminate(1);
                }
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }

    // Drain pipes with up to 5 seconds deadline
    let drain_deadline = Instant::now() + Duration::from_secs(5);
    let (stdout_bytes, stdout_truncated, stdout_ok) = match rx_out.recv_timeout(drain_deadline.saturating_duration_since(Instant::now())) {
        Ok((b, t)) => (b, t, true),
        Err(_) => (Vec::new(), true, false),
    };
    let (stderr_bytes, stderr_truncated, stderr_ok) = match rx_err.recv_timeout(drain_deadline.saturating_duration_since(Instant::now())) {
        Ok((b, t)) => (b, t, true),
        Err(_) => (Vec::new(), true, false),
    };

    if !stdout_ok || !stderr_ok {
        termination_reason = TerminationReason::NeedsAttention;
        let manager = spec.task_manager.clone();
        // Own the blocked readers until EOF instead of dropping their handles.
        std::thread::spawn(move || {
            let _ = _t_stdout.join();
            let _ = _t_stderr.join();
            if let Some(tm) = manager { tm.unregister_process(&attempt_id, generation); }
        });
    } else {
        let _ = _t_stdout.join();
        let _ = _t_stderr.join();
        if let Some(ref tm) = spec.task_manager { tm.unregister_process(&attempt_id, generation); }
    }

    let (stdout_str, stdout_warn) = decode_bytes_robust(&stdout_bytes);
    let (stderr_str, stderr_warn) = decode_bytes_robust(&stderr_bytes);

    let encoding_warning = stdout_warn.or(stderr_warn);
    let truncated = stdout_truncated || stderr_truncated;

    let merged_output = if stderr_str.is_empty() {
        stdout_str.clone()
    } else if stdout_str.is_empty() {
        stderr_str.clone()
    } else {
        format!("{}\n{}", stdout_str, stderr_str)
    };

    Ok(ProcessResult {
        exit_code,
        stdout: stdout_str,
        stderr: stderr_str,
        merged_output,
        termination_reason,
        truncated,
        encoding_warning,
        duration_ms: start.elapsed().as_millis() as u64,
        cleanup_error: None,
    })
}

/// Each pipe has one reader and no outstanding I/O. Read only bytes reported available.
/// https://learn.microsoft.com/windows/win32/api/namedpipeapi/nf-namedpipeapi-peeknamedpipe
#[cfg(windows)]
fn drain_available<R: Read + std::os::windows::io::AsRawHandle>(
    stream: &mut Option<R>, captured: &mut Vec<u8>, max_bytes: usize, truncated: &mut bool,
) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{ERROR_BROKEN_PIPE, ERROR_NO_DATA};
    use windows_sys::Win32::System::Pipes::PeekNamedPipe;
    let Some(pipe) = stream.as_mut() else { return Ok(()); };
    // Bound each pass so a continuously writing child cannot starve cancellation checks.
    for _ in 0..16 {
        let mut available = 0;
        let ok = unsafe { PeekNamedPipe(pipe.as_raw_handle() as _, std::ptr::null_mut(), 0,
            std::ptr::null_mut(), &mut available, std::ptr::null_mut()) };
        if ok == 0 {
            let err = std::io::Error::last_os_error();
            if matches!(err.raw_os_error(), Some(code) if code == ERROR_BROKEN_PIPE as i32 || code == ERROR_NO_DATA as i32) {
                *stream = None;
                return Ok(());
            }
            return Err(format!("读取进程管道状态失败: {err}"));
        }
        if available == 0 { return Ok(()); }
        let mut buf = [0u8; 4096];
        let count = (available as usize).min(buf.len());
        let n = pipe.read(&mut buf[..count]).map_err(|e| format!("读取进程输出失败: {e}"))?;
        if n == 0 { *stream = None; return Ok(()); }
        let keep = n.min(max_bytes.saturating_sub(captured.len()));
        captured.extend_from_slice(&buf[..keep]);
        *truncated |= keep < n;
    }
    Ok(())
}

#[cfg(windows)]
pub fn execute_process(spec: &ProcessSpec) -> Result<ProcessResult, String> {
    use std::os::windows::io::AsRawHandle;
    let mut command = Command::new(&spec.program);
    command.args(&spec.args).stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    command.creation_flags(CREATE_NO_WINDOW);
    if let Some(ref cwd) = spec.cwd { command.current_dir(cwd); }
    let start = Instant::now();
    let mut child = command.spawn().map_err(|e| format!("启动进程 '{}' 失败: {e}", spec.program))?;
    let pid = child.id();
    let attempt_id = format!("proc-{pid}-{}", start.elapsed().as_nanos());
    let mut cleanup_error: Option<String> = None;
    let mut assigned = false;
    if let Some(ref job) = spec.job_object {
        match job.assign_process(child.as_raw_handle() as _) {
            Ok(()) => assigned = true,
            Err(error) => cleanup_error = Some(error),
        }
    }
    let mut generation = 0;
    let mut registered = false;
    let managed = spec.task_manager.is_some() && spec.task_id.is_some();
    if let (Some(tm), Some(task_id)) = (&spec.task_manager, &spec.task_id) {
        generation = tm.next_process_generation();
        let registered_job = if assigned { spec.job_object.clone() } else { None };
        match tm.register_process(task_id, &attempt_id, generation, pid, registered_job) {
            Ok(()) => registered = true,
            Err(error) => cleanup_error = Some(error),
        }
    }
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut out = Vec::new();
    let mut err = Vec::new();
    let mut truncated = false;
    let mut exit_code = None;
    let mut root_exited = false;
    let mut termination_reason = TerminationReason::ExitSuccess;
    let mut stopping = false;
    let mut settle_deadline: Option<Instant> = None;
    let mut reclaimed = false;
    loop {
        let cancelled = spec.cancel_flag.as_ref().is_some_and(|flag| flag.is_cancelled());
        if !stopping && (cancelled || (!root_exited && start.elapsed() >= spec.timeout) || cleanup_error.is_some()) {
            stopping = true;
            termination_reason = if cleanup_error.is_some() { TerminationReason::NeedsAttention }
                else if cancelled { TerminationReason::Cancelled } else { TerminationReason::Timeout };
            settle_deadline.get_or_insert(Instant::now() + Duration::from_secs(5));
            let mut tree_termination_requested = false;
            if assigned {
                if let Some(ref job) = spec.job_object {
                    match job.terminate(1) {
                        Ok(()) => tree_termination_requested = true,
                        Err(error) => cleanup_error = Some(error),
                    }
                }
            }
            match child.try_wait() {
                Ok(Some(status)) => { root_exited = true; exit_code = status.code(); }
                Ok(None) if !tree_termination_requested => { if let Err(error) = child.kill() { cleanup_error = Some(format!("终止根进程失败: {error}")); } }
                Ok(None) => {},
                Err(error) => cleanup_error = Some(format!("读取根进程状态失败: {error}")),
            }
        }
        if !root_exited {
            match child.try_wait() {
                Ok(Some(status)) => {
                    root_exited = true;
                    exit_code = status.code();
                    if !stopping { termination_reason = if status.success() { TerminationReason::ExitSuccess } else { TerminationReason::ExitFailure }; }
                    settle_deadline.get_or_insert(Instant::now() + Duration::from_secs(5));
                }
                Ok(None) => {}
                Err(error) => { cleanup_error = Some(format!("读取根进程状态失败: {error}")); }
            }
        }
        if let Err(error) = drain_available(&mut stdout, &mut out, spec.max_output_bytes, &mut truncated) {
            cleanup_error = Some(error); stdout = None;
        }
        if let Err(error) = drain_available(&mut stderr, &mut err, spec.max_output_bytes, &mut truncated) {
            cleanup_error = Some(error); stderr = None;
        }
        let tree_exited = if assigned {
            match spec.job_object.as_ref().unwrap().active_processes() {
                Ok(count) => count == 0,
                Err(error) => { cleanup_error = Some(error); false }
            }
        } else { root_exited };
        if root_exited && tree_exited && stdout.is_none() && stderr.is_none() {
            // A failed Job binding cannot prove that descendants did not escape the spawn window.
            reclaimed = !managed || assigned;
            break;
        }
        if settle_deadline.is_some_and(|deadline| Instant::now() >= deadline) { break; }
        std::thread::sleep(Duration::from_millis(20));
    }
    // Closing our pipe handles ends all local reading; there are no detached reader threads.
    drop(stdout);
    drop(stderr);
    if !reclaimed {
        cleanup_error.get_or_insert_with(|| "未能确认根进程及进程树完全退出，执行登记已保留".into());
        truncated = true;
    }
    if let (Some(tm), Some(task_id)) = (&spec.task_manager, &spec.task_id) {
        if reclaimed && registered {
            if !tm.unregister_process(&attempt_id, generation) {
                cleanup_error = Some("无法注销已结束的执行登记".into());
            }
        }
        if !reclaimed { tm.retain_child(task_id, child); }
        if let Some(ref error) = cleanup_error { tm.set_anomaly_blocker(task_id, error); }
    }
    if cleanup_error.is_some() { termination_reason = TerminationReason::NeedsAttention; }
    let (stdout_text, stdout_warning) = decode_bytes_robust(&out);
    let (stderr_text, stderr_warning) = decode_bytes_robust(&err);
    let merged_output = match (stdout_text.is_empty(), stderr_text.is_empty()) {
        (_, true) => stdout_text.clone(),
        (true, _) => stderr_text.clone(),
        _ => format!("{stdout_text}\n{stderr_text}"),
    };
    Ok(ProcessResult { exit_code, stdout: stdout_text, stderr: stderr_text, merged_output,
        termination_reason, truncated, encoding_warning: stdout_warning.or(stderr_warning),
        duration_ms: start.elapsed().as_millis() as u64, cleanup_error })
}

/// Decodes bytes prioritizing UTF-8, then Windows OEM/ACP code page, lastly lossy UTF-8.
pub fn decode_bytes_robust(bytes: &[u8]) -> (String, Option<String>) {
    if bytes.is_empty() {
        return (String::new(), None);
    }

    // 1. Strict UTF-8
    if let Ok(text) = std::str::from_utf8(bytes) {
        return (text.to_string(), None);
    }

    // 2. Windows OEM/ACP
    #[cfg(windows)]
    {
        if let Some(text) = decode_windows_codepage(bytes) {
            return (text, Some("Decoded with Windows OEM/ACP code page".into()));
        }
    }

    // 3. Fallback: UTF-8 lossy, preserving newlines
    (
        String::from_utf8_lossy(bytes).into_owned(),
        Some("Fallback lossy UTF-8 decoding applied".into()),
    )
}

#[cfg(windows)]
fn decode_windows_codepage(bytes: &[u8]) -> Option<String> {
    use windows_sys::Win32::Globalization::{
        GetOEMCP, MultiByteToWideChar, CP_ACP, MB_ERR_INVALID_CHARS,
    };

    let oem_cp = unsafe { GetOEMCP() };
    for cp in [oem_cp, CP_ACP as u32] {
        let len = unsafe {
            MultiByteToWideChar(
                cp,
                0,
                bytes.as_ptr(),
                bytes.len() as i32,
                std::ptr::null_mut(),
                0,
            )
        };
        if len > 0 {
            let mut wide = vec![0u16; len as usize];
            let written = unsafe {
                MultiByteToWideChar(
                    cp,
                    MB_ERR_INVALID_CHARS,
                    bytes.as_ptr(),
                    bytes.len() as i32,
                    wide.as_mut_ptr(),
                    len,
                )
            };
            if written > 0 {
                wide.truncate(written as usize);
                if let Ok(s) = String::from_utf16(&wide) {
                    return Some(s);
                }
            }
        }
    }
    None
}

/// Incremental decoder for streaming stdout/stderr without dropping multi-byte characters
/// split across chunk boundaries (B09).
#[derive(Default)]
pub struct IncrementalDecoder {
    remainder: Vec<u8>,
    pub warning: Option<String>,
}

impl IncrementalDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds raw chunk, decodes complete code points, keeps trailing split code points in remainder.
    pub fn feed(&mut self, chunk: &[u8]) -> String {
        let mut combined = std::mem::take(&mut self.remainder);
        combined.extend_from_slice(chunk);

        if combined.is_empty() {
            return String::new();
        }

        match std::str::from_utf8(&combined) {
            Ok(valid) => valid.to_string(),
            Err(e) => {
                let valid_up_to = e.valid_up_to();
                if e.error_len().is_none() {
                    // Incomplete UTF-8 sequence at buffer tail
                    self.remainder = combined[valid_up_to..].to_vec();
                    // SAFETY: valid_up_to is guaranteed valid UTF-8 by standard library
                    unsafe { std::str::from_utf8_unchecked(&combined[..valid_up_to]).to_string() }
                } else {
                    // Actual non-UTF-8 character in the middle
                    #[cfg(windows)]
                    if let Some(decoded) = decode_windows_codepage(&combined) {
                        self.warning = Some("Decoded with Windows OEM/ACP code page".into());
                        return decoded;
                    }
                    self.warning = Some("Lossy replacement in stream".into());
                    String::from_utf8_lossy(&combined).into_owned()
                }
            }
        }
    }

    pub fn flush(&mut self) -> String {
        let remaining = std::mem::take(&mut self.remainder);
        if remaining.is_empty() {
            String::new()
        } else {
            let (text, warn) = decode_bytes_robust(&remaining);
            if warn.is_some() {
                self.warning = warn;
            }
            text
        }
    }
}

/// Probes a TCP host with a unified budget spanning both DNS resolution and all IP attempts (B15).
pub fn tcp_probe_with_budget(host: &str, port: u16, total_budget: Duration) -> Option<u32> {
    let start = Instant::now();
    let host_owned = host.to_string();

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        use std::net::ToSocketAddrs;
        let addrs = (host_owned.as_str(), port)
            .to_socket_addrs()
            .map(|iter| iter.collect::<Vec<_>>());
        let _ = tx.send(addrs);
    });

    let addrs = match rx.recv_timeout(total_budget) {
        Ok(Ok(addrs)) if !addrs.is_empty() => addrs,
        _ => return None,
    };

    for addr in addrs {
        let elapsed = start.elapsed();
        if elapsed >= total_budget {
            return None;
        }
        let remaining = total_budget - elapsed;
        let connect_timeout = remaining.min(Duration::from_millis(2500));
        let connect_start = Instant::now();
        if std::net::TcpStream::connect_timeout(&addr, connect_timeout).is_ok() {
            return Some(connect_start.elapsed().as_millis() as u32);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incremental_decoder_handles_split_utf8_sequences() {
        let mut decoder = IncrementalDecoder::new();
        let full_text = "测试中文🌟换行\n第二行";
        let bytes = full_text.as_bytes();

        // Feed half of a 3-byte Chinese character across chunk boundary
        let split_idx = 4; // Inside the second UTF-8 character
        let part1 = &bytes[..split_idx];
        let part2 = &bytes[split_idx..];

        let out1 = decoder.feed(part1);
        let out2 = decoder.feed(part2);
        let out3 = decoder.flush();

        let reconstructed = format!("{out1}{out2}{out3}");
        assert_eq!(reconstructed, full_text);
    }

    #[test]
    fn robust_decoder_preserves_newlines() {
        let input = "Line 1\r\nLine 2\nLine 3\n";
        let (decoded, warn) = decode_bytes_robust(input.as_bytes());
        assert_eq!(decoded, input);
        assert!(warn.is_none());
    }
}
