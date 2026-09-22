/**
 * Screen 5 — Bootstrap.
 *
 * The brief asks for a page that is *not* a traditional installer: no progress
 * bar, no wall of cards, no gradient. So the design is one thing, done well:
 *
 * ```
 *   正在初始化
 *
 *   ✓  VS Code 环境      4 项插件
 *   ✓  Git 配置          3 项设置
 *   ○  MCP 配置          1 个服务器
 *   ○  Skills
 *   ○  语言设置
 * ```
 *
 * That is the whole screen. The stage list *is* the progress: a stage is either
 * done, working, or waiting, and the student can read the state of five things at
 * a glance without a percentage. A bar would be a worse answer to the same
 * question — it cannot show that one stage was skipped and another blocked.
 *
 * What the screen deliberately does not do
 * ----------------------------------------
 * * **No timer-driven progress.** Every status comes from the session the engine
 *   returned. A progress indicator that advances on a clock is the lie this whole
 *   screen is built to avoid.
 * * **No auto-advance.** The run is started by the student's click on the previous
 *   screen and the result stays until they leave. A screen that navigates itself
 *   takes away the one moment where something might have gone wrong.
 * * **No log.** The per-step detail is behind "详细信息", collapsed. A student
 *   cannot read `code --install-extension` output and a wall of it implies
 *   something is broken.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Button, SectionLabel } from "../components/ui";
import { BackButton } from "../components/BackButton";
import { selectedProfile, useApp } from "../lib/store";
import type {
  BootstrapSessionView,
  BootstrapStageView,
  BootstrapStepView,
  Confidence,
  StepStatus,
} from "../lib/types";

export function BootstrapScreen() {
  const plan = useApp((s) => s.bootstrapPlan);
  const session = useApp((s) => s.bootstrapSession);
  const profile = useApp(selectedProfile);
  const bootstrapping = useApp((s) => s.bootstrapping);
  const error = useApp((s) => s.bootstrapError);
  const canResume = useApp((s) => s.canResumeBootstrap);
  const localizationTargets = useApp((s) => s.localizationTargets);
  const goTo = useApp((s) => s.goTo);
  const startBootstrap = useApp((s) => s.startBootstrap);
  const cancelBootstrap = useApp((s) => s.cancelBootstrap);
  const recheckBootstrap = useApp((s) => s.recheckBootstrap);

  const [detail, setDetail] = useState(false);
  const [, tick] = useState(0);
  // The profile this component has already started the engine for. Keyed on the
  // profile id rather than a boolean, so switching profiles and coming back
  // re-runs rather than showing the previous profile's result beside the new
  // profile's steps.
  const startedRef = useRef<string | null>(null);

  // A one-second tick purely so the elapsed clock moves. It touches no status.
  useEffect(() => {
    if (!bootstrapping) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [bootstrapping]);

  // Start once per profile, on arrival.
  //
  // The bootstrap runs automatically because that is the brief's flow — the
  // student chose a profile and pressed 开始配置; this screen is the execution of
  // that decision, not a second confirmation. What it must *not* do is re-run
  // when the student comes back from the report to look at something.
  useEffect(() => {
    if (!plan || bootstrapping) return;
    if (startedRef.current === plan.profileId) return;
    // A finished session for this same profile means the work is done; re-running
    // would be the "install twice" failure the install screen also guards against.
    if (session?.profileId === plan.profileId && session.finishedAt) {
      startedRef.current = plan.profileId;
      return;
    }
    startedRef.current = plan.profileId;
    void startBootstrap();
  }, [plan, bootstrapping, session, startBootstrap]);

  const stageState = useMemo(
    () => buildStageState(plan?.stages ?? [], session),
    [plan, session],
  );

  if (!plan || !profile) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-10">
        <p className="text-[color:var(--text-tertiary)] text-[14px]">还没有生成配置方案</p>
        <BackButton className="mt-4" label="返回选择方案" />
      </div>
    );
  }

  const finished = session !== null && !bootstrapping;
  const failed = session?.failedSteps.length ?? 0;
  const verification = session?.verification ?? null;
  const allDone = stageState.every((s) => s.kind === "done");

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <header className="fade flex shrink-0 items-start justify-between">
        <div>
          <h2 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
            {bootstrapping
              ? "正在初始化"
              : finished
                ? failed > 0
                  ? "初始化完成，部分项目需要处理"
                  : "初始化完成"
                : "准备初始化"}
          </h2>
          <p className="text-[color:var(--text-quiet)] mt-1 text-[13px]">
            {profile.name}
            {bootstrapping && <span className="tnum"> · {elapsedLabel(session, true)}</span>}
            {finished && verification && (
              <span className="tnum"> · {verification.summary}</span>
            )}
          </p>
        </div>

        <button
          onClick={() => setDetail((v) => !v)}
          className={clsx(
            "rounded-[8px] px-2.5 py-1.5 text-[12px] transition-colors duration-150",
            detail
              ? "bg-[color:var(--surface-hover)] text-[color:var(--text-primary)]"
              : "text-[color:var(--text-quiet)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--surface-hover)]",
          )}
        >
          {detail ? "隐藏详细信息" : "详细信息"}
        </button>
      </header>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
        {error && <ErrorStrip message={error} />}
        {session?.haltedReason && <HaltStrip reason={session.haltedReason} />}

        {/* The stage list. This is the screen. */}
        <div className="stagger flex flex-col">
          {stageState.map((state) => (
            <StageRow
              key={state.stage.key}
              state={state}
              steps={plan.steps.filter((s) => s.stage === state.stage.key)}
              session={session}
              showDetail={detail}
            />
          ))}
        </div>

        {allDone && finished && (
          <p className="text-[color:var(--text-quiet)] fade mt-7 text-[12.5px] leading-relaxed">
            环境已就绪。重新打开 VS Code 与终端后，配置与语言设置才会完全生效。
          </p>
        )}

        {!allDone && !bootstrapping && finished && canResume && (
          <div className="mt-7">
            <Button variant="ghost" onClick={() => void startBootstrap()}>
              继续（还剩 {session?.remaining.length ?? 0} 项）
            </Button>
          </div>
        )}

        {detail && <StepDetail plan={plan.steps} session={session} />}

        {detail && localizationTargets.length > 0 && (
          <div className="mt-7">
            <SectionLabel>汉化来源</SectionLabel>
            <div className="flex flex-col gap-1.5">
              {localizationTargets.map((t) => (
                <div key={t.id} className="text-[12.5px]">
                  <span className="text-[color:var(--text-secondary)]">{t.target}</span>
                  <span className="text-[color:var(--text-quiet)]"> · {t.method} · </span>
                  <span className="text-[color:var(--text-quiet)] selectable font-mono text-[11.5px]">
                    {t.upstream.replace(/^https:\/\//, "")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {detail && plan.notAttempted.length > 0 && (
          <div className="mt-6">
            <SectionLabel>本次未做</SectionLabel>
            <ul className="flex flex-col gap-1.5">
              {plan.notAttempted.map((item) => (
                <li key={item} className="text-[color:var(--text-quiet)] text-[12.5px] leading-relaxed">
                  · {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="fade mt-6 flex shrink-0 items-center justify-between border-t border-[color:var(--line-subtle)] pt-5">
        <div className="flex items-center gap-2">
          <BackButton disabled={bootstrapping} label="返回安装" />
          {bootstrapping && (
            <Button variant="ghost" onClick={() => void cancelBootstrap()}>
              取消
            </Button>
          )}
          {!bootstrapping && finished && (
            <Button variant="ghost" onClick={() => void recheckBootstrap()}>
              重新检查
            </Button>
          )}
        </div>

        <Button
          disabled={bootstrapping}
          onClick={() => {
            void useApp.getState().prepareFinish();
            goTo("done");
          }}
        >
          {bootstrapping ? "初始化进行中…" : "查看结果"}
        </Button>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage state
// ---------------------------------------------------------------------------

type StageKind = "done" | "working" | "waiting" | "blocked" | "skipped";

interface StageState {
  stage: BootstrapStageView;
  kind: StageKind;
  /** One short line, e.g. `4 项插件 · 1 项待安装`. */
  detail: string;
}

/**
 * Derives each stage's state from the session, falling back to the plan.
 *
 * The ordering is the important part: **the session wins over the plan**. The
 * plan is a prediction made from a pre-run probe, so rendering it first would
 * show a stage as "waiting" after it had run, or as "done" after the run failed.
 * That is the one way this screen could lie, and it is the same rule the install
 * screen follows.
 */
function buildStageState(
  stages: BootstrapStageView[],
  session: BootstrapSessionView | null,
): StageState[] {
  return stages.map((stage) => {
    const results = session?.steps.filter((s) => s.stage === stage.key) ?? [];

    // Nothing planned for this stage: say so rather than showing an empty row
    // that looks like a failure.
    if (stage.total === 0) {
      return { stage, kind: "skipped" as StageKind, detail: "本方案未包含" };
    }

    if (stage.blocked > 0 && results.length === 0) {
      return {
        stage,
        kind: "blocked" as StageKind,
        detail: `${stage.blocked} 项无法执行`,
      };
    }

    if (results.length === 0) {
      return {
        stage,
        kind: "waiting" as StageKind,
        detail: `${stage.needed} 项待处理`,
      };
    }

    const failed = results.filter((s) => s.status === "failed").length;
    const running = results.filter((s) => s.status === "running").length;
    const done = results.filter(
      (s) => s.status === "succeeded" || s.status === "skipped",
    ).length;

    if (running > 0) {
      return {
        stage,
        kind: "working" as StageKind,
        detail: results.find((s) => s.status === "running")?.stageLabel ?? "处理中",
      };
    }
    if (failed > 0) {
      return {
        stage,
        kind: "blocked" as StageKind,
        detail: `${failed} 项失败`,
      };
    }
    if (done === results.length && results.length > 0) {
      // `skipped` covers both "already done" and "nothing to do"; saying which
      // matters, because a student who is told "已完成" for a stage that did
      // nothing will not understand why the setting is unchanged.
      const changed = results.filter((s) => s.status === "succeeded").length;
      return {
        stage,
        kind: "done" as StageKind,
        detail: changed === 0 ? "已是最新，无需修改" : `${changed} 项已应用`,
      };
    }
    return {
      stage,
      kind: "waiting" as StageKind,
      detail: `${done} / ${results.length} 项`,
    };
  });
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function StageRow({
  state,
  steps,
  session,
  showDetail,
}: {
  state: StageState;
  steps: BootstrapStepView[];
  session: BootstrapSessionView | null;
  showDetail: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-[color:var(--line-subtle)] last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-3.5 py-3 text-left"
        aria-expanded={open}
      >
        <StageGlyph kind={state.kind} />

        <span
          className={clsx(
            "text-[14.5px] transition-colors duration-200",
            state.kind === "waiting" || state.kind === "skipped"
              ? "text-[color:var(--text-tertiary)]"
              : "text-[color:var(--text-primary)]",
          )}
        >
          {state.stage.name}
        </span>

        <span
          className={clsx(
            "tnum ml-auto text-[12px] transition-colors duration-200",
            state.kind === "blocked"
              ? "text-[color:var(--status-bad)]/90"
              : state.kind === "working"
                ? "text-[color:var(--status-accent)]"
                : "text-[color:var(--text-quiet)]",
          )}
        >
          {state.detail}
        </span>

        <span className="text-[color:var(--text-quiet)] group-hover:text-[color:var(--text-tertiary)] w-3 shrink-0 text-[11px] transition-colors">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="fade pb-3.5 pl-[26px]">
          <div className="flex flex-col gap-2">
            {steps.map((step) => {
              const result = session?.steps.find((s) => s.actionId === step.actionId);
              // The session is authoritative once a run has happened; the plan's
              // flags are only a fallback for the moment before the engine
              // reports. Rendering the plan first would show "待处理" for a step
              // that has already run.
              const status: StepStatus | null = result?.status ?? null;
              return (
                <div key={step.actionId} className="flex items-start gap-3">
                  <StepGlyph status={status} step={step} />
                  <div className="min-w-0 flex-1">
                    <div
                      className={clsx(
                        "text-[12.5px]",
                        status === "failed" ? "text-[color:var(--status-bad)]/90" : "text-[color:var(--text-secondary)]",
                      )}
                    >
                      {step.name}
                    </div>
                    <div className="text-[color:var(--text-quiet)] mt-0.5 text-[11.5px] leading-relaxed">
                      {result?.detail ?? step.blocked ?? step.skipReason ?? step.rationale}
                    </div>
                    {showDetail && step.target && (
                      <div className="text-[color:var(--text-quiet)] selectable mt-0.5 font-mono text-[11px] break-all">
                        {step.target}
                      </div>
                    )}
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 text-[11.5px] tabular-nums",
                      statusTone(status, step),
                    )}
                  >
                    {statusLabel(status, step)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** The ✓ / ● / ○ glyph. Shape carries the meaning, so it survives greyscale. */
function StageGlyph({ kind }: { kind: StageKind }) {
  if (kind === "done") {
    return (
      <span className="text-[color:var(--status-ok)] flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <svg viewBox="0 0 18 18" className="h-[15px] w-[15px]" fill="none">
          <path
            d="M3.4 9.4l3.5 3.5L14.6 5.6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (kind === "working") {
    // A pulsing ring, not a spinner: it reads as "this one is live" without
    // implying a determinate amount of remaining work.
    return (
      <span className="text-[color:var(--status-accent)] flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <svg viewBox="0 0 18 18" className="h-[15px] w-[15px]" fill="none">
          <circle
            cx="9"
            cy="9"
            r="6"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="4 4"
            className="motion-safe:animate-[spin_1.4s_linear_infinite]"
            style={{ transformOrigin: "center" }}
          />
        </svg>
      </span>
    );
  }

  if (kind === "blocked") {
    return (
      <span className="text-[color:var(--status-bad)] flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <svg viewBox="0 0 18 18" className="h-[15px] w-[15px]" fill="none">
          <circle cx="9" cy="9" r="6.2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9 5.6v4.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <circle cx="9" cy="12.2" r="1" fill="currentColor" />
        </svg>
      </span>
    );
  }

  // `waiting` and `skipped` share the hollow circle: both mean "nothing happened
  // here", and the row's text distinguishes them.
  return (
    <span className="text-[color:var(--text-quiet)] flex h-[18px] w-[18px] shrink-0 items-center justify-center">
      <svg viewBox="0 0 18 18" className="h-[15px] w-[15px]" fill="none">
        <circle cx="9" cy="9" r="6.2" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    </span>
  );
}

function StepGlyph({
  status,
  step,
}: {
  status: StepStatus | null;
  step: BootstrapStepView;
}) {
  const tone =
    status === "failed" || (status === null && step.blocked)
      ? "text-[color:var(--status-bad)]"
      : status === "succeeded"
        ? "text-[color:var(--status-ok)]"
        : status === "running"
          ? "text-[color:var(--status-accent)]"
          : "text-[color:var(--text-quiet)]";

  const glyph =
    status === "failed" || (status === null && step.blocked)
      ? "✕"
      : status === "succeeded"
        ? "✓"
        : status === "running"
          ? "●"
          : "○";

  return (
    <span className={clsx("w-3 shrink-0 pt-[2px] text-center text-[12px]", tone)}>
      {glyph}
    </span>
  );
}

function statusLabel(status: StepStatus | null, step: BootstrapStepView): string {
  if (status === null) {
    if (step.blocked) return "无法执行";
    if (!step.needed) return "无需操作";
    return "待处理";
  }
  switch (status) {
    case "pending":
      return "待处理";
    case "running":
      return "进行中";
    case "succeeded":
      return "完成";
    case "succeededWithWarning":
      return "有提示";
    case "failed":
      return "失败";
    case "skipped":
      return "无需操作";
    case "cancelled":
      return "已取消";
  }
}

function statusTone(status: StepStatus | null, step: BootstrapStepView): string {
  if (status === null) {
    return step.blocked ? "text-[color:var(--status-bad)]/90" : "text-[color:var(--text-quiet)]";
  }
  switch (status) {
    case "failed":
      return "text-[color:var(--status-bad)]/90";
    case "succeeded":
      return "text-[color:var(--status-ok)]/90";
    case "running":
      return "text-[color:var(--status-accent)]";
    case "succeededWithWarning":
      return "text-[color:var(--status-warn)]/90";
    default:
      return "text-[color:var(--text-quiet)]";
  }
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

/**
 * The post-run verification, one line per check.
 *
 * This is the brief's "生成环境报告" in miniature: not a claim about what the run
 * did, but what the machine looks like now. A check that could not be answered is
 * shown as "无法确认" rather than as a failure.
 */
function StepDetail({
  plan,
  session,
}: {
  plan: BootstrapStepView[];
  session: BootstrapSessionView | null;
}) {
  const verification = session?.verification;
  if (!verification || verification.checks.length === 0) return null;

  return (
    <div className="mt-7">
      <SectionLabel>
        验证结果 · 通过 {verification.passed}
        {verification.failed > 0 && ` · 失败 ${verification.failed}`}
        {verification.unknown > 0 && ` · 无法确认 ${verification.unknown}`}
      </SectionLabel>
      <div className="flex flex-col gap-1.5">
        {verification.checks.map((check) => (
          <div key={check.key} className="flex items-start gap-3">
            <ConfidenceGlyph confidence={check.confidence} />
            <div className="min-w-0 flex-1">
              <div
                className={clsx(
                  "text-[12.5px]",
                  check.confidence === "fail" ? "text-[color:var(--status-bad)]/90" : "text-[color:var(--text-secondary)]",
                )}
              >
                {check.label}
              </div>
              <div className="text-[color:var(--text-quiet)] mt-0.5 text-[11.5px]">{check.observed}</div>
              {check.hint && (
                <div className="text-[color:var(--status-warn)]/80 mt-0.5 text-[11.5px]">{check.hint}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* Every planned step, so the panel is a complete record rather than only
          the parts that were verified. */}
      {plan.length > 0 && (
        <p className="text-[color:var(--text-quiet)] mt-3 text-[11.5px]">
          共 {plan.length} 个配置步骤，其中 {plan.filter((s) => s.needed).length} 个需要执行。
        </p>
      )}
    </div>
  );
}

function ConfidenceGlyph({ confidence }: { confidence: Confidence }) {
  const map: Record<Confidence, { glyph: string; tone: string }> = {
    ok: { glyph: "✓", tone: "text-[color:var(--status-ok)]" },
    fail: { glyph: "✕", tone: "text-[color:var(--status-bad)]" },
    unknown: { glyph: "?", tone: "text-[color:var(--status-warn)]" },
    skipped: { glyph: "–", tone: "text-[color:var(--text-quiet)]" },
  };
  const { glyph, tone } = map[confidence];
  return (
    <span className={clsx("w-3 shrink-0 pt-[2px] text-center text-[12px]", tone)}>
      {glyph}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Strips
// ---------------------------------------------------------------------------

function ErrorStrip({ message }: { message: string }) {
  return (
    <div className="fade border-bad/25 bg-[color:var(--status-bad)]/[0.06] mb-5 rounded-[12px] border px-4 py-3.5">
      <div className="text-[color:var(--text-primary)] text-[13px] font-medium">配置未能开始</div>
      <p className="text-[color:var(--text-secondary)] mt-1 text-[12.5px] leading-relaxed">{message}</p>
    </div>
  );
}

function HaltStrip({ reason }: { reason: string }) {
  return (
    <div className="fade border-warn/25 bg-[color:var(--status-warn)]/[0.06] mb-5 rounded-[12px] border px-4 py-3.5">
      <div className="text-[color:var(--text-primary)] text-[13px] font-medium">初始化已暂停</div>
      <p className="text-[color:var(--text-secondary)] mt-1 text-[12.5px] leading-relaxed">{reason}</p>
    </div>
  );
}

/** "已用时 1 分 12 秒", from the session's own timestamps. */
function elapsedLabel(
  session: BootstrapSessionView | null,
  running: boolean,
): string {
  if (!session) return "正在准备…";
  const start = Date.parse(session.startedAt);
  if (Number.isNaN(start)) return "";
  const end = session.finishedAt ? Date.parse(session.finishedAt) : Date.now();
  if (Number.isNaN(end)) return "";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  const label =
    seconds < 60
      ? `${seconds} 秒`
      : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return running ? `已用时 ${label}` : `用时 ${label}`;
}
