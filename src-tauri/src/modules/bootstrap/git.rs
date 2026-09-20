//! Git bootstrap.
//!
//! Scope, per the brief: check whether Git is present, check whether an identity
//! is configured, and **do not invent one**.
//!
//! The "do not invent" rule is the whole design of this module, and it is worth
//! stating why it is not just politeness. `git config --global user.email` is
//! baked into every commit the student makes from now on. A placeholder such as
//! `student@example.com` is not a harmless default: it silently attributes work
//! to a wrong identity, it makes the student's first push fail against GitHub's
//! email verification, and — because Git treats a configured value as *set* — a
//! later tool cannot tell "the student chose this" from "an installer made it
//! up". So this module reports and never writes an identity. The action it plans
//! is a *setting* change (`core.autocrlf`, `init.defaultBranch`), which is
//! reversible and not identity-bearing.
//!
//! Detection reuses the same evidence discipline as the inventory: a failure to
//! read the config is reported as *unknown*, never as "not configured".

use std::collections::BTreeMap;

/// A git identity as configured, or the reason we cannot say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityState {
    /// Both values are set. `name`/`email` are the real configured strings.
    Configured { name: String, email: String },
    /// At least one of the two is unset.
    ///
    /// The partial case is modelled explicitly because it is common and
    /// confusing: `git commit` fails with "Please tell me who you are" even
    /// though the student *did* set `user.name`. Telling them exactly which half
    /// is missing is the difference between a one-line fix and a hunt.
    Missing { name: Option<String>, email: Option<String> },
    /// `git config` could not be read. Never reported as "not configured".
    Unknown { reason: String },
}

impl IdentityState {
    pub fn is_configured(&self) -> bool {
        matches!(self, IdentityState::Configured { .. })
    }

    /// What the student must be told, in one sentence.
    ///
    /// Returns `None` when nothing is wrong — the UI shows this verbatim, so a
    /// configured identity must not produce a nudge.
    pub fn user_message(&self) -> Option<String> {
        match self {
            IdentityState::Configured { .. } => None,
            IdentityState::Missing { name, email } => {
                let mut missing = Vec::new();
                if name.is_none() {
                    missing.push("user.name");
                }
                if email.is_none() {
                    missing.push("user.email");
                }
                Some(format!(
                    "需要用户配置 GitHub 信息：缺少 {}。请在终端执行：\n  \
                     git config --global user.name \"你的名字\"\n  \
                     git config --global user.email \"你的邮箱\"",
                    missing.join("、")
                ))
            }
            IdentityState::Unknown { reason } => Some(format!(
                "无法读取 Git 配置（{reason}），因此不能确认是否已配置用户信息。\
                 请手动执行 git config --global --list 确认。"
            )),
        }
    }
}

/// Parses `git config --global --list` output.
///
/// Tolerates both `key=value` (the default) and `key value` forms, because
/// `--list` vs `--list --null` and different Git versions differ. Keys are
/// lowercased: Git config keys are case-insensitive, and `User.Name` is valid.
pub fn parse_global_config(raw: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            map.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        } else if let Some((key, value)) = line.split_once(' ') {
            map.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    map
}

/// Reads the identity out of a parsed global config.
pub fn identity_from(config: &BTreeMap<String, String>) -> IdentityState {
    let name = config.get("user.name").filter(|v| !v.trim().is_empty()).cloned();
    let email = config.get("user.email").filter(|v| !v.trim().is_empty()).cloned();

    match (name, email) {
        (Some(name), Some(email)) => IdentityState::Configured { name, email },
        (name, email) => IdentityState::Missing { name, email },
    }
}

/// Reads the machine's current Git identity.
///
/// The probe the capability layer needs: `git-collaboration` requires a
/// configured identity, and without this the requirement could only ever report
/// "无法确认". Returns `Unknown` rather than `Missing` when `git` cannot be run —
/// the distinction the whole module is built around.
///
/// Read-only. Nothing here writes a config value; that rule and its reasoning are
/// at the top of this file.
pub fn probe_identity() -> IdentityState {
    match crate::modules::detect::run_capture("git", &["config", "--global", "--list"]) {
        Ok(text) => identity_from(&parse_global_config(&text)),
        Err(e) => IdentityState::Unknown {
            reason: e.to_string(),
        },
    }
}

/// The identity as a three-valued answer for the capability layer.
///
/// `None` means "we could not determine it", which the resolver renders as
/// unknown. Collapsing that into `Some(false)` would tell a student their
/// identity is unset when we simply failed to look, and they would go and set it
/// again.
pub fn identity_configured() -> Option<bool> {
    match probe_identity() {
        IdentityState::Configured { .. } => Some(true),
        IdentityState::Missing { .. } => Some(false),
        IdentityState::Unknown { .. } => None,
    }
}

/// The git settings this tool is willing to write.
///
/// Every one is a *behaviour* setting, not an identity and not a credential.
/// `core.autocrlf=true` is the Windows default students trip over first
/// (`warning: LF will be replaced by CRLF` on every add); `init.defaultBranch=main`
/// avoids the `master` main-...  naming mismatch that makes a first push to a
/// modern host fail; `core.quotepath=false` makes `git status` show Chinese file
/// names as characters instead of `\344\275\240` escapes, which is the single
/// most visible papercut for a Chinese-language student.
///
/// This is the *only* place in the module that names a setting, and the values
/// are data the plan carries — the engine does not branch on them.
pub fn baseline_settings() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        (
            "core.autocrlf",
            "true",
            "统一 Windows 换行符处理，避免每次提交都提示 LF/CRLF 转换",
        ),
        (
            "init.defaultBranch",
            "main",
            "新建仓库默认使用 main 分支，与 GitHub 一致",
        ),
        (
            "core.quotepath",
            "false",
            "让 git status 正确显示中文文件名，而不是 \\344\\275\\240 转义",
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fully_configured_identity_reports_nothing_to_do() {
        let config = parse_global_config("user.name=Li Ming\nuser.email=li@university.edu.cn\n");
        let state = identity_from(&config);
        assert_eq!(
            state,
            IdentityState::Configured {
                name: "Li Ming".into(),
                email: "li@university.edu.cn".into()
            }
        );
        assert!(
            state.user_message().is_none(),
            "a configured identity must not produce a prompt"
        );
    }

    #[test]
    fn a_missing_identity_names_exactly_which_half_is_missing() {
        // The partial case: `git commit` fails with "Please tell me who you are"
        // even though the student did set one of the two.
        let config = parse_global_config("user.name=Li Ming\n");
        let state = identity_from(&config);
        assert!(matches!(state, IdentityState::Missing { name: Some(_), email: None }));

        let message = state.user_message().unwrap();
        assert!(message.contains("user.email"), "got: {message}");
        assert!(
            !message.contains("缺少 user.name"),
            "the half that *is* set must not be reported as missing: {message}"
        );
    }

    #[test]
    fn an_empty_identity_reports_both_halves() {
        let state = identity_from(&parse_global_config("core.autocrlf=true\n"));
        let message = state.user_message().unwrap();
        assert!(message.contains("user.name"));
        assert!(message.contains("user.email"));
        assert!(message.contains("git config --global user.name"));
    }

    #[test]
    fn an_empty_string_value_counts_as_unset() {
        // `git config --global user.email ""` is a real way to end up with a
        // broken identity, and reporting it as "configured" would hide the
        // problem rather than fix it.
        let config = parse_global_config("user.name=Li Ming\nuser.email=\n");
        let state = identity_from(&config);
        assert!(matches!(state, IdentityState::Missing { email: None, .. }));
    }

    #[test]
    fn unreadable_config_is_unknown_not_missing() {
        // The one outcome that must never become "not configured": it would send
        // the student to re-enter an identity they already have.
        let state = IdentityState::Unknown {
            reason: "git 不可用".into(),
        };
        let message = state.user_message().unwrap();
        assert!(message.contains("无法读取"));
        assert!(!message.contains("缺少"));
        assert!(!state.is_configured());
    }

    #[test]
    fn parsing_tolerates_both_separators_and_odd_casing() {
        let config = parse_global_config(
            "User.Name=Li Ming\nuser.email li@x.cn\n# a comment\n\ncore.autocrlf=true\n",
        );
        assert_eq!(config.get("user.name").map(String::as_str), Some("Li Ming"));
        assert_eq!(config.get("user.email").map(String::as_str), Some("li@x.cn"));
        assert_eq!(config.get("core.autocrlf").map(String::as_str), Some("true"));
        assert_eq!(config.len(), 3);
    }

    #[test]
    fn parsing_keeps_values_containing_equals_signs() {
        // A GPG signing key or a URL-shaped value can contain `=`; splitting on
        // the *first* one is what keeps the value intact.
        let config = parse_global_config("user.signingkey=ABC=DEF\n");
        assert_eq!(
            config.get("user.signingkey").map(String::as_str),
            Some("ABC=DEF")
        );
    }

    #[test]
    fn the_baseline_never_sets_an_identity() {
        // The structural guarantee behind "不要自动填写虚假身份": if someone adds
        // an identity to the baseline, this fails.
        for (key, _, _) in baseline_settings() {
            assert!(
                !key.starts_with("user."),
                "the baseline must never write an identity-bearing key: {key}"
            );
            assert!(!key.contains("password"));
            assert!(!key.contains("token"));
        }
    }

    #[test]
    fn the_baseline_has_a_reason_for_every_setting() {
        let settings = baseline_settings();
        assert!(!settings.is_empty());
        for (key, value, rationale) in settings {
            assert!(!key.is_empty());
            assert!(!value.is_empty());
            assert!(
                rationale.len() > 8,
                "{key} has no explanation a student could act on"
            );
        }
    }
}
