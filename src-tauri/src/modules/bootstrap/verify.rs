//! Bootstrap verification — reading the machine instead of believing the run.
//!
//! The brief's "第八部分：Verify升级" and stage 3's rule both say the same thing:
//! an action reporting success is not evidence that the machine changed. This
//! module is where that is enforced for configuration.
//!
//! It is a separate module from [`super::run`] for the reason stage 3 keeps
//! `verify.rs` separate from `install.rs`: verification must be *able* to
//! disagree with the run, and code that lives inside the runner tends to
//! gradually start reading the runner's own bookkeeping instead of the machine.
//! Everything here takes freshly-read evidence as an argument; none of it can
//! see a [`BootstrapSession`](super::run::BootstrapSession).
//!
//! ## The `Unknown` case, again
//!
//! The most likely way this module could hurt a student is by turning "we could
//! not read the file" into "the setting is missing", which sends them to redo
//! work that may already be done. Every check therefore has three outcomes, not
//! two, and the unreadable case maps to [`Confidence::Unknown`].

use crate::model::*;

use super::extension;
use super::localization::LocaleVerification;
use super::plan::{BootstrapAction, BootstrapPlan, BootstrapStep};

use std::collections::BTreeMap;

/// The post-run check, read from the machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapVerification {
    pub checks: Vec<BootstrapCheck>,
    pub passed: u32,
    pub failed: u32,
    /// How many checks could not be answered either way.
    ///
    /// Reported separately rather than folded into `passed` or `failed`: it is
    /// the number the UI uses to say "3 项无法确认".
    pub unknown: u32,
    /// True only when there was at least one check and none failed.
    pub overall_ok: bool,
}

/// One capability verified after the run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapCheck {
    pub key: String,
    pub label: String,
    pub confidence: Confidence,
    pub expected: String,
    pub observed: String,
    pub hint: Option<String>,
}

/// The evidence a verification reads.
///
/// **Owned, not borrowed.** An earlier version took references, which forced the
/// caller to keep the buffers alive across an async command boundary — there is no
/// way to do that without leaking them. The evidence is small (a list of extension
/// ids, a config map, a path-existence map), so owning it is cheap and removes the
/// lifetime from every call site.
pub struct VerifyEvidence {
    /// The `code --list-extensions` result, freshly read.
    pub installed_extensions: Vec<(String, Option<String>)>,
    /// Git's global config, freshly read.
    pub git_config: BTreeMap<String, String>,
    /// Paths that must exist after the run, keyed as the checks expect:
    /// `file:<name>` for a settings file, `skill:<name>` for a skill.
    pub existing_paths: BTreeMap<String, bool>,
    /// The locale check, when a localisation was planned.
    pub locale: Option<LocaleVerification>,
}

impl Default for VerifyEvidence {
    fn default() -> Self {
        Self {
            installed_extensions: Vec::new(),
            git_config: BTreeMap::new(),
            existing_paths: BTreeMap::new(),
            locale: None,
        }
    }
}

impl VerifyEvidence {
    /// The key a settings file's existence is recorded under.
    pub fn file_key(path: &std::path::Path) -> String {
        format!(
            "file:{}",
            path.file_name().unwrap_or_default().to_string_lossy()
        )
    }

    /// The key a skill's existence is recorded under.
    pub fn skill_key(name: &str) -> String {
        format!("skill:{name}")
    }
}

/// Verifies the plan against the machine's current state.
///
/// Steps that were blocked or already satisfied produce no check: reporting a
/// blocked step as a verification failure would double-count it, and re-verifying
/// something that was already true proves nothing about this run.
pub fn verify(plan: &BootstrapPlan, evidence: &VerifyEvidence) -> BootstrapVerification {
    let mut checks = Vec::new();

    for step in &plan.steps {
        if step.blocked.is_some() || !step.needed {
            continue;
        }
        if let Some(check) = verify_step(step, evidence) {
            checks.push(check);
        }
    }

    let passed = checks.iter().filter(|c| c.confidence.is_ok()).count() as u32;
    let failed = checks
        .iter()
        .filter(|c| c.confidence == Confidence::Fail)
        .count() as u32;
    let unknown = checks
        .iter()
        .filter(|c| c.confidence == Confidence::Unknown)
        .count() as u32;

    BootstrapVerification {
        overall_ok: !checks.is_empty() && failed == 0,
        passed,
        failed,
        unknown,
        checks,
    }
}

fn verify_step(step: &BootstrapStep, evidence: &VerifyEvidence) -> Option<BootstrapCheck> {
    match &step.action {
        BootstrapAction::Extension { id, .. } => verify_extension(id, evidence),

        BootstrapAction::ConfigCommand { key, value, .. } => {
            // The identity check is a *report*, not a setting: there is nothing
            // to verify against a value we deliberately never wrote. Inventing a
            // check here would report a failure for correct behaviour.
            if key == "user.identity.check" {
                return None;
            }

            let observed = evidence.git_config.get(key).cloned();
            let ok = observed.as_deref() == Some(value.as_str());

            Some(BootstrapCheck {
                key: format!("git.{key}"),
                label: format!("Git 设置 {key}"),
                confidence: if ok { Confidence::Ok } else { Confidence::Fail },
                expected: value.clone(),
                observed: observed.unwrap_or_else(|| "未设置".into()),
                hint: if ok {
                    None
                } else {
                    Some(format!("手动执行：git config --global {key} \"{value}\""))
                },
            })
        }

        BootstrapAction::FileWrite { path, values, .. } => {
            let key = VerifyEvidence::file_key(path);
            let exists = evidence.existing_paths.get(&key).copied();

            let (confidence, observed) = match exists {
                Some(true) => (Confidence::Ok, "文件存在".to_string()),
                Some(false) => (Confidence::Fail, "文件不存在".to_string()),
                // Not probed: report as unknown rather than guessing.
                None => (
                    Confidence::Unknown,
                    "未能确认文件状态".to_string(),
                ),
            };

            Some(BootstrapCheck {
                key: format!("file.{}", path.display()),
                label: format!(
                    "配置文件 {}",
                    path.file_name().unwrap_or_default().to_string_lossy()
                ),
                confidence,
                expected: format!("{} 项设置已写入", values.len()),
                observed,
                hint: if confidence.is_ok() {
                    None
                } else {
                    Some(format!(
                        "检查 {} 是否可写，或以管理员身份重试。",
                        path.display()
                    ))
                },
            })
        }

        BootstrapAction::SkillInstall {
            name, target_root, ..
        } => {
            let key = VerifyEvidence::skill_key(name);
            let exists = evidence.existing_paths.get(&key).copied();

            let (confidence, observed) = match exists {
                Some(true) => (Confidence::Ok, format!("存在于 {}", target_root.display())),
                Some(false) => (Confidence::Fail, "未找到".to_string()),
                None => (Confidence::Unknown, "未能确认技能目录状态".to_string()),
            };

            Some(BootstrapCheck {
                key: format!("skill.{name}"),
                label: format!("技能 {name}"),
                confidence,
                expected: "已安装".into(),
                observed,
                hint: if confidence.is_ok() {
                    None
                } else {
                    Some("技能目录未创建成功，请检查目标目录是否可写。".into())
                },
            })
        }

        BootstrapAction::Localization { id, .. } => {
            let locale = evidence.locale.as_ref()?;
            let (confidence, observed) = match locale {
                LocaleVerification::Applied => (Confidence::Ok, "语言设置已生效".to_string()),
                LocaleVerification::NotApplied { .. }
                | LocaleVerification::SettingsMissing { .. } => {
                    (Confidence::Fail, locale.describe())
                }
                // The one that must never become a failure: we could not read
                // the file, which is not evidence that the setting is absent.
                LocaleVerification::Unreadable { .. } => {
                    (Confidence::Unknown, locale.describe())
                }
            };

            Some(BootstrapCheck {
                key: format!("localization.{id}"),
                label: format!("汉化 {id}"),
                confidence,
                expected: "界面语言已切换".into(),
                observed,
                hint: if confidence.is_ok() {
                    None
                } else {
                    Some("重启对应程序后查看界面语言。".into())
                },
            })
        }
    }
}

fn verify_extension(id: &str, evidence: &VerifyEvidence) -> Option<BootstrapCheck> {
    let request = extension::ExtensionRequest::parse(id)?;
    let present = extension::is_installed(&evidence.installed_extensions, &request);
    let version_ok = extension::version_satisfied(&evidence.installed_extensions, &request);

    let (confidence, observed) = if present && version_ok {
        (Confidence::Ok, "已在插件列表中".to_string())
    } else if present {
        (
            Confidence::Fail,
            format!(
                "已安装，但版本与要求不符（要求 {}）",
                request.version.as_deref().unwrap_or("未指定")
            ),
        )
    } else {
        (Confidence::Fail, "插件列表中未找到".to_string())
    };

    Some(BootstrapCheck {
        key: format!("extension.{id}"),
        label: format!("VS Code 插件 {id}"),
        confidence,
        expected: "已安装".into(),
        observed,
        hint: if confidence.is_ok() {
            None
        } else {
            Some(format!(
                "重新打开 VS Code 后重试，或手动执行：code --install-extension {id}"
            ))
        },
    })
}

/// A one-line summary for the report.
///
/// Driven by the counters rather than by `checks.len()`, so a verification built
/// by hand (a test, or a future caller that reuses the counters) still summarises
/// correctly. The two are equal for every verification [`verify`] produces.
pub fn summarize(verification: &BootstrapVerification) -> String {
    let total = verification.passed + verification.failed + verification.unknown;
    if total == 0 {
        return "无需要验证的配置项。".to_string();
    }
    let mut parts = vec![format!("通过 {}", verification.passed)];
    if verification.failed > 0 {
        parts.push(format!("失败 {}", verification.failed));
    }
    if verification.unknown > 0 {
        parts.push(format!("无法确认 {}", verification.unknown));
    }
    format!("{}（共 {} 项）", parts.join(" / "), total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::plan::{build_plan, PlanContext};
    use super::super::git;
    use crate::modules::catalog::Catalog;

    fn empty_inventory() -> SoftwareInventory {
        SoftwareInventory {
            items: Vec::new(),
            scanned_at: String::new(),
            providers: Vec::new(),
        }
    }

    fn inventory_with(ids: &[SoftwareId]) -> SoftwareInventory {
        SoftwareInventory {
            items: ids
                .iter()
                .map(|id| SoftwareInfo {
                    id: *id,
                    name: id.display_name().to_string(),
                    installed: true,
                    version: Some("1.0.0".into()),
                    path: Some(format!("C:\\{}", id.key())),
                    on_path: true,
                    confidence: Confidence::Ok,
                    package_id: None,
                    sources: vec![],
                    evidence: vec![],
                    hints: vec![],
                })
                .collect(),
            scanned_at: String::new(),
            providers: Vec::new(),
        }
    }

    fn profile_with(bootstrap: ProfileBootstrap) -> Profile {
        Profile {
            id: "test".into(),
            name: "Test".into(),
            tagline: String::new(),
            audience: String::new(),
            rationale: String::new(),
            software: vec![],
            configure: vec![],
            estimated_minutes: 1,
            estimated_download_mb: 1,
            requires_admin: false,
            future: ProfileFuture::default(),
            bootstrap,
            capabilities: vec![],
        }
    }

    fn plan(profile: &Profile, ctx: &PlanContext<'_>) -> BootstrapPlan {
        build_plan(&Catalog::builtin(), profile, ctx)
    }

    /// Builds evidence, cloning the borrowed inputs into the owned shape.
    ///
    /// The cloning is confined to tests; production builds the struct once from
    /// freshly-read probes.
    fn evidence(
        extensions: &[(String, Option<String>)],
        git_config: &BTreeMap<String, String>,
        paths: &BTreeMap<String, bool>,
    ) -> VerifyEvidence {
        VerifyEvidence {
            installed_extensions: extensions.to_vec(),
            git_config: git_config.clone(),
            existing_paths: paths.clone(),
            locale: None,
        }
    }

    #[test]
    fn an_action_that_reported_success_but_left_no_trace_fails() {
        // The whole point: the session is not consulted.
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(std::path::PathBuf::from(r"C:\Code\bin\code.cmd"));

        let p = plan(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["a.b".into()],
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_git = BTreeMap::new();
        let empty_paths = BTreeMap::new();
        let result = verify(&p, &evidence(&empty_ext, &empty_git, &empty_paths));

        assert_eq!(result.failed, 1);
        assert!(!result.overall_ok);
        assert_eq!(result.unknown, 0);
    }

    #[test]
    fn a_present_extension_passes() {
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(std::path::PathBuf::from(r"C:\Code\bin\code.cmd"));

        let p = plan(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["a.b".into()],
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        let installed = extension::parse_installed_list("a.b\n");
        let empty_git = BTreeMap::new();
        let empty_paths = BTreeMap::new();
        let result = verify(&p, &evidence(&installed, &empty_git, &empty_paths));

        assert!(result.overall_ok);
        assert_eq!(result.passed, 1);
    }

    #[test]
    fn a_pinned_version_mismatch_is_a_real_failure() {
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(std::path::PathBuf::from(r"C:\Code\bin\code.cmd"));

        let p = plan(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["a.b@2.0.0".into()],
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        let installed = extension::parse_installed_list("a.b@1.0.0\n");
        let empty_git = BTreeMap::new();
        let empty_paths = BTreeMap::new();
        let result = verify(&p, &evidence(&installed, &empty_git, &empty_paths));

        assert_eq!(result.failed, 1);
        assert!(result.checks[0].observed.contains("版本与要求不符"));
    }

    #[test]
    fn git_settings_are_checked_against_their_values() {
        let inventory = inventory_with(&[SoftwareId::Git]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.git_identity = git::IdentityState::Configured {
            name: "Li".into(),
            email: "li@x.cn".into(),
        };

        let p = plan(
            &profile_with(ProfileBootstrap {
                git: GitBootstrap { configure: true },
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_paths = BTreeMap::new();
        let nothing_set = BTreeMap::new();
        let failed = verify(&p, &evidence(&empty_ext, &nothing_set, &empty_paths));
        assert_eq!(failed.failed, git::baseline_settings().len() as u32);

        let mut all_set = BTreeMap::new();
        for (key, value, _) in git::baseline_settings() {
            all_set.insert(key.to_string(), value.to_string());
        }
        let passed = verify(&p, &evidence(&empty_ext, &all_set, &empty_paths));
        assert!(passed.overall_ok, "got: {:?}", passed.checks);
        assert_eq!(passed.failed, 0);
    }

    #[test]
    fn a_git_setting_with_the_wrong_value_fails() {
        let inventory = inventory_with(&[SoftwareId::Git]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.git_identity = git::IdentityState::Configured {
            name: "Li".into(),
            email: "li@x.cn".into(),
        };

        let p = plan(
            &profile_with(ProfileBootstrap {
                git: GitBootstrap { configure: true },
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_paths = BTreeMap::new();
        let mut wrong = BTreeMap::new();
        for (key, _, _) in git::baseline_settings() {
            wrong.insert(key.to_string(), "something-else".to_string());
        }
        let result = verify(&p, &evidence(&empty_ext, &wrong, &empty_paths));

        assert_eq!(result.failed, git::baseline_settings().len() as u32);
        assert!(result.checks[0].hint.as_deref().unwrap().contains("git config --global"));
    }

    #[test]
    fn the_identity_check_is_never_verified() {
        let inventory = inventory_with(&[SoftwareId::Git]);
        let ctx = PlanContext::empty(&inventory);

        let p = plan(
            &profile_with(ProfileBootstrap {
                git: GitBootstrap { configure: true },
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_git = BTreeMap::new();
        let empty_paths = BTreeMap::new();
        let result = verify(&p, &evidence(&empty_ext, &empty_git, &empty_paths));

        assert!(!result
            .checks
            .iter()
            .any(|c| c.key.contains("user.identity")));
    }

    #[test]
    fn a_write_that_was_not_probed_is_unknown_not_failed() {
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(std::path::PathBuf::from(r"C:\Code\bin\code.cmd"));

        let mut settings = BTreeMap::new();
        settings.insert("editor.tabSize".to_string(), serde_json::json!(2));

        let p = plan(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec![],
                    settings,
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_git = BTreeMap::new();
        let empty_paths = BTreeMap::new();
        let result = verify(&p, &evidence(&empty_ext, &empty_git, &empty_paths));

        assert_eq!(result.checks.len(), 1);
        assert_eq!(result.checks[0].confidence, Confidence::Unknown);
        assert_eq!(result.failed, 0, "an unprobed file must not be a failure");
        assert_eq!(result.unknown, 1);
    }

    #[test]
    fn a_missing_settings_file_is_a_failure() {
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(std::path::PathBuf::from(r"C:\Code\bin\code.cmd"));

        let mut settings = BTreeMap::new();
        settings.insert("editor.tabSize".to_string(), serde_json::json!(2));

        let p = plan(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec![],
                    settings,
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_git = BTreeMap::new();
        // Explicitly probed and absent.
        let mut paths = BTreeMap::new();
        let step = p.steps.iter().find(|s| matches!(s.action, BootstrapAction::FileWrite { .. })).unwrap();
        if let BootstrapAction::FileWrite { path, .. } = &step.action {
            paths.insert(VerifyEvidence::file_key(path), false);
        }

        let result = verify(&p, &evidence(&empty_ext, &empty_git, &paths));
        assert_eq!(result.failed, 1);
        assert!(result.checks[0].observed.contains("文件不存在"));
    }

    #[test]
    fn a_skill_that_landed_passes() {
        let inventory = empty_inventory();
        let mut ctx = PlanContext::empty(&inventory);
        ctx.skills_root = Some(std::path::PathBuf::from(r"C:\skills"));
        ctx.skill_sources
            .insert("pdf-tools".into(), std::path::PathBuf::from(r"C:\app\skills\pdf-tools"));

        let p = plan(
            &profile_with(ProfileBootstrap {
                skills: vec!["pdf-tools".into()],
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_git = BTreeMap::new();
        let mut paths = BTreeMap::new();
        paths.insert(VerifyEvidence::skill_key("pdf-tools"), true);

        let result = verify(&p, &evidence(&empty_ext, &empty_git, &paths));
        assert!(result.overall_ok);
        assert_eq!(result.passed, 1);
    }

    #[test]
    fn a_skill_that_did_not_land_fails() {
        let inventory = empty_inventory();
        let mut ctx = PlanContext::empty(&inventory);
        ctx.skills_root = Some(std::path::PathBuf::from(r"C:\skills"));
        ctx.skill_sources
            .insert("pdf-tools".into(), std::path::PathBuf::from(r"C:\app\skills\pdf-tools"));

        let p = plan(
            &profile_with(ProfileBootstrap {
                skills: vec!["pdf-tools".into()],
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_git = BTreeMap::new();
        let mut paths = BTreeMap::new();
        paths.insert(VerifyEvidence::skill_key("pdf-tools"), false);

        let result = verify(&p, &evidence(&empty_ext, &empty_git, &paths));
        assert_eq!(result.failed, 1);
        assert!(result.checks[0].observed.contains("未找到"));
    }

    #[test]
    fn an_unreadable_locale_file_is_unknown_not_failed() {
        let inventory = inventory_with(&[SoftwareId::Codex]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.localizations = vec![super::super::localization::LocalizationProvider {
            id: "codex".into(),
            target: "Codex".into(),
            requires: Some(SoftwareId::Codex),
            method: super::super::localization::LocalizationMethod::Script {
                url: "https://github.com/xqnode/codex-zh-CN".into(),
            },
            upstream: "https://github.com/xqnode/codex-zh-CN".into(),
        }];

        let p = plan(
            &profile_with(ProfileBootstrap {
                localization: vec!["codex".into()],
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_git = BTreeMap::new();
        let empty_paths = BTreeMap::new();
        let result = verify(
            &p,
            &VerifyEvidence {
                installed_extensions: empty_ext.clone(),
                git_config: empty_git.clone(),
                existing_paths: empty_paths.clone(),
                locale: Some(LocaleVerification::Unreadable {
                    path: std::path::PathBuf::from("x"),
                    reason: "拒绝访问".into(),
                }),
            },
        );

        assert_eq!(result.checks.len(), 1);
        assert_eq!(result.checks[0].confidence, Confidence::Unknown);
        assert_eq!(result.failed, 0);
        assert_eq!(result.unknown, 1);
    }

    #[test]
    fn a_locale_that_did_not_take_is_a_failure() {
        let inventory = inventory_with(&[SoftwareId::Codex]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.localizations = vec![super::super::localization::LocalizationProvider {
            id: "codex".into(),
            target: "Codex".into(),
            requires: Some(SoftwareId::Codex),
            method: super::super::localization::LocalizationMethod::Script {
                url: "https://github.com/xqnode/codex-zh-CN".into(),
            },
            upstream: "https://github.com/xqnode/codex-zh-CN".into(),
        }];

        let p = plan(
            &profile_with(ProfileBootstrap {
                localization: vec!["codex".into()],
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_git = BTreeMap::new();
        let empty_paths = BTreeMap::new();
        let result = verify(
            &p,
            &VerifyEvidence {
                installed_extensions: empty_ext.clone(),
                git_config: empty_git.clone(),
                existing_paths: empty_paths.clone(),
                locale: Some(LocaleVerification::NotApplied {
                    path: std::path::PathBuf::from("settings.json"),
                    expected: "zh-cn".into(),
                }),
            },
        );

        assert_eq!(result.failed, 1);
        assert!(!result.overall_ok);
    }

    #[test]
    fn blocked_and_satisfied_steps_produce_no_checks() {
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(std::path::PathBuf::from(r"C:\Code\bin\code.cmd"));
        ctx.installed_extensions = extension::parse_installed_list("a.b\n");

        let p = plan(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["a.b".into()],
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_git = BTreeMap::new();
        let empty_paths = BTreeMap::new();
        let result = verify(&p, &evidence(&empty_ext, &empty_git, &empty_paths));

        assert!(result.checks.is_empty());
        assert!(!result.overall_ok, "no checks means nothing to be ok about");
    }

    #[test]
    fn a_locale_check_without_locale_evidence_is_omitted_not_faked() {
        // No locale evidence means the caller did not probe it. Reporting a
        // fabricated confidence would be worse than reporting nothing.
        let inventory = inventory_with(&[SoftwareId::Codex]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.localizations = vec![super::super::localization::LocalizationProvider {
            id: "codex".into(),
            target: "Codex".into(),
            requires: Some(SoftwareId::Codex),
            method: super::super::localization::LocalizationMethod::Script {
                url: "https://github.com/xqnode/codex-zh-CN".into(),
            },
            upstream: "https://github.com/xqnode/codex-zh-CN".into(),
        }];

        let p = plan(
            &profile_with(ProfileBootstrap {
                localization: vec!["codex".into()],
                ..Default::default()
            }),
            &ctx,
        );

        let empty_ext: Vec<(String, Option<String>)> = Vec::new();
        let empty_git = BTreeMap::new();
        let empty_paths = BTreeMap::new();
        let result = verify(&p, &evidence(&empty_ext, &empty_git, &empty_paths));

        assert!(result.checks.is_empty());
    }

    #[test]
    fn the_summary_names_every_outcome() {
        let verification = BootstrapVerification {
            // `checks` is empty here while the counters are not, which cannot
            // happen via `verify` (it derives the counters from `checks`) but is
            // reachable for a hand-built value. The summary must follow the
            // counters, not the vector length, so it stays correct either way.
            checks: vec![],
            passed: 3,
            failed: 1,
            unknown: 2,
            overall_ok: false,
        };
        let text = summarize(&verification);
        assert!(text.contains("通过 3"), "got: {text}");
        assert!(text.contains("失败 1"), "got: {text}");
        assert!(text.contains("无法确认 2"), "got: {text}");
        assert!(text.contains("共 6 项"), "got: {text}");

        assert_eq!(
            summarize(&BootstrapVerification {
                checks: vec![],
                passed: 0,
                failed: 0,
                unknown: 0,
                overall_ok: false,
            }),
            "无需要验证的配置项。"
        );
    }

    #[test]
    fn a_summary_with_no_failures_omits_the_failure_clause() {
        // "失败 0" in the report would read as a problem that does not exist.
        let text = summarize(&BootstrapVerification {
            checks: vec![],
            passed: 4,
            failed: 0,
            unknown: 0,
            overall_ok: true,
        });
        assert_eq!(text, "通过 4（共 4 项）");
    }

    #[test]
    fn evidence_keys_match_what_the_checks_look_up() {
        // A mismatch here would silently make every file and skill check
        // "unknown", which is a passing-looking failure.
        assert_eq!(
            VerifyEvidence::file_key(std::path::Path::new(r"C:\a\b\settings.json")),
            "file:settings.json"
        );
        assert_eq!(VerifyEvidence::skill_key("pdf-tools"), "skill:pdf-tools");
    }
}
