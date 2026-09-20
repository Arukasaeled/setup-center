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
use super::executor::{execute_source, CancelFlag};
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
                source: match strategy.source {
                    StrategySource::Winget(package_id) => InstallSource::Winget {
                        package_id: package_id.to_string(),
                    },
                    StrategySource::OfficialInstaller(url) => InstallSource::OfficialInstaller {
                        url: url.to_string(),
                        // No pinned digest: these are vendor "latest" endpoints,
                        // where a hard-coded hash would be wrong within days. The
                        // field exists so a pinned build can be added later
                        // without a schema change.
                        sha256: None,
                    },
                    StrategySource::Command(command) => InstallSource::Script {
                        command: command.to_string(),
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
    let mut steps: Vec<InstallStep> = Vec::new();

    for id in &profile.software {
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

        steps.push(InstallStep {
            id: *id,
            name: id.display_name().to_string(),
            source,
            fallback_plan,
            satisfied,
        });
    }

    let satisfied_count = steps.iter().filter(|s| s.satisfied).count() as u32;
    let ready_count = steps.len() as u32 - satisfied_count;

    InstallPlan {
        profile_id: profile.id.clone(),
        steps,
        ready_count,
        satisfied_count,
        estimated_minutes: profile.estimated_minutes,
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
            }
        })
        .collect()
}

pub fn describe_source(source: &InstallSource) -> String {
    match source {
        InstallSource::Winget { package_id } => format!("winget install --id {package_id}"),
        InstallSource::OfficialInstaller { url, .. } => format!("官方安装包 {url}"),
        InstallSource::Script { command } => command.clone(),
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
pub fn execute_plan(
    catalog: &Catalog,
    plan: &InstallPlan,
    cancel: &CancelFlag,
) -> ExecutionSession {
    let mut session = ExecutionSession::new(
        format!("session-{}", plan_timestamp().replace([':', '.'], "-")),
        plan.profile_id.clone(),
        plan_timestamp(),
    );
    execute_steps(catalog, plan, &mut session, cancel, &plan.steps.iter().map(|s| s.id).collect::<Vec<_>>());
    session
}

/// Continues an interrupted session.
///
/// Resumption is not a replay: it re-probes each unfinished program first, so a
/// step that actually completed before the interruption (or was installed by a
/// failed attempt) is recognised and skipped rather than installed twice.
pub fn resume_plan(
    catalog: &Catalog,
    plan: &InstallPlan,
    previous: &ExecutionSession,
    cancel: &CancelFlag,
) -> ExecutionSession {
    let mut session = ExecutionSession::new(
        previous.id.clone(),
        previous.profile_id.clone(),
        previous.started_at.clone(),
    );
    // Carry the earlier trace forward. A resumed run whose log started over
    // would lose the failure that caused the interruption — the single most
    // important thing to keep.
    session.actions = previous.actions.clone();

    let remaining = previous.remaining.clone();
    execute_steps(catalog, plan, &mut session, cancel, &remaining);
    session
}

/// The shared body of a fresh run and a resume.
fn execute_steps(
    catalog: &Catalog,
    plan: &InstallPlan,
    session: &mut ExecutionSession,
    cancel: &CancelFlag,
    todo: &[SoftwareId],
) {
    let total = plan.steps.len() as u32;

    for (index, step) in plan.steps.iter().enumerate() {
        let mut progress = StepProgress {
            step_id: step.id,
            name: step.name.clone(),
            status: StepStatus::Pending,
            index: index as u32,
            total,
            stage: "等待开始".into(),
            fraction: None,
            detail: None,
        };

        // Not scheduled this pass: either already present, or not in the resume
        // set. `Cancelled` rather than `Skipped` for the latter, because it means
        // "not attempted yet" and is what makes the session resumable.
        if !todo.contains(&step.id) {
            let resumed_elsewhere = !plan.steps[index].satisfied;
            progress.status = if step.satisfied {
                StepStatus::Skipped
            } else {
                StepStatus::Cancelled
            };
            progress.stage = if step.satisfied {
                "已检测到，无需安装".into()
            } else {
                "等待继续安装".into()
            };
            if !step.satisfied && resumed_elsewhere {
                session.remaining.push(step.id);
            }
            session.steps.push(progress);
            continue;
        }

        // A satisfied step is never executed. This is the one place the engine
        // trusts the inventory over the plan, and it is worth stating why: the
        // plan is a snapshot from before the run, while the inventory is a live
        // read. On a resumed session they can legitimately disagree.
        if step.satisfied {
            progress.status = StepStatus::Skipped;
            progress.stage = "已检测到，无需安装".into();
            session.steps.push(progress);
            continue;
        }

        if cancel.is_cancelled() {
            progress.status = StepStatus::Cancelled;
            progress.stage = "已取消".into();
            session.remaining.push(step.id);
            session.steps.push(progress);
            continue;
        }

        progress.status = StepStatus::Running;
        session.steps.push(progress);
        let position = session.steps.len() - 1;

        run_chain(catalog, step, &mut session.actions, &mut session.steps[position], cancel);

        let status = session.steps[position].status;
        match status {
            StepStatus::Failed => session.failed_steps.push(step.id),
            StepStatus::Cancelled => session.remaining.push(step.id),
            _ => {}
        }

        // A permission failure is the one outcome that stops the whole run.
        // Every remaining step would hit the same wall under the same token, so
        // continuing would produce a list of identical failures and leave the
        // student waiting. Stopping here, with the reason stated once, is both
        // faster and clearer.
        if session.steps[position]
            .detail
            .as_deref()
            .is_some_and(|d| d.contains("管理员权限"))
        {
            session.halted_reason = Some(
                "安装需要管理员权限。请右键以管理员身份重新运行本程序，然后点击「继续安装」。".into(),
            );
            for later in plan.steps.iter().skip(index + 1) {
                session.remaining.push(later.id);
            }
            break;
        }
    }

    // Fill in the steps that were never reached at all (halted run), so the UI
    // renders a complete list rather than a truncated one.
    for step in plan.steps.iter().skip(session.steps.len()) {
        session.steps.push(StepProgress {
            step_id: step.id,
            name: step.name.clone(),
            status: StepStatus::Cancelled,
            index: session.steps.len() as u32,
            total,
            stage: "等待继续安装".into(),
            fraction: None,
            detail: None,
        });
        if !session.remaining.contains(&step.id) {
            session.remaining.push(step.id);
        }
    }

    finalize_session(catalog, plan, session);
}

/// Walks one step's fallback chain, recording every attempt.
fn run_chain(
    catalog: &Catalog,
    step: &InstallStep,
    actions: &mut Vec<ActionRecord>,
    progress: &mut StepProgress,
    cancel: &CancelFlag,
) {
    let spec = spec_from(catalog, step.id);

    // The chain from the catalog, with the plan's chosen source promoted to the
    // front. They can differ: the plan reuses the package id the machine already
    // reports (see `build_plan`), which is not necessarily the catalog's first
    // choice. Losing that would install a second Python beside the first.
    let mut chain: Vec<Fallback> = Vec::with_capacity(spec.chain.len() + 1);
    chain.push(Fallback {
        source: step.source.clone(),
        rationale: spec.chain[0].rationale.clone(),
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

        let mut record = execute_source(step.id, &link.source, attempt as u32, cancel);
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
        AttemptOutcome::Cancelled => StepStatus::Cancelled,
        AttemptOutcome::PermissionDenied => StepStatus::Failed,
        AttemptOutcome::Failed | AttemptOutcome::Unavailable => StepStatus::Failed,
    };
    progress.stage = match last_outcome {
        AttemptOutcome::Succeeded => "安装完成".into(),
        AttemptOutcome::Skipped => "已存在，无需安装".into(),
        AttemptOutcome::Cancelled => "已取消".into(),
        AttemptOutcome::PermissionDenied => "需要管理员权限".into(),
        AttemptOutcome::Failed | AttemptOutcome::Unavailable => {
            "安装未能完成".into()
        }
    };
    // Only the last attempt's error is shown: it is the one that explains the
    // final state. The earlier ones are still in the trace behind 高级模式.
    progress.detail = last_error;
}

/// Re-probes the machine and attaches the result to the session.
///
/// This is the verification step the brief asks for: "安装后重新调用 inventory
/// 验证". It runs unconditionally — including for a run where every step failed —
/// because a failed attempt can still have changed the machine, and the only way
/// to know what a student now has is to look.
fn finalize_session(catalog: &Catalog, plan: &InstallPlan, session: &mut ExecutionSession) {
    let ids: Vec<SoftwareId> = plan.steps.iter().map(|s| s.id).collect();
    let inventory = crate::modules::inventory::scan(catalog, &ids);

    // Reconcile the outcome with what is actually on the machine. A step that
    // reported failure but whose program is now present is a success: the
    // installer may have finished the work and then exited non-zero, which is
    // common with MSI-based installers and with winget's own retry paths.
    for step in session.steps.iter_mut() {
        if step.status != StepStatus::Failed {
            continue;
        }
        let verified = inventory.find(step.step_id).is_some_and(|item| {
            item.installed && item.on_path && item.version.is_some()
        });
        if verified {
            step.status = StepStatus::SucceededWithWarning;
            step.stage = "已安装（安装程序返回了错误码，但检测确认可用）".into();
            session.failed_steps.retain(|id| *id != step.step_id);
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

    // A program that is genuinely present must not be re-installed on resume.
    // The plan's `satisfied` flag is a pre-run snapshot; the post-run inventory
    // is the live answer.
    session.remaining.retain(|id| {
        !inventory
            .find(*id)
            .is_some_and(|item| item.installed && item.on_path)
    });

    session.verified = Some(inventory);
    session.finished_at = Some(plan_timestamp());

    if session.remaining.is_empty() {
        session.halted_reason = None;
    }
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
        // `chain[0]` blows up the planner. A campus profile that mentions Docker
        // is a completely reasonable thing for a school to write, and it must
        // produce a plan rather than a crash.
        let cat = Catalog::builtin();
        let p = profile_with(vec![SoftwareId::Docker, SoftwareId::Git]);
        let plan = build_plan(&cat, &p, &empty_scan());

        assert_eq!(plan.steps.len(), 2);
        let docker = plan
            .steps
            .iter()
            .find(|s| s.id == SoftwareId::Docker)
            .unwrap();
        assert!(
            matches!(docker.source, InstallSource::ConfigurationOnly),
            "an unmanaged program must not claim an install source"
        );
        assert!(
            !docker.fallback_plan.is_empty(),
            "the UI needs something to explain the situation"
        );
        assert!(
            docker.fallback_plan[0].contains("手动"),
            "the explanation must tell the student who does it: {:?}",
            docker.fallback_plan
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
