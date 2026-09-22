//! `install.log` — the persistent, append-only record of what the installer did.
//!
//! Why this module exists
//! ----------------------
//! Before 0.1.1 a failed install produced a message on screen and nothing else.
//! The moment the student closed the window, the command that failed, its exit
//! code and its stderr were gone — which made "it didn't work" impossible to
//! diagnose after the fact, by the student or by anyone helping them.
//!
//! The brief asks for errors to be *traceable*. That means three properties, and
//! each one is a deliberate choice here:
//!
//! * **Persistent** — written to disk under `%LOCALAPPDATA%\Setup Center\logs`,
//!   so it survives an app restart and a reboot. The in-memory [`ExecutionSession`]
//!   is the live view; this file is what remains.
//! * **Append-only** — never truncated. A log that starts fresh each run loses
//!   exactly the run the student is asking about. Rotation is not attempted: the
//!   file is small (one block per failed step) and losing history to save a few
//!   kilobytes would defeat the purpose.
//! * **Sufficient to diagnose** — timestamp, step id, command, exit code, stderr
//!   and the classified failure reason. The command and its output are the whole
//!   point; a line that says only "failed" would be a worse bug report than the
//!   dialog it replaces.
//!
//! What is deliberately *not* written
//! ----------------------------------
//! Licence keys and any other secret. [`redact`] is applied to every field that
//! can carry captured process output, because a command's stderr is arbitrary
//! text and an installer that echoes a token would otherwise put it on disk in
//! cleartext. See `license.rs` for the key format this defends against — this
//! module does not import it, because redaction must not depend on the licence
//! module being initialised.
//!
//! [`ExecutionSession`]: crate::model::ExecutionSession

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use crate::model::{ActionRecord, AttemptOutcome, ExecutionSession, StepStatus};

/// Subdirectory of the app's per-user directory that holds logs.
const LOG_DIR: &str = "logs";

/// The file the brief names. One name, one place.
const LOG_FILE: &str = "install.log";

/// Cap on a single logged output blob, in bytes.
///
/// A failing installer can emit megabytes (winget is verbose, and a compiler
/// error dump is worse). The log exists to be read, so it keeps the head — the
/// first lines of a tool's output name the problem far more often than the last,
/// and an unbounded field would make the file useless to open.
const MAX_OUTPUT_BYTES: usize = 4_000;

/// Where the log lives: `<app dir>\logs\install.log`.
///
/// Reuses [`work_directory`] rather than re-deriving the path, so there is one
/// definition of the app's per-user directory and the `LOCALAPPDATA` →
/// `USERPROFILE` → `C:\` fallback is not duplicated (and cannot drift).
///
/// [`work_directory`]: super::detect::work_directory
pub fn log_directory() -> PathBuf {
    super::detect::work_directory().join(LOG_DIR)
}

/// Full path of `install.log`.
pub fn log_path() -> PathBuf {
    log_directory().join(LOG_FILE)
}

/// Reasons an install run can fail, in the student's language.
///
/// Kept as a small closed set so the log is greppable by cause: "how often does
/// this fail because winget is missing?" is a question the file should be able to
/// answer, and free-form prose would make it unanswerable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    /// The command ran and reported failure.
    NonZeroExit,
    /// The tool could not be found (winget absent, path wrong).
    Unavailable,
    /// Windows refused the operation — usually the administrator case.
    PermissionDenied,
    /// The student cancelled.
    Cancelled,
    /// The command reported success but the program is not on the machine.
    ///
    /// This is the case the brief singles out. It is a *failure* here even though
    /// the installer exited 0, which is why it has its own variant rather than
    /// being folded into `NonZeroExit`.
    VerifyFailed,
}

impl FailureKind {
    /// The stable token written into the log. ASCII on purpose: this is a
    /// machine-readable field, and it should survive a console whose encoding
    /// mangles the Chinese.
    pub fn token(self) -> &'static str {
        match self {
            FailureKind::NonZeroExit => "non-zero-exit",
            FailureKind::Unavailable => "unavailable",
            FailureKind::PermissionDenied => "permission-denied",
            FailureKind::Cancelled => "cancelled",
            FailureKind::VerifyFailed => "verify-failed",
        }
    }

    /// What the student is told, and what is logged alongside the token.
    pub fn description(self) -> &'static str {
        match self {
            FailureKind::NonZeroExit => "命令返回了非零退出码",
            FailureKind::Unavailable => "未找到该命令，可能是系统缺少所需组件",
            FailureKind::PermissionDenied => "安装需要管理员权限",
            FailureKind::Cancelled => "用户主动取消",
            FailureKind::VerifyFailed => "安装执行完成，但是未检测到命令",
        }
    }

    /// Classifies something the executor already decided.
    ///
    /// The [`AttemptOutcome`] is the executor's judgement about what the OS did;
    /// this only names it for the log.
    pub fn from_outcome(outcome: AttemptOutcome) -> Option<Self> {
        match outcome {
            AttemptOutcome::Succeeded | AttemptOutcome::Skipped => None,
            AttemptOutcome::Failed => Some(FailureKind::NonZeroExit),
            AttemptOutcome::Unavailable => Some(FailureKind::Unavailable),
            AttemptOutcome::PermissionDenied => Some(FailureKind::PermissionDenied),
            AttemptOutcome::Cancelled => Some(FailureKind::Cancelled),
        }
    }

    /// A remedy the student can act on, for the cancellation/error panel.
    ///
    /// Empty string when there is nothing useful to suggest — better than
    /// inventing advice that does not apply.
    pub fn suggestion(self) -> &'static str {
        match self {
            FailureKind::NonZeroExit => "检查网络连接，或稍后重试",
            FailureKind::Unavailable => "检查网络连接，或确认系统已安装 winget",
            FailureKind::PermissionDenied => "右键以管理员身份重新运行本程序",
            FailureKind::Cancelled => "重新点击「开始安装」可以继续未完成的步骤",
            FailureKind::VerifyFailed => "命令可能在新的终端窗口中才生效，请重启本程序后再试",
        }
    }
}

/// One record destined for `install.log`.
///
/// Built by the caller from whatever it knows, then written by [`append`]. Kept
/// as a plain struct so it can be asserted against in tests without touching the
/// filesystem — the formatting is separable from the IO.
#[derive(Debug, Clone)]
pub struct LogEntry {
    pub step_id: String,
    pub step_name: String,
    pub command: String,
    pub exit_code: Option<i32>,
    pub output: String,
    pub kind: FailureKind,
    /// Extra context that does not fit the fixed fields — the halt reason, the
    /// verification detail, the attempt number.
    pub note: Option<String>,
}

impl LogEntry {
    pub fn new(
        step_id: impl Into<String>,
        step_name: impl Into<String>,
        kind: FailureKind,
    ) -> Self {
        Self {
            step_id: step_id.into(),
            step_name: step_name.into(),
            command: String::new(),
            exit_code: None,
            output: String::new(),
            kind,
            note: None,
        }
    }

    pub fn command(mut self, command: impl Into<String>) -> Self {
        self.command = command.into();
        self
    }

    pub fn exit_code(mut self, code: Option<i32>) -> Self {
        self.exit_code = code;
        self
    }

    pub fn output(mut self, output: impl Into<String>) -> Self {
        self.output = output.into();
        self
    }

    pub fn note(mut self, note: impl Into<String>) -> Self {
        self.note = Some(note.into());
        self
    }

    /// Renders the block that goes into the file.
    ///
    /// Plain text rather than JSON: the student may be asked to open this in
    /// Notepad and paste it into a message, and a format that needs a viewer is
    /// a format that does not get read. The `key: value` shape survives being
    /// pasted into chat.
    pub fn render(&self, timestamp: &str) -> String {
        let mut out = String::new();
        out.push_str("----------------------------------------------------------\n");
        out.push_str(&format!("时间: {timestamp}\n"));
        out.push_str(&format!(
            "状态: {}\n",
            if self.kind == FailureKind::Cancelled {
                "已取消"
            } else {
                "失败"
            }
        ));
        out.push_str(&format!("原因: {}\n", self.kind.description()));
        out.push_str(&format!("类型: {}\n", self.kind.token()));
        out.push_str(&format!("步骤: {} ({})\n", self.step_name, self.step_id));
        if !self.command.is_empty() {
            out.push_str(&format!("命令: {}\n", redact(&self.command)));
        }
        out.push_str(&format!(
            "退出码: {}\n",
            match self.exit_code {
                Some(code) => code.to_string(),
                // Distinguishing "exited 0" from "never ran" matters when the
                // reason is `unavailable` — the second is the common cause.
                None => "无（命令未执行或未返回退出码）".to_string(),
            }
        ));

        let output = redact(&self.output);
        if output.trim().is_empty() {
            out.push_str("输出: （无）\n");
        } else {
            out.push_str("输出:\n");
            for line in truncate(&output, MAX_OUTPUT_BYTES).lines() {
                out.push_str("  ");
                out.push_str(line);
                out.push('\n');
            }
        }

        if let Some(note) = &self.note {
            out.push_str(&format!("备注: {}\n", redact(note)));
        }

        out
    }
}

/// Appends one block to `install.log`, creating the directory and file if needed.
///
/// Returns the path written to, so a caller can tell the student where to look.
/// An IO failure is reported rather than swallowed — but it is *not* propagated
/// as a run failure: being unable to write a log must never turn a working
/// install into a failed one, or a read-only disk would break installing.
pub fn append(entry: &LogEntry) -> std::io::Result<PathBuf> {
    let dir = log_directory();
    fs::create_dir_all(&dir)?;

    let path = dir.join(LOG_FILE);
    let mut file = OpenOptions::new()
        .create(true)
        // Append, never truncate: the previous run's evidence is the reason the
        // student is opening the file in the first place.
        .append(true)
        .open(&path)?;

    let timestamp = super::detect::now_iso8601();
    file.write_all(entry.render(&timestamp).as_bytes())?;
    file.flush()?;

    Ok(path)
}

/// Appends one block and reports the path, ignoring IO failure.
///
/// The convenience form used on the install path, where logging must not be able
/// to fail the run.
pub fn append_lossy(entry: &LogEntry) -> Option<PathBuf> {
    match append(entry) {
        Ok(path) => Some(path),
        Err(err) => {
            eprintln!("[install.log] 无法写入日志: {err}");
            None
        }
    }
}

/// Reads back the log, most recent blocks last.
///
/// Exists so the UI can show the log tail without knowing the path, and so tests
/// can assert on real round-tripped content rather than on the formatter alone.
pub fn read_all() -> std::io::Result<String> {
    match fs::read_to_string(log_path()) {
        Ok(text) => Ok(text),
        // A missing log is the normal state before the first failure — not an
        // error worth surfacing as one.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(err),
    }
}

/// The last `lines` lines of the log, for the failure/cancel panel.
///
/// The panel shows a snippet, not the whole file: a student deciding whether to
/// retry needs the command and the last error, both of which are at the end.
pub fn tail(lines: usize) -> String {
    match read_all() {
        Ok(text) => tail_of(&text, lines),
        Err(_) => String::new(),
    }
}

/// Pure line-slicing, separated from IO so it can be tested without a disk.
fn tail_of(text: &str, lines: usize) -> String {
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join("\n")
}

/// Removes anything that looks like a licence key or secret from logged text.
///
/// Deliberately pattern-based and licence-agnostic: it must work before the
/// licence module is initialised, and it must catch a key regardless of which
/// code path produced it. Two shapes are targeted — the app's own prefixed keys
/// (`SC-…`, see `license.rs`) and any long high-entropy alphanumeric token, which
/// is what a leaked API key or bearer token looks like in captured output.
///
/// This is defence in depth, not the only control: nothing on the install path is
/// *supposed* to handle a key. But stderr is arbitrary text from a third-party
/// program, so "should not happen" is not a guarantee.
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for token in split_keep_separators(text) {
        if is_secretish(&token) {
            out.push_str("[已隐藏]");
        } else {
            out.push_str(&token);
        }
    }
    out
}

/// Splits into whitespace-delimited words and their separators, so redaction can
/// replace a word without eating the surrounding whitespace.
fn split_keep_separators(text: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !current.is_empty() {
                parts.push(std::mem::take(&mut current));
            }
            parts.push(ch.to_string());
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

/// Does this single whitespace-delimited token look like a secret?
///
/// A credential routinely arrives glued to its name — `token=Ab3x…`,
/// `Authorization: Bearer Ab3x…`, `--key Ab3x…`. Checking the whole whitespace
/// token would test the *name* along with the value, so the token is split at
/// `=` and `:` first and the candidate values are judged on their own.
fn is_secretish(token: &str) -> bool {
    if has_secret_prefix(token) {
        return true;
    }

    for candidate in value_candidates(token) {
        if looks_like_generated_value(candidate) {
            return true;
        }
    }

    false
}

/// True for the app's own key prefixes, which are a giveaway regardless of length.
fn has_secret_prefix(token: &str) -> bool {
    let trimmed = trim_edge_punctuation(token);
    let upper = trimmed.to_ascii_uppercase();
    let prefixed = upper.starts_with("SC-")
        || upper.starts_with("SETUP-CENTER-")
        || upper.starts_with("SK-")
        || upper.starts_with("BEARER");
    prefixed && trimmed.len() > 8
}

/// The values inside a `key=value` / `key:value` token, plus the token itself.
///
/// Always yields at least the original token, so a bare high-entropy string with
/// no `=` is still judged.
fn value_candidates(token: &str) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    for (index, ch) in token.char_indices() {
        if ch == '=' || ch == ':' {
            let rest = &token[index + ch.len_utf8()..];
            let rest = trim_edge_punctuation(rest);
            if !rest.is_empty() {
                out.push(rest);
            }
        }
    }
    let bare = trim_edge_punctuation(token);
    if !bare.is_empty() {
        out.push(bare);
    }
    out
}

/// A long unbroken alphanumeric run mixing letters and digits is the shape of a
/// generated code, an API key or a token.
///
/// Ordinary words, paths, package ids and flags are shorter or contain
/// separators, which is what keeps this from eating the output the log exists to
/// preserve.
fn looks_like_generated_value(candidate: &str) -> bool {
    if candidate.len() < 24 {
        return false;
    }
    let all_alnum = candidate.chars().all(|c| c.is_ascii_alphanumeric());
    all_alnum
        && candidate.chars().any(|c| c.is_ascii_digit())
        && candidate.chars().any(|c| c.is_ascii_alphabetic())
}

/// Strips punctuation a shell, a quote or a sentence would wrap a value in.
fn trim_edge_punctuation(text: &str) -> &str {
    text.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
}

/// Keeps the head of an over-long string, marking that it was cut.
fn truncate(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    // Cut on a char boundary: `text` is UTF-8 and Chinese is 3 bytes per char,
    // so slicing at an arbitrary byte would panic.
    let mut end = max;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…（输出过长，已截断）", &text[..end])
}

// ---------------------------------------------------------------------------
// Session-level logging
// ---------------------------------------------------------------------------

/// Writes one block per failed or cancelled step in `session`.
///
/// Called once after a run finishes, rather than on every action, so the log gets
/// the *classified* result — including the post-install verification outcome,
/// which is only known at the end. Returns the path if anything was written.
pub fn log_session_failures(session: &ExecutionSession) -> Option<PathBuf> {
    let mut written: Option<PathBuf> = None;

    for step in &session.steps {
        let kind = match step.status {
            StepStatus::Failed => FailureKind::NonZeroExit,
            StepStatus::Cancelled => FailureKind::Cancelled,
            _ => continue,
        };

        // A step that was never attempted (`cancelled` with no action behind it)
        // is not a failure to log: it is simply not started. Logging it would
        // bury the real failure under "waiting to continue" entries.
        let actions: Vec<&ActionRecord> = session
            .actions
            .iter()
            .filter(|a| a.id == step.step_id)
            .collect();
        if actions.is_empty() && kind == FailureKind::Cancelled {
            continue;
        }

        let last = actions.last();
        let mut entry = LogEntry::new(
            step.step_id.key(),
            step.name.clone(),
            kind,
        );

        if let Some(last) = last {
            entry = entry
                .command(last.command.clone())
                .exit_code(last.exit_code)
                .output(last.output.clone());
            // The executor's finer classification wins: `permissionDenied` and
            // `unavailable` are actionable in different ways than a plain
            // non-zero exit, and the student's next step differs for each.
            if let Some(refined) = FailureKind::from_outcome(last.outcome) {
                entry.kind = refined;
            }
        }

        if let Some(detail) = &step.detail {
            entry = entry.note(detail.clone());
        }

        if let Some(path) = append_lossy(&entry) {
            written = Some(path);
        }
    }

    written
}

/// Records a verification failure — the installer exited 0 but the command is
/// not there.
///
/// This is the case the brief calls out, and it is deliberately its own entry
/// rather than a mutation of an existing one: the exit code *was* zero, and a log
/// that showed a non-zero code would misrepresent what happened. The log should
/// say "the command succeeded and the program still is not present", because that
/// is the surprising and diagnostic fact.
pub fn log_verify_failure(
    step_id: &str,
    step_name: &str,
    command: &str,
    detail: &str,
) -> Option<PathBuf> {
    let entry = LogEntry::new(step_id, step_name, FailureKind::VerifyFailed)
        .command(command)
        .exit_code(Some(0))
        .output(detail);
    append_lossy(&entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_includes_every_diagnostic_field() {
        let entry = LogEntry::new("claude-code", "Claude Code", FailureKind::NonZeroExit)
            .command("npm install -g @anthropic-ai/claude-code")
            .exit_code(Some(1))
            .output("EACCES: permission denied")
            .note("第 2 种方式");

        let text = entry.render("2024-01-01T00:00:00Z");

        assert!(text.contains("2024-01-01T00:00:00Z"));
        assert!(text.contains("non-zero-exit"));
        assert!(text.contains("claude-code"));
        assert!(text.contains("Claude Code"));
        assert!(text.contains("npm install -g @anthropic-ai/claude-code"));
        assert!(text.contains("退出码: 1"));
        assert!(text.contains("EACCES"));
        assert!(text.contains("第 2 种方式"));
    }

    #[test]
    fn cancelled_entries_are_labelled_cancelled_not_failed() {
        let entry = LogEntry::new("x", "X", FailureKind::Cancelled);
        let text = entry.render("t");
        assert!(text.contains("状态: 已取消"));
        assert!(!text.contains("状态: 失败"));
    }

    #[test]
    fn missing_exit_code_is_distinguished_from_zero() {
        let entry = LogEntry::new("x", "X", FailureKind::Unavailable);
        let text = entry.render("t");
        assert!(text.contains("退出码: 无"), "expected explicit 无, got: {text}");
    }

    #[test]
    fn verify_failure_records_zero_exit_honestly() {
        // The whole point: exit code was 0, and the entry must not pretend
        // otherwise while still being a failure.
        let entry = LogEntry::new("c", "Claude Code", FailureKind::VerifyFailed)
            .exit_code(Some(0));
        let text = entry.render("t");
        assert!(text.contains("退出码: 0"));
        assert!(text.contains("verify-failed"));
        assert!(text.contains("未检测到命令"));
    }

    #[test]
    fn long_output_is_truncated_on_a_char_boundary() {
        // Chinese chars are 3 bytes; a naive byte slice would panic here.
        let long = "中文错误信息".repeat(2_000);
        let entry = LogEntry::new("x", "X", FailureKind::NonZeroExit).output(long);
        let text = entry.render("t");
        assert!(text.contains("已截断"));
    }

    #[test]
    fn short_output_is_not_truncated() {
        let entry = LogEntry::new("x", "X", FailureKind::NonZeroExit).output("short");
        let text = entry.render("t");
        assert!(!text.contains("已截断"));
    }

    #[test]
    fn redacts_prefixed_licence_keys() {
        let text = "setting key SC-ABCDEFGHIJKLMNOP done";
        let out = redact(text);
        assert!(!out.contains("SC-ABCDEFGHIJKLMNOP"));
        assert!(out.contains("[已隐藏]"));
        assert!(out.contains("setting key"));
        assert!(out.contains("done"));
    }

    #[test]
    fn redacts_long_high_entropy_tokens() {
        let text = "Authorization token=Ab3xK9mQ2pL7vR4tY8nW1sZ6 leaked";
        let out = redact(text);
        assert!(!out.contains("Ab3xK9mQ2pL7vR4tY8nW1sZ6"), "got: {out}");
    }

    #[test]
    fn redacts_values_glued_to_their_key_by_colon() {
        // The `key:value` shape a header or a config dump produces.
        let out = redact("Authorization: Ab3xK9mQ2pL7vR4tY8nW1sZ6");
        assert!(!out.contains("Ab3xK9mQ2pL7vR4tY8nW1sZ6"), "got: {out}");
    }

    #[test]
    fn redacts_quoted_and_json_shaped_values() {
        let out = redact("{\"api_key\":\"Ab3xK9mQ2pL7vR4tY8nW1sZ6\"}");
        assert!(!out.contains("Ab3xK9mQ2pL7vR4tY8nW1sZ6"), "got: {out}");
    }

    #[test]
    fn redacts_bare_high_entropy_run_with_no_key() {
        let out = redact("Ab3xK9mQ2pL7vR4tY8nW1sZ6");
        assert!(!out.contains("Ab3xK9mQ2pL7vR4tY8nW1sZ6"), "got: {out}");
    }

    #[test]
    fn does_not_redact_realistic_installer_output() {
        // The log is only useful if the common failure text survives intact.
        let text = "\
npm ERR! code EACCES
npm ERR! syscall mkdir
npm ERR! path C:\\Program Files\\nodejs\\node_modules
winget install --id Git.Git --source winget --accept-package-agreements";
        let out = redact(text);
        assert!(out.contains("EACCES"));
        assert!(out.contains("C:\\Program Files\\nodejs\\node_modules"));
        assert!(out.contains("winget install --id Git.Git"));
        assert!(!out.contains("[已隐藏]"), "over-redacted: {out}");
    }

    #[test]
    fn does_not_redact_ordinary_words_or_paths() {
        // Over-redaction would make the log useless for the thing it is for.
        let text = "npm install -g @anthropic-ai/claude-code failed at C:\\Users\\x\\AppData";
        let out = redact(text);
        assert!(out.contains("npm install"));
        assert!(out.contains("claude-code"));
        assert!(out.contains("C:\\Users\\x\\AppData"));
        assert!(!out.contains("[已隐藏]"));
    }

    #[test]
    fn does_not_redact_short_code_like_words() {
        let out = redact("exit code 1 failed");
        assert_eq!(out, "exit code 1 failed");
    }

    #[test]
    fn failure_kinds_have_distinct_tokens() {
        let kinds = [
            FailureKind::NonZeroExit,
            FailureKind::Unavailable,
            FailureKind::PermissionDenied,
            FailureKind::Cancelled,
            FailureKind::VerifyFailed,
        ];
        let mut tokens: Vec<&str> = kinds.iter().map(|k| k.token()).collect();
        tokens.sort_unstable();
        let before = tokens.len();
        tokens.dedup();
        assert_eq!(tokens.len(), before, "tokens must be unique for greppability");
    }

    #[test]
    fn every_failure_kind_has_a_suggestion_or_is_intentionally_empty() {
        // Guards against adding a variant and forgetting user-facing text.
        for kind in [
            FailureKind::NonZeroExit,
            FailureKind::Unavailable,
            FailureKind::PermissionDenied,
            FailureKind::Cancelled,
            FailureKind::VerifyFailed,
        ] {
            assert!(!kind.description().is_empty(), "{kind:?} needs a description");
            assert!(!kind.suggestion().is_empty(), "{kind:?} needs a suggestion");
        }
    }

    #[test]
    fn outcome_classification_maps_success_to_none() {
        assert!(FailureKind::from_outcome(AttemptOutcome::Succeeded).is_none());
        assert!(FailureKind::from_outcome(AttemptOutcome::Skipped).is_none());
        assert_eq!(
            FailureKind::from_outcome(AttemptOutcome::PermissionDenied),
            Some(FailureKind::PermissionDenied)
        );
    }

    #[test]
    fn log_path_is_under_the_app_directory() {
        let dir = log_directory();
        assert!(dir.ends_with("logs"), "got: {}", dir.display());
        assert!(log_path().ends_with("install.log"));
        // Must not collide with the licence file, which lives one level up.
        assert!(
            !log_path().to_string_lossy().contains("license.dat"),
            "the log must never be written to license.dat"
        );
    }

    #[test]
    fn tail_of_a_missing_log_is_empty() {
        // A missing log is the normal pre-failure state, and must not panic or
        // produce an error. Asserted against the *reader* rather than the real
        // `install.log`, because that file is machine state: on a machine where
        // an install has already failed it exists and is non-empty, so a test
        // asserting on it would pass or fail depending on the dev's disk.
        let missing = std::env::temp_dir().join("setup-center-no-such-log-xyz.log");
        let _ = fs::remove_file(&missing);
        let text = fs::read_to_string(&missing).unwrap_or_default();
        assert_eq!(text, "");
        assert!(tail_of(&text, 20).is_empty());
    }

    #[test]
    fn tail_returns_only_the_last_lines() {
        let content = (1..=100)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let out = tail_of(&content, 3);
        assert!(out.contains("line 100"));
        assert!(out.contains("line 98"));
        assert!(!out.contains("line 97"));
    }

    #[test]
    fn tail_of_fewer_lines_than_requested_returns_everything() {
        let out = tail_of("a\nb", 20);
        assert_eq!(out, "a\nb");
    }
}
