/**
 * Application store.
 *
 * Holds the *flow state* (which screen, what has been detected, what is
 * selected) and the actions that advance it. Deliberately not a data layer: the
 * command modules stay in `lib/ipc.ts` and the store only orchestrates them.
 *
 * The screen progression is a small explicit state machine rather than a router,
 * because the brief's flow is linear (welcome → detect → choose → install →
 * done) and a real router would add URL semantics nobody needs in a desktop
 * wizard.
 */

import { create } from "zustand";
import * as ipc from "./ipc";
import { describeError } from "./types";
import type {
  AdvisorView,
  BootstrapPlanView,
  BootstrapSessionView,
  CapabilityStatus,
  ConfigAction,
  Entitlements,
  EnvironmentPlan,
  EnvironmentReport,
  ExecutionReadiness,
  ExecutionSession,
  ExplainedSoftware,
  GoalListView,
  InstallPlan,
  InstallStrategy,
  KnowledgeStatus,
  LicenseDeviceView,
  LocalizationTargetView,
  MachineFacts,
  Profile,
  ProfileCapabilityView,
  RuntimeStatus,
  SoftwareDescriptor,
  SoftwareId,
  SoftwareInventory,
  StepProgress,
  VerificationReport,
} from "./types";
import {
  hydrateCustomExperiences,
  loadOverrides,
  saveOverrides,
  clearOverrides,
} from "../styles/runtime";
import { loadSavedStyle, saveStylePreference, type StyleId, type TokenOverrides } from "./styles";
import { TransferHistory } from "../core/transfer";

export type Screen =
  | "welcome"
  | "goal"
  | "detect"
  | "software"
  | "choose"
  | "install"
  | "bootstrap"
  | "done";

/**
 * The dashboard's top-level sections.
 *
 * A separate axis from [`Screen`] on purpose. `Screen` is the *first-run flow*
 * (welcome → detect → choose → …), which a student walks once. `Section` is the
 * *dashboard*, which they return to and browse. Conflating them would force the
 * dashboard to be a step in a wizard, which is the linear model this phase
 * exists to replace.
 */
export type Section =
  | "overview"
  | "goals"
  | "software"
  | "repos"
  | "resources"
  | "library"
  | "style"
  | "config"
  | "history"
  | "plugins"
  | "license"
  | "about";

/** Unified location modeling both Wizard screens and Dashboard sections */
export type AppLocation =
  | {
      surface: "dashboard";
      section: Section;
      selectedItemId?: string | null;
      scrollTop?: number;
    }
  | {
      surface: "wizard";
      screen: Screen;
    };

/** The ambient theme. `system` follows the OS and is the default. */
export type ThemePreference = "light" | "dark" | "system";

/** Progress of the detection screen, driven by real probe completion. */
export type DetectPhase =
  | { kind: "idle" }
  | { kind: "running"; completed: string[]; current: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

interface AppStore {
  // --- Navigation -----------------------------------------------------------
  location: AppLocation;
  locationHistory: AppLocation[];
  navigate: (target: AppLocation) => void;
  replaceLocation: (target: AppLocation) => void;
  screen: Screen;
  /**
   * Where "返回" came from.
   *
   * A real history stack, not a hardcoded previous step, because the wizard is
   * no longer walked in one direction only: a student can reach 已装软件 from
   * 检测 *or* from the dashboard, and a back button that always said
   * "goTo('detect')" would be right in one case and wrong in the other. The
   * stack is what makes "return to the page I came from" expressible at all.
   *
   * Semantics (these are the contract; `goTo`/`goBack` implement exactly this):
   *  - `goTo(next)` pushes the *current* screen, then switches.
   *  - Self-navigation (`goTo(screen)` while already there) is a no-op: it
   *    neither switches nor pushes.
   *  - The stack holds no duplicates of the current screen: consecutive
   *    equal entries are impossible, so repeated back presses always walk
   *    distinct pages rather than sticking.
   *  - `goBack()` pops the last entry and restores it.
   *  - `goBack()` on an empty stack is a **no-op**: it does not navigate, does
   *    not fall through to `welcome`, and does not open the dashboard.
   *  - The stack is capped at `NAV_STACK_LIMIT`; the oldest entry is dropped
   *    when it overflows, which bounds memory in a long session.
   *  - Crucially, every other field in this store — goal, chosenSteps,
   *    inventory, plan, entitlements, selectedItemId, profileId, session —
   *    survives both `goTo` and `goBack` untouched. Navigation is not a reset.
   */
  navStack: Screen[];
  goTo: (screen: Screen) => void;
  /** Returns to the previous screen. No-op when there is no previous screen. */
  goBack: () => void;
  /** `true` when there is a previous screen, so a back button may be rendered. */
  canGoBack: () => boolean;
  /**
   * The wizard screen the dashboard was entered from, or `null` when it was
   * entered cold (launch, gate, or licence-active).
   *
   * Recorded by `openDashboard` so the dashboard's "回到首次设置" can mean
   * *that* page rather than a guess. The dashboard is itself a ROOT and renders
   * no back button; this is the exit, not a back, and the two are deliberately
   * separate so a root never pretends to have a previous page.
   */
  dashboardOrigin: Screen | null;

  // --- Dashboard (stage 5) --------------------------------------------------
  /**
   * Whether the dashboard is the active surface.
   *
   * The dashboard and the first-run wizard are two ways of looking at the same
   * machine, and a student moves between them rather than through them: finishing
   * a run returns to the dashboard, and "重新规划" enters the wizard. Keeping the
   * switch explicit here means no screen has to infer which world it is in.
   *
   * `openDashboard` records the wizard screen it was called from into
   * `dashboardOrigin` before flipping this, so the dashboard can offer a
   * meaningful exit without the wizard having to be the one that remembers.
   */
  dashboardOpen: boolean;
  openDashboard: (section?: Section) => void;
  closeDashboard: () => void;

  /** The dashboard's current section. */
  section: Section;
  setSection: (section: Section) => void;

  /**
   * The item whose detail is shown in the right-hand panel.
   *
   * A single id rather than one per section: the panel is one surface, and giving
   * each section its own selection would let two of them claim it at once.
   */
  selectedItemId: string | null;
  selectItem: (id: string | null) => void;

  // --- Theme ----------------------------------------------------------------
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;

  // --- Visual Style Playground ----------------------------------------------
  activeStyle: StyleId;
  setActiveStyle: (style: StyleId) => void;
  /**
   * The user's token overrides for the *active* experience.
   *
   * Lives here rather than in the tweaker component because it is not view
   * state: it is part of the active experience, and it has to be re-derived
   * from the newly-selected experience's own slot the moment the experience
   * changes. When the tweaker owned this in local state and was merely *passed*
   * a new `activeStyleId` prop, its lazy initialiser never re-ran — so the
   * previous style's values stayed in memory and were then written into the new
   * style's storage slot. Hoisting it makes that aliasing impossible to
   * reintroduce, because the switch and the reload are the same action.
   */
  styleOverrides: TokenOverrides;
  setStyleOverrides: (overrides: TokenOverrides) => void;
  /** Forget the overrides; resolution falls back to the manifest's own values. */
  resetStyleOverrides: () => void;
  /**
   * Bumped whenever a derived ("Save as Custom") experience is added or
   * removed, so the gallery re-reads the registry without polling.
   */
  customExperiencesVersion: number;
  refreshCustomExperiences: () => void;

  // --- Capability layer (stage 5) -------------------------------------------
  capabilities: CapabilityStatus[];
  capabilitiesPhase: "idle" | "loading" | "done" | "error";
  capabilitiesError: string | null;
  machine: MachineFacts | null;
  /** Every catalogued program, as Rust describes it. */
  catalogue: SoftwareDescriptor[];
  /** What the selected profile aims at. */
  profileCapabilities: ProfileCapabilityView | null;
  loadCapabilities: () => Promise<void>;

  // --- Knowledge, goals and advisor (stage 5) -------------------------------
  /**
   * Every program with its explanation and its measured state.
   *
   * Loaded once and reused by both the software list and the detail pane, so the
   * two cannot show different versions of the same row.
   */
  explained: ExplainedSoftware[];
  explainedPhase: "idle" | "loading" | "done" | "error";
  explainedError: string | null;

  /** The directions a student can choose. */
  goals: GoalListView | null;
  /** The goal the student has chosen, if any. */
  selectedGoalId: string | null;
  selectGoal: (id: string) => void;
  /** The chosen goal resolved: completion, gaps, next steps. */
  goalPlan: EnvironmentPlan | null;
  goalPlanPhase: "idle" | "loading" | "done" | "error";
  goalPlanError: string | null;
  /** Every goal resolved, for the advisor's fitness list. */
  allPlans: EnvironmentPlan[];

  /** The advisory analysis of this machine. */
  advisor: AdvisorView | null;
  advisorPhase: "idle" | "loading" | "done" | "error";
  advisorError: string | null;

  /** Knowledge-base coverage and warnings. */
  knowledgeStatus: KnowledgeStatus | null;

  // --- Licensing (stage 5) --------------------------------------------------
  /**
   * The current tier and what it permits.
   *
   * Held in the store rather than fetched per-screen because two surfaces need
   * it (the dashboard section and, potentially, a gate before install) and they
   * must never disagree. It is also the one field whose whole purpose is to be
   * *stable* — a licence that flickered between screens would be alarming.
   */
  entitlements: Entitlements | null;
  entitlementsPhase: "idle" | "loading" | "done" | "error";
  entitlementsError: string | null;
  /** `true` while an activation call is in flight. */
  activatingLicense: boolean;
  /**
   * This machine's binding summary, for the licence screen. `null` until read.
   */
  licenseDevice: LicenseDeviceView | null;
  /**
   * Set when a gated action was refused, so a screen can open the activation
   * panel instead of rendering a red error.
   *
   * Held in the store rather than returned from the action because the refusal
   * is not the concern of the caller that triggered it: `Install` would have to
   * know that a `licenseRequired` means "navigate to 版本", which is policy the
   * store already owns.
   */
  gateBlocked: string | null;
  clearGateBlock: () => void;
  loadEntitlements: () => Promise<void>;
  /** Activates a key. Resolves `true` on success so the form can clear itself. */
  activateLicense: (key: string) => Promise<boolean>;
  deactivateLicense: () => Promise<void>;

  loadExplained: () => Promise<void>;
  loadGoals: () => Promise<void>;
  loadGoalPlan: (goalId: string) => Promise<void>;
  loadAdvisor: () => Promise<void>;
  /** Reloads everything stage 5 reads, after a detection or a scan. */
  loadDashboard: () => Promise<void>;

  // --- Detection ------------------------------------------------------------
  detect: DetectPhase;
  environment: EnvironmentReport | null;
  runDetection: () => Promise<void>;

  // --- Software inventory ---------------------------------------------------
  inventory: SoftwareInventory | null;
  inventoryPhase: "idle" | "scanning" | "done" | "error";
  inventoryError: string | null;
  scanInstalled: (ids?: SoftwareId[]) => Promise<void>;

  // --- Profiles -------------------------------------------------------------
  profiles: Profile[];
  profilesLoading: boolean;
  profilesError: string | null;
  selectedProfileId: string | null;
  loadProfiles: () => Promise<void>;
  selectProfile: (id: string) => void;

  // --- Plan -----------------------------------------------------------------
  plan: InstallPlan | null;
  strategies: InstallStrategy[];
  planLoading: boolean;
  planError: string | null;
  buildPlan: () => Promise<void>;
  /**
   * Builds a plan for exactly these programs, regardless of which profile is
   * selected. This is the path a row's "安装" button uses: the student named a
   * program, so the plan must contain that program and nothing they did not ask
   * for. An empty profile id is legitimate — they may have opened the software
   * list without picking a scenario first.
   */
  buildPlanFor: (ids: SoftwareId[]) => Promise<void>;

  // --- Execution ------------------------------------------------------------
  /** The live or last-finished run. `null` before anything has been attempted. */
  session: ExecutionSession | null;
  /** Readiness for the current plan, so blockers are shown before committing. */
  readiness: ExecutionReadiness | null;
  /** `true` while the engine is physically installing. */
  installing: boolean;
  executionError: string | null;
  /** Whether there is an interrupted run worth offering to continue. */
  canResume: boolean;
  /**
   * The programs the student has asked to install, when they have made a choice.
   *
   * `null` means "no opinion" and installs the whole plan — which is what the
   * wizard's straight-through path wants. A set means the student unchecked
   * something and only that set should run. It is deliberately *not* a list of
   * programmes excluded, because a plan can be rebuilt between renders (a
   * rescan, a profile change) and an exclusion list would then silently apply to
   * steps it was never computed against.
   */
  chosenSteps: Set<SoftwareId> | null;
  /** Replaces the selection. `null` restores "install everything in the plan". */
  setChosenSteps: (ids: SoftwareId[] | null) => void;
  /**
   * Live per-step progress, keyed by program.
   *
   * ## Why this is separate from `session`
   *
   * `session` is the *finished* record: Rust hands it back once, when the run is
   * over. It cannot describe a run in progress, because during the run there is
   * no session object yet — that was the 0.1.1 dead end. This map is fed by the
   * `install://progress` event instead, so it exists exactly when `session` does
   * not.
   *
   * Keyed by `SoftwareId` rather than kept as a list so a later update to the
   * same step *replaces* the earlier one. The engine emits several updates for a
   * single step (announced → running → finished), and appending them would make
   * the UI render the same program three times.
   *
   * A `Map` rather than a plain object because the ids are a closed set and a
   * `Map` keeps insertion order — the list renders in the order the engine
   * worked, without the UI having to sort by `index`.
   */
  liveProgress: Map<SoftwareId, StepProgress>;
  /**
   * Attaches the progress listener and returns its detach function.
   *
   * Called once by the install screen while it is on screen. A no-op when the
   * listener cannot be attached (browser preview, or a Tauri version without
   * events), so the screen still works — it simply shows the coarser
   * session-level state it had before 0.1.2.
   */
  watchInstallProgress: () => Promise<() => void>;
  /** Begin executing the current plan. */
  startInstall: () => Promise<void>;
  /** Continue an interrupted run. */
  resumeInstall: () => Promise<void>;
  /** Ask the running engine to stop at the next safe point. */
  cancelInstall: () => Promise<void>;
  /** Loads any resumable session left by a previous run or a previous launch. */
  loadResumable: () => Promise<void>;
  checkReadiness: () => Promise<void>;

  // --- Verification / report ------------------------------------------------
  verification: VerificationReport | null;
  configActions: ConfigAction[];
  reportText: string | null;
  reportPath: string | null;
  preparing: boolean;
  prepareFinish: () => Promise<void>;
  downloadReport: () => Promise<void>;

  // --- Bootstrap (stage 4) --------------------------------------------------
  /**
   * What will be configured, in stage order. Read-only: building it probes the
   * machine but writes nothing.
   */
  bootstrapPlan: BootstrapPlanView | null;
  /** The live or last-finished bootstrap run. */
  bootstrapSession: BootstrapSessionView | null;
  /** `true` while the bootstrap engine is physically working. */
  bootstrapping: boolean;
  bootstrapError: string | null;
  /** Whether there is an interrupted bootstrap worth offering to continue. */
  canResumeBootstrap: boolean;
  /** The localisation targets, for the explanation list. */
  localizationTargets: LocalizationTargetView[];
  buildBootstrapPlan: () => Promise<void>;
  startBootstrap: () => Promise<void>;
  cancelBootstrap: () => Promise<void>;
  /** Re-reads the machine after a run, without re-running anything. */
  recheckBootstrap: () => Promise<void>;
  loadBootstrapState: () => Promise<void>;

  // --- Diagnostics ----------------------------------------------------------
  status: RuntimeStatus | null;
  loadStatus: () => Promise<void>;

  // --- Errors ---------------------------------------------------------------
  /** Last non-fatal error, shown as a dismissible strip. */
  notice: string | null;
  dismissNotice: () => void;
}

/**
 * Turns a thrown refusal into store state, keeping a genuine failure a failure.
 *
 * A `licenseRequired` rejection is not an error the customer should see in red:
 * it is the paid tier working as intended, and the right response is to show the
 * activation panel. Everything else stays on the error field it already had.
 *
 * Returning a partial state object rather than branching at each call site means
 * the three gated actions share one definition of "this was a refusal", so they
 * cannot drift into treating it three different ways.
 */
function refusalOrError(
  err: unknown,
  errorField: "executionError" | "bootstrapError" = "executionError",
): Record<string, unknown> {
  const e = err as { kind?: string; detail?: { reason?: string } } | null;
  if (e && typeof e === "object" && e.kind === "licenseRequired") {
    // `gateBlocked` carries the sentence Rust produced, so the UI never has to
    // write a second explanation for the same state.
    return {
      gateBlocked: e.detail?.reason ?? "此功能需要激活专业版。",
      [errorField]: null,
    };
  }
  return { [errorField]: describeError(err) };
}

/**
 * How deep the navigation history may go.
 *
 * The wizard has eight screens and a student can bounce between them, so 50 is
 * far more than a real session needs — it exists to bound memory rather than to
 * be reached. Dropping the *oldest* entry on overflow is the right end to lose:
 * the entries a back press is about to use are the newest ones.
 */
const NAV_STACK_LIMIT = 50;

/**
 * The empty history, as a shared constant.
 *
 * Zustand's `set` merges by default, so `set({ screen })` leaves `navStack`
 * alone — that is what makes back-preservation work. The one place this constant
 * matters is `useApp.setState`, which some screens call directly: giving them a
 * stable empty array keeps the store's initial value from being a fresh `[]`
 * that two callers could develop independently.
 */
export const NO_HISTORY: readonly Screen[] = Object.freeze([]);

function isSameLocation(a: AppLocation, b: AppLocation): boolean {
  if (a.surface !== b.surface) return false;
  if (a.surface === "dashboard" && b.surface === "dashboard") {
    return a.section === b.section && (a.selectedItemId ?? null) === (b.selectedItemId ?? null);
  }
  if (a.surface === "wizard" && b.surface === "wizard") {
    return a.screen === b.screen;
  }
  return false;
}

function getCurrentLocation(state: { dashboardOpen: boolean; section: Section; selectedItemId: string | null; screen: Screen }): AppLocation {
  if (state.dashboardOpen) {
    return {
      surface: "dashboard",
      section: state.section,
      selectedItemId: state.selectedItemId,
    };
  }
  return {
    surface: "wizard",
    screen: state.screen,
  };
}

export const useApp = create<AppStore>((set, get) => ({
  location: { surface: "wizard", screen: "welcome" },
  locationHistory: [],

  navigate: (target: AppLocation) => {
    const state = get();
    const current = getCurrentLocation(state);
    if (isSameLocation(current, target)) return;

    const history = state.locationHistory;
    const nextHistory =
      history.length > 0 && isSameLocation(history[history.length - 1], current)
        ? history
        : [...history, current].slice(-NAV_STACK_LIMIT);

    if (target.surface === "dashboard") {
      set({
        dashboardOpen: true,
        section: target.section,
        selectedItemId: target.selectedItemId ?? null,
        location: target,
        locationHistory: nextHistory,
        navStack: nextHistory
          .filter((loc): loc is { surface: "wizard"; screen: Screen } => loc.surface === "wizard")
          .map((loc) => loc.screen),
      });
    } else {
      set({
        dashboardOpen: false,
        screen: target.screen,
        location: target,
        locationHistory: nextHistory,
        navStack: nextHistory
          .filter((loc): loc is { surface: "wizard"; screen: Screen } => loc.surface === "wizard")
          .map((loc) => loc.screen),
      });
    }
  },

  replaceLocation: (target: AppLocation) => {
    if (target.surface === "dashboard") {
      set({
        dashboardOpen: true,
        section: target.section,
        selectedItemId: target.selectedItemId ?? null,
        location: target,
      });
    } else {
      set({
        dashboardOpen: false,
        screen: target.screen,
        location: target,
      });
    }
  },

  screen: "welcome",
  navStack: [...NO_HISTORY],

  goTo: (next) => {
    get().navigate({ surface: "wizard", screen: next });
  },

  goBack: () => {
    const history = get().locationHistory;
    if (history.length === 0) {
      const legacyStack = get().navStack;
      if (legacyStack.length > 0) {
        const prev = legacyStack[legacyStack.length - 1];
        set({
          dashboardOpen: false,
          screen: prev,
          navStack: legacyStack.slice(0, -1),
          location: { surface: "wizard", screen: prev },
        });
      }
      return;
    }

    const previous = history[history.length - 1];
    const nextHistory = history.slice(0, -1);

    if (previous.surface === "dashboard") {
      set({
        dashboardOpen: true,
        section: previous.section,
        selectedItemId: previous.selectedItemId ?? null,
        location: previous,
        locationHistory: nextHistory,
        navStack: nextHistory
          .filter((loc): loc is { surface: "wizard"; screen: Screen } => loc.surface === "wizard")
          .map((loc) => loc.screen),
      });
    } else {
      set({
        dashboardOpen: false,
        screen: previous.screen,
        location: previous,
        locationHistory: nextHistory,
        navStack: nextHistory
          .filter((loc): loc is { surface: "wizard"; screen: Screen } => loc.surface === "wizard")
          .map((loc) => loc.screen),
      });
    }
  },

  canGoBack: () => get().locationHistory.length > 0 || get().navStack.length > 0,

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------
  dashboardOrigin: null,
  dashboardOpen: false,
  openDashboard: (section?: Section) => {
    get().navigate({ surface: "dashboard", section: section ?? "overview" });
  },
  closeDashboard: () => {
    if (get().canGoBack()) {
      get().goBack();
    } else {
      get().navigate({ surface: "wizard", screen: "welcome" });
    }
  },

  section: "overview",
  setSection: (section) => {
    get().navigate({ surface: "dashboard", section });
  },

  selectedItemId: null,
  selectItem: (selectedItemId) => set({ selectedItemId }),

  // -------------------------------------------------------------------------
  // Theme
  // -------------------------------------------------------------------------
  // Applied to `documentElement` by the effect in App.tsx rather than here, so
  // the store stays free of DOM access and remains testable outside a browser.
  theme: "system",
  setTheme: (theme) => set({ theme }),

  // -------------------------------------------------------------------------
  // Visual Style Playground
  // -------------------------------------------------------------------------
  activeStyle: loadSavedStyle(),
  setActiveStyle: (activeStyle) => {
    saveStylePreference(activeStyle);
    // The overrides are re-read from the *incoming* experience's own slot in the
    // same update. Doing both in one `set` is what makes a style switch
    // atomically "switch + hydrate" — there is no window in which the previous
    // experience's tokens are paired with the new experience's id.
    set({ activeStyle, styleOverrides: loadOverrides(activeStyle) });
    try {
      TransferHistory.record({
        type: "style-switch",
        title: "切换设计系统",
        targetId: activeStyle,
        targetName: activeStyle,
        status: "info",
        summary: `已激活视觉风格「${activeStyle}」`,
      });
    } catch {
      // ignore
    }
  },

  // Overrides are scoped to the active experience; see `setActiveStyle`.
  styleOverrides: loadOverrides(loadSavedStyle()),
  setStyleOverrides: (styleOverrides) => {
    set({ styleOverrides });
    saveOverrides(useApp.getState().activeStyle, styleOverrides);
  },
  resetStyleOverrides: () => {
    set({ styleOverrides: {} });
    // Deletes the entry instead of writing the manifest's current values back
    // down as an override. "Restore default" has to mean the manifest is
    // reachable again, not that today's default has been frozen into a
    // user-chosen value — otherwise a later Vault update to the preset would
    // silently not reach this user.
    clearOverrides(useApp.getState().activeStyle);
  },
  customExperiencesVersion: 0,
  refreshCustomExperiences: () => {
    hydrateCustomExperiences();
    set((s) => ({ customExperiencesVersion: s.customExperiencesVersion + 1 }));
  },

  // -------------------------------------------------------------------------
  // Capability layer
  // -------------------------------------------------------------------------
  // Loaded in one call each, and deliberately *not* derived from the inventory in
  // the frontend. Capability resolution is a Rust concern with Rust's rules about
  // unknown-vs-missing; reimplementing it here would give the app two answers to
  // the same question and guarantee they eventually differ.
  capabilities: [],
  capabilitiesPhase: "idle",
  capabilitiesError: null,
  machine: null,
  catalogue: [],
  profileCapabilities: null,

  explained: [],
  explainedPhase: "idle",
  explainedError: null,
  goals: null,
  selectedGoalId: null,
  goalPlan: null,
  goalPlanPhase: "idle",
  goalPlanError: null,
  allPlans: [],
  advisor: null,
  advisorPhase: "idle",
  advisorError: null,
  knowledgeStatus: null,

  // -------------------------------------------------------------------------
  // Licensing
  //
  // Loaded separately from the dashboard's data because it fails differently:
  // a licence read is a local file, not a probe, so if it errors the rest of
  // the dashboard is still fine and only this section degrades.
  //
  // The tier *is* enforced, but not here: `run_install`, `resume_install` and
  // `run_bootstrap` refuse in Rust before doing any work, because that is the
  // only place a refusal is guaranteed to happen before the machine is touched.
  // This store's job is to *recognise* that refusal (`gateBlocked`) and to look
  // ahead of it so the customer is told before they press the button, rather
  // than being surprised after.
  // -------------------------------------------------------------------------
  entitlements: null,
  entitlementsPhase: "idle",
  entitlementsError: null,
  activatingLicense: false,
  licenseDevice: null,
  gateBlocked: null,

  clearGateBlock: () => set({ gateBlocked: null }),

  loadEntitlements: async () => {
    set({ entitlementsPhase: "loading", entitlementsError: null });
    try {
      const [entitlements, licenseDevice] = await Promise.all([
        ipc.licenseStatus(),
        // The device summary is part of the same decision, so it is read at the
        // same time. Fetching it per-render would put a command call inside the
        // licence screen's first paint.
        ipc.licenseDevice(),
      ]);
      set({ entitlements, licenseDevice, entitlementsPhase: "done" });
    } catch (err) {
      set({
        entitlementsPhase: "error",
        entitlementsError: describeError(err),
      });
    }
  },

  activateLicense: async (key) => {
    set({ activatingLicense: true, entitlementsError: null });
    try {
      // The command returns the post-activation entitlements, so this assigns
      // the authoritative answer rather than re-reading — which is what stops a
      // stale tier being rendered in the gap between the two calls.
      const entitlements = await ipc.activateLicense(key);
      set({ entitlements, activatingLicense: false, entitlementsPhase: "done" });
      return true;
    } catch (err) {
      set({
        activatingLicense: false,
        entitlementsError: describeError(err),
      });
      return false;
    }
  },

  deactivateLicense: async () => {
    set({ activatingLicense: true, entitlementsError: null });
    try {
      const entitlements = await ipc.deactivateLicense();
      set({ entitlements, activatingLicense: false, entitlementsPhase: "done" });
    } catch (err) {
      set({
        activatingLicense: false,
        entitlementsError: describeError(err),
      });
    }
  },

  // -------------------------------------------------------------------------
  // Knowledge, goals and advisor (stage 5)
  //
  // Three separate loaders rather than one, because they fail independently and
  // the screen keeps working when one of them does. A knowledge file with a typo
  // must not blank the goal list; a slow advisor must not delay the software
  // rows. Each records its own phase and error for that reason.
  // -------------------------------------------------------------------------

  loadExplained: async () => {
    set({ explainedPhase: "loading", explainedError: null });
    try {
      const [explained, knowledgeStatus] = await Promise.all([
        ipc.explainedCatalogue(),
        ipc.knowledgeStatus(),
      ]);
      // `SoftwareSection` builds a Map from this array on every render, so a
      // payload that is not an array throws inside React and unmounts the whole
      // dashboard -- the most expensive possible response to one malformed
      // reply. Rust declares `Vec<ExplainedSoftwareView>`, so this should never
      // fire; it is here because the cost of being wrong is a blank app rather
      // than a missing section, which is not a proportionate trade.
      set({
        explained: Array.isArray(explained) ? explained : [],
        knowledgeStatus,
        explainedPhase: "done",
      });
    } catch (err) {
      set({ explainedPhase: "error", explainedError: describeError(err) });
    }
  },

  loadGoals: async () => {
    try {
      const goals = await ipc.listGoals();
      // The default is applied only when nothing is chosen yet, so a student who
      // picked a direction does not have it silently reset by a reload.
      const selected = get().selectedGoalId ?? goals.defaultGoal;
      set({ goals, selectedGoalId: selected });
      await get().loadGoalPlan(selected);
    } catch (err) {
      set({ goalPlanPhase: "error", goalPlanError: describeError(err) });
    }
  },

  selectGoal: (id) => {
    set({ selectedGoalId: id });
    void get().loadGoalPlan(id);
  },

  loadGoalPlan: async (goalId) => {
    set({ goalPlanPhase: "loading", goalPlanError: null });
    try {
      const [goalPlan, allPlans] = await Promise.all([
        ipc.environmentPlan(goalId),
        ipc.environmentPlans(),
      ]);
      set({ goalPlan, allPlans, goalPlanPhase: "done" });
    } catch (err) {
      set({ goalPlanPhase: "error", goalPlanError: describeError(err) });
    }
  },

  loadAdvisor: async () => {
    set({ advisorPhase: "loading", advisorError: null });
    try {
      const advisor = await ipc.advisorSummary();
      set({ advisor, advisorPhase: "done" });
    } catch (err) {
      set({ advisorPhase: "error", advisorError: describeError(err) });
    }
  },

  loadDashboard: async () => {
    // Sequential, not parallel: the advisor reads the same cached environment
    // and inventory the others do, and running the probes concurrently would let
    // the four views resolve against different snapshots of the machine.
    await get().loadCapabilities();
    await get().loadExplained();
    await get().loadGoals();
    await get().loadAdvisor();
    await get().loadEntitlements();
  },

  loadCapabilities: async () => {
    set({ capabilitiesPhase: "loading", capabilitiesError: null });
    try {
      // The catalogue is fetched alongside rather than separately by each screen,
      // so every row on every surface is described by the same data.
      const [capabilities, catalogue, machine] = await Promise.all([
        ipc.capabilityReport(),
        ipc.softwareCatalogue(),
        ipc.machineFacts(),
      ]);
      set({
        // `call<T>` is a type assertion, not a runtime guarantee: a missing command
        // or a transport fault makes the promise *resolve* with `undefined` rather
        // than reject, so the `catch` below never runs. `capabilities` is declared
        // non-optional (`CapabilityStatus[]`), so nothing upstream guards it either.
        // An `undefined` here used to blank the whole dashboard while
        // `capabilitiesPhase` still reported "done" — the exact outcome the comment
        // in the `catch` branch promises must not happen. Coerce at the boundary.
        capabilities: capabilities ?? [],
        catalogue,
        machine,
        capabilitiesPhase: "done",
      });
    } catch (err) {
      // A capability failure must not blank the dashboard: the software list and
      // the environment score are still meaningful without it, so this records
      // the error and lets those sections render.
      set({
        capabilitiesPhase: "error",
        capabilitiesError: describeError(err),
      });
    }
  },

  // -------------------------------------------------------------------------
  // Detection
  // -------------------------------------------------------------------------
  // The Rust command runs all probes in one call. We surface granular progress
  // by naming each stage on a timer while it runs — the probes genuinely take a
  // second or two (three network round-trips), and a silent spinner for that
  // long reads as a hang. The steps are honest: they describe work that is
  // actually happening, in the order it happens.
  detect: { kind: "idle" },
  environment: null,
  runDetection: async () => {
    set({ detect: { kind: "running", completed: [], current: "正在读取系统信息…" } });

    const stages = [
      { after: 0, label: "正在读取系统信息…" },
      { after: 1, label: "正在检查权限与磁盘…" },
      { after: 2, label: "正在测试网络连通性…" },
      { after: 3, label: "正在汇总评分…" },
    ];

    const timers: number[] = [];
    stages.slice(1).forEach((stage, i) => {
      timers.push(
        window.setTimeout(() => {
          const state = get().detect;
          if (state.kind !== "running") return;
          set({
            detect: {
              kind: "running",
              completed: [...state.completed, stages[i].label],
              current: stage.label,
            },
          });
        }, stage.after * 650),
      );
    });

    try {
      const environment = await ipc.detectEnvironment();
      set({ environment, detect: { kind: "done" } });
      // The capability rows are computed from this report, so re-reading them
      // here is what keeps the dashboard from showing hardware it measured a
      // minute ago beside an environment score that just changed.
      void get().loadCapabilities();
      // The advisor is a *view* over this report, so it is stale the moment the
      // report changes. It used to be fetched once on mount (`if (!advisor)`),
      // which on a cold start computed it before this detection had landed and
      // then never recomputed it: the overview announced "没有一项检测完成" above
      // capability lists that had just been read from the finished report.
      void get().loadAdvisor();
    } catch (err) {
      set({
        detect: { kind: "error", message: describeError(err) },
        notice: describeError(err),
      });
    } finally {
      timers.forEach(clearTimeout);
    }
  },

  // -------------------------------------------------------------------------
  // Software inventory
  // -------------------------------------------------------------------------
  // A separate action from `runDetection` because the two have different costs
  // and different failure modes. Detection is network-bound and produces the
  // score; the inventory is disk-bound (three providers, several hundred
  // registry keys) and produces the software list. Running them in parallel on
  // the welcome screen keeps the slowest single path rather than their sum, and
  // a failure in one does not blank the other.
  inventory: null,
  inventoryPhase: "idle",
  inventoryError: null,
  scanInstalled: async (ids) => {
    set({ inventoryPhase: "scanning", inventoryError: null });
    try {
      const inventory = await ipc.scanSoftware(ids);
      set({ inventory, inventoryPhase: "done" });
      // A scan changes what we know is installed, which is exactly the input the
      // capability resolver reads. Refreshing here is the difference between a
      // dashboard that updates when a program appears and one that only tells
      // the truth at launch.
      void get().loadCapabilities();
      // Same reasoning: the advisor's strengths and gaps are read off the
      // inventory, so a scan that changes it must not leave a stale summary on
      // screen.
      void get().loadAdvisor();
    } catch (err) {
      set({ inventoryPhase: "error", inventoryError: describeError(err) });
    }
  },

  // -------------------------------------------------------------------------
  // Profiles
  // -------------------------------------------------------------------------
  profiles: [],
  profilesLoading: false,
  profilesError: null,
  selectedProfileId: null,
  loadProfiles: async () => {
    set({ profilesLoading: true, profilesError: null });
    try {
      const profiles = await ipc.listProfiles();
      set({
        profiles,
        profilesLoading: false,
        // Preselect nothing: choosing is the one decision this screen asks for,
        // and pre-selecting would quietly answer it for the user.
        selectedProfileId: get().selectedProfileId,
      });
    } catch (err) {
      set({ profilesLoading: false, profilesError: describeError(err) });
    }
  },
  selectProfile: (id) => {
    set({
      selectedProfileId: id,
      // All of these are dropped when the profile changes. A plan belongs to a
      // profile, and so does the session that ran against it: keeping either
      // would let a screen render one profile's steps next to another profile's
      // result, which is exactly the contradiction the screens exist to avoid.
      plan: null,
      session: null,
      readiness: null,
      executionError: null,
      // The selection is a set of programme ids drawn from *this* profile's plan.
      // Keeping it across a profile change would let a narrowed set silently
      // filter a plan it was never computed against — installing a subset the
      // student never chose.
      chosenSteps: null,
      bootstrapPlan: null,
      bootstrapSession: null,
      bootstrapError: null,
      canResumeBootstrap: false,
      profileCapabilities: null,
    });

    // Loaded rather than derived in the frontend: which capabilities a profile
    // aims at is a projection of the capability table, and the table is Rust's.
    void (async () => {
      try {
        const profileCapabilities = await ipc.profileCapabilities(id);
        // Guard against a slower response for a profile the student has since
        // navigated away from — the classic stale-response race.
        if (get().selectedProfileId === id) set({ profileCapabilities });
      } catch {
        // The profile screen is still usable without this; it only loses the
        // "what this buys you" line.
      }
    })();
  },

  // -------------------------------------------------------------------------
  // Plan
  // -------------------------------------------------------------------------
  plan: null,
  strategies: [],
  planLoading: false,
  planError: null,
  buildPlan: async () => {
    const profileId = get().selectedProfileId;
    if (!profileId) return;

    set({ planLoading: true, planError: null });
    try {
      const [plan, strategies] = await Promise.all([
        ipc.buildInstallPlan(profileId),
        ipc.installStrategies(profileId),
      ]);
      set({ plan, strategies, planLoading: false });
      // Readiness is fetched right after the plan so the screen can grey out an
      // impossible run before the student presses the button, rather than
      // letting them discover it one failed step at a time.
      void get().checkReadiness();
      // The bootstrap plan is built here too, not when its screen mounts. The
      // install screen shows the student what the *whole* setup will do before
      // they commit, and the configuration half of that answer comes from this
      // plan — a summary that omitted it would be answering a smaller question
      // than the one being asked.
      void get().buildBootstrapPlan();
    } catch (err) {
      set({ planLoading: false, planError: describeError(err) });
    }
  },

  buildPlanFor: async (ids) => {
    if (ids.length === 0) {
      set({ planError: "至少要选择一项才需要安装方案" });
      return;
    }
    const profileId = get().selectedProfileId ?? "";
    set({ planLoading: true, planError: null, chosenSteps: null });
    try {
      const [plan, strategies] = await Promise.all([
        ipc.buildInstallPlanFor(ids, profileId),
        ipc.installStrategiesFor(ids),
      ]);
      set({ plan, strategies, planLoading: false });
      void get().checkReadiness();
    } catch (err) {
      set({ planLoading: false, planError: describeError(err) });
    }
  },

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------
  // The engine runs in Rust and can take minutes. This store holds three pieces
  // of state rather than one, because they mean different things:
  //
  //   installing      — is work happening right now (drives the animation)
  //   session         — what has happened so far (drives the list)
  //   executionError  — did the call itself fail (drives the error strip)
  //
  // Collapsing them would make "the run is still going" and "the run failed"
  // render identically, which is the state a student is least able to
  // distinguish on their own.
  session: null,
  readiness: null,
  installing: false,
  executionError: null,
  canResume: false,
  chosenSteps: null,
  liveProgress: new Map<SoftwareId, StepProgress>(),

  setChosenSteps: (ids) => {
    set({ chosenSteps: ids === null ? null : new Set(ids) });
  },

  /**
   * Attaches the live-progress listener.
   *
   * ## Why the map is cleared here
   *
   * A new run must not inherit the previous run's rows. `liveProgress` is keyed
   * by program, so without the clear a second install of the same profile would
   * briefly show the *old* run's final statuses — a failed step would appear
   * finished before the new run had touched it. Clearing on attach (rather than
   * on submit) is safe because the screen attaches before it offers the button.
   *
   * The returned detach function is what the caller uses on unmount, so a
   * screen that is left and re-entered never accumulates duplicate listeners
   * firing two updates per event.
   */
  watchInstallProgress: async () => {
    set({ liveProgress: new Map<SoftwareId, StepProgress>() });
    return ipc.onInstallProgress((progress) => {
      // Replace, not append: the engine emits several updates per step and the
      // map's value must always be the latest known state of that program. The
      // new Map is required because zustand compares by reference — mutating
      // the existing one would not re-render.
      const next = new Map(get().liveProgress);
      next.set(progress.stepId, progress);
      set({ liveProgress: next });
    });
  },

  checkReadiness: async () => {
    const plan = get().plan;
    if (!plan) return;
    try {
      set({ readiness: await ipc.executionReadiness(plan) });
    } catch {
      // Readiness is advisory. Failing to compute it must not block the flow:
      // the engine itself re-checks and reports the real reason on failure.
      set({ readiness: null });
    }
  },

  startInstall: async () => {
    const plan = get().plan;
    if (!plan || get().installing) return;

    // Selective install (brief phase 7): the engine runs exactly the steps in
    // the plan it is handed, and `install::execute_steps` derives both its loop
    // and its `total` from `plan.steps`. So narrowing the plan *here* is the
    // whole mechanism — no Rust change, no second execution path, and the
    // session that comes back describes only what was actually requested.
    //
    // Steps the student unchecked are removed rather than marked skipped. A
    // `skipped` step would appear in the report as "已检测到，无需安装", which
    // is a different claim from "the student chose not to"; removing them keeps
    // the report honest about what was and was not attempted.
    const chosen = get().chosenSteps;
    const effective =
      chosen === null
        ? plan
        : { ...plan, steps: plan.steps.filter((s) => chosen.has(s.id)) };

    // Everything the student wanted was already installed. Starting a run with
    // no steps would produce an empty session that reads like a silent failure;
    // refreshing the scan and leaving the existing session alone is the truthful
    // outcome.
    if (effective.steps.length === 0) {
      await get().scanInstalled(plan.steps.map((s) => s.id));
      return;
    }

    set({ installing: true, executionError: null });
    try {
      const session = await ipc.runInstall(effective);
      set({
        session,
        installing: false,
        // The run just decided whether there is work left. Refreshing this here
        // rather than relying on the launch-time check is what makes the
        // "继续安装" button appear the moment a run ends incomplete; without it
        // the offer only ever shows up after a restart, which is precisely when
        // it is least useful.
        canResume: session.remaining.length > 0 && !session.cancelledByUser,
      });
      await get().scanInstalled(plan.steps.map((s) => s.id));
    } catch (err) {
      set({ installing: false, ...refusalOrError(err) });
    }
  },

  resumeInstall: async () => {
    if (get().installing) return;
    set({ installing: true, executionError: null });
    try {
      const session = await ipc.resumeInstall();
      set({
        session,
        installing: false,
        canResume: session.remaining.length > 0 && !session.cancelledByUser,
      });
      const plan = get().plan;
      if (plan) await get().scanInstalled(plan.steps.map((s) => s.id));
    } catch (err) {
      set({ installing: false, ...refusalOrError(err) });
    }
  },

  cancelInstall: async () => {
    try {
      await ipc.cancelInstall();
      // Not `installing: false` here. The engine stops at the next safe point,
      // which may be a download boundary a few hundred milliseconds away;
      // clearing the flag now would re-enable the button while a process is
      // still running and let the student start a second one.
    } catch (err) {
      set({ executionError: describeError(err) });
    }
  },

  loadResumable: async () => {
    try {
      const [session, resumable] = await Promise.all([
        ipc.lastInstallSession(),
        ipc.resumableInstall(),
      ]);
      set({ session: session ?? null, canResume: resumable !== null });
    } catch {
      // A missing session is the normal first-launch case, not an error.
    }
  },

  // -------------------------------------------------------------------------
  // Bootstrap (stage 4)
  // -------------------------------------------------------------------------
  // The same three-part split as installation, for the same reason: `bootstrapping`
  // drives the animation, `bootstrapSession` drives the list, `bootstrapError`
  // drives the error strip. Collapsing them would make "still working" and
  // "the call failed" render identically.
  bootstrapPlan: null,
  bootstrapSession: null,
  bootstrapping: false,
  bootstrapError: null,
  canResumeBootstrap: false,
  localizationTargets: [],

  buildBootstrapPlan: async () => {
    const profileId = get().selectedProfileId;
    if (!profileId) return;

    set({ planLoading: true, planError: null });
    try {
      const [bootstrapPlan, localizationTargets] = await Promise.all([
        ipc.buildBootstrapPlan(profileId),
        ipc.localizationTargets(),
      ]);
      set({ bootstrapPlan, localizationTargets, planLoading: false });
    } catch (err) {
      set({ planLoading: false, planError: describeError(err) });
    }
  },

  startBootstrap: async () => {
    const profileId = get().selectedProfileId;
    if (!profileId || get().bootstrapping) return;

    set({ bootstrapping: true, bootstrapError: null });
    try {
      const bootstrapSession = await ipc.runBootstrap(profileId);
      set({
        bootstrapSession,
        bootstrapping: false,
        canResumeBootstrap: bootstrapSession.resumable,
      });
      // The run just changed configuration, which can change what a program
      // reports about itself. Re-scanning here rather than relying on a later
      // screen doing it is what keeps the software list from showing a pre-run
      // answer beside a post-run report.
      await get().scanInstalled();
    } catch (err) {
      set({ bootstrapping: false, ...refusalOrError(err, "bootstrapError") });
    }
  },

  cancelBootstrap: async () => {
    try {
      await ipc.cancelBootstrap();
      // Deliberately not clearing `bootstrapping`: the engine stops at the next
      // safe point, so clearing the flag now would re-enable the button while
      // work is still in flight.
    } catch (err) {
      set({ bootstrapError: describeError(err) });
    }
  },

  recheckBootstrap: async () => {
    const profileId = get().selectedProfileId;
    if (!profileId) return;
    try {
      const verification = await ipc.verifyBootstrap(profileId);
      const session = get().bootstrapSession;
      // Only the verification is replaced: the session's step results describe
      // what the run did, and a re-check does not retroactively change that.
      if (session) set({ bootstrapSession: { ...session, verification } });
    } catch (err) {
      set({ bootstrapError: describeError(err) });
    }
  },

  loadBootstrapState: async () => {
    try {
      const [session, resumable] = await Promise.all([
        ipc.lastBootstrap(),
        ipc.resumableBootstrap(),
      ]);
      set({
        bootstrapSession: session ?? null,
        canResumeBootstrap: resumable !== null,
      });
    } catch {
      // No session is the normal first-launch case, not an error.
    }
  },

  // -------------------------------------------------------------------------
  // Finish
  // -------------------------------------------------------------------------
  verification: null,
  configActions: [],
  reportText: null,
  reportPath: null,
  preparing: false,
  prepareFinish: async () => {
    const { plan, environment, selectedProfileId } = get();
    if (!plan || !environment) return;
    // A hand-picked plan carries the scenario it started from, which may be
    // empty. Bailing on `!selectedProfileId` would leave the finishing screen
    // preparing forever on a route the student legitimately took.
    const profileId = selectedProfileId ?? plan.profileId;

    set({ preparing: true });
    try {
      // Verification re-scans rather than reading the session's stored
      // inventory, for the same reason the engine re-probes after each run: the
      // session's answer is a snapshot, and this screen is what the student
      // copies into a bug report. Between the two calls they can legitimately
      // differ, and the later reading is the truer one.
      const [verification, configActions] = await Promise.all([
        ipc.verifyInstallation(plan),
        ipc.plannedConfigActions(profileId),
      ]);
      set({ verification, configActions });

      const rendered = await ipc.generateReport({
        profileId,
        plan,
        environment,
        verification,
      });
      set({ reportText: rendered.text, preparing: false });
    } catch (err) {
      set({ preparing: false, notice: describeError(err) });
    }
  },
  downloadReport: async () => {
    const text = get().reportText;
    if (!text) return;
    try {
      const path = await ipc.saveReport(text);
      set({ reportPath: path });
    } catch (err) {
      set({ notice: describeError(err) });
    }
  },

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------
  status: null,
  loadStatus: async () => {
    try {
      set({ status: await ipc.runtimeStatus() });
    } catch {
      // Diagnostics are best-effort; failing to load them must not disturb the
      // flow, so this intentionally does not raise a notice.
    }
  },

  // -------------------------------------------------------------------------
  notice: null,
  dismissNotice: () => set({ notice: null }),
}));

/** Convenience selector: the currently chosen profile object, if any. */
export function selectedProfile(state: AppStore): Profile | null {
  if (!state.selectedProfileId) return null;
  return state.profiles.find((p) => p.id === state.selectedProfileId) ?? null;
}

if (typeof window !== "undefined") {
  (window as unknown as { useApp: typeof useApp }).useApp = useApp;
}
