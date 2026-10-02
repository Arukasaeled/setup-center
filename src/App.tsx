/**
 * Application shell.
 *
 * ## Two surfaces, one machine
 *
 * The app has exactly two ways of looking at the computer:
 *
 * * the **dashboard**, which is where a student lives — it answers "what is the
 *   state of my machine and what would improve it";
 * * the **wizard**, which is the *first-run* path from nothing to a working
 *   environment.
 *
 * The wizard is the older surface and still the honest way to describe a
 * multi-minute, multi-step, state-changing run. What changed in P4.5 is that it
 * is no longer the *only* surface: a student who has already set up, or who only
 * wants to look, gets the dashboard and never has to walk a flow.
 *
 * That is why `Screen` and `Section` are separate axes in the store. Collapsing
 * them into one enum would force the dashboard to be a step in a wizard, which is
 * exactly the linear model this phase exists to replace.
 *
 * ## Why the chrome is a three-column grid
 *
 * Navigation / content / detail. The right column exists because the single
 * loudest piece of feedback on the previous build was "it only shows status, not
 * meaning": every row said `Git · 已安装` and nothing said *why a student should
 * care*. A detail pane is the smallest structure that can hold an explanation
 * without either bloating every row or hiding it behind a modal.
 */

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { TitleBar } from "./components/TitleBar";
import { Notice } from "./components/ui";
import { Dashboard } from "./screens/Dashboard";
import { ActivationGate } from "./components/ActivationGate";
import { BootstrapScreen } from "./screens/Bootstrap";
import { ChooseScreen } from "./screens/Choose";
import { DetectScreen } from "./screens/Detect";
import { DoneScreen } from "./screens/Done";
import { GoalScreen } from "./screens/Goal";
import { InstallScreen } from "./screens/Install";
import { SoftwareScreen } from "./screens/Software";
import { WelcomeScreen } from "./screens/Welcome";
import { useApp, type Screen } from "./lib/store";
import { readEntryChoice } from "./lib/entry";
import { VaultSync } from "./core/vault";

/**
 * The wizard's steps.
 *
 * `goal` comes before `detect` and that order is the phase-5 change: the earlier
 * flow measured first and asked second, which meant a first-year student faced a
 * wall of results about a machine they had no way to judge. Choosing a direction
 * first gives every later screen a frame, so the same measurement reads as "2 of
 * 3 things you need" instead of four unexplained marks.
 *
 * `bootstrap` sits between 安装 and 完成 because that is what it is: after the
 * software is present, the environment gets configured. It is a separate stop
 * rather than part of 安装 because the two answer different questions — "do I have
 * this program" versus "is it set up the way I need" — and a student who sees a
 * stage fail needs to know which of the two failed.
 */
const STEPS: { id: Screen; label: string }[] = [
  { id: "welcome", label: "开始" },
  { id: "goal", label: "目标" },
  { id: "detect", label: "检测" },
  { id: "software", label: "已装软件" },
  { id: "choose", label: "方案" },
  { id: "install", label: "安装" },
  { id: "bootstrap", label: "初始化" },
  { id: "done", label: "完成" },
];

export default function App() {
  const screen = useApp((s) => s.screen);
  const notice = useApp((s) => s.notice);
  const dismissNotice = useApp((s) => s.dismissNotice);
  const loadStatus = useApp((s) => s.loadStatus);
  const loadResumable = useApp((s) => s.loadResumable);
  const dashboardOpen = useApp((s) => s.dashboardOpen);
  const theme = useApp((s) => s.theme);
  const activeStyle = useApp((s) => s.activeStyle);
  const entitlements = useApp((s) => s.entitlements);
  /**
   * Subscribed, not read via `getState()` inside the effect.
   *
   * The unreadable-licence path (rule 3) leaves `entitlements` as `null`
   * forever, so an effect keyed only on `entitlements` would never re-run when
   * the phase went `idle → loading → error`, and the gate would never open. The
   * phase is the field that actually changes there, so it has to be a
   * dependency.
   */
  const entitlementsPhase = useApp((s) => s.entitlementsPhase);
  const loadEntitlements = useApp((s) => s.loadEntitlements);
  const openDashboard = useApp((s) => s.openDashboard);

  /**
   * Whether the first-run activation gate is showing.
   *
   * Read once into state rather than derived on every render: the flag lives in
   * `localStorage` and the licence lives in the store, and the gate's whole job
   * is to be *replaced* by the app once answered. Re-deriving it would re-open
   * the gate the moment a REST call raced it.
   *
   * `null` means "not decided yet, we have not read the licence", which is why
   * the gate is not shown while the licence is still loading.
   *
   * Since 0.1.1 this starts `false`, not `null`-then-true: the gate is no longer
   * what a brand-new customer sees first. `Welcome` is. This flag now means "the
   * customer opened the licence panel", which the three documented rules can
   * only *force* open in the unreadable case.
   */
  const [gateOpen, setGateOpen] = useState<boolean>(false);

  /**
   * Whether the start-up decision has been taken.
   *
   * A ref, not the `gateOpen` state that drove this before 0.1.1. The effect
   * must run exactly once, but `gateOpen` no longer doubles as "have we
   * decided": it starts `false` (the gate is closed, which is now the normal
   * first-run state) and is legitimately set to `false` again when the customer
   * dismisses the gate. Using it as the guard would re-run the decision on every
   * render after a dismissal.
   */
  const decisionMade = useRef(false);

  /**
   * `true` when the gate was opened by rule 3 rather than by the customer.
   *
   * Rule 3 (a licence that could not be read) is the one case that still forces
   * the gate open on its own, because hiding an unreadable PRO state is exactly
   * what the rule exists to prevent. Everything else opens the gate from
   * `Welcome`, and in that case the customer can close it again.
   */
  const [forcedGate, setForcedGate] = useState(false);

  useEffect(() => {
    void loadStatus();
    // Checks for an interrupted run left by a previous launch. This is what
    // makes "可恢复" survive a crash: the session lives in the Rust state, so a
    // student whose machine rebooted mid-install is offered "继续安装" rather
    // than having to work out which programs landed.
    void loadResumable();
    if (useApp.getState().entitlementsPhase === "idle") void loadEntitlements();
    VaultSync.hydrateFromCache();
    void VaultSync.sync();
  }, [loadStatus, loadResumable, loadEntitlements]);

  /**
   * Whether the gate may be closed without answering.
   *
   * It may when there is a real surface to go back to — the unreadable case
   * (rule 3) can force the gate open on a cold start where `Welcome` is behind
   * it and nothing else is. Distinguishing the two is what keeps rule 3 honest
   * without trapping a customer who merely wanted to look.
   */
  const canDismissGate = !forcedGate;

  // Decide the entry surface once the licence question has an answer.
  //
  // ## 0.1.3 — the app no longer auto-advances past Welcome
  //
  // Every launch now lands on `Welcome` (图1) and stays there until the customer
  // picks something. Nothing about a persisted fact — an active licence, a
  // recorded "free" answer — is allowed to skip that screen on its own.
  //
  // Why this changed. The 0.1.1 rule was "licence or answered flag → dashboard",
  // which is correct for a *returning* customer but indistinguishable from a
  // relaunch that the customer never chose. The visible defect: a customer who
  // had answered the gate once (or held a licence) opened the app, saw 图1 for a
  // frame, and was thrown onto the dashboard — a navigation they never asked for
  // and, worse, one that fired while 图1's entries were still on screen waiting to
  // be read. It read as a bug because it was one: the screen whose entire job is
  // to ask "what do you want to do?" was answering on the customer's behalf.
  //
  // What is UNCHANGED:
  //   * Rule 3: a licence read *error* is still not treated as "no licence". For
  //     a customer who has not already answered, that is the one case where the
  //     gate is still forced open on its own, because leaving them on Welcome
  //     with an unreadable licence would hide the fact that their PRO state could
  //     not be read — and asking a paying customer to activate again is the exact
  //     outcome the rule exists to prevent. The gate renders its "unreadable"
  //     state with a retry.
  //   * Rules 1 and 2 still hold — they are now enforced by the *gate never
  //     opening*, rather than by jumping to the dashboard. An active licence and
  //     an already-answered customer are simply never shown the gate; they see
  //     Welcome like everyone else and leave it by choosing.
  //
  // The licence is still read here, so the gate decision does not have to wait
  // for a click — Welcome's third entry renders its PRO state from the store the
  // moment the answer lands.
  useEffect(() => {
    if (decisionMade.current) return;

    const answered = readEntryChoice() !== null;
    if (entitlements) {
      decisionMade.current = true;
      // Rules 1 and 2 both mean "do not ask". There is deliberately no
      // navigation here: the customer stays on Welcome.
    } else if (entitlementsPhase === "error") {
      decisionMade.current = true;
      if (!answered) {
        // Rule 3: the licence could not be read, so the gate shows — but only
        // for a customer who has not already answered. It renders the
        // "unreadable" panel rather than pretending there is no licence.
        setForcedGate(true);
        setGateOpen(true);
      }
      // Already answered → rule 2 wins over the unreadable state: do not re-ask.
      // No navigation either way; Welcome is the surface.
    }
  }, [entitlements, entitlementsPhase]);

  // Theme lives on `<html>` rather than in a React context because the webview
  // paints its own background before React mounts, and `tauri.conf.json` sets
  // that to the dark base colour. Setting it here means the first frame is
  // already correct for the chosen theme.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
      const query = window.matchMedia("(prefers-color-scheme: light)");
      const apply = () =>
        root.setAttribute("data-theme", query.matches ? "light" : "dark");
      apply();
      query.addEventListener("change", apply);
      return () => query.removeEventListener("change", apply);
    }
    root.setAttribute("data-theme", theme);
    return undefined;
  }, [theme]);

  // Visual style language attribute (e.g. p5-comic, default, etc.)
  useEffect(() => {
    document.documentElement.setAttribute("data-style", activeStyle);
  }, [activeStyle]);

  return (
    <div className="app-field relative flex h-full flex-col overflow-hidden">
      <TitleBar />

      <main className="relative flex-1 overflow-hidden">
        {gateOpen ? (
          // The gate is a *panel over* whatever surface was showing, not a
          // replacement for the whole app. Since 0.1.1 it is opened from
          // `Welcome` (the "已有激活码" entry) rather than being the cold-start
          // screen, so `onDismiss` closes it back onto that surface. On the one
          // path where it is still forced open — an unreadable licence with no
          // recorded answer (rule 3) — there is no surface worth revealing and
          // no dismiss is offered, so the customer must answer it either way.
          <ActivationGate
            onDone={() => {
              setGateOpen(false);
              // Answering the gate lands on the dashboard rather than the
              // wizard: the dashboard is the surface a student returns to, and
              // the wizard is the first-run path. A customer who opened the gate
              // from Welcome and chose FREE has made their first-run decision,
              // so the dashboard is where that decision puts them.
              openDashboard();
            }}
            onDismiss={canDismissGate ? () => setGateOpen(false) : undefined}
          />
        ) : dashboardOpen ? (
          // No `key` here on purpose: the dashboard keeps its scroll position and
          // selection while a student moves between sections, which is the whole
          // difference between a surface and a flow.
          <Dashboard />
        ) : (
          // Each wizard screen *is* keyed so React remounts it, restarting the
          // entrance animation and guaranteeing no stale local state leaks across
          // a navigation.
          <div key={screen} className="fade h-full">
            {/* `onOpenLicense` opens the gate as a *panel over* this surface,
                not as a `goTo`. Putting the gate in `navStack` would give it a
                history entry and let a back button "return" to a decision, which
                is exactly what it must not do. `App` owns the flag; `Welcome`
                just asks for it. */}
            {screen === "welcome" && (
              <WelcomeScreen onOpenLicense={() => setGateOpen(true)} />
            )}
            {screen === "goal" && <GoalScreen />}
            {screen === "detect" && <DetectScreen />}
            {screen === "software" && <SoftwareScreen />}
            {screen === "choose" && <ChooseScreen />}
            {screen === "install" && <InstallScreen />}
            {screen === "bootstrap" && <BootstrapScreen />}
            {screen === "done" && <DoneScreen />}
          </div>
        )}
      </main>

      {/* The rail belongs to the wizard only. Showing it beside the dashboard
          would claim the student is on a step, which is the linear framing the
          dashboard exists to replace. Suppressed while the gate is up, since the
          gate is a decision rather than a step. */}
      {!gateOpen && !dashboardOpen && screen !== "welcome" && (
        <ProgressRail current={screen} />
      )}

      {notice && <Notice message={notice} onDismiss={dismissNotice} />}
    </div>
  );
}

function ProgressRail({ current }: { current: Screen }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);

  return (
    <nav
      aria-label="进度"
      className="flex h-11 shrink-0 items-center justify-center gap-1 px-10"
    >
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <div key={step.id} className="flex items-center">
            {i > 0 && (
              <span
                className={clsx(
                  "mx-2 h-px w-6 transition-colors duration-300",
                  done ? "bg-accent-dim" : "bg-ink-800",
                )}
              />
            )}
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "h-1.5 w-1.5 rounded-full transition-colors duration-300",
                  active
                    ? "bg-accent"
                    : done
                      ? "bg-accent-dim"
                      : "bg-ink-700",
                )}
              />
              <span
                className={clsx(
                  "text-[11.5px] transition-colors duration-300",
                  active
                    ? "text-ink-200"
                    : done
                      ? "text-ink-400"
                      : "text-ink-600",
                )}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
