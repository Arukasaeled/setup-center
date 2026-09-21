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

import { useEffect, useState } from "react";
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
  const entitlements = useApp((s) => s.entitlements);
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
   */
  const [gateOpen, setGateOpen] = useState<boolean | null>(null);

  useEffect(() => {
    void loadStatus();
    // Checks for an interrupted run left by a previous launch. This is what
    // makes "可恢复" survive a crash: the session lives in the Rust state, so a
    // student whose machine rebooted mid-install is offered "继续安装" rather
    // than having to work out which programs landed.
    void loadResumable();
    if (useApp.getState().entitlementsPhase === "idle") void loadEntitlements();
  }, [loadStatus, loadResumable, loadEntitlements]);

  // Decide the gate once the licence question has an answer.
  //
  // The order here is the whole rule: a licence beats the flag. Someone who
  // chose FREE months ago and has since activated a key is PRO, and must not be
  // sent back to the gate by a stale flag.
  //
  // A returning customer — licence or answered flag — goes to the *dashboard*,
  // not the wizard. The wizard is the first-run path from nothing to a working
  // environment; someone who already answered the gate has either walked it or
  // declined to, and re-offering it would make the gate look like it did not
  // take. "重新规划" on the dashboard is how they re-enter the wizard on purpose.
  useEffect(() => {
    if (gateOpen !== null) return;
    const answered = readEntryChoice() !== null;
    if (entitlements) {
      const active = entitlements.state === "active";
      setGateOpen(!active && !answered);
      if (active || answered) openDashboard();
    } else if (useApp.getState().entitlementsPhase === "error") {
      // The licence could not be read. The gate shows, but the gate itself
      // renders the "unreadable" state rather than pretending there is no
      // licence — asking a paying customer to activate again on a read error is
      // the one outcome worth avoiding.
      setGateOpen(!answered);
      if (answered) openDashboard();
    }
  }, [gateOpen, entitlements, openDashboard]);

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

  return (
    <div className="app-field relative flex h-full flex-col overflow-hidden">
      <TitleBar />

      <main className="relative flex-1 overflow-hidden">
        {gateOpen === true ? (
          // The gate replaces both surfaces, not just the wizard. A customer who
          // reaches a working machine through the wizard still has to answer the
          // licence question, and answering it twice in two different places is
          // how the two answers drift apart.
          <ActivationGate
            onDone={() => {
              setGateOpen(false);
              // Choosing FREE lands on the dashboard rather than the wizard: the
              // dashboard is the surface a student returns to, and the wizard is
              // the first-run path they have just declined to walk.
              openDashboard();
            }}
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
            {screen === "welcome" && <WelcomeScreen />}
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
      {gateOpen !== true && !dashboardOpen && screen !== "welcome" && (
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
