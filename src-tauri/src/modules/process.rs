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
}

#[derive(Debug, Clone)]
pub struct ProcessSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub timeout: Duration,
    pub max_output_bytes: usize,
    pub cancel_flag: Option<crate::modules::executor::CancelFlag>,
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
}

/// Executes a process with concurrent pipe reading, deadline enforcement, and cancel token.
/// Prohibits waiting on child before draining pipes to prevent pipe buffer deadlocks (B01).
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

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let max_bytes = spec.max_output_bytes;

    // Concurrent reader thread 1: stdout
    let t_stdout = std::thread::spawn(move || {
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
        (captured, truncated)
    });

    // Concurrent reader thread 2: stderr
    let t_stderr = std::thread::spawn(move || {
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
        (captured, truncated)
    });

    let mut termination_reason = TerminationReason::ExitSuccess;
    let mut exit_code = None;

    // Main monitor loop: monitors cancellation, try_wait, and deadline
    loop {
        if let Some(ref cancel) = spec.cancel_flag {
            if cancel.is_cancelled() {
                termination_reason = TerminationReason::Cancelled;
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
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_e) => {
                termination_reason = TerminationReason::ExitFailure;
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }

    let (stdout_bytes, stdout_truncated) = t_stdout.join().unwrap_or_default();
    let (stderr_bytes, stderr_truncated) = t_stderr.join().unwrap_or_default();

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
    })
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
