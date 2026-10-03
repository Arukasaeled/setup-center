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
import { BootstrapScreen } from "./screens/Bootstrap";
import { ChooseScreen } from "./screens/Choose";
import { DetectScreen } from "./screens/Detect";
import { DoneScreen } from "./screens/Done";
import { GoalScreen } from "./screens/Goal";
import { InstallScreen } from "./screens/Install";
import { SoftwareScreen } from "./screens/Software";
import { WelcomeScreen } from "./screens/Welcome";
import { useApp, type Screen } from "./lib/store";
import {
  applyExperience,
  hydrateCustomExperiences,
  purgeLegacyTweakerStorage,
} from "./styles/runtime";
import { getStyle, STYLE_REGISTRY } from "./styles/registry";
import { VaultSync } from "./core/vault";
import { ReleaseManagerInstance } from "./core/vault/release";
import { CommandPalette } from "./components/CommandPalette";

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
  const styleOverrides = useApp((s) => s.styleOverrides);
  const loadEntitlements = useApp((s) => s.loadEntitlements);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    const handleCustomOpen = () => setCommandPaletteOpen(true);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("setup:open-palette", handleCustomOpen);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("setup:open-palette", handleCustomOpen);
    };
  }, []);

  useEffect(() => {
    // Register any derived experiences the user saved, and delete the v1 tweaker
    // keys on the way. The old per-style storage held a bare `shadowDepth`
    // ("6px") that cannot be mapped onto the new shadow model (offset + blur +
    // spread + colour), so it is removed rather than guessed at — guessing is
    // what produced the original "the slider does nothing" bug.
    purgeLegacyTweakerStorage();
    hydrateCustomExperiences();
    useApp.getState().refreshCustomExperiences();
  }, []);

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
    void ReleaseManagerInstance.hydrateRuntimeVersion();
  }, [loadStatus, loadResumable, loadEntitlements]);



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

  // The active experience, applied as CSS custom properties plus the grammar
  // data attributes that the shell reads (see `styles/runtime.ts`).
  //
  // This replaced a bare `setAttribute("data-style", activeStyle)`. The attribute
  // alone could only select which stylesheet won; it could not carry a user's
  // token overrides, which is exactly why tuning a token appeared to do nothing.
  // The runtime writes every variable inline with `!important`, so an override
  // outranks the per-style `!important` rules rather than competing with them.
  //
  // `styleOverrides` is a dependency because overrides are part of the active
  // experience, not a separate concern: switching experience and reloading that
  // experience's own overrides must land in the same paint.
  useEffect(() => {
    const style = getStyle(activeStyle) ?? getStyle("phantom-comic") ?? STYLE_REGISTRY[0];
    applyExperience(style, styleOverrides);
  }, [activeStyle, styleOverrides]);

  return (
    <div className="app-field relative flex h-full flex-col overflow-hidden">
      <TitleBar />

      <main className="relative flex-1 overflow-hidden">
        {dashboardOpen ? (
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
          dashboard exists to replace. */}
      {!dashboardOpen && screen !== "welcome" && (
        <ProgressRail current={screen} />
      )}

      {notice && <Notice message={notice} onDismiss={dismissNotice} />}

      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
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
