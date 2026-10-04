//! Tauri command surface — the *only* way the UI touches the system.
//!
//! The frontend never runs a shell command, never reads a file, and never
//! decides policy. Every capability is an explicit, typed command below. This
//! is what makes the app auditable: `grep` for `#[tauri::command]` and you have
//! the complete list of things this program can do.
//!
//! All commands take `&AppState` (shared, already-initialised module stores) and
//! return `Result<T, AppError>`, so the frontend gets a structured error rather
//! than a stringified panic.

use crate::model::*;
use crate::modules::{
    bootstrap::{self, run as bootstrap_run},
    catalog, capability, config, detect, executor, install, install_log, inventory, knowledge,
    license, machine, plugins, system_ops, verify,
};
use crate::state::AppState;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::State;

/// Refuses an action that the current tier does not permit.
///
/// Called at the *start* of the commands that change the machine — never inside
/// `install`, `executor` or `bootstrap`. Two reasons, and the second is the
/// important one:
///
/// 1. The engines stay tier-agnostic, so they remain testable without a licence
///    and a licensing bug cannot alter an installation's behaviour partway
///    through.
/// 2. An installer that *starts* and then aborts has left the machine in a
///    half-configured state the customer must clean up by hand. Refusing before
///    any work begins is the only failure mode that is fully recoverable.
///
/// The check reads the live licence rather than a cached one, so deactivating in
/// the licence screen takes effect on the very next attempt.
fn require_install_rights() -> AppResult<()> {
    let entitlements = license::Entitlements::of(&license::load(), license::enforcement_enabled());
    if entitlements.can_install {
        return Ok(());
    }
    Err(AppError::LicenseRequired {
        reason: entitlements.reason,
    })
}

/// Full environment detection. Runs every probe; takes a few seconds because of
/// the network round-trips.
///
/// The software inventory is *not* included here. The environment report answers
/// "can this machine run the tools"; the inventory answers "what is already
/// here". They have different latency profiles (network round-trips vs. reading
/// several hundred registry keys), so they are separate commands and the UI runs
/// them independently — a slow registry read can never delay the score.
/// Reads the machine's environment.
///
/// `async` on purpose, and the reason is a UI defect rather than a style choice:
/// a *synchronous* Tauri command runs on the main thread, and this probe reads
/// several hundred registry keys, spawns `where`/`git`, and issues network
/// requests. While it runs, the main thread is blocked, so the webview cannot
/// repaint and the window cannot be dragged — it looks frozen even though it is
/// working correctly. Every probe is blocking IO, so it is moved off the main
/// thread with `spawn_blocking` while the UI keeps a live frame.
#[tauri::command]
pub async fn detect_environment(state: State<'_, AppState>) -> AppResult<EnvironmentReport> {
    let required = state.required_download_mb();
    let report = tauri::async_runtime::spawn_blocking(move || detect::detect(required))
        .await
        .map_err(|e| AppError::ProbeFailed {
            probe: "environment".into(),
            reason: e.to_string(),
        })??;
    state.cache_environment(&report);
    Ok(report)
}

/// Convenience: the Windows version alone, for a fast first paint.
#[tauri::command]
pub fn windows_info() -> AppResult<WindowsInfo> {
    detect::probe_windows()
}

/// The Software Intelligence Layer's full answer.
///
/// `ids` restricts the scan; omitting it scans the whole catalog. The profile
/// screen passes only the programs in the chosen profile, which is the difference
/// between reading one registry key and reading all of them.
///
/// Async for the same reason as [`detect_environment`]: three providers over
/// hundreds of registry keys block the main thread, and a blocked main thread is
/// a window that cannot be moved.
#[tauri::command]
pub async fn scan_software(
    ids: Option<Vec<SoftwareId>>,
    state: State<'_, AppState>,
) -> Result<SoftwareInventory, AppError> {
    let wanted = ids.unwrap_or_else(|| SoftwareId::ALL.to_vec());
    let inv = tauri::async_runtime::spawn_blocking(move || {
        inventory::scan(&catalog::Catalog::builtin(), &wanted)
    })
    .await
    .map_err(|e| AppError::ProbeFailed {
        probe: "software".into(),
        reason: e.to_string(),
    })?;
    state.cache_scan(&inv);
    Ok(inv)
}

/// The last inventory, if one has been taken. Lets a screen render instantly on
/// remount instead of re-reading the registry.
#[tauri::command]
pub fn last_software_scan(state: State<'_, AppState>) -> Option<SoftwareInventory> {
    state.last_scan()
}

/// What this machine can currently do, and what each gap would take.
///
/// This is the command the dashboard is built on. It is deliberately a *read*:
/// it probes, resolves, and returns, with no side effects. The whole point of the
/// capability layer is that a student can look before they commit to anything,
/// which is only possible if looking is free.
///
/// It reads the cached environment and inventory rather than re-probing (see
/// [`AppState::cached_scan_covering`]). Reusing the cache is what guarantees the
/// capability rows agree with the software list beside them — two independent
/// probes of the same machine moments apart can disagree, and a dashboard that
/// contradicts itself is worse than a slightly stale one.
///
/// When either half is missing it is simply absent, and the affected capabilities
/// resolve to `unknown` rather than reporting the machine as incapable. That is
/// the `Confidence` discipline from stage 2 carried all the way to the top.
#[tauri::command]
pub fn capability_report(state: State<'_, AppState>) -> Vec<capability::CapabilityStatus> {
    let environment = state.last_environment();
    let inventory = state.last_scan();
    let manual = capability::probe_manual_facts(inventory.as_ref());
    let facts = capability::facts_from(environment.as_ref(), inventory.as_ref(), manual);
    capability::resolve(&facts, None)
}

/// The capabilities a profile aims at, derived rather than declared.
///
/// Returned as ids plus any declared-but-unknown ones, so the profile screen can
/// show what a choice buys and flag a typo in a hand-written profile file instead
/// of silently ignoring it.
#[tauri::command]
pub fn profile_capabilities(
    profile_id: String,
    state: State<'_, AppState>,
) -> AppResult<ProfileCapabilityView> {
    let profile = state.profiles.get(&profile_id)?;
    Ok(ProfileCapabilityView {
        derived: capability::from_profile(&profile)
            .into_iter()
            .map(|c| c.as_str().to_string())
            .collect(),
        unknown_declared: capability::unknown_declared(&profile),
    })
}

/// What a profile aims at, and anything wrong with its declaration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCapabilityView {
    /// Capability ids, derived from the profile's software plus any it declares.
    pub derived: Vec<String>,
    /// Ids the profile names that the table does not know — a typo, reported.
    pub unknown_declared: Vec<String>,
}

/// The catalogued programs with the metadata the dashboard explains them with.
///
/// Served from Rust rather than hard-coded in the frontend so there is exactly one
/// place a program is described. The TypeScript side still has a presentation
/// registry for the few things Rust has no business knowing (single-letter marks),
/// but name, purpose, category and installability all come from here.
#[tauri::command]
pub fn software_catalogue() -> Vec<SoftwareDescriptorView> {
    SoftwareId::ALL
        .iter()
        .map(|id| SoftwareDescriptorView {
            id: *id,
            name: id.display_name().to_string(),
            purpose: id.purpose().to_string(),
            category: id.category().key().to_string(),
            category_name: id.category().name().to_string(),
            installable: id.installable(),
        })
        .collect()
}

/// One catalogued program, as the dashboard presents it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareDescriptorView {
    pub id: SoftwareId,
    pub name: String,
    /// Why a student needs it. The single most valuable field on the screen.
    pub purpose: String,
    pub category: String,
    pub category_name: String,
    /// Whether this product can install it, or only detect it.
    pub installable: bool,
}

/// The current machine's hardware facts.
///
/// Separate from [`detect_environment`] because the dashboard shows hardware in
/// its own section and a re-read should not require re-running the network probes.
#[tauri::command]
pub fn machine_facts(state: State<'_, AppState>) -> Option<machine::MachineFacts> {
    state.last_environment().map(|env| env.machine)
}

/// All profiles available to choose from.
#[tauri::command]
pub fn list_profiles(state: State<'_, AppState>) -> Vec<Profile> {
    state.profiles.all()
}

/// One profile by id.
#[tauri::command]
pub fn get_profile(state: State<'_, AppState>, id: String) -> AppResult<Profile> {
    state.profiles.get(&id)
}

/// Builds the install plan for `profile_id` given what is already installed.
#[tauri::command]
pub fn build_install_plan(state: State<'_, AppState>, profile_id: String) -> AppResult<InstallPlan> {
    let profile = state.profiles.get(&profile_id)?;
    // Reuse the cached inventory when it already covers every program in this
    // profile. Re-scanning on every screen transition would add a visible stall
    // for an answer that cannot have changed in the last few seconds.
    let scan = match state.cached_scan_covering(&profile.software) {
        Some(scan) => scan,
        None => {
            let inv = inventory::scan(&catalog::Catalog::builtin(), &profile.software);
            state.cache_scan(&inv);
            SoftwareScan {
                scanned_at: inv.scanned_at.clone(),
                inventory: inv,
            }
        }
    };
    Ok(install::build_plan(
        &catalog::Catalog::builtin(),
        &profile,
        &scan,
    ))
}

/// Strategies for an explicit list of programs.
///
/// `install_strategies` is scoped to one profile, so a screen that lists every
/// program in the catalog could only describe the ones that profile happened to
/// name. A student picking Cherry Studio on a profile that does not include it
/// then saw "安装方式还没有收录" for a program the catalog can install. This
/// answers the same question for whatever the student actually ticked.
#[tauri::command]
pub fn install_strategies_for(ids: Vec<SoftwareId>) -> Vec<InstallStrategy> {
    strategies_for(&ids)
}

fn strategies_for(ids: &[SoftwareId]) -> Vec<InstallStrategy> {
    ids.iter()
        .map(|id| {
            let spec = install::spec_for(*id);
            InstallStrategy {
                id: *id,
                name: id.display_name().to_string(),
                purpose: id.purpose().to_string(),
                preferred: spec
                    .chain
                    .first()
                    .map(|f| install::describe_source(&f.source))
                    .unwrap_or_default(),
                fallbacks: spec
                    .chain
                    .iter()
                    .skip(1)
                    .map(|f| format!("{}（{}）", f.rationale, install::describe_source(&f.source)))
                    .collect(),
            }
        })
        .collect()
}

/// Machine-readable description of the install strategy per program, so the UI
/// can show *how* something will be installed before the user commits.
#[tauri::command]
pub fn install_strategies(profile_id: String, state: State<'_, AppState>) -> AppResult<Vec<InstallStrategy>> {
    let profile = state.profiles.get(&profile_id)?;
    // An empty chain is a real catalog state, not an error: the entry is
    // *detected but not managed* (MSVC, CMake, Docker, Cursor, WSL …). Indexing
    // `chain[0]` unconditionally panicked here with "index out of bounds: the
    // len is 0 but the index is 0" — and because this is a `#[tauri::command]`,
    // the panic tore down the whole app instead of failing one screen. The
    // `programmer` profile is the only profile that names such a program
    // (MSVC + CMake), so *only* 程序员版 crashed on click.
    //
    // The empty string is the wire form of "no managed method"; the frontend
    // already reads that as "detect only" through `descriptor.installable`.
    Ok(strategies_for(&profile.software))
}

/// Builds an install plan from an **explicit list of programs**.
///
/// ## Why this exists, and why it is not a second planner
///
/// The other plan builder is [`build_install_plan`], which takes a profile id.
/// That made the profile the ceiling of student choice: the plan contained
/// exactly `profile.software`, and the only edit the install screen could apply
/// was *removing* a step the student did not want. A student who wanted a
/// program their profile happened not to name — Cherry Studio, say — had no
/// route to it at all, and a profile that named Claude Code made Claude a step
/// they could not decline without declining everything.
///
/// So this command takes the ids the student actually ticked and produces the
/// same [`InstallPlan`] the profile path produces: same `build_plan_with`, same
/// catalog, same inventory, same one-source-of-truth `InstallSource`. Nothing
/// about *how* a program installs is restated here — only *which* programs are
/// in scope changes, and that is the student's decision to make.
///
/// `profile_id` is kept in the signature and in the returned plan because the
/// profile is still what `install_strategies` and `build_bootstrap_plan` are
/// keyed by, and the report names the scenario the student began from. It is
/// allowed to be empty: "I am installing three programs I picked, starting from
/// no scenario" is a legitimate request, and `build_plan_with` never reads it.
#[tauri::command]
pub fn build_install_plan_for(
    ids: Vec<SoftwareId>,
    profile_id: String,
    state: State<'_, AppState>,
) -> AppResult<InstallPlan> {
    // An empty selection is not a plan. Returning one would render an install
    // screen with no steps and a run button that installs nothing, which reads
    // as a silent failure — the same reason `startInstall` on the frontend
    // refuses an empty effective plan.
    if ids.is_empty() {
        return Err(AppError::InvalidRequest {
            reason: "至少要选择一项才需要安装方案".into(),
        });
    }

    // Deduplicated, order preserved, so the plan reads in the order the
    // software screen showed it.
    let mut wanted: Vec<SoftwareId> = Vec::with_capacity(ids.len());
    for id in ids {
        if !wanted.contains(&id) {
            wanted.push(id);
        }
    }

    let catalog = catalog::Catalog::builtin();
    let scan = scan_for(&state, &wanted);
    Ok(install::build_plan_with(&catalog, &profile_id, None, &wanted, &scan))
}

/// Stage 1: returns the dry-run progress stream. Does not install anything.
///
/// Kept after stage 3 because it is the honest "what would happen" preview the
/// choice screen shows *before* the student commits, and it is now a genuine
/// dry run of the same plan the engine will execute rather than a stand-in.
#[tauri::command]
pub fn preview_install(plan: InstallPlan) -> Vec<StepProgress> {
    install::simulate_plan(&plan)
}

// ---------------------------------------------------------------------------
// Execution (stage 3)
// ---------------------------------------------------------------------------

/// Whether this machine can start the plan, and what would need fixing.
///
/// Called before the run so the UI can explain an impossible plan up front
/// instead of letting the student watch it fail one step at a time. Reports
/// facts only — it never blocks: a missing winget is not a blocker when the
/// program has a vendor-installer fallback.
#[tauri::command]
pub fn execution_readiness(
    plan: InstallPlan,
    state: State<'_, AppState>,
) -> ExecutionReadiness {
    let elevated = detect::probe_admin().is_elevated;
    let mut readiness = install::readiness(&plan, &catalog::Catalog::builtin(), elevated);

    // A run already in flight is the one blocker that is not about hardware or
    // permissions, and it is the one the student can act on immediately.
    if state.is_installing() {
        readiness.can_start = false;
        readiness
            .blockers
            .insert(0, "已有安装任务正在进行中。".into());
    }
    readiness
}

/// Executes the plan. This is the command that changes the machine.
///
/// Blocks until the run finishes, which is deliberate: the frontend gets a
/// complete session object rather than a partial one it would have to poll for.
/// The UI stays responsive because the command runs on Tauri's blocking thread
/// pool, and cancellation is delivered through `cancel_install` rather than by
/// dropping the promise.
#[tauri::command]
pub async fn run_install(
    plan: InstallPlan,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> AppResult<ExecutionSession> {
    // Before the session is opened and before a single byte is downloaded.
    require_install_rights()?;
    run_install_blocking(plan, state, window).await
}

/// The event name every install progress update is emitted on.
///
/// One name for both a fresh run and a resume, because the UI renders the same
/// thing either way and separate channels would be two listeners that could
/// drift. The `://` makes it read as a sub-resource of the install run rather
/// than another unrelated app event, which keeps it greppable.
pub const INSTALL_PROGRESS_EVENT: &str = "install://progress";

/// Emits one step update to the frontend.
///
/// A send failure is deliberately swallowed: a progress update that cannot be
/// delivered is not a reason to abort an installation the student asked for.
/// The run's real outcome still reaches them as the command's return value, so
/// the worst case of a lost event is a screen that updates one step late —
/// never a wrong result. This is also why the engine takes a callback rather
/// than an `AppHandle`: deciding to ignore a failed send is a *transport*
/// concern, and it belongs here instead of inside the installation logic.
fn emit_progress(window: &tauri::Window, step: &StepProgress) {
    use tauri::Emitter;
    let _ = window.emit(INSTALL_PROGRESS_EVENT, step);
}

/// The actual work, kept separate so the async command stays a thin wrapper.
///
/// Uses `spawn_blocking` because the engine spawns processes and waits on them.
/// Running that on the async runtime would occupy a reactor thread for the
/// minutes an installation takes and stall every other command, including the
/// one the UI uses to show progress.
async fn run_install_blocking(
    plan: InstallPlan,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> AppResult<ExecutionSession> {
    let catalog = catalog::Catalog::builtin();
    let session = ExecutionSession::new(
        format!("session-{}", detect::now_iso8601().replace([':', '.'], "-")),
        plan.profile_id.clone(),
        detect::now_iso8601(),
    );

    let (flag, started) = state.begin_session(session);
    if !started {
        return Err(AppError::InstallFailed {
            id: "session".into(),
            reason: "已有安装任务正在进行中，请等待当前任务完成。".into(),
        });
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        // The window is moved into the closure because it runs on another
        // thread; a borrowed `&Window` could not outlive the awaited call.
        install::execute_plan_observed(&catalog, &plan, &flag, &|step| {
            emit_progress(&window, step);
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("安装线程异常结束：{e}")))?;

    // Clean the downloaded payloads before returning: the session records what
    // was fetched, and keeping the files would leave installers in the student's
    // AppData with nothing referencing them.
    executor::clean_downloads();

    // Persist what failed before handing the session back. Deliberately after
    // `finish_session`'s data is complete and before the UI can show the result:
    // if the student closes the window the moment they see the error, the log
    // must already be on disk.
    install_log::log_session_failures(&result);
    state.finish_session(result.clone());
    Ok(result)
}

/// Continues an interrupted run from exactly the steps that still need doing.
///
/// Returns the previous session unchanged when there is nothing to resume, so
/// the UI cannot accidentally re-run a finished plan by pressing "继续".
#[tauri::command]
pub async fn resume_install(
    state: State<'_, AppState>,
    window: tauri::Window,
) -> AppResult<ExecutionSession> {
    // Gated like a fresh run. A resumed install downloads and executes exactly
    // the same steps, so leaving this open would make the licence a formality:
    // interrupt once, then press 继续.
    require_install_rights()?;
    let Some(previous) = state.resumable_session() else {
        return state.last_session().ok_or_else(|| AppError::InstallFailed {
            id: "session".into(),
            reason: "没有可以继续的安装任务。".into(),
        });
    };

    let Some(profile) = state.profiles.get(&previous.profile_id).ok() else {
        return Err(AppError::ProfileNotFound {
            id: previous.profile_id.clone(),
        });
    };

    let catalog = catalog::Catalog::builtin();

    // Rebuild the plan from a *live* inventory rather than reusing the stored
    // one. Between the interruption and now, the student may have installed
    // something by hand, or the failed attempt may have half-succeeded; planning
    // from a stale snapshot would either reinstall working software or skip
    // software that is genuinely missing.
    let inv = inventory::scan(&catalog, &profile.software);
    state.cache_scan(&inv);
    let scan = SoftwareScan {
        scanned_at: inv.scanned_at.clone(),
        inventory: inv,
    };
    let plan = install::build_plan(&catalog, &profile, &scan);

    let (flag, started) = state.begin_session(previous.clone());
    if !started {
        return Err(AppError::InstallFailed {
            id: "session".into(),
            reason: "已有安装任务正在进行中，请等待当前任务完成。".into(),
        });
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        install::resume_plan_observed(&catalog, &plan, &previous, &flag, &|step| {
            emit_progress(&window, step);
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("安装线程异常结束：{e}")))?;

    executor::clean_downloads();
    // Same reason as the fresh-run path: the log must exist before the student
    // can act on the failure.
    install_log::log_session_failures(&result);
    state.finish_session(result.clone());
    Ok(result)
}

/// Asks the running installation to stop.
///
/// Cooperative, and it returns immediately. It does **not** kill the child
/// process, because killing `winget` mid-install leaves a half-installed package
/// and a locked MSI; the engine checks the flag between attempts and during
/// downloads, so it stops at a point where nothing is in flight.
#[tauri::command]
pub fn cancel_install(state: State<'_, AppState>) -> bool {
    state.cancel_active_session()
}

/// The session to offer "继续安装" for, if the last run was interrupted.
#[tauri::command]
pub fn resumable_install(state: State<'_, AppState>) -> Option<ExecutionSession> {
    state.resumable_session()
}

/// The most recent session, for the report screen. Works after a restart.
#[tauri::command]
pub fn last_install_session(state: State<'_, AppState>) -> Option<ExecutionSession> {
    state.last_session()
}

/// Where `install.log` lives, so the UI can tell the student where to look.
#[tauri::command]
pub fn install_log_path() -> String {
    install_log::log_path().to_string_lossy().to_string()
}

/// The tail of `install.log`, for the failure and cancellation panels.
///
/// Returns an empty string when no log exists yet, which is the normal state
/// before the first failure — not an error the UI should render as one.
#[tauri::command]
pub fn read_install_log(lines: Option<usize>) -> String {
    install_log::tail(lines.unwrap_or(40))
}

/// The path that the most recent run's log was written to, if any.
///
/// Exposed separately from [`read_install_log`] so the failure panel can offer
/// "打开日志" without reading the whole file into the UI first.
#[tauri::command]
pub fn install_log_exists() -> bool {
    install_log::log_path().exists()
}

/// One program's post-install verdict, in the shape the install screen shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostInstallCheck {
    pub id: SoftwareId,
    pub name: String,
    /// True only when the program is genuinely present *and* usable.
    pub ok: bool,
    /// The version the machine reported, when it reported one.
    pub version: Option<String>,
    /// The one-line verdict.
    pub message: String,
    /// A remedy, when there is one.
    pub hint: Option<String>,
}

/// What the install screen needs after a run: per-program verification, and
/// whether anything needs the student's attention.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostInstallReport {
    pub checks: Vec<PostInstallCheck>,
    /// Programs that failed verification despite the run finishing.
    pub failures: Vec<SoftwareId>,
    /// True when the run's own exit codes were all zero but something is missing.
    ///
    /// Surfaced separately because it is the confusing case: the student's
    /// terminal said the install succeeded, and the program is not there. The UI
    /// needs to say that explicitly rather than show a green tick.
    pub verified_all: bool,
}

/// Verifies an install that has just finished, by re-reading the machine.
///
/// The brief is explicit that the installer's exit code is not evidence: a
/// command can exit 0 having installed nothing usable. This re-probes the
/// machine through the same merged inventory the software list uses, so a
/// program that is present but not on `PATH`, or present at an old version, is
/// reported honestly rather than as a success.
#[tauri::command]
pub fn verify_install_result(
    plan: InstallPlan,
    state: State<'_, AppState>,
) -> PostInstallReport {
    let ids: Vec<SoftwareId> = plan.steps.iter().map(|s| s.id).collect();
    let inv = inventory::scan(&catalog::Catalog::builtin(), &ids);
    state.cache_scan(&inv);
    let scan = SoftwareScan {
        scanned_at: inv.scanned_at.clone(),
        inventory: inv,
    };
    let report = verify::verify_plan(&plan, &scan);

    let checks: Vec<PostInstallCheck> = report
        .packages
        .iter()
        .map(|package| {
            let present_ok = package.present.confidence.is_ok();
            let version_ok = package.version.confidence.is_ok();
            let ok = package.passed;

            let message = if ok {
                match package.version.observed.as_deref() {
                    Some(v) => format!("安装完成，版本: {v}"),
                    None => "安装完成".to_string(),
                }
            } else if !present_ok {
                // The case the brief names: the command finished, the program
                // is not there. Never reported as success.
                "安装执行完成，但是未检测到命令。".to_string()
            } else if !version_ok {
                package
                    .version
                    .hint
                    .clone()
                    .unwrap_or_else(|| "安装完成，但版本需要确认。".to_string())
            } else {
                package
                    .on_path
                    .hint
                    .clone()
                    .unwrap_or_else(|| "安装完成，但需要检查 PATH。".to_string())
            };

            PostInstallCheck {
                id: package.id,
                name: package.name.clone(),
                ok,
                // Prefer the version check's observation; fall back to the
                // presence check's, which carries the path when no version came
                // back — still useful, and better than showing nothing.
                version: package
                    .version
                    .observed
                    .clone()
                    .filter(|v| v != "未安装，跳过" && v != "无法确认")
                    .or_else(|| package.present.observed.clone()),
                message,
                hint: package
                    .version
                    .hint
                    .clone()
                    .or_else(|| package.present.hint.clone())
                    .or_else(|| package.on_path.hint.clone()),
            }
        })
        .collect();

    let failures: Vec<SoftwareId> = checks
        .iter()
        .filter(|c| !c.ok)
        .map(|c| c.id)
        .collect();

    // Persist the case the brief calls out: the installer exited 0 and the
    // program is still not usable. Recorded here rather than in the run's own
    // log pass because the verification outcome only exists now.
    for check in checks.iter().filter(|c| !c.ok) {
        if let Some(step) = plan.steps.iter().find(|s| s.id == check.id) {
            install_log::log_verify_failure(
                step.id.key(),
                &check.name,
                &install::describe_source(&step.source),
                &check.message,
            );
        }
    }

    PostInstallReport {
        verified_all: failures.is_empty(),
        failures,
        checks,
    }
}

/// Runs the verification pass over a plan.
#[tauri::command]
pub fn verify_installation(
    plan: InstallPlan,
    state: State<'_, AppState>,
) -> VerificationReport {
    let ids: Vec<SoftwareId> = plan.steps.iter().map(|s| s.id).collect();
    let scan = match state.cached_scan_covering(&ids) {
        Some(scan) => scan,
        None => {
            let inv = inventory::scan(&catalog::Catalog::builtin(), &ids);
            state.cache_scan(&inv);
            SoftwareScan {
                scanned_at: inv.scanned_at.clone(),
                inventory: inv,
            }
        }
    };
    verify::verify_plan(&plan, &scan)
}

/// Localisation and configuration actions implied by a profile.
///
/// A profile that does not exist is not an error here. A plan the student
/// assembled by hand has no scenario behind it, and the honest answer is "this
/// scenario declares no configuration actions" — not a failed call that leaves
/// the finishing screen showing an error for a legitimate route.
#[tauri::command]
pub fn planned_config_actions(
    profile_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<ConfigAction>> {
    let Ok(profile) = state.profiles.get(&profile_id) else {
        return Ok(Vec::new());
    };
    Ok(config::config_actions_for(&profile.software, &state.localization))
}

/// Assembles and renders the final report.
#[tauri::command]
pub fn generate_report(
    profile_id: String,
    plan: InstallPlan,
    environment: EnvironmentReport,
    verification: VerificationReport,
    state: State<'_, AppState>,
) -> AppResult<RenderedReport> {
    // A hand-picked plan names no profile. The report still has to name the
    // programs that were installed — that is the part a reader acts on — so the
    // fallback takes them from the plan itself rather than reporting nothing.
    let (report_profile_id, report_profile_name, software) = match state.profiles.get(&profile_id) {
        Ok(profile) => (
            profile.id.clone(),
            profile.name.clone(),
            profile.software.clone(),
        ),
        Err(_) => (
            plan.profile_id.clone(),
            "自选安装".to_string(),
            plan.steps.iter().map(|s| s.id).collect::<Vec<_>>(),
        ),
    };
    let actions = config::config_actions_for(&software, &state.localization);

    let report = SetupReport {
        generated_at: detect::now_iso8601(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        profile_id: report_profile_id,
        profile_name: report_profile_name,
        environment_score: environment.score,
        environment,
        plan,
        verification,
        config_actions: actions,
        // Being explicit about what did not run is a product requirement, not a
        // nicety: a report that overstates itself is worse than no report.
        not_attempted: vec![
            "MCP 服务器安装（后续版本）".into(),
            "Skills 安装（后续版本）".into(),
            "Agent 管理（后续版本）".into(),
        ],
    };

    let text = verify::render_text_report(&report);
    Ok(RenderedReport { report, text })
}

/// Writes the report to a user-visible location and returns the path.
#[tauri::command]
pub fn save_report(text: String) -> AppResult<String> {
    let dir = reports_dir()?;
    let stamp = detect::now_iso8601().replace([':', '.'], "-");
    let path = dir.join(format!("AI-Setup-Report-{stamp}.txt"));
    std::fs::write(&path, text).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(path.to_string_lossy().to_string())
}

fn reports_dir() -> AppResult<std::path::PathBuf> {
    let base = std::env::var("USERPROFILE")
        .map(std::path::PathBuf::from)
        .map_err(|_| AppError::Internal("无法定位用户目录".into()))?;
    let dir = base.join("Documents").join("Setup Center");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(dir)
}

/// Diagnostics for the settings/advanced panel: proves which modules loaded
/// from disk and which fell back to builtins.
#[tauri::command]
pub fn runtime_status(state: State<'_, AppState>) -> RuntimeStatus {
    RuntimeStatus {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        profiles_source: state
            .profiles
            .source_dir
            .as_ref()
            .map(|p| p.to_string_lossy().to_string()),
        localization_source: state
            .localization
            .source_dir
            .as_ref()
            .map(|p| p.to_string_lossy().to_string()),
        profile_count: state.profiles.all().len(),
        localization_count: state.localization.all().len(),
        warnings: state
            .profiles
            .warnings
            .iter()
            .chain(state.localization.warnings.iter())
            .cloned()
            .collect(),
        winget_version: install::winget_available().ok(),
        is_elevated: detect::probe_admin().is_elevated,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Bootstrap (stage 4)
// ---------------------------------------------------------------------------

/// The bootstrap plan for a profile: what will be configured, in stage order.
///
/// Read-only. It probes (the editor CLI, the extension list, git's config) but
/// writes nothing, so the UI can show "正在初始化" with real step names before the
/// student commits.
#[tauri::command]
pub fn build_bootstrap_plan(
    profile_id: String,
    state: State<'_, AppState>,
) -> AppResult<BootstrapPlanView> {
    let profile = state.profiles.get(&profile_id)?;
    let catalog = catalog::Catalog::builtin();
    let scan = scan_for(&state, &profile.software);
    let context = bootstrap::probe_context(&scan.inventory);
    let plan = bootstrap::plan::build_plan(&catalog, &profile, &context);

    Ok(BootstrapPlanView::from_plan(&plan))
}

/// Runs the bootstrap plan. This is the command that configures the machine.
///
/// Mirrors `run_install`: it runs on the blocking pool, participates in the
/// shared cancel flag, and returns a complete session rather than a partial one
/// the UI would have to poll.
#[tauri::command]
pub async fn run_bootstrap(
    profile_id: String,
    state: State<'_, AppState>,
) -> AppResult<BootstrapSessionView> {
    // The configuration stage is the other half of the paid tier: it writes
    // editor settings, git config and MCP files. Gated before the plan is built
    // so a refused run costs nothing but the refusal.
    require_install_rights()?;
    let profile = state.profiles.get(&profile_id)?;
    let catalog = catalog::Catalog::builtin();
    let scan = scan_for(&state, &profile.software);
    let context = bootstrap::probe_context(&scan.inventory);
    let plan = bootstrap::plan::build_plan(&catalog, &profile, &context);

    // The run context, built from the *same* probes the plan used. Building it
    // separately would risk the plan and the run disagreeing about, say, whether
    // the editor CLI exists — a plan of runnable steps executed against a
    // different machine state.
    let run_context = bootstrap_run::BootstrapContext::for_local_run(
        context.code_cli.clone(),
        context.skills_root.clone(),
    );

    let (flag, started) = state.begin_bootstrap(bootstrap_run::BootstrapSession::new_for(
        plan.profile_id.clone(),
    ));
    if !started {
        return Err(AppError::InstallFailed {
            id: "bootstrap".into(),
            reason: "已有任务正在进行中，请等待当前任务完成。".into(),
        });
    }

    // The plan is shared with the verification pass *after* the run, so the
    // spawned closure gets a clone rather than the only copy. `BootstrapPlan` is
    // `Clone` precisely for this: the alternative is to rebuild it after the run,
    // which would probe a machine the run has already changed and therefore
    // verify against a plan that describes a different starting state.
    let plan_for_run = plan.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        bootstrap_run::run_bootstrap(&plan_for_run, &run_context, &flag)
    })
    .await
    .map_err(|e| AppError::Internal(format!("配置线程异常结束：{e}")))?;

    // Verification is a *separate read* after the run, exactly as stage 3 does it
    // for installs. The evidence is gathered here rather than inside the runner so
    // that the run cannot influence it.
    let mut session = result;
    let evidence = gather_bootstrap_evidence(&plan);
    let verification = bootstrap_run::verify(&plan, &evidence);
    bootstrap_run::attach_verification(&mut session, verification);

    state.finish_bootstrap(session.clone());
    Ok(BootstrapSessionView::from_session(&session, &plan))
}

/// Asks a running bootstrap to stop. Cooperative, like `cancel_install`.
#[tauri::command]
pub fn cancel_bootstrap(state: State<'_, AppState>) -> bool {
    state.cancel_active_session()
}

/// The bootstrap session to offer "继续" for, if one was interrupted.
#[tauri::command]
pub fn resumable_bootstrap(state: State<'_, AppState>) -> Option<BootstrapSessionView> {
    let session = state.resumable_bootstrap()?;
    let profile = state.profiles.get(&session.profile_id).ok()?;
    let scan = scan_for(&state, &profile.software);
    let context = bootstrap::probe_context(&scan.inventory);
    let plan = bootstrap::plan::build_plan(&catalog::Catalog::builtin(), &profile, &context);
    Some(BootstrapSessionView::from_session(&session, &plan))
}

/// The most recent bootstrap run, for the report and for a screen that remounts.
#[tauri::command]
pub fn last_bootstrap(state: State<'_, AppState>) -> Option<BootstrapSessionView> {
    let session = state.last_bootstrap()?;
    let profile = state.profiles.get(&session.profile_id).ok()?;
    let scan = scan_for(&state, &profile.software);
    let context = bootstrap::probe_context(&scan.inventory);
    let plan = bootstrap::plan::build_plan(&catalog::Catalog::builtin(), &profile, &context);
    Some(BootstrapSessionView::from_session(&session, &plan))
}

/// Re-verifies a finished bootstrap run against the machine's *current* state.
///
/// Offered as its own command because the useful question a student asks after
/// fixing something by hand is "is it right now?", and re-running the
/// configuration to find out would be the wrong tool.
#[tauri::command]
pub fn verify_bootstrap(
    profile_id: String,
    state: State<'_, AppState>,
) -> AppResult<BootstrapVerificationView> {
    let profile = state.profiles.get(&profile_id)?;
    let scan = scan_for(&state, &profile.software);
    let context = bootstrap::probe_context(&scan.inventory);
    let plan = bootstrap::plan::build_plan(&catalog::Catalog::builtin(), &profile, &context);
    let evidence = gather_bootstrap_evidence(&plan);
    Ok(BootstrapVerificationView::from(
        bootstrap_run::verify(&plan, &evidence),
    ))
}

/// The available localisation targets, so the UI can explain what each does.
#[tauri::command]
pub fn localization_targets() -> Vec<LocalizationTargetView> {
    bootstrap::localization::provider_catalogue()
        .into_iter()
        .map(|provider| LocalizationTargetView {
            id: provider.id.clone(),
            target: provider.target.clone(),
            upstream: provider.upstream.clone(),
            method: match &provider.method {
                bootstrap::localization::LocalizationMethod::Package { .. } => {
                    "官方语言包".to_string()
                }
                bootstrap::localization::LocalizationMethod::Script { .. } => {
                    "上游社区方案".to_string()
                }
            },
        })
        .collect()
}

/// A full inventory scan, reusing the cache when it already covers `ids`.
///
/// Extracted because the bootstrap commands all need the same thing, and because
/// the cache-eligibility rule (`cached_scan_covering`, which refuses a partial
/// cache) must be applied identically or two screens would disagree.
fn scan_for(state: &AppState, ids: &[SoftwareId]) -> SoftwareScan {
    match state.cached_scan_covering(ids) {
        Some(scan) => scan,
        None => {
            let inv = inventory::scan(&catalog::Catalog::builtin(), ids);
            state.cache_scan(&inv);
            SoftwareScan {
                scanned_at: inv.scanned_at.clone(),
                inventory: inv,
            }
        }
    }
}

/// Reads the machine *after* a bootstrap run, for verification.
///
/// Deliberately a fresh set of probes rather than anything the run recorded: this
/// is the mechanism behind "不要相信执行过程". A run that reported success and
/// changed nothing produces failing checks here, which is the whole point.
fn gather_bootstrap_evidence(plan: &bootstrap::BootstrapPlan) -> bootstrap::VerifyEvidence {
    bootstrap::VerifyEvidence {
        installed_extensions: gather_installed_extensions(),
        git_config: gather_git_config(),
        existing_paths: gather_paths(plan),
        // The locale check is only meaningful when the settings file exists at
        // all; `verify_locale_in_settings` reports the missing-file case itself,
        // which is a real failure rather than an absence of evidence.
        locale: Some(bootstrap::localization::verify_locale_in_settings(
            &bootstrap::localization::localization_settings_path(),
            "zh-cn",
        )),
    }
}

fn gather_installed_extensions() -> Vec<(String, Option<String>)> {
    let catalog = catalog::Catalog::builtin();
    let Some(cli) = inventory::resolve_paths(&catalog).get(&SoftwareId::Vscode).cloned() else {
        return Vec::new();
    };
    let path = cli.to_string_lossy().to_string();
    match detect::run_capture(
        "cmd",
        &["/C", &format!("\"{path}\" --list-extensions --show-versions")],
    ) {
        Ok(text) => bootstrap::extension::parse_installed_list(&text),
        Err(_) => Vec::new(),
    }
}

fn gather_git_config() -> BTreeMap<String, String> {
    match detect::run_capture("git", &["config", "--global", "--list"]) {
        Ok(text) => bootstrap::git::parse_global_config(&text),
        Err(_) => BTreeMap::new(),
    }
}

/// Whether each file and skill the plan wrote is now on disk.
///
/// Keyed exactly as the checks look up, via the `VerifyEvidence` constructors, so
/// a key mismatch cannot silently turn every check into "unknown". Works from the
/// *domain* plan rather than the view, because the view has already flattened the
/// action into strings.
fn gather_paths(plan: &bootstrap::BootstrapPlan) -> BTreeMap<String, bool> {
    use bootstrap::plan::BootstrapAction;

    let mut paths = BTreeMap::new();
    for step in &plan.steps {
        match &step.action {
            BootstrapAction::FileWrite { path, .. } => {
                paths.insert(
                    bootstrap::VerifyEvidence::file_key(path),
                    path.is_file(),
                );
            }
            BootstrapAction::SkillInstall {
                name, target_root, ..
            } => {
                paths.insert(
                    bootstrap::VerifyEvidence::skill_key(name),
                    target_root.join(name).join("SKILL.md").is_file(),
                );
            }
            _ => {}
        }
    }
    paths
}

// ---------------------------------------------------------------------------
// Bootstrap payloads
// ---------------------------------------------------------------------------

/// What kind of work a bootstrap step does.
///
/// Sent to the UI so it can group and label without parsing an action id. Kept a
/// flat enum rather than the full `BootstrapAction`: the frontend never needs the
/// action's parameters, only what to call it and how to show its progress.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BootstrapStepKind {
    Extension,
    ConfigCommand,
    FileWrite,
    SkillInstall,
    Localization,
}

/// One planned bootstrap step, in the shape the UI renders.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStepView {
    pub action_id: String,
    pub stage: String,
    pub stage_name: String,
    pub kind: BootstrapStepKind,
    /// Short label, e.g. `安装 VS Code 插件 ms-python.python`.
    pub name: String,
    /// The concrete target: an absolute path, an extension id, a config key.
    pub target: Option<String>,
    pub rationale: String,
    pub needed: bool,
    pub skip_reason: Option<String>,
    pub blocked: Option<String>,
}

/// Per-stage rollup for the progress list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStageView {
    pub key: String,
    pub name: String,
    pub total: u32,
    pub needed: u32,
    pub blocked: u32,
}

/// The whole plan, as the UI consumes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPlanView {
    pub profile_id: String,
    pub steps: Vec<BootstrapStepView>,
    pub stages: Vec<BootstrapStageView>,
    pub needed_count: u32,
    pub blocked_count: u32,
    /// Things deliberately not done, so the UI can state them.
    pub not_attempted: Vec<String>,
}

impl BootstrapPlanView {
    fn from_plan(plan: &bootstrap::BootstrapPlan) -> Self {
        Self {
            profile_id: plan.profile_id.clone(),
            steps: plan
                .steps
                .iter()
                .map(|step| BootstrapStepView {
                    action_id: step.action.id(),
                    stage: step.stage.key().to_string(),
                    stage_name: step.stage.display_name().to_string(),
                    kind: step_kind(&step.action),
                    name: step.action.description(),
                    target: step_target(&step.action),
                    rationale: step.rationale.clone(),
                    needed: step.needed,
                    skip_reason: step.skip_reason.clone(),
                    blocked: step.blocked.clone(),
                })
                .collect(),
            stages: plan
                .stages
                .iter()
                .map(|s| BootstrapStageView {
                    key: s.key.clone(),
                    name: s.name.clone(),
                    total: s.total,
                    needed: s.needed,
                    blocked: s.blocked,
                })
                .collect(),
            needed_count: plan.needed_count(),
            blocked_count: plan.blocked_count(),
            not_attempted: plan.not_attempted.clone(),
        }
    }
}

fn step_kind(action: &bootstrap::plan::BootstrapAction) -> BootstrapStepKind {
    use bootstrap::plan::BootstrapAction;
    match action {
        BootstrapAction::Extension { .. } => BootstrapStepKind::Extension,
        BootstrapAction::ConfigCommand { .. } => BootstrapStepKind::ConfigCommand,
        BootstrapAction::FileWrite { .. } => BootstrapStepKind::FileWrite,
        BootstrapAction::SkillInstall { .. } => BootstrapStepKind::SkillInstall,
        BootstrapAction::Localization { .. } => BootstrapStepKind::Localization,
    }
}

fn step_target(action: &bootstrap::plan::BootstrapAction) -> Option<String> {
    use bootstrap::plan::BootstrapAction;
    match action {
        BootstrapAction::Extension { id, .. } => Some(id.clone()),
        BootstrapAction::ConfigCommand { key, .. } => Some(key.clone()),
        BootstrapAction::FileWrite { path, .. } => Some(path.to_string_lossy().to_string()),
        BootstrapAction::SkillInstall { target_root, name, .. } => {
            Some(target_root.join(name).to_string_lossy().to_string())
        }
        BootstrapAction::Localization { id, .. } => Some(id.clone()),
    }
}

/// One step's result, for the progress list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStepResultView {
    pub action_id: String,
    pub stage: String,
    /// `pending` | `running` | `succeeded` | `succeededWithWarning` | `failed` |
    /// `skipped` | `cancelled`.
    pub status: String,
    /// The "current action" line.
    pub stage_label: String,
    pub name: String,
    pub detail: Option<String>,
}

/// One verification check, for the report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapCheckView {
    pub key: String,
    pub label: String,
    pub confidence: Confidence,
    pub expected: String,
    pub observed: String,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapVerificationView {
    pub checks: Vec<BootstrapCheckView>,
    pub passed: u32,
    pub failed: u32,
    pub unknown: u32,
    pub overall_ok: bool,
    /// One-line summary, so the UI does not have to build the sentence.
    pub summary: String,
}

impl From<bootstrap::BootstrapVerification> for BootstrapVerificationView {
    fn from(v: bootstrap::BootstrapVerification) -> Self {
        Self {
            summary: bootstrap::summarize(&v),
            checks: v
                .checks
                .into_iter()
                .map(|c| BootstrapCheckView {
                    key: c.key,
                    label: c.label,
                    confidence: c.confidence,
                    expected: c.expected,
                    observed: c.observed,
                    hint: c.hint,
                })
                .collect(),
            passed: v.passed,
            failed: v.failed,
            unknown: v.unknown,
            overall_ok: v.overall_ok,
        }
    }
}

/// The whole bootstrap session, as the UI consumes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapSessionView {
    pub id: String,
    pub profile_id: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub steps: Vec<BootstrapStepResultView>,
    pub succeeded_count: u32,
    pub failed_steps: Vec<String>,
    pub remaining: Vec<String>,
    pub halted_reason: Option<String>,
    pub resumable: bool,
    pub verification: Option<BootstrapVerificationView>,
    /// The plan's per-stage rollup, so the list renders identically before and
    /// after the run.
    pub stages: Vec<BootstrapStageView>,
}

impl BootstrapSessionView {
    fn from_session(
        session: &bootstrap::BootstrapSession,
        plan: &bootstrap::BootstrapPlan,
    ) -> Self {
        // Status comes from the session, never from the plan's pre-run snapshot:
        // a step planned as "needed" could have been satisfied by an earlier step,
        // and one planned as satisfied could have been undone by hand.
        Self {
            id: session.id.clone(),
            profile_id: session.profile_id.clone(),
            started_at: session.started_at.clone(),
            finished_at: session.finished_at.clone(),
            steps: session
                .steps
                .iter()
                .map(|s| BootstrapStepResultView {
                    action_id: s.action_id.clone(),
                    stage: s.stage.key().to_string(),
                    status: status_key(s.status).to_string(),
                    stage_label: s.stage_label.clone(),
                    name: s.name.clone(),
                    detail: s.detail.clone(),
                })
                .collect(),
            succeeded_count: session.succeeded_count(),
            failed_steps: session.failed_steps.clone(),
            remaining: session.remaining.clone(),
            halted_reason: session.halted_reason.clone(),
            resumable: session.is_resumable(),
            verification: session
                .verified
                .clone()
                .map(BootstrapVerificationView::from),
            stages: plan
                .stages
                .iter()
                .map(|s| BootstrapStageView {
                    key: s.key.clone(),
                    name: s.name.clone(),
                    total: s.total,
                    needed: s.needed,
                    blocked: s.blocked,
                })
                .collect(),
        }
    }
}

fn status_key(status: StepStatus) -> &'static str {
    match status {
        StepStatus::Pending => "pending",
        StepStatus::Running => "running",
        StepStatus::Succeeded => "succeeded",
        StepStatus::SucceededWithWarning => "succeededWithWarning",
        StepStatus::Failed => "failed",
        StepStatus::Skipped => "skipped",
        StepStatus::Cancelled => "cancelled",
    }
}

/// One localisation target, for the UI's explanation list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalizationTargetView {
    pub id: String,
    pub target: String,
    /// The upstream project, shown so the student can see whose code will run.
    pub upstream: String,
    /// `官方语言包` or `上游社区方案`.
    pub method: String,
}

// ---------------------------------------------------------------------------
// Command payloads that are not domain types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStrategy {
    pub id: SoftwareId,
    pub name: String,
    pub purpose: String,
    pub preferred: String,
    pub fallbacks: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedReport {
    pub report: SetupReport,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub app_version: String,
    pub profiles_source: Option<String>,
    pub localization_source: Option<String>,
    pub profile_count: usize,
    pub localization_count: usize,
    pub warnings: Vec<String>,
    pub winget_version: Option<String>,
    pub is_elevated: bool,
    pub os: String,
    pub arch: String,
}

// ---------------------------------------------------------------------------
// Stage 5: knowledge, goals, advisor
// ---------------------------------------------------------------------------

/// Everything the dashboard needs to explain one program.
///
/// Bundles the knowledge with the *measured* state so a row can be rendered in
/// one call instead of three. The two are kept as separate fields rather than
/// merged: the UI must never be able to mistake an explanation for a fact, and
/// a flat struct would invite exactly that.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainedSoftwareView {
    pub knowledge: knowledge::ShownKnowledge,
    /// `Some` when an inventory has been taken.
    pub installed: Option<bool>,
    pub on_path: Option<bool>,
    /// Version as reported by the machine, when the probe returned one.
    pub version: Option<String>,
    /// `detected` | `unknown` — never a bool, so "we could not check" survives
    /// the trip to the UI.
    pub confidence: String,
    /// Which probe produced the answer, for the "检测来源" row.
    pub evidence: Vec<String>,
    /// Capability ids this program is part of, resolved to display names.
    pub capability_names: Vec<String>,
    /// Version notes that apply to the installed version.
    ///
    /// Empty when the version could not be read, which is the honest answer:
    /// a note about 3.13 is not information about an unknown version.
    pub applicable_notes: Vec<knowledge::VersionNote>,
}

/// The full explanation view for one program.
///
/// Reads *only* the cached inventory and environment. Re-probing here would let
/// the detail pane disagree with the row above it, which is the class of bug the
/// capability layer was built to avoid.
#[tauri::command]
pub fn explain_software(
    id: SoftwareId,
    state: State<'_, AppState>,
) -> AppResult<ExplainedSoftwareView> {
    Ok(explain_one(id, &state))
}

/// The body of [`explain_software`], taking `&AppState` so it can be called in a
/// loop without the Tauri `State` wrapper.
fn explain_one(id: SoftwareId, state: &AppState) -> ExplainedSoftwareView {
    let knowledge = state.knowledge.shown_for(id);
    let inventory = state.last_scan();
    let inventory_item = inventory.as_ref().and_then(|inv| inv.find(id));

    let version = inventory_item.and_then(|item| item.version.clone());
    let applicable_notes = version
        .as_deref()
        .map(|v| {
            knowledge
                .versions
                .iter()
                .filter(|n| n.applies_to(v))
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    let capability_names = knowledge
        .related_capabilities
        .iter()
        .filter_map(|c| capability::lookup_by_str(c))
        .map(|spec| spec.name.to_string())
        .collect();

    ExplainedSoftwareView {
        knowledge,
        installed: inventory_item.map(|i| i.installed),
        on_path: inventory_item.map(|i| i.on_path),
        version,
        confidence: match inventory_item.map(|i| i.confidence) {
            Some(Confidence::Ok) => "confirmed".into(),
            Some(Confidence::Fail) => "confirmedAbsent".into(),
            Some(Confidence::Unknown) => "unknown".into(),
            Some(Confidence::Skipped) => "skipped".into(),
            None => "notScanned".into(),
        },
        evidence: inventory_item
            .map(|i| {
                i.evidence
                    .iter()
                    .map(|e| match &e.detail {
                        Some(d) => format!("{} · {d}", source_label(e.source)),
                        None => format!("{} · {}", source_label(e.source), e.outcome),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        capability_names,
        applicable_notes,
    }
}

/// Every program the catalog knows, with its explanation and its state.
///
/// One call rather than a call per row: the dashboard renders all of them, and N
/// IPC round-trips would make the screen paint in stages.
#[tauri::command]
pub fn explained_catalogue(state: State<'_, AppState>) -> Vec<ExplainedSoftwareView> {
    SoftwareId::ALL
        .iter()
        .map(|id| explain_one(*id, &state))
        .collect()
}

/// The goals a student can pick, with what each needs.
#[tauri::command]
pub fn list_goals(state: State<'_, AppState>) -> GoalListView {
    let profile_ids: Vec<String> = state.profiles.all().into_iter().map(|p| p.id).collect();
    GoalListView {
        goals: knowledge::goal::all()
            .iter()
            .map(|spec| knowledge::goal::GoalView::from_spec(spec, profile_ids.contains(&spec.profile_id.to_string())))
            .collect(),
        // A goal whose profile is missing is reported rather than hidden: the
        // analysis is still true even when the app cannot act on it.
        goals_without_profiles: knowledge::goal::goals_without_profiles(&profile_ids),
        default_goal: knowledge::goal::default_goal().id.to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalListView {
    pub goals: Vec<knowledge::goal::GoalView>,
    pub goals_without_profiles: Vec<String>,
    pub default_goal: String,
}

/// Resolves one goal against this machine: completion, gaps, next steps.
///
/// A *read*, like `capability_report`. Looking is free, which is what makes it
/// reasonable to ask the student to choose a direction before committing to
/// anything — they can try all six and see what each would take.
#[tauri::command]
pub fn environment_plan(
    goal_id: String,
    state: State<'_, AppState>,
) -> AppResult<knowledge::goal::EnvironmentPlan> {
    let spec = knowledge::goal::lookup(&goal_id).ok_or_else(|| AppError::ProfileNotFound {
        id: goal_id.clone(),
    })?;
    let statuses = capability_statuses(&state);
    Ok(plan_for(spec, &state, &statuses))
}

/// Resolves one goal row against already-resolved capabilities.
///
/// Takes `statuses` rather than deriving them so a caller resolving every goal
/// does one capability pass instead of six — `probe_manual_facts` shells out to
/// Git, and six of those would be six processes to answer one question.
fn plan_for(
    spec: &'static knowledge::goal::GoalSpec,
    state: &AppState,
    statuses: &[capability::CapabilityStatus],
) -> knowledge::goal::EnvironmentPlan {
    let profile_name = state
        .profiles
        .get(spec.profile_id)
        .map(|p| p.name)
        .unwrap_or_else(|_| spec.profile_id.to_string());
    knowledge::goal::resolve(spec, statuses, &state.knowledge, &profile_name)
}

/// Every goal resolved, for the advisor's "适合的方向" list.
#[tauri::command]
pub fn environment_plans(state: State<'_, AppState>) -> Vec<knowledge::goal::EnvironmentPlan> {
    all_plans(&state)
}

fn all_plans(state: &AppState) -> Vec<knowledge::goal::EnvironmentPlan> {
    let statuses = capability_statuses(state);
    knowledge::goal::all()
        .iter()
        .map(|spec| plan_for(spec, state, &statuses))
        .collect()
}
/// The advisory analysis of this machine.
///
/// Built from capability statuses and the inventory — **never** from an
/// execution session. See the `advisor` module doc for why that distinction is
/// the whole point of this command.
#[tauri::command]
pub fn advisor_summary(state: State<'_, AppState>) -> AppResult<AdvisorView> {
    let statuses = capability_statuses(&state);
    let inventory = state.last_scan();
    let plans = all_plans(&state);

    let summary = knowledge::advisor::summarize(
        &statuses,
        inventory.as_ref(),
        &plans,
        &state.knowledge,
    );
    let machine = knowledge::advisor::assess_machine(state.last_environment().as_ref());

    Ok(AdvisorView {
        summary,
        machine,
        // `None` when no detection has run, so the UI can say "尚未检测" rather
        // than render a report about a machine nobody looked at.
        detected: state.last_environment().is_some(),
    })
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorView {
    pub summary: knowledge::advisor::AdvisorSummary,
    pub machine: Option<knowledge::advisor::MachineAssessment>,
    pub detected: bool,
}

/// The advisor analysis rendered as text, for export.
#[tauri::command]
pub fn advisor_report_text(state: State<'_, AppState>) -> AppResult<String> {
    let view = advisor_summary(state)?;
    Ok(knowledge::advisor::render_text(
        &view.summary,
        view.machine.as_ref(),
    ))
}

/// Explanations for the concepts a student will meet.
#[tauri::command]
pub fn concept_notes(
    capability_id: Option<String>,
    state: State<'_, AppState>,
) -> Vec<ConceptView> {
    match capability_id {
        Some(cap) => state
            .knowledge
            .concepts_for_capability(&cap)
            .into_iter()
            .map(ConceptView::from)
            .collect(),
        None => state
            .knowledge
            .all_concepts()
            .into_iter()
            .map(ConceptView::from)
            .collect(),
    }
}

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptView {
    pub id: String,
    pub name: String,
    pub category: String,
    pub summary: String,
    pub why_it_matters: String,
    pub related_capabilities: Vec<String>,
}

// ---------------------------------------------------------------------------
// Licensing
// ---------------------------------------------------------------------------

/// What this build is allowed to do, and why.
///
/// A pure read with no side effects, like `capability_report`: the licence
/// screen has to be able to ask without changing anything.
///
/// Note what this returns rather than a bare boolean. A screen that has to say
/// "免费版" beside a lock needs both the tier *and* the reason, and deriving
/// either in the frontend would let two screens explain the same state
/// differently.
#[tauri::command]
pub fn license_status() -> license::Entitlements {
    license::Entitlements::of(&license::load(), license::enforcement_enabled())
}

/// Activates a key locally and returns the resulting entitlements.
///
/// Returned rather than requiring a follow-up `license_status` call, so the UI
/// can never render a stale tier between activating and re-reading.
#[tauri::command]
pub fn activate_license(key: String) -> AppResult<license::Entitlements> {
    let file = license::activate(&key)?;
    Ok(license::Entitlements::of(
        &file,
        license::enforcement_enabled(),
    ))
}

/// Clears the activation and returns the machine to its default state.
#[tauri::command]
pub fn deactivate_license() -> AppResult<license::Entitlements> {
    let file = license::deactivate()?;
    Ok(license::Entitlements::of(
        &file,
        license::enforcement_enabled(),
    ))
}

/// What the licence screen may show about this machine's binding.
///
/// Deliberately a *summary*, not the fingerprint's inputs. The screen needs to
/// say "设备绑定：当前设备" and, when something looks wrong, whether the hardware
/// probes were even readable — it has no use for the raw `MachineGuid`, and
/// handing it over would put a stable machine identifier one screenshot away
/// from being pasted somewhere public.
///
/// There is no command for reading the activation code back, and that is a
/// design decision rather than an omission: see the brief's "用户不可查看". A
/// `get_license_key` command would be the single most obvious thing to add here,
/// and it is exactly what must not exist.
#[tauri::command]
pub fn license_device() -> LicenseDeviceView {
    let (hash, components) = license::device_summary();
    let entitlements = license::Entitlements::of(&license::load(), license::enforcement_enabled());

    LicenseDeviceView {
        // First 8 hex characters only. Enough that two machines are visibly
        // different in a support conversation, not enough to correlate.
        short_id: hash.chars().take(8).collect(),
        components_readable: components,
        reliable: entitlements.device_reliable,
        bound_here: entitlements.state == license::LicenseState::Active,
        state: entitlements.state,
    }
}

/// What the licence screen may show about the machine binding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseDeviceView {
    /// Abbreviated device digest, for display only.
    pub short_id: String,
    /// How many hardware probes produced a value (0-4).
    pub components_readable: usize,
    /// Whether that count is high enough for a mismatch to be meaningful.
    pub reliable: bool,
    /// Whether the stored activation belongs to this machine.
    pub bound_here: bool,
    pub state: license::LicenseState,
}

/// The plugin catalogue resolved against this machine.
///
/// A read that *does* probe: each row's verdict — "可安装" / "版本未验证" /
/// "目标未安装" — depends on the Claude actually present, not on what the
/// manifest remembered. The probes are `CREATE_NO_WINDOW` children, so
/// refreshing the screen never flashes a console.
#[tauri::command]
pub async fn plugin_views(
    state: State<'_, AppState>,
) -> AppResult<Vec<plugins::PluginView>> {
    Ok(plugins::pipeline::views(&state.plugins))
}

/// The two Claude targets, for the status line above the plugin list
/// ("Claude Desktop 已安装 ✓" from brief item 12).
#[tauri::command]
pub async fn plugin_targets() -> Vec<plugins::TargetState> {
    plugins::pipeline::targets()
}

/// Runs one pipeline invocation
/// (`dryRun` | `install` | `verify` | `rollback` | `adopt`)
/// and returns the complete stage record.
///
/// `mode` arrives as a string because that is what the button knows, and is
/// parsed here: an unknown mode must be a rejected command, never a silent
/// fallback to a dry run the caller believed was a write. A dry run shares the
/// install path and stops before `apply`, so what the preview reports is what
/// the install would actually touch.
#[tauri::command]
pub async fn run_plugin(
    state: State<'_, AppState>,
    id: String,
    mode: String,
    allow_unverified: bool,
) -> AppResult<plugins::PluginRun> {
    let mode = match mode.as_str() {
        "dryRun" => plugins::RunMode::DryRun,
        "install" => plugins::RunMode::Install,
        "verify" => plugins::RunMode::Verify,
        "rollback" => plugins::RunMode::Rollback,
        "adopt" => plugins::RunMode::Adopt,
        other => return Err(AppError::Internal(format!("unknown plugin run mode: {other}"))),
    };
    let entry = state
        .plugins
        .get(&id)
        .ok_or_else(|| AppError::Internal(format!("plugin not in catalogue: {id}")))?;
    // Deliberately not gated by `require_install_rights`: `PluginEntry::free`
    // is documented as unrelated to the PRO tier, and no brief places the
    // plugin pipeline behind the licence. Gating it here would refuse paying
    // nothing for a free feature.
    Ok(plugins::pipeline::run(
        entry,
        mode,
        &plugins::pipeline::RunOptions {
            allow_unverified,
            ..Default::default()
        },
    ))
}

/// Runs a native command with arguments and working directory, returning captured stdout/stderr.
#[tauri::command]
pub async fn execute_native_command(
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<system_ops::CommandOutput, String> {
    tauri::async_runtime::spawn_blocking(move || {
        system_ops::run_command(&program, &args, cwd.as_deref())
    })
    .await
    .map_err(|e| format!("命令执行异常: {e}"))?
}

/// Starts streaming command execution emitting stdout/stderr/exit events over Tauri channel.
#[tauri::command]
pub fn execute_streaming_command(
    window: tauri::Window,
    execution_id: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    system_ops::spawn_streaming_command(window, execution_id, program, args, cwd)
}

/// Cancels a running streaming execution.
#[tauri::command]
pub fn cancel_native_execution(execution_id: String) -> Result<bool, String> {
    system_ops::cancel_process(&execution_id)
}

/// Downloads a remote file to a destination path using native curl streaming.
#[tauri::command]
pub async fn native_download(url: String, destination_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        system_ops::download_file(&url, &destination_path)
    })
    .await
    .map_err(|e| format!("下载异常: {e}"))?
}

/// Searches winget for packages matching query.
#[tauri::command]
pub async fn winget_search(query: String) -> Result<Vec<system_ops::WingetSearchResultItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        system_ops::search_winget(&query)
    })
    .await
    .map_err(|e| format!("winget 检索异常: {e}"))?
}

/// Fetches rich details for a specific winget package id.
#[tauri::command]
pub async fn winget_show(package_id: String) -> Result<system_ops::WingetPackageDetails, String> {
    tauri::async_runtime::spawn_blocking(move || {
        system_ops::show_winget(&package_id)
    })
    .await
    .map_err(|e| format!("winget 详情获取异常: {e}"))?
}

/// Reveals a file or directory in Windows Explorer.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    system_ops::reveal_path(&path)
}

/// Opens a URL in the user's default system browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    system_ops::open_url(&url)
}

/// Detects available code editors on the system.
#[tauri::command]
pub fn detect_editors() -> Vec<system_ops::DetectedEditor> {
    system_ops::probe_editors()
}

/// Opens a path in the specified editor, optionally using the detected executable path directly.
#[tauri::command]
pub fn open_in_editor(editor: String, path: String, executable_path: Option<String>) -> Result<(), String> {
    system_ops::launch_in_editor(&editor, &path, executable_path.as_deref())
}

/// Returns the canonical app version from Cargo manifest.
#[tauri::command]
pub fn app_canonical_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Returns the user's authentic Downloads directory.
#[tauri::command]
pub fn get_downloads_dir() -> Result<String, String> {
    system_ops::get_downloads_dir()
}

/// Verifies a downloaded file's SHA256 against an expected hash.
#[tauri::command]
pub fn verify_file_sha256(path: String, expected_sha256: String) -> Result<bool, String> {
    system_ops::verify_file_sha256(&path, &expected_sha256)
}

impl From<&knowledge::ConceptKnowledge> for ConceptView {
    fn from(c: &knowledge::ConceptKnowledge) -> Self {
        Self {
            id: c.id.clone(),
            name: c.name.clone(),
            category: c.category.clone(),
            summary: c.summary.clone(),
            why_it_matters: c.why_it_matters.clone(),
            related_capabilities: c.related_capabilities.clone(),
        }
    }
}

/// The resolved capability rows, shared by every stage-5 command.
///
/// Extracted so `capability_report`, `environment_plan` and `advisor_summary`
/// cannot drift: three commands that each built their own statuses would
/// eventually disagree about the same machine.
///
/// Takes `&AppState` rather than `State<'_, AppState>` so the plain functions
/// above can share it. `State` derefs to `AppState`, so every command call site
/// passes `&state` and gets the same behaviour.
fn capability_statuses(state: &AppState) -> Vec<capability::CapabilityStatus> {
    let environment = state.last_environment();
    let inventory = state.last_scan();
    let manual = capability::probe_manual_facts(inventory.as_ref());
    let facts = capability::facts_from(environment.as_ref(), inventory.as_ref(), manual);
    capability::resolve(&facts, None)
}

/// A short label for a probe source, for the "检测来源" row.
///
/// The `Debug` spelling is deliberately not used: it renders as
/// `AppPaths`/`RegistryUninstall`, which is developer vocabulary leaking into a
/// screen a first-year student reads.
fn source_label(source: ProbeSource) -> &'static str {
    match source {
        ProbeSource::Registry => "系统注册表",
        ProbeSource::Path => "命令行路径",
        ProbeSource::Winget => "winget 包列表",
    }
}

/// Warnings from the knowledge base, for the status screen.
#[tauri::command]
pub fn knowledge_status(state: State<'_, AppState>) -> KnowledgeStatus {
    KnowledgeStatus {
        software_count: state.knowledge.software_count(),
        concept_count: state.knowledge.concept_count(),
        source_dir: state.knowledge.source_dir.as_ref().map(|d| d.display().to_string()),
        warnings: state.knowledge.warnings.clone(),
        without_knowledge: state
            .knowledge
            .software_without_knowledge()
            .iter()
            .map(|id| id.key().to_string())
            .collect(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeStatus {
    pub software_count: usize,
    pub concept_count: usize,
    pub source_dir: Option<String>,
    pub warnings: Vec<String>,
    /// Catalogued programs with no knowledge entry, reported rather than hidden
    /// so incomplete coverage is visible instead of being discovered by diffing.
    pub without_knowledge: Vec<String>,
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// The progress event name is duplicated in TypeScript, so it is guarded.
    ///
    /// `src/lib/ipc.ts` cannot import a Rust constant, and a mismatch between
    /// the two would be silent in the worst way: Rust would emit on a channel
    /// nobody listens to and the install screen would fall back to the 0.1.1
    /// behaviour of showing nothing for the whole run. That is the exact defect
    /// this phase exists to fix, so it must not be reintroducible by a rename.
    #[test]
    fn the_progress_event_name_matches_the_frontend_listener() {
        const IPC_TS: &str = include_str!("../../src/lib/ipc.ts");
        let expected = format!("export const INSTALL_PROGRESS_EVENT = \"{}\"", INSTALL_PROGRESS_EVENT);
        assert!(
            IPC_TS.contains(&expected),
            "src/lib/ipc.ts must declare {expected:?}; the Rust emitter and the \
             frontend listener have drifted apart"
        );
    }

    // -----------------------------------------------------------------------
    // The enforcement boundary
    //
    // `modules::license` proves the *decision* is right, and `tools/ui-verify.mjs`
    // proves the screen *reports* it. Neither proves the decision is consulted
    // on the path that actually changes the machine — a perfect gate that the
    // installer never calls would pass both.
    //
    // These assertions cover that gap. They drive `require_install_rights`
    // directly, which is the function all three mutating commands call, so the
    // wiring asserted here is the wiring that ships (see the call sites in
    // `run_install`, `resume_install` and `run_bootstrap`).
    // -----------------------------------------------------------------------

    /// Swaps the global enforcement switch for the duration of `body`.
    ///
    /// The flag is read from the environment, so it is process-wide; tests run
    /// in threads. `cargo test` would otherwise make these two assertions flaky
    /// by interleaving with each other.
    fn with_enforcement<T>(on: bool, body: impl FnOnce() -> T) -> T {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let previous = std::env::var("AISSETUP_ENFORCE_TIERS").ok();
        std::env::set_var("AISSETUP_ENFORCE_TIERS", if on { "1" } else { "0" });
        let out = body();
        match previous {
            Some(v) => std::env::set_var("AISSETUP_ENFORCE_TIERS", v),
            None => std::env::remove_var("AISSETUP_ENFORCE_TIERS"),
        }
        out
    }

    #[test]
    fn the_install_gate_refuses_an_unactivated_machine() {
        // The commercial boundary. If this ever returns `Ok`, installation runs
        // for free and the product has no paid tier whatever the UI says.
        with_enforcement(true, || {
            let _ = license::deactivate();

            // Asserted rather than assumed. An earlier draft wrapped the check
            // in `if !can_install`, which made the test pass vacuously on an
            // activated machine — a green result that had measured nothing.
            assert!(
                !license::Entitlements::of(&license::load(), true).can_install,
                "precondition: a deactivated machine with enforcement on must not be entitled"
            );

            let refused = require_install_rights();
            assert!(
                refused.is_err(),
                "an unactivated machine was allowed to install"
            );
            assert!(
                matches!(refused, Err(AppError::LicenseRequired { .. })),
                "the refusal must be a distinguishable kind, not a generic error"
            );
        });
    }

    #[test]
    fn the_install_gate_opens_when_enforcement_is_off() {
        // The development escape hatch must reach the boundary too, not merely
        // the projection the UI reads.
        with_enforcement(false, || {
            assert!(
                require_install_rights().is_ok(),
                "with enforcement off the gate must not refuse"
            );
        });
    }

    #[test]
    fn the_refusal_carries_the_sentence_the_ui_shows() {
        // `refusalOrError` in the store puts this string in front of the
        // customer. An empty or boilerplate reason would render a lock with
        // nothing explaining it.
        with_enforcement(true, || {
            let _ = license::deactivate();
            // Non-vacuous: this must actually be a refusal for the assertion
            // below to have observed anything.
            let refused = require_install_rights();
            let Err(AppError::LicenseRequired { reason }) = refused else {
                panic!("expected a licence refusal, got {refused:?}");
            };
            assert!(!reason.is_empty());
            assert!(
                reason.contains("免费版") || reason.contains("专业版"),
                "the refusal must name the tiers: {reason}"
            );
        });
    }

    /// State with the compiled-in resources, which is what `cargo test` always
    /// has. `None` makes the stores fall back exactly as the shipped binary does
    /// when the resource directory is absent.
    fn state() -> AppState {
        AppState::new(None)
    }

    fn detected_state() -> AppState {
        let s = state();
        let report = detect::detect(s.required_download_mb()).expect("detection");
        s.cache_environment(&report);
        let inv = inventory::scan(&catalog::Catalog::builtin(), &SoftwareId::ALL);
        s.cache_scan(&inv);
        s
    }

    // -- explained software -------------------------------------------------

    #[test]
    fn every_catalogued_program_explains_something_without_an_inventory() {
        // The first-run state: the catalogue is browsable before any scan has
        // happened, and every row must already say what the program is for.
        let s = state();
        let out = explained_catalogue_view(&s);
        assert_eq!(out.len(), SoftwareId::ALL.len());
        for view in &out {
            assert!(!view.knowledge.name.trim().is_empty(), "{:?}", view.knowledge.id);
            assert!(
                !view.knowledge.description.trim().is_empty(),
                "{:?}",
                view.knowledge.id
            );
            // No scan yet, so state is absent rather than guessed.
            assert!(view.installed.is_none());
            assert_eq!(view.confidence, "notScanned");
        }
    }

    #[test]
    fn a_detected_machine_reports_state_per_program_not_globally() {
        let s = detected_state();
        let out = explained_catalogue_view(&s);
        assert!(out.iter().all(|v| v.installed.is_some()));
        assert!(out.iter().all(|v| v.confidence != "notScanned"));
    }

    #[test]
    fn a_version_note_is_attached_only_when_the_version_is_known() {
        // The failure this prevents: showing "3.13/3.14 may need 3.12" under a
        // program whose version we could not read.
        let s = state();
        let py = explain_one(SoftwareId::Python, &s);
        assert!(py.version.is_none(), "no inventory means no version");
        assert!(
            py.applicable_notes.is_empty(),
            "a note about a version we do not have is not information"
        );
    }

    #[test]
    fn an_installed_version_selects_the_matching_note() {
        let s = state();
        // Build an inventory by hand: the machine under test may not have Python
        // at all, and this asserts the matching logic, not the machine.
        let mut inv = inventory::scan(&catalog::Catalog::builtin(), &[SoftwareId::Python]);
        for item in &mut inv.items {
            if item.id == SoftwareId::Python {
                item.installed = true;
                item.on_path = true;
                item.version = Some("3.14.1".into());
            }
        }
        s.cache_scan(&inv);

        let py = explain_one(SoftwareId::Python, &s);
        assert_eq!(py.version.as_deref(), Some("3.14.1"));
        assert!(
            !py.applicable_notes.is_empty(),
            "3.14 should match the compatibility note"
        );
        assert!(py.applicable_notes.iter().any(|n| n.topic.contains("兼容")));
    }

    #[test]
    fn a_version_outside_the_note_range_selects_no_note() {
        let s = state();
        let mut inv = inventory::scan(&catalog::Catalog::builtin(), &[SoftwareId::Python]);
        for item in &mut inv.items {
            if item.id == SoftwareId::Python {
                item.installed = true;
                item.version = Some("3.11.9".into());
            }
        }
        s.cache_scan(&inv);

        let py = explain_one(SoftwareId::Python, &s);
        assert_eq!(py.version.as_deref(), Some("3.11.9"));
        assert!(
            py.applicable_notes.iter().all(|n| !n.topic.contains("兼容")),
            "3.11 is inside the supported range: {:?}",
            py.applicable_notes
        );
    }

    #[test]
    fn capability_names_on_an_explained_row_are_display_names() {
        let s = state();
        let git = explain_one(SoftwareId::Git, &s);
        assert!(
            git.capability_names.iter().any(|n| n == "Git 协作"),
            "{:?}",
            git.capability_names
        );
        // Not the raw id — that is developer vocabulary.
        assert!(!git.capability_names.iter().any(|n| n == "git-collaboration"));
    }

    #[test]
    fn a_program_with_no_knowledge_entry_still_returns_a_usable_view() {
        // Simulates a knowledge base that does not cover this program by asking
        // about one the shipped files omit.
        let s = state();
        let missing = s.knowledge.software_without_knowledge();
        for id in missing {
            let view = explain_one(id, &s);
            assert!(!view.knowledge.name.trim().is_empty());
            assert!(!view.knowledge.description.trim().is_empty());
            assert!(!view.knowledge.from_knowledge);
        }
    }

    // -- goals --------------------------------------------------------------

    #[test]
    fn goals_list_reports_every_row_with_its_needs() {
        let s = state();
        let view = list_goals_view(&s);
        assert_eq!(view.goals.len(), knowledge::goal::TABLE.len());
        assert!(view.goals.iter().all(|g| !g.needs.is_empty()));
        assert!(view.goals.iter().all(|g| !g.name.trim().is_empty()));
        assert_eq!(view.default_goal, "ai_application");
    }

    #[test]
    fn every_goal_points_at_a_profile_that_ships() {
        // The link that makes a goal actionable. If this fails, the app would
        // recommend a direction it cannot install.
        let s = state();
        let view = list_goals_view(&s);
        assert!(
            view.goals_without_profiles.is_empty(),
            "goals with no profile: {:?}",
            view.goals_without_profiles
        );
        assert!(view.goals.iter().all(|g| !g.profile_id.is_empty()));
    }

    #[test]
    fn different_goals_resolve_to_different_plans_on_one_machine() {
        let s = detected_state();
        let statuses = capability_statuses(&s);
        let a = plan_for(knowledge::goal::lookup("ai_application").unwrap(), &s, &statuses);
        let b = plan_for(knowledge::goal::lookup("ai_usage").unwrap(), &s, &statuses);
        assert_ne!(a.goal_id, b.goal_id);
        assert_ne!(a.profile_id, b.profile_id);
        // The requirements genuinely differ, not just the labels.
        assert_ne!(
            a.strengths.len() + a.gaps.len() + a.unmeasured.len(),
            b.strengths.len() + b.gaps.len() + b.unmeasured.len()
        );
    }

    #[test]
    fn a_plan_against_an_unscanned_machine_is_unknown_not_failed() {
        // The first-run ordering problem: a student picks a goal before the scan
        // finishes. The plan must not claim their machine is missing everything.
        let s = state();
        let statuses = capability_statuses(&s);
        let plan = plan_for(knowledge::goal::lookup("ai_application").unwrap(), &s, &statuses);
        assert!(
            plan.gaps.is_empty(),
            "nothing was measured, so nothing may be reported missing: {:?}",
            plan.gaps.iter().map(|g| &g.capability_id).collect::<Vec<_>>()
        );
        assert!(plan.next_steps.iter().all(|s| s.kind != "install"));
    }

    // -- advisor ------------------------------------------------------------

    #[test]
    fn the_advisor_does_not_claim_a_score_before_detection() {
        let s = state();
        let view = advisor_view(&s);
        assert!(!view.detected);
        assert!(view.machine.is_none());
        assert_eq!(view.summary.grade, "unknown");
    }

    #[test]
    fn the_advisor_produces_a_grade_and_a_machine_readout_after_detection() {
        let s = detected_state();
        let view = advisor_view(&s);
        assert!(view.detected);
        let machine = view.machine.expect("a machine readout");
        assert!(!machine.cpu.trim().is_empty());
        assert!(!machine.memory.trim().is_empty());
        assert!(!machine.disk.trim().is_empty());
        assert!(
            ["excellent", "good", "fair", "limited", "unknown"].contains(&view.summary.grade),
            "grade {} is not a known value",
            view.summary.grade
        );
    }

    #[test]
    fn the_advisor_summary_and_the_capability_screen_agree() {
        // Both read one resolution. If they could disagree, the dashboard would
        // contradict itself on two screens a student can open side by side.
        let s = detected_state();
        let statuses = capability_statuses(&s);
        let view = advisor_view(&s);
        assert_eq!(view.summary.capabilities_checked, statuses.len() as u32);
        assert_eq!(
            view.summary.strengths.len() + view.summary.gaps.len() + view.summary.unmeasured.len(),
            statuses.len()
        );
    }

    #[test]
    fn the_advisor_text_renders_without_panicking_on_an_empty_machine() {
        let s = state();
        let view = advisor_view(&s);
        let text = knowledge::advisor::render_text(&view.summary, view.machine.as_ref());
        assert!(text.contains("AI 开发环境分析"));
        assert!(text.contains("综合评分"));
    }

    #[test]
    fn the_advisor_text_includes_the_machine_when_it_was_read() {
        let s = detected_state();
        let view = advisor_view(&s);
        let text = knowledge::advisor::render_text(&view.summary, view.machine.as_ref());
        assert!(text.contains("硬件"), "the hardware section must appear");
        assert!(text.contains("处理器"));
    }

    #[test]
    fn recommendations_are_deduplicated_across_goals() {
        // Five of six goals need Git. Without dedup the list opens with the same
        // instruction five times and looks broken.
        let s = detected_state();
        let plans = all_plans(&s);
        let summary = knowledge::advisor::summarize(
            &capability_statuses(&s),
            s.last_scan().as_ref(),
            &plans,
            &s.knowledge,
        );
        let titles: Vec<&str> = summary
            .recommendations
            .iter()
            .map(|r| r.title.as_str())
            .collect();
        let mut sorted = titles.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(titles.len(), sorted.len(), "duplicate advice: {titles:?}");
    }

    #[test]
    fn recommendation_order_is_sequential_from_one() {
        let s = detected_state();
        let plans = all_plans(&s);
        let summary = knowledge::advisor::summarize(
            &capability_statuses(&s),
            s.last_scan().as_ref(),
            &plans,
            &s.knowledge,
        );
        for (i, r) in summary.recommendations.iter().enumerate() {
            assert_eq!(r.order, i as u32 + 1);
        }
    }

    // -- knowledge status ---------------------------------------------------

    #[test]
    fn knowledge_status_reports_coverage_rather_than_hiding_gaps() {
        let s = state();
        let status = knowledge_status_of(&s);
        assert!(status.software_count > 0);
        assert!(status.concept_count > 0);
        assert!(status.warnings.is_empty(), "{:?}", status.warnings);
        // The list is reported even when empty, so the UI can say "complete"
        // rather than showing nothing and implying the check did not run.
        assert!(status.without_knowledge.len() < SoftwareId::ALL.len());
    }

    #[test]
    fn concept_views_are_filtered_by_capability_when_asked() {
        let s = state();
        let all = concept_views(None, &s);
        let filtered = concept_views(Some("ai-agent-development".into()), &s);
        assert!(all.len() >= filtered.len());
        assert!(filtered.iter().any(|c| c.id == "mcp"));
        assert!(filtered.iter().all(|c| !c.why_it_matters.is_empty()));
    }

    #[test]
    fn asking_for_concepts_of_an_unknown_capability_is_empty_not_an_error() {
        let s = state();
        let out = concept_views(Some("not-a-real-capability".into()), &s);
        assert!(out.is_empty());
    }

    // -- helpers mirroring the commands -------------------------------------
    //
    // The commands themselves are thin wrappers over these, so the tests call
    // the helpers directly. That keeps them testable without a Tauri `State`,
    // which cannot be constructed outside a running app.

    fn explained_catalogue_view(s: &AppState) -> Vec<ExplainedSoftwareView> {
        SoftwareId::ALL
            .iter()
            .map(|id| explain_one(*id, s))
            .collect()
    }

    fn list_goals_view(s: &AppState) -> GoalListView {
        let profile_ids: Vec<String> = s.profiles.all().into_iter().map(|p| p.id).collect();
        GoalListView {
            goals: knowledge::goal::all()
                .iter()
                .map(|spec| {
                    knowledge::goal::GoalView::from_spec(
                        spec,
                        profile_ids.contains(&spec.profile_id.to_string()),
                    )
                })
                .collect(),
            goals_without_profiles: knowledge::goal::goals_without_profiles(&profile_ids),
            default_goal: knowledge::goal::default_goal().id.to_string(),
        }
    }

    fn advisor_view(s: &AppState) -> AdvisorView {
        let statuses = capability_statuses(s);
        let inventory = s.last_scan();
        let plans = all_plans(s);
        let summary =
            knowledge::advisor::summarize(&statuses, inventory.as_ref(), &plans, &s.knowledge);
        let machine = knowledge::advisor::assess_machine(s.last_environment().as_ref());
        AdvisorView {
            summary,
            machine,
            detected: s.last_environment().is_some(),
        }
    }

    fn knowledge_status_of(s: &AppState) -> KnowledgeStatus {
        KnowledgeStatus {
            software_count: s.knowledge.software_count(),
            concept_count: s.knowledge.concept_count(),
            source_dir: s.knowledge.source_dir.as_ref().map(|d| d.display().to_string()),
            warnings: s.knowledge.warnings.clone(),
            without_knowledge: s
                .knowledge
                .software_without_knowledge()
                .iter()
                .map(|id| id.key().to_string())
                .collect(),
        }
    }

    fn concept_views(capability_id: Option<String>, s: &AppState) -> Vec<ConceptView> {
        match capability_id {
            Some(cap) => s
                .knowledge
                .concepts_for_capability(&cap)
                .into_iter()
                .map(ConceptView::from)
                .collect(),
            None => s
                .knowledge
                .all_concepts()
                .into_iter()
                .map(ConceptView::from)
                .collect(),
        }
    }
}
