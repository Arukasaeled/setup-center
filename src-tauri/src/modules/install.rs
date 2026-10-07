//! Installation engine and per-software installers.
//!
//! Design rules enforced here (from the brief):
//! * **Never maintain our own binaries.** [`InstallSource`] has no variant for a
//!   bundled payload; the code must go through winget or a vendor installer.
//! * **Fallback, not failure.** Each installer declares an ordered chain. The
//!   engine walks it and only reports failure when the whole chain is exhausted —
//!   the `claude-code-toolbox` idea.
//! * **Stage 2 scope.** Planning is real and now reads the merged inventory: a
//!   program the student already has is planned as satisfied. Execution is
//!   modelled and reported, but the commands themselves land in stage 3.
//!
//! The chains are *derived from the catalog* rather than restated here. Before
//! stage 2 this file held its own copy of every package id, which meant the
//! detector and the installer could disagree about what "VS Code" is. There is
//! now one definition, and this module is a view of it.

use crate::model::*;

use super::catalog::{Catalog, StrategySource};
use super::detect::now_iso8601;
use super::executor::{execute_source, execute_source_with_policy, execute_source_with_context, ExecutionContext, CancelFlag};
use serde::{Deserialize, Serialize};

/// One link in a fallback chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fallback {
    pub source: InstallSource,
    /// Why this step exists, in user-facing Chinese.
    pub rationale: String,
}

/// Everything the engine needs to know about one installable program.
///
/// This is a *trait-free* description on purpose. Installers differ only in data
/// (which winget id, which fallback order), so a trait with 7 impls would add
/// indirection without adding behaviour.
pub struct InstallerSpec {
    pub id: SoftwareId,
    /// Ordered strategies; index 0 is preferred.
    pub chain: Vec<Fallback>,
}

/// Builds the installer description for a program from the catalog.
pub fn spec_for(id: SoftwareId) -> InstallerSpec {
    spec_from(&Catalog::builtin(), id)
}

pub fn spec_from(catalog: &Catalog, id: SoftwareId) -> InstallerSpec {
    let entry = catalog.entry(id);
    InstallerSpec {
        id,
        chain: entry
            .install
            .iter()
            .map(|strategy| Fallback {
                source: match &strategy.source {
                    StrategySource::Winget(package_id) => InstallSource::Winget {
                        package_id: package_id.to_string(),
                    },
                    StrategySource::OfficialInstaller { url, kind, vendor_id } => InstallSource::OfficialInstaller {
                        url: url.to_string(),
                        // No pinned digest: these are vendor "latest" endpoints,
                        // where a hard-coded hash would be wrong within days. The
                        // field exists so a pinned build can be added later
                        // without a schema change.
                        sha256: None,
                        kind: Some(*kind),
                        vendor_id: Some(vendor_id.to_string()),
                    },
                    StrategySource::Command { command, program_kind, args } => InstallSource::Script {
                        command: command.to_string(),
                        program_kind: Some(*program_kind),
                        args: Some(args.iter().map(|s| s.to_string()).collect()),
                    },
                },
                rationale: strategy.rationale.to_string(),
            })
            .collect(),
    }
}

/// Builds an execution plan: everything the profile asks for, annotated with
/// whether it is already satisfied.
///
/// `existing` is the merged inventory from the Software Intelligence Layer. A
/// program counts as satisfied only when a provider found it, the file was
/// confirmed on disk, and it reports a version. "Exists somewhere on disk" is not
/// enough — that is the classic case where the student still cannot run it — and
/// neither is "winget has a record of it", which survives uninstalls.
pub fn build_plan(catalog: &Catalog, profile: &Profile, existing: &SoftwareScan) -> InstallPlan {
    build_plan_with(
        catalog,
        &profile.id,
        Some(profile.estimated_minutes),
        &profile.software,
        existing,
    )
}

/// The plan builder, over an explicit list of programs.
///
/// This is the whole of [`build_plan`] generalised: the profile path is a call
/// with `profile.software`, and the "install exactly what the student ticked"
/// path is a call with the ticked ids. Keeping one implementation is the point —
/// there is no second place where an `InstallSource` is decided, so the profile
/// plan and a hand-picked plan can never disagree about *how* a program
/// installs.
///
/// Two things are deliberately *not* derived from `ids`:
///
/// * `profile_id` — the scenario the student started from, carried into the
///   session and the report. It may be empty; nothing here reads it.
/// * `estimated_minutes` — `None` means "no profile to quote a number from", and
///   the caller (or the UI) scales or omits the estimate rather than inventing
///   one from a program count.
pub fn build_plan_with(
    catalog: &Catalog,
    profile_id: &str,
    estimated_minutes: Option<u32>,
    ids: &[SoftwareId],
    existing: &SoftwareScan,
) -> InstallPlan {
    let mut steps: Vec<InstallStep> = Vec::new();
    let frozen_policy = super::storage::load_effective_policy();

    for id in ids {
        let spec = spec_from(catalog, *id);
        let found = existing.find(*id);

        let satisfied = matches!(
            found,
            Some(item) if item.installed
                && item.on_path
                && item.version.is_some()
                && item.confidence == Confidence::Ok
        );

        // When the machine already reports a package id for this program, reuse
        // it. Installing `Python.Python.3.12` on a machine that has
        // `Python.Python.3.13` registered would add a second interpreter rather
        // than upgrade the existing one.
        //
        // The chain is empty for detect-only programs (Docker, WSL, JetBrains…).
        // Indexing it would panic, so the empty case is handled explicitly: the
        // step becomes `ConfigurationOnly`, which the executor already treats as
        // a no-op, and `fallback_plan` below explains that nothing will be
        // installed. A profile that names such a program therefore produces an
        // honest, harmless step instead of crashing the planner.
        let source = found
            .and_then(|item| item.package_id.as_deref())
            .map(|package_id| InstallSource::Winget {
                package_id: package_id.to_string(),
            })
            .unwrap_or_else(|| {
                spec.chain
                    .first()
                    .map(|f| f.source.clone())
                    .unwrap_or(InstallSource::ConfigurationOnly)
            });

        // A detect-only program gets an explicit rationale rather than an empty
        // list, so the UI has something to show instead of a blank row.
        let fallback_plan: Vec<String> = if spec.chain.is_empty() {
            vec![format!(
                "{} 需要你手动安装：本工具只检测，不会替你更改系统组件。",
                id.display_name()
            )]
        } else {
            spec.chain.iter().map(|f| f.rationale.clone()).collect()
        };

        let entry = catalog.entry(*id);
        let location_support = Some(entry.install_location);
        let expected_location = if entry.install_location == InstallLocationSupport::WingetLocation {
            frozen_policy.resolved_root.as_ref().map(|root| {
                if let Some(sub) = entry.storage_subdir {
                    let clean = root.trim_end_matches(['\\', '/']);
                    format!("{clean}\\{sub}")
                } else {
                    root.clone()
                }
            })
        } else {
            None
        };

        steps.push(InstallStep {
            id: *id,
            name: id.display_name().to_string(),
            source,
            fallback_plan,
            satisfied,
            location_support,
            expected_location,
        });
    }

    let satisfied_count = steps.iter().filter(|s| s.satisfied).count() as u32;
    let ready_count = steps.len() as u32 - satisfied_count;

    InstallPlan {
        profile_id: profile_id.to_string(),
        steps,
        ready_count,
        satisfied_count,
        estimated_minutes,
        storage_policy: Some(frozen_policy),
    }
}

/// Produces the progress stream the UI consumes, without performing
/// installations.
///
/// Deliberately *not* a fake success: every step ends as [`StepStatus::Skipped`]
/// with an explicit reason. The UI shows the real progress widget, and the report
/// records that nothing was installed, so this build can never be mistaken for a
/// working installer.
pub fn simulate_plan(plan: &InstallPlan) -> Vec<StepProgress> {
    let total = plan.steps.len() as u32;
    plan.steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let (status, stage) = if step.satisfied {
                (StepStatus::Skipped, "已检测到，无需安装".to_string())
            } else {
                (StepStatus::Skipped, "安装引擎将在第三阶段接入".to_string())
            };
            StepProgress {
                step_id: step.id,
                name: step.name.clone(),
                status,
                index: index as u32,
                total,
                stage,
                fraction: None,
                detail: Some(format!("首选方式：{}", describe_source(&step.source))),
                availability: None,
                action_outcome: None,
            }
        })
        .collect()
}

pub fn describe_source(source: &InstallSource) -> String {
    match source {
        InstallSource::Winget { package_id } => format!("winget install --id {package_id}"),
        InstallSource::OfficialInstaller { url, .. } => format!("官方安装包 {url}"),
        InstallSource::Script { command, .. } => command.clone(),
        InstallSource::ConfigurationOnly => "仅写入配置".to_string(),
    }
}

/// Is `winget` present and usable on this machine?
pub fn winget_available() -> Result<String, AppError> {
    match super::detect::run_capture("winget", &["--version"]) {
        Ok(text) if !text.trim().is_empty() => {
            // `winget --version` prints a `v` prefix on current builds; strip it
            // so the diagnostics panel shows a bare version number.
            Ok(text.trim().trim_start_matches(['v', 'V']).to_string())
        }
        Ok(_) => Err(AppError::WingetUnavailable {
            reason: "winget 未返回版本信息".into(),
        }),
        Err(e) => Err(AppError::WingetUnavailable {
            reason: e.to_string(),
        }),
    }
}

// ---------------------------------------------------------------------------
// Stage 3: the Execution Engine
// ---------------------------------------------------------------------------

/// Executes a plan, recording everything, and verifies the result by re-scanning.
///
/// The shape of a run
/// ------------------
/// ```text
/// for each step in plan:
///     if satisfied        → Skipped, no action
///     for each link in the catalog's fallback chain:
///         execute_source(...)
///         record the attempt
///         stop at the first success
///     re-scan the machine for this program  → real verification, not a claim
/// ```
///
/// Three properties the brief requires, and how each is obtained:
///
/// * **可追踪 (traceable)** — every attempt becomes an [`ActionRecord`] with its
///   command, start time, duration, exit code and output. The session is the
///   trace; nothing is summarised away.
/// * **可失败 (can fail)** — a step's status comes from an actual exit code, and
///   the verification pass re-reads the machine rather than trusting the
///   installer's own report. A step is never marked succeeded because a command
///   was *started*.
/// * **可恢复 (recoverable)** — the run stops in a state where what remains is
///   known: [`ExecutionSession::remaining`] lists the steps worth retrying, and
///   [`resume_plan`] starts from exactly those. A step whose program turned out
///   to be present (perhaps the failed attempt installed it before erroring) is
///   detected by the re-scan and dropped from `remaining`.
///
/// The verification re-scan is what makes this honest. `winget` exiting 0 does
/// not mean the program is usable: it may have installed somewhere not on PATH,
/// or installed a different Python next to the existing one. Only re-probing all
/// three providers can tell the student what they actually have.
pub fn task_document_path() -> std::path::PathBuf {
    super::detect::work_directory().join("tasks").join("active_task.json")
}

pub fn save_task_document(doc: &TaskDocumentV1) -> Result<(), String> {
    let path = task_document_path();
    let json = serde_json::to_vec_pretty(doc).map_err(|e| format!("序列化任务文档失败：{e}"))?;
    super::atomic_file::write_atomic(&path, &json).map_err(|e| format!("原子写入任务文档失败：{e}"))
}

pub fn load_task_document() -> Result<Option<TaskDocumentV1>, String> {
    let path = task_document_path();
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("读取任务文档失败：{e}"))?;
    serde_json::from_slice::<TaskDocumentV1>(&bytes)
        .map(Some)
        .map_err(|e| format!("解析任务文档失败：{e}"))
}

pub fn freeze_plan(catalog: &Catalog, plan: &InstallPlan) -> FrozenPlan {
    let origin = if plan.profile_id.is_empty() {
        PlanOrigin::Selection
    } else {
        PlanOrigin::Profile
    };
    let profile_id = if plan.profile_id.is_empty() {
        None
    } else {
        Some(plan.profile_id.clone())
    };
    let frozen_policy = plan
        .storage_policy
        .clone()
        .unwrap_or_else(super::storage::load_effective_policy);
    let revision = frozen_policy.revision;
    FrozenPlan {
        plan_id: format!("plan-{}", plan_timestamp().replace([':', '.'], "-")),
        origin,
        profile_id,
        catalog_revision: catalog.revision().to_string(),
        steps: plan.steps.clone(),
        storage_policy: Some(frozen_policy),
        storage_revision: revision,
        created_at: plan_timestamp(),
    }
}

pub fn execute_plan(
    catalog: &Catalog,
    plan: &InstallPlan,
    cancel: &CancelFlag,
) -> ExecutionSession {
    let frozen_plan = freeze_plan(catalog, plan);
    let mut session = ExecutionSession::new(
        format!("session-{}", plan_timestamp().replace([':', '.'], "-")),
        frozen_plan.profile_id.clone().unwrap_or_default(),
        plan_timestamp(),
    );
    execute_frozen_plan_observed(catalog, &frozen_plan, &mut session, cancel, &no_progress, None);
    session
}

pub fn execute_plan_observed(
    catalog: &Catalog,
    plan: &InstallPlan,
    cancel: &CancelFlag,
    sink: ProgressSink<'_>,
) -> ExecutionSession {
    let frozen_plan = freeze_plan(catalog, plan);
    let mut session = ExecutionSession::new(
        format!("session-{}", plan_timestamp().replace([':', '.'], "-")),
        frozen_plan.profile_id.clone().unwrap_or_default(),
        plan_timestamp(),
    );
    execute_frozen_plan_observed(catalog, &frozen_plan, &mut session, cancel, sink, None);
    session
}

pub fn execute_frozen_plan_observed(
    catalog: &Catalog,
    frozen_plan: &FrozenPlan,
    session: &mut ExecutionSession,
    cancel: &CancelFlag,
    sink: ProgressSink<'_>,
    ctx: Option<&ExecutionContext>,
) {
    execute_frozen_steps(
        catalog,
        frozen_plan,
        session,
        cancel,
        &frozen_plan.steps.iter().map(|s| s.id).collect::<Vec<_>>(),
        sink,
        ctx,
    );
}

/// Observer for per-step progress, called as each step's state changes.
pub type ProgressSink<'a> = &'a (dyn Fn(&StepProgress) + 'a);

/// A sink that discards everything, for callers with no observer.
pub fn no_progress(_: &StepProgress) {}

pub fn resume_plan(
    catalog: &Catalog,
    plan: &InstallPlan,
    previous: &ExecutionSession,
    cancel: &CancelFlag,
) -> ExecutionSession {
    let frozen_plan = freeze_plan(catalog, plan);
    let mut session = previous.clone();
    resume_frozen_plan_observed(catalog, &frozen_plan, &mut session, cancel, &no_progress, None);
    session
}

pub fn resume_plan_observed(
    catalog: &Catalog,
    plan: &InstallPlan,
    previous: &ExecutionSession,
    cancel: &CancelFlag,
    sink: ProgressSink<'_>,
) -> ExecutionSession {
    let frozen_plan = freeze_plan(catalog, plan);
    let mut session = previous.clone();
    resume_frozen_plan_observed(catalog, &frozen_plan, &mut session, cancel, sink, None);
    session
}

pub fn resume_frozen_plan_observed(
    catalog: &Catalog,
    frozen_plan: &FrozenPlan,
    session: &mut ExecutionSession,
    cancel: &CancelFlag,
    sink: ProgressSink<'_>,
    ctx: Option<&ExecutionContext>,
) {
    let remaining: Vec<SoftwareId> = frozen_plan.steps.iter().filter(|step| {
        session.remaining.contains(&step.id) || session.failed_steps.contains(&step.id)
            || !session.steps.iter().rev().find(|p| p.step_id == step.id).is_some_and(|p| {
                matches!(p.status, StepStatus::Succeeded | StepStatus::SucceededWithWarning | StepStatus::Skipped)
            })
    }).map(|step| step.id).collect();
    execute_frozen_steps(catalog, frozen_plan, session, cancel, &remaining, sink, ctx);
}

fn execute_frozen_steps(
    catalog: &Catalog, frozen_plan: &FrozenPlan, session: &mut ExecutionSession,
    cancel: &CancelFlag, todo: &[SoftwareId], sink: ProgressSink<'_>,
    ctx: Option<&ExecutionContext>,
) {
    let total = frozen_plan.steps.len() as u32;
    let frozen_policy = frozen_plan.storage_policy.clone().unwrap_or_else(super::storage::load_effective_policy);
    let previous = std::mem::take(&mut session.steps);
    session.steps = frozen_plan.steps.iter().enumerate().map(|(index, step)| {
        let mut progress = previous.iter().rev().find(|p| p.step_id == step.id).cloned().unwrap_or(StepProgress {
            step_id: step.id, name: step.name.clone(), status: StepStatus::Pending,
            index: index as u32, total, stage: "等待开始".into(), fraction: None,
            detail: None, availability: None, action_outcome: None,
        });
        progress.index = index as u32;
        progress.total = total;
        if todo.contains(&step.id) {
            progress.status = StepStatus::Pending;
            progress.stage = "等待继续安装".into();
            progress.fraction = None;
            progress.detail = None;
            progress.action_outcome = None;
        }
        progress
    }).collect();
    session.failed_steps.clear();
    session.cancelled_steps.clear();
    session.remaining.clear();
    session.verified = None;
    session.cancelled_by_user = false;
    session.halted_reason = None;
    session.finished_at = None;
    session.started_at = plan_timestamp();
    session.task_status = TaskStatus::Running;

    let document = |session: &ExecutionSession| TaskDocumentV1 {
        schema_version: "task-document.v1".into(), task_id: session.id.clone(),
        status: session.task_status.as_str().into(), frozen_plan: frozen_plan.clone(),
        session: session.clone(), updated_at: plan_timestamp(),
        attention_reason: session.halted_reason.clone(),
    };

    for (index, step) in frozen_plan.steps.iter().enumerate() {
        if !todo.contains(&step.id) {
            // Keep the verified current result of a previous successful attempt.
            sink(&session.steps[index]);
            continue;
        }
        if step.satisfied {
            session.steps[index].status = StepStatus::Skipped;
            session.steps[index].stage = "已检测到，无需安装".into();
            session.steps[index].action_outcome = Some(AttemptOutcome::Skipped);
            sink(&session.steps[index]);
            continue;
        }
        if cancel.is_cancelled() { break; }
        session.steps[index].status = StepStatus::Running;
        session.steps[index].stage = "正在安装".into();
        sink(&session.steps[index]);
        if let Err(error) = save_task_document(&document(session)) {
            session.task_status = TaskStatus::NeedsAttention;
            session.halted_reason = Some(format!("保存执行前状态失败，已停止安装：{error}"));
            session.steps[index].status = StepStatus::Failed;
            session.steps[index].stage = "保存状态失败，已停止安装".into();
            session.steps[index].action_outcome = Some(AttemptOutcome::NeedsAttention);
            session.steps[index].detail = session.halted_reason.clone();
            sink(&session.steps[index]);
            break;
        }
        run_chain(catalog, step, &mut session.actions, &mut session.steps[index], cancel, &frozen_policy, ctx);
        sink(&session.steps[index]);
        if session.steps[index].action_outcome == Some(AttemptOutcome::NeedsAttention) {
            session.task_status = TaskStatus::NeedsAttention;
            session.halted_reason = session.steps[index].detail.clone().or_else(|| Some("执行资源未确认回收，需要人工介入".into()));
        }
        if let Err(error) = save_task_document(&document(session)) {
            session.task_status = TaskStatus::NeedsAttention;
            let reason = format!("保存步骤完成状态失败，已停止安装：{error}");
            session.halted_reason = Some(match session.halted_reason.take() {
                Some(previous) => format!("{previous}；{reason}"), None => reason,
            });
            break;
        }
        if session.task_status == TaskStatus::NeedsAttention { break; }
        if session.steps[index].action_outcome == Some(AttemptOutcome::PermissionDenied) {
            session.halted_reason = Some("安装需要管理员权限。请以管理员身份重新运行程序，再继续安装。".into());
            break;
        }
    }

    session.cancelled_by_user = cancel.is_cancelled();
    for progress in &mut session.steps {
        if matches!(progress.status, StepStatus::Pending | StepStatus::Running) {
            progress.status = StepStatus::Cancelled;
            progress.stage = if session.cancelled_by_user { "已取消" } else { "等待继续安装" }.into();
            if session.cancelled_by_user { progress.action_outcome = Some(AttemptOutcome::Cancelled); }
            sink(progress);
        }
        if progress.status == StepStatus::Failed { session.failed_steps.push(progress.step_id); }
        if progress.status == StepStatus::Cancelled { session.cancelled_steps.push(progress.step_id); }
        if matches!(progress.status, StepStatus::Failed | StepStatus::Cancelled) { session.remaining.push(progress.step_id); }
    }
    if let Some(context) = ctx {
        if let (Some(manager), Some(task_id)) = (&context.task_manager, &context.task_id) {
            if let Some(blocker) = manager.has_anomaly_blocker().filter(|blocker| &blocker.task_id == task_id) {
                session.task_status = TaskStatus::NeedsAttention;
                session.halted_reason.get_or_insert(blocker.reason);
            }
        }
    }
    if !matches!(session.task_status, TaskStatus::NeedsAttention | TaskStatus::Interrupted) {
        finalize_frozen_session(catalog, frozen_plan, session);
    }
    session.finished_at = Some(plan_timestamp());
    session.task_status = if matches!(session.task_status, TaskStatus::NeedsAttention | TaskStatus::Interrupted) {
        session.task_status
    } else if session.is_cancelled() { TaskStatus::Cancelled }
    else if session.is_success() { TaskStatus::Succeeded } else { TaskStatus::Failed };

    if let Err(error) = save_task_document(&document(session)) {
        session.task_status = TaskStatus::NeedsAttention;
        let reason = format!("最终任务状态持久化失败，需要人工介入：{error}");
        session.halted_reason = Some(match session.halted_reason.take() {
            Some(previous) => format!("{previous}；{reason}"), None => reason,
        });
    }
    if session.task_status == TaskStatus::NeedsAttention {
        if let Some(context) = ctx {
            if let (Some(manager), Some(task_id)) = (&context.task_manager, &context.task_id) {
                manager.set_anomaly_blocker(task_id, session.halted_reason.as_deref().unwrap_or("任务需人工介入"));
            }
        }
    }
    for progress in &session.steps { sink(progress); }
}

/// Walks one step's fallback chain, recording every attempt.
fn run_chain(
    catalog: &Catalog,
    step: &InstallStep,
    actions: &mut Vec<ActionRecord>,
    progress: &mut StepProgress,
    cancel: &CancelFlag,
    policy: &crate::modules::storage::StoragePolicy,
    ctx: Option<&ExecutionContext>,
) {
    let spec = spec_from(catalog, step.id);

    // The chain from the catalog, with the plan's chosen source promoted to the
    // front. They can differ: the plan reuses the package id the machine already
    // reports (see `build_plan`), which is not necessarily the catalog's first
    // choice. Losing that would install a second Python beside the first.
    let mut chain: Vec<Fallback> = Vec::with_capacity(spec.chain.len() + 1);
    chain.push(Fallback {
        source: step.source.clone(),
        // Empty for a detect-only program (MSVC, CMake, Docker, Cursor, WSL …),
        // whose plan source is `ConfigurationOnly` and whose chain is empty by
        // construction. Indexing here panicked the engine instead of running the
        // step — the same shape as the `install_strategies` crash, reached
        // through a different door: a `programmer` profile run, not a click.
        rationale: spec
            .chain
            .first()
            .map(|f| f.rationale.clone())
            .unwrap_or_else(|| "此软件需要你手动完成安装".to_string()),
    });
    for link in spec.chain.iter().skip(1) {
        chain.push(link.clone());
    }

    let mut last_outcome = AttemptOutcome::Unavailable;
    let mut last_error: Option<String> = None;

    for (attempt, link) in chain.iter().enumerate() {
        if cancel.is_cancelled() {
            last_outcome = AttemptOutcome::Cancelled;
            break;
        }

        progress.stage = if attempt == 0 {
            format!("正在安装（{}）", link.rationale)
        } else {
            format!(
                "首选方式失败，改用第 {} 种方式：{}",
                attempt + 1,
                link.rationale
            )
        };
        progress.fraction = Some((attempt as f32) / (chain.len() as f32 + 1.0));

        let mut record = execute_source_with_context(step.id, &link.source, attempt as u32, cancel, policy, ctx);
        last_outcome = record.outcome;
        last_error = record.error.clone();

        if record.outcome.is_success() {
            record.final_attempt = true;
            actions.push(record);
            break;
        }

        actions.push(record);

        if !last_outcome.is_retryable() {
            // PermissionDenied and Cancelled: the next link cannot help.
            break;
        }
    }

    progress.fraction = Some(1.0);
    progress.status = match last_outcome {
        AttemptOutcome::Succeeded | AttemptOutcome::Skipped => StepStatus::Succeeded,
        AttemptOutcome::SucceededWithWarning => StepStatus::SucceededWithWarning,
        AttemptOutcome::Cancelled => StepStatus::Cancelled,
        AttemptOutcome::PermissionDenied | AttemptOutcome::NeedsAttention => StepStatus::Failed,
        AttemptOutcome::Failed | AttemptOutcome::Unavailable => StepStatus::Failed,
    };
    progress.stage = match last_outcome {
        AttemptOutcome::Succeeded => "安装完成".into(),
        AttemptOutcome::SucceededWithWarning => "安装完成（需重启系统）".into(),
        AttemptOutcome::Skipped => "已存在，无需安装".into(),
        AttemptOutcome::Cancelled => "已取消".into(),
        AttemptOutcome::PermissionDenied => "需要管理员权限".into(),
        AttemptOutcome::NeedsAttention => "需要人工介入，已停止后续操作".into(),
        AttemptOutcome::Failed | AttemptOutcome::Unavailable => {
            "安装未能完成".into()
        }
    };
    // Only the last attempt's error is shown: it is the one that explains the
    // final state. The earlier ones are still in the trace behind 高级模式.
    progress.detail = last_error;
    progress.action_outcome = Some(last_outcome);
}

/// Re-probes the machine and attaches the result to the session.
///
/// This is the verification step the brief asks for: "安装后重新调用 inventory
/// 验证". It runs unconditionally — including for a run where every step failed —
/// because a failed attempt can still have changed the machine, and the only way
/// to know what a student now has is to look.
fn finalize_frozen_session(catalog: &Catalog, frozen_plan: &FrozenPlan, session: &mut ExecutionSession) {
    let ids: Vec<SoftwareId> = frozen_plan.steps.iter().map(|s| s.id).filter(|id| *id != SoftwareId::Dynamic).collect();
    if ids.is_empty() { return; }
    let inventory = crate::modules::inventory::scan(catalog, &ids);

    // Reconcile the execution outcome with operational availability.
    for step in session.steps.iter_mut() {
        // Dynamic package identity is observed from the frozen Winget source by the command.
        // Its placeholder catalog entry cannot establish this package's operational availability.
        if step.step_id == SoftwareId::Dynamic { continue; }
        let entry = catalog.entry(step.step_id);
        let is_gui = entry.version_args.is_none() || step.step_id.category() == SoftwareCategory::AiCreative;
        let item_opt = inventory.find(step.step_id);

        let is_available = if is_gui {
            item_opt.is_some_and(|item| item.installed)
        } else {
            item_opt.is_some_and(|item| item.installed && item.on_path && item.version.is_some())
        };

        let is_installed_but_unreachable = !is_gui && item_opt.is_some_and(|item| item.installed && !item.on_path);
        let is_completely_missing = item_opt.map(|item| !item.installed).unwrap_or(true);

        step.availability = item_opt.and_then(|item| item.availability.clone());

        if step.status == StepStatus::Succeeded {
            if is_completely_missing {
                // Command finished (e.g. exit 0) but binary/registration missing: downgrade to warning
                step.status = StepStatus::SucceededWithWarning;
                step.stage = "安装程序已退出，但未检测到程序文件，可能需要重启或手动完成配置".into();
                if !session.failed_steps.contains(&step.step_id) {
                    session.failed_steps.push(step.step_id);
                }
            } else if is_installed_but_unreachable {
                // CLI installed but not in current PATH
                step.status = StepStatus::SucceededWithWarning;
                step.stage = "已安装，但当前终端 PATH 尚未生效，需重启终端或配置 PATH".into();
            }
        } else if step.status == StepStatus::Failed {
            if is_available {
                // Installer reported non-zero, but post-scan confirmed healthy and available
                step.status = StepStatus::SucceededWithWarning;
                step.stage = "安装程序返回了非零状态，但检测确认程序已可用".into();
                session.failed_steps.retain(|id| *id != step.step_id);
            }
        }
    }

    // Anything that ended well is no longer pending work.
    session.remaining.retain(|id| {
        !session.steps.iter().any(|s| {
            s.step_id == *id
                && matches!(
                    s.status,
                    StepStatus::Succeeded | StepStatus::SucceededWithWarning | StepStatus::Skipped
                )
        })
    });

    // A program that is genuinely present and available must not be re-installed on resume.
    session.remaining.retain(|id| {
        if *id == SoftwareId::Dynamic { return true; }
        let entry = catalog.entry(*id);
        let is_gui = entry.version_args.is_none() || id.category() == SoftwareCategory::AiCreative;
        let is_avail = if is_gui {
            inventory.find(*id).is_some_and(|item| item.installed)
        } else {
            inventory.find(*id).is_some_and(|item| item.installed && item.on_path)
        };
        !is_avail
    });

    session.verified = Some(inventory);
    session.finished_at = Some(plan_timestamp());

    if session.remaining.is_empty() {
        session.halted_reason = None;
    }
}

#[allow(dead_code)]
pub fn finalize_session(catalog: &Catalog, plan: &InstallPlan, session: &mut ExecutionSession) {
    let frozen_plan = freeze_plan(catalog, plan);
    finalize_frozen_session(catalog, &frozen_plan, session);
}

/// Lists the programs the machine has, in catalog order, for the UI's status
/// screen. Thin wrapper so callers do not need to know the provider layout.
pub fn inventory_snapshot(catalog: &Catalog, ids: &[SoftwareId]) -> SoftwareInventory {
    crate::modules::inventory::scan(catalog, ids)
}

/// Re-exports so `install` remains the single import site for the execution
/// engine: the pipeline the brief describes is `catalog -> plan -> executor ->
/// verify`, and a caller that had to import both `install` and `executor` would
/// be able to use the engine without going through the planner.
pub use super::executor::{preflight, readiness};

pub fn plan_timestamp() -> String {
    now_iso8601()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile_with(software: Vec<SoftwareId>) -> Profile {
        Profile {
            id: "test".into(),
            name: "Test".into(),
            tagline: String::new(),
            audience: String::new(),
            rationale: String::new(),
            software,
            configure: vec![],
            estimated_minutes: 5,
            estimated_download_mb: 100,
            requires_admin: false,
            future: ProfileFuture::default(),
            bootstrap: ProfileBootstrap::default(),
        capabilities: vec![],
        }
    }

    fn empty_scan() -> SoftwareScan {
        SoftwareScan {
            inventory: SoftwareInventory {
                items: vec![],
                scanned_at: String::new(),
                providers: vec![],
            },
            scanned_at: String::new(),
        }
    }

    fn scan_with(
        installed: bool,
        on_path: bool,
        version: Option<&str>,
        confidence: Confidence,
        package_id: Option<&str>,
    ) -> SoftwareScan {
        SoftwareScan {
            inventory: SoftwareInventory {
                items: vec![SoftwareInfo {
                    id: SoftwareId::Git,
                    name: "Git".into(),
                    installed,
                    version: version.map(str::to_string),
                    path: Some("C:\\Git\\cmd\\git.exe".into()),
                    on_path,
                    confidence,
                    package_id: package_id.map(str::to_string),
                    sources: vec![],
                    evidence: vec![],
                    hints: vec![],
                    availability: None,
                }],
                scanned_at: String::new(),
                providers: vec![],
            },
            scanned_at: String::new(),
        }
    }

    #[test]
    fn plan_covers_every_profile_software() {
        let cat = Catalog::builtin();
        let p = profile_with(vec![SoftwareId::Git, SoftwareId::Vscode]);
        let plan = build_plan(&cat, &p, &empty_scan());
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.ready_count, 2);
        assert_eq!(plan.satisfied_count, 0);
    }

    #[test]
    fn satisfied_requires_installed_on_path_version_and_confidence() {
        let cat = Catalog::builtin();
        let p = profile_with(vec![SoftwareId::Git]);

        // Installed but not on PATH -> still needs work.
        assert!(!build_plan(
            &cat,
            &p,
            &scan_with(true, false, Some("2.45.0"), Confidence::Ok, None)
        )
        .steps[0]
            .satisfied);

        // Installed, on PATH, but no readable version -> still needs work: we
        // cannot claim a healthy install we cannot measure.
        assert!(
            !build_plan(&cat, &p, &scan_with(true, true, None, Confidence::Ok, None)).steps[0]
                .satisfied
        );

        // Unknown confidence means "we could not check". Planning a reinstall on
        // that basis is exactly what this guards against.
        assert!(!build_plan(
            &cat,
            &p,
            &scan_with(false, false, None, Confidence::Unknown, None)
        )
        .steps[0]
            .satisfied);

        assert!(
            build_plan(
                &cat,
                &p,
                &scan_with(true, true, Some("2.45.0"), Confidence::Ok, None)
            )
            .steps[0]
                .satisfied
        );
    }

    #[test]
    fn every_installable_software_id_has_a_spec_with_a_fallback_chain() {
        let cat = Catalog::builtin();
        for id in SoftwareId::ALL {
            let spec = spec_from(&cat, id);
            assert_eq!(spec.id, id);
            if id.installable() {
                assert!(!spec.chain.is_empty(), "{id:?} has no install strategy");
            } else {
                // Detect-only programs must produce an empty chain, and the two
                // facts are asserted together so they cannot drift apart.
                assert!(
                    spec.chain.is_empty(),
                    "{id:?} is detect-only but carries an install strategy"
                );
            }
        }
    }

    #[test]
    fn a_profile_naming_a_detect_only_program_plans_it_without_crashing() {
        // The latent panic this guards: an empty install chain indexed as
        // `chain[0]` blows up the planner. A campus profile that mentions WSL is
        // a completely reasonable thing for a school to write, and it must
        // produce a plan rather than a crash.
        //
        // ## Why the subject changed from Docker to WSL in 0.1.2
        //
        // Docker became installable, so it stopped being an empty-chain case and
        // this test quietly stopped testing anything — it would have passed while
        // the panic it exists to prevent walked straight through. WSL is the
        // remaining entry that is genuinely detect-only, which is what makes it
        // the right subject. This is the failure mode to watch for whenever a
        // program is promoted: *the guard's subject must still be able to fail.*
        let cat = Catalog::builtin();
        let p = profile_with(vec![SoftwareId::Wsl, SoftwareId::Git]);
        let plan = build_plan(&cat, &p, &empty_scan());

        assert_eq!(plan.steps.len(), 2);
        let wsl = plan
            .steps
            .iter()
            .find(|s| s.id == SoftwareId::Wsl)
            .unwrap();
        assert!(
            matches!(wsl.source, InstallSource::ConfigurationOnly),
            "an unmanaged program must not claim an install source"
        );
        assert!(
            !wsl.fallback_plan.is_empty(),
            "the UI needs something to explain the situation"
        );
        assert!(
            wsl.fallback_plan[0].contains("手动"),
            "the explanation must tell the student who does it: {:?}",
            wsl.fallback_plan
        );
    }

    #[test]
    fn the_engine_survives_running_a_detect_only_step() {
        // The *runtime* counterpart of the planner test above, and the regression
        // for a real shipped crash.
        //
        // `run_chain` builds its chain by pushing `spec.chain[0].rationale`, an
        // unchecked index that panics on an empty chain. The planner test did not
        // catch it because planning never calls `run_chain` — so a `programmer`
        // profile (the one profile naming MSVC and CMake, both detect-only at the
        // time) planned fine and then tore down the app the moment the engine ran.
        //
        // This walks the same path the engine walks and asserts that an empty
        // chain produces a *reported* outcome rather than a panic.
        let cat = Catalog::builtin();
        let p = profile_with(vec![SoftwareId::Wsl]);
        let plan = build_plan(&cat, &p, &empty_scan());
        let step = plan.steps.iter().find(|s| s.id == SoftwareId::Wsl).unwrap();

        let mut actions = Vec::new();
        let mut progress = StepProgress {
            step_id: SoftwareId::Wsl,
            name: SoftwareId::Wsl.display_name().to_string(),
            status: StepStatus::Running,
            index: 0,
            total: 1,
            stage: String::new(),
            fraction: None,
            detail: None,
            availability: None,
            action_outcome: None,
        };
        let cancel = CancelFlag::new();
        run_chain(&cat, step, &mut actions, &mut progress, &cancel, &super::storage::load_effective_policy());

        assert!(
            !actions.is_empty(),
            "a detect-only step must still record an attempt, so the student is told why nothing happened"
        );
    }

    #[test]
    fn dry_run_never_claims_success() {
        let cat = Catalog::builtin();
        let p = profile_with(vec![SoftwareId::Git, SoftwareId::Python]);
        let plan = build_plan(&cat, &p, &empty_scan());
        let progress = simulate_plan(&plan);
        assert_eq!(progress.len(), 2);
        assert!(
            progress.iter().all(|p| p.status == StepStatus::Skipped),
            "a dry run must not report success"
        );
    }

    #[test]
    fn existing_package_id_is_reused_instead_of_the_preferred_one() {
        // Prevents installing a second Python next to the one already present.
        let cat = Catalog::builtin();
        let p = profile_with(vec![SoftwareId::Python]);
        let scan = SoftwareScan {
            inventory: SoftwareInventory {
                items: vec![SoftwareInfo {
                    id: SoftwareId::Python,
                    name: "Python".into(),
                    installed: true,
                    version: Some("3.13.1".into()),
                    path: Some("C:\\Python313\\python.exe".into()),
                    on_path: false,
                    confidence: Confidence::Ok,
                    package_id: Some("Python.Python.3.13".into()),
                    sources: vec![],
                    evidence: vec![],
                    hints: vec![],
                    availability: None,
                }],
                scanned_at: String::new(),
                providers: vec![],
            },
            scanned_at: String::new(),
        };
        let plan = build_plan(&cat, &p, &scan);
        match &plan.steps[0].source {
            InstallSource::Winget { package_id } => assert_eq!(package_id, "Python.Python.3.13"),
            other => panic!("expected a winget source, got {other:?}"),
        }
    }

    #[test]
    fn no_installer_bundles_its_own_binary() {
        // Guards the "don't maintain your own binaries" rule at test level:
        // every strategy is winget, a vendor URL, or a documented command.
        for id in SoftwareId::ALL {
            for link in spec_for(id).chain {
                let ok = matches!(
                    link.source,
                    InstallSource::Winget { .. }
                        | InstallSource::OfficialInstaller { .. }
                        | InstallSource::Script { .. }
                        | InstallSource::ConfigurationOnly
                );
                assert!(ok);
            }
        }
    }
}
