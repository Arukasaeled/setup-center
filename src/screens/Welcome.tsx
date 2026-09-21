/**
 * Screen 1 — Welcome.
 *
 * ## What the branding overhaul changed here
 *
 * This screen used to be the loudest example of the problem the overhaul exists
 * to fix: a 34px hero reading "让你的电脑拥有 AI 能力", a breathing star mark with a
 * blurred halo behind it, a `ParticleField` of drifting dots, and 420ms
 * entrances cascading across five elements. Every one of those was an "AI
 * product" signal, and together they made a utility that installs Git and Node
 * look like a landing page for a model.
 *
 * What replaced them:
 *
 * * The headline states the **job**, at a normal heading size (20px). "配置这台
 *   电脑" is what the app does; "拥有 AI 能力" is a claim about the user.
 * * The decoration is gone. There is no halo, no star, no particle field. The
 *   only visual weight is the primary button, which is where the eye should go.
 * * The product name appears once, in the title bar, not three times on the
 *   first screen.
 *
 * ## Two doors, unchanged
 *
 * The structure is deliberately kept from P4.5: the primary action reads the
 * machine and shows the overview without changing anything, and the secondary
 * one enters the guided flow. A first-year student running an unknown .exe has
 * one question — "will this mess up my computer" — and answering it before it
 * is asked is worth more than any amount of polish.
 */

import { Button } from "../components/ui";
import { UpgradePrompt } from "../components/ActivationPanel";
import { useApp } from "../lib/store";
import { isTauri } from "../lib/ipc";

export function WelcomeScreen() {
  const goTo = useApp((s) => s.goTo);
  const runDetection = useApp((s) => s.runDetection);
  const loadProfiles = useApp((s) => s.loadProfiles);
  const scanInstalled = useApp((s) => s.scanInstalled);
  const openDashboard = useApp((s) => s.openDashboard);

  /** Reads the machine and shows the overview. Nothing is changed. */
  const explore = () => {
    openDashboard();
    // All three are independent — a network probe, a registry/PATH/winget scan,
    // and reading local profile files — so firing them together makes the wait
    // the slowest one rather than their sum, and a failure in any single one does
    // not blank the others.
    void loadProfiles();
    void runDetection();
    void scanInstalled();
  };

  /** Enters the guided flow. The student has chosen to change the machine. */
  const begin = () => {
    // The goal screen, not detection. Detection still runs, but it runs *after*
    // the student has said what they are aiming at, so its results can be framed
    // by that goal instead of arriving as an unexplained wall of marks.
    goTo("goal");
    void loadProfiles();
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-10">
      <div className="flex w-full max-w-[440px] flex-col">
        <h1 className="text-[color:var(--text-strong)] text-[20px] leading-snug font-semibold tracking-[-0.015em]">
          配置这台电脑
        </h1>

        <p className="text-[color:var(--text-secondary)] mt-2 text-[13.5px] leading-relaxed">
          安装并配置常用的开发与 AI
          工具。可以先只做检查，看看这台电脑现在有什么、还差什么。
        </p>

        {/* The two doors. The primary is "look, change nothing" rather than
            "start installing", because that is the smaller commitment and the
            one a cautious user actually wants first. */}
        <div className="mt-7 flex flex-col gap-2">
          <Button onClick={explore} className="w-full justify-center">
            检查这台电脑
          </Button>
          <Button variant="ghost" onClick={begin} className="w-full justify-center">
            直接开始配置
          </Button>
        </div>

        <p className="text-[color:var(--text-quiet)] mt-4 text-[12px] leading-relaxed">
          检查不会安装任何软件，也不会修改系统设置。所有安装与配置都可撤销，
          并在动手前逐一列出会改什么。
        </p>

        {/* The activation entry, on the first-run screen as well as the
            dashboard.

            It has to be on both: a returning customer lands here ("回到首次设置"
            and the app's cold start both reach this screen), while a customer
            mid-wizard reaches the dashboard's bar. Putting it only on the
            dashboard would leave this screen — the one a FREE customer actually
            sees first — with no way to upgrade, which is how the entry ended up
            effectively hidden in the first place.

            Below the two doors and visually quiet, so it does not compete with
            "检查这台电脑": activating is something a customer arrives already
            wanting, and a third equally-weighted button here would make the
            screen ask three questions at once. */}
        <div className="mt-5 border-t border-[color:var(--line-subtle)] pt-4">
          <UpgradePrompt align="start" className="items-start" />
        </div>
      </div>

      {!isTauri() && <BrowserPreviewNotice />}
    </div>
  );
}

/**
 * When the vite dev server is opened in a plain browser there is no Rust
 * backend, so every command fails. Saying so explicitly avoids a confusing
 * "检测失败" that looks like a product bug.
 */
function BrowserPreviewNotice() {
  return (
    <div className="glass-soft text-[color:var(--text-tertiary)] absolute bottom-6 rounded-[10px] px-3.5 py-2 text-[12px]">
      当前在浏览器中预览，无法调用系统能力。请用{" "}
      <code className="text-[color:var(--text-primary)]">npm run tauri:dev</code>{" "}
      启动桌面应用。
    </div>
  );
}
