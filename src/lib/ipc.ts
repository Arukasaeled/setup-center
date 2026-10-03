/**
 * Typed wrapper around the Tauri command surface.
 *
 * Every call into Rust goes through this module. Three reasons:
 *  1. Command names appear exactly once, so a rename is a compile error.
 *  2. Return types are pinned to `lib/types.ts`, which mirrors `model.rs`.
 *  3. Failures are normalised into a readable Chinese message here, so no screen
 *     has to know that Tauri rejects with a plain object rather than an Error.
 */

import { invoke } from "@tauri-apps/api/core";
import { describeError } from "./types";
import type {
  AdvisorView,
  BootstrapPlanView,
  BootstrapSessionView,
  BootstrapVerificationView,
  CapabilityStatus,
  ConceptNote,
  ConfigAction,
  EnvironmentPlan,
  EnvironmentReport,
  ExecutionReadiness,
  ExecutionSession,
  ExplainedSoftware,
  GoalListView,
  InstallPlan,
  InstallStrategy,
  KnowledgeStatus,
  Entitlements,
  LicenseDeviceView,
  LocalizationTargetView,
  MachineFacts,
  PluginRun,
  PluginRunMode,
  PluginTargetState,
  PluginView,
  Profile,
  ProfileCapabilityView,
  PostInstallReport,
  RenderedReport,
  RuntimeStatus,
  SoftwareDescriptor,
  SoftwareId,
  SoftwareInventory,
  StepProgress,
  VerificationReport,
  WindowsInfo,
} from "./types";

/** Thrown by every helper below so callers only ever catch one shape. */
export class IpcError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "IpcError";
  }
}

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw new IpcError(describeError(err), command, err);
  }
}

/** True when running inside the Tauri webview rather than a plain browser. */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/**
 * The event Rust emits one `StepProgress` on per step change.
 *
 * Mirrors `commands::INSTALL_PROGRESS_EVENT`. It is a literal here rather than a
 * shared import because the Rust constant cannot cross the boundary; the two
 * are kept in step by `tools/check-event-channel.mjs`, which reads both files
 * and fails if they diverge.
 */
export const INSTALL_PROGRESS_EVENT = "install://progress";

/**
 * Subscribes to live install progress. Resolves to an unsubscribe function.
 *
 * ## Why this exists
 *
 * Until 0.1.2 the install command was a single `await` that resolved only when
 * the entire run had finished, so the UI had nothing to show for the minutes in
 * between — the complaint that drove this phase. Rust now emits a
 * `StepProgress` at every step transition; this is the receiving end.
 *
 * ## Failure behaviour, on both sides of the subscription
 *
 * A listener that cannot be attached is not an error the student should see.
 * The command still returns the complete session, so the outcome is always
 * correct — only the live detail is lost, and the screen degrades to the
 * pre-0.1.2 behaviour rather than breaking. That is why this resolves to a no-op
 * unsubscribe instead of throwing: a progress channel must never be able to
 * take down the install flow it exists to describe.
 *
 * **The detach needs the same protection as the attach, and getting it wrong is
 * easier than it looks.** `@tauri-apps/api/event`'s own `unlisten` reaches
 * straight into `window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(...)`
 * with no guard, and it is declared `async` — so it *rejects* rather than
 * throwing synchronously. In a webview that global is always installed by the
 * runtime, but in a test harness or a partially-initialised page it is not. A
 * `try/catch` around the call catches nothing (the rejection escapes as an
 * unhandled promise error), and the failure lands in a React effect *cleanup*,
 * where it surfaces as a page error on a screen that is working perfectly. The
 * project's own `ui-verify.mjs` reproduces exactly that, which is how this was
 * found.
 *
 * So the returned detach funnels the call through a resolved promise and catches
 * the rejection. It is also safe to call more than once: React may invoke a
 * cleanup twice across a StrictMode remount, and a detach that misbehaves the
 * second time is the same bug one step later.
 */
export async function onInstallProgress(
  handler: (progress: StepProgress) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<StepProgress>(INSTALL_PROGRESS_EVENT, (event) => {
      handler(event.payload);
    });

    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      // The library's `unlisten` is `async () => _unlisten(...)`, i.e. it
      // *returns a promise* rather than throwing synchronously. A bare
      // `try { unlisten() } catch {}` therefore catches nothing — the rejection
      // escapes as an unhandled promise error. It has to be awaited, and the
      // await has to be inside the try, which means this detach is async-fire-
      // and-forget rather than a plain function.
      void Promise.resolve()
        .then(() => unlisten())
        .catch(() => {
          // A detach failure must not become a visible page error. The listener
          // goes away with the webview regardless.
        });
    };
  } catch {
    // See above: losing the listener must not fail the caller.
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export const detectEnvironment = () =>
  call<EnvironmentReport>("detect_environment");

export const windowsInfo = () => call<WindowsInfo>("windows_info");

/**
 * Runs the Software Intelligence Layer over `ids`.
 *
 * Omitting `ids` scans the whole catalog. Passing only a profile's programs is
 * the difference between reading one uninstall key and reading all of them, so
 * callers that know their set should pass it.
 */
export const scanSoftware = (ids?: SoftwareId[]) =>
  call<SoftwareInventory>("scan_software", { ids: ids ?? null });

/** The cached inventory, so a remount can render without re-reading the registry. */
export const lastSoftwareScan = () =>
  call<SoftwareInventory | null>("last_software_scan");

// ---------------------------------------------------------------------------
// Capability layer (stage 5)
// ---------------------------------------------------------------------------

/**
 * What this machine can currently do.
 *
 * A pure read: it probes nothing itself, resolving against the environment and
 * inventory the two calls above have already cached. That is what keeps the
 * capability rows consistent with the software list rendered beside them.
 */
export const capabilityReport = () =>
  call<CapabilityStatus[]>("capability_report");

/** The capabilities a profile aims at, plus any ids it names that do not exist. */
export const profileCapabilities = (profileId: string) =>
  call<ProfileCapabilityView>("profile_capabilities", { profileId });

/**
 * Every catalogued program with its name, purpose, category and installability.
 *
 * Served from Rust so a program is described in exactly one place; the frontend
 * registry only adds presentation details (the single-letter marks).
 */
export const softwareCatalogue = () =>
  call<SoftwareDescriptor[]>("software_catalogue");

/** CPU, memory, GPU and virtualisation, from the last detection. */
export const machineFacts = () =>
  call<MachineFacts | null>("machine_facts");

// ---------------------------------------------------------------------------
// Knowledge, goals and advisor (stage 5)
// ---------------------------------------------------------------------------

/**
 * One program, explained and measured in a single call.
 *
 * Bundles the knowledge with the detected state so a row renders without three
 * round-trips. The two arrive as separate fields rather than merged, because the
 * UI must never be able to mistake an explanation for a fact.
 */
export const explainSoftware = (id: SoftwareId) =>
  call<ExplainedSoftware>("explain_software", { id });

/** Every catalogued program, explained. One call rather than N. */
export const explainedCatalogue = () =>
  call<ExplainedSoftware[]>("explained_catalogue");

/** The directions a student can choose, with what each needs. */
export const listGoals = () => call<GoalListView>("list_goals");

/** One goal resolved against this machine: completion, gaps, next steps. */
export const environmentPlan = (goalId: string) =>
  call<EnvironmentPlan>("environment_plan", { goalId });

/** Every goal resolved, for the advisor's "适合的方向" list. */
export const environmentPlans = () =>
  call<EnvironmentPlan[]>("environment_plans");

/**
 * The advisory analysis of this machine.
 *
 * Built from capability statuses and the inventory — never from an execution
 * session. The distinction is the point: a step reporting success is not
 * evidence the machine changed, so only the machine is asked.
 */
export const advisorSummary = () => call<AdvisorView>("advisor_summary");

/** The advisor analysis as plain text, for export. */
export const advisorReportText = () =>
  call<string>("advisor_report_text");

/** Explanations for the concepts a student will meet, optionally by capability. */
export const conceptNotes = (capabilityId?: string) =>
  call<ConceptNote[]>("concept_notes", { capabilityId: capabilityId ?? null });

/** Coverage and warnings from the knowledge base. */
export const knowledgeStatus = () => call<KnowledgeStatus>("knowledge_status");

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export const listProfiles = () => call<Profile[]>("list_profiles");

export const getProfile = (id: string) =>
  call<Profile>("get_profile", { id });

// ---------------------------------------------------------------------------
// Planning and installation
// ---------------------------------------------------------------------------

export const buildInstallPlan = (profileId: string) =>
  call<InstallPlan>("build_install_plan", { profileId });

/** A plan for the programs the student actually ticked, not the profile's list. */
export const buildInstallPlanFor = (ids: SoftwareId[], profileId: string) =>
  call<InstallPlan>("build_install_plan_for", { ids, profileId });

export const installStrategies = (profileId: string) =>
  call<InstallStrategy[]>("install_strategies", { profileId });

/** Strategies for an explicit list, so a pick outside the profile still has a method. */
export const installStrategiesFor = (ids: SoftwareId[]) =>
  call<InstallStrategy[]>("install_strategies_for", { ids });

/**
 * Stage 1: returns the dry-run progress stream. Nothing is installed; every
 * step comes back as `skipped` with a reason.
 */
export const previewInstall = (plan: InstallPlan) =>
  call<StepProgress[]>("preview_install", { plan });

/**
 * Executes the plan. This is the call that changes the machine.
 *
 * Resolves with a complete session once the run ends. It can take minutes, so
 * the caller must show progress and offer cancellation — `cancelInstall` is how
 * the run is stopped, not by dropping this promise.
 */
export const runInstall = (plan: InstallPlan) =>
  call<ExecutionSession>("run_install", { plan });

/** Continues an interrupted run, skipping everything already done. */
export const resumeInstall = () => call<ExecutionSession>("resume_install");

/** Asks the running installation to stop. Cooperative; returns immediately. */
export const cancelInstall = () => call<boolean>("cancel_install");

/** The session to offer "继续安装" for, if the last run was interrupted. */
export const resumableInstall = () =>
  call<ExecutionSession | null>("resumable_install");

/** The most recent session, which survives an app restart. */
export const lastInstallSession = () =>
  call<ExecutionSession | null>("last_install_session");

/** Whether the plan can start, and what would stop it. */
export const executionReadiness = (plan: InstallPlan) =>
  call<ExecutionReadiness>("execution_readiness", { plan });

// ---------------------------------------------------------------------------
// Verification and reporting
// ---------------------------------------------------------------------------

export const verifyInstallation = (plan: InstallPlan) =>
  call<VerificationReport>("verify_installation", { plan });

/**
 * Post-install verification: re-probes the machine and reports what is actually
 * usable, per program.
 *
 * Prefer this over `verifyInstallation` after a run. The two answer different
 * questions: `verifyInstallation` grades a plan against a scan, this reports the
 * outcome of the run that just happened, including the case the brief singles
 * out — the command finished and the program is not there. Neither consults the
 * installer's exit code, which is the point.
 */
export const verifyInstallResult = (plan: InstallPlan) =>
  call<PostInstallReport>("verify_install_result", { plan });

// ---------------------------------------------------------------------------
// install.log
// ---------------------------------------------------------------------------

/** Absolute path of `install.log`, for the "打开日志" affordance. */
export const installLogPath = () => call<string>("install_log_path");

/**
 * The tail of `install.log`.
 *
 * An empty string means no log has been written yet — the normal state before
 * the first failure — not an error. Callers should treat it as "nothing to
 * show" rather than as a broken read.
 */
export const readInstallLog = (lines?: number) =>
  call<string>("read_install_log", { lines });

/** Whether an `install.log` exists at all. */
export const installLogExists = () => call<boolean>("install_log_exists");

export const plannedConfigActions = (profileId: string) =>
  call<ConfigAction[]>("planned_config_actions", { profileId });

export const generateReport = (args: {
  profileId: string;
  plan: InstallPlan;
  environment: EnvironmentReport;
  verification: VerificationReport;
}) => call<RenderedReport>("generate_report", args);

export const saveReport = (text: string) =>
  call<string>("save_report", { text });

// ---------------------------------------------------------------------------
// Bootstrap (stage 4)
// ---------------------------------------------------------------------------

/**
 * The bootstrap plan: what will be configured, in stage order.
 *
 * Read-only. Probes the machine (editor CLI, installed extensions, git config)
 * but writes nothing, so the screen can name real steps before anything runs.
 */
export const buildBootstrapPlan = (profileId: string) =>
  call<BootstrapPlanView>("build_bootstrap_plan", { profileId });

/**
 * Runs the bootstrap plan. This is the call that configures the machine.
 *
 * Resolves with a complete session, including the post-run verification, once
 * the run ends. Cancellation goes through `cancelBootstrap`, not by dropping
 * this promise.
 */
export const runBootstrap = (profileId: string) =>
  call<BootstrapSessionView>("run_bootstrap", { profileId });

/** Asks a running bootstrap to stop. Cooperative; returns immediately. */
export const cancelBootstrap = () => call<boolean>("cancel_bootstrap");

/** The session to offer "继续" for, if a bootstrap was interrupted. */
export const resumableBootstrap = () =>
  call<BootstrapSessionView | null>("resumable_bootstrap");

/** The most recent bootstrap run, which survives an app restart. */
export const lastBootstrap = () =>
  call<BootstrapSessionView | null>("last_bootstrap");

/**
 * Re-verifies a finished run against the machine's *current* state.
 *
 * Its own command because the useful question after fixing something by hand is
 * "is it right now?", and re-running the configuration to find out would be the
 * wrong tool.
 */
export const verifyBootstrap = (profileId: string) =>
  call<BootstrapVerificationView>("verify_bootstrap", { profileId });

/** The localisation targets this build knows, with their upstream projects. */
export const localizationTargets = () =>
  call<LocalizationTargetView[]>("localization_targets");

// ---------------------------------------------------------------------------
// Licensing (stage 5)
// ---------------------------------------------------------------------------

/**
 * The current tier, and whether this build enforces it.
 *
 * A pure read: the licence screen can ask without changing anything, and the
 * app can check on launch without prompting.
 */
export const licenseStatus = () => call<Entitlements>("license_status");

/**
 * Activates a key locally.
 *
 * Returns the resulting entitlements rather than requiring a follow-up read, so
 * the UI cannot render a stale tier between activating and re-checking.
 */
export const activateLicense = (key: string) =>
  call<Entitlements>("activate_license", { key });

/** Clears the activation, returning the machine to its default tier. */
export const deactivateLicense = () =>
  call<Entitlements>("deactivate_license");

/**
 * What the licence screen may show about this machine's binding.
 *
 * Returns a summary — an abbreviated digest and a probe count — never the raw
 * hardware identifiers. There is deliberately no companion command that returns
 * the activation code, so the UI has nothing to render even if a future change
 * wanted it to.
 */
export const licenseDevice = () => call<LicenseDeviceView>("license_device");

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export const runtimeStatus = () => call<RuntimeStatus>("runtime_status");

// ---------------------------------------------------------------------------
// Claude enhancement plugins
// ---------------------------------------------------------------------------

/**
 * The catalogue resolved against this machine.
 *
 * A read that probes: each row's verdict depends on the Claude actually
 * installed, so this is not a pure catalogue lookup and takes a moment.
 */
export const pluginViews = () => call<PluginView[]>("plugin_views");

/** The two Claude targets, for the status line above the plugin list. */
export const pluginTargets = () => call<PluginTargetState[]>("plugin_targets");

/**
 * Runs one pipeline invocation and returns the complete stage record.
 *
 * `dryRun` shares the install path and stops before any write, so the preview
 * reports exactly what an install would touch. An unknown mode is rejected by
 * the command rather than falling back to a dry run.
 */
export const runPlugin = (
  id: string,
  mode: PluginRunMode,
  allowUnverified = false,
) => call<PluginRun>("run_plugin", { id, mode, allowUnverified });

// ---------------------------------------------------------------------------
// Native System Ops & Discovery
// ---------------------------------------------------------------------------

export interface CommandOutput {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface WingetSearchResultItem {
  name: string;
  id: string;
  version: string;
  matchType?: string;
  source?: string;
}

export interface WingetPackageDetails {
  id: string;
  name: string;
  version?: string;
  publisher?: string;
  description?: string;
  homepage?: string;
  license?: string;
  installerType?: string;
  installerUrl?: string;
  installerSha256?: string;
  source?: string;
}

export interface DetectedEditor {
  id: "vscode" | "cursor" | "windsurf" | "zed" | string;
  name: string;
  command: string;
  installed: boolean;
  executablePath?: string;
}

/** Executes a native program with args and optional cwd, capturing stdout/stderr */
export const executeNativeCommand = (
  program: string,
  args: string[],
  cwd?: string,
) => call<CommandOutput>("execute_native_command", { program, args, cwd });

/** Starts streaming command execution emitting stdout/stderr/exit events over Tauri channel */
export const executeStreamingCommand = (
  executionId: string,
  program: string,
  args: string[],
  cwd?: string,
) => call<void>("execute_streaming_command", { executionId, program, args, cwd });

/** Cancels an active streaming execution by execution ID */
export const cancelNativeExecution = (executionId: string) =>
  call<boolean>("cancel_native_execution", { executionId });

/** Downloads a remote file to a destination path using native curl streaming */
export const nativeDownload = (url: string, destinationPath: string) =>
  call<void>("native_download", { url, destinationPath });

/** Searches winget for packages matching query */
export const wingetSearch = (query: string) =>
  call<WingetSearchResultItem[]>("winget_search", { query });

/** Fetches rich package details for a specific winget package id */
export const wingetShow = (packageId: string) =>
  call<WingetPackageDetails>("winget_show", { packageId });

/** Reveals a file or directory in Windows Explorer */
export const revealInExplorer = (path: string) =>
  call<void>("reveal_in_explorer", { path });

/** Probes which editors (VS Code, Cursor, Windsurf, Zed) are installed on this machine */
export const detectEditors = () => call<DetectedEditor[]>("detect_editors");

/** Launches a file or directory in an installed editor, using executablePath if known */
export const openInEditor = (editor: string, path: string, executablePath?: string) =>
  call<void>("open_in_editor", { editor, path, executablePath });

/** Returns the canonical application version from Cargo manifest */
export const appCanonicalVersion = () =>
  call<string>("app_canonical_version");

export interface StreamingOutputPayload {
  executionId: string;
  text: string;
}

export interface StreamingExitPayload {
  executionId: string;
  success: boolean;
  exitCode: number | null;
}

/** Attaches listener to native://stdout streaming events */
export async function onNativeStdout(
  handler: (payload: StreamingOutputPayload) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<StreamingOutputPayload>("native://stdout", (event) => {
      handler(event.payload);
    });
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      void Promise.resolve()
        .then(() => unlisten())
        .catch(() => {});
    };
  } catch {
    return () => {};
  }
}

/** Attaches listener to native://stderr streaming events */
export async function onNativeStderr(
  handler: (payload: StreamingOutputPayload) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<StreamingOutputPayload>("native://stderr", (event) => {
      handler(event.payload);
    });
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      void Promise.resolve()
        .then(() => unlisten())
        .catch(() => {});
    };
  } catch {
    return () => {};
  }
}

/** Attaches listener to native://exit streaming events */
export async function onNativeExit(
  handler: (payload: StreamingExitPayload) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<StreamingExitPayload>("native://exit", (event) => {
      handler(event.payload);
    });
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      void Promise.resolve()
        .then(() => unlisten())
        .catch(() => {});
    };
  } catch {
    return () => {};
  }
}

