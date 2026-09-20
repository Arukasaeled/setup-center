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
  LocalizationTargetView,
  MachineFacts,
  Profile,
  ProfileCapabilityView,
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

export const installStrategies = (profileId: string) =>
  call<InstallStrategy[]>("install_strategies", { profileId });

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

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export const runtimeStatus = () => call<RuntimeStatus>("runtime_status");
