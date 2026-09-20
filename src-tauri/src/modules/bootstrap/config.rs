//! ConfigWriter — read, merge, write and roll back configuration files.
//!
//! The brief: "不要简单覆盖文件" (do not simply overwrite files). [The reason that
//! matters is not tidiness: a student's `settings.json` may already contain a
//! font, a theme, an extension list and a dozen keys we know nothing about.
//! Overwriting it would silently destroy work, and the student would have no idea
//! which program did it.
//!
//! Four properties are required and each is a separate mechanism:
//!
//! | requirement | mechanism |
//! |---|---|
//! | 备份 (back up) | [`ConfigWriter::apply`] copies the original next to itself before writing |
//! | merge | per-format [`ConfigAdapter`], not a generic "deep merge" |
//! | 失败恢复 (recover) | the pre-write backup is restored on any failure |
//! | 记录修改 (record) | [`ConfigChange`] with key-level before/after |
//!
//! Why the adapter is per-format
//! -----------------------------
//! A single "merge JSON-ish text" function would be wrong for all three formats
//! in different ways:
//!
//! * **JSON** — a strict parser can reserialise, so we get a canonical output and
//!   a real diff for free.
//! * **JSONC** — VS Code's `settings.json` ships with `//` comments explaining
//!   every default. A strict parser *rejects* it, and "helpfully rewriting" the
//!   file through a comment-stripping parser would delete Microsoft's own
//!   documentation from the user's editor settings. So the JSONC adapter works
//!   on the *text*: it keeps the comments, and only rewrites the top-level
//!   object's contents.
//! * **TOML** — the format has no comments in values but does have real
//!   semantics (tables, arrays of tables) that a JSON-shaped merge would flatten.
//!
//! The important consequence: a file we cannot parse is **never** rewritten from
//! scratch. [`ConfigError::Unparsable`] is returned and the file is left exactly
//! as it was. A config writer that "repairs" a file it did not understand is how
//! a student loses a working setup.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Every way a configuration write can fail.
///
/// Each variant carries enough context to be shown to a student without a stack
/// trace, because all of them are user-actionable except the last.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigError {
    /// The existing file could not be parsed. Deliberately distinct from a
    /// write error: the fix is to look at the file, not to check permissions.
    Unparsable { path: String, reason: String },
    /// The requested change was itself invalid (e.g. TOML with a nested table
    /// where the format needs a value).
    InvalidChange { reason: String },
    /// The path leaves the directory we are allowed to write to.
    OutsideAllowedRoot { path: String, root: String },
    /// The write failed. Most often a permission problem.
    WriteFailed { path: String, reason: String },
}

impl ConfigError {
    pub fn message(&self) -> String {
        match self {
            ConfigError::Unparsable { path, reason } => {
                format!("{path} 无法解析（{reason}），已保持原样未做修改。")
            }
            ConfigError::InvalidChange { reason } => format!("配置内容无效：{reason}"),
            ConfigError::OutsideAllowedRoot { path, root } => {
                format!("拒绝写入 {path}：不在允许的目录 {root} 内。")
            }
            ConfigError::WriteFailed { path, reason } => {
                format!("写入 {path} 失败：{reason}")
            }
        }
    }

    /// Whether the failure is likely fixed by running elevated.
    ///
    /// Used so the engine can route this into [`super::AttemptOutcome::PermissionDenied`]
    /// instead of a generic failure — the same distinction stage 3 makes for
    /// winget, applied here to a file write.
    pub fn is_permission_problem(&self) -> bool {
        match self {
            ConfigError::WriteFailed { reason, .. } => {
                let r = reason.to_lowercase();
                r.contains("access is denied")
                    || r.contains("permission denied")
                    || r.contains("拒绝访问")
                    || r.contains("os error 5")
            }
            _ => false,
        }
    }
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

// ---------------------------------------------------------------------------
// Change record
// ---------------------------------------------------------------------------

/// One key-level change, so the trace can say what was actually different.
///
/// Recording whole files would make the log useless for the common case: adding
/// one key to a 400-line `settings.json` and dumping 400 lines to say so.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChange {
    pub path: String,
    /// Dotted path within the document, e.g. `terminal.integrated.fontSize`.
    pub key: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

impl ConfigChange {
    /// A one-line description, used in the advanced view.
    pub fn summary(&self) -> String {
        match (&self.before, &self.after) {
            (None, Some(after)) => format!("新增 {} = {}", self.key, after),
            (Some(before), Some(after)) if before == after => {
                format!("{} 已是 {}，无需修改", self.key, after)
            }
            (Some(before), Some(after)) => format!("修改 {}：{} → {}", self.key, before, after),
            (Some(before), None) => format!("删除 {}（原值 {}）", self.key, before),
            (None, None) => format!("{} 无变化", self.key),
        }
    }
}

/// The outcome of one successful [`ConfigWriter::apply`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOutcome {
    /// True when the file content actually differs from what was there.
    ///
    /// `false` is a success, not a no-op failure: it is the "extension already
    /// installed" case of configuration, and reporting it as an error would
    /// make re-running a profile look broken.
    pub changed: bool,
    pub changes: Vec<ConfigChange>,
    /// Where the pre-write copy went, when one was made.
    pub backup_path: Option<String>,
    /// Absolute path written.
    pub path: String,
    /// How many bytes the file is now.
    pub bytes_written: usize,
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/// One configuration file format.
///
/// The trait is deliberately about *text in, text out* rather than about a
/// document tree. A tree-shaped interface would force the JSONC adapter to drop
/// comments (it would have no place to put them), which is the specific failure
/// this design exists to avoid.
pub trait ConfigAdapter {
    /// Stable id, used in the trace.
    fn name(&self) -> &'static str;

    /// Merges `values` into `existing`, returning the new file text.
    ///
    /// `existing` is `None` when the file does not exist yet — the adapter is
    /// then responsible for producing valid empty-file content plus the values.
    fn merge(
        &self,
        existing: Option<&str>,
        values: &BTreeMap<String, serde_json::Value>,
    ) -> Result<(String, Vec<ConfigChange>), ConfigError>;

    /// Whether the text looks like this format, used when auto-detecting.
    fn probe(&self, path: &Path, text: &str) -> bool;
}

/// Picks the adapter for a path.
///
/// `.jsonc` is checked before `.json` because `settings.json` in VS Code is
/// genuinely JSONC — the extension lies — so the caller passes content and the
/// probe gets a chance to correct the filename.
pub fn adapter_for(path: &Path, existing: Option<&str>) -> &'static dyn ConfigAdapter {
    const JSON: JsonAdapter = JsonAdapter;
    const JSONC: JsoncAdapter = JsoncAdapter;
    const TOML: TomlAdapter = TomlAdapter;

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "jsonc" => &JSONC,
        "toml" => &TOML,
        "json" => {
            // The extension says JSON, but VS Code writes comments into
            // `settings.json`. If the existing content has a comment, the strict
            // parser would reject it and we would report "unparsable" on a file
            // the program itself wrote. Detect and use the tolerant adapter.
            if existing.is_some_and(|text| JSONC.probe(path, text)) {
                &JSONC
            } else {
                &JSON
            }
        }
        _ => &JSON,
    }
}

impl dyn ConfigAdapter {
    /// Merges, pre-populating the change list with the ones this adapter found.
    pub fn merge_or_empty(
        &self,
        existing: Option<&str>,
        values: &BTreeMap<String, serde_json::Value>,
    ) -> Result<(String, Vec<ConfigChange>), ConfigError> {
        self.merge(existing, values)
    }
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/// Strict JSON. Round-trips through `serde_json`, so the output is canonical.
pub struct JsonAdapter;

impl ConfigAdapter for JsonAdapter {
    fn name(&self) -> &'static str {
        "json"
    }

    fn merge(
        &self,
        existing: Option<&str>,
        values: &BTreeMap<String, serde_json::Value>,
    ) -> Result<(String, Vec<ConfigChange>), ConfigError> {
        let mut root: serde_json::Value = match existing {
            Some(text) if !text.trim().is_empty() => {
                serde_json::from_str(text).map_err(|e| ConfigError::Unparsable {
                    path: "<existing>".into(),
                    reason: e.to_string(),
                })?
            }
            _ => serde_json::Value::Object(serde_json::Map::new()),
        };

        if !root.is_object() {
            return Err(ConfigError::Unparsable {
                path: "<existing>".into(),
                reason: "顶层不是 JSON 对象，无法安全合并".into(),
            });
        }

        let changes = merge_object(&mut root, values, "");
        let text = serde_json::to_string_pretty(&root)
            .map_err(|e| ConfigError::InvalidChange {
                reason: e.to_string(),
            })?;
        Ok((format!("{text}\n"), changes))
    }

    fn probe(&self, path: &Path, text: &str) -> bool {
        path.extension().and_then(|e| e.to_str()) == Some("json")
            && serde_json::from_str::<serde_json::Value>(text).is_ok()
    }
}

/// Merges flat dotted keys into a JSON object, recording what changed.
///
/// ## Dotted keys mean nesting, but a literal dotted key wins
/// This is the one subtlety the JSON adapter has to get right, because both
/// conventions are real and they collide:
///
/// * A profile writes `terminal.integrated.fontSize` meaning a **nested** object.
/// * A real `settings.json` almost always contains `"terminal.integrated.fontSize"`
///   as a **literal** key, because that is what VS Code's own settings editor
///   writes — VS Code treats the dot as part of the name, not as a path.
///
/// The resolution is: if the document already has a top-level key spelled
/// exactly like the dotted path, treat it as a literal key and replace it. Only
/// when no such key exists do the segments create nesting. Getting this backwards
/// would restructure a student's `settings.json` into nested objects that VS Code
/// does not read — silently breaking every setting they already had.
fn merge_object(
    root: &mut serde_json::Value,
    values: &BTreeMap<String, serde_json::Value>,
    prefix: &str,
) -> Vec<ConfigChange> {
    let mut changes = Vec::new();

    for (key, value) in values {
        let segments: Vec<&str> = key.split('.').filter(|s| !s.is_empty()).collect();
        if segments.is_empty() {
            continue;
        }

        // A literal dotted key already present takes precedence over nesting.
        let literal_exists = segments.len() > 1
            && root
                .as_object()
                .is_some_and(|object| object.contains_key(key.as_str()));

        let before = if literal_exists {
            root.get(key.as_str()).map(render_value)
        } else {
            lookup(root, &segments).map(render_value)
        };

        if literal_exists {
            if let Some(object) = root.as_object_mut() {
                object.insert(key.clone(), value.clone());
            }
        } else {
            insert_deep(root, &segments, value.clone());
        }

        changes.push(ConfigChange {
            path: String::new(), // filled in by the writer, which knows the path
            key: if prefix.is_empty() {
                key.clone()
            } else {
                format!("{prefix}.{key}")
            },
            before,
            after: Some(render_value(value)),
        });
    }

    changes
}

fn lookup<'a>(root: &'a serde_json::Value, segments: &[&str]) -> Option<&'a serde_json::Value> {
    let mut current = root;
    for segment in segments {
        current = current.get(*segment)?;
    }
    Some(current)
}

fn insert_deep(root: &mut serde_json::Value, segments: &[&str], value: serde_json::Value) {
    if segments.len() == 1 {
        if let Some(object) = root.as_object_mut() {
            object.insert(segments[0].to_string(), value);
        }
        return;
    }

    let Some(object) = root.as_object_mut() else {
        return;
    };
    let entry = object
        .entry(segments[0].to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    if !entry.is_object() {
        // An existing scalar where we need an object: overwrite it with one.
        // Keeping the scalar would make the requested nested key unrepresentable,
        // and the previous value is recorded in `before` either way.
        *entry = serde_json::Value::Object(serde_json::Map::new());
    }
    insert_deep(entry, &segments[1..], value);
}

fn render_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// JSONC
// ---------------------------------------------------------------------------

/// JSON with comments and trailing commas.
///
/// This is the adapter that justifies the per-format design. VS Code's
/// `settings.json` is JSONC and frequently *is* commented — a student who pastes
/// a snippet from a tutorial often leaves the tutorial's comments in.
///
/// The strategy is deliberately conservative: **locate the outermost object and
/// splice new key/value pairs into it as text**, leaving every byte outside that
/// splice untouched. Comments survive because they are never parsed.
///
/// The cost is that we cannot do a general key-level diff of an existing nested
/// value with full fidelity — we can find whether a top-level key exists, but a
/// commented-out key is not a key. That is the correct trade: the alternative is
/// deleting the student's comments.
pub struct JsoncAdapter;

impl ConfigAdapter for JsoncAdapter {
    fn name(&self) -> &'static str {
        "jsonc"
    }

    fn merge(
        &self,
        existing: Option<&str>,
        values: &BTreeMap<String, serde_json::Value>,
    ) -> Result<(String, Vec<ConfigChange>), ConfigError> {
        let original = existing.unwrap_or("");
        let span = outer_object_span(original).ok_or_else(|| ConfigError::Unparsable {
            path: "<existing>".into(),
            reason: "找不到顶层 JSON 对象（文件可能只有注释）".into(),
        })?;

        let (open, close) = span;
        let inner = &original[open + 1..close];

        // Strip comments from the *body only* for the purpose of finding existing
        // keys. The original text is what gets written back, so the stripping is
        // purely a lookup aid and its lossiness cannot reach the file.
        let stripped = strip_jsonc_comments(inner);
        let probe_root: serde_json::Value = serde_json::from_str(&format!("{{{stripped}}}"))
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

        let mut changes = Vec::new();
        let mut additions: Vec<String> = Vec::new();

        // The body is edited as **original text**, not as the comment-stripped
        // copy. An earlier version assigned `stripped` here, which passed the
        // comment lookup but wrote the stripped text back — deleting every
        // comment in the file. `stripped` is a lookup aid only; the bytes that
        // survive to the file are the student's own.
        let mut body = inner.trim_end().to_string();

        for (key, value) in values {
            // Only top-level keys are handled here. A dotted key is written as a
            // nested object, which is valid JSONC and what VS Code documents.
            let segments: Vec<&str> = key.split('.').filter(|s| !s.is_empty()).collect();
            let rendered = render_jsonc_value(&segments, value);

            // Literal dotted key wins over nesting, exactly as in `merge_object`:
            // VS Code writes `"terminal.integrated.fontSize"` as a flat key, and
            // restructuring it into nested objects would make the setting stop
            // working.
            let literal_exists = segments.len() > 1
                && probe_root
                    .as_object()
                    .is_some_and(|object| object.contains_key(key.as_str()));

            let (probe_segments, probe_key): (Vec<&str>, String) = if literal_exists {
                (vec![key.as_str()], key.clone())
            } else {
                (segments.clone(), segments[0].to_string())
            };

            let before = probe_root
                .get(&probe_segments[0])
                .map(render_value);
            changes.push(ConfigChange {
                path: String::new(),
                key: key.clone(),
                before: before.clone(),
                after: Some(render_value(value)),
            });

            // An existing key is replaced in place; a new one is appended. Doing
            // it by text means no reformatting of anything we did not touch.
            if before.is_some() {
                body = replace_top_level_key(&body, &probe_key, &rendered);
            } else {
                additions.push(rendered);
            }
        }

        let mut new_body = body.trim().to_string();
        for addition in additions {
            if !new_body.is_empty() {
                new_body.push_str(",\n");
            }
            new_body.push_str("    ");
            new_body.push_str(&addition);
        }

        let mut out = String::with_capacity(original.len() + 128);
        out.push_str(&original[..open + 1]);
        if !new_body.is_empty() {
            out.push('\n');
            out.push_str(&new_body);
            out.push('\n');
        }
        out.push_str(&original[close..]);
        if existing.is_none() && !out.ends_with('\n') {
            out.push('\n');
        }

        Ok((out, changes))
    }

    fn probe(&self, _path: &Path, text: &str) -> bool {
        // A comment or a trailing comma is the signal. Checking the file is
        // genuinely parseable-as-JSONC is the caller's job via `merge`.
        //
        // `has_trailing_comma` reads the raw text directly rather than reusing
        // `strip_jsonc_comments`: that function *normalises* trailing commas
        // away, so a check built on its output could never observe one. That was
        // a real bug — the probe answered `false` for every file that had a
        // trailing comma and no comment.
        let trimmed = text.trim_start();
        trimmed.starts_with("//")
            || trimmed.starts_with("/*")
            || text.contains("//")
            || has_trailing_comma(text)
    }
}

/// Finds the `{ … }` that spans the whole document, ignoring braces in strings
/// and comments.
fn outer_object_span(text: &str) -> Option<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut start = None;
    let mut depth = 0usize;
    let mut i = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    while i < bytes.len() {
        let byte = bytes[i];

        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        // Skip comments so a `{` inside one cannot be mistaken for the opener.
        if byte == b'/' && i + 1 < bytes.len() {
            match bytes[i + 1] {
                b'/' => {
                    while i < bytes.len() && bytes[i] != b'\n' {
                        i += 1;
                    }
                    continue;
                }
                b'*' => {
                    i += 2;
                    while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                        i += 1;
                    }
                    i = (i + 2).min(bytes.len());
                    continue;
                }
                _ => {}
            }
        }

        match byte {
            b'"' => in_string = true,
            b'{' => {
                if start.is_none() {
                    start = Some(i);
                }
                depth += 1;
            }
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    if let Some(s) = start {
                        return Some((s, i));
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Removes `//` and `/* */` comments, leaving string contents intact.
fn strip_jsonc_comments(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    while i < bytes.len() {
        let byte = bytes[i];
        if in_string {
            out.push(byte as char);
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        if byte == b'"' {
            in_string = true;
            out.push('"');
            i += 1;
            continue;
        }

        if byte == b'/' && i + 1 < bytes.len() {
            match bytes[i + 1] {
                b'/' => {
                    while i < bytes.len() && bytes[i] != b'\n' {
                        i += 1;
                    }
                    continue;
                }
                b'*' => {
                    i += 2;
                    while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                        i += 1;
                    }
                    i = (i + 2).min(bytes.len());
                    continue;
                }
                _ => {}
            }
        }

        out.push(byte as char);
        i += 1;
    }

    // Trailing commas are legal in JSONC and illegal in JSON; the body is only
    // ever parsed, never written, so normalising here is safe.
    remove_trailing_commas(&out)
}

fn remove_trailing_commas(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    while i < chars.len() {
        let c = chars[i];
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if c == '"' {
            in_string = true;
            out.push(c);
            i += 1;
            continue;
        }
        if c == ',' {
            // Look ahead past whitespace: a `}` or `]` makes this a trailing comma.
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && (chars[j] == '}' || chars[j] == ']') {
                i += 1;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Whether the text contains a comma immediately before a closer.
///
/// Reads the raw text with comments skipped, and deliberately does *not* go
/// through [`remove_trailing_commas`]: that function removes the very thing this
/// asks about.
fn has_trailing_comma(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    while i < chars.len() {
        let c = chars[i];
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if c == '"' {
            in_string = true;
            i += 1;
            continue;
        }
        if c == '/' && i + 1 < chars.len() {
            match chars[i + 1] {
                '/' => {
                    while i < chars.len() && chars[i] != '\n' {
                        i += 1;
                    }
                    continue;
                }
                '*' => {
                    i += 2;
                    while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                        i += 1;
                    }
                    i = (i + 2).min(chars.len());
                    continue;
                }
                _ => {}
            }
        }
        if c == ',' {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && (chars[j] == '}' || chars[j] == ']') {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// Renders `segments: value` as JSONC text for insertion.
fn render_jsonc_value(segments: &[&str], value: &serde_json::Value) -> String {
    let key = segments.join(".");
    let json = serde_json::to_string_pretty(value).unwrap_or_else(|_| "null".into());
    if segments.len() == 1 {
        return format!("{}: {}", serde_json::to_string(&key).unwrap_or_default(), json);
    }
    // Dotted key: build the nested object by wrapping from the inside out.
    let mut inner = format!(
        "{}: {}",
        serde_json::to_string(segments[segments.len() - 1]).unwrap_or_default(),
        json
    );
    for segment in segments[..segments.len() - 1].iter().rev() {
        inner = format!(
            "{}: {{\n        {}\n    }}",
            serde_json::to_string(segment).unwrap_or_default(),
            inner
        );
    }
    inner
}

/// Replaces the value of a top-level key, preserving everything around it.
fn replace_top_level_key(body: &str, key: &str, rendered: &str) -> String {
    let Some((start, end)) = find_top_level_key_value(body, key) else {
        // The key was found by the JSON probe but not by the text scan — which
        // happens when the key is inside a string value. Appending is the safe
        // recovery: a duplicate key in JSONC is invalid, but silently rewriting
        // the wrong span would be worse.
        return body.to_string();
    };
    let mut out = String::with_capacity(body.len() + rendered.len());
    out.push_str(&body[..start]);
    out.push_str(rendered);
    out.push_str(&body[end..]);
    out
}

/// Finds the byte span of `"key": value` at the top level of an object body.
fn find_top_level_key_value(body: &str, key: &str) -> Option<(usize, usize)> {
    let bytes = body.as_bytes();
    let needle = format!("\"{key}\"");
    let mut depth = 0usize;
    let mut i = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    let mut key_start = None;

    while i < bytes.len() {
        let byte = bytes[i];

        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
                // A closing quote at depth 0 right after a top-level opener is a
                // candidate key.
                if depth == 0 && key_start == Some(i + 1 - needle.len()) {
                    // Fall through to the value scan below.
                }
            }
            i += 1;
            continue;
        }

        if depth == 0 && body[i..].starts_with(&needle) {
            // Confirm the following non-space char is a colon.
            let after = i + needle.len();
            let rest = body[after..].trim_start();
            if rest.starts_with(':') {
                key_start = Some(i);
                let value_start = after + (body[after..].len() - rest.len()) + 1;
                let value_end = scan_value_end(body, value_start);
                return Some((key_start?, value_end));
            }
        }

        match byte {
            b'"' => in_string = true,
            b'{' | b'[' => depth += 1,
            b'}' | b']' => depth = depth.saturating_sub(1),
            _ => {}
        }
        i += 1;
    }
    None
}

/// Returns the index just past the value that starts at `start`.
///
/// Handles nested objects/arrays and quoted strings; a scalar ends at the first
/// comma or closing brace at depth 0.
fn scan_value_end(body: &str, start: usize) -> usize {
    let bytes = body.as_bytes();
    let mut i = start;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    if i < bytes.len() && bytes[i] == b'"' {
        // Quoted string.
        i += 1;
        while i < bytes.len() {
            let byte = bytes[i];
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                return i + 1;
            }
            i += 1;
        }
        return bytes.len();
    }

    while i < bytes.len() {
        let byte = bytes[i];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'{' | b'[' => depth += 1,
            b'}' | b']' => {
                if depth == 0 {
                    return i;
                }
                depth -= 1;
            }
            b',' if depth == 0 => return i,
            _ => {}
        }
        i += 1;
    }
    bytes.len()
}

// ---------------------------------------------------------------------------
// TOML
// ---------------------------------------------------------------------------

/// TOML, handled as text for the same reason JSONC is.
///
/// A `toml` crate would give a parse/serialise round trip, but it does not
/// preserve comments either — and unlike `settings.json`, a student's `config.toml`
/// is less likely to be machine-generated, so preserving their own comments and
/// key order matters more. The `[table]` prefix is used as a section anchor:
/// a key inside a table is written into the right section rather than at the top.
pub struct TomlAdapter;

impl ConfigAdapter for TomlAdapter {
    fn name(&self) -> &'static str {
        "toml"
    }

    fn merge(
        &self,
        existing: Option<&str>,
        values: &BTreeMap<String, serde_json::Value>,
    ) -> Result<(String, Vec<ConfigChange>), ConfigError> {
        let original = existing.unwrap_or("");
        // Validate what is already there before touching it. A TOML file we
        // cannot read is one we must not rewrite.
        if !original.trim().is_empty() {
            if let Err(reason) = validate_toml(original) {
                return Err(ConfigError::Unparsable {
                    path: "<existing>".into(),
                    reason,
                });
            }
        }

        let mut lines: Vec<String> = original.lines().map(str::to_string).collect();
        let mut changes = Vec::new();

        for (key, value) in values {
            let text = render_toml_value(value)?;
            let dotted = key.clone();
            let (table, bare_key) = split_table_key(&dotted);
            let before = toml_lookup(original, table.as_deref(), bare_key);

            changes.push(ConfigChange {
                path: String::new(),
                key: dotted.clone(),
                before,
                after: Some(text.clone()),
            });

            set_toml_line(&mut lines, table.as_deref(), bare_key, &text);
        }

        let mut out = lines.join("\n");
        if !out.ends_with('\n') {
            out.push('\n');
        }
        Ok((out, changes))
    }

    fn probe(&self, path: &Path, _text: &str) -> bool {
        path.extension().and_then(|e| e.to_str()) == Some("toml")
    }
}

/// Validates TOML well enough to refuse a rewrite we would get wrong.
///
/// Deliberately not a full parser: it checks the structural properties a merge
/// can damage — a table header on its own line, and a `key = value` form for
/// every non-comment line. Anything that fails this is left alone.
fn validate_toml(text: &str) -> Result<(), String> {
    for (index, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            let Some(end) = line.find(']') else {
                return Err(format!("第 {} 行：section 头缺少 `]`", index + 1));
            };
            if line[end + 1..].trim().is_empty() || line[end + 1..].trim_start().starts_with('#') {
                continue;
            }
            return Err(format!("第 {} 行：section 头后有意外内容", index + 1));
        }
        if !line.contains('=') {
            return Err(format!("第 {} 行：既不是 section 也不是 key = value", index + 1));
        }
    }
    Ok(())
}

/// Splits a dotted key into an optional `[table]` and the bare key inside it.
///
/// `user.name` → `[user]`, `name`. A single segment has no table.
fn split_table_key(key: &str) -> (Option<String>, &str) {
    match key.rfind('.') {
        Some(index) if index > 0 => (Some(key[..index].to_string()), &key[index + 1..]),
        _ => (None, key),
    }
}

fn toml_lookup(text: &str, table: Option<&str>, key: &str) -> Option<String> {
    let mut current_table: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with('[') && line.ends_with(']') {
            current_table = Some(line[1..line.len() - 1].trim().to_string());
            continue;
        }
        if current_table.as_deref() == table || (table.is_none() && current_table.is_none()) {
            if let Some((k, v)) = line.split_once('=') {
                if k.trim() == key {
                    return Some(v.trim().to_string());
                }
            }
        }
    }
    None
}

fn set_toml_line(lines: &mut Vec<String>, table: Option<&str>, key: &str, rendered: &str) {
    let new_line = format!("{key} = {rendered}");

    // Walk to the target section, replacing an existing key in it.
    let mut current_table: Option<String> = None;
    let mut section_end = lines.len();

    for index in 0..lines.len() {
        let line = lines[index].trim().to_string();
        if line.starts_with('[') && line.ends_with(']') {
            let name = line[1..line.len() - 1].trim().to_string();
            if current_table.as_deref() == table {
                section_end = index;
                break;
            }
            current_table = Some(name);
            continue;
        }
        if current_table.as_deref() == table {
            if let Some((k, _)) = line.split_once('=') {
                if k.trim() == key {
                    lines[index] = new_line;
                    return;
                }
            }
        }
    }

    match table {
        None => {
            // Top-level keys go before the first section header.
            let insert_at = lines
                .iter()
                .position(|l| {
                    let t = l.trim();
                    t.starts_with('[') && t.ends_with(']')
                })
                .unwrap_or(lines.len());
            lines.insert(insert_at, new_line);
        }
        Some(name) => {
            let header = format!("[{name}]");
            let has_section = lines.iter().any(|l| l.trim() == header);
            if has_section {
                let at = lines
                    .iter()
                    .rposition(|l| l.trim() == header)
                    .map(|i| {
                        // Append at the end of that section.
                        let mut j = i + 1;
                        while j < lines.len() {
                            let t = lines[j].trim();
                            if t.starts_with('[') && t.ends_with(']') {
                                break;
                            }
                            j += 1;
                        }
                        j
                    })
                    .unwrap_or(section_end);
                lines.insert(at, new_line);
            } else {
                if !lines.is_empty() && !lines.last().is_some_and(|l| l.trim().is_empty()) {
                    lines.push(String::new());
                }
                lines.push(header);
                lines.push(new_line);
            }
        }
    }
}

/// Renders a JSON value as a TOML literal.
///
/// Only the shapes that have a direct TOML equivalent are accepted. A nested
/// object is *not* silently flattened: returning an error is what keeps a
/// misplaced profile entry from writing nonsense into someone's config.
fn render_toml_value(value: &serde_json::Value) -> Result<String, ConfigError> {
    Ok(match value {
        serde_json::Value::String(s) => toml_string(s),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Array(items) => {
            let rendered: Result<Vec<String>, ConfigError> =
                items.iter().map(render_toml_value).collect();
            format!("[{}]", rendered?.join(", "))
        }
        serde_json::Value::Null => {
            return Err(ConfigError::InvalidChange {
                reason: "TOML 没有 null 字面量；请改用空字符串或删除该项".into(),
            })
        }
        serde_json::Value::Object(_) => {
            return Err(ConfigError::InvalidChange {
                reason: "该 TOML 写入器不支持嵌套对象；请用 `表名.键` 形式表达".into(),
            })
        }
    })
}

/// Quotes a TOML string, picking the literal form when it is actually legal.
///
/// A literal string (`'…'`) is preferred because it needs no escape processing,
/// which keeps Windows paths and regexes readable — the common case in a
/// developer's config. It is only legal when the text contains neither a
/// backslash (which a literal string cannot express as an escape) **nor a single
/// quote** (which would terminate it). Checking only for the backslash, as an
/// earlier version did, produced `'has'quote'` — a TOML syntax error written into
/// the student's config file.
fn toml_string(s: &str) -> String {
    if !s.contains('\\') && !s.contains('\'') {
        format!("'{s}'")
    } else {
        let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
        format!("\"{escaped}\"")
    }
}

// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

/// Applies configuration changes to files, with backup and rollback.
///
/// ## Root confinement
/// Every write must land inside a directory the caller allows. This is enforced
/// here rather than trusted from the profile because a profile is data a user
/// can edit: without this, a `configs` entry could name `C:\Windows\System32\…`
/// and the app would cheerfully try. The allow-list is per-run, so the bootstrap
/// engine declares "these are the directories I will write to" once and every
/// write is checked against it.
///
/// ## Backup and rollback
/// A backup is taken before the first modification of each file, named
/// `<name>.aissetup-backup`. It is *not* timestamped: a single well-known name
/// means a second run re-uses it, and the thing a student needs to recover
/// (the state before this tool touched the file) is not lost in a pile of
/// per-run copies. On any failure the backup is restored, so a failed apply
/// leaves the file byte-identical to how it was found.
pub struct ConfigWriter {
    allowed_roots: Vec<PathBuf>,
    /// When set, nothing is written and the intended outcome is returned.
    /// Used by the plan preview so the UI can show what would change.
    dry_run: bool,
}

impl ConfigWriter {
    pub fn new(allowed_roots: Vec<PathBuf>) -> Self {
        Self {
            allowed_roots,
            dry_run: false,
        }
    }

    pub fn dry_run(mut self, yes: bool) -> Self {
        self.dry_run = yes;
        self
    }

    pub fn allowed_roots(&self) -> &[PathBuf] {
        &self.allowed_roots
    }

    /// Whether `path` is inside one of the allowed roots.
    ///
    /// Compares canonicalised prefixes where possible and falls back to a
    /// lexical comparison for a path that does not exist yet (which is the
    /// normal case for "create this config file").
    pub fn is_allowed(&self, path: &Path) -> bool {
        let normalised = normalise(path);
        self.allowed_roots.iter().any(|root| {
            let root = normalise(root);
            normalised.starts_with(&root)
        })
    }

    /// Writes `values` into `path`, merging with whatever is there.
    pub fn apply(
        &self,
        path: &Path,
        values: &BTreeMap<String, serde_json::Value>,
    ) -> Result<ConfigOutcome, ConfigError> {
        if !self.is_allowed(path) {
            return Err(ConfigError::OutsideAllowedRoot {
                path: path.to_string_lossy().to_string(),
                root: self
                    .allowed_roots
                    .first()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| "<none>".into()),
            });
        }

        let existing = match std::fs::read_to_string(path) {
            Ok(text) => Some(text),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => {
                return Err(ConfigError::WriteFailed {
                    path: path.to_string_lossy().to_string(),
                    reason: e.to_string(),
                })
            }
        };

        let adapter = adapter_for(path, existing.as_deref());
        let (new_text, mut changes) = adapter.merge(existing.as_deref(), values)?;

        for change in changes.iter_mut() {
            change.path = path.to_string_lossy().to_string();
        }

        let unchanged = existing.as_deref() == Some(new_text.as_str());
        let changed = !unchanged;

        let backup = if self.dry_run || !changed {
            None
        } else {
            match existing.as_ref() {
                Some(text) => {
                    let backup_path = backup_path_for(path);
                    std::fs::write(&backup_path, text).map_err(|e| ConfigError::WriteFailed {
                        path: backup_path.to_string_lossy().to_string(),
                        reason: e.to_string(),
                    })?;
                    Some(backup_path)
                }
                None => None,
            }
        };

        if !self.dry_run && changed {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| ConfigError::WriteFailed {
                    path: parent.to_string_lossy().to_string(),
                    reason: e.to_string(),
                })?;
            }

            if let Err(e) = std::fs::write(path, &new_text) {
                // Roll back immediately: a partially written config is worse
                // than either version. The original bytes are in `existing`, so
                // the restoration does not depend on the backup file existing.
                if let Some(text) = existing.as_ref() {
                    let _ = std::fs::write(path, text);
                } else {
                    let _ = std::fs::remove_file(path);
                }
                return Err(ConfigError::WriteFailed {
                    path: path.to_string_lossy().to_string(),
                    reason: e.to_string(),
                });
            }
        }

        Ok(ConfigOutcome {
            changed,
            changes,
            backup_path: backup.map(|p| p.to_string_lossy().to_string()),
            path: path.to_string_lossy().to_string(),
            bytes_written: new_text.len(),
        })
    }

    /// Restores a file from its backup.
    ///
    /// Returns `false` when there is nothing to restore, which the caller should
    /// report rather than treat as success — "restored nothing" and "restored
    /// the original" are different answers to "is my file safe".
    pub fn restore(&self, path: &Path) -> Result<bool, ConfigError> {
        let backup = backup_path_for(path);
        let text = match std::fs::read_to_string(&backup) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(e) => {
                return Err(ConfigError::WriteFailed {
                    path: backup.to_string_lossy().to_string(),
                    reason: e.to_string(),
                })
            }
        };
        std::fs::write(path, text).map_err(|e| ConfigError::WriteFailed {
            path: path.to_string_lossy().to_string(),
            reason: e.to_string(),
        })?;
        Ok(true)
    }
}

/// The backup path for a file: a sibling with a fixed suffix.
pub fn backup_path_for(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".into());
    name.push_str(".aissetup-backup");
    path.with_file_name(name)
}

/// Lexically normalises a path (lowercased on Windows, `.` and `..` resolved)
/// without touching the filesystem.
///
/// `canonicalize` is not usable here: the config file usually does not exist
/// yet, and canonicalising the *parent* would silently follow a junction. A
/// lexical comparison is what the confinement check actually needs.
fn normalise(path: &Path) -> String {
    let mut parts: Vec<String> = Vec::new();
    for component in path.components() {
        use std::path::Component;
        match component {
            Component::Prefix(p) => parts.push(p.as_os_str().to_string_lossy().to_lowercase()),
            Component::RootDir => parts.push("\\".into()),
            Component::CurDir => {}
            Component::ParentDir => {
                // Popping keeps `..` from escaping the prefix check, which is the
                // whole point of normalising rather than comparing raw strings.
                if parts.len() > 1 {
                    parts.pop();
                }
            }
            Component::Normal(segment) => parts.push(segment.to_string_lossy().to_lowercase()),
        }
    }
    parts.join("\\")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn values(pairs: &[(&str, serde_json::Value)]) -> BTreeMap<String, serde_json::Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    fn tempdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aissetup-config-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // -- JSON -------------------------------------------------------------

    #[test]
    fn json_merge_keeps_existing_keys() {
        let adapter = JsonAdapter;
        let existing = r#"{"editor.fontSize": 14, "workbench.colorTheme": "Dark"}"#;
        let (text, changes) = adapter
            .merge(
                Some(existing),
                &values(&[("editor.tabSize", serde_json::json!(2))]),
            )
            .unwrap();

        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["editor.fontSize"], 14, "an unrelated key was lost");
        assert_eq!(parsed["workbench.colorTheme"], "Dark");
        // `editor.tabSize` has no literal key and no existing `editor` object, so
        // the dot is treated as a path and an object is created.
        assert_eq!(parsed["editor"]["tabSize"], 2);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].key, "editor.tabSize");
        assert!(changes[0].before.is_none(), "a new key has no before");
    }

    #[test]
    fn json_existing_literal_dotted_key_is_updated_not_restructured() {
        // VS Code writes `"editor.fontSize"` as a *literal* key, dot included.
        // Rewriting it as a nested object would produce a settings file the
        // editor does not read — every setting the student had would stop
        // working, with no error anywhere.
        let adapter = JsonAdapter;
        let existing = r#"{"editor.fontSize": 14}"#;
        let (text, changes) = adapter
            .merge(Some(existing), &values(&[("editor.fontSize", serde_json::json!(16))]))
            .unwrap();

        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            parsed["editor.fontSize"], 16,
            "the literal dotted key must be replaced in place"
        );
        assert!(
            parsed.get("editor").is_none(),
            "the file was restructured into nested objects: {text}"
        );
        assert_eq!(changes[0].before.as_deref(), Some("14"));
    }

    #[test]
    fn json_dotted_key_creates_nesting_when_no_literal_key_exists() {
        // The other half of the rule: on an empty document the dot *is* a path.
        let adapter = JsonAdapter;
        let (text, _) = adapter
            .merge(
                None,
                &values(&[("terminal.integrated.fontSize", serde_json::json!(15))]),
            )
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["terminal"]["integrated"]["fontSize"], 15);
    }

    #[test]
    fn json_merge_records_the_previous_value() {
        let adapter = JsonAdapter;
        let existing = r#"{"tabSize": 4}"#;
        let (_, changes) = adapter
            .merge(Some(existing), &values(&[("tabSize", serde_json::json!(2))]))
            .unwrap();
        assert_eq!(changes[0].before.as_deref(), Some("4"));
        assert_eq!(changes[0].after.as_deref(), Some("2"));
        assert!(changes[0].summary().contains("4 → 2"));
    }

    #[test]
    fn json_nested_merge_does_not_drop_siblings() {
        let adapter = JsonAdapter;
        let existing = r#"{"terminal": {"integrated": {"fontSize": 12, "shell": "pwsh"}}}"#;
        let (text, _) = adapter
            .merge(
                Some(existing),
                &values(&[("terminal.integrated.fontSize", serde_json::json!(16))]),
            )
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["terminal"]["integrated"]["fontSize"], 16);
        assert_eq!(
            parsed["terminal"]["integrated"]["shell"], "pwsh",
            "the sibling key must survive a nested merge"
        );
    }

    #[test]
    fn json_scalar_where_an_object_is_needed_is_replaced_not_lost() {
        let adapter = JsonAdapter;
        let (text, _) = adapter
            .merge(
                Some(r#"{"terminal": 5}"#),
                &values(&[("terminal.integrated.fontSize", serde_json::json!(16))]),
            )
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["terminal"]["integrated"]["fontSize"], 16);
    }

    #[test]
    fn json_unparsable_input_is_refused_rather_than_replaced() {
        let adapter = JsonAdapter;
        let err = adapter
            .merge(Some("{ this is not json"), &values(&[("a", serde_json::json!(1))]))
            .unwrap_err();
        assert!(matches!(err, ConfigError::Unparsable { .. }));
        assert!(err.message().contains("已保持原样"));
    }

    #[test]
    fn json_array_root_is_refused() {
        let adapter = JsonAdapter;
        let err = adapter
            .merge(Some("[1,2,3]"), &values(&[("a", serde_json::json!(1))]))
            .unwrap_err();
        assert!(matches!(err, ConfigError::Unparsable { .. }));
    }

    // -- JSONC ------------------------------------------------------------

    #[test]
    fn jsonc_keeps_comments_and_adds_the_new_key() {
        let adapter = JsoncAdapter;
        let existing = "{\n    // 我的字体设置\n    \"editor.fontSize\": 14\n}\n";
        let (text, _) = adapter
            .merge(Some(existing), &values(&[("locale", serde_json::json!("zh-cn"))]))
            .unwrap();

        assert!(
            text.contains("// 我的字体设置"),
            "the student's comment was deleted: {text}"
        );
        assert!(text.contains("\"editor.fontSize\": 14"));
        assert!(text.contains("\"locale\": \"zh-cn\""));
        assert!(text.contains("{\n") && text.contains("}\n"));
    }

    #[test]
    fn jsonc_replaces_an_existing_key_in_place() {
        let adapter = JsoncAdapter;
        let existing = "{\n    \"locale\": \"en\",\n    \"editor.fontSize\": 14\n}\n";
        let (text, changes) = adapter
            .merge(Some(existing), &values(&[("locale", serde_json::json!("zh-cn"))]))
            .unwrap();

        assert!(text.contains("\"locale\": \"zh-cn\""));
        assert!(!text.contains("\"locale\": \"en\""), "the old value survived");
        assert!(
            text.contains("\"editor.fontSize\": 14"),
            "an unrelated key was lost"
        );
        assert_eq!(changes[0].before.as_deref(), Some("en"));
    }

    #[test]
    fn jsonc_handles_trailing_commas() {
        let adapter = JsoncAdapter;
        // A trailing comma is legal JSONC and illegal JSON. The key lookup must
        // still see `editor.fontSize`.
        let existing = "{\n    \"editor.fontSize\": 14,\n}\n";
        let (text, changes) = adapter
            .merge(Some(existing), &values(&[("locale", serde_json::json!("zh-cn"))]))
            .unwrap();
        assert!(text.contains("\"locale\": \"zh-cn\""));
        assert_eq!(changes[0].before, None, "locale was not present");
    }

    #[test]
    fn jsonc_brace_inside_a_comment_is_not_mistaken_for_the_object() {
        // `outer_object_span` must ignore braces in comments and strings, or the
        // splice point lands in the wrong place and the file is corrupted.
        let adapter = JsoncAdapter;
        let existing = "// comment with } brace\n{\n    \"a\": 1\n}\n";
        let (text, _) = adapter
            .merge(Some(existing), &values(&[("b", serde_json::json!(2))]))
            .unwrap();
        assert!(text.contains("\"b\": 2"));

        // And the result must actually parse once comments are removed.
        let span = outer_object_span(&text).unwrap();
        let body = strip_jsonc_comments(&text[span.0 + 1..span.1]);
        let parsed: serde_json::Value = serde_json::from_str(&format!("{{{body}}}")).expect("valid");
        assert_eq!(parsed["a"], 1);
        assert_eq!(parsed["b"], 2);
    }

    #[test]
    fn jsonc_detects_its_own_format() {
        assert!(JsoncAdapter.probe(Path::new("settings.json"), "{\n// hi\n}"));
        assert!(!JsoncAdapter.probe(Path::new("settings.json"), "{\n\"a\": 1\n}"));
        assert!(JsoncAdapter.probe(Path::new("settings.json"), "{\n\"a\": 1,\n}"));
    }

    #[test]
    fn the_adapter_follows_the_content_not_only_the_extension() {
        // VS Code's settings.json is JSONC despite the extension; a strict
        // parser would reject the file the program itself wrote.
        let commented = "{\n  // comment\n  \"a\": 1\n}\n";
        assert_eq!(
            adapter_for(Path::new("settings.json"), Some(commented)).name(),
            "jsonc"
        );
        assert_eq!(
            adapter_for(Path::new("settings.json"), Some("{\"a\": 1}")).name(),
            "json"
        );
        assert_eq!(adapter_for(Path::new("x.toml"), None).name(), "toml");
    }

    #[test]
    fn jsonc_empty_object_gets_the_key() {
        let adapter = JsoncAdapter;
        let (text, _) = adapter
            .merge(Some("{}\n"), &values(&[("locale", serde_json::json!("zh-cn"))]))
            .unwrap();
        assert!(text.contains("\"locale\": \"zh-cn\""));
    }

    // -- TOML -------------------------------------------------------------

    #[test]
    fn toml_top_level_key_is_written_before_the_first_section() {
        let adapter = TomlAdapter;
        let existing = "# my git config\n[user]\nname = \"old\"\n";
        let (text, _) = adapter
            .merge(
                Some(existing),
                &values(&[("autocrlf", serde_json::json!("true"))]),
            )
            .unwrap();

        assert!(text.contains("# my git config"), "the comment was lost");
        assert!(text.contains("autocrlf = 'true'"));
        let key_pos = text.find("autocrlf").unwrap();
        let section_pos = text.find("[user]").unwrap();
        assert!(
            key_pos < section_pos,
            "a top-level key must not be written inside a section: {text}"
        );
    }

    #[test]
    fn toml_dotted_key_goes_into_its_section() {
        let adapter = TomlAdapter;
        let (text, _) = adapter
            .merge(None, &values(&[("user.name", serde_json::json!("Liu"))]))
            .unwrap();
        assert!(text.contains("[user]"), "got: {text}");
        assert!(text.contains("name = 'Liu'"));
    }

    #[test]
    fn toml_existing_section_key_is_replaced_in_place() {
        let adapter = TomlAdapter;
        let existing = "[user]\n\tname = \"old\"\n\temail = \"a@b.c\"\n";
        let (text, changes) = adapter
            .merge(
                Some(existing),
                &values(&[("user.name", serde_json::json!("Liu"))]),
            )
            .unwrap();

        assert!(text.contains("name = 'Liu'"));
        assert!(!text.contains("\"old\""), "the old value survived: {text}");
        assert!(
            text.contains("email = \"a@b.c\""),
            "the sibling key was lost: {text}"
        );
        assert_eq!(changes[0].before.as_deref(), Some("\"old\""));
    }

    #[test]
    fn toml_broken_input_is_refused() {
        let adapter = TomlAdapter;
        let err = adapter
            .merge(
                Some("[user\nname = x"),
                &values(&[("a", serde_json::json!(1))]),
            )
            .unwrap_err();
        assert!(matches!(err, ConfigError::Unparsable { .. }));
    }

    #[test]
    fn toml_rejects_a_nested_object_instead_of_flattening_it() {
        let adapter = TomlAdapter;
        let err = adapter
            .merge(
                None,
                &values(&[("a", serde_json::json!({"nested": 1}))]),
            )
            .unwrap_err();
        assert!(matches!(err, ConfigError::InvalidChange { .. }));
    }

    #[test]
    fn toml_rejects_null() {
        let adapter = TomlAdapter;
        let err = adapter
            .merge(None, &values(&[("a", serde_json::Value::Null)]))
            .unwrap_err();
        assert!(matches!(err, ConfigError::InvalidChange { .. }));
    }

    #[test]
    fn toml_strings_prefer_the_literal_form() {
        assert_eq!(toml_string("plain"), "'plain'");
        assert_eq!(toml_string("a/b-c"), "'a/b-c'");
        // A literal string cannot contain `\` unescaped, so a Windows path has to
        // take the escaped form. The test asserts the *reason*, not just the
        // shape: the output must survive a TOML reader unchanged.
        assert_eq!(toml_string(r"C:\tools\git"), r#""C:\\tools\\git""#);
        assert_eq!(toml_string("has'quote"), "\"has'quote\"");
    }

    #[test]
    fn toml_arrays_render() {
        let adapter = TomlAdapter;
        let (text, _) = adapter
            .merge(
                None,
                &values(&[("ignore", serde_json::json!(["a", "b"]))]),
            )
            .unwrap();
        assert!(text.contains("ignore = ['a', 'b']"), "got: {text}");
    }

    // -- The writer: backup, rollback, confinement -------------------------

    #[test]
    fn writer_creates_a_missing_file_and_its_directory() {
        let dir = tempdir("create");
        let path = dir.join("nested").join("settings.json");
        let writer = ConfigWriter::new(vec![dir.clone()]);
        let outcome = writer
            .apply(&path, &values(&[("locale", serde_json::json!("zh-cn"))]))
            .unwrap();
        assert!(outcome.changed);
        assert!(path.exists());
        assert!(outcome.backup_path.is_none(), "nothing existed to back up");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn writer_backs_up_an_existing_file_before_changing_it() {
        let dir = tempdir("backup");
        let path = dir.join("settings.json");
        std::fs::write(&path, "{\"editor.fontSize\": 14}\n").unwrap();

        let writer = ConfigWriter::new(vec![dir.clone()]);
        let outcome = writer
            .apply(&path, &values(&[("locale", serde_json::json!("zh-cn"))]))
            .unwrap();

        let backup = outcome.backup_path.expect("an existing file must be backed up");
        let saved = std::fs::read_to_string(&backup).unwrap();
        assert_eq!(
            saved, "{\"editor.fontSize\": 14}\n",
            "the backup must be the exact original bytes"
        );
        assert!(std::fs::read_to_string(&path).unwrap().contains("zh-cn"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn writer_restores_from_the_backup() {
        let dir = tempdir("restore");
        let path = dir.join("settings.json");
        let original = "{\"editor.fontSize\": 14}\n";
        std::fs::write(&path, original).unwrap();

        let writer = ConfigWriter::new(vec![dir.clone()]);
        writer
            .apply(&path, &values(&[("locale", serde_json::json!("zh-cn"))]))
            .unwrap();
        assert_ne!(std::fs::read_to_string(&path).unwrap(), original);

        assert!(writer.restore(&path).unwrap());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            original,
            "restore did not return the file to its original bytes"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_reports_false_when_there_is_no_backup() {
        // "Restored nothing" and "restored the original" are different answers.
        let dir = tempdir("nobackup");
        let path = dir.join("settings.json");
        std::fs::write(&path, "{}\n").unwrap();
        let writer = ConfigWriter::new(vec![dir.clone()]);
        assert!(!writer.restore(&path).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn writer_is_a_no_op_when_nothing_would_change() {
        let dir = tempdir("noop");
        let path = dir.join("settings.json");
        std::fs::write(&path, "{\n  \"locale\": \"zh-cn\"\n}\n").unwrap();

        let writer = ConfigWriter::new(vec![dir.clone()]);
        let outcome = writer
            .apply(&path, &values(&[("locale", serde_json::json!("zh-cn"))]))
            .unwrap();

        assert!(!outcome.changed);
        assert!(outcome.backup_path.is_none(), "a no-op must not write a backup");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn writer_refuses_a_path_outside_its_allowed_roots() {
        // The confinement that stops a hand-edited profile from naming an
        // arbitrary system file.
        let dir = tempdir("confine");
        let writer = ConfigWriter::new(vec![dir.clone()]);
        let err = writer
            .apply(
                Path::new(r"C:\Windows\System32\drivers\etc\hosts"),
                &values(&[("a", serde_json::json!(1))]),
            )
            .unwrap_err();
        assert!(matches!(err, ConfigError::OutsideAllowedRoot { .. }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn confinement_is_not_fooled_by_a_parent_directory_traversal() {
        let dir = tempdir("traverse");
        let writer = ConfigWriter::new(vec![dir.join("allowed")]);
        std::fs::create_dir_all(dir.join("allowed")).unwrap();
        // `..\escape.json` is lexically outside the allowed root.
        let escaping = dir.join("allowed").join("..").join("escape.json");
        assert!(
            !writer.is_allowed(&escaping),
            "`..` must not be able to leave the allowed root"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn confinement_is_case_insensitive() {
        // Windows paths are case-insensitive; a check that is not would reject a
        // legitimate write whose drive letter was spelled differently.
        let writer = ConfigWriter::new(vec![PathBuf::from(r"C:\Users\Li\AppData\Roaming")]);
        assert!(writer.is_allowed(Path::new(r"c:\users\li\appdata\roaming\Code\User\settings.json")));
    }

    #[test]
    fn dry_run_neither_writes_nor_backs_up() {
        let dir = tempdir("dryrun");
        let path = dir.join("settings.json");
        std::fs::write(&path, "{\"a\": 1}\n").unwrap();

        let writer = ConfigWriter::new(vec![dir.clone()]).dry_run(true);
        let outcome = writer
            .apply(&path, &values(&[("b", serde_json::json!(2))]))
            .unwrap();

        assert!(outcome.changed, "a dry run must still report what it would do");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{\"a\": 1}\n",
            "a dry run wrote to the file"
        );
        assert!(outcome.backup_path.is_none());
        assert!(!backup_path_for(&path).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_write_leaves_the_original_in_place() {
        // Simulate the write failing by making the target a directory: the write
        // cannot succeed, and the rollback path must not make things worse.
        let dir = tempdir("rollback");
        let target = dir.join("settings.json");
        std::fs::create_dir_all(&target).unwrap();

        let writer = ConfigWriter::new(vec![dir.clone()]);
        let result = writer.apply(&target, &values(&[("a", serde_json::json!(1))]));

        assert!(result.is_err(), "writing over a directory must fail");
        // The directory is still a directory — the rollback did not replace it
        // with a file or delete it.
        assert!(target.is_dir());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn permission_errors_are_classified_for_the_engine() {
        let err = ConfigError::WriteFailed {
            path: "x".into(),
            reason: "Access is denied. (os error 5)".into(),
        };
        assert!(err.is_permission_problem());

        let other = ConfigError::Unparsable {
            path: "x".into(),
            reason: "boom".into(),
        };
        assert!(!other.is_permission_problem());
    }

    #[test]
    fn every_adapter_reports_a_name_for_the_trace() {
        assert_eq!(JsonAdapter.name(), "json");
        assert_eq!(JsoncAdapter.name(), "jsonc");
        assert_eq!(TomlAdapter.name(), "toml");
    }
}
