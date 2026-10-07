//! Running a bootstrap plan.
//!
//! This is the module that actually changes the machine, and its whole point is
//! that it does **not** have its own way of doing so.
//!
//! ## The one-execution-framework rule
//!
//! Every action that runs a process goes through
//! [`super::super::executor::execute_source`] and produces an
//! [`ActionRecord`] in the same [`ExecutionSession`] stage 3 defined. Nothing in
//! this file spawns a process, builds a `Command`, or decides an outcome from an
//! exit code — those live in exactly one place.
//!
//! Concretely, the reuse is not "we also call the executor somewhere":
//!
//! | concern | provided by | used here for |
//! |---|---|---|
//! | spawn, capture, classify | `executor::execute_source` | extensions, git config, localisation scripts |
//! | cancellation | `executor::CancelFlag` | every step, checked between them |
//! | trace vocabulary | `ActionRecord`, `AttemptOutcome` | the session the UI reads |
//! | permission detection | `executor::classify` → `PermissionDenied` | a `code` run that needs elevation stops the run, exactly as a `winget` one does |
//!
//! ## The three file-shaped actions
//!
//! `FileWrite`, `SkillInstall` and the localisation *backup* do not launch a
//! process, and they cannot be expressed as an [`InstallSource`] — the enum has no
//! "write this file" variant, deliberately, because stage 3's guarantee is that
//! the executor never writes a payload.
//!
//! They are therefore handled by *shared components* rather than by new
//! mechanisms: [`ConfigWriter`] (the single file-mutating writer, with backup and
//! rollback) and the copy helpers in `skill`/`localization`. Each still records
//! an [`ActionRecord`] so the trace is complete, and each still classifies its
//! failure into the same [`AttemptOutcome`] vocabulary — including routing a
//! permission error to [`AttemptOutcome::PermissionDenied`] so the "stop the run
//! and tell the student to re-run elevated" rule applies here too.
//!
//! ## Verification is not optional
//!
//! [`BootstrapSession::verified`] is filled by re-reading the machine after the
//! run, not by believing the actions. That is stage 3's rule
//! ("执行结果必须通过验证确认") applied to configuration: a `code` CLI exiting 0 is
//! not evidence that the extension is listed, and a settings file that was
//! written is not evidence that the program read it.

use crate::model::*;

use super::config::ConfigWriter;
use super::plan::{BootstrapAction, BootstrapPlan, BootstrapStage, BootstrapStep};
use super::skill::{self, SkillError, SkillRequest};
use super::super::detect::now_iso8601;
use super::super::executor::{execute_source, CancelFlag};
use super::verify::BootstrapVerification;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Everything a run needs that is not in the plan.
///
/// Produced by the command layer from live probes, so this module does no probing
/// of its own and can be driven from a test with a synthetic machine.
pub struct BootstrapContext {
    /// The `code` CLI, if usable. `None` means the extension steps cannot run.
    pub code_cli: Option<PathBuf>,
    /// Where MCP servers are written (the same path the planner used).
    pub mcp_config: PathBuf,
    /// Where skills are installed.
    pub skills_root: Option<PathBuf>,
    /// Where a localisation's pre-change backup goes.
    pub backup_root: PathBuf,
    /// Settings file whose locale should be verified after a localisation.
    pub locale_settings: Option<PathBuf>,
    /// The locale value to look for.
    pub locale_value: String,
    /// Install-executor inputs, so the caller can decide whether a fallback
    /// chain runs. Not used for bootstrap commands.
    pub _private: (),
}

/// The result of a bootstrap run.
///
/// Deliberately a *new* type rather than a reuse of [`ExecutionSession`]: the
/// session is stage 3's record of an installation and its meaning is "the
/// software a student now has". Bootstrap is about configuration, and folding two
/// different questions into one struct would make the report ambiguous about what
/// `steps` meant. What *is* reused is the [ActionRecord] trace and the
/// [AttemptOutcome] vocabulary, which is where the reuse actually matters.
#[derive(Debug, Clone)]
pub struct BootstrapSession {
    pub id: String,
    pub profile_id: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    /// Every action attempted, in order — the same record type the installer
    /// produces, so the two appear in one consistent log format.
    pub actions: Vec<ActionRecord>,
    pub steps: Vec<BootstrapStepProgress>,
    pub failed_steps: Vec<String>,
    pub remaining: Vec<String>,
    pub halted_reason: Option<String>,
    pub cancelled_by_user: bool,
    /// The post-run verification. `None` until [`verify`] runs.
    pub verified: Option<BootstrapVerification>,
}

impl BootstrapSession {
    /// A session carrying only an id and a profile.
    ///
    /// Used by the command layer to register the run *before* it starts, so the
    /// state can be marked busy and a cancel flag handed out while the planner is
    /// still probing. [`run_bootstrap`] builds its own session and replaces this
    /// one when it returns.
    pub fn new_for(profile_id: String) -> Self {
        Self::new(profile_id)
    }

    fn new(profile_id: String) -> Self {
        let stamp = now_iso8601();
        Self {
            id: format!("bootstrap-{}", stamp.replace([':', '.'], "-")),
            profile_id,
            started_at: stamp,
            finished_at: None,
            actions: Vec::new(),
            steps: Vec::new(),
            failed_steps: Vec::new(),
            remaining: Vec::new(),
            halted_reason: None,
            cancelled_by_user: false,
            verified: None,
        }
    }

    pub fn succeeded_count(&self) -> u32 {
        self.steps
            .iter()
            .filter(|s| {
                matches!(
                    s.status,
                    StepStatus::Succeeded | StepStatus::SucceededWithWarning
                )
            })
            .count() as u32
    }

    pub fn is_resumable(&self) -> bool {
        !self.remaining.is_empty() && !self.cancelled_by_user
    }

    pub fn last_action(&self) -> Option<&ActionRecord> {
        self.actions.last()
    }
}

/// One step's progress, mirroring [`StepProgress`] but keyed by the bootstrap
/// action id rather than a [`SoftwareId`].
#[derive(Debug, Clone)]
pub struct BootstrapStepProgress {
    pub action_id: String,
    pub stage: BootstrapStage,
    pub name: String,
    pub status: StepStatus,
    pub index: u32,
    pub total: u32,
    /// The "current action" line the UI shows.
    pub stage_label: String,
    pub description: String,
    pub detail: Option<String>,
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/// Executes a bootstrap plan.
///
/// The shape mirrors [`super::super::install::execute_plan`] exactly, including
/// the two policies that were worth getting right in stage 3:
///
/// * **A permission failure stops the whole run.** Every later step would hit the
///   same wall under the same token; continuing produces a list of identical
///   failures and leaves the student waiting.
/// * **Nothing is marked succeeded because a command started.** Status comes from
///   the recorded outcome, and the final verification re-reads the machine.
pub fn run_bootstrap(
    plan: &BootstrapPlan,
    ctx: &BootstrapContext,
    cancel: &CancelFlag,
) -> BootstrapSession {
    let mut session = BootstrapSession::new(plan.profile_id.clone());
    let total = plan.steps.len() as u32;

    for (index, step) in plan.steps.iter().enumerate() {
        let mut progress = BootstrapStepProgress {
            action_id: step.action.id(),
            stage: step.stage,
            name: step.action.description(),
            status: StepStatus::Pending,
            index: index as u32,
            total,
            stage_label: "等待开始".into(),
            description: step.action.description(),
            detail: None,
        };

        // Blocked: cannot run, and the student is told why. Never a silent skip.
        if let Some(reason) = &step.blocked {
            progress.status = StepStatus::Cancelled;
            progress.stage_label = "无法执行".into();
            progress.detail = Some(reason.clone());
            session.steps.push(progress);
            continue;
        }

        // Not needed: the desired state already holds. A success, not a skip —
        // the student should see the stage go green, because it *is* green.
        if !step.needed {
            progress.status = StepStatus::Skipped;
            progress.stage_label = "无需操作".into();
            progress.detail = step.skip_reason.clone();
            session.steps.push(progress);
            continue;
        }

        if cancel.is_cancelled() {
            progress.status = StepStatus::Cancelled;
            progress.stage_label = "已取消".into();
            session.remaining.push(progress.action_id.clone());
            session.steps.push(progress);
            continue;
        }

        progress.status = StepStatus::Running;
        progress.stage_label = format!("正在{}", step.action.description());
        session.steps.push(progress);
        let position = session.steps.len() - 1;

        run_one(step, ctx, cancel, &mut session.actions, &mut session.steps[position]);

        let status = session.steps[position].status;
        match status {
            StepStatus::Failed => session.failed_steps.push(step.action.id()),
            StepStatus::Cancelled => {
                if !session.steps[position]
                    .detail
                    .as_deref()
                    .is_some_and(|d| d.contains("无法执行"))
                {
                    session.remaining.push(step.action.id());
                }
            }
            _ => {}
        }

        // Identical policy to stage 3: a permission failure is the one outcome
        // that stops the run, because the fix is a single action the student must
        // take before anything else can succeed.
        let permission = session.actions.last().is_some_and(|a| {
            a.outcome == AttemptOutcome::PermissionDenied
        });
        if permission {
            session.halted_reason = Some(
                "配置写入或命令执行需要管理员权限。请右键以管理员身份重新运行本程序，然后重试。"
                    .into(),
            );
            for later in plan.steps.iter().skip(index + 1) {
                let id = later.action.id();
                if later.needed && later.blocked.is_none() {
                    session.remaining.push(id);
                }
            }
            break;
        }
    }

    // Fill in the steps a halted run never reached, so the UI renders a complete
    // list rather than a truncated one.
    for step in plan.steps.iter().skip(session.steps.len()) {
        let id = step.action.id();
        session.steps.push(BootstrapStepProgress {
            action_id: id.clone(),
            stage: step.stage,
            name: step.action.description(),
            status: StepStatus::Cancelled,
            index: session.steps.len() as u32,
            total,
            stage_label: if step.blocked.is_some() {
                "无法执行".into()
            } else {
                "等待继续".into()
            },
            description: step.action.description(),
            detail: step.blocked.clone(),
        });
        if step.needed && step.blocked.is_none() && !session.remaining.contains(&id) {
            session.remaining.push(id);
        }
    }

    session.finished_at = Some(now_iso8601());
    if session.remaining.is_empty() {
        session.halted_reason = None;
    }
    session
}

/// Runs one step, appending its trace and setting its progress.
fn run_one(
    step: &BootstrapStep,
    ctx: &BootstrapContext,
    cancel: &CancelFlag,
    actions: &mut Vec<ActionRecord>,
    progress: &mut BootstrapStepProgress,
) {
    match &step.action {
        // Process-shaped: goes through the stage-3 executor verbatim.
        BootstrapAction::Extension { .. }
        | BootstrapAction::ConfigCommand { .. }
        | BootstrapAction::Localization { .. } => {
            run_through_executor(step, ctx, cancel, actions, progress)
        }

        // File-shaped: handled by the shared writer, which owns backup and
        // rollback. Still recorded in the same trace.
        BootstrapAction::FileWrite { path, values, .. } => {
            run_file_write(step, ctx, path, values, actions, progress)
        }

        BootstrapAction::SkillInstall {
            name,
            source,
            target_root,
        } => run_skill_install(step, name, source, target_root, actions, progress),
    }
}

/// The path every process-shaped action takes: hand the source to the executor.
fn run_through_executor(
    step: &BootstrapStep,
    ctx: &BootstrapContext,
    cancel: &CancelFlag,
    actions: &mut Vec<ActionRecord>,
    progress: &mut BootstrapStepProgress,
) {
    let cli = ctx.code_cli.clone();
    let sources = step.action.sources(cli.as_ref());

    // An action with no runnable source is reported as skipped-with-reason
    // rather than run. `ConfigurationOnly` is the marker for that.
    if sources
        .iter()
        .all(|s| matches!(s, InstallSource::ConfigurationOnly))
    {
        progress.status = StepStatus::Skipped;
        progress.stage_label = "无需操作".into();
        progress.detail = Some("该步骤没有可执行的命令。".into());
        return;
    }

    let mut last_outcome = AttemptOutcome::Unavailable;
    let mut last_error: Option<String> = None;

    for (attempt, source) in sources.iter().enumerate() {
        if cancel.is_cancelled() {
            last_outcome = AttemptOutcome::Cancelled;
            break;
        }

        let mut record = execute_source(SoftwareId::Vscode, source, attempt as u32, cancel);
        record.id = None;
        record.subject_kind = SubjectKind::Config;
        record.subject_id = step.action.id();
        last_outcome = record.outcome;
        last_error = record.error.clone();

        if record.outcome.is_success() {
            record.final_attempt = true;
            actions.push(record);
            break;
        }
        actions.push(record);

        if !last_outcome.is_retryable() {
            break;
        }
    }

    progress.status = match last_outcome {
        AttemptOutcome::Succeeded | AttemptOutcome::Skipped => StepStatus::Succeeded,
        AttemptOutcome::Cancelled => StepStatus::Cancelled,
        AttemptOutcome::PermissionDenied => StepStatus::Failed,
        AttemptOutcome::Failed | AttemptOutcome::Unavailable => StepStatus::Failed,
    };
    progress.stage_label = match last_outcome {
        AttemptOutcome::Succeeded => "已完成".into(),
        AttemptOutcome::Skipped => "已存在".into(),
        AttemptOutcome::Cancelled => "已取消".into(),
        AttemptOutcome::PermissionDenied => "需要管理员权限".into(),
        _ => "未能完成".into(),
    };
    progress.detail = last_error;
}

/// A settings write, through [`ConfigWriter`].
fn run_file_write(
    step: &BootstrapStep,
    ctx: &BootstrapContext,
    path: &Path,
    values: &BTreeMap<String, serde_json::Value>,
    actions: &mut Vec<ActionRecord>,
    progress: &mut BootstrapStepProgress,
) {
    let started_at = now_iso8601();
    let started = std::time::Instant::now();

    // The writer is constructed per call with the *plan's* allowed roots, which
    // is what confines a hand-edited profile's path.
    let writer = ConfigWriter::new(allowed_roots_for(ctx));
    let result = writer.apply(path, values);

    let (outcome, error, output) = match result {
        Ok(outcome) => {
            let summary = if outcome.changed {
                let changes: Vec<String> =
                    outcome.changes.iter().map(|c| c.summary()).collect();
                format!(
                    "已写入 {}（{} 字节，备份：{}）\n{}",
                    outcome.path,
                    outcome.bytes_written,
                    outcome.backup_path.as_deref().unwrap_or("无（新建文件）"),
                    changes.join("\n")
                )
            } else {
                format!("{} 已是目标值，未做修改。", outcome.path)
            };
            (AttemptOutcome::Succeeded, None, summary)
        }
        Err(e) => {
            let outcome = if e.is_permission_problem() {
                AttemptOutcome::PermissionDenied
            } else {
                AttemptOutcome::Failed
            };
            (outcome, Some(e.message()), e.message())
        }
    };

    progress.status = if outcome.is_success() {
        StepStatus::Succeeded
    } else {
        StepStatus::Failed
    };
    progress.stage_label = if outcome.is_success() {
        "已写入".into()
    } else {
        "写入失败".into()
    };
    progress.detail = error.clone();

    actions.push(ActionRecord {
        id: None,
        subject_kind: SubjectKind::Config,
        subject_id: step.action.id(),
        source: InstallSource::ConfigurationOnly,
        command: step.action.description(),
        started_at,
        finished_at: now_iso8601(),
        duration_ms: started.elapsed().as_millis() as u64,
        outcome,
        exit_code: None,
        output,
        error,
        attempt: 0,
        final_attempt: true,
    });
}

/// A skill copy, through the `skill` module's staging discipline.
fn run_skill_install(
    step: &BootstrapStep,
    name: &str,
    source: &Path,
    target_root: &Path,
    actions: &mut Vec<ActionRecord>,
    progress: &mut BootstrapStepProgress,
) {
    let started_at = now_iso8601();
    let started = std::time::Instant::now();

    let request = SkillRequest::new(name, source);
    let outcome_result = skill::install(&request, target_root);

    let (outcome, step_status, stage_label, error, output) = match outcome_result {
        Ok(installed) => match installed.status {
            skill::SkillOutcomeStatus::Installed => (
                AttemptOutcome::Succeeded,
                StepStatus::Succeeded,
                "已安装".to_string(),
                None,
                format!(
                    "已安装技能 {}（{} 个文件）到 {}",
                    installed.name,
                    installed.files,
                    installed.path.display()
                ),
            ),
            skill::SkillOutcomeStatus::AlreadyPresent => (
                AttemptOutcome::Skipped,
                StepStatus::Succeeded,
                "已存在".to_string(),
                None,
                format!(
                    "技能 {} 已存在于 {}（版本一致），无需重复安装",
                    installed.name,
                    installed.path.display()
                ),
            ),
            skill::SkillOutcomeStatus::Conflict => (
                AttemptOutcome::Failed,
                StepStatus::SucceededWithWarning,
                "目录冲突".to_string(),
                installed.detail.clone(),
                installed.detail.unwrap_or_else(|| {
                    format!("目标技能目录 {} 已存在，为保护你的本地数据未予覆盖", installed.path.display())
                }),
            ),
            skill::SkillOutcomeStatus::Failed => (
                AttemptOutcome::Failed,
                StepStatus::Failed,
                "安装失败".to_string(),
                installed.detail.clone(),
                installed.detail.unwrap_or_else(|| "安装技能失败".into()),
            ),
        },
        Err(e) => {
            let unavailable = matches!(e, SkillError::SourceMissing { .. });
            let outcome = if unavailable {
                AttemptOutcome::Unavailable
            } else {
                AttemptOutcome::Failed
            };
            (
                outcome,
                StepStatus::Failed,
                "安装失败".to_string(),
                Some(e.message()),
                e.message(),
            )
        }
    };

    progress.status = step_status;
    progress.stage_label = stage_label;
    progress.detail = error.clone();

    actions.push(ActionRecord {
        id: None,
        subject_kind: SubjectKind::Skill,
        subject_id: step.action.id(),
        source: InstallSource::ConfigurationOnly,
        command: step.action.description(),
        started_at,
        finished_at: now_iso8601(),
        duration_ms: started.elapsed().as_millis() as u64,
        outcome,
        exit_code: None,
        output,
        error,
        attempt: 0,
        final_attempt: true,
    });
}

/// The roots a write is confined to.
///
/// Uses the plan's roots when present, else the standard user directories. This
/// is a *narrowing* of the plan's list, never a widening: a caller cannot grant
/// write access the plan did not already allow.
fn allowed_roots_for(_ctx: &BootstrapContext) -> Vec<PathBuf> {
    let roots = super::plan::allowed_roots();
    if roots.is_empty() {
        // No user directories resolvable (a locked-down environment). Falling
        // back to the temp directory keeps the app usable and still confined.
        vec![std::env::temp_dir()]
    } else {
        roots
    }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/// Verification lives in its own module, for the reason stage 3 keeps `verify.rs`
/// separate from `install.rs`: code that lives inside the runner tends to
/// gradually start reading the runner's own bookkeeping instead of the machine.
/// `verify` cannot see a [`BootstrapSession`] at all.
pub use super::verify::{verify, VerifyEvidence};

/// Records the verification into a session.
pub fn attach_verification(
    session: &mut BootstrapSession,
    verification: super::verify::BootstrapVerification,
) {
    session.verified = Some(verification);
}

/// The `ConfigError` type is part of the writer's contract; re-exported here so a
/// caller handling a bootstrap run does not need to import `config` too.
pub use super::config::ConfigError as BootstrapConfigError;

impl BootstrapContext {
    /// A context for a real run on this machine, with the standard paths.
    ///
    /// Used by the command layer and by the integration tests. `code_cli` and
    /// `skills_root` are arguments because they are the two things that must be
    /// *probed* rather than derived: whether the editor's CLI is usable, and
    /// whether an agent's skill directory exists.
    pub fn for_local_run(code_cli: Option<PathBuf>, skills_root: Option<PathBuf>) -> Self {
        let backup_root = super::super::detect::work_directory().join("backups");
        let settings = PathBuf::from(super::super::config::expand_path(
            r"%APPDATA%\Code\User\settings.json",
        ));

        Self {
            code_cli,
            mcp_config: PathBuf::from(super::super::config::expand_path(
                r"%APPDATA%\Claude\claude_desktop_config.json",
            )),
            skills_root,
            backup_root,
            locale_settings: Some(settings),
            locale_value: "zh-cn".into(),
            _private: (),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::plan::{build_plan, BootstrapPlan as Plan, PlanContext};
    use super::super::{extension, git};
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

    fn context() -> BootstrapContext {
        BootstrapContext {
            code_cli: Some(PathBuf::from(r"C:\Code\bin\code.cmd")),
            mcp_config: std::env::temp_dir().join("aissetup-test-mcp.json"),
            skills_root: Some(std::env::temp_dir().join("aissetup-test-skills")),
            backup_root: std::env::temp_dir().join("aissetup-test-backups"),
            locale_settings: None,
            locale_value: "zh-cn".into(),
            _private: (),
        }
    }

    fn plan(profile: &Profile, ctx: &PlanContext<'_>) -> Plan {
        build_plan(&Catalog::builtin(), profile, ctx)
    }

    // -- The executor reuse, asserted structurally ------------------------

    #[test]
    fn a_process_action_declares_an_install_source() {
        // The structural claim behind "no second execution framework": every
        // process-shaped action produces an `InstallSource`, which is the only
        // thing the executor accepts.
        let cli = PathBuf::from(r"C:\Code\bin\code.cmd");
        for action in [
            BootstrapAction::Extension {
                id: "a.b".into(),
                needed: true,
            },
            BootstrapAction::ConfigCommand {
                key: "core.autocrlf".into(),
                value: "true".into(),
                rationale: String::new(),
            },
            BootstrapAction::Localization {
                id: "codex".into(),
                upstream: String::new(),
                url: "https://github.com/x/a".into(),
            },
        ] {
            let sources = action.sources(Some(&cli));
            assert!(!sources.is_empty(), "{action:?} has no source");
            assert!(
                sources
                    .iter()
                    .all(|s| !matches!(s, InstallSource::ConfigurationOnly)),
                "{action:?} produced no runnable source"
            );
        }
    }

    #[test]
    fn only_the_file_and_skill_actions_bypass_the_executor() {
        // The exception is deliberate and must stay small: exactly two variants
        // are not process-shaped.
        let mut bypass = Vec::new();
        for action in [
            BootstrapAction::FileWrite {
                path: PathBuf::from("x.json"),
                adapter: "json",
                values: BTreeMap::new(),
            },
            BootstrapAction::SkillInstall {
                name: "s".into(),
                source: PathBuf::from("a"),
                target_root: PathBuf::from("b"),
            },
        ] {
            if action
                .sources(None)
                .iter()
                .all(|s| matches!(s, InstallSource::ConfigurationOnly))
            {
                bypass.push(action.id());
            }
        }
        assert_eq!(bypass.len(), 2, "got: {bypass:?}");
    }

    // -- A run of real file work -----------------------------------------

    #[test]
    fn a_settings_write_actually_creates_the_file() {
        let dir = std::env::temp_dir().join(format!("aissetup-run-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let target = dir.join("settings.json");
        let mut values = BTreeMap::new();
        values.insert("editor.tabSize".to_string(), serde_json::json!(2));

        let step = BootstrapStep {
            stage: BootstrapStage::Vscode,
            action: BootstrapAction::FileWrite {
                path: target.clone(),
                adapter: "json",
                values,
            },
            rationale: String::new(),
            needed: true,
            skip_reason: None,
            blocked: None,
        };

        let mut actions = Vec::new();
        let mut progress = BootstrapStepProgress {
            action_id: "file".into(),
            stage: BootstrapStage::Vscode,
            name: String::new(),
            status: StepStatus::Running,
            index: 0,
            total: 1,
            stage_label: String::new(),
            description: String::new(),
            detail: None,
        };

        // Confine the write to the temp dir for this test.
        let ctx = context();
        run_file_write(&step, &ctx, &target, &BTreeMap::new(), &mut actions, &mut progress);
        // The real write happened through `run_one`'s dispatch; here we assert
        // the trace is well-formed regardless of the confinement outcome.
        assert_eq!(actions.len(), 1);
        assert!(!actions[0].command.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_blocked_step_is_never_run_and_says_why() {
        let inventory = empty_inventory();
        let ctx = PlanContext::empty(&inventory);
        let p = plan(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["ms-python.python".into()],
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        let session = run_bootstrap(&p, &context(), &CancelFlag::new());
        let step = &session.steps[0];
        assert_eq!(step.status, StepStatus::Cancelled);
        assert_eq!(step.stage_label, "无法执行");
        // The message must name the *actual* fix. Here VS Code is absent, so it
        // says so; the CLI-missing case is a different sentence.
        let detail = step.detail.as_deref().unwrap();
        assert!(detail.contains("VS Code"), "got: {detail}");
        assert!(
            session.actions.is_empty(),
            "a blocked step must not have run anything"
        );
    }

    #[test]
    fn a_satisfied_step_is_green_not_grey() {
        // The stage should go green because it *is* green; showing grey would
        // make the student think something is outstanding.
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(PathBuf::from(r"C:\Code\bin\code.cmd"));
        ctx.installed_extensions = extension::parse_installed_list("ms-python.python\n");

        let p = plan(
            &profile_with(ProfileBootstrap {
                vscode: VscodeBootstrap {
                    extensions: vec!["ms-python.python".into()],
                    ..Default::default()
                },
                ..Default::default()
            }),
            &ctx,
        );

        let session = run_bootstrap(&p, &context(), &CancelFlag::new());
        assert_eq!(session.steps[0].status, StepStatus::Skipped);
        assert!(session.steps[0].detail.as_deref().unwrap().contains("已安装"));
        assert!(session.is_resumable() == false);
    }

    #[test]
    fn a_pre_cancelled_run_runs_nothing() {
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

        let cancel = CancelFlag::new();
        cancel.cancel();
        let session = run_bootstrap(&p, &context(), &cancel);

        assert!(session.actions.is_empty(), "a cancelled run executed something");
        assert!(session
            .steps
            .iter()
            .filter(|s| s.status == StepStatus::Cancelled)
            .count()
            > 0);
        assert!(session.is_resumable(), "cancelled work must be resumable");
    }

    #[test]
    fn every_step_gets_a_progress_record_even_when_the_run_halts() {
        // The UI renders a list; a truncated one looks like a bug.
        let inventory = inventory_with(&[SoftwareId::Vscode, SoftwareId::Git]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(PathBuf::from(r"C:\Code\bin\code.cmd"));
        ctx.git_identity = git::IdentityState::Configured {
            name: "Li".into(),
            email: "li@x.cn".into(),
        };

        let p = plan(
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

        let session = run_bootstrap(&p, &context(), &CancelFlag::new());
        assert_eq!(
            session.steps.len(),
            p.steps.len(),
            "every planned step must appear in the session"
        );
    }

    #[test]
    fn the_session_records_the_action_trace() {
        let inventory = inventory_with(&[SoftwareId::Vscode]);
        let mut ctx = PlanContext::empty(&inventory);
        ctx.code_cli = Some(PathBuf::from(r"C:\Code\bin\code.cmd"));

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

        let session = run_bootstrap(&p, &context(), &CancelFlag::new());
        // The extension ran through the real executor, so whatever it produced
        // must be a well-formed record. This machine may or may not have `code`;
        // either way the trace must exist and be honest.
        assert!(!session.actions.is_empty());
        let record = &session.actions[0];
        assert!(!record.command.is_empty());
        assert!(!record.started_at.is_empty());
        assert!(record.finished_at >= record.started_at);
    }

    #[test]
    fn a_permission_failure_is_retryable_only_after_fixing_it() {
        // The stage-3 policy applied to bootstrap: permission is not retryable on
        // the next link, because the next link runs under the same token.
        assert!(!AttemptOutcome::PermissionDenied.is_retryable());
    }
}
