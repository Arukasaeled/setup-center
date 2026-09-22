/**
 * TypeScript mirror of the Rust domain model (`src-tauri/src/model.rs`).
 *
 * These are hand-written to match the serde representation exactly. The Rust
 * side uses `camelCase` field renaming throughout, and `SoftwareId` serialises
 * to its snake_case key, so the shapes below are literal transcriptions.
 *
 * If you change `model.rs`, change this file in the same commit. There is no
 * codegen in V0.1 because the surface is small and a generator would be one
 * more moving part to keep working.
 */

// ---------------------------------------------------------------------------
// Shared scalars
// ---------------------------------------------------------------------------

/** Deliberately not a boolean: "we could not tell" is a real outcome. */
export type Confidence = "ok" | "fail" | "unknown" | "skipped";

export type Severity = "info" | "warning" | "blocking";

export interface Signal {
  key: string;
  label: string;
  value: string;
  confidence: Confidence;
  severity: Severity;
  score: number | null;
  weight: number | null;
  hint: string | null;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface WindowsInfo {
  edition: string;
  release: string | null;
  build: string;
  major: number;
  minor: number;
  buildNumber: number;
  architecture: string;
}

export interface AdminInfo {
  isElevated: boolean;
  userName: string;
  isAdminMember: boolean;
  detectionUncertain: boolean;
}

export interface DiskInfo {
  root: string;
  label: string | null;
  totalBytes: number;
  freeBytes: number;
  writable: boolean;
  lowSpace: boolean;
}

export type NetworkQuality = "good" | "degraded" | "offline" | "unknown";

export interface NetworkInfo {
  quality: NetworkQuality;
  latencyMs: number | null;
  reachableHosts: string[];
  wingetReachable: boolean;
  proxy: string | null;
}

export interface EnvironmentReport {
  windows: WindowsInfo;
  admin: AdminInfo;
  disks: DiskInfo[];
  network: NetworkInfo;
  /** CPU, memory, GPU and virtualisation. Added in P4.5. */
  machine: MachineFacts;
  signals: Signal[];
  score: number;
  scoreMax: number;
  blockingCount: number;
  warningCount: number;
}

// ---------------------------------------------------------------------------
// Machine facts (stage 5)
// ---------------------------------------------------------------------------

export interface CpuInfo {
  name: string;
  physicalCores: number | null;
  logicalCores: number | null;
  maxClockMhz: number | null;
}

export interface MemoryInfo {
  totalBytes: number;
  availableBytes: number | null;
}

export interface GpuInfo {
  name: string;
  /**
   * Dedicated VRAM, when the driver reported a decodable figure.
   *
   * `null` is common and meaningful: integrated GPUs share system memory, and
   * some drivers return a sentinel. The UI must render "未识别" rather than 0.
   */
  vramBytes: number | null;
  driverVersion: string | null;
}

export interface MachineFacts {
  cpu: CpuInfo | null;
  memory: MemoryInfo | null;
  gpus: GpuInfo[];
  /** `null` when it could not be determined — never rendered as "不支持". */
  virtualizationEnabled: boolean | null;
  hypervisorPresent: boolean | null;
}

// ---------------------------------------------------------------------------
// Capability layer (stage 5)
// ---------------------------------------------------------------------------

/** `available` | `partial` | `unavailable` | `unknown`. */
export type CapabilityStatusKind =
  | "available"
  | "partial"
  | "unavailable"
  | "unknown";

export interface RequirementOutcome {
  key: string;
  label: string;
  /** `required` | `optional`. */
  necessity: string;
  met: boolean;
  /** True when the requirement could not be evaluated at all. */
  unknown: boolean;
  observed: string;
  remedy: string | null;
}

export interface CapabilityStatus {
  id: string;
  name: string;
  description: string;
  group: string;
  groupName: string;
  status: CapabilityStatusKind;
  outcome: string;
  requirements: RequirementOutcome[];
  metCount: number;
  requiredCount: number;
  summary: string;
}

export interface ProfileCapabilityView {
  derived: string[];
  unknownDeclared: string[];
}

export interface SoftwareDescriptor {
  id: SoftwareId;
  name: string;
  /** Why a student needs it — the field that turns a check into an explanation. */
  purpose: string;
  category: string;
  categoryName: string;
  /** `false` means detected but not managed by this tool. */
  installable: boolean;
}

// ---------------------------------------------------------------------------
// Software
// ---------------------------------------------------------------------------

export type SoftwareId =
  | "vscode"
  | "git"
  | "python"
  | "node"
  | "claude_desktop"
  | "claude_code"
  | "codex"
  | "docker"
  | "cursor"
  | "wsl"
  | "msvc_build_tools"
  | "cmake"
  | "npm"
  | "pnpm"
  | "uv"
  | "rust"
  | "java"
  | "gemini"
  | "opencode"
  | "continue"
  | "jetbrains"
  // These three existed in the Rust catalog (and are installable through a
  // profile) but were missing here, which meant the frontend could not name
  // them without a type error. The union is the second half of a contract whose
  // first half is `SoftwareId` in `model.rs`; the two must list the same ids.
  | "chatgpt_desktop"
  | "windsurf"
  | "lm_studio"
  | "windows_terminal"
  // Added alongside the Chinese / Charm coding agents and CC Switch. Same rule
  // as above: this union is the second half of a contract whose first half is
  // `SoftwareId` in `model.rs`, and the two must name the same ids in the same
  // order (the catalog-order test in Rust depends on that agreement).
  | "qwen_code"
  | "kimi_cli"
  | "cc_switch"
  | "crush";

export type DetectionMethod =
  | "path"
  | "registry"
  | "winget"
  | "notFound";

/**
 * Which independent source said something about a program.
 *
 * The ordering is meaningful and matches the Rust enum: when sources disagree
 * about a version, the earlier one wins — except for the version field, where a
 * value printed by the running binary beats a registry metadata field. See
 * `preferred_version` in `inventory.rs`.
 */
export type ProbeSource = "registry" | "path" | "winget";

export interface EvidenceView {
  source: ProbeSource;
  /** `present` | `unavailable` | `absent`. */
  outcome: string;
  detail: string | null;
}

/**
 * The answer to "is this on the machine, and how sure are we?".
 *
 * `installed` and `confidence` are deliberately independent. `installed: false`
 * with `confidence: "unknown"` means *we could not check* and must be rendered as
 * "无法确认" — never as "not installed".
 */
export interface SoftwareInfo {
  id: SoftwareId;
  name: string;
  installed: boolean;
  version: string | null;
  path: string | null;
  onPath: boolean;
  confidence: Confidence;
  packageId: string | null;
  /** Every source that positively found it, strongest first. */
  sources: ProbeSource[];
  /** The full per-source audit trail, including negative answers. */
  evidence: EvidenceView[];
  hints: string[];
}

export interface SoftwareInventory {
  items: SoftwareInfo[];
  scannedAt: string;
  /** Providers that produced this inventory, in precedence order. */
  providers: string[];
}

export interface SoftwareScan {
  inventory: SoftwareInventory;
  scannedAt: string;
}

/** The stage-1 flat view, derived from the inventory. Kept for the report. */
export interface InstalledSoftware {
  id: SoftwareId;
  name: string;
  installed: boolean;
  version: string | null;
  path: string | null;
  onPath: boolean;
  detectedVia: DetectionMethod;
  packageId: string | null;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface ProfileFuture {
  mcp: string[];
  skills: string[];
  agents: string[];
}

/** Stage-4: what a profile asks to be *configured*, as opposed to installed. */
export interface ProfileBootstrap {
  vscode: VscodeBootstrap;
  git: GitBootstrap;
  mcp: McpBootstrap[];
  skills: string[];
  localization: string[];
}

export interface VscodeBootstrap {
  /** Marketplace ids in `publisher.name` form, optionally `@version`-pinned. */
  extensions: string[];
  /** Settings merged into the user's settings file. */
  settings: Record<string, unknown>;
  settingsFile?: string | null;
}

export interface GitBootstrap {
  configure: boolean;
}

export interface McpBootstrap {
  name: string;
  spec: string;
}

export interface Profile {
  id: string;
  name: string;
  tagline: string;
  audience: string;
  rationale: string;
  software: SoftwareId[];
  configure: string[];
  estimatedMinutes: number;
  estimatedDownloadMb: number;
  requiresAdmin: boolean;
  future: ProfileFuture;
  bootstrap: ProfileBootstrap;
  /**
   * Stage 5: capability ids this profile explicitly names.
   *
   * Usually empty — the set is derived from `software`. Present so a profile can
   * foreground a goal the derivation cannot see, and so a typo is reportable.
   */
  capabilities: string[];
}

// ---------------------------------------------------------------------------
// Plan and progress
// ---------------------------------------------------------------------------

export type InstallSource =
  | { winget: { packageId: string } }
  | { officialInstaller: { url: string; sha256: string | null } }
  | { script: { command: string } }
  | "configurationOnly";

export interface InstallStep {
  id: SoftwareId;
  name: string;
  source: InstallSource;
  fallbackPlan: string[];
  satisfied: boolean;
}

export interface InstallPlan {
  profileId: string;
  steps: InstallStep[];
  readyCount: number;
  satisfiedCount: number;
  estimatedMinutes: number;
}

export type StepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "succeededWithWarning"
  | "failed"
  | "skipped"
  | "cancelled";

export interface StepProgress {
  stepId: SoftwareId;
  name: string;
  status: StepStatus;
  index: number;
  total: number;
  stage: string;
  fraction: number | null;
  detail: string | null;
}

/**
 * The screen-level install state, shown to the student as a visible phase.
 *
 * Distinct from [`StepStatus`], which is per-program. This is the *run*: what the
 * whole screen is doing right now. The brief asks for the state to be visible
 * rather than implied by a spinner, so the UI renders it directly (and exposes it
 * as `data-phase` for tests).
 *
 * `cancelled` is a member in its own right, **not** a flavour of `failed`. The
 * brief's list names `Failed` and stops there, but a run the student stopped is
 * neither a success nor a failure, and rendering it as a failure would tell them
 * something untrue about their machine — that something is broken, rather than
 * that they changed their mind. Keeping them separate is what lets the cancel
 * panel show the correct reason.
 */
export type InstallPhase =
  | "idle"
  | "preparing"
  | "downloading"
  | "installing"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Why a run stopped, when the student stopped it or it failed.
 *
 * Deliberately a closed set rather than free text: the UI picks the wording and
 * the suggestion from the kind, and a new failure mode must be added here to be
 * renderable — which is what stops a new case from silently showing a generic
 * message.
 */
export type InstallFailureKind =
  | "nonZeroExit"
  | "unavailable"
  | "permissionDenied"
  | "cancelled"
  | "verifyFailed";

/** What the cancel / error panel shows. */
export interface InstallFailureView {
  kind: InstallFailureKind;
  /** `用户主动取消`, or the failure in one line. */
  reason: string;
  /** The command that was running, when there was one. */
  command: string | null;
  /** Captured output so far, truncated by Rust. */
  log: string | null;
  /** A remedy, when one applies. */
  suggestion: string | null;
  /** Where `install.log` was written, so the student can find it. */
  logPath: string | null;
}

/**
 * One program's post-install verdict.
 *
 * Mirrors `commands::PostInstallCheck`. `ok` is the verdict that matters, and it
 * comes from re-probing the machine — never from the installer's exit code.
 */
export interface PostInstallCheck {
  id: SoftwareId;
  name: string;
  ok: boolean;
  /** What the machine reported, when it reported anything. */
  version: string | null;
  /** One line for the student. */
  message: string;
  hint: string | null;
}

/** The result of verifying an install that has just finished. */
export interface PostInstallReport {
  checks: PostInstallCheck[];
  /** Programs that failed verification despite the run finishing. */
  failures: SoftwareId[];
  /**
   * `true` when everything verified.
   *
   * `false` is the case worth surfacing: the command finished and the program is
   * still not usable. The student's terminal may have reported success.
   */
  verifiedAll: boolean;
}

// ---------------------------------------------------------------------------
// Execution (stage 3)
// ---------------------------------------------------------------------------

/**
 * What the OS said about one attempt.
 *
 * A separate axis from `StepStatus`: the status answers "how did this program
 * turn out", this answers "what happened when we tried". A step whose first
 * fallback link failed and whose second succeeded has both a `failed` and a
 * `succeeded` attempt behind one `succeeded` status.
 */
export type AttemptOutcome =
  | "succeeded"
  | "failed"
  | "unavailable"
  | "permissionDenied"
  | "skipped"
  | "cancelled";

/** One executed action. The trace that makes a run auditable after the fact. */
export interface ActionRecord {
  id: SoftwareId;
  source: InstallSource;
  /** Human-readable command, shown in advanced mode. */
  command: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: AttemptOutcome;
  exitCode: number | null;
  /** Captured tool output, truncated by the Rust side. */
  output: string;
  /** Set whenever `outcome` is not a success. */
  error: string | null;
  /** 0-based index into the fallback chain. */
  attempt: number;
  finalAttempt: boolean;
}

/** The record of one installation run. */
export interface ExecutionSession {
  id: string;
  profileId: string;
  startedAt: string;
  finishedAt: string | null;
  actions: ActionRecord[];
  steps: StepProgress[];
  failedSteps: SoftwareId[];
  cancelledSteps: SoftwareId[];
  /** Non-empty means the run can be continued. */
  remaining: SoftwareId[];
  /** The inventory taken *after* the run. */
  verified: SoftwareInventory | null;
  /** Why the run stopped early, if it did. */
  haltedReason: string | null;
  cancelledByUser: boolean;
}

/** Whether the plan can be started, computed before the run. */
export interface ExecutionReadiness {
  blockers: string[];
  canStart: boolean;
  wingetVersion: string | null;
  isElevated: boolean;
  needsAdmin: SoftwareId[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ConfigAction {
  id: string;
  target: string;
  description: string;
  applied: boolean | null;
  detail: string | null;
}

// ---------------------------------------------------------------------------
// Verification and report
// ---------------------------------------------------------------------------

export interface CheckResult {
  key: string;
  label: string;
  confidence: Confidence;
  expected: string | null;
  observed: string | null;
  hint: string | null;
}

export interface PackageVerification {
  id: SoftwareId;
  name: string;
  present: CheckResult;
  onPath: CheckResult;
  version: CheckResult;
  passed: boolean;
}

export interface VerificationReport {
  packages: PackageVerification[];
  passedCount: number;
  failedCount: number;
  overallOk: boolean;
}

export interface SetupReport {
  generatedAt: string;
  appVersion: string;
  profileId: string;
  profileName: string;
  environmentScore: number;
  environment: EnvironmentReport;
  plan: InstallPlan;
  verification: VerificationReport;
  configActions: ConfigAction[];
  notAttempted: string[];
}

// ---------------------------------------------------------------------------
// Bootstrap (stage 4)
// ---------------------------------------------------------------------------

/** What kind of work a bootstrap step does. */
export type BootstrapStepKind =
  | "extension"
  | "configCommand"
  | "fileWrite"
  | "skillInstall"
  | "localization";

/** The five stages the UI shows, in order. */
export type BootstrapStageKey =
  | "vscode"
  | "git"
  | "mcp"
  | "skills"
  | "localization";

/** One planned bootstrap step. */
export interface BootstrapStepView {
  actionId: string;
  stage: BootstrapStageKey;
  stageName: string;
  kind: BootstrapStepKind;
  name: string;
  /** An absolute path, an extension id, or a config key. */
  target: string | null;
  rationale: string;
  needed: boolean;
  skipReason: string | null;
  /** Non-null means the step cannot run; the string is the fix. */
  blocked: string | null;
}

/** Per-stage rollup, used to render the ✓ / ○ list. */
export interface BootstrapStageView {
  key: BootstrapStageKey;
  name: string;
  total: number;
  needed: number;
  blocked: number;
}

export interface BootstrapPlanView {
  profileId: string;
  steps: BootstrapStepView[];
  stages: BootstrapStageView[];
  neededCount: number;
  blockedCount: number;
  notAttempted: string[];
}

/** One step's result after a run. */
export interface BootstrapStepResultView {
  actionId: string;
  stage: BootstrapStageKey;
  status: StepStatus;
  /** The "current action" line, e.g. `正在安装 VS Code 插件 …`. */
  stageLabel: string;
  name: string;
  detail: string | null;
}

/** One verification check. */
export interface BootstrapCheckView {
  key: string;
  label: string;
  confidence: Confidence;
  expected: string;
  observed: string;
  hint: string | null;
}

export interface BootstrapVerificationView {
  checks: BootstrapCheckView[];
  passed: number;
  failed: number;
  unknown: number;
  overallOk: boolean;
  /** A ready-made one-line summary, so the UI does not build the sentence. */
  summary: string;
}

export interface BootstrapSessionView {
  id: string;
  profileId: string;
  startedAt: string;
  finishedAt: string | null;
  steps: BootstrapStepResultView[];
  succeededCount: number;
  failedSteps: string[];
  remaining: string[];
  haltedReason: string | null;
  resumable: boolean;
  verification: BootstrapVerificationView | null;
  stages: BootstrapStageView[];
}

/** One localisation target, for the explanation list. */
export interface LocalizationTargetView {
  id: string;
  target: string;
  /** The upstream project, shown so the student can see whose code will run. */
  upstream: string;
  /** `官方语言包` or `上游社区方案`. */
  method: string;
}

// ---------------------------------------------------------------------------
// Command payloads
// ---------------------------------------------------------------------------

export interface InstallStrategy {
  id: SoftwareId;
  name: string;
  purpose: string;
  preferred: string;
  fallbacks: string[];
}

export interface RenderedReport {
  report: SetupReport;
  text: string;
}

export interface RuntimeStatus {
  appVersion: string;
  profilesSource: string | null;
  localizationSource: string | null;
  profileCount: number;
  localizationCount: number;
  warnings: string[];
  wingetVersion: string | null;
  isElevated: boolean;
  os: string;
  arch: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The Rust `AppError` enum serialises as `{ kind, detail }`. */
export type AppError =
  | { kind: "unsupportedWindows"; detail: { build: number } }
  | { kind: "profileNotFound"; detail: { id: string } }
  | { kind: "profileInvalid"; detail: { reason: string } }
  | { kind: "probeFailed"; detail: { probe: string; reason: string } }
  | { kind: "wingetUnavailable"; detail: { reason: string } }
  | { kind: "installFailed"; detail: { id: string; reason: string } }
  /**
   * The action belongs to the paid tier and this machine is not activated.
   *
   * A distinct kind rather than a message to pattern-match: the UI has to
   * *recognise* this refusal and open the activation screen, and matching on
   * Chinese prose would break the moment the wording is improved.
   */
  | { kind: "licenseRequired"; detail: { reason: string } }
  | { kind: "internal"; detail: string };

/**
 * Renders any thrown value as a message a student can act on.
 *
 * Tauri rejects with the serialised `AppError` object rather than an `Error`,
 * so a naive `err.message` would print "[object Object]" — the single most
 * common way a Tauri app shows a useless error.
 */
export function describeError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;

  const e = err as Partial<AppError>;
  if (e && typeof e === "object" && "kind" in e) {
    const detail = (e as { detail: unknown }).detail;
    switch (e.kind) {
      case "unsupportedWindows":
        return `当前 Windows 版本过旧（内部版本 ${
          (detail as { build: number }).build
        }），请先完成系统更新。`;
      case "profileNotFound":
        return `找不到安装方案「${(detail as { id: string }).id}」。`;
      case "profileInvalid":
        return `方案文件格式有误：${(detail as { reason: string }).reason}`;
      case "probeFailed":
        return `检测失败：${(detail as { probe: string }).probe}（${
          (detail as { reason: string }).reason
        }）`;
      case "wingetUnavailable":
        return `winget 不可用：${(detail as { reason: string }).reason}`;
      case "installFailed":
        return `安装 ${(detail as { id: string }).id} 失败：${
          (detail as { reason: string }).reason
        }`;
      default:
        return String(detail);
    }
  }
  return "发生未知错误，请重试。";
}

// ---------------------------------------------------------------------------
// Stage 5: knowledge, goals, advisor
// ---------------------------------------------------------------------------

/**
 * One version note, as written in a knowledge file.
 *
 * Carries no verdict. The app states that 3.13/3.14 are newer than most of the
 * AI ecosystem targets; it does not say the student chose wrong. See
 * `modules/knowledge/mod.rs` for why that distinction is enforced by the type.
 */
export interface VersionNote {
  topic: string;
  /** Version prefixes this note is about. Empty means it applies to any version. */
  versions: string[];
  note: string;
}

/**
 * What the app can say about one program, independent of this machine.
 *
 * `fromKnowledge` is `false` when the catalog's own name and purpose were used
 * instead — the UI uses it to decline to render empty sections rather than
 * showing a heading with nothing under it.
 */
export interface ShownKnowledge {
  id: SoftwareId;
  name: string;
  category: string;
  description: string;
  /** Never empty: falls back to the catalog's purpose. */
  purposes: string[];
  studentExplanation: string;
  relatedCapabilities: string[];
  dependsOn: string[];
  commonlyUsedBy: string[];
  versions: VersionNote[];
  fromKnowledge: boolean;
}

/** How confident the detection layer is. Never a boolean — see `Confidence`. */
export type DetectionConfidence =
  | "confirmed"
  | "confirmedAbsent"
  | "unknown"
  | "skipped"
  | "notScanned";

/** A program, explained and measured. */
export interface ExplainedSoftware {
  knowledge: ShownKnowledge;
  /** `null` until an inventory has been taken. */
  installed: boolean | null;
  onPath: boolean | null;
  version: string | null;
  confidence: DetectionConfidence;
  /** Which probe answered, for the "检测来源" row. */
  evidence: string[];
  capabilityNames: string[];
  /** Only the notes matching the installed version. Empty when it is unknown. */
  applicableNotes: VersionNote[];
}

/** One selectable direction. */
export interface GoalView {
  id: string;
  name: string;
  tagline: string;
  audience: string;
  profileId: string;
  /** Display names of the required capabilities. */
  needs: string[];
  bonuses: string[];
}

export interface GoalListView {
  goals: GoalView[];
  /** Goals whose profile is not among the loaded profiles. */
  goalsWithoutProfiles: string[];
  defaultGoal: string;
}

/** A term worth explaining: MCP, CUDA, PATH. */
export interface ConceptNote {
  id: string;
  name: string;
  category: string;
  summary: string;
  whyItMatters: string;
  relatedCapabilities: string[];
}

/** One capability, as a goal's plan reports it. */
export interface PlanEntry {
  capabilityId: string;
  name: string;
  description: string;
  status: CapabilityStatusKind;
  summary: string;
  concepts: ConceptNote[];
}

/**
 * One recommended action.
 *
 * `kind` decides the UI treatment and is not cosmetic: `install` and `configure`
 * are things the app will do, `manual` is something only the student can do
 * (signing in, setting a Git identity). Offering a button for the third would be
 * a lie.
 */
export interface NextStep {
  order: number;
  title: string;
  reason: string;
  capabilityId: string;
  kind: "install" | "configure" | "manual" | "hardware";
}

/** A goal resolved against this machine. */
export interface EnvironmentPlan {
  goalId: string;
  goalName: string;
  goalTagline: string;
  profileId: string;
  profileName: string;
  /** 0–100, over the goal's required capabilities only. */
  completion: number;
  strengths: PlanEntry[];
  gaps: PlanEntry[];
  /** Kept apart from `gaps`: "could not check" is not "missing". */
  unmeasured: PlanEntry[];
  bonuses: PlanEntry[];
  nextSteps: NextStep[];
  headline: string;
  overall: string;
}

export type AdvisorGrade = "excellent" | "good" | "fair" | "limited" | "unknown";

export interface AdvisorFinding {
  id: string;
  name: string;
  detail: string;
  severity: "info" | "warn" | "medium" | "high";
}

export interface GoalFitness {
  goalId: string;
  goalName: string;
  completion: number;
  readiness: "ready" | "close" | "distant";
}

export interface Recommendation {
  order: number;
  title: string;
  reason: string;
  kind: "install" | "configure" | "manual" | "hardware";
}

/** The hardware readout, kept apart from capability findings: hardware cannot be installed. */
export interface MachineAssessment {
  cpu: string;
  memory: string;
  gpu: string;
  disk: string;
  notes: string[];
}

/** The advisory analysis of a machine. */
export interface AdvisorSummary {
  score: number;
  grade: AdvisorGrade;
  headline: string;
  strengths: AdvisorFinding[];
  gaps: AdvisorFinding[];
  unmeasured: AdvisorFinding[];
  /** Installed software no capability accounts for. Informational, never a gap. */
  extras: AdvisorFinding[];
  suitedFor: GoalFitness[];
  recommendations: Recommendation[];
  capabilitiesChecked: number;
  capabilitiesMet: number;
}

export interface AdvisorView {
  summary: AdvisorSummary;
  machine: MachineAssessment | null;
  /** `false` until a detection has run, so the UI can say "尚未检测". */
  detected: boolean;
}

export interface KnowledgeStatus {
  softwareCount: number;
  conceptCount: number;
  sourceDir: string | null;
  warnings: string[];
  /** Catalogued programs with no knowledge entry, listed rather than hidden. */
  withoutKnowledge: string[];
}

// ---------------------------------------------------------------------------
// Licensing (stage 5)
// ---------------------------------------------------------------------------

/**
 * What this build is allowed to do, and why.
 *
 * `tierLabel` and `reason` arrive from Rust rather than being derived here: the
 * free/pro wording and the explanation for a locked button are one decision, and
 * deriving either in the frontend would let two screens describe the same state
 * differently.
 *
 * `enforced` is the field that explains a build behaving unlike the one beside
 * it — a locked install button with tier `free` is only intelligible if the UI
 * can say that this build enforces tiers.
 */
export interface Entitlements {
  tier: "free" | "pro";
  tierLabel: string;
  canInstall: boolean;
  /** Whether the configuration/bootstrap stage may run. Separate command. */
  canConfigure: boolean;
  activated: boolean;
  enforced: boolean;
  /**
   * The machine-check outcome.
   *
   * `device_mismatch` is distinct from `inactive` because the two need different
   * sentences: a customer who copied `license.dat` to a second PC has a valid
   * code and must be told that, not told their code is wrong.
   *
   * **Snake case, and that is load-bearing.** `LicenseState` in
   * `modules/license/mod.rs` carries its own `#[serde(rename_all = "snake_case")]`,
   * which applies to the *values* even though the enclosing `Entitlements` struct
   * camelCases its field *names*. Writing `deviceMismatch` here (as this type did
   * until it was corrected) type-checks and reads plausibly, while every
   * comparison against it is false at run time — which is exactly how the
   * mismatch branch stayed dead: the type said one thing, the binary sent
   * another, and a hand-written fixture with the wrong casing agreed with the
   * type rather than with the binary.
   */
  state: "inactive" | "active" | "device_mismatch";
  /** ISO-8601 activation time, for display. `null` when inactive. */
  activatedAt: string | null;
  /**
   * Whether enough hardware probes succeeded for a mismatch to be meaningful.
   *
   * A mismatch on a machine where most probes failed is not evidence of
   * copying, and the licence screen says so rather than accusing the customer.
   */
  deviceReliable: boolean;
  reason: string;
}

/**
 * What the licence screen may show about this machine.
 *
 * There is no field for the activation code, and no command that returns one.
 * That is the brief's "用户不可查看" enforced at the type level: a component
 * cannot render a key it was never given, so no amount of frontend work can
 * accidentally add a copy button.
 */
export interface LicenseDeviceView {
  /** Abbreviated device digest, for display in support conversations. */
  shortId: string;
  /** How many hardware probes produced a value (0-4). */
  componentsReadable: number;
  reliable: boolean;
  boundHere: boolean;
  /** Snake case, for the same reason as `Entitlements.state` above. */
  state: "inactive" | "active" | "device_mismatch";
}

// ---------------------------------------------------------------------------
// Claude enhancement plugins
// ---------------------------------------------------------------------------

/**
 * Kebab-case, and deliberately not camelCase: `PluginTarget` in
 * `modules/plugins/mod.rs` carries its own `rename_all = "kebab-case"`, so the
 * binary sends `"claude-desktop"` while every other plugin enum camelCases.
 * Writing `"claudeDesktop"` against a plain `string` field type-checks and then
 * never matches at run time — the exact failure mode `Entitlements.state`
 * documents above.
 */
export type PluginTarget = "claude-desktop" | "claude-code" | "both";

export type RiskLevel = "low" | "medium" | "high";

export type CompatStatus =
  | "verified"
  | "unverified"
  | "incompatible"
  | "targetMissing"
  | "unknownVersion";

export type EvidenceStage =
  | "sourceFound"
  | "implemented"
  | "tested"
  | "realWorldVerified";

export type CodeLayer = "plugin" | "hook" | "config" | "cliPatch";

export type PluginRunMode = "dryRun" | "install" | "verify" | "rollback";

export type PluginRunStatus = "succeeded" | "refused" | "failed";

/**
 * Upstream's verified versions, matched by prefix — the same granularity the
 * upstream declares, rather than a semver range nobody promised.
 */
export interface CompatRange {
  desktop: string[];
  codeStable: string[];
  codeExperimental: string[];
  /** The upstream compatibility statement, quoted verbatim for the user. */
  note: string;
}

/** One row of `plugins/*.json`. Every field is data; none is hard-coded in Rust. */
export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  target: PluginTarget;
  category: string;
  author: string;
  /** Upstream repository — shown because we are asking the user to run someone else's code. */
  source: string;
  license: string;
  /** The plugin's own version, not Claude's. */
  version: string;
  compatibility: CompatRange;
  installMethod: string;
  requiresAdmin: boolean;
  riskLevel: RiskLevel;
  backupRequired: boolean;
  rollbackSupported: boolean;
  verifySupported: boolean;
  /** Free of charge — explicitly unrelated to the PRO tier. */
  free: boolean;
  modifies: string[];
  requires: string[];
  evidence: EvidenceStage;
  layers: CodeLayer[];
  upstreamNote: string;
  installer: string;
}

/** One observable pipeline stage; `key` is the stable testid (`backup`, `apply`, …). */
export interface StageOutcome {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail" | "skipped";
  detail: string;
}

/** The full record of one pipeline run. */
export interface PluginRun {
  pluginId: string;
  mode: PluginRunMode;
  status: PluginRunStatus;
  /** One-sentence verdict for the user. */
  reason: string;
  stages: StageOutcome[];
  /** Paths actually written; empty = the original files were never touched. */
  modified: string[];
  backup: string | null;
  restored: boolean;
  /** Whether the UI should offer "重新检测" after a failure or refusal. */
  offerRetry: boolean;
}

/** One Claude target as installed on this machine (brief item 12's status line). */
export interface PluginTargetState {
  target: PluginTarget;
  installed: boolean;
  version: string | null;
  root: string | null;
  running: boolean;
  /** Third-party localisation traces already present. */
  localized: boolean;
  /** A non-null `note` with `installed: false` means "could not tell", not "absent". */
  note: string | null;
}

/**
 * Catalogue entry resolved against this machine.
 *
 * The entry's fields are `#[serde(flatten)]`ed into the top level, so this is
 * an intersection rather than a nested object.
 */
export type PluginView = PluginEntry & {
  resolvedTarget: PluginTarget;
  compat: CompatStatus;
  compatReason: string;
  targetInstalled: boolean;
  targetVersion: string | null;
  /** A record exists in plugin-state.json, i.e. this plugin is installed. */
  active: boolean;
  /** The Claude version it was installed against. */
  installedForVersion: string | null;
  /** Claude updated since install; the plugin needs re-applying. */
  stale: boolean;
  /** Why the install button is disabled; null = installable. */
  blockedReason: string | null;
  backup: string | null;
  /** `[layer, usable, why]` per offered layer (Claude Code only; empty otherwise). */
  layerNotes: [CodeLayer, boolean, string][];
};
