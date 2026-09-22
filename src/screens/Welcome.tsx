/**
 * Screen 1 — Welcome, and the first thing a new customer sees.
 *
 * ## Why the order of the app changed, and why this screen is where the fix lands
 *
 * In 0.1.0 a cold start rendered the **activation gate**. Its headline was
 * `解锁 Setup Center PRO`, so the first sentence a first-year student read was a
 * licensing question — asked before they had any idea what the product was or
 * whether they wanted it. Choosing FREE then skipped onboarding entirely and
 * dropped them on the Dashboard, so the guided path never ran at all.
 *
 * 0.1.1 inverts that. `App.tsx` now renders **this screen** on a cold start for
 * anyone with neither a licence nor a recorded answer, and the gate is reached
 * *from* here by the customer who already has a code. The licensing question is
 * still asked — it just no longer gets asked first.
 *
 * ## Three entries, and why exactly three
 *
 * The brief names them, and the order is the order of how much a beginner knows:
 *
 * | # | entry | the student's question |
 * |---|---|---|
 * | ① | 检查电脑环境 | "what have I already got?" |
 * | ② | 一键配置 AI 编程环境 | "just set it up for me" |
 * | ③ | 已有激活码？ | "I paid, where do I put the code?" |
 *
 * ① costs nothing and changes nothing, so it is the primary action: a student
 * running an unknown `.exe` wants to look before they commit, and the smaller
 * commitment belongs first. ② is the real product but it writes to the machine.
 * ③ is deliberately a *third* entry rather than a buried link — the audit found
 * the upgrade path was technically present and practically invisible, and a
 * customer holding an activation code is the one person who must not have to
 * hunt for it.
 *
 * ## The FREE/PRO block
 *
 * Rendered verbatim from the brief, because a tier comparison is the one place
 * where inventing better wording would mean inventing different promises. It also
 * does the work the old gate used to do — telling the customer what they get —
 * without making them answer anything first.
 *
 * ## What was kept, and must not be dropped
 *
 * The safety copy ("检查不会安装任何软件，也不会修改系统设置"). It is not boilerplate:
 * it answers the actual first-run fear about running an unknown executable, and
 * removing it to save four lines would be a regression. Same for the three-entry
 * structure's promise that checking is free.
 */

import { useState } from "react";
import { Button } from "../components/ui";
import { ActivationCard } from "../components/ActivationPanel";
import { useApp } from "../lib/store";
import { isTauri } from "../lib/ipc";

export function WelcomeScreen({
  /**
   * Opens the activation gate.
   *
   * **Optional on purpose.** The gate lives in `App.tsx` and is a *panel over*
   * this surface rather than a `Screen`, so it is not in `navStack` and cannot be
   * navigated to. The host therefore hands down a callback instead of a route.
   *
   * Declared optional so this screen keeps rendering standalone — without a host
   * the third entry opens an in-page `ActivationCard` instead, which is the same
   * activation form in a different frame. Neither path ever leaves the student on
   * a dead button.
   */
  onOpenLicense,
}: {
  onOpenLicense?: () => void;
} = {}) {
  const goTo = useApp((s) => s.goTo);
  const runDetection = useApp((s) => s.runDetection);
  const loadProfiles = useApp((s) => s.loadProfiles);
  const scanInstalled = useApp((s) => s.scanInstalled);
  const openDashboard = useApp((s) => s.openDashboard);
  const entitlements = useApp((s) => s.entitlements);

  /**
   * ① Reads the machine and shows the overview. Changes nothing.
   *
   * All three calls are independent — a network probe, a registry/PATH/winget
   * scan, and reading local profile files — so firing them together makes the
   * wait the slowest one rather than their sum, and a failure in any single one
   * does not blank the others.
   */
  const check = () => {
    openDashboard();
    void loadProfiles();
    void runDetection();
    void scanInstalled();
  };

  /**
   * ② Enters the guided flow, which is where installing actually happens.
   *
   * It goes to the goal screen, not to detection: detection still runs, but it
   * runs *after* the student has said what they are aiming at, so its results are
   * framed by that goal instead of arriving as an unexplained wall of marks.
   *
   * This does **not** install anything by itself. Installation is gated behind
   * an explicit choice of profile and then an explicit start, and on the FREE
   * tier the store's own refusal is surfaced rather than pre-empted here.
   */
  const configure = () => {
    goTo("goal");
    void loadProfiles();
  };

  // PRO customers get a different third entry: the thing that would otherwise
  // sit there asking them to buy something they already own. The PRO/FREE choice
  // is derived here rather than delegated, because `UpgradePrompt` legitimately
  // renders nothing while the licence is unread — and an entry the brief requires
  // to be visible must never be empty. See `ThirdEntryAction`.
  const isPro = entitlements?.state === "active";

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-10 py-10">
      <div className="flex w-full max-w-[460px] flex-col">
        <header className="rise">
          <h1
            data-testid="welcome-heading"
            className="text-[color:var(--text-strong)] text-[22px] leading-snug font-semibold tracking-[-0.02em]"
          >
            Setup Center
          </h1>
          <p className="text-[color:var(--text-secondary)] mt-1.5 text-[13.5px] leading-relaxed">
            帮你快速配置 AI 编程环境
          </p>
        </header>

        {/* The three entries, numbered so the screen reads as a short menu rather
            than as three competing buttons. The numbers are the brief's own
            ordering and they carry real information here: a beginner genuinely
            does not know that checking is the cheaper first move. */}
        <div className="rise rise-1 mt-7 flex flex-col gap-2.5">
          <Entry
            index="①"
            title="检查电脑环境"
            detail="检测你的电脑是否已经安装必要工具"
            onClick={check}
          />
          <Entry
            index="②"
            title="一键配置 AI 编程环境"
            detail="自动安装和配置推荐工具"
            onClick={configure}
          />
          <Entry
            index="③"
            title="已有激活码？"
            detail="输入激活码升级 PRO"
            // Deliberately NO `onClick` here. This entry carries its own control
            // (`ThirdEntryAction`), so it must be a container rather than a
            // button — a button nested inside a button is invalid HTML and makes
            // one press run both handlers. `ThirdEntryAction` owns the click.
            action={<ThirdEntryAction onOpenLicense={onOpenLicense} isPro={isPro} />}
          />
        </div>

        {/* The tier, stated plainly. This is the block the brief specifies word
            for word; see the file header for why it is not paraphrased. */}
        <section
          data-testid="welcome-tiers"
          className="rise rise-2 glass-soft mt-6 rounded-[12px] p-4"
        >
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[color:var(--text-primary)] text-[13px] font-medium">
                免费版
              </div>
              <div className="text-[color:var(--text-tertiary)] mt-1 text-[12.5px]">
                你可以：
              </div>
              <ul className="mt-1 flex flex-col gap-0.5">
                <TierLine>查看推荐工具</TierLine>
                <TierLine>检测电脑环境</TierLine>
              </ul>
            </div>

            <div className="border-[color:var(--line-subtle)] border-t pt-3">
              <div className="text-[color:var(--text-primary)] text-[13px] font-medium">
                PRO 解锁：
              </div>
              <ul className="mt-1 flex flex-col gap-0.5">
                <TierLine>一键安装</TierLine>
                <TierLine>自动配置</TierLine>
                <TierLine>批量部署</TierLine>
              </ul>
            </div>
          </div>
        </section>

        {/* The safety copy. Kept because it answers the real first-run fear about
            running an unknown .exe — losing it would be a regression, not a
            simplification. */}
        <p className="rise rise-3 text-[color:var(--text-quiet)] mt-4 text-[12px] leading-relaxed">
          检查不会安装任何软件，也不会修改系统设置。所有安装与配置都可撤销，
          并在动手前逐一列出会改什么。
        </p>
      </div>

      {!isTauri() && <BrowserPreviewNotice />}
    </div>
  );
}

/**
 * One numbered entry.
 *
 * ## Why an entry with its own control is a layout, not a button
 *
 * The first version made every entry a whole-row `<button>` and put the third
 * entry's 输入激活码 `<Button>` *inside* it. That is invalid HTML — a button cannot
 * contain a button — and React reports it as a hydration error at run time. It is
 * also a real interaction bug rather than a technicality: clicking 输入激活码 would
 * fire the inner handler *and* bubble to the outer one, so the entry ran two
 * actions in one press.
 *
 * So the rule is structural: a row that owns its own click is a `<button>`, and a
 * row whose action is carried by a nested control is a `<div>` holding that
 * control. `onClick` being present or absent is what selects between them, which
 * means the invalid nesting cannot be reintroduced by accident at a call site.
 *
 * `text-left` because a centred multi-line label reads as a banner rather than as
 * a choice.
 */
function Entry({
  index,
  title,
  detail,
  onClick,
  action,
}: {
  index: string;
  title: string;
  detail: string;
  /** `undefined` when a nested action owns the click instead. */
  onClick?: () => void;
  /** Rendered on the right, for the entry that has its own affordance. */
  action?: React.ReactNode;
}) {
  const inner = (
    <>
      <span
        aria-hidden
        className="text-[color:var(--text-quiet)] w-4 shrink-0 text-[13px] leading-6"
      >
        {index}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-[color:var(--text-primary)] block text-[13.5px] font-medium">
          {title}
        </span>
        <span className="text-[color:var(--text-tertiary)] mt-0.5 block text-[12px] leading-relaxed">
          {detail}
        </span>
      </span>
    </>
  );

  const shell =
    "border-[color:var(--line-subtle)] hover:border-[color:var(--line-default)] " +
    "hover:bg-[color:var(--surface-hover)] flex w-full items-start gap-3 " +
    "rounded-[10px] border px-3.5 py-3 transition-colors duration-150 text-left";

  // No click of its own → a plain container. The nested action is the target.
  if (!onClick) {
    return (
      <div data-testid="welcome-entry" data-entry={index} className={shell}>
        {inner}
        {action}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="welcome-entry"
      data-entry={index}
      onClick={onClick}
      className={shell}
    >
      {inner}
      {action}
    </button>
  );
}

/**
 * The third entry's own control.
 *
 * Two cases, and the difference is the whole point of keeping this entry visible:
 *
 * * With a host (`onOpenLicense` present) → a button that opens the gate. This is
 *   the path that makes the upgrade reachable *from the very first screen*.
 * * Without one (this screen rendered standalone) → an in-page disclosure holding
 *   the same `ActivationCard`. The entry still does something; it never renders a
 *   dead button.
 *
 * On a PRO machine neither is shown — the row states the fact instead. Asking a
 * paying customer to upgrade is worse than saying nothing.
 *
 * ## Why the un-hosted branch is not just `<UpgradePrompt />`
 *
 * It was, and that was a real bug this probe caught: `UpgradePrompt` returns
 * `null` while the licence is still unread *and* when it is unreadable (see its
 * own contract — "flashing an upgrade button at a paying customer is worse").
 * Correct for that component, but it meant the entry rendered **nothing at all**
 * in a standalone render, because nothing on this screen loads entitlements — so
 * the ③ row was a dead entry with no affordance in it.
 *
 * An entry the brief says must not be hidden cannot depend on a component that
 * legitimately chooses to be invisible. So the un-hosted branch owns a local
 * disclosure and renders the card on demand; `UpgradePrompt` is kept for the
 * *readable* case, where its PRO/FREE handling is genuinely better than a bare
 * button. The outer control is rendered unconditionally, which is what makes the
 * entry impossible to be empty.
 */
function ThirdEntryAction({
  onOpenLicense,
  isPro,
}: {
  onOpenLicense?: () => void;
  isPro: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (isPro) {
    return (
      <span
        data-testid="welcome-pro-active"
        className="text-[color:var(--status-ok)] mt-0.5 shrink-0 text-[12px]"
      >
        ✓ 已激活
      </span>
    );
  }

  if (onOpenLicense) {
    return (
      <Button
        size="sm"
        variant="ghost"
        data-testid="welcome-activate"
        onClick={onOpenLicense}
        className="mt-0.5 shrink-0"
      >
        输入激活码
      </Button>
    );
  }

  return (
    <span className="mt-0.5 flex shrink-0 flex-col items-end">
      <Button
        size="sm"
        variant="ghost"
        data-testid="welcome-activate"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="shrink-0"
      >
        {open ? "收起" : "输入激活码"}
      </Button>
      {open && (
        <div data-testid="welcome-activation-inline" className="mt-3 w-full text-left">
          <ActivationCard autoFocus />
        </div>
      )}
    </span>
  );
}

/** One ✓ line of the tier block. */
function TierLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className="text-[color:var(--status-ok)] shrink-0 text-[11.5px]" aria-hidden>
        ✓
      </span>
      <span className="text-[color:var(--text-secondary)] text-[12.5px]">{children}</span>
    </li>
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
