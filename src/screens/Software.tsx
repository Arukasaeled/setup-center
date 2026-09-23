/**
 * Screen 3 — Software.
 *
 * ## The question this screen answers changed
 *
 * It used to answer "这台电脑已经有什么？" — a status report. The 0.1.1 brief asks a
 * sharper question, and it is the one a beginner actually has:
 *
 *   **"can I install this, and if not, why not?"**
 *
 * A row that only says 未安装 answers the first half and leaves the student to
 * guess the rest. They cannot tell "you are on FREE and this needs PRO" from
 * "this tool does not install this program at all" from "this failed last time" —
 * and those three need three different actions from them.
 *
 * So each row now carries five things, in the brief's order:
 *
 * | slot | what | where it comes from |
 * |---|---|---|
 * | 官方图标 | the vendor's own mark | `SoftwareIcon` |
 * | 名称 | VS Code, not `vscode` | `catalogue` (Rust) |
 * | 用途 | why a student would want it | `catalogue.purpose` (Rust) |
 * | 安装方式 | *how* it would be put on this machine | `install_strategies` (Rust) |
 * | 状态 | installed / not / could not check / failed | `inventory` + session |
 *
 * 安装方式 is the new one and it is not decoration. "winget install --id Git.Git"
 * and "官方安装包 https://…" are materially different promises — one needs the
 * package manager, the other downloads from the vendor and may need a click — and
 * a student who is deciding whether to trust this app is owed the difference
 * before they press the button, not after.
 *
 * ## Still a LIST
 *
 * The brief keeps the list ("不要大量卡片"), and it is right: a list is what you
 * scan down, and scanning is how you answer "what is missing" in one pass. The
 * grid experiment is over — see `SoftwareRow`'s note on why. This file therefore
 * renders rows, grouped by measured state, with the evidence folded away beneath
 * each one.
 *
 * ## The action button is never hidden
 *
 * `ActionButton` below renders in **every** state. FREE gets 查看方案 rather than
 * nothing, because a hidden button is indistinguishable from a broken one, and
 * because "you cannot do this yet, here is why and here is the way" is a better
 * answer than silence. That rule is what the FREE panel exists for.
 *
 * ## What is NOT here
 *
 * No second execution path. The button navigates (`选中方案 → 安装`); the actual
 * install machinery belongs to `Install.tsx` and the store, exactly as
 * `DESIGN.md` §A5 requires. This screen decides *what to show*, never *what to do*.
 */

import { useEffect, useState } from "react";
import clsx from "clsx";
import { BackButton } from "../components/BackButton";
import { Button, SectionLabel, StatusMark } from "../components/ui";
import { SoftwareIcon } from "../components/SoftwareIcon";
import { describeSoftware, needsNode } from "../lib/software";
import { useApp } from "../lib/store";
import type {
  Confidence,
  EvidenceView,
  InstallStrategy,
  ProbeSource,
  SoftwareDescriptor,
  SoftwareId,
  SoftwareInfo,
} from "../lib/types";

/**
 * Why a row is offering the action it is offering.
 *
 * Derived from *measured state* plus the *real entitlements*, never from a
 * hard-coded tier or from a running total kept in this file. That is the whole
 * contract: if the store says the licence is inactive, every row says 查看方案;
 * the moment it becomes active, every row says 安装 without a reload.
 *
 * The precedence order below is the interesting part, and it is deliberate:
 *
 * 1. `installed` beats everything. Something already on the machine that reports
 *    a version is done, whatever the licence says — offering 安装 for a program
 *    that is present is how you make a student reinstall something working.
 * 2. `installing` beats `failed`, because during a run the row must read as busy
 *    rather than as "the last attempt failed", which are true at different times
 *    and would contradict the run's own progress view.
 * 3. `failed` beats the licence question: a student on PRO who hit a failure
 *    needs 重试, and hiding it behind an upgrade prompt would be absurd.
 * 4. Only then does the tier decide between 查看方案 and 安装.
 */
type RowAction =
  | { kind: "installed" }
  | { kind: "installing" }
  | { kind: "retry" }
  | { kind: "install"; label: string }
  | { kind: "needs-licence" };

export function SoftwareScreen() {
  const inventory = useApp((s) => s.inventory);
  const catalogue = useApp((s) => s.catalogue);
  const phase = useApp((s) => s.inventoryPhase);
  const error = useApp((s) => s.inventoryError);
  const scanInstalled = useApp((s) => s.scanInstalled);
  const goTo = useApp((s) => s.goTo);

  // The *real* entitlement object, not a boolean cached here. Every row reads
  // this same value, so two rows can never disagree about the tier.
  const entitlements = useApp((s) => s.entitlements);
  const entitlementsPhase = useApp((s) => s.entitlementsPhase);
  const loadEntitlements = useApp((s) => s.loadEntitlements);
  const session = useApp((s) => s.session);
  const installing = useApp((s) => s.installing);

  const strategies = useApp((s) => s.strategies);
  const profiles = useApp((s) => s.profiles);
  const loadProfiles = useApp((s) => s.loadProfiles);
  const buildPlan = useApp((s) => s.buildPlan);

  useEffect(() => {
    // Only scan when there is nothing to show. A remount after a back/forward
    // must not re-read the whole registry.
    if (!inventory && phase === "idle") void scanInstalled();
  }, [inventory, phase, scanInstalled]);

  useEffect(() => {
    if (entitlementsPhase === "idle") void loadEntitlements();
  }, [entitlementsPhase, loadEntitlements]);

  // The install strategies are per profile, and this screen can be reached with
  // no profile chosen (straight from 检查). Loading the list is enough to name
  // the *method*; which profile supplies it only changes the rationale text.
  useEffect(() => {
    if (profiles.length === 0) void loadProfiles();
  }, [profiles.length, loadProfiles]);

  const items = inventory?.items ?? [];
  const installed = items.filter((i) => i.installed);
  const unknown = items.filter((i) => !i.installed && i.confidence === "unknown");
  const missing = items.filter((i) => !i.installed && i.confidence !== "unknown");

  const scanning = phase === "scanning" || phase === "idle";

  // The licence is *unreadable* rather than absent. This is not the same as FREE
  // — see the `ActivationGate` note — so it must not be presented as "you need
  // PRO", which would tell a paying customer to buy again. Rows stay actionable
  // and the banner says what actually happened.
  const licenceUnreadable = !entitlements && entitlementsPhase === "error";

  // `canInstall` is Rust's answer, not ours. `freeUnenforced` builds report
  // `true` with `tier: "free"`, and that build really can install — deriving
  // "FREE therefore locked" here would contradict `entitlements.reason` and put
  // a 查看方案 button in front of a working install button.
  const canInstall = entitlements?.canInstall ?? false;
  // `null` while the licence is still being read: we do not yet know, and
  // guessing either way is wrong. Rows show a neutral busy state instead.
  const known = entitlements !== null;

  const strategyById = strategyMap(strategies);
  const planStepById = stepMap(session?.steps);

  const actionFor = (item: SoftwareInfo): RowAction => {
    if (item.installed) return { kind: "installed" };
    const running =
      installing &&
      session?.steps.some((s) => s.stepId === item.id && s.status === "running");
    if (running) return { kind: "installing" };
    const step = planStepById.get(item.id);
    if (step && step.status === "failed") return { kind: "retry" };
    if (!known) return { kind: "install", label: "…" };
    if (canInstall) {
      // A program the tool cannot install gets a truthful label. Offering 安装
      // for something with no strategy would promise an action that does not
      // exist, which is worse than saying so.
      const descriptor = catalogue.find((d) => d.id === item.id);
      if (descriptor && !descriptor.installable) {
        return { kind: "install", label: "查看方案" };
      }
      return { kind: "install", label: "安装" };
    }
    return { kind: "needs-licence" };
  };

  /**
   * The engine's one-line reason for a failed step, for the row to show inline.
   *
   * Deliberately the *same* `stage` string the install screen renders, rather
   * than a rephrasing: two explanations of one failure is two things that can
   * disagree, and the student would have no way to tell which to believe.
   *
   * Returns `null` unless the step genuinely failed, so a row that succeeded
   * cannot pick up a stale sentence from an earlier run — `planStepById` is
   * keyed by program and a later successful attempt overwrites the entry.
   */
  const failureReasonFor = (item: SoftwareInfo): string | null => {
    const step = planStepById.get(item.id);
    if (!step || step.status !== "failed") return null;
    return step.stage || null;
  };

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <header className="fade shrink-0">
        <h2 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          软件与安装方案
        </h2>
        <p className="text-[color:var(--text-quiet)] mt-1 text-[13px]">
          {scanning
            ? "正在读取已安装的软件…"
            : `检查了 ${items.length} 个软件，${installed.length} 个已安装${
                unknown.length > 0 ? `，${unknown.length} 个无法确认` : ""
              }。每一行都说明它是做什么的，以及这台电脑上可以怎么装。`}
        </p>
      </header>

      {/* The tier, stated once at the top, so the per-row buttons below have a
          visible explanation. A row that says 查看方案 without the reason being
          on screen reads as an arbitrary restriction. */}
      <LicenceBanner
        unreadable={licenceUnreadable}
        onRetry={() => void loadEntitlements()}
      />

      <div className="mt-6 flex-1 overflow-y-auto pr-1">
        {scanning && <ScanningRows />}

        {phase === "error" && (
          <div className="glass-soft rise rounded-[12px] p-5">
            <div className="text-[color:var(--status-bad)] mb-1.5 text-[13px] font-medium">
              无法读取软件信息
            </div>
            <p className="text-[color:var(--text-secondary)] selectable text-[13px]">{error}</p>
            <Button
              variant="ghost"
              size="md"
              className="mt-4"
              onClick={() => void scanInstalled()}
            >
              重新检查
            </Button>
          </div>
        )}

        {!scanning && phase !== "error" && (
          <div className="flex flex-col gap-7">
            {installed.length > 0 && (
              <Group
                label="已安装"
                items={installed}
                catalogue={catalogue}
                strategyById={strategyById}
                actionFor={actionFor}
                failureReasonFor={failureReasonFor}
              />
            )}
            {missing.length > 0 && (
              <Group
                label="未安装"
                items={missing}
                catalogue={catalogue}
                strategyById={strategyById}
                actionFor={actionFor}
                failureReasonFor={failureReasonFor}
              />
            )}
            {unknown.length > 0 && (
              <Group
                label="无法确认"
                items={unknown}
                catalogue={catalogue}
                strategyById={strategyById}
                actionFor={actionFor}
                failureReasonFor={failureReasonFor}
              />
            )}

            {inventory && (
              <p className="text-[color:var(--text-quiet)] text-[12px]">
                检测来源：{inventory.providers.join(" · ")}
                。每个软件展开后可以看到各个来源分别说了什么。
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="fade mt-6 flex shrink-0 items-center justify-between border-t border-[color:var(--line-subtle)] pt-5">
        {/* The shared back button, so this footer has no opinion about where
            "返回" goes. It is wrong to hardcode `detect` here: this screen is
            reachable from 检测 *and* from the dashboard, and the history stack
            is the only thing that knows which one it was. */}
        <BackButton />
        <div className="flex items-center gap-3">
          <Button
            variant="quiet"
            disabled={scanning}
            onClick={() => void scanInstalled()}
          >
            重新检查
          </Button>
          <Button
            disabled={scanning || phase === "error"}
            data-testid="software-continue"
            onClick={() => {
              // 已装软件 → 方案 → 安装. This used to jump straight to `install`
              // *and* auto-select the first profile on the way, which quietly made
              // the student's choice for them: they landed on an install screen
              // for a plan they had never picked, in a product whose whole brief is
              // to tell a beginner what is happening and why.
              //
              // So the profile choice goes back to the screen that exists for it.
              // `Choose.tsx` lists every profile, shows what each one installs, and
              // disables its own 下一步 until the student has actually selected one
              // — which is the decision this screen has no business making.
              //
              // `buildPlan()` is deliberately KEPT. The plan is what makes the rest
              // of the flow cheap (install readiness, the step list, the bootstrap
              // plan are all built off it), and building it is a read: nothing is
              // installed until 开始安装 on the install screen. Going to `choose`
              // without one would leave the next screen waiting on a load it could
              // have started here.
              void (async () => {
                if (!useApp.getState().plan) await buildPlan();
                goTo("choose");
              })();
            }}
          >
            继续
          </Button>
        </div>
      </footer>
    </div>
  );
}

/**
 * The tier, and the one path up.
 *
 * Renders nothing when the licence is unreadable — that case has its own banner —
 * and nothing mid-read, so a paying customer never sees a FREE strip flicker past
 * while their file is being opened.
 */
function LicenceBanner({
  unreadable,
  onRetry,
}: {
  unreadable: boolean;
  onRetry: () => void;
}) {
  const entitlements = useApp((s) => s.entitlements);
  const setSection = useApp((s) => s.setSection);

  if (unreadable) {
    return (
      <div
        data-testid="software-licence-unreadable"
        className="glass-soft rise mt-5 rounded-[12px] px-4 py-3"
      >
        <div className="text-[color:var(--text-primary)] text-[12.5px]">
          无法读取本机授权状态
        </div>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[12px] leading-relaxed">
          下面的按钮暂时按「查看方案」显示。这不代表你的授权有问题，可能只是文件被占用或拦截。
        </p>
        <Button variant="ghost" size="sm" className="mt-2.5" onClick={onRetry}>
          重试
        </Button>
      </div>
    );
  }

  if (!entitlements) return null;

  if (entitlements.canInstall) {
    return (
      <div
        data-testid="software-licence-banner"
        className="rise mt-5 flex items-center gap-2 text-[12.5px] text-[color:var(--text-secondary)]"
      >
        <span className="text-[color:var(--status-ok)]" aria-hidden>
          ✓
        </span>
        <span>{entitlements.reason}</span>
      </div>
    );
  }

  return (
    <div
      data-testid="software-licence-banner"
      className="glass-soft rise mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[12px] px-4 py-3"
    >
      <p className="text-[color:var(--text-secondary)] min-w-0 text-[12.5px] leading-relaxed">
        {entitlements.reason}下面的「查看方案」会说明每个软件手动安装的方法。
      </p>
      <Button
        size="sm"
        data-testid="software-upgrade-entry"
        onClick={() => {
          // The dashboard's licence section owns activation. Sending the student
          // there rather than growing a second activation form on this screen
          // keeps one implementation of the input, the request and the errors.
          setSection("license");
          useApp.getState().openDashboard();
        }}
      >
        升级 PRO
      </Button>
    </div>
  );
}

function Group({
  label,
  items,
  catalogue,
  strategyById,
  actionFor,
  failureReasonFor,
}: {
  label: string;
  items: SoftwareInfo[];
  catalogue: SoftwareDescriptor[];
  strategyById: Map<string, InstallStrategy>;
  actionFor: (item: SoftwareInfo) => RowAction;
  /**
   * Why the last attempt at this program failed, or `null`.
   *
   * Passed down rather than looked up in the row because the map it comes from
   * belongs to the screen's session, and a row that reached into the store for
   * it would be reading state the screen has already narrowed for it.
   */
  failureReasonFor: (item: SoftwareInfo) => string | null;
}) {
  return (
    <div className="rise">
      <SectionLabel>
        {label} · {items.length}
      </SectionLabel>
      <div className="stagger flex flex-col gap-1.5">
        {items.map((item) => (
          <SoftwareRow
            key={item.id}
            item={item}
            catalogue={catalogue}
            strategy={strategyById.get(item.id) ?? null}
            action={actionFor(item)}
            failureReason={failureReasonFor(item)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One program.
 *
 * ## Why the whole row is not one big button any more
 *
 * It used to be: the entire row was a `<button>` that expanded the evidence. That
 * works only while the row has *one* action. The moment it carries its own
 * permission-aware button, nesting a button inside a button is invalid HTML, and
 * a click on the inner one would also fire the outer — so pressing 安装 would
 * expand the row *and* start an install.
 *
 * The row is therefore a layout with three independent controls: the row body
 * (expand evidence), the action button, and the FREE panel's two buttons. None
 * contains another.
 */
function SoftwareRow({
  item,
  catalogue,
  strategy,
  action,
  failureReason,
}: {
  item: SoftwareInfo;
  catalogue: SoftwareDescriptor[];
  strategy: InstallStrategy | null;
  action: RowAction;
  /** Why the last attempt failed, shown inline on a `重试` row. */
  failureReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const meta = describeSoftware(item.id, catalogue);

  const descriptor = catalogue.find((d) => d.id === item.id);
  const method = describeMethod(item, strategy, descriptor);

  return (
    <div
      data-software-row={item.id}
      className={clsx(
        "border-[color:var(--line-subtle)] rounded-[10px] border transition-colors duration-150",
        item.installed
          ? "hover:border-[color:var(--line-default)] hover:bg-[color:var(--surface-hover)]"
          : "bg-[color:var(--surface-raised)]/40",
      )}
    >
      <div className="flex items-center gap-3.5 px-3.5 py-3">
        {/* 官方图标 — the vendor's own asset, never a redrawn approximation. */}
        <SoftwareIcon id={item.id} size={30} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="text-[color:var(--text-primary)] hover:text-[color:var(--text-strong)] min-w-0 text-left text-[13.5px] transition-colors"
            >
              {item.name}
            </button>
            {item.onPath && (
              <span className="text-[color:var(--text-quiet)] shrink-0 text-[11.5px]">
                命令行可用
              </span>
            )}
          </div>

          {/* 用途 — the catalogue's purpose, which is the field that turns a
              check into an explanation. Present in every state, including
              installed: "what is this" does not stop mattering once it is
              present. */}
          <div className="text-[color:var(--text-quiet)] truncate text-[12px]">
            {meta.purpose || "目录中还没有这个软件的说明"}
          </div>

          {/* 安装方式 + 状态, on their own line so they are scannable. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusLine item={item} />
            <span className="text-[color:var(--text-quiet)] text-[11.5px]">
              安装方式：
              <span className="text-[color:var(--text-tertiary)]">{method}</span>
            </span>
            {needsNode(item.id) && (
              // A real prerequisite, and one a beginner has no way to know. The
              // install engine handles it, but seeing it beforehand is what
              // stops "why did this need Node?" later.
              <span className="text-[color:var(--text-quiet)] text-[11.5px]">
                需要先装 Node.js
              </span>
            )}
          </div>

          {/* Why the last attempt failed, in the row itself.
              
              Brief §八 asks the failed state to carry 查看原因 next to 重试. The
              reason is the engine's own `stage` string — the same sentence the
              install screen shows — so this is not a second explanation that
              could disagree, and it needs no click to read. A row that says only
              重试 makes the student press it blind, which is the "先点卡片再猜"
              failure §八 names.

              Only rendered when there is something to say. An empty line would
              shift the layout for every healthy row. */}
          {action.kind === "retry" && failureReason && (
            <div
              data-testid="row-failure-reason"
              className="text-[color:var(--status-warn)] mt-1 text-[11.5px] leading-relaxed"
            >
              上次未完成：{failureReason}
            </div>
          )}
        </div>

        <SourceMarks sources={item.sources} />

        <ActionButton
          item={item}
          action={action}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((v) => !v)}
        />

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "收起检测详情" : "展开检测详情"}
          className="text-[color:var(--text-quiet)] hover:text-[color:var(--text-secondary)] shrink-0 rounded-[6px] p-1 transition-colors"
        >
          <svg
            viewBox="0 0 12 12"
            className={clsx("h-3 w-3 transition-transform duration-200", open && "rotate-90")}
            fill="none"
            aria-hidden
          >
            <path
              d="M4 2.5L7.5 6L4 9.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* The FREE explanation, in place rather than in a modal — same reasoning
          as `UpgradePrompt`: this app has spent every previous round removing
          modals, and the panel is small enough to sit in the flow. */}
      {panelOpen && action.kind === "needs-licence" && <ManualPanel item={item} />}

      {open && (
        <div className="fade border-[color:var(--line-subtle)]/70 flex flex-col gap-2 border-t px-3.5 py-3 pl-[68px]">
          {item.evidence.map((ev, i) => (
            <EvidenceLine key={`${ev.source}-${i}`} ev={ev} />
          ))}

          {item.packageId && (
            <div className="text-[color:var(--text-quiet)] mt-0.5 text-[11.5px]">
              winget 包 id：
              <span className="selectable text-[color:var(--text-tertiary)]">{item.packageId}</span>
            </div>
          )}

          {/* The full fallback chain, which is the honest answer to "what
              happens if winget is not there". Shown only when expanded: it is
              reassurance for the student who asks, not noise for the one who
              does not. */}
          {strategy && strategy.fallbacks.length > 0 && (
            <div className="text-[color:var(--text-quiet)] mt-0.5 text-[11.5px] leading-relaxed">
              备用方式：{strategy.fallbacks.join("；")}
            </div>
          )}

          {item.hints.map((hint) => (
            <div
              key={hint}
              className="text-[color:var(--text-tertiary)] border-warn/25 mt-0.5 border-l-2 pl-2.5 text-[12px] leading-relaxed"
            >
              {hint}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The action button.
 *
 * **Always rendered.** That is the requirement, and it is also the better design:
 * a control that vanishes depending on tier teaches the student that the app is
 * unpredictable, while a control that changes label teaches them what the tier
 * means. The five states are exactly the brief's:
 *
 * | state | label |
 * |---|---|
 * | FREE / no licence | 查看方案 (opens the panel explaining PRO) |
 * | PRO | 安装 |
 * | already installed | 已安装 ✓ (disabled — nothing left to do) |
 * | installing | 安装中… (disabled) |
 * | failed | 重试 |
 *
 * `disabled` is used for the two states where pressing would be wrong (already
 * done, already running). It is deliberately *not* used for FREE: 查看方案 is a
 * real, useful action, so it must be pressable.
 */
function ActionButton({
  item,
  action,
  panelOpen,
  onTogglePanel,
}: {
  item: SoftwareInfo;
  action: RowAction;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const goTo = useApp((s) => s.goTo);

  const testId = {
    installed: "row-action-installed",
    installing: "row-action-installing",
    retry: "row-action-retry",
    install: "row-action-install",
    "needs-licence": "row-action-free",
  }[action.kind];

  if (action.kind === "installed") {
    // Disabled rather than absent: the row still has a button, so the column
    // never collapses and the student is told *why* there is nothing to do.
    return (
      <Button
        size="sm"
        variant="quiet"
        disabled
        data-testid={testId}
        aria-label={`${item.name} 已安装`}
        className="shrink-0 text-[color:var(--status-ok)]"
      >
        已安装 ✓
      </Button>
    );
  }

  if (action.kind === "installing") {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled
        data-testid={testId}
        aria-label={`${item.name} 安装中`}
        className="shrink-0"
      >
        安装中…
      </Button>
    );
  }

  if (action.kind === "needs-licence") {
    return (
      <Button
        size="sm"
        variant="ghost"
        data-testid={testId}
        aria-expanded={panelOpen}
        aria-label={`${item.name} 查看方案`}
        onClick={onTogglePanel}
        className="shrink-0"
      >
        查看方案
      </Button>
    );
  }

  if (action.kind === "retry") {
    return (
      <Button
        size="sm"
        variant="ghost"
        data-testid={testId}
        aria-label={`${item.name} 重试`}
        onClick={() => goTo("install")}
        className="shrink-0 border-[color:var(--status-warn)]/40"
      >
        重试
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      data-testid={testId}
      disabled={action.label === "…"}
      aria-label={`${item.name} ${action.label}`}
      onClick={() => goTo("install")}
      className="shrink-0"
    >
      {action.label}
    </Button>
  );
}

/**
 * What 查看方案 opens.
 *
 * Three things, and all three are required by the brief:
 *
 * 1. `安装需要PRO授权` — the reason, stated plainly. Without it the button reads
 *    as an arbitrary refusal.
 * 2. `升级PRO` — the way to act on that reason.
 * 3. `查看手动安装方法` — the way to proceed *without* paying. This one matters
 *    most: the FREE tier is a supported tier, and a student who is not going to
 *    buy must still be able to get Git onto their machine. A prompt with only an
 *    upgrade button is not an explanation, it is a wall.
 */
function ManualPanel({ item }: { item: SoftwareInfo }) {
  const [showMethod, setShowMethod] = useState(false);
  const setSection = useApp((s) => s.setSection);
  const openDashboard = useApp((s) => s.openDashboard);

  return (
    <div
      data-testid="row-free-panel"
      data-software-panel={item.id}
      className="fade border-[color:var(--line-subtle)]/70 flex flex-col gap-3 border-t px-3.5 py-3.5 pl-[68px]"
    >
      <div>
        <div
          data-testid="row-free-reason"
          className="text-[color:var(--text-primary)] text-[13px] font-medium"
        >
          安装需要PRO授权
        </div>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[12.5px] leading-relaxed">
          自动下载与安装属于专业版功能。免费版可以继续检测环境、查看推荐，并按下面的步骤自己安装。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          data-testid="row-free-upgrade"
          onClick={() => {
            setSection("license");
            openDashboard();
          }}
        >
          升级PRO
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid="row-free-manual"
          aria-expanded={showMethod}
          onClick={() => setShowMethod((v) => !v)}
        >
          {showMethod ? "收起步骤" : "查看手动安装方法"}
        </Button>
      </div>

      {showMethod && <ManualSteps item={item} />}
    </div>
  );
}

/**
 * The manual route, built from the same data the engine uses.
 *
 * `strategy.preferred` is the exact command the automatic path would run, so a
 * student copying it gets the *same* installation, not a second-best one. That
 * consistency is the point: the manual path is not a different answer, it is the
 * same answer performed by hand.
 *
 * ## When there is no strategy, say where to go rather than that we have nothing
 *
 * Most catalogue entries have no install chain — the tool detects Docker, Cursor,
 * JetBrains and friends but deliberately does not install them (`installable:
 * false`; see `DESIGN.md` "未做的事"). Those rows *still* show 查看方案, because
 * hiding the button would be the hidden-control failure this release exists to
 * remove, and the panel has to answer the click honestly.
 *
 * The first version of this branch printed one line: "这个软件没有随附的自动安装
 * 方式". Read next to a 查看手动安装方法 button the student just pressed, that
 * reads as *there is no way to install this* — which is false and is the worst
 * sentence this screen could produce. The replacement names the vendor's own
 * download page, which is both the true instruction and the one the student
 * actually needs.
 */
function ManualSteps({ item }: { item: SoftwareInfo }) {
  const strategies = useApp((s) => s.strategies);
  const catalogue = useApp((s) => s.catalogue);
  const strategy = strategies.find((s) => s.id === item.id) ?? null;

  const lines: string[] = [];
  if (strategy?.preferred) lines.push(strategy.preferred);
  for (const fallback of strategy?.fallbacks ?? []) lines.push(fallback);

  const descriptor = catalogue.find((d) => d.id === item.id);
  // Same distinction as `describeMethod`: `installable` is the catalog's
  // permanent fact, "no strategy loaded" is a fact about this render.
  const unmanaged = descriptor ? !descriptor.installable : false;

  if (lines.length === 0) {
    return (
      <div
        data-testid="row-manual-steps"
        className="bg-[color:var(--surface-inset)] rounded-[8px] px-3 py-2.5"
      >
        <div className="text-[color:var(--text-quiet)] mb-1.5 text-[11px] tracking-[0.08em] uppercase">
          手动安装方法
        </div>
        <p
          data-testid="row-manual-fallback"
          className="text-[color:var(--text-secondary)] text-[12.5px] leading-relaxed"
        >
          {unmanaged
            ? `${item.name} 需要到官方网站下载安装包后按提示安装。本工具只负责告诉你它装没装，不会代你安装。`
            : `${item.name} 可以自动安装，但它的安装命令属于某个配置方案。先回到「方案」选一个包含它的方案，这里就会显示具体命令。也可以直接到官网下载安装包自行安装。`}
        </p>
        <p className="text-[color:var(--text-quiet)] mt-2 text-[11.5px] leading-relaxed">
          装完后回到这里点「重新检查」，这一行就会变成「已安装」。
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="row-manual-steps"
      className="bg-[color:var(--surface-inset)] rounded-[8px] px-3 py-2.5"
    >
      <div className="text-[color:var(--text-quiet)] mb-1.5 text-[11px] tracking-[0.08em] uppercase">
        手动安装步骤
      </div>
      <ol className="flex flex-col gap-1.5">
        {lines.map((line, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="text-[color:var(--text-quiet)] shrink-0 text-[12px]">
              {i + 1}.
            </span>
            {/* `selectable` so the command can actually be copied — a manual
                instruction the student cannot copy is a manual instruction they
                will mistype. */}
            <span className="selectable text-[color:var(--text-secondary)] min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed break-all">
              {line}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[color:var(--text-quiet)] mt-2 text-[11.5px] leading-relaxed">
        在开始菜单搜索「终端」或「PowerShell」，粘贴上面的命令并回车。装完后回到这里点「重新检查」。
      </p>
    </div>
  );
}

/** The measured state, as a glyph + a word. */
function StatusLine({ item }: { item: SoftwareInfo }) {
  const { confidence, label } = describeStatus(item);
  return (
    <span className="flex shrink-0 items-center gap-1.5" data-testid="row-status">
      <StatusMark confidence={confidence} size="sm" decorative />
      <span
        className={clsx(
          "text-[11.5px]",
          confidence === "ok"
            ? "text-[color:var(--status-ok)]"
            : confidence === "unknown"
              ? "text-[color:var(--status-warn)]"
              : "text-[color:var(--text-quiet)]",
        )}
      >
        {label}
      </span>
    </span>
  );
}

/**
 * The state word for one row.
 *
 * Three values, not two, and the third is the important one: a program whose
 * probes all failed shows 无法确认, never 未安装. Rendering it as missing would
 * tell a student to reinstall software they may already have, which is the single
 * worst thing this screen could do — see `ui.tsx`'s `StatusMark` note.
 */
function describeStatus(item: SoftwareInfo): { confidence: Confidence; label: string } {
  if (item.installed) {
    return {
      confidence: "ok",
      label: item.version ? `已安装 · 版本 ${item.version}` : "已安装",
    };
  }
  if (item.confidence === "unknown") {
    return { confidence: "unknown", label: "无法确认" };
  }
  return { confidence: "fail", label: "未安装" };
}

/**
 * How this program would be installed here.
 *
 * ## Why `installable` is checked FIRST, and why that is a bug fix
 *
 * The first version consulted the strategy list first and treated "no strategy"
 * as "we cannot install this". Those are two different facts and the whole screen
 * depends on them not being conflated:
 *
 * * `installable: false` — a **permanent** statement about the catalog. The tool
 *   detects Docker, Cursor and JetBrains but deliberately never installs them.
 * * "no strategy in `strategies`" — a **temporary** statement about *this render*.
 *   `install_strategies` is scoped to one profile, and the screen lists every
 *   program. On the beginner profile the list contains only `claude_desktop`, so
 *   Claude Code — which is genuinely installable — was described as
 *   "安装方式还没有收录", i.e. the screen told a student the tool cannot install
 *   something it can.
 *
 * The remedy is to take the permanent fact from the catalog, where it is
 * authoritative, and use the strategy list only to say *how* — never *whether*.
 * A program with `installable: true` and no strategy loaded yet is "winget
 * 自动安装" when the catalogue gave it a package id, and otherwise says the method
 * has not loaded rather than that none exists.
 */
function describeMethod(
  item: SoftwareInfo,
  strategy: InstallStrategy | null,
  descriptor: SoftwareDescriptor | undefined,
): string {
  if (descriptor && !descriptor.installable) {
    // ## Reworded in 0.1.2 because the old sentence was a product bug
    //
    // It used to read "本工具不提供安装，需自行获取". For a beginner — the one
    // audience this product has — that sentence does not say "this program needs
    // a manual download"; it says **"this tool doesn't work"**. It was also the
    // single most common complaint about the previous build, and it appeared on
    // entries that had a working `winget` package the whole time (Docker, Cursor,
    // MSVC, CMake, Java, Rust, uv, pnpm). Those were promoted to installable above
    // this change; what is left here is genuinely manual.
    //
    // So the replacement leads with the reason and names who does the step, and
    // it never implies the tool is broken. `needsManualStep` keeps the two cases
    // distinguishable in the data rather than in prose.
    return "需你手动安装（本工具仅检测，不代装此类软件）";
  }

  if (strategy?.preferred) {
    if (strategy.preferred.startsWith("winget")) return "winget 自动安装";
    if (strategy.preferred.startsWith("官方安装包")) return "官方安装包";
    return strategy.preferred;
  }

  if (descriptor?.installable) {
    // Installable, but this profile's strategy list has not named it. The
    // package id from the inventory is enough to name the method truthfully.
    return item.packageId ? "winget 自动安装" : "自动安装（方案载入后显示方式）";
  }

  if (item.packageId) return "winget 自动安装";
  return "暂未收录安装方式";
}

/**
 * The per-source chips on the collapsed row.
 *
 * Exists so that "found by three independent sources" is visible without opening
 * the row — that agreement is the reason a finding is trustworthy, and it is the
 * main thing stage 2 added over a single anonymous check.
 */
function SourceMarks({ sources }: { sources: ProbeSource[] }) {
  if (sources.length === 0) return null;
  return (
    <span className="hidden shrink-0 items-center gap-1 lg:flex">
      {sources.map((source) => (
        <span
          key={source}
          title={sourceLabel(source)}
          className="border-ok/25 text-[color:var(--status-ok)]/90 rounded-[4px] border px-1.5 py-[1px] text-[10.5px]"
        >
          {sourceLabel(source)}
        </span>
      ))}
    </span>
  );
}

function sourceLabel(source: ProbeSource): string {
  switch (source) {
    case "registry":
      return "注册表";
    case "path":
      return "PATH";
    case "winget":
      return "winget";
  }
}

function EvidenceLine({ ev }: { ev: EvidenceView }) {
  const confidence: Confidence =
    ev.outcome === "present"
      ? "ok"
      : ev.outcome === "unavailable"
        ? "unknown"
        : "fail";

  return (
    <div className="flex items-start gap-2.5">
      <StatusMark confidence={confidence} />
      <span className="text-[color:var(--text-tertiary)] w-14 shrink-0 text-[12px]">
        {sourceLabel(ev.source)}
      </span>
      <span className="text-[color:var(--text-secondary)] selectable min-w-0 flex-1 truncate text-[12px]">
        {ev.outcome === "present"
          ? ev.detail ?? "已检测到"
          : ev.outcome === "unavailable"
            ? `无法检查：${ev.detail ?? "未知原因"}`
            : "未找到"}
      </span>
    </div>
  );
}

function ScanningRows() {
  return (
    <div className="flex flex-col gap-1.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="border-[color:var(--line-subtle)]/60 flex items-center gap-3 rounded-[10px] border border-dashed px-3.5 py-3"
        >
          <span className="bg-[color:var(--surface-inset)] h-7 w-7 rounded-[7px]" />
          <span className="bg-[color:var(--surface-inset)] h-3 w-24 rounded" />
          <span className="bg-[color:var(--surface-inset)] h-3 flex-1 rounded" />
        </div>
      ))}
      <p className="text-[color:var(--text-quiet)] mt-1 text-[12.5px]">
        正在通过注册表、PATH 与 winget 三个来源检查…
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * The install strategies, keyed by program.
 *
 * Built once per render rather than per row: the list screen does up to 29 rows,
 * and a linear scan inside each of them is the difference between "renders" and
 * "renders at 29 × N".
 */
function strategyMap(strategies: InstallStrategy[]): Map<string, InstallStrategy> {
  return new Map(strategies.map((s) => [s.id as string, s]));
}

/**
 * The last run's per-step results, keyed by program. Empty before any run.
 *
 * Typed structurally (`stepId`/`status`/`stage`) rather than as `StepProgress[]`
 * because these are the only fields this screen reads: the `重试` rule needs the
 * *status*, and the failed row's one-line explanation needs the *stage*. Reading
 * the two through a narrowed parameter keeps that dependency visible, and means
 * adding a field to `StepProgress` cannot silently change what this screen does.
 */
function stepMap(
  steps: { stepId: SoftwareId; status: string; stage: string }[] | undefined,
): Map<string, { stepId: SoftwareId; status: string; stage: string }> {
  if (!steps) return new Map();
  return new Map(steps.map((s) => [s.stepId as string, s]));
}
