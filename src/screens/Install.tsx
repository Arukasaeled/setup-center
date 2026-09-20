/**
 * Screen 4 — Installation.
 *
 * The brief is explicit: **不要滚动日志**. A student cannot read winget output and
 * a wall of text implies something might be wrong. So the default view is:
 *
 *   one current item, big
 *   a step rail showing how much is left
 *   one line of plain Chinese describing what is happening right now
 *
 * The raw output is still captured — the Rust engine returns it per action — but
 * it stays behind "高级模式", collapsed by default. That is the honest way to
 * satisfy "hide the log": one click away for the person who needs it, invisible
 * to the person who does not.
 *
 * What this screen must never do is claim progress it cannot observe. Every
 * number here comes from the session the engine returned; the only thing the
 * frontend adds is an elapsed-time readout while waiting.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Button, SectionLabel } from "../components/ui";
import { SoftwareIcon } from "../components/SoftwareIcon";
import { describeSoftware } from "../lib/software";
import { selectedProfile, useApp } from "../lib/store";
import type {
  AttemptOutcome,
  SoftwareDescriptor,
  SoftwareId,
  StepProgress,
  StepStatus,
} from "../lib/types";

export function InstallScreen() {
  const plan = useApp((s) => s.plan);
  const profile = useApp(selectedProfile);
  const catalogue = useApp((s) => s.catalogue);
  const session = useApp((s) => s.session);
  const readiness = useApp((s) => s.readiness);
  const installing = useApp((s) => s.installing);
  const executionError = useApp((s) => s.executionError);
  const canResume = useApp((s) => s.canResume);
  const goTo = useApp((s) => s.goTo);
  const startInstall = useApp((s) => s.startInstall);
  const resumeInstall = useApp((s) => s.resumeInstall);
  const cancelInstall = useApp((s) => s.cancelInstall);

  const [advanced, setAdvanced] = useState(false);
  const [, forceTick] = useState(0);
  // The profile id of the plan this component has already started the engine
  // for. `null` means "nothing started by this mount".
  const startedRef = useRef<string | null>(null);

  // A one-second tick while installing, purely so the elapsed clock moves. It
  // deliberately does not touch any status: progress comes from the session, and
  // a fake progress bar that advances on a timer is exactly the lie this screen
  // is built to avoid.
  useEffect(() => {
    if (!installing) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [installing]);

  // Start the engine once per mount, unless a run for this same plan has
  // already happened or is happening.
  //
  // The guard is on the *profile*, not merely on "a session exists": returning
  // to this screen after switching profiles must start the engine for the new
  // plan. Keying on the profile id is what makes that distinction, and it is the
  // bug that made a re-entered screen display the previous profile's result
  // beside the new profile's step list.
  useEffect(() => {
    if (!plan || installing) return;
    if (startedRef.current === plan.profileId) return;
    startedRef.current = plan.profileId;
    void startInstall();
  }, [plan, installing, startInstall]);

  const runnable = useMemo(
    () => plan?.steps.filter((s) => !s.satisfied) ?? [],
    [plan],
  );

  if (!plan || !profile) {
    return <EmptyState onBack={() => goTo("choose")} />;
  }

  const steps = session?.steps ?? [];
  const done = steps.filter(
    (s) => s.status === "succeeded" || s.status === "skipped",
  ).length;
  const allSatisfied = runnable.length === 0;

  // The current row is the running one; before the session arrives it is the
  // first step that is not already satisfied.
  const currentIndex = steps.findIndex((s) => s.status === "running");
  const firstPending = steps.findIndex(
    (s) => s.status !== "succeeded" && s.status !== "skipped",
  );
  const displayIndex =
    currentIndex >= 0
      ? currentIndex
      : firstPending >= 0
        ? firstPending
        : Math.max(0, steps.length - 1);

  const finished = session !== null && !installing;
  const failed = session?.failedSteps ?? [];
  const halted = session?.haltedReason ?? null;

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <header className="fade flex shrink-0 items-start justify-between">
        <div>
          <h2 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
            {installing
              ? "正在安装"
              : finished
                ? failed.length > 0
                  ? "安装已完成，部分项目需要处理"
                  : "安装完成"
                : "准备安装"}
          </h2>
          <p className="text-[color:var(--text-quiet)] mt-1 text-[13px]">
            {installing
              ? `${profile.name} · 已完成 ${done} / ${plan.steps.length}`
              : finished
                ? `${profile.name} · ${done} / ${plan.steps.length} 项就绪`
                : `${profile.name} · 共 ${runnable.length} 项待安装`}
          </p>
        </div>

        <button
          onClick={() => setAdvanced((v) => !v)}
          className={clsx(
            "rounded-[8px] px-2.5 py-1.5 text-[12px] transition-colors duration-150",
            advanced
              ? "bg-[color:var(--surface-hover)] text-[color:var(--text-primary)]"
              : "text-[color:var(--text-quiet)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--surface-hover)]",
          )}
        >
          {advanced ? "隐藏详细" : "高级模式"}
        </button>
      </header>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {halted && <HaltNotice reason={halted} names={permissionNames(session, catalogue)} />}
        {executionError && <ErrorNotice message={executionError} />}
        {readiness && !readiness.canStart && !installing && (
          <BlockerNotice blockers={readiness.blockers} />
        )}

        {!allSatisfied && (
          <div className="fade mt-4">
            <CurrentStep
              steps={steps}
              index={displayIndex}
              installing={installing}
              totalCount={plan.steps.length}
              session={session}
            />
          </div>
        )}

        <div className="mt-7">
          <SectionLabel>安装项</SectionLabel>
          <div className="stagger flex flex-col gap-1.5">
            {plan.steps.map((step) => {
              const progress = steps.find((s) => s.stepId === step.id);
              const attempt = lastActionFor(session, step.id);
              // The session is the authority once a run has happened, and the
              // plan's `satisfied` flag is only a fallback for the moment before
              // the engine reports back. This ordering is the whole point of the
              // screen: the plan is a *prediction* made from a pre-run scan, and
              // a prediction must never overwrite the result. Rendering
              // `step.satisfied` first would show "跳过" for a program the run
              // then failed to install, which is the one way this page could lie.
              const status: StepStatus =
                progress?.status ?? (step.satisfied ? "skipped" : "pending");
              const stage =
                progress?.stage ??
                (step.satisfied ? "已检测到，无需安装" : "等待开始");
              return (
                <StepRow
                  key={step.id}
                  id={step.id}
                  name={describeSoftware(step.id, catalogue).name}
                  purpose={describeSoftware(step.id, catalogue).purpose}
                  status={status}
                  stage={stage}
                  detail={progress?.detail ?? null}
                  outcome={attempt?.outcome ?? null}
                  satisfied={step.satisfied}
                />
              );
            })}
          </div>

          {plan.satisfiedCount > 0 && (
            <p className="text-[color:var(--text-quiet)] mt-4 text-[12.5px]">
              其中 {plan.satisfiedCount} 项已安装，将被跳过。
            </p>
          )}
        </div>

        {advanced && <ActionTrace session={session} catalogue={catalogue} />}
      </div>

      <footer className="fade mt-6 flex shrink-0 items-center justify-between border-t border-[color:var(--line-subtle)] pt-5">
        <div className="flex items-center gap-2">
          <Button variant="quiet" onClick={() => goTo("choose")} disabled={installing}>
            返回
          </Button>
          {installing && (
            <Button variant="ghost" onClick={() => void cancelInstall()}>
              取消安装
            </Button>
          )}
          {!installing && canResume && (
            <Button variant="ghost" onClick={() => void resumeInstall()}>
              继续安装（还剩 {session?.remaining.length ?? 0} 项）
            </Button>
          )}
        </div>

        <Button
          disabled={installing}
          onClick={() => {
            // Straight to the bootstrap screen, which runs the configuration
            // engine on arrival. It is not a second confirmation: the student
            // already chose a profile, and the bootstrap stage list is where the
            // result of that choice becomes visible.
            goTo("bootstrap");
          }}
        >
          {installing ? "安装进行中…" : "继续配置环境"}
        </Button>
      </footer>
    </div>
  );
}

/** The most recent action recorded for a step, for the outcome badge. */
function lastActionFor(session: ReturnType<typeof useApp.getState>["session"], id: SoftwareId) {
  if (!session) return null;
  for (let i = session.actions.length - 1; i >= 0; i--) {
    if (session.actions[i].id === id) return session.actions[i];
  }
  return null;
}

function CurrentStep({
  steps,
  index,
  installing,
  totalCount,
  session,
}: {
  steps: StepProgress[];
  index: number;
  installing: boolean;
  totalCount: number;
  session: ReturnType<typeof useApp.getState>["session"];
}) {
  const step = steps[index];
  const total = totalCount > 0 ? totalCount : steps.length;
  const done = steps.filter(
    (s) => s.status === "succeeded" || s.status === "skipped",
  ).length;
  const position = Math.min(done + 1, total);

  // Elapsed time comes from the session's own timestamps, not from a counter
  // started in the UI: if the engine has been running for two minutes, the
  // screen must say two minutes, not however long this component has existed.
  const elapsed = elapsedLabel(session, installing);

  return (
    <div className="glass rounded-[16px] px-6 py-6">
      <div className="text-[color:var(--text-quiet)] flex items-center justify-between text-[11px] font-medium tracking-[0.14em] uppercase">
        <span>{installing && step ? "当前项目" : "最后一项"}</span>
        {elapsed && <span className="tnum normal-case tracking-normal">{elapsed}</span>}
      </div>

      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-[color:var(--text-strong)] text-[22px] font-semibold tracking-[-0.02em]">
          {step?.name ?? "…"}
        </span>
        <span className="text-[color:var(--text-quiet)] tnum text-[13px]">
          {position} / {total}
        </span>
      </div>

      <p className="text-[color:var(--text-tertiary)] mt-1.5 text-[13.5px]">
        {step?.stage ?? (installing ? "正在准备…" : "等待开始")}
      </p>

      {/* The rail: one segment per step, so "how much is left" is answered
          peripherally without reading a number. Segments reflect real statuses
          rather than the index, because a skipped step and a finished step are
          different outcomes and a plain position bar would blur them. */}
      <div className="mt-5 flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => {
          const s = steps[i];
          const tone = s
            ? s.status === "failed"
              ? "bg-[color:var(--status-bad)]"
              : s.status === "succeeded" || s.status === "skipped"
                ? "bg-[color:var(--status-accent-soft)]"
                : s.status === "running"
                  ? "bg-[color:var(--status-accent)] animate-pulse"
                  : s.status === "cancelled"
                    ? "bg-[color:var(--status-warn)]/50"
                    : "bg-[color:var(--line-default)]"
            : i < index
              ? "bg-[color:var(--status-accent-soft)]"
              : "bg-[color:var(--line-default)]";
          return (
            <span
              key={i}
              className={clsx(
                "h-1 flex-1 rounded-full transition-colors duration-300",
                tone,
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

/** "已用时 1 分 12 秒", derived from the session's own timestamps. */
function elapsedLabel(
  session: ReturnType<typeof useApp.getState>["session"],
  installing: boolean,
): string | null {
  if (!session) return null;
  const start = Date.parse(session.startedAt);
  if (Number.isNaN(start)) return null;
  const end = session.finishedAt ? Date.parse(session.finishedAt) : Date.now();
  if (Number.isNaN(end)) return null;
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  const label =
    seconds < 60
      ? `${seconds} 秒`
      : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return installing ? `已用时 ${label}` : `用时 ${label}`;
}

function StepRow({
  id,
  name,
  purpose,
  status,
  stage,
  detail,
  outcome,
  satisfied,
}: {
  id: SoftwareId;
  name: string;
  purpose: string;
  status: StepStatus;
  stage: string;
  detail: string | null;
  outcome: AttemptOutcome | null;
  satisfied: boolean;
}) {
  const active = status === "running";
  return (
    <div
      className={clsx(
        "flex items-center gap-3.5 rounded-[10px] border px-3.5 py-2.5 transition-colors duration-150",
        status === "failed"
          ? "border-bad/30"
          : active
            ? "border-accent/30 bg-[color:var(--status-accent)]/[0.04]"
            : "border-[color:var(--line-subtle)]/70 hover:border-[color:var(--line-default)]",
      )}
    >
      <SoftwareIcon id={id} size={28} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[color:var(--text-primary)] text-[13.5px]">{name}</span>
          {satisfied && <span className="text-[color:var(--text-quiet)] text-[11.5px]">已安装</span>}
          {outcome === "permissionDenied" && (
            <span className="text-[color:var(--status-bad)] text-[11.5px]">需要管理员</span>
          )}
        </div>
        <div className="text-[color:var(--text-quiet)] truncate text-[12px]">
          {status === "running" || status === "failed" ? stage : purpose}
        </div>
        {detail && (
          <div
            className={clsx(
              "mt-1 text-[12px] leading-relaxed",
              status === "failed" ? "text-[color:var(--status-bad)]/90" : "text-[color:var(--status-warn)]/90",
            )}
          >
            {detail}
          </div>
        )}
      </div>

      <StepBadge status={status} />
    </div>
  );
}

function StepBadge({ status }: { status: StepStatus }) {
  const map: Record<StepStatus, { text: string; tone: string }> = {
    pending: { text: "等待", tone: "text-[color:var(--text-quiet)]" },
    running: { text: "进行中", tone: "text-[color:var(--status-accent)]" },
    succeeded: { text: "完成", tone: "text-[color:var(--status-ok)]" },
    succeededWithWarning: { text: "有提示", tone: "text-[color:var(--status-warn)]" },
    failed: { text: "失败", tone: "text-[color:var(--status-bad)]" },
    skipped: { text: "跳过", tone: "text-[color:var(--text-quiet)]" },
    cancelled: { text: "已取消", tone: "text-[color:var(--text-quiet)]" },
  };
  const { text, tone } = map[status];
  return (
    <span className={clsx("shrink-0 text-[12px] tabular-nums", tone)}>
      {text}
    </span>
  );
}

/**
 * Every executed action, with its command, exit code and output.
 *
 * This is the "可追踪" requirement made visible: not a summary of what happened
 * but the record itself. Only rendered in advanced mode, because its audience is
 * the person helping the student rather than the student.
 */
function ActionTrace({
  session,
  catalogue,
}: {
  session: ReturnType<typeof useApp.getState>["session"];
  catalogue: SoftwareDescriptor[];
}) {
  if (!session || session.actions.length === 0) return null;

  return (
    <div className="mt-6">
      <SectionLabel>执行记录 · {session.actions.length} 次尝试</SectionLabel>
      <div className="flex flex-col gap-2">
        {session.actions.map((action, i) => (
          <div
            key={i}
            className="border-[color:var(--line-subtle)]/70 rounded-[10px] border px-3.5 py-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[color:var(--text-secondary)] text-[12.5px]">
                {describeSoftware(action.id, catalogue).name}
                {action.attempt > 0 && (
                  <span className="text-[color:var(--text-quiet)]"> · 第 {action.attempt + 1} 种方式</span>
                )}
              </span>
              <span
                className={clsx(
                  "shrink-0 text-[11.5px]",
                  action.outcome === "succeeded"
                    ? "text-[color:var(--status-ok)]"
                    : action.outcome === "permissionDenied"
                      ? "text-[color:var(--status-bad)]"
                      : "text-[color:var(--status-warn)]",
                )}
              >
                {outcomeLabel(action.outcome)}
                {action.exitCode !== null && ` · 退出码 ${action.exitCode}`}
                {` · ${(action.durationMs / 1000).toFixed(1)}s`}
              </span>
            </div>
            <div className="text-[color:var(--text-quiet)] selectable mt-1 font-mono text-[11.5px] break-all">
              {action.command}
            </div>
            {action.error && (
              <div className="text-[color:var(--status-bad)]/90 mt-1 text-[12px]">{action.error}</div>
            )}
            {action.output.trim() && (
              <pre className="text-[color:var(--text-quiet)] selectable mt-1.5 max-h-40 overflow-y-auto font-mono text-[11px] break-all whitespace-pre-wrap">
                {action.output.trim().slice(0, 1200)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function outcomeLabel(outcome: AttemptOutcome): string {
  switch (outcome) {
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "unavailable":
      return "不可用";
    case "permissionDenied":
      return "权限不足";
    case "skipped":
      return "已跳过";
    case "cancelled":
      return "已取消";
  }
}

/**
 * Shown when the engine stopped early for a reason the student must fix.
 *
 * Distinct from a per-step error because it explains an *interruption*: the
 * steps below it were not attempted, and the resume button is the recovery.
 *
 * ## Why it names the programs and gives an ordered fix
 *
 * A permission halt is the most common way a first run stops, and the original
 * notice said only "安装需要管理员权限。请右键以管理员身份重新运行本程序". Two
 * problems with that, both reported from a real run:
 *
 * 1. It did not say **which** programs needed elevation, so the student could not
 *    tell whether the problem was one program or all of them.
 * 2. "请右键以管理员身份重新运行本程序" is not actionable for a student who
 *    launched the app from the installer's "完成" button, because there is no
 *    shortcut to right-click.
 *
 * The notice now names them and gives an ordered list, including the alternative
 * of skipping that one program rather than abandoning the whole run.
 */
function HaltNotice({ reason, names }: { reason: string; names: string[] }) {
  return (
    <div className="fade border-warn/25 bg-[color:var(--status-warn)]/[0.06] mt-4 rounded-[12px] border px-4 py-3.5">
      <div className="text-[color:var(--text-primary)] text-[13px] font-medium">安装已暂停</div>
      <p className="text-[color:var(--text-secondary)] mt-1 text-[12.5px] leading-relaxed">{reason}</p>

      {names.length > 0 && (
        <p className="text-[color:var(--text-secondary)] mt-2 text-[12.5px] leading-relaxed">
          需要管理员权限的项目：
          <span className="text-[color:var(--text-primary)]">{names.join("、")}</span>
        </p>
      )}

      <div className="text-[color:var(--text-quiet)] mt-2.5 text-[12.5px] leading-relaxed">
        <div className="mb-1">怎么解决（任选一种）：</div>
        <ol className="flex flex-col gap-1 pl-0.5">
          <li>1. 关闭本程序，在开始菜单里找到它，右键 →「以管理员身份运行」，再点下面的「继续安装」。</li>
          <li>2. 或者跳过这几项，先把其他软件装完 —— 点「返回」回到方案页，取消勾选它们。</li>
        </ol>
      </div>
    </div>
  );
}

/** Names of the steps that failed because of elevation, for the halt notice. */
function permissionNames(
  session: ReturnType<typeof useApp.getState>["session"],
  catalogue: SoftwareDescriptor[],
): string[] {
  if (!session) return [];
  const ids = new Set<string>();
  for (const action of session.actions) {
    if (action.outcome === "permissionDenied") ids.add(action.id);
  }
  return [...ids].map((id) => describeSoftware(id as SoftwareId, catalogue).name);
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="fade border-bad/25 bg-[color:var(--status-bad)]/[0.06] mt-4 rounded-[12px] border px-4 py-3.5">
      <div className="text-[color:var(--text-primary)] text-[13px] font-medium">安装未能开始</div>
      <p className="text-[color:var(--text-secondary)] mt-1 text-[12.5px] leading-relaxed">{message}</p>
    </div>
  );
}

/**
 * Shown *before* the run when the engine already knows it cannot succeed.
 *
 * This is the difference between "we cannot install X, here is why" and letting
 * the student press a button and wait three minutes to find out. It is a warning
 * rather than a hard stop: the command remains available, because the readiness
 * check reads this machine and the student knows things it does not.
 */
function BlockerNotice({ blockers }: { blockers: string[] }) {
  return (
    <div className="fade border-warn/25 bg-[color:var(--status-warn)]/[0.06] mt-4 rounded-[12px] border px-4 py-3.5">
      <div className="text-[color:var(--text-primary)] text-[13px] font-medium">安装前需要处理的问题</div>
      <ul className="text-[color:var(--text-secondary)] mt-1.5 flex flex-col gap-1 text-[12.5px] leading-relaxed">
        {blockers.map((b) => (
          <li key={b}>· {b}</li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10">
      <p className="text-[color:var(--text-tertiary)] text-[14px]">还没有生成安装方案</p>
      <Button variant="ghost" className="mt-4" onClick={onBack}>
        返回选择方案
      </Button>
    </div>
  );
}
