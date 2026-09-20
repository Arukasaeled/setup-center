//! MCP bootstrap — configuration management, not protocol implementation.
//!
//! The brief is explicit: "不要重新设计 MCP" / "遵循官方 Model Context Protocol".
//! So this module knows exactly three things:
//!
//! 1. the **`mcpServers` JSON shape** that every MCP client already reads
//!    (`{"mcpServers": {"<name>": {"command": ..., "args": [...], "env": {...}}}}`);
//! 2. where a given agent looks for that file;
//! 3. how to merge without destroying what is there.
//!
//! What it does not know: the transport, the handshake, tool listing, resources,
//! prompts, or anything else the protocol defines. None of that is needed to
//! *configure* a server, and implementing it would be both a duplicate of the
//! SDKs and a compatibility liability.
//!
//! V1 scope, per the brief: **npm-package servers only.** That restriction is
//! enforced by [`McpServerKind`] rather than by a comment — a profile asking for
//! an SSE or HTTP server is rejected at plan time with a clear reason, instead of
//! being written into a config file that the client may or may not understand.
//!
//! Three prohibitions from the brief, and how each is structural:
//!
//! * **No auto-login** — this module has no concept of authentication, and the
//!   only thing it can write is `command`/`args`/`env` from the profile.
//! * **No API keys** — [`McpServer::env`] is rejected at validation if a key name
//!   looks like a secret. A profile is a file students share and commit; a token
//!   in one is a leaked token.
//! * **No uploading user data** — nothing here performs network I/O at all.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The only server shapes V1 will write.
///
/// Modelled as an enum rather than a free-form string so an unsupported entry is
/// a *parse* error, not a config file the client silently ignores.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpServerKind {
    /// `command: "npx"`, `args: ["-y", "<package>"]` — the shape the official
    /// reference servers ship in.
    NpmPackage { package: String, extra_args: Vec<String> },
}

impl McpServerKind {
    /// The `command`/`args` pair this kind resolves to.
    pub fn command_and_args(&self) -> (String, Vec<String>) {
        match self {
            McpServerKind::NpmPackage {
                package,
                extra_args,
            } => {
                let mut args = vec!["-y".to_string(), package.clone()];
                args.extend(extra_args.iter().cloned());
                ("npx".to_string(), args)
            }
        }
    }
}

/// One MCP server the profile asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServer {
    /// The key in `mcpServers`. Must be a valid identifier-ish token: it becomes
    /// a JSON key the client shows to the user, and a name with a space or a
    /// slash produces a config the client accepts but nobody can read.
    pub name: String,
    pub kind: McpServerKind,
    /// Environment variables. Validated to reject secrets.
    pub env: BTreeMap<String, String>,
}

/// Why a profile's MCP entry cannot be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpError {
    /// A name that is not a safe config key.
    InvalidName { name: String, reason: String },
    /// A package spec that is not an npm package.
    UnsupportedKind { spec: String, reason: String },
    /// An environment entry that looks like a secret.
    SecretInProfile { key: String },
    /// The existing config could not be read, so merging would risk data loss.
    ExistingConfigUnreadable { path: String, reason: String },
    /// The existing `mcpServers` value is not an object.
    ExistingShapeInvalid { path: String, found: String },
}

impl McpError {
    pub fn message(&self) -> String {
        match self {
            McpError::InvalidName { name, reason } => {
                format!("MCP 服务器名称 {name:?} 无效：{reason}")
            }
            McpError::UnsupportedKind { spec, reason } => {
                format!("暂不支持的 MCP 服务器 {spec:?}：{reason}")
            }
            McpError::SecretInProfile { key } => format!(
                "MCP 配置中不允许包含密钥（{key}）。请手动在客户端中配置，不要写入方案文件。"
            ),
            McpError::ExistingConfigUnreadable { path, reason } => {
                format!("{path} 无法读取（{reason}），为避免破坏已有配置，本次未做修改。")
            }
            McpError::ExistingShapeInvalid { path, found } => format!(
                "{path} 的 mcpServers 不是对象（实际是 {found}），为避免破坏已有配置，本次未做修改。"
            ),
        }
    }
}

/// Environment variable names that must never come from a profile.
///
/// Substring matching, and deliberately broad: a false positive costs the student
/// one manual step, a false negative writes a live credential into a file they
/// are likely to share.
const SECRET_MARKERS: &[&str] = &[
    "token",
    "secret",
    "password",
    "passwd",
    "api_key",
    "apikey",
    "api-key",
    "access_key",
    "private_key",
    "credential",
    "auth",
];

/// Parses one profile MCP entry.
///
/// The accepted spec forms, all of which name an npm package:
///
/// * `"@modelcontextprotocol/server-filesystem"`
/// * `"npx -y @modelcontextprotocol/server-filesystem /allowed/path"`
/// * `"npm:@modelcontextprotocol/server-filesystem"`
///
/// The `npx …` form is accepted because it is how the official documentation
/// writes these entries, so a student copying from the README must not be
/// rejected. The command word is then *stripped*, because we generate it: writing
/// a `command` field that the profile supplied would make the profile the source
/// of truth for how a process is launched.
pub fn parse_server(name: &str, spec: &str) -> Result<McpServer, McpError> {
    validate_name(name)?;

    let spec = spec.trim();
    if spec.is_empty() {
        return Err(McpError::UnsupportedKind {
            spec: spec.to_string(),
            reason: "内容为空".into(),
        });
    }

    if spec.contains("://") {
        return Err(McpError::UnsupportedKind {
            spec: spec.to_string(),
            reason: "第一版只支持 npm 包类型（stdio）；远程 URL 类型尚未支持".into(),
        });
    }

    let mut tokens: Vec<String> = spec.split_whitespace().map(str::to_string).collect();

    // Strip a leading `npx`, `npm exec`, or a `npm:` prefix.
    if tokens.first().map(String::as_str) == Some("npx") {
        tokens.remove(0);
    } else if tokens.first().map(String::as_str) == Some("npm")
        && tokens.get(1).map(String::as_str) == Some("exec")
    {
        tokens.drain(0..2);
    }

    // Drop the `-y` / `--yes` flag: we always pass it ourselves.
    tokens.retain(|t| t != "-y" && t != "--yes");

    let Some(first) = tokens.first().cloned() else {
        return Err(McpError::UnsupportedKind {
            spec: spec.to_string(),
            reason: "没有指明 npm 包名".into(),
        });
    };

    let package = first
        .strip_prefix("npm:")
        .map(str::to_string)
        .unwrap_or(first);

    if !looks_like_npm_package(&package) {
        return Err(McpError::UnsupportedKind {
            spec: spec.to_string(),
            reason: format!("{package:?} 不像一个 npm 包名"),
        });
    }

    Ok(McpServer {
        name: name.to_string(),
        kind: McpServerKind::NpmPackage {
            package,
            extra_args: tokens.into_iter().skip(1).collect(),
        },
        env: BTreeMap::new(),
    })
}

/// A name is valid when it is a safe `mcpServers` key.
fn validate_name(name: &str) -> Result<(), McpError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(McpError::InvalidName {
            name: name.to_string(),
            reason: "名称为空".into(),
        });
    }
    if trimmed.len() > 64 {
        return Err(McpError::InvalidName {
            name: name.to_string(),
            reason: "名称过长".into(),
        });
    }
    let ok = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if !ok {
        return Err(McpError::InvalidName {
            name: name.to_string(),
            reason: "只允许字母、数字、`-`、`_`、`.`".into(),
        });
    }
    Ok(())
}

/// Whether a token is shaped like an npm package name.
///
/// **Only the scoped form (`@scope/name`) is accepted.** This is stricter than
/// npm itself, and deliberately so. Every official MCP server is published under
/// `@modelcontextprotocol/`; but the failure modes of the two forms are not
/// symmetric:
///
/// * rejecting an unscoped package costs the student one clear error message
///   naming the spec they wrote;
/// * accepting one means a profile typo (`server-filesystem`, missing its scope)
///   is written into their config, and the failure surfaces later as an opaque
///   `npx` exit code with no indication of which entry caused it.
///
/// The brief's "可失败" requirement prefers the first: fail where the cause is
/// still visible.
fn looks_like_npm_package(token: &str) -> bool {
    let Some(rest) = token.strip_prefix('@') else {
        return false;
    };
    let mut parts = rest.split('/');
    let scope = parts.next().unwrap_or("");
    let name = parts.next().unwrap_or("");
    !scope.is_empty()
        && !name.is_empty()
        && parts.next().is_none()
        && scope
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Rejects an environment map that carries a credential.
pub fn validate_env(env: &BTreeMap<String, String>) -> Result<(), McpError> {
    for key in env.keys() {
        let lowered = key.to_ascii_lowercase();
        if SECRET_MARKERS.iter().any(|marker| lowered.contains(marker)) {
            return Err(McpError::SecretInProfile { key: key.clone() });
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The config shape
// ---------------------------------------------------------------------------

/// The `mcpServers` entry for one server, as JSON.
///
/// This mirrors the documented shape verbatim. We do not add a `"type"`,
/// `"version"` or `"source"` field of our own: extra keys are how a config format
/// gets forked, and the point of this module is to stay compatible with clients
/// we did not write.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpServerConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
}

/// Builds the JSON value to merge into a client's config file.
///
/// Returns the whole `{"mcpServers": {…}}` object so the caller merges one key at
/// the top level, which keeps the merge shallow and the diff readable — and means
/// an existing `mcpServers` map is extended rather than replaced.
pub fn config_value(servers: &[McpServer]) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for server in servers {
        let (command, args) = server.kind.command_and_args();
        let entry = McpServerConfig {
            command,
            args,
            env: server.env.clone(),
        };
        map.insert(
            server.name.clone(),
            serde_json::to_value(entry).unwrap_or(serde_json::Value::Null),
        );
    }
    serde_json::json!({ "mcpServers": map })
}

/// Reads the server names already present in an existing config.
///
/// Used to decide whether a write is needed at all, and to report "already
/// configured" rather than rewriting the file on every run.
pub fn existing_server_names(text: &str) -> Result<Vec<String>, McpError> {
    let root: serde_json::Value =
        serde_json::from_str(text).map_err(|e| McpError::ExistingConfigUnreadable {
            path: "<existing>".into(),
            reason: e.to_string(),
        })?;

    match root.get("mcpServers") {
        None => Ok(Vec::new()),
        Some(serde_json::Value::Object(map)) => Ok(map.keys().cloned().collect()),
        Some(other) => Err(McpError::ExistingShapeInvalid {
            path: "<existing>".into(),
            found: kind_name(other).to_string(),
        }),
    }
}

fn kind_name(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "布尔值",
        serde_json::Value::Number(_) => "数字",
        serde_json::Value::String(_) => "字符串",
        serde_json::Value::Array(_) => "数组",
        serde_json::Value::Object(_) => "对象",
    }
}

/// `npx` availability, needed because an npm-type server cannot run without it.
///
/// Reported, never required at plan time: Node may be installed in the same run
/// that installs this, and refusing to plan the MCP step in that case would make
/// the ordering of the run matter in a way the student cannot see.
pub fn npx_available() -> bool {
    super::super::detect::run_capture("npx", &["--version"]).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(spec: &str) -> McpServer {
        parse_server("filesystem", spec).unwrap()
    }

    /// A server whose *package* is named, so a test can assert on the package
    /// rather than on the helper's fixed name.
    fn named_server(name: &str, package: &str) -> McpServer {
        parse_server(name, package).unwrap()
    }

    #[test]
    fn parses_a_bare_scoped_package() {
        let s = server("@modelcontextprotocol/server-filesystem");
        assert_eq!(
            s.kind,
            McpServerKind::NpmPackage {
                package: "@modelcontextprotocol/server-filesystem".into(),
                extra_args: vec![]
            }
        );
    }

    #[test]
    fn parses_the_documented_npx_form() {
        // This is how the official README writes the entry; a student copying it
        // must not be rejected.
        let s = server("npx -y @modelcontextprotocol/server-filesystem /tmp");
        match s.kind {
            McpServerKind::NpmPackage {
                package,
                extra_args,
            } => {
                assert_eq!(package, "@modelcontextprotocol/server-filesystem");
                assert_eq!(extra_args, vec!["/tmp".to_string()]);
            }
        }
    }

    #[test]
    fn parses_the_npm_exec_and_npm_prefix_forms() {
        assert_eq!(
            server("npm exec @modelcontextprotocol/server-git").kind,
            McpServerKind::NpmPackage {
                package: "@modelcontextprotocol/server-git".into(),
                extra_args: vec![]
            }
        );
        assert_eq!(
            server("npm:@modelcontextprotocol/server-memory").kind,
            McpServerKind::NpmPackage {
                package: "@modelcontextprotocol/server-memory".into(),
                extra_args: vec![]
            }
        );
    }

    #[test]
    fn the_generated_command_is_always_npx() {
        // The profile supplies a *package*, never a command. Writing a
        // profile-supplied command would make the profile the source of truth
        // for how a process is launched.
        let (command, args) = server("npx -y @modelcontextprotocol/server-filesystem").kind.command_and_args();
        assert_eq!(command, "npx");
        assert_eq!(args, vec!["-y", "@modelcontextprotocol/server-filesystem"]);
    }

    #[test]
    fn a_remote_url_is_rejected_with_a_reason() {
        // V1 supports npm only. Silently writing an unsupported entry would
        // produce a config the client may not understand.
        let err = parse_server("remote", "https://example.com/mcp").unwrap_err();
        assert!(matches!(err, McpError::UnsupportedKind { .. }));
        assert!(err.message().contains("npm"), "got: {}", err.message());
    }

    #[test]
    fn an_unscoped_package_is_rejected_with_a_clear_reason() {
        // `server-filesystem` alone is missing its scope and is a package that
        // does not exist. Accepting it would surface later as an opaque npx exit
        // code with no indication of which entry caused it.
        let err = parse_server("fs", "server-filesystem").unwrap_err();
        assert!(matches!(err, McpError::UnsupportedKind { .. }));
        assert!(err.message().contains("npm 包名"), "got: {}", err.message());
    }

    #[test]
    fn a_bad_name_is_rejected() {
        assert!(matches!(
            parse_server("", "@a/b"),
            Err(McpError::InvalidName { .. })
        ));
        assert!(matches!(
            parse_server("has space", "@a/b"),
            Err(McpError::InvalidName { .. })
        ));
        assert!(matches!(
            parse_server("slash/name", "@a/b"),
            Err(McpError::InvalidName { .. })
        ));
        assert!(parse_server("filesystem-1", "@a/b").is_ok());
        assert!(parse_server("fs_1.v2", "@a/b").is_ok());
    }

    #[test]
    fn a_secret_in_env_is_refused() {
        // A profile is a file students share and commit.
        let mut env = BTreeMap::new();
        env.insert("GITHUB_PERSONAL_ACCESS_TOKEN".to_string(), "x".into());
        let err = validate_env(&env).unwrap_err();
        assert!(matches!(err, McpError::SecretInProfile { .. }));
        assert!(err.message().contains("不允许包含密钥"));
    }

    #[test]
    fn common_secret_spellings_are_all_caught() {
        for key in [
            "API_KEY",
            "apikey",
            "OPENAI_API_KEY",
            "SECRET",
            "client_secret",
            "PASSWORD",
            "MY_TOKEN",
            "AWS_ACCESS_KEY_ID",
            "PRIVATE_KEY",
            "AUTHORIZATION",
        ] {
            let mut env = BTreeMap::new();
            env.insert(key.to_string(), "x".into());
            assert!(
                validate_env(&env).is_err(),
                "{key} was not recognised as a secret"
            );
        }
    }

    #[test]
    fn an_ordinary_env_var_is_allowed() {
        let mut env = BTreeMap::new();
        env.insert("LOG_LEVEL".to_string(), "debug".into());
        env.insert("ALLOWED_DIR".to_string(), r"C:\work".into());
        assert!(validate_env(&env).is_ok());
    }

    #[test]
    fn the_config_value_uses_the_documented_shape() {
        // `{"mcpServers": {"<name>": {"command": …, "args": […]}}}` — the shape
        // every MCP client already reads. No extra keys of our own.
        let value = config_value(&[named_server("filesystem", "@modelcontextprotocol/server-filesystem")]);
        let map = value.get("mcpServers").unwrap().as_object().unwrap();
        let entry = map.get("filesystem").unwrap().as_object().unwrap();

        assert_eq!(entry.get("command").unwrap(), "npx");
        assert_eq!(
            entry.get("args").unwrap(),
            &serde_json::json!(["-y", "@modelcontextprotocol/server-filesystem"])
        );
        // No invented fields. Asserted as a *set*: JSON objects are unordered,
        // so pinning the serialisation order would make this test fail on a
        // harmless change to the struct's field order.
        let mut keys: Vec<&String> = entry.keys().collect();
        keys.sort();
        assert_eq!(
            keys,
            vec!["args", "command"],
            "extra keys forked the format: {keys:?}"
        );
    }

    #[test]
    fn the_config_value_carries_extra_args_through() {
        let value = config_value(&[parse_server(
            "filesystem",
            "npx -y @modelcontextprotocol/server-filesystem D:\\work",
        )
        .unwrap()]);
        let args = value["mcpServers"]["filesystem"]["args"].clone();
        assert_eq!(
            args,
            serde_json::json!([
                "-y",
                "@modelcontextprotocol/server-filesystem",
                "D:\\work"
            ])
        );
    }

    #[test]
    fn an_empty_server_list_still_produces_the_container() {
        // So a merge over a file that has no `mcpServers` key creates one rather
        // than doing nothing.
        let value = config_value(&[]);
        assert_eq!(value, serde_json::json!({"mcpServers": {}}));
    }

    #[test]
    fn reading_an_existing_config_lists_the_servers() {
        let text = r#"{"mcpServers":{"filesystem":{"command":"npx","args":[]},"git":{"command":"npx","args":[]}}}"#;
        let names = existing_server_names(text).unwrap();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"filesystem".to_string()));
        assert!(names.contains(&"git".to_string()));
    }

    #[test]
    fn a_config_without_the_key_yields_no_servers() {
        assert_eq!(existing_server_names("{}").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn an_invalid_existing_config_is_reported_not_overwritten() {
        // The rule from `config.rs`: a file we cannot read is a file we must not
        // rewrite.
        let err = existing_server_names("{ not json").unwrap_err();
        assert!(matches!(err, McpError::ExistingConfigUnreadable { .. }));
        assert!(err.message().contains("未做修改"));
    }

    #[test]
    fn an_mcp_servers_that_is_not_an_object_is_reported() {
        let err = existing_server_names(r#"{"mcpServers":["a"]}"#).unwrap_err();
        assert!(matches!(err, McpError::ExistingShapeInvalid { .. }));
        assert!(err.message().contains("数组"));
    }

    #[test]
    fn the_round_trip_survives_json_serialisation() {
        let value = config_value(&[named_server("memory", "@modelcontextprotocol/server-memory")]);
        let text = serde_json::to_string_pretty(&value).unwrap();
        let names = existing_server_names(&text).unwrap();
        assert_eq!(names, vec!["memory".to_string()]);
    }
}
