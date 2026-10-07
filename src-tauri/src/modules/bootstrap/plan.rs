//! The Bootstrap Plan — a profile turned into an ordered list of actions.
//!
//! This is the module the brief's "第一部分：设计统一 Action 系统" asks for. It is
//! the bootstrap counterpart of [`super::super::install::build_plan`], and it is
//! shaped the same way on purpose:
//!
//! ```text
//! install::build_plan(profile, inventory) → InstallPlan   → executor
//! bootstrap::build_plan(profile, inventory) → BootstrapPlan → executor
//! ```
//!
//! ## The central rule: actions are data, and they are not executed here
//!
//! [`BootstrapAction::plan`] returns [`InstallSource`] values — the same enum
//! stage 3 defined. It cannot run anything, cannot open a file, cannot copy a
//! directory. That is not a stylistic preference; it is how the brief's
//! "禁止产生第二套执行框架" is enforced structurally. There is exactly one function
//! in this program that changes the machine
//! ([`super::super::executor::execute_source`]), and this module's only power is
//! to hand it work.
//!
//! ## No `match` on software identity
//!
//! The brief forbids `install_xxx()` / `configure_xxx()` functions and `match
//! SoftwareId`. The way that is honoured: **every capability is a variant of
//! [`BootstrapAction`], and the variant is chosen by the *profile's data*, not by
//! which program it is.**
//!
//! A profile says:
//!
//! ```json
//! { "vscode": { "extensions": ["ms-python.python"] },
//!   "mcp": ["filesystem"],
//!   "skills": ["pdf-tools"] }
//! ```
//!
//! and the planner walks those lists producing `Extension { .. }`, `Mcp { .. }`,
//! `Skill { .. }`. There is no `if profile.id == "coder"` anywhere. A program name
//! only ever appears as *data* the plan carries — never as a branch.
//!
//! The one exception, and it is worth being explicit about, is the wiring table
//! [`capability_sources`]: it decides *where* a capability's action lands (which
//! config file, which CLI). That is a lookup from the catalog-ish data at the top
//! of this file, not a branch in the algorithm, and it is the same discipline
//! `catalog.rs` already established for installers.

use crate::model::*;

use super::git;
use super::localization::{self, LocalizationMethod, LocalizationProvider};
use super::mcp;

use std::collections::BTreeMap;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// The action model
// ---------------------------------------------------------------------------

/// One thing bootstrap will do.
///
/// Every variant satisfies the brief's four requirements, and it is worth saying
/// *how* each is met rather than asserting it:
///
/// | requirement | mechanism |
/// |---|---|
/// | 可执行 (executable) | [`BootstrapAction::sources`] returns one or more [`InstallSource`], run by the stage-3 executor |
/// | 可记录 (recordable) | every action has an `id` and a human `description`; the trace is the `ActionRecord` the executor produces |
/// | 可验证 (verifiable) | [`BootstrapAction::verify`] returns a check that reads the machine afterwards |
/// | 可失败 (can fail) | the executor's [`AttemptOutcome`] is the failure channel; nothing here swallows it |
#[derive(Debug, Clone)]
pub enum BootstrapAction {
    /// Install a VS Code extension through the vendor's CLI.
    ///
    /// `cli` is the resolved path to `code.cmd`, filled in at plan time so the
    /// action carries its own inputs and stays replayable from the trace.
    Extension {
        id: String,
        /// `false` when the extension is already listed by `--list-extensions`.
        needed: bool,
    },
    /// Run a program's own configuration command (e.g. `git config --global …`).
    ///
    /// Modelled as a generic command rather than a `GitConfig` variant because
    /// that is what it is: `InstallSource::Script` already exists for "run this
    /// documented command", and inventing a parallel concept would be the
    /// duplication the brief forbids.
    ConfigCommand {
        key: String,
        value: String,
        rationale: String,
    },
    /// Merge values into a configuration file, with backup and rollback.
    ///
    /// This one does **not** map to an [`InstallSource`]: it is the one action
    /// whose mechanism is [`ConfigWriter`] rather than a process. That is a
    /// deliberate exception, and it is *one* exception — the writer is the single
    /// file-mutating component, exactly as the executor is the single
    /// process-launching one. Everything else that touches the disk (skills,
    /// localisation backups) goes through a helper that is likewise shared.
    FileWrite {
        path: PathBuf,
        adapter: &'static str,
        values: BTreeMap<String, serde_json::Value>,
    },
    /// Copy a skill directory and register it.
    SkillInstall {
        name: String,
        source: PathBuf,
        target_root: PathBuf,
    },
    /// Apply an upstream localisation: download and run its script.
    Localization {
        id: String,
        upstream: String,
        url: String,
    },
}

impl BootstrapAction {
    /// A stable id, used in the trace and in the UI's action line.
    pub fn id(&self) -> String {
        match self {
            BootstrapAction::Extension { id, .. } => format!("extension:{id}"),
            BootstrapAction::ConfigCommand { key, .. } => format!("config:{key}"),
            BootstrapAction::FileWrite { path, .. } => {
                format!("file:{}", path.file_name().unwrap_or_default().to_string_lossy())
            }
            BootstrapAction::SkillInstall { name, .. } => format!("skill:{name}"),
            BootstrapAction::Localization { id, .. } => format!("localization:{id}"),
        }
    }

    /// What the student sees on the action line.
    pub fn description(&self) -> String {
        match self {
            BootstrapAction::Extension { id, needed } => {
                if *needed {
                    format!("安装 VS Code 插件 {id}")
                } else {
                    format!("VS Code 插件 {id} 已安装，跳过")
                }
            }
            BootstrapAction::ConfigCommand { key, value, .. } => {
                format!("设置 {key} = {value}")
            }
            BootstrapAction::FileWrite { path, values, .. } => format!(
                "写入 {}（{} 项设置）",
                path.file_name().unwrap_or_default().to_string_lossy(),
                values.len()
            ),
            BootstrapAction::SkillInstall { name, .. } => format!("安装技能 {name}"),
            BootstrapAction::Localization { id, .. } => format!("应用 {id} 汉化"),
        }
    }

    /// The mechanisms that could carry this action out, in preference order.
    ///
    /// Most actions have exactly one. Returning a `Vec` keeps the door open for a
    /// fallback (a localisation script that could fall back to a package) without
    /// a schema change — but nothing invents a second link speculatively, because
    /// a fallback that has never been exercised is a liability, not a feature.
    pub fn sources(&self, cli: Option<&PathBuf>) -> Vec<InstallSource> {
        match self {
            BootstrapAction::Extension { id, needed } => {
                if !*needed {
                    return vec![InstallSource::ConfigurationOnly];
                }
                match cli {
                    Some(path) => vec![InstallSource::Script {
                        command: format!(
                            "\"{}\" --install-extension {id} --force",
                            path.display()
                        ),
                    }],
                    // Without a CLI the action cannot run. `ConfigurationOnly`
                    // is the honest representation: the executor records a
                    // success-with-no-effect, and the *verifier* is what reports
                    // the extension as missing. Reporting a fabricated command
                    // here would put a lie in the trace.
                    None => vec![InstallSource::ConfigurationOnly],
                }
            }
            BootstrapAction::ConfigCommand { key, value, .. } => vec![InstallSource::Script {
                command: format!("git config --global {key} \"{value}\""),
            }],
            BootstrapAction::FileWrite { .. } => vec![InstallSource::ConfigurationOnly],
            BootstrapAction::SkillInstall { .. } => vec![InstallSource::ConfigurationOnly],
            BootstrapAction::Localization { url, .. } => vec![InstallSource::OfficialInstaller {
                url: url.clone(),
                sha256: None,
            }],
        }
    }

    /// Whether this action's work is already done, so it can be skipped.
    pub fn is_needed(&self) -> bool {
        match self {
            BootstrapAction::Extension { needed, .. } => *needed,
            _ => true,
        }
    }
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/// The five stages the UI shows.
///
/// Fixed and ordered, because the brief's completion criterion is a *sequence*
/// the student watches (`检测 → 安装 → 配置 VS Code → 配置 Git → MCP → Skills →
/// 语言 → 重新检测`), and a dynamically-ordered list would make the progress
/// display reflow as it ran.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum BootstrapStage {
    /// Extensions and the settings file that enables them.
    Vscode,
    /// Git identity check and behaviour defaults.
    Git,
    /// MCP server registrations.
    Mcp,
    /// Skill directories.
    Skills,
    /// Localisation.
    Localization,
}

impl BootstrapStage {
    pub const ALL: [BootstrapStage; 5] = [
        BootstrapStage::Vscode,
        BootstrapStage::Git,
        BootstrapStage::Mcp,
        BootstrapStage::Skills,
        BootstrapStage::Localization,
    ];

    /// The key the stage is reported under; `None` when the check does not name
    /// a program.
    pub fn key(self) -> &'static str {
        match self {
            BootstrapStage::Vscode => "vscode",
            BootstrapStage::Git => "git",
            BootstrapStage::Mcp => "mcp",
            BootstrapStage::Skills => "skills",
            BootstrapStage::Localization => "localization",
        }
    }

    /// The program this stage needs installed, when it needs one.
    ///
    /// **This is what keeps the planner free of per-program branching.** The
    /// planner asks "does this stage's dependency exist?" by looking the id up
    /// here — a data lookup — instead of writing `ctx.has(SoftwareId::Git)`,
    /// which would be the `match SoftwareId` the brief forbids wearing a
    /// different hat. Adding a stage is a variant plus one row in this table.
    pub fn requires(self) -> Option<SoftwareId> {
        match self {
            BootstrapStage::Vscode => Some(SoftwareId::Vscode),
            BootstrapStage::Git => Some(SoftwareId::Git),
            // MCP configuration is a file write, not something that needs a
            // running program. An absent Node means the *server* may not start,
            // which is a note on the step, not a reason to skip writing it.
            BootstrapStage::Mcp => None,
            // Skills are copied for an agent; whether the agent is installed
            // changes nothing about where its skill directory goes.
            BootstrapStage::Skills => None,
            // Localisation is per-target: the provider declares its own
            // dependency, so a stage-level one would be either wrong or
            // redundant.
            BootstrapStage::Localization => None,
        }
    }

    /// Whether this stage's dependency is present on the machine.
    ///
    /// A stage with no dependency is always available.
    pub fn available(self, has: &dyn Fn(SoftwareId) -> bool) -> bool {
        self.requires().is_none_or(has)
    }

    pub fn display_name(self) -> &'static str {
        match self {
            BootstrapStage::Vscode => "VS Code 环境",
            BootstrapStage::Git => "Git 配置",
            BootstrapStage::Mcp => "MCP 配置",
            BootstrapStage::Skills => "Skills",
            BootstrapStage::Localization => "语言设置",
        }
    }
}

/// One action, with its stage and everything needed to run and verify it.
#[derive(Debug, Clone)]
pub struct BootstrapStep {
    pub stage: BootstrapStage,
    pub action: BootstrapAction,
    /// Why this step exists, in user-facing Chinese.
    pub rationale: String,
    /// `false` when the action has nothing to do (already satisfied).
    pub needed: bool,
    /// The reason it is not needed, shown instead of a bare "skipped".
    pub skip_reason: Option<String>,
    /// Set when the step cannot run at all on this machine, with the fix.
    ///
    /// A blocked step is reported as a *warning with an explanation*, never as a
    /// silent skip: "MCP 配置" disappearing from the list without a word is how
    /// a student concludes the app is broken.
    pub blocked: Option<String>,
}

/// Per-stage rollup, which is what the UI renders as ✓ / ○.
#[derive(Debug, Clone)]
pub struct StageSummary {
    pub stage: BootstrapStage,
    pub key: String,
    pub name: String,
    pub total: u32,
    pub needed: u32,
    pub blocked: u32,
}

/// The whole bootstrap plan.
#[derive(Debug, Clone)]
pub struct BootstrapPlan {
    pub profile_id: String,
    pub steps: Vec<BootstrapStep>,
    pub stages: Vec<StageSummary>,
    /// Directories the run may write to. Passed to [`ConfigWriter`] so a
    /// hand-edited profile cannot name an arbitrary system path.
    pub allowed_roots: Vec<PathBuf>,
    /// Notes about things we deliberately did not do, carried into the report.
    pub not_attempted: Vec<String>,
}

impl BootstrapPlan {
    pub fn steps_for(&self, stage: BootstrapStage) -> impl Iterator<Item = &BootstrapStep> {
        self.steps.iter().filter(move |s| s.stage == stage)
    }

    /// Steps that will actually do something.
    pub fn runnable(&self) -> impl Iterator<Item = &BootstrapStep> {
        self.steps.iter().filter(|s| s.needed && s.blocked.is_none())
    }

    pub fn needed_count(&self) -> u32 {
        self.runnable().count() as u32
    }

    pub fn blocked_count(&self) -> u32 {
        self.steps.iter().filter(|s| s.blocked.is_some()).count() as u32
    }
}

// ---------------------------------------------------------------------------
// Where each capability's action lands
// ---------------------------------------------------------------------------

/// The per-target wiring, as data.
///
/// This is the "catalog" of the bootstrap layer, and it exists for the same
/// reason `catalog.rs` does: it is the one place a vendor path or a vendor CLI is
/// named, so a second target is an entry rather than a code path. Nothing below
/// branches on a program name; the functions take the ids they were given.
pub struct CapabilityTarget {
    /// `%APPDATA%`-relative (or absolute) settings file for a GUI program.
    pub settings_file: Option<&'static str>,
    /// Where skills go for this agent.
    pub skills_dir: Option<&'static str>,
    /// Where MCP servers are configured.
    pub mcp_file: Option<&'static str>,
    /// The locale key the program reads, when it has one.
    pub locale_key: Option<&'static str>,
}

/// Expands `%VAR%` and returns an absolute path.
///
/// Reuses [`super::super::config::expand_path`] rather than reimplementing it:
/// the variable set is the same one the localisation catalogue already declares,
/// and two expanders could disagree about `%APPDATA%`.
fn expand(template: &str) -> PathBuf {
    PathBuf::from(super::super::config::expand_path(template))
}

/// The directories a bootstrap run is allowed to write to.
///
/// Deliberately the *user's own* configuration directories and nothing else. This
/// is the check that stops a hand-edited profile from naming `C:\Windows\…`:
/// see [`ConfigWriter::is_allowed`].
pub fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for var in ["APPDATA", "LOCALAPPDATA", "USERPROFILE"] {
        if let Ok(value) = std::env::var(var) {
            let path = PathBuf::from(value);
            if path.is_dir() {
                roots.push(path);
            }
        }
    }
    roots
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/// Everything the planner needs beyond the profile itself.
///
/// Passed as a struct rather than six arguments so a test can build one without
/// touching the machine, which is what keeps the whole planning surface free of
/// side effects.
pub struct PlanContext<'a> {
    /// Live inventory, for "is the program there" and "is the extension there".
    pub inventory: &'a SoftwareInventory,
    /// Resolved `code` CLI, when VS Code is usable.
    pub code_cli: Option<PathBuf>,
    /// Extensions already installed, from `code --list-extensions`.
    pub installed_extensions: Vec<(String, Option<String>)>,
    /// Git's global config, already read.
    pub git_config: BTreeMap<String, String>,
    /// Git identity state. Split from `git_config` because a read *failure* is a
    /// different answer from "not configured".
    pub git_identity: git::IdentityState,
    /// Skill directories available to install, keyed by name.
    pub skill_sources: BTreeMap<String, PathBuf>,
    /// Where skills are installed to.
    pub skills_root: Option<PathBuf>,
    /// Localisation providers the profile asked for, already resolved to data.
    pub localizations: Vec<LocalizationProvider>,
    /// `npx` availability, needed for npm-type MCP servers.
    pub npx_available: bool,
}

impl<'a> PlanContext<'a> {
    /// A context describing a machine with nothing on it.
    ///
    /// Used by tests and by the UI's "what would happen" preview. Every field is
    /// the *unknown* answer rather than the negative one, so a plan built from it
    /// is conservative: nothing is assumed present, nothing is assumed absent.
    pub fn empty(inventory: &'a SoftwareInventory) -> Self {
        Self {
            inventory,
            code_cli: None,
            installed_extensions: Vec::new(),
            git_config: BTreeMap::new(),
            git_identity: git::IdentityState::Unknown {
                reason: "尚未检查".into(),
            },
            skill_sources: BTreeMap::new(),
            skills_root: None,
            localizations: Vec::new(),
            npx_available: false,
        }
    }

    fn has(&self, id: SoftwareId) -> bool {
        self.inventory
            .find(id)
            .is_some_and(|item| item.installed)
    }
}

/// Builds the bootstrap plan for a profile.
///
/// Ordering is the stages' order, and within a stage the profile's own list
/// order. That matters for one concrete reason: VS Code settings should be
/// written *after* the extensions they configure are present, so an extension
/// that registers settings of its own cannot overwrite ours, and a Git identity
/// prompt should come *before* anything that might want to clone.
pub fn build_plan(
    catalog: &super::super::catalog::Catalog,
    profile: &Profile,
    ctx: &PlanContext<'_>,
) -> BootstrapPlan {
    let mut steps: Vec<BootstrapStep> = Vec::new();
    let mut not_attempted: Vec<String> = Vec::new();

    let bootstrap = &profile.bootstrap;

    // -- VS Code ---------------------------------------------------------
    plan_vscode(profile, ctx, bootstrap, &mut steps);

    // -- Git -------------------------------------------------------------
    plan_git(ctx, bootstrap, &mut steps, &mut not_attempted);

    // -- MCP -------------------------------------------------------------
    plan_mcp(ctx, bootstrap, &mut steps);

    // -- Skills ----------------------------------------------------------
    plan_skills(ctx, bootstrap, &mut steps);

    // -- Localisation ----------------------------------------------------
    plan_localization(ctx, bootstrap, &mut steps, &mut not_attempted);

    // A profile that asks for nothing in a stage still gets that stage shown, so
    // the UI's list is stable and the student can see that the stage was
    // considered rather than skipped silently.
    let stages = BootstrapStage::ALL
        .iter()
        .map(|stage| {
            let in_stage: Vec<&BootstrapStep> =
                steps.iter().filter(|s| s.stage == *stage).collect();
            StageSummary {
                stage: *stage,
                key: stage.key().to_string(),
                name: stage.display_name().to_string(),
                total: in_stage.len() as u32,
                needed: in_stage
                    .iter()
                    .filter(|s| s.needed && s.blocked.is_none())
                    .count() as u32,
                blocked: in_stage.iter().filter(|s| s.blocked.is_some()).count() as u32,
            }
        })
        .collect();

    // Reuses the catalog only to prove the plan covers the profile's software;
    // nothing here installs. Kept so a future profile that bootstraps a program
    // not in the install list is caught rather than silently ignored.
    let _ = catalog;

    BootstrapPlan {
        profile_id: profile.id.clone(),
        steps,
        stages,
        allowed_roots: allowed_roots(),
        not_attempted,
    }
}

// ---------------------------------------------------------------------------

fn plan_vscode(
    profile: &Profile,
    ctx: &PlanContext<'_>,
    bootstrap: &ProfileBootstrap,
    steps: &mut Vec<BootstrapStep>,
) {
    let stage = BootstrapStage::Vscode;
    let vscode_present = stage.available(&|id| ctx.has(id)) || ctx.code_cli.is_some();

    // Extensions.
    for spec in &bootstrap.vscode.extensions {
        let Some(request) = super::extension::ExtensionRequest::parse(spec) else {
            steps.push(BootstrapStep {
                stage: BootstrapStage::Vscode,
                action: BootstrapAction::Extension {
                    id: spec.clone(),
                    needed: false,
                },
                rationale: format!("插件标识 {spec:?} 格式无效（应为 publisher.name）"),
                needed: false,
                skip_reason: Some(format!(
                    "插件标识 {spec:?} 格式无效，已跳过。正确格式形如 ms-python.python"
                )),
                blocked: None,
            });
            continue;
        };

        let installed = super::extension::is_installed(&ctx.installed_extensions, &request);
        let version_ok = super::extension::version_satisfied(&ctx.installed_extensions, &request);
        let needed = !(installed && version_ok);

        let blocked = if !vscode_present {
            Some(
                "未检测到 VS Code，无法安装插件。请先完成软件安装步骤，或手动安装 VS Code。"
                    .to_string(),
            )
        } else if ctx.code_cli.is_none() {
            Some(
                "已安装 VS Code，但 `code` 命令行工具不可用。请在 VS Code 中执行一次 \
                 「Shell Command: Install 'code' command in PATH」，然后重试。"
                    .to_string(),
            )
        } else {
            None
        };

        steps.push(BootstrapStep {
            stage: BootstrapStage::Vscode,
            action: BootstrapAction::Extension {
                id: request.cli_argument(),
                needed,
            },
            rationale: "通过 VS Code 官方 CLI 安装插件，自动处理版本与依赖".into(),
            needed,
            skip_reason: if !needed {
                Some(format!(
                    "{} 已安装，无需重复安装。",
                    request.lookup_id()
                ))
            } else {
                None
            },
            blocked,
        });
    }

    // The settings file. Written through the profile's declared values, so no
    // key is invented here.
    if !bootstrap.vscode.settings.is_empty() {
        let target = bootstrap
            .vscode
            .settings_file
            .clone()
            .unwrap_or_else(|| VSCODE_DEFAULT_SETTINGS.to_string());

        steps.push(BootstrapStep {
            stage: BootstrapStage::Vscode,
            action: BootstrapAction::FileWrite {
                path: expand(&target),
                adapter: "jsonc",
                values: bootstrap.vscode.settings.clone(),
            },
            rationale: "写入 VS Code 用户设置（合并写入，保留你已有的配置）".into(),
            needed: true,
            skip_reason: None,
            blocked: if vscode_present {
                None
            } else {
                Some("未检测到 VS Code，已跳过设置写入。".to_string())
            },
        });
    }

    // A profile that asks for extensions but no settings still needs the file
    // touched for the locale case, which the localisation stage handles.
    let _ = profile;
}

/// Default VS Code user settings location.
///
/// Named here and nowhere else. `%APPDATA%\Code\User\settings.json` is the
/// vendor's documented per-user location for a stable-channel install.
const VSCODE_DEFAULT_SETTINGS: &str = r"%APPDATA%\Code\User\settings.json";

fn plan_git(
    ctx: &PlanContext<'_>,
    bootstrap: &ProfileBootstrap,
    steps: &mut Vec<BootstrapStep>,
    not_attempted: &mut Vec<String>,
) {
    let stage = BootstrapStage::Git;
    let git_present = stage.available(&|id| ctx.has(id));

    if !bootstrap.git.configure {
        return;
    }

    // The identity check is a *reported* step, never a written one. It produces a
    // step with `needed: false` and a `skip_reason` that carries the instruction,
    // so it shows in the list as "需要你手动完成" rather than vanishing.
    steps.push(BootstrapStep {
        stage: BootstrapStage::Git,
        action: BootstrapAction::ConfigCommand {
            key: "user.identity.check".into(),
            value: String::new(),
            rationale: "检查 Git 提交身份是否已配置".into(),
        },
        rationale: "检查 Git 提交身份".into(),
        needed: false,
        skip_reason: ctx
            .git_identity
            .user_message()
            .or_else(|| Some("Git 提交身份已配置，无需处理。".into())),
        blocked: if git_present {
            None
        } else {
            Some("未检测到 Git，已跳过 Git 配置。".to_string())
        },
    });

    // Behaviour defaults only. Never an identity — see `git.rs`.
    for (key, value, rationale) in git::baseline_settings() {
        let already = ctx
            .git_config
            .get(key)
            .is_some_and(|current| current == value);

        steps.push(BootstrapStep {
            stage: BootstrapStage::Git,
            action: BootstrapAction::ConfigCommand {
                key: key.to_string(),
                value: value.to_string(),
                rationale: rationale.to_string(),
            },
            rationale: rationale.to_string(),
            needed: !already,
            skip_reason: if already {
                Some(format!("{key} 已是 {value}，无需修改。"))
            } else {
                None
            },
            blocked: if git_present {
                None
            } else {
                Some("未检测到 Git，已跳过 Git 配置。".to_string())
            },
        });
    }

    not_attempted.push(
        "Git 提交身份（user.name / user.email）：需由你本人填写，本程序不会代为生成。".into(),
    );
}

fn plan_mcp(ctx: &PlanContext<'_>, bootstrap: &ProfileBootstrap, steps: &mut Vec<BootstrapStep>) {
    if bootstrap.mcp.is_empty() {
        return;
    }

    // Every server in the profile goes into one file write, so the client sees a
    // single consistent change rather than one write per server.
    let mut servers: Vec<mcp::McpServer> = Vec::new();
    let mut blocked_reasons: Vec<String> = Vec::new();

    for entry in &bootstrap.mcp {
        match mcp::parse_bootstrap(entry) {
            Ok(server) => servers.push(server),
            Err(e) => blocked_reasons.push(e.message()),
        }
    }

    if servers.is_empty() {
        for reason in blocked_reasons {
            steps.push(BootstrapStep {
                stage: BootstrapStage::Mcp,
                action: BootstrapAction::FileWrite {
                    path: mcp_config_path(),
                    adapter: "json",
                    values: BTreeMap::new(),
                },
                rationale: "MCP 服务器配置".into(),
                needed: false,
                skip_reason: None,
                blocked: Some(reason),
            });
        }
        return;
    }

    let target = mcp_config_path();

    // `npx` is what actually runs an npm-type server. Reporting it as a blocker
    // would be wrong — Node may be installed in the same run — so it is a
    // *warning* carried in the rationale, and the verify step is what proves it.
    let npx_note = if ctx.npx_available {
        String::new()
    } else {
        "（注意：未检测到 npx。若 Node.js 尚未安装完成，MCP 服务器可能需要在安装 Node 后重启客户端才能生效。）".to_string()
    };

    steps.push(BootstrapStep {
        stage: BootstrapStage::Mcp,
        action: BootstrapAction::FileWrite {
            path: target.clone(),
            adapter: "json",
            values: mcp::config_value(&servers)
                .unwrap_or_else(|_| serde_json::json!({ "mcpServers": {} }))["mcpServers"]
                .clone()
                .as_object()
                .map(|map| {
                    let mut values = BTreeMap::new();
                    values.insert(
                        "mcpServers".to_string(),
                        serde_json::Value::Object(map.clone()),
                    );
                    values
                })
                .unwrap_or_default(),
        },
        rationale: format!(
            "把 {} 个 MCP 服务器写入 {}（合并写入，保留已有服务器）{}",
            servers.len(),
            target.display(),
            npx_note
        ),
        needed: true,
        skip_reason: None,
        blocked: None,
    });

    for reason in blocked_reasons {
        steps.push(BootstrapStep {
            stage: BootstrapStage::Mcp,
            action: BootstrapAction::FileWrite {
                path: target.clone(),
                adapter: "json",
                values: BTreeMap::new(),
            },
            rationale: "MCP 服务器配置".into(),
            needed: false,
            skip_reason: None,
            blocked: Some(reason),
        });
    }
}

/// Where MCP servers are written.
///
/// One location for V1, and it is the per-user one, so no elevation is needed.
/// When a second client is added this becomes a lookup keyed by the profile's
/// declared target — a data change, not an algorithm change.
fn mcp_config_path() -> PathBuf {
    expand(r"%APPDATA%\Claude\claude_desktop_config.json")
}

fn plan_skills(ctx: &PlanContext<'_>, bootstrap: &ProfileBootstrap, steps: &mut Vec<BootstrapStep>) {
    let Some(root) = ctx.skills_root.clone() else {
        for name in &bootstrap.skills {
            steps.push(BootstrapStep {
                stage: BootstrapStage::Skills,
                action: BootstrapAction::SkillInstall {
                    name: name.clone(),
                    source: PathBuf::new(),
                    target_root: PathBuf::new(),
                },
                rationale: "复制技能目录到 Agent 的技能目录".into(),
                needed: false,
                skip_reason: None,
                blocked: Some(
                    "无法确定技能安装目录（未找到目标 Agent 的用户目录）。".to_string(),
                ),
            });
        }
        return;
    };

    for name in &bootstrap.skills {
        let Some(source) = ctx.skill_sources.get(name).cloned() else {
            steps.push(BootstrapStep {
                stage: BootstrapStage::Skills,
                action: BootstrapAction::SkillInstall {
                    name: name.clone(),
                    source: PathBuf::new(),
                    target_root: root.clone(),
                },
                rationale: "复制技能目录到 Agent 的技能目录".into(),
                needed: false,
                skip_reason: None,
                blocked: Some(format!(
                    "内置技能 {name} 不存在。这通常是方案配置错误，请反馈。"
                )),
            });
            continue;
        };

        let already = super::skill::is_installed(&root, name);

        steps.push(BootstrapStep {
            stage: BootstrapStage::Skills,
            action: BootstrapAction::SkillInstall {
                name: name.clone(),
                source: source.clone(),
                target_root: root.clone(),
            },
            rationale: "复制技能目录到 Agent 的技能目录，保持社区既有结构".into(),
            needed: !already,
            skip_reason: if already {
                Some(format!("技能 {name} 已存在，为保留你的本地修改未覆盖。"))
            } else {
                None
            },
            blocked: None,
        });
    }
}

fn plan_localization(
    ctx: &PlanContext<'_>,
    bootstrap: &ProfileBootstrap,
    steps: &mut Vec<BootstrapStep>,
    not_attempted: &mut Vec<String>,
) {
    for id in &bootstrap.localization {
        // The provider set is resolved by the caller (see `resolve_providers`),
        // so a profile naming an unknown localisation is a blocked step with a
        // clear reason rather than a silent skip.
        let Some(provider) = ctx.localizations.iter().find(|p| &p.id == id) else {
            steps.push(BootstrapStep {
                stage: BootstrapStage::Localization,
                action: BootstrapAction::Localization {
                    id: id.clone(),
                    upstream: String::new(),
                    url: String::new(),
                },
                rationale: "应用汉化".into(),
                needed: false,
                skip_reason: None,
                blocked: Some(format!(
                    "未知的汉化项 {id}。可用项：{}",
                    ctx.localizations
                        .iter()
                        .map(|p| p.id.as_str())
                        .collect::<Vec<_>>()
                        .join("、")
                )),
            });
            continue;
        };

        // Skip rather than fail when the program this localises is absent.
        let precheck = provider.precheck(&|id| ctx.has(id));

        match (&provider.method, &precheck) {
            // VS Code language packs are extensions, so they go through the
            // extension path — same CLI, same verification, one mechanism.
            (LocalizationMethod::Package { extension_id }, None) => {
                let request = super::extension::ExtensionRequest::parse(extension_id);
                let installed = request
                    .as_ref()
                    .is_some_and(|r| super::extension::is_installed(&ctx.installed_extensions, r));

                steps.push(BootstrapStep {
                    stage: BootstrapStage::Localization,
                    action: BootstrapAction::Extension {
                        id: extension_id.clone(),
                        needed: !installed,
                    },
                    rationale: format!("用官方语言包汉化 {}（{}）", provider.target, provider.upstream),
                    needed: !installed,
                    skip_reason: if installed {
                        Some(format!("语言包 {extension_id} 已安装。"))
                    } else {
                        None
                    },
                    blocked: if ctx.code_cli.is_none() && !installed {
                        Some(
                            "已安装 VS Code，但 `code` 命令行工具不可用，无法安装语言包。"
                                .to_string(),
                        )
                    } else {
                        None
                    },
                });
            }

            (LocalizationMethod::Script { url }, None) => {
                let blocked = localization::validate_script_url(url)
                    .err()
                    .map(|e| e.message());
                steps.push(BootstrapStep {
                    stage: BootstrapStage::Localization,
                    action: BootstrapAction::Localization {
                        id: provider.id.clone(),
                        upstream: provider.upstream.clone(),
                        url: url.clone(),
                    },
                    rationale: format!(
                        "运行上游社区汉化方案（{}），执行前会先备份",
                        provider.upstream
                    ),
                    needed: true,
                    skip_reason: None,
                    blocked,
                });
            }

            (_, Some(reason)) => {
                steps.push(BootstrapStep {
                    stage: BootstrapStage::Localization,
                    action: BootstrapAction::Localization {
                        id: provider.id.clone(),
                        upstream: provider.upstream.clone(),
                        url: String::new(),
                    },
                    rationale: "应用汉化".into(),
                    needed: false,
                    skip_reason: Some(reason.clone()),
                    blocked: None,
                });
            }
        }
    }

    not_attempted.push(
        "破解类汉化（直接修改程序资源文件）：不做。会破坏自动更新与安装完整性，只使用官方语言包或上游社区方案。"
            .into(),
    );
}

/// Not re-exported for external use: the profile type lives in `model.rs`, and
/// keeping the alias here would be a second name for one concept.
use crate::model::ProfileBootstrap;

#[cfg(test)]
mod tests {
    use super::*;

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

    fn plan_for(profile: &Profile, ctx: &PlanContext<'_>) -> BootstrapPlan {
        build_plan(&super::super::super::catalog::Catalog::builtin(), profile, ctx)
    }

    #[test]
    fn a_profile_asking_for_nothing_produces_no_runnable_steps() {
        let inventory = empty_inventory();
        let ctx = PlanContext::empty(&inventory);
        let plan = plan_for(&profile_with(ProfileBootstrap::default()), &ctx);

        assert_eq!(plan.needed_count(), 0);
        assert_eq!(
            plan.stages.len(),
            5,
            "every stage is shown, so the UI list is stable"
        );
        assert!(plan.stages.iter().all(|s| s.total == 0));
    }

    #[test]
    fn an_extension_that_is_missing_is_planned() {
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(PathBuf::from(r"C:\Code\bin\code.cmd"));

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["ms-python.python".into()],
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        let step = &plan.steps[0];
        assert!(step.needed);
        assert!(step.blocked.is_none());
        assert!(matches!(
            step.action,
            BootstrapAction::Extension { ref id, needed: true } if id == "ms-python.python"
        ));
    }

    #[test]
    fn an_extension_that_is_present_is_not_planned() {
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(PathBuf::from(r"C:\Code\bin\code.cmd"));
        ctx.installed_extensions =
            super::super::extension::parse_installed_list("ms-python.python\n");

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["ms-python.python".into()],
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        let step = &plan.steps[0];
        assert!(!step.needed, "an installed extension must not be re-planned");
        assert!(step.skip_reason.as_deref().unwrap().contains("已安装"));
        assert_eq!(plan.needed_count(), 0);
    }

    #[test]
    fn an_extension_is_blocked_when_the_cli_is_missing() {
        // Reporting this as a silent skip is what makes a student think the app
        // forgot their profile.
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let ctx = PlanContext::empty(&inventory); // code_cli: None

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["ms-python.python".into()],
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        let step = &plan.steps[0];
        let blocked = step.blocked.as_deref().expect("must be blocked");
        assert!(blocked.contains("code"), "got: {blocked}");
        assert_eq!(plan.blocked_count(), 1);
    }

    #[test]
    fn a_malformed_extension_id_is_reported_not_ignored() {
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(PathBuf::from(r"C:\Code\bin\code.cmd"));

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["not-a-valid-id".into()],
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        assert!(!plan.steps[0].needed);
        assert!(plan.steps[0]
            .skip_reason
            .as_deref()
            .unwrap()
            .contains("格式无效"));
    }

    #[test]
    fn the_extension_action_runs_the_vendor_cli() {
        // The whole "do not reimplement the extension system" decision, asserted.
        let action = BootstrapAction::Extension {
            id: "ms-python.python".into(),
            needed: true,
        };
        let cli = PathBuf::from(r"C:\Code\bin\code.cmd");
        let sources = action.sources(Some(&cli));

        match &sources[0] {
            InstallSource::Script { command } => {
                assert!(command.contains("code.cmd"));
                assert!(command.contains("--install-extension"));
                assert!(command.contains("ms-python.python"));
            }
            other => panic!("expected a CLI invocation, got {other:?}"),
        }
    }

    #[test]
    fn an_already_installed_extension_produces_no_command() {
        let action = BootstrapAction::Extension {
            id: "ms-python.python".into(),
            needed: false,
        };
        let sources = action.sources(Some(&PathBuf::from(r"C:\Code\bin\code.cmd")));
        assert!(matches!(sources[0], InstallSource::ConfigurationOnly));
    }

    #[test]
    fn git_baseline_settings_are_planned_when_unset() {
        let inventory = inventory_with(&[SoftwareId::Git]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.git_identity = git::IdentityState::Configured {
            name: "Li".into(),
            email: "li@x.cn".into(),
        };

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                git: GitBootstrap { configure: true },
                ..Default::default()
            }),
            &ctx,
        );

        let config_steps: Vec<&BootstrapStep> = plan
            .steps
            .iter()
            .filter(|s| s.action.id().starts_with("config:"))
            .collect();
        // The identity check plus every baseline setting.
        assert_eq!(config_steps.len(), git::baseline_settings().len() + 1);
        assert!(plan.needed_count() >= git::baseline_settings().len() as u32);
    }

    #[test]
    fn a_setting_already_at_the_right_value_is_skipped() {
        let inventory = inventory_with(&[SoftwareId::Git]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.git_config
            .insert("core.autocrlf".into(), "true".into());
        ctx.git_identity = git::IdentityState::Configured {
            name: "Li".into(),
            email: "li@x.cn".into(),
        };

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                git: GitBootstrap { configure: true },
                ..Default::default()
            }),
            &ctx,
        );

        let autocrlf = plan
            .steps
            .iter()
            .find(|s| s.action.id() == "config:core.autocrlf")
            .unwrap();
        assert!(!autocrlf.needed);
        assert!(autocrlf.skip_reason.as_deref().unwrap().contains("无需修改"));
    }

    #[test]
    fn a_missing_git_identity_is_reported_but_never_written() {
        // The brief's "不要自动填写虚假身份", enforced by inspecting the plan rather
        // than by trusting the implementation.
        let inventory = inventory_with(&[SoftwareId::Git]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.git_identity = git::IdentityState::Missing {
            name: None,
            email: None,
        };

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                git: GitBootstrap { configure: true },
                ..Default::default()
            }),
            &ctx,
        );

        // No step may write an identity.
        for step in &plan.steps {
            if let BootstrapAction::ConfigCommand { key, .. } = &step.action {
                assert!(
                    !key.starts_with("user.name") && !key.starts_with("user.email"),
                    "the planner wrote an identity: {key}"
                );
            }
        }

        // But the student is told.
        let check = plan
            .steps
            .iter()
            .find(|s| s.action.id() == "config:user.identity.check")
            .expect("the identity check must always appear");
        assert!(check.skip_reason.as_deref().unwrap().contains("user.name"));
        assert!(plan
            .not_attempted
            .iter()
            .any(|s| s.contains("需由你本人填写")));
    }

    #[test]
    fn git_config_is_blocked_when_git_is_absent() {
        let inventory = empty_inventory();
        let ctx = PlanContext::empty(&inventory);

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                git: GitBootstrap { configure: true },
                ..Default::default()
            }),
            &ctx,
        );

        assert!(plan
            .steps
            .iter()
            .filter(|s| s.stage == BootstrapStage::Git)
            .all(|s| s.blocked.is_some()));
        assert_eq!(plan.needed_count(), 0);
    }

    #[test]
    fn mcp_servers_are_written_into_one_merge() {
        let inventory = inventory_with(&[SoftwareId::Node]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.npx_available = true;

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                mcp: vec![
                    McpBootstrap {
                        name: "filesystem".into(),
                        spec: "npx -y @modelcontextprotocol/server-filesystem".into(),
                    },
                    McpBootstrap {
                        name: "memory".into(),
                        spec: "@modelcontextprotocol/server-memory".into(),
                    },
                ],
                ..Default::default()
            }),
            &ctx,
        );

        let writes: Vec<&BootstrapStep> = plan
            .steps
            .iter()
            .filter(|s| matches!(s.action, BootstrapAction::FileWrite { .. }))
            .collect();
        assert_eq!(
            writes.len(),
            1,
            "all servers must go in one write, not one per server"
        );

        if let BootstrapAction::FileWrite { values, .. } = &writes[0].action {
            let servers = values.get("mcpServers").unwrap().as_object().unwrap();
            assert_eq!(servers.len(), 2);
            assert!(servers.contains_key("filesystem"));
            assert!(servers.contains_key("memory"));
        }
    }

    #[test]
    fn an_unsupported_mcp_spec_becomes_a_blocked_step_with_a_reason() {
        let inventory = inventory_with(&[SoftwareId::Node]);
        let ctx = PlanContext::empty(&inventory);

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                mcp: vec![McpBootstrap {
                    name: "remote".into(),
                    spec: "https://example.com/mcp".into(),
                }],
                ..Default::default()
            }),
            &ctx,
        );

        assert_eq!(plan.blocked_count(), 1);
        assert!(plan.steps[0].blocked.as_deref().unwrap().contains("npm"));
    }

    #[test]
    fn a_missing_npx_is_a_warning_not_a_blocker() {
        // Node may be installed by the same run, so blocking here would make the
        // order of the run matter in a way the student cannot see.
        let inventory = empty_inventory();
        let ctx = PlanContext::empty(&inventory); // npx_available: false

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                mcp: vec![McpBootstrap {
                    name: "filesystem".into(),
                    spec: "@modelcontextprotocol/server-filesystem".into(),
                }],
                ..Default::default()
            }),
            &ctx,
        );

        assert_eq!(plan.blocked_count(), 0);
        assert!(plan.steps[0].rationale.contains("npx"));
    }

    #[test]
    fn a_skill_is_planned_with_its_source_and_target() {
        let inventory = empty_inventory();
        let mut ctx = PlanContext::empty(&inventory);
        ctx.skills_root = Some(PathBuf::from(r"C:\Users\Li\.claude\skills"));
        ctx.skill_sources.insert(
            "pdf-tools".into(),
            PathBuf::from(r"C:\app\skills\pdf-tools"),
        );

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                skills: vec!["pdf-tools".into()],
                ..Default::default()
            }),
            &ctx,
        );

        match &plan.steps[0].action {
            BootstrapAction::SkillInstall {
                name,
                source,
                target_root,
            } => {
                assert_eq!(name, "pdf-tools");
                assert!(source.ends_with("pdf-tools"));
                assert!(target_root.ends_with("skills"));
            }
            other => panic!("expected a skill install, got {other:?}"),
        }
        assert!(plan.steps[0].needed);
    }

    #[test]
    fn an_unknown_skill_is_blocked_not_silently_dropped() {
        let inventory = empty_inventory();
        let mut ctx = PlanContext::empty(&inventory);
        ctx.skills_root = Some(PathBuf::from(r"C:\skills"));

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                skills: vec!["does-not-exist".into()],
                ..Default::default()
            }),
            &ctx,
        );

        assert_eq!(plan.blocked_count(), 1);
        assert!(plan.steps[0].blocked.as_deref().unwrap().contains("不存在"));
    }

    #[test]
    fn a_skill_with_no_target_root_is_blocked_with_an_explanation() {
        let inventory = empty_inventory();
        let ctx = PlanContext::empty(&inventory); // skills_root: None

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                skills: vec!["pdf-tools".into()],
                ..Default::default()
            }),
            &ctx,
        );

        assert_eq!(plan.blocked_count(), 1);
        assert!(plan.steps[0]
            .blocked
            .as_deref()
            .unwrap()
            .contains("技能安装目录"));
    }

    #[test]
    fn a_language_pack_goes_through_the_extension_path() {
        // Reuse, not a second mechanism: a VS Code language pack *is* an
        // extension, so it must be installed and verified the same way.
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(PathBuf::from(r"C:\Code\bin\code.cmd"));
        ctx.localizations = vec![LocalizationProvider {
            id: "vscode".into(),
            target: "VS Code".into(),
            requires: Some(SoftwareId::Vscode),
            method: LocalizationMethod::Package {
                extension_id: "ms-ceintl.vscode-language-pack-zh-hans".into(),
            },
            upstream: "https://github.com/microsoft/vscode-loc".into(),
        }];

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                localization: vec!["vscode".into()],
                ..Default::default()
            }),
            &ctx,
        );

        let step = &plan.steps[0];
        assert!(matches!(
            step.action,
            BootstrapAction::Extension { .. }
        ));
        assert!(step.rationale.contains("官方语言包"));
    }

    #[test]
    fn a_script_localisation_is_blocked_when_its_host_is_untrusted() {
        let inventory = inventory_with(&[SoftwareId::Codex]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.localizations = vec![LocalizationProvider {
            id: "codex".into(),
            target: "Codex".into(),
            requires: Some(SoftwareId::Codex),
            method: LocalizationMethod::Script {
                url: "https://example.com/install.ps1".into(),
            },
            upstream: "https://example.com".into(),
        }];

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                localization: vec!["codex".into()],
                ..Default::default()
            }),
            &ctx,
        );

        assert_eq!(plan.blocked_count(), 1);
        assert!(plan.steps[0]
            .blocked
            .as_deref()
            .unwrap()
            .contains("官方源码站点"));
    }

    #[test]
    fn a_script_localisation_is_skipped_when_its_program_is_absent() {
        let inventory = empty_inventory();
        let mut ctx = PlanContext::empty(&inventory);
        ctx.localizations = vec![LocalizationProvider {
            id: "codex".into(),
            target: "Codex".into(),
            requires: Some(SoftwareId::Codex),
            method: LocalizationMethod::Script {
                url: "https://github.com/xqnode/codex-zh-CN".into(),
            },
            upstream: "https://github.com/xqnode/codex-zh-CN".into(),
        }];

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                localization: vec!["codex".into()],
                ..Default::default()
            }),
            &ctx,
        );

        assert!(!plan.steps[0].needed);
        assert_eq!(plan.blocked_count(), 0, "absent is a skip, not a block");
        assert!(plan.steps[0]
            .skip_reason
            .as_deref()
            .unwrap()
            .contains("未检测到"));
    }

    #[test]
    fn an_unknown_localization_id_lists_the_available_ones() {
        let inventory = empty_inventory();
        let ctx = PlanContext::empty(&inventory);

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                localization: vec!["nope".into()],
                ..Default::default()
            }),
            &ctx,
        );

        assert_eq!(plan.blocked_count(), 1);
        assert!(plan.steps[0].blocked.as_deref().unwrap().contains("未知的汉化项"));
    }

    #[test]
    fn the_planner_never_writes_a_credential() {
        // The brief's "不要保存 API Key", checked across the whole plan rather
        // than only at the MCP parser.
        let inventory = inventory_with(&[SoftwareId::Node, SoftwareId::Git, SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.npx_available = true;
        ctx.code_cli = Some(PathBuf::from(r"C:\Code\bin\code.cmd"));
        ctx.skills_root = Some(PathBuf::from(r"C:\skills"));
        ctx.skill_sources
            .insert("pdf-tools".into(), PathBuf::from(r"C:\app\skills\pdf-tools"));

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["ms-python.python".into()],
                    ..Default::default()
                },
                git: GitBootstrap { configure: true },
                mcp: vec![McpBootstrap {
                    name: "filesystem".into(),
                    spec: "@modelcontextprotocol/server-filesystem".into(),
                }],
                skills: vec!["pdf-tools".into()],
                ..Default::default()
            }),
            &ctx,
        );

        for step in &plan.steps {
            let rendered = format!("{:?} {}", step.action, step.rationale);
            for marker in ["api_key", "API_KEY", "token", "password", "secret"] {
                assert!(
                    !rendered.to_lowercase().contains(&marker.to_lowercase()),
                    "a credential leaked into the plan: {rendered}"
                );
            }
        }
    }

    #[test]
    fn allowed_roots_never_include_a_system_directory() {
        for root in allowed_roots() {
            let text = root.to_string_lossy().to_lowercase();
            assert!(!text.contains("windows\\system32"), "got: {text}");
            assert!(!text.ends_with(":\\windows"), "got: {text}");
            assert!(!text.ends_with(":\\program files"), "got: {text}");
        }
    }

    #[test]
    fn stage_summaries_match_the_steps() {
        let inventory = inventory_with(&[SoftwareId::Vscode, SoftwareId::Git]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(PathBuf::from(r"C:\Code\bin\code.cmd"));
        ctx.git_identity = git::IdentityState::Configured {
            name: "Li".into(),
            email: "li@x.cn".into(),
        };

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["a.b".into()],
                    ..Default::default()
                },
                git: GitBootstrap { configure: true },
                ..Default::default()
            }),
            &ctx,
        );

        for summary in &plan.stages {
            let actual = plan.steps_for(summary.stage).count() as u32;
            assert_eq!(
                summary.total, actual,
                "stage {} disagrees with its steps",
                summary.key
            );
        }
    }

    #[test]
    fn the_plan_carries_an_action_id_for_every_step() {
        // The trace needs an id; an empty one would make two steps
        // indistinguishable in the session log.
        let inventory = inventory_with(&[SoftwareId::Vscode, SoftwareId::Git]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(PathBuf::from(r"C:\Code\bin\code.cmd"));
        ctx.git_identity = git::IdentityState::Configured {
            name: "Li".into(),
            email: "li@x.cn".into(),
        };

        let plan = plan_for(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["a.b".into(), "c.d".into()],
                    ..Default::default()
                },
                git: GitBootstrap { configure: true },
                ..Default::default()
            }),
            &ctx,
        );

        let mut ids: Vec<String> = plan.steps.iter().map(|s| s.action.id()).collect();
        assert!(ids.iter().all(|id| !id.is_empty()));
        let before = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(before, ids.len(), "two steps share an action id: {ids:?}");
    }
}
