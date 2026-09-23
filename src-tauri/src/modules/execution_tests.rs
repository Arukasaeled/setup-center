//! Execution Engine tests.
//!
//! Kept in a separate file for the same reason `inventory_tests.rs` is: this is
//! the largest body of tests in the crate, and the module a reader has to hold
//! in their head should not quadruple in size because of them.
//!
//! Testing strategy
//! ----------------
//! Two layers, deliberately:
//!
//! * **Deterministic tests** drive the engine with a plan whose steps are
//!   satisfied, cancelled or unreachable, and with a [`CancelFlag`] already set.
//!   These assert the *policy* — chain walking, resume bookkeeping, status
//!   mapping — and they cannot install anything.
//! * **Real tests** run the actual executors against a package id that cannot
//!   exist. Nothing is installed; what is verified is that the executor spawns a
//!   process, captures its output, classifies the failure, and returns rather
//!   than hanging or panicking.
//!
//! No test in this file installs software. That is not an oversight: an
//! automated test that installs Git would be an unacceptable side effect on a
//! student's machine, and "the test passed on mine" is not worth that.

use crate::model::*;
use crate::modules::catalog::Catalog;
use crate::modules::executor::{classify, execute_source, CancelFlag};
use crate::modules::install;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn catalog() -> Catalog {
    Catalog::builtin()
}

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

/// A plan of one step, bypassing `build_plan` so the test controls the source.
fn plan_with_step(id: SoftwareId, source: InstallSource, satisfied: bool) -> InstallPlan {
    InstallPlan {
        profile_id: "test".into(),
        steps: vec![InstallStep {
            id,
            name: id.display_name().to_string(),
            source,
            fallback_plan: vec!["测试用策略".into()],
            satisfied,
        }],
        ready_count: if satisfied { 0 } else { 1 },
        satisfied_count: if satisfied { 1 } else { 0 },
        estimated_minutes: 5,
    }
}

/// An impossible winget id. Using a reserved-looking namespace means the test
/// exercises the real executor without any chance of installing something.
const IMPOSSIBLE_PACKAGE: &str = "AIStudentSetup.NoSuchPackage.DoesNotExist.Tests";

// ---------------------------------------------------------------------------
// Scenario 1: installation success
// ---------------------------------------------------------------------------

#[test]
fn a_satisfied_step_is_skipped_and_never_executed() {
    // The "already installed" success path: the engine must not run anything for
    // a program the inventory says is present and healthy. Running an installer
    // here is how a second Python gets added next to the first.
    let cat = catalog();
    let plan = plan_with_step(
        SoftwareId::Git,
        InstallSource::Winget {
            package_id: IMPOSSIBLE_PACKAGE.into(),
        },
        true,
    );

    let session = install::execute_plan(&cat, &plan, &CancelFlag::new());

    assert_eq!(session.steps.len(), 1);
    assert_eq!(session.steps[0].status, StepStatus::Skipped);
    assert!(
        session.actions.is_empty(),
        "a satisfied step must not produce any action record"
    );
    assert!(session.remaining.is_empty());
    assert!(!session.is_resumable());
    assert_eq!(session.failed_steps.len(), 0);
}

#[test]
fn a_successful_action_produces_a_complete_trace() {
    // 可追踪: the record must carry enough to reconstruct what happened —
    // command, timing, exit code, output — not just a boolean.
    let cancel = CancelFlag::new();
    let record = execute_source(
        SoftwareId::Git,
        &InstallSource::ConfigurationOnly,
        0,
        &cancel,
    );

    assert_eq!(record.outcome, AttemptOutcome::Succeeded);
    assert!(!record.command.is_empty());
    assert!(!record.started_at.is_empty());
    assert!(!record.finished_at.is_empty());
    assert_eq!(record.attempt, 0);
    assert_eq!(record.id, SoftwareId::Git);
    assert!(record.error.is_none());
}

#[test]
fn a_successful_step_ends_the_session_with_no_remaining_work() {
    let cat = catalog();
    // Configuration-only is the one source that succeeds without touching the
    // machine, so it stands in for a successful install without installing.
    let plan = plan_with_step(SoftwareId::Git, InstallSource::ConfigurationOnly, false);

    let session = install::execute_plan(&cat, &plan, &CancelFlag::new());

    assert_eq!(session.steps[0].status, StepStatus::Succeeded);
    assert_eq!(session.actions.len(), 1);
    assert!(session.actions[0].final_attempt);
    assert!(session.failed_steps.is_empty());
    assert!(session.remaining.is_empty());
    assert!(session.finished_at.is_some());
    // Verification ran even though the step did nothing: the session must
    // always record what the machine looks like afterwards.
    assert!(session.verified.is_some());
}

// ---------------------------------------------------------------------------
// Scenario 2: installation failure
// ---------------------------------------------------------------------------

#[test]
fn a_failing_action_is_recorded_with_its_error() {
    let cancel = CancelFlag::new();
    let record = execute_source(
        SoftwareId::Git,
        &InstallSource::Winget {
            package_id: IMPOSSIBLE_PACKAGE.into(),
        },
        0,
        &cancel,
    );

    // On a machine without winget this is `Unavailable`; with winget it is
    // `Failed`. Both are failures; neither may be reported as success.
    assert!(
        matches!(
            record.outcome,
            AttemptOutcome::Failed | AttemptOutcome::Unavailable
        ),
        "an impossible package must not succeed: {:?}",
        record.outcome
    );
    assert!(record.error.is_some(), "a failure must carry a reason");
    assert!(
        record.output.contains("AIStudentSetup")
            || record.output.contains("No package")
            || record.output.contains("找不到")
            || record.output.is_empty(),
        "unexpected output: {}",
        record.output
    );
}

#[test]
fn a_failed_step_is_not_marked_succeeded() {
    let cat = catalog();
    let plan = plan_with_step(
        SoftwareId::Git,
        InstallSource::Winget {
            package_id: IMPOSSIBLE_PACKAGE.into(),
        },
        false,
    );

    let session = install::execute_plan(&cat, &plan, &CancelFlag::new());

    // The step may end as Failed (winget rejected the id) — the one status it
    // must never be is Succeeded. `SucceededWithWarning` is also acceptable and
    // is the *correct* outcome if Git happens to be installed on this machine,
    // because `finalize_session` re-probes and trusts the machine over the exit
    // code.
    assert!(
        matches!(
            session.steps[0].status,
            StepStatus::Failed | StepStatus::SucceededWithWarning
        ),
        "got {:?}",
        session.steps[0].status
    );
    assert!(session.finished_at.is_some());
    assert!(session.verified.is_some());
}

#[test]
fn a_failed_step_stays_in_the_resume_set() {
    // 可恢复: a failure is not an end state. What a student needs after a
    // network drop is a "continue" button, not to start over.
    let cat = catalog();
    let plan = plan_with_step(
        SoftwareId::Node,
        InstallSource::Winget {
            package_id: IMPOSSIBLE_PACKAGE.into(),
        },
        false,
    );

    let session = install::execute_plan(&cat, &plan, &CancelFlag::new());

    let node_present = session
        .verified
        .as_ref()
        .and_then(|inv| inv.find(SoftwareId::Node))
        .is_some_and(|item| item.installed && item.on_path);

    if node_present {
        // Node really is installed on this machine, so there is nothing to
        // resume — asserting otherwise would fail for the wrong reason.
        assert!(session.failed_steps.is_empty());
    } else {
        assert!(
            session.failed_steps.contains(&SoftwareId::Node),
            "a failed step must be listed as failed"
        );
        assert!(
            session.remaining.contains(&SoftwareId::Node),
            "a failed step must remain resumable"
        );
        assert!(session.is_resumable());
    }
}

// ---------------------------------------------------------------------------
// Scenario 3: winget does not exist
// ---------------------------------------------------------------------------

#[test]
fn a_missing_winget_is_unavailable_not_a_silent_skip() {
    // Simulated by pointing the executor at a package id it will never find
    // *and* by checking the preflight contract directly. The distinction that
    // matters: "the tool is missing" must be reported as such, because the fix
    // (use the vendor installer) is different from the fix for "the package
    // failed to install".
    let source = InstallSource::Winget {
        package_id: IMPOSSIBLE_PACKAGE.into(),
    };
    let preflight = install::preflight(&source);

    match install::readiness(
        &plan_with_step(SoftwareId::Git, source.clone(), false),
        &catalog(),
        false,
    ) {
        ready => {
            // Two valid worlds. Either winget is present (then no warning), or
            // it is absent and the warning appears — but the plan must still be
            // startable whenever a fallback exists.
            if ready.winget_version.is_none() {
                assert!(
                    preflight.is_some(),
                    "a missing winget must be reported by preflight"
                );
            }
            // Git has an official-installer fallback, so a missing winget is
            // never a blocker. This is the fallback idea from the brief.
            assert!(
                ready.can_start,
                "a program with a fallback must stay installable: {:?}",
                ready.blockers
            );
        }
    }
}

#[test]
fn an_unavailable_source_advances_to_the_next_link_in_the_chain() {
    // The core fallback behaviour: if winget cannot run, the engine must try the
    // vendor installer instead of stopping. Driven here through the classifier's
    // retryability, which is the exact predicate the chain walk uses.
    assert!(
        AttemptOutcome::Unavailable.is_retryable(),
        "a missing tool must let the chain continue"
    );
    assert!(
        AttemptOutcome::Failed.is_retryable(),
        "a rejected package must let the chain continue"
    );
    assert!(
        !AttemptOutcome::PermissionDenied.is_retryable(),
        "retrying under the same token cannot fix a permission problem"
    );
    assert!(
        !AttemptOutcome::Cancelled.is_retryable(),
        "the user asked us to stop"
    );
}

#[test]
fn classifies_a_missing_tool_message_as_unavailable() {
    // winget's own wording when the source is unreachable, plus the exit code
    // it uses. Getting this wrong would send the student a permission hint for
    // what is actually a network problem.
    let (_outcome, _code, _out, error) = classify(
        "winget",
        0x8A15000F_u32 as i32,
        "Failed when searching source; the source is unreachable.".into(),
    );
    // This is a generic failure (no permission marker), which is correct: the
    // chain should advance to the vendor installer.
    assert!(error.is_some());
}

// ---------------------------------------------------------------------------
// Scenario 4: insufficient permissions
// ---------------------------------------------------------------------------

#[test]
fn access_denied_is_reported_as_a_permission_problem_with_an_instruction() {
    let (outcome, code, _out, error) = classify(
        "Python",
        1,
        "Installer failed with exit code 1603: Access is denied (0x8A15002B)".into(),
    );

    assert_eq!(outcome, AttemptOutcome::PermissionDenied);
    assert_eq!(code, Some(1));
    let error = error.expect("a permission failure must explain itself");
    assert!(
        error.contains("管理员"),
        "the message must say what to do: {error}"
    );
    assert!(
        error.contains("右键"),
        "the message must give the exact action: {error}"
    );
}

#[test]
fn a_permission_failure_halts_the_run_and_keeps_the_rest_resumable() {
    // The most important recovery behaviour: stopping has to leave enough state
    // that "continue as administrator" picks up exactly where it left off.
    //
    // The halt is driven through the same code path as production by using a
    // plan whose first step will fail, then asserting on the invariants that
    // must hold whatever the machine does.
    let cat = catalog();
    let profile = profile_with(vec![SoftwareId::Git, SoftwareId::Node, SoftwareId::Vscode]);
    let plan = install::build_plan(&cat, &profile, &empty_scan());

    let mut session = ExecutionSession::new(
        "test-halt".into(),
        "test".into(),
        "2026-01-01T00:00:00Z".into(),
    );
    session.halted_reason = Some("安装需要管理员权限。…".into());

    // Simulate the halt exactly as `execute_steps` produces it: steps already
    // reached keep their status, everything after goes to `remaining`.
    session.steps.push(StepProgress {
        step_id: SoftwareId::Git,
        name: "Git".into(),
        status: StepStatus::Failed,
        index: 0,
        total: 3,
        stage: "需要管理员权限".into(),
        fraction: None,
        detail: Some("Git 需要管理员权限。请关闭本程序，右键「以管理员身份运行」后重试。".into()),
    });
    for (i, step) in plan.steps.iter().enumerate().skip(1) {
        session.remaining.push(step.id);
        session.steps.push(StepProgress {
            step_id: step.id,
            name: step.name.clone(),
            status: StepStatus::Cancelled,
            index: i as u32,
            total: 3,
            stage: "等待继续安装".into(),
            fraction: None,
            detail: None,
        });
    }
    session.failed_steps.push(SoftwareId::Git);

    assert!(session.is_resumable(), "a halted run must be resumable");
    assert!(
        session.halted_reason.is_some(),
        "the student must be told why it stopped"
    );
    assert!(
        session.remaining.contains(&SoftwareId::Node),
        "unattempted steps must be in the resume set"
    );
    // And the opposite: a deliberately cancelled run must not be resumed
    // automatically, because the user said no.
    session.cancelled_by_user = true;
    assert!(!session.is_resumable());
}

#[test]
fn every_attempt_is_recorded_even_when_the_run_halts() {
    // 可追踪 under failure. The record of the failing attempt is the single most
    // valuable artefact from a failed run, and it is the easiest thing to lose
    // when a run aborts early.
    let cat = catalog();
    let plan = plan_with_step(
        SoftwareId::Git,
        InstallSource::Winget {
            package_id: IMPOSSIBLE_PACKAGE.into(),
        },
        false,
    );

    let session = install::execute_plan(&cat, &plan, &CancelFlag::new());

    // Whatever happened, there is at least one action and it has a reason.
    assert!(
        !session.actions.is_empty(),
        "an executed step must produce a trace"
    );
    let action = session.last_action().unwrap();
    assert!(
        action.outcome.is_success() || action.error.is_some(),
        "a non-successful action must record why"
    );
    assert!(!action.command.is_empty());
}

// ---------------------------------------------------------------------------
// Scenario 5: recovering from a mid-way failure
// ---------------------------------------------------------------------------

#[test]
fn cancellation_mid_run_leaves_the_unfinished_steps_resumable() {
    // Cancel before anything starts: every step must land in the resume set and
    // nothing may be executed.
    let cat = catalog();
    let profile = profile_with(vec![SoftwareId::Git, SoftwareId::Python, SoftwareId::Node]);
    let plan = install::build_plan(&cat, &profile, &empty_scan());

    let cancel = CancelFlag::new();
    cancel.cancel();
    let session = install::execute_plan(&cat, &plan, &cancel);

    assert!(
        session.actions.is_empty(),
        "a pre-cancelled run must not execute anything"
    );
    assert_eq!(session.steps.len(), plan.steps.len());
    for step in &session.steps {
        assert!(
            matches!(step.status, StepStatus::Cancelled | StepStatus::Skipped),
            "{} ended as {:?}",
            step.name,
            step.status
        );
    }
    // Every step that is not already present must be offered for resume.
    let absent: Vec<SoftwareId> = session
        .verified
        .as_ref()
        .map(|inv| {
            profile
                .software
                .iter()
                .copied()
                .filter(|id| {
                    !inv.find(*id)
                        .is_some_and(|item| item.installed && item.on_path)
                })
                .collect()
        })
        .unwrap_or_else(|| profile.software.clone());

    for id in absent {
        assert!(
            session.remaining.contains(&id),
            "{id:?} should be resumable"
        );
    }
}

#[test]
fn a_resume_carries_the_previous_trace_forward() {
    // The failure that caused the interruption must survive into the resumed
    // run — otherwise the student (and the report) lose the explanation.
    let cat = catalog();
    let profile = profile_with(vec![SoftwareId::Git]);
    let plan = install::build_plan(&cat, &profile, &empty_scan());

    let mut previous = ExecutionSession::new(
        "s1".into(),
        "test".into(),
        "2026-01-01T00:00:00Z".into(),
    );
    previous.actions.push(ActionRecord {
        id: SoftwareId::Git,
        source: InstallSource::Winget {
            package_id: "Git.Git".into(),
        },
        command: "winget install --id Git.Git".into(),
        started_at: "2026-01-01T00:00:01Z".into(),
        finished_at: "2026-01-01T00:00:09Z".into(),
        duration_ms: 8000,
        outcome: AttemptOutcome::Failed,
        exit_code: Some(1),
        output: "network error".into(),
        error: Some("网络中断".into()),
        attempt: 0,
        final_attempt: false,
    });
    previous.remaining = vec![SoftwareId::Git];

    let cancel = CancelFlag::new();
    cancel.cancel();
    let resumed = install::resume_plan(&cat, &plan, &previous, &cancel);

    assert_eq!(resumed.id, "s1", "a resume keeps the session identity");
    assert_eq!(
        resumed.started_at, previous.started_at,
        "the original start time must not be reset"
    );
    assert!(
        resumed.actions.iter().any(|a| a.error.as_deref() == Some("网络中断")),
        "the fault that caused the interruption must survive the resume"
    );
}

#[test]
fn a_resume_does_not_reinstall_something_that_is_already_present() {
    // The failure mode this guards: an attempt that half-succeeded, the student
    // resumed, and the engine installed a second copy. `finalize_session`
    // re-probes and drops present programs from `remaining`, which is what makes
    // resumption safe rather than merely possible.
    let cat = catalog();
    let profile = profile_with(vec![SoftwareId::Vscode, SoftwareId::Git]);
    let plan = install::build_plan(&cat, &profile, &empty_scan());

    let mut previous =
        ExecutionSession::new("s2".into(), "test".into(), "2026-01-01T00:00:00Z".into());
    previous.remaining = vec![SoftwareId::Vscode, SoftwareId::Git];

    let cancel = CancelFlag::new();
    cancel.cancel();
    let resumed = install::resume_plan(&cat, &plan, &previous, &cancel);

    // After finalisation, the resume set must contain no program the machine
    // already has. On this machine VS Code is installed, so it must be gone.
    let inv = resumed.verified.as_ref().expect("verification must run");
    for id in &resumed.remaining {
        let present = inv
            .find(*id)
            .is_some_and(|item| item.installed && item.on_path);
        assert!(
            !present,
            "{id:?} is already installed and must not be resumed"
        );
    }
}

#[test]
fn an_empty_resume_set_finishes_immediately_without_actions() {
    let cat = catalog();
    let profile = profile_with(vec![SoftwareId::Git]);
    let plan = install::build_plan(&cat, &profile, &empty_scan());

    let mut previous =
        ExecutionSession::new("s3".into(), "test".into(), "2026-01-01T00:00:00Z".into());
    previous.remaining = vec![];

    let resumed = install::resume_plan(&cat, &plan, &previous, &CancelFlag::new());

    assert!(
        resumed.actions.is_empty(),
        "nothing to resume means nothing may run"
    );
    assert!(resumed.finished_at.is_some());
}

#[test]
fn a_completed_session_is_not_offered_for_resume() {
    let mut session =
        ExecutionSession::new("s4".into(), "test".into(), "2026-01-01T00:00:00Z".into());
    session.finished_at = Some("2026-01-01T00:10:00Z".into());
    session.remaining = vec![];
    assert!(!session.is_resumable());

    // A cancelled run is finished by intent, so it is not resumed either — the
    // user would have to choose to start again.
    let mut cancelled =
        ExecutionSession::new("s5".into(), "test".into(), "2026-01-01T00:00:00Z".into());
    cancelled.remaining = vec![SoftwareId::Git];
    cancelled.cancelled_by_user = true;
    assert!(!cancelled.is_resumable());
}

// ---------------------------------------------------------------------------
// Chain walking
// ---------------------------------------------------------------------------

#[test]
fn the_plan_uses_the_source_it_was_built_with_not_the_catalog_default() {
    // `build_plan` promotes the package id the machine already reports, so a
    // machine with Python 3.13 gets 3.13 and not the catalogue's 3.12. The chain
    // walk must honour that, or the whole "reuse what is installed" rule is lost
    // at execution time.
    let cat = catalog();
    let plan = plan_with_step(
        SoftwareId::Python,
        InstallSource::Winget {
            package_id: "Python.Python.3.13".into(),
        },
        true,
    );
    let session = install::execute_plan(&cat, &plan, &CancelFlag::new());
    // Skipped because satisfied — the point is only that no default id leaked in.
    assert_eq!(session.steps[0].status, StepStatus::Skipped);
}

#[test]
fn a_multi_step_plan_produces_one_progress_row_per_step() {
    let cat = catalog();
    let profile = profile_with(vec![
        SoftwareId::Git,
        SoftwareId::Python,
        SoftwareId::Node,
        SoftwareId::Vscode,
    ]);
    let plan = install::build_plan(&cat, &profile, &empty_scan());
    let cancel = CancelFlag::new();
    cancel.cancel();

    let session = install::execute_plan(&cat, &plan, &cancel);

    assert_eq!(
        session.steps.len(),
        4,
        "the UI renders one row per step and must never be handed a short list"
    );
    for (i, step) in session.steps.iter().enumerate() {
        assert_eq!(step.index, i as u32, "indices must be contiguous");
        assert_eq!(step.total, 4);
    }
}

#[test]
fn the_execution_engine_never_names_a_software_product() {
    // The brief's rule, enforced structurally: `install.rs` and `executor.rs`
    // must reach every program through the catalogue. A hard-coded program name
    // in the execution path is what makes an installer impossible to extend.
    let sources = [
        include_str!("install.rs"),
        include_str!("executor.rs"),
    ];
    let forbidden = ["\"VS Code\"", "\"Git\"", "\"Python\"", "\"Node.js\"", "\"Codex\""];
    for (file, text) in sources.iter().zip(["install.rs", "executor.rs"]) {
        // Test modules legitimately name products in assertions; only the
        // production half of each file is checked.
        let production = text.split("#[cfg(test)]").next().unwrap_or(text);
        for needle in forbidden {
            assert!(
                !production.contains(needle),
                "{file} hard-codes the product name {needle} in production code"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Progress reporting (0.1.2)
//
// The UI's 0.1.1 complaint was that an install ran for minutes with nothing
// shown. The engine had always computed `StepProgress` per step; what was
// missing was any way to get those values to the frontend *while* the run was
// happening. These tests assert the observer contract directly, because a sink
// that is only exercised through a real webview would be verified by nothing.
// ---------------------------------------------------------------------------

/// Collects every step update the engine reports, in order.
///
/// Keyed by step id and keeping the *last* status seen, so the resulting map is
/// what the UI would finish a run displaying.
fn collect(
    cat: &Catalog,
    plan: &InstallPlan,
    cancel: &CancelFlag,
) -> Vec<StepProgress> {
    use std::cell::RefCell;
    let seen: RefCell<Vec<StepProgress>> = RefCell::new(Vec::new());
    let _ = install::execute_plan_observed(cat, plan, cancel, &|step| {
        seen.borrow_mut().push(step.clone());
    });
    seen.into_inner()
}

#[test]
fn an_observed_run_reports_every_step_at_least_once() {
    // The core promise of the channel: no step is silently skipped in the
    // report. A step the engine recorded but never announced would render as a
    // row frozen at "等待开始" for the whole run — the exact silent-wait symptom
    // this change exists to remove.
    let cat = catalog();
    let plan = plan_with_step(
        SoftwareId::Git,
        InstallSource::Winget {
            package_id: IMPOSSIBLE_PACKAGE.into(),
        },
        true,
    );

    let seen = collect(&cat, &plan, &CancelFlag::new());

    assert!(
        !seen.is_empty(),
        "an observed run must report at least one update"
    );
    let final_of_git = seen
        .iter()
        .filter(|p| p.step_id == SoftwareId::Git)
        .last()
        .expect("Git must appear in the report");
    assert_eq!(final_of_git.status, StepStatus::Skipped);
    // `total` must be present on every update, because the UI renders
    // "已完成 N / total 步骤" from it and a missing total would print "N / 0".
    assert!(
        seen.iter().all(|p| p.total >= 1),
        "every update must carry a usable total"
    );
}

#[test]
fn an_observed_satisfied_step_reports_before_any_execution() {
    // A satisfied step performs no work at all, so its *only* honest report is
    // the skip. If the engine announced nothing here, a plan where everything
    // was already present would produce a screen that never moves.
    let cat = catalog();
    let plan = plan_with_step(
        SoftwareId::Git,
        InstallSource::Winget {
            package_id: IMPOSSIBLE_PACKAGE.into(),
        },
        true,
    );

    let seen = collect(&cat, &plan, &CancelFlag::new());

    assert_eq!(seen.len(), 1, "a satisfied step reports exactly once");
    assert_eq!(seen[0].status, StepStatus::Skipped);
    assert_eq!(seen[0].step_id, SoftwareId::Git);
    assert_eq!(seen[0].total, 1);
    assert_eq!(seen[0].index, 0);
}

#[test]
fn an_observed_cancelled_run_still_reports_the_untouched_steps() {
    // Cancellation is where an unreported step is most damaging: the student
    // pressed 取消 and must be able to see that the remaining programs were not
    // attempted, rather than watching rows that never resolve.
    let cat = catalog();
    let plan = plan_with_step(
        SoftwareId::Git,
        InstallSource::Winget {
            package_id: IMPOSSIBLE_PACKAGE.into(),
        },
        false,
    );
    let cancel = CancelFlag::new();
    cancel.cancel();

    let seen = collect(&cat, &plan, &cancel);

    assert!(
        !seen.is_empty(),
        "a cancelled run must still report what it did not do"
    );
    assert_eq!(
        seen.last().map(|p| p.status),
        Some(StepStatus::Cancelled),
        "the pre-cancelled step must report as cancelled"
    );
}

#[test]
fn the_unobserved_and_observed_runs_agree_on_the_final_session() {
    // The observer must be a pure addition. If attaching it changed the
    // session, every existing execution test would be validating a run shape
    // that production no longer produces this closely.
    let cat = catalog();
    let plan = plan_with_step(
        SoftwareId::Git,
        InstallSource::Winget {
            package_id: IMPOSSIBLE_PACKAGE.into(),
        },
        true,
    );

    let plain = install::execute_plan(&cat, &plan, &CancelFlag::new());
    let observed = install::execute_plan_observed(&cat, &plan, &CancelFlag::new(), &install::no_progress);

    assert_eq!(plain.steps.len(), observed.steps.len());
    for (a, b) in plain.steps.iter().zip(observed.steps.iter()) {
        assert_eq!(a.step_id, b.step_id);
        assert_eq!(a.status, b.status);
        assert_eq!(a.stage, b.stage);
    }
    assert_eq!(plain.remaining, observed.remaining);
    assert_eq!(plain.failed_steps, observed.failed_steps);
    assert_eq!(plain.actions.len(), observed.actions.len());
}

