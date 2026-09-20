//! VS Code extension bootstrap.
//!
//! Reuse decision: **we call the vendor's CLI, `code --install-extension`.**
//!
//! What we deliberately do *not* build:
//!
//! * a VSIX downloader — marketplace URLs are versioned and signed, and the
//!   vendor already solved resolution, platform selection and dependency pulls;
//! * an extension-directory writer — installing by unzipping into
//!   `~/.vscode/extensions` bypasses the vendor's own bookkeeping
//!   (`extensions.json`, `obsolete` markers), so VS Code shows the extension as
//!   broken and the user cannot uninstall it;
//! * a marketplace client — no API key, no rate limits, no undocumented
//!   endpoints to break.
//!
//! `code --install-extension` is idempotent, prints a machine-readable result,
//! and is the same code path the VS Code UI uses. The only thing left for us is
//! deciding *when* to call it and *proving* it worked, which is what this module
//! and [`super::verify`] do.
//!
//! No extension id is hard-coded here. The list comes from the profile; this
//! module only knows how to ask, list and format.

use std::path::PathBuf;

/// One extension the profile asks for.
///
/// `id` is the marketplace's own `publisher.name` form — we do not invent an
/// identifier scheme, because `code --install-extension` already defines one and
/// anything else would have to be translated into it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtensionRequest {
    pub id: String,
    /// Optional version pin (`id@1.2.3`), passed through verbatim.
    pub version: Option<String>,
}

impl ExtensionRequest {
    /// Parses `publisher.name` or `publisher.name@1.2.3`.
    pub fn parse(spec: &str) -> Option<Self> {
        let spec = spec.trim();
        if spec.is_empty() {
            return None;
        }
        // The id must contain exactly one dot separating publisher and name.
        // `code --install-extension` accepts a bare name too, but accepting that
        // here would let a typo in a profile silently install the wrong
        // publisher's extension.
        let (id, version) = match spec.split_once('@') {
            Some((id, version)) if !version.is_empty() => (id, Some(version.to_string())),
            _ => (spec, None),
        };
        if !id.contains('.') || id.starts_with('.') || id.ends_with('.') {
            return None;
        }
        Some(Self {
            id: id.to_string(),
            version,
        })
    }

    /// The argument to pass to the CLI, version included when pinned.
    pub fn cli_argument(&self) -> String {
        match &self.version {
            Some(version) => format!("{}@{}", self.id, version),
            None => self.id.clone(),
        }
    }

    /// The id as it appears in `code --list-extensions` (no version).
    pub fn lookup_id(&self) -> &str {
        &self.id
    }
}

/// Whether the `code` CLI is usable, and where it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliStatus {
    /// Resolved and answered a version query.
    Available { path: PathBuf, version: String },
    /// VS Code is installed but the CLI shim could not be run.
    ///
    /// Distinct from `Absent` because the fix is different: the editor is there,
    /// so the student should be told to reopen the app rather than to install it.
    EditorPresentCliMissing { editor_path: PathBuf },
    /// Not present at all.
    Absent,
}

impl CliStatus {
    pub fn is_usable(&self) -> bool {
        matches!(self, CliStatus::Available { .. })
    }

    /// A sentence for the UI's blocked-state, or `None` when usable.
    pub fn problem(&self) -> Option<String> {
        match self {
            CliStatus::Available { .. } => None,
            CliStatus::EditorPresentCliMissing { editor_path } => Some(format!(
                "已找到 VS Code（{}），但 `code` 命令行工具不可用。请打开 VS Code 后执行一次 \
                 「Shell Command: Install 'code' command in PATH」，然后重试。",
                editor_path.display()
            )),
            CliStatus::Absent => {
                Some("未找到 VS Code。请先完成软件安装步骤，再配置插件。".to_string())
            }
        }
    }
}

/// Parses `code --list-extensions [--show-versions]` output.
///
/// The CLI prints one extension per line, `publisher.name` or
/// `publisher.name@1.2.3`. Output is lowercased before comparison by the caller,
/// because the CLI's own casing is not stable across versions.
///
/// ## Why the filter is strict
/// Some builds print advisory text on the same stream ("Installing extensions…",
/// or a `[Info]` notice). A loose `line.contains('.')` test is not enough: an
/// advisory sentence ends in a full stop, so every such line would be taken for
/// an extension id. The shape is checked properly instead — exactly one `@`, and
/// a `publisher.name` on either side of it — which is the form the marketplace
/// actually defines.
pub fn parse_installed_list(raw: &str) -> Vec<(String, Option<String>)> {
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(parse_extension_line)
        .collect()
}

/// Parses one line into `(id, version)`, or `None` when it is not an extension id.
fn parse_extension_line(line: &str) -> Option<(String, Option<String>)> {
    // `publisher.name` or `publisher.name@version`; no whitespace, no trailing
    // punctuation, at most one `@`.
    if line.contains(char::is_whitespace) {
        return None;
    }
    let (raw_id, version) = match line.split_once('@') {
        Some((id, version)) => {
            if version.is_empty() || version.contains('@') {
                return None;
            }
            (id, Some(version.to_string()))
        }
        None => (line, None),
    };

    let (publisher, name) = raw_id.split_once('.')?;
    if publisher.is_empty() || name.is_empty() || name.contains('.') {
        return None;
    }
    if !raw_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return None;
    }

    Some((raw_id.to_ascii_lowercase(), version))
}

/// Whether an extension is present in a `--list-extensions` result.
///
/// Compares case-insensitively: `ms-python.python` and `MS-Python.Python` are the
/// same extension, and the CLI has reported both spellings across versions.
pub fn is_installed(installed: &[(String, Option<String>)], request: &ExtensionRequest) -> bool {
    let wanted = request.lookup_id().to_ascii_lowercase();
    installed.iter().any(|(id, _)| *id == wanted)
}

/// Whether the *exact* version the profile pinned is the one present.
///
/// Only meaningful when a version is pinned. Returns `true` when unpinned, so the
/// caller can treat "any version" as satisfied — refusing to act because a
/// student has a newer build than the profile named would be obstruction.
pub fn version_satisfied(installed: &[(String, Option<String>)], request: &ExtensionRequest) -> bool {
    let Some(wanted) = request.version.as_deref() else {
        return true;
    };
    let target = request.lookup_id().to_ascii_lowercase();
    installed
        .iter()
        .filter(|(id, _)| *id == target)
        .any(|(_, version)| version.as_deref() == Some(wanted))
}

/// Whether `code --install-extension` output indicates success.
///
/// Two cases both mean the desired end state holds, and both must be treated as
/// success or a second run of the same profile looks broken:
///
/// * the extension was just installed;
/// * it was already there — which is what the CLI prints on a repeat run.
///
/// A non-zero exit code with an "already installed" message is explicitly
/// accepted. The CLI has been observed to exit non-zero in that case, and
/// treating the message as authoritative is what makes the step idempotent.
pub fn outcome_from_cli_output(exit_code: i32, output: &str) -> ExtensionOutcome {
    let lower = output.to_lowercase();

    if lower.contains("already installed") {
        return ExtensionOutcome::AlreadyPresent;
    }
    if lower.contains("not found") || lower.contains("no extension") {
        return ExtensionOutcome::NotFound;
    }

    if exit_code == 0 {
        return ExtensionOutcome::Installed;
    }
    ExtensionOutcome::Failed
}

/// What the CLI said happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtensionOutcome {
    Installed,
    /// Already present — a success that must not be reported as a change.
    AlreadyPresent,
    /// The marketplace has no such extension or the id is wrong.
    NotFound,
    Failed,
}

impl ExtensionOutcome {
    pub fn is_success(self) -> bool {
        matches!(self, ExtensionOutcome::Installed | ExtensionOutcome::AlreadyPresent)
    }

    /// Whether a different strategy could help.
    ///
    /// `NotFound` is retryable in the sense that matters here: it is a data
    /// problem (a typo, or an extension that moved publisher), and the honest
    /// response is to report it rather than to silently skip.
    pub fn is_retryable(self) -> bool {
        matches!(self, ExtensionOutcome::Failed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_plain_extension_id() {
        let request = ExtensionRequest::parse("ms-python.python").unwrap();
        assert_eq!(request.id, "ms-python.python");
        assert_eq!(request.version, None);
        assert_eq!(request.cli_argument(), "ms-python.python");
    }

    #[test]
    fn parses_a_pinned_version() {
        let request = ExtensionRequest::parse("ms-python.python@2024.10.0").unwrap();
        assert_eq!(request.id, "ms-python.python");
        assert_eq!(request.version.as_deref(), Some("2024.10.0"));
        assert_eq!(request.cli_argument(), "ms-python.python@2024.10.0");
        assert_eq!(
            request.lookup_id(),
            "ms-python.python",
            "the version must not leak into the lookup id"
        );
    }

    #[test]
    fn rejects_a_malformed_id() {
        // A bare name is ambiguous between publishers, so accepting it would let
        // a profile typo install someone else's extension.
        assert!(ExtensionRequest::parse("python").is_none());
        assert!(ExtensionRequest::parse("").is_none());
        assert!(ExtensionRequest::parse(".python").is_none());
        assert!(ExtensionRequest::parse("ms-python.").is_none());
        assert!(ExtensionRequest::parse("   ").is_none());
    }

    #[test]
    fn parses_the_installed_list() {
        let raw = "ms-python.python\nms-vscode.cpptools@1.19.0\n\ngitlens.gitlens\n";
        let list = parse_installed_list(raw);
        assert_eq!(list.len(), 3);
        assert_eq!(list[0], ("ms-python.python".into(), None));
        assert_eq!(
            list[1],
            ("ms-vscode.cpptools".into(), Some("1.19.0".into()))
        );
    }

    #[test]
    fn installed_list_ignores_noise_lines() {
        // Some builds print advisory text on the same stream.
        let raw = "ms-python.python\nInstalling extensions...\n";
        let list = parse_installed_list(raw);
        assert_eq!(list.len(), 1, "got: {list:?}");
    }

    #[test]
    fn membership_is_case_insensitive() {
        // The CLI has reported both `MS-Python.Python` and `ms-python.python`.
        let installed = parse_installed_list("MS-Python.Python@2024.1.0\n");
        let request = ExtensionRequest::parse("ms-python.python").unwrap();
        assert!(is_installed(&installed, &request));
    }

    #[test]
    fn a_pinned_version_is_only_satisfied_by_that_version() {
        let installed = parse_installed_list("ms-python.python@2024.1.0\n");
        let pinned = ExtensionRequest::parse("ms-python.python@2024.10.0").unwrap();
        assert!(!version_satisfied(&installed, &pinned));

        let matching = ExtensionRequest::parse("ms-python.python@2024.1.0").unwrap();
        assert!(version_satisfied(&installed, &matching));
    }

    #[test]
    fn an_unpinned_request_is_satisfied_by_any_version() {
        // Refusing to act because the student has a *newer* build than the
        // profile named would be obstruction, not rigour.
        let installed = parse_installed_list("ms-python.python@9999.0.0\n");
        let request = ExtensionRequest::parse("ms-python.python").unwrap();
        assert!(version_satisfied(&installed, &request));
    }

    #[test]
    fn a_missing_extension_is_not_reported_as_satisfied() {
        let installed = parse_installed_list("gitlens.gitlens\n");
        let request = ExtensionRequest::parse("ms-python.python").unwrap();
        assert!(!is_installed(&installed, &request));
    }

    #[test]
    fn already_installed_is_a_success_not_a_failure() {
        // This is what the second run of the same profile looks like. Reporting
        // it as a failure would make re-running look broken.
        let outcome = outcome_from_cli_output(1, "Extension 'ms-python.python' is already installed.");
        assert_eq!(outcome, ExtensionOutcome::AlreadyPresent);
        assert!(outcome.is_success());
    }

    #[test]
    fn exit_zero_means_installed() {
        let outcome = outcome_from_cli_output(0, "Installing extensions...\nExtension 'x.y' was successfully installed.");
        assert_eq!(outcome, ExtensionOutcome::Installed);
        assert!(outcome.is_success());
    }

    #[test]
    fn an_unknown_extension_is_not_found() {
        let outcome = outcome_from_cli_output(1, "Extension 'no.such' not found.");
        assert_eq!(outcome, ExtensionOutcome::NotFound);
        assert!(!outcome.is_success());
        assert!(!outcome.is_retryable());
    }

    #[test]
    fn a_generic_failure_is_retryable() {
        let outcome = outcome_from_cli_output(1, "Error: connect ETIMEDOUT");
        assert_eq!(outcome, ExtensionOutcome::Failed);
        assert!(outcome.is_retryable());
    }

    #[test]
    fn cli_status_explains_the_editor_present_cli_missing_case() {
        // The one that matters: VS Code is installed, so telling the student to
        // install it would be wrong.
        let status = CliStatus::EditorPresentCliMissing {
            editor_path: PathBuf::from(r"C:\Code\Code.exe"),
        };
        let problem = status.problem().unwrap();
        assert!(problem.contains("Shell Command"), "got: {problem}");
        assert!(!status.is_usable());

        assert!(CliStatus::Available {
            path: PathBuf::from(r"C:\Code\bin\code.cmd"),
            version: "1.136.2".into()
        }
        .problem()
        .is_none());
        assert!(CliStatus::Absent.problem().unwrap().contains("先完成软件安装"));
    }
}
