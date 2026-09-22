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
 *
 * ## Phase 7: the flow no longer starts itself
 *
 * This screen used to run the whole plan the moment it mounted, which made the
 * install a corridor rather than a decision: a student who wanted Git but not
 * Docker had no way to say so and no way to find out until something failed.
 *
 * It now opens in a **choose** phase — every step listed with a checkbox and its
 * real current state — and only becomes the running view once the student commits.
 * Two consequences worth stating:
 *
 * * Unchecking a program is a *frontend* narrowing of the plan, not a new engine
 *   feature. `install::execute_steps` iterates `plan.steps` and takes `total`
 *   from it, so the run, its session and its report all describe exactly what was
 *   asked for. See `startInstall` in the store.
 * * A step that is already satisfied is shown as 已安装 and cannot be selected —
 *   re-installing something present is the one action that could damage a working
 *   machine.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Button, SectionLabel } from "../components/ui";
import { BackButton } from "../components/BackButton";
import { StatusBadge } from "../components/StatusBadge";
import { SoftwareIcon } from "../components/SoftwareIcon";
import { ProHint } from "../components/ProGate";
import { describeSoftware } from "../lib/software";
import * as ipc from "../lib/ipc";
import { selectedProfile, useApp } from "../lib/store";
import type {
  AttemptOutcome,
  InstallFailureKind,
  InstallFailureView,
  InstallPhase,
  InstallPlan,
  PostInstallReport,
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
  const chosenSteps = useApp((s) => s.chosenSteps);
  const setChosenSteps = useApp((s) => s.setChosenSteps);
  const goTo = useApp((s) => s.goTo);
  const startInstall = useApp((s) => s.startInstall);
  const resumeInstall = useApp((s) => s.resumeInstall);
  const cancelInstall = useApp((s) => s.cancelInstall);
  const buildPlan = useApp((s) => s.buildPlan);

  const [advanced, setAdvanced] = useState(false);
  const [, forceTick] = useState(0);
  // Whether the "back during install" dialog is open. Local rather than in the
  // store: it is a transient question asked of this screen, and putting it in
  // the store would make it survive a navigation it should not survive.
  const [backDialog, setBackDialog] = useState(false);
  // The post-install verification, run when a session finishes. Held locally
  // because it describes *this* screen's run, and the store's `verification`
  // belongs to the report screen (a different question, asked later).
  const [postCheck, setPostCheck] = useState<PostInstallReport | null>(null);
  // The profile id of the plan this component has already started the engine
  // for. `null` means "nothing started by this mount".
  const startedRef = useRef<string | null>(null);
  // Guards the build-on-arrival below so a failed build cannot retry every render.
  const autoBuildRef = useRef(false);

  // A one-second tick while installing, purely so the elapsed clock moves. It
  // deliberately does not touch any status: progress comes from the session, and
  // a fake progress bar that advances on a timer is exactly the lie this screen
  // is built to avoid.
  useEffect(() => {
    if (!installing) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [installing]);

  // Post-install verification, once a run has finished.
  //
  // The brief is explicit that the installer's exit code is not evidence: a
  // command can exit 0 having left nothing usable behind. `verify_install_result`
  // re-probes the machine through the same inventory the software list uses, so
  // the verdict is about the machine rather than about what the command claimed.
  //
  // Keyed on the session id so it runs once per run and not on every render, and
  // skipped for a cancelled run: telling a student who deliberately stopped that
  // their programs "were not detected" would be reporting their own decision back
  // to them as a fault.
  const verifiedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (installing || !session || !plan) return;
    if (session.cancelledByUser) return;
    if (verifiedSessionRef.current === session.id) return;
    verifiedSessionRef.current = session.id;

    let cancelled = false;
    void ipc
      .verifyInstallResult(plan)
      .then((report) => {
        if (!cancelled) setPostCheck(report);
      })
      .catch(() => {
        // A verification that could not run must not masquerade as a pass. The
        // install result itself is already on screen; leaving this null means the
        // checklist simply does not appear, rather than showing a green tick the
        // app did not earn.
        if (!cancelled) setPostCheck(null);
      });

    return () => {
      cancelled = true;
    };
  }, [installing, session, plan]);

  const runnable = useMemo(
    () => plan?.steps.filter((s) => !s.satisfied) ?? [],
    [plan],
  );

  // The choose phase holds until the student commits *in this mount*.
  //
  // Gating on `committed` alone rather than on `session === null` is deliberate.
  // A previous run leaves a session in the store, and treating that as "already
  // decided" meant a student who went back to change their mind landed on the old
  // run's result with no way to start another one — the corridor this phase
  // exists to remove. Re-entering re-asks, which is what going back means.
  //
  // `installing` still wins: a run in flight is not a decision to re-open.
  const [committed, setCommitted] = useState(false);
  const choosing = !committed && !installing;

  // The engine is started by the student's click, not by mount. `startedRef`
  // still guards against React's development double-invoke firing two runs —
  // for an installer that means two winget processes over one package.
  const begin = () => {
    if (!plan || installing) return;
    if (startedRef.current === plan.profileId) return;
    startedRef.current = plan.profileId;
    setCommitted(true);
    void startInstall();
  };

  // No plan yet, but a profile *is* selected: recoverable, not an error.
  //
  // Reachable in practice from `Software.tsx`'s per-item action buttons, which
  // `goTo("install")` directly. `selectProfile` deliberately nulls `plan` — a plan
  // belongs to one profile, and keeping it would let a screen render one profile's
  // steps beside another's result — so arriving here with a selected profile and
  // no plan is a normal state on that route, not corruption.
  //
  // Building it here rather than bouncing the student back is the honest fix: the
  // screen they asked for is one read away, and the brief's point is that a
  // beginner must not be handed a dead end. `buildPlan` installs nothing; the run
  // still needs an explicit 开始安装.
  //
  // Guarded by a ref, not state: this runs during render, and a `setState` here
  // would loop. The ref also keeps a *failed* build from retrying forever.
  if (!plan && profile && !autoBuildRef.current) {
    autoBuildRef.current = true;
    void buildPlan();
  }

  if (!plan || !profile) {
    return <EmptyState canRecover={profile !== null} />;
  }

  // Phase 7: the screen opens on a decision rather than on a running engine.
  // Rendered before any of the progress machinery below, because none of it
  // means anything until a run exists.
  if (choosing) {
    return (
      <ChoosePhase
        plan={plan}
        profileName={profile.name}
        catalogue={catalogue}
        chosen={chosenSteps}
        onChoose={setChosenSteps}
        blockers={readiness && !readiness.canStart ? readiness.blockers : null}
        onStart={begin}
        onSkip={() => goTo("bootstrap")}
      />
    );
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
  const halted = session?.haltedReason ?? null;

  // The run's visible state. Derived from what is actually known, never from a
  // timer — see the note on the tick effect above.
  const phase: InstallPhase = derivePhase({
    installing,
    session,
    executionError,
    halted,
  });

  // The step whose command is running, for the cancel/error panel.
  const runningStep = steps.find((s) => s.status === "running") ?? null;
  const failureView = buildFailureView({
    phase,
    session,
    runningStep,
    executionError,
    halted,
  });

  return (
    <div
      className="flex h-full flex-col px-10 py-8"
      // One stable hook for every state, so a test asserts the phase without
      // matching on translated text. `data-running` is separate from `phase`
      // because "is work still happening" is what the back dialog's promise
      // ("返回不会停止安装") depends on, and it must be assertable on its own.
      data-testid="install-phase"
      data-phase={phase}
      data-running={installing ? "true" : "false"}
    >
      <header className="fade flex shrink-0 items-start justify-between">
        <div>
          <h2 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
            {phaseTitle(phase)}
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
        {/* The failure panel replaces the bare `executionError` strip whenever the
            run itself stopped for a reason it can name. It carries the command,
            the output so far and a suggestion, which the strip could not — the
            old `已取消` badge told the student nothing about what to do next. */}
        {failureView ? (
          <FailurePanel
            view={failureView}
            // A retry is offered only when there is genuinely work left. A
            // cancelled run still has `remaining` steps and `canResume` is
            // suppressed for it by the store, so this reads the same signal the
            // footer uses rather than inventing a second rule.
            canRetry={canResume && failureView.kind !== "cancelled"}
            remainingCount={session?.remaining.length ?? 0}
            retrying={installing}
            onRetry={() => void resumeInstall()}
          />
        ) : (
          executionError && <ErrorNotice message={executionError} />
        )}
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

        {/* The post-install check. Shown only once a run has actually finished,
            because before that there is nothing to verify and an empty
            "checking…" list would imply work that is not happening. */}
        {postCheck && !installing && <VerificationList report={postCheck} />}

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
          {/* During a run, back opens the dialog instead of navigating. Outside a
              run it is the ordinary history-driven control, so nothing about the
              non-installing case changed.

              Why a replacement rather than a disabled button: `disabled` during
              a run is audit §6 gap 4 — the control cannot open the
              "继续后台安装 / 取消安装并返回" dialog, so the dialog would be
              unreachable exactly when it is needed. This is the
              `install-engineer`-owned interceptor signposted at line 299.

              Why not `onClick` on `<BackButton>`: `BackButton` takes no veto
              hook, routing owns that component, and the captain ruled that
              duplicating one control here is cheaper than reopening a completed
              task or ping-ponging a shared file. */}
          {installing ? (
            <Button variant="quiet" onClick={() => setBackDialog(true)}>
              返回
            </Button>
          ) : (
            <BackButton />
          )}
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

      {backDialog && (
        <BackDuringInstallDialog
          stepName={runningStep?.name ?? null}
          // Dismissing the dialog leaves the run exactly as it was. This is the
          // honest half of the promise: nothing is cancelled, nothing is
          // paused, and the store's `installing` flag was never touched.
          onContinue={() => setBackDialog(false)}
          onCancelAndLeave={() => {
            setBackDialog(false);
            // Cancel first, then leave — in that order, so the engine is
            // already stopping when the screen changes. `cancel_install` is
            // cooperative and returns immediately, so this does not block the
            // navigation.
            void cancelInstall().then(() => {
              useApp.getState().goBack();
            });
          }}
        />
      )}
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

/**
 * The choose phase: what will be installed, before anything runs.
 *
 * ## The three states a row can be in, and why they are not two
 *
 * * **已安装** — the pre-run scan found it. Not selectable, and it is not a
 *   checkbox at all: re-installing something present is the one action here that
 *   could damage a working machine, so it must not look like an option.
 * * **选中的** — will run.
 * * **未选中的** — will not run, and the reason is shown as the student's own
 *   choice rather than as an omission.
 *
 * ## Why the totals are stated as a sentence
 *
 * "已选 3 项 · 预计 2 分钟" is the information a student needs to decide whether
 * to uncheck more. A bare count of checkboxes does not answer "how long will this
 * take me", which is the actual cost of saying yes.
 */
function ChoosePhase({
  plan,
  profileName,
  catalogue,
  chosen,
  onChoose,
  blockers,
  onStart,
  onSkip,
}: {
  plan: InstallPlan;
  profileName: string;
  catalogue: SoftwareDescriptor[];
  /** `null` means "everything runnable", which is also the initial state. */
  chosen: Set<SoftwareId> | null;
  onChoose: (ids: SoftwareId[] | null) => void;
  blockers: string[] | null;
  onStart: () => void;
  /** Advances when there is genuinely nothing to install. */
  onSkip: () => void;
}) {
  const runnable = plan.steps.filter((s) => !s.satisfied);
  const satisfied = plan.steps.filter((s) => s.satisfied);

  // `null` is presented as "all runnable steps selected" rather than as a third
  // visual state, because "no opinion" and "I want all of them" produce the same
  // run and the checkbox must show the truth about what will happen.
  const selected = new Set(runnable.filter((s) => chosen === null || chosen.has(s.id)).map((s) => s.id));

  const toggle = (id: SoftwareId) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Collapsing back to `null` when every runnable step is selected keeps the
    // store's invariant: `null` always means "the whole plan", so a later plan
    // rebuild cannot leave the selection describing a set that no longer matches.
    onChoose(next.size === runnable.length ? null : [...next]);
  };

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <header className="fade shrink-0">
        <h2 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          {runnable.length === 0 ? "这次没有需要安装的" : "这次要装哪些"}
        </h2>
        <p className="text-[color:var(--text-quiet)] mt-1 text-[13px]">
          {runnable.length === 0 ? (
            `${profileName} 需要的程序都已经在这台电脑上了。`
          ) : (
            <>
              {profileName} · 已选 {selected.size} 项
              {plan.estimatedMinutes > 0 && ` · 预计 ${plan.estimatedMinutes} 分钟`}
              。不想装的可以取消勾选，之后随时可以再来装。
            </>
          )}
        </p>
      </header>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
        {blockers && blockers.length > 0 && <BlockerNotice blockers={blockers} />}

        {/* A profile whose programs are all present must not present an empty
            checklist with a disabled button — that reads as a broken screen.
            The honest state is "nothing to do here", which is what it says. */}
        {runnable.length === 0 && (
          <div className="glass-soft rounded-[12px] px-4 py-3">
            <p className="text-[color:var(--text-tertiary)] text-[12.5px] leading-relaxed">
              可以直接进入下一步，本工具会检查并配置这些程序的设置。
            </p>
          </div>
        )}

        <div className="stagger flex flex-col gap-1.5">
          {runnable.map((step) => {
            const on = selected.has(step.id);
            const meta = describeSoftware(step.id, catalogue);
            return (
              <label
                key={step.id}
                className={clsx(
                  "flex cursor-pointer items-center gap-3.5 rounded-[10px] border px-3.5 py-2.5 transition-colors duration-150",
                  on
                    ? "border-[color:var(--line-default)] bg-[color:var(--surface-inset)]"
                    : "border-[color:var(--line-subtle)]/70",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(step.id)}
                  className="accent-[color:var(--accent)] h-4 w-4 shrink-0"
                  aria-label={`安装 ${meta.name}`}
                />
                <SoftwareIcon id={step.id} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="text-[color:var(--text-primary)] block text-[13.5px]">
                    {meta.name}
                  </span>
                  <span className="text-[color:var(--text-quiet)] block truncate text-[12px]">
                    {meta.purpose}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {satisfied.length > 0 && (
          <div className="mt-6">
            <SectionLabel>已经装好 · {satisfied.length}</SectionLabel>
            <div className="flex flex-col gap-1.5">
              {satisfied.map((step) => (
                <div
                  key={step.id}
                  className="border-[color:var(--line-subtle)]/50 flex items-center gap-3.5 rounded-[10px] border border-dashed px-3.5 py-2.5"
                >
                  <SoftwareIcon id={step.id} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="text-[color:var(--text-secondary)] block text-[13.5px]">
                      {describeSoftware(step.id, catalogue).name}
                    </span>
                    <span className="text-[color:var(--text-quiet)] block text-[12px]">
                      不需要再装一次
                    </span>
                  </span>
                  <StatusBadge confidence="ok" size="sm" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <footer className="fade mt-6 flex shrink-0 items-center justify-between border-t border-[color:var(--line-subtle)] pt-5">
        <BackButton />
        {runnable.length === 0 ? (
          // Skipping the run is not the same as faking one: no session is
          // created, so nothing later can report an install that never happened.
          <Button onClick={onSkip}>下一步</Button>
        ) : (
          <div className="flex items-center gap-3">
            {selected.size === 0 && (
              <span className="text-[color:var(--text-quiet)] text-[12px]">
                至少选一项才能开始
              </span>
            )}
            <Button disabled={selected.size === 0} onClick={onStart}>
              {selected.size === runnable.length
                ? `开始安装（${selected.size} 项）`
                : `安装选中的 ${selected.size} 项`}
            </Button>
          </div>
        )}
      </footer>

      {/* The brief's weak hint: "需要自动安装功能？联系作者获取专业版". Placed
          *below* the button rather than above it, and below the fold of the
          decision — the customer reads it only after looking at what they were
          about to click. It renders nothing once activated, so it needs no
          conditional at this call site. */}
      <ProHint className="mt-2.5 shrink-0 text-right" />
    </div>
  );
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

      {/* The bar answers "how far along is this", and it must not pretend.
          `StepProgress.fraction` is real but it is *attempt-index* progress
          across a fallback chain (`install.rs:451` → `attempt/(len+1)`, then
          `1.0` at `:471`), so on the common single-link chain it is 0.0 for the
          whole step and then jumps to 1.0. Rendering that as a percentage would
          be a boolean dressed as a measurement — the lie this screen exists to
          avoid. So a number is shown only when the chain genuinely has more than
          one link; otherwise the bar is indeterminate and the honest progress
          signal is the completed-step counter above. */}
      <ProgressBar step={step} installing={installing} done={done} total={total} />

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

/**
 * Shown when there is no plan to render.
 *
 * Two different situations land here, and saying the same thing to both was part
 * of what made this feel like a dead end:
 *
 * * **A profile is selected** — the plan is being (re)built right now, so the
 *   honest message is "正在生成安装方案", and the student should wait a moment.
 *   The build is triggered by the caller.
 * * **No profile at all** — nothing can be planned until the student picks a
 *   direction, so the screen says that and offers the way to do it.
 *
 * The back control is `BackButton`, which is history-driven, so it returns
 * wherever the student actually came from rather than to a hardcoded screen.
 */
function EmptyState({ canRecover }: { canRecover: boolean }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center px-10"
      data-testid="install-empty"
      data-recoverable={canRecover ? "true" : "false"}
    >
      <p className="text-[color:var(--text-tertiary)] text-[14px]">
        {canRecover ? "正在生成安装方案…" : "还没有生成安装方案"}
      </p>
      {!canRecover && (
        <p className="text-[color:var(--text-quiet)] mt-1.5 text-[12.5px]">
          请先选择一个配置方案，再回来安装。
        </p>
      )}
      <BackButton className="mt-4" label="返回上一步" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The install state machine
// ---------------------------------------------------------------------------

/**
 * Which state the run is in, from what is actually known.
 *
 * `Idle → Preparing → Downloading → Installing → Verifying → Completed`, plus
 * `Failed` and `Cancelled`.
 *
 * The stages are derived from the session rather than tracked in a second piece
 * of React state. That is deliberate: a mirrored copy of Rust's progress would
 * be a second source of truth, and the two would disagree exactly when it
 * mattered — after a cancelled run, or when a session is restored from a
 * previous launch. Deriving means the screen cannot show a phase the session
 * does not support.
 *
 * `cancelled` is checked before `failed`: a run the student stopped has failed
 * steps in it by construction (the unattempted ones are marked `cancelled`, and
 * an in-flight step can also end non-zero), so treating `failed_steps` as
 * authoritative would report a deliberate stop as a malfunction. That inversion
 * is the whole reason the brief insists cancel show the *correct* reason.
 */
function derivePhase({
  installing,
  session,
  executionError,
  halted,
}: {
  installing: boolean;
  session: ReturnType<typeof useApp.getState>["session"];
  executionError: string | null;
  halted: string | null;
}): InstallPhase {
  if (installing) {
    if (!session || session.steps.length === 0) return "preparing";
    const running = session.steps.find((s) => s.status === "running");
    if (!running) return "preparing";
    // A step whose stage names a download is the only honest source for
    // `downloading`; there is no separate byte-level signal to read.
    return isDownloadStage(running.stage) ? "downloading" : "installing";
  }

  if (!session) return executionError ? "failed" : "idle";

  // The run is over. `cancelled` wins over `failed` — see above.
  if (session.cancelledByUser) return "cancelled";
  if (halted || session.failedSteps.length > 0) return "failed";
  return "completed";
}

/** Does this step's stage text describe fetching rather than executing? */
function isDownloadStage(stage: string): boolean {
  return stage.includes("下载") || stage.includes("准备安装");
}

/** The heading for a phase. One place, so the wording cannot drift per branch. */
function phaseTitle(phase: InstallPhase): string {
  switch (phase) {
    case "idle":
      return "准备安装";
    case "preparing":
      return "正在准备安装";
    case "downloading":
      return "正在下载";
    case "installing":
      return "正在安装";
    case "verifying":
      return "正在检查安装结果";
    case "completed":
      return "安装完成";
    case "cancelled":
      return "安装已取消";
    case "failed":
      return "安装未完成";
  }
}

/**
 * The progress bar.
 *
 * ## Why it may show no number
 *
 * `fraction` is deliberately *not* trusted as a percentage: it is attempt-index
 * progress across a fallback chain, so a single-link step yields 0.0 then 1.0 —
 * a boolean, not a measurement (see `honestFraction`).
 *
 * An indeterminate bar reports `data-progress="indeterminate"` rather than
 * omitting the attribute, so a test asserts the *decision* instead of inferring
 * it from styling.
 *
 * ## Why this renders rarely, and why that is the honest state
 *
 * `run_install` is a single blocking call that returns a **complete**
 * `ExecutionSession`; there is no streaming channel from Rust (no `emit`, no
 * progress events). The store therefore holds `installing: true` with
 * `session: null` for the entire run, and a live per-step percentage is not
 * available to any renderer in this architecture.
 *
 * A bar that animated through a run would therefore have to be driven by a
 * timer, which is precisely the lie `Install.tsx` refuses. So this component
 * shows a bar only when a running step genuinely exists — which happens on a
 * resumed session, where the store already holds a session describing the work
 * still to do. Otherwise the honest signals are the step counter
 * (`已完成 n / m`) and the elapsed clock, both of which are real.
 *
 * Surfacing true live progress needs a Rust-side change (progress events, or a
 * polling command that reports the in-flight step). That is a larger piece of
 * work than this release, and is recorded as a follow-up rather than faked here.
 */
function ProgressBar({
  step,
  installing,
  done,
  total,
}: {
  step: StepProgress | undefined;
  installing: boolean;
  done: number;
  total: number;
}) {
  // A bar needs a step that is genuinely running. Without one there is nothing
  // to be in progress *of*, and inventing one would be the timer lie.
  if (!installing || !step || step.status !== "running") return null;

  const fraction = honestFraction(step);

  return (
    <div className="mt-4">
      <div
        data-testid="install-progress"
        data-progress={fraction === null ? "indeterminate" : Math.round(fraction * 100)}
        // The counter is the honest progress signal while the bar is
        // indeterminate, so it is exposed for assertion either way.
        data-done={done}
        data-total={total}
        className="bg-[color:var(--line-subtle)] relative h-1.5 w-full overflow-hidden rounded-full"
      >
        {fraction === null ? (
          // Indeterminate: a travelling segment, not a filling one. It says
          // "working" without claiming a position it does not know. Reuses the
          // existing `sweep` animation rather than adding a second one — the
          // keyframes and its reduced-motion handling already exist.
          <span className="sweep-active bg-[color:var(--status-accent)] absolute inset-y-0 w-1/3 rounded-full" />
        ) : (
          <span
            className="bg-[color:var(--status-accent)] absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        )}
      </div>
      {fraction !== null && (
        <div className="text-[color:var(--text-quiet)] tnum mt-1.5 text-right text-[12px]">
          {Math.round(fraction * 100)}%
        </div>
      )}
    </div>
  );
}

/**
 * The one place a percentage may be shown, and when it may not.
 *
 * `fraction` reaches the UI as `attempt / (chain_len + 1)` while a chain runs
 * (`install.rs:451`) and `1.0` when it ends (`:471`). With a single-link chain —
 * which is most programs — that is `0.0` for the entire install and then `1.0`.
 * A bar driven by that would sit empty and then snap to full, which is a lie of
 * the same kind as a timer.
 *
 * So a value is returned only when it can carry information, and `null`
 * otherwise — the caller then renders an indeterminate bar. Clamped, because the
 * caller uses it as a width and an out-of-range value from the backend must not
 * produce a broken bar.
 *
 * When the backend can report real sub-step progress, this is the single
 * function that changes.
 */
function honestFraction(step: StepProgress): number | null {
  const fraction = step.fraction;
  if (fraction === null || !Number.isFinite(fraction)) return null;

  // The threshold, and why: `attempt / (len + 1)` on a single-link chain can
  // only be 0.0, so any value there is a boolean dressed as a measurement.
  // A chain long enough to produce a true intermediate value is the smallest
  // case where the number means something.
  if (!chainHasIntermediateSteps(step) && fraction <= 0) return null;

  return Math.min(1, Math.max(0, fraction));
}

/**
 * Does this step's fallback chain have room for a meaningful mid-value?
 *
 * Separate from `honestFraction` because it answers a different question — "can
 * this fraction ever be informative" — and merging the two is what would make
 * the single-link case regress.
 */
function chainHasIntermediateSteps(step: StepProgress): boolean {
  const fraction = step.fraction;
  return fraction !== null && fraction > 0 && fraction < 1;
}

/** The cancel / failure panel's contents. */
function buildFailureView({
  phase,
  session,
  runningStep,
  executionError,
  halted,
}: {
  phase: InstallPhase;
  session: ReturnType<typeof useApp.getState>["session"];
  runningStep: StepProgress | null;
  executionError: string | null;
  halted: string | null;
}): InstallFailureView | null {
  if (phase !== "failed" && phase !== "cancelled") return null;

  // The command that was running, from the session's own action trace. Prefer
  // the last action overall: when a step fails `runningStep` may already have
  // moved on, and the *last* thing attempted is what the student needs.
  const lastAction = session?.actions.at(-1) ?? null;
  const command = lastAction?.command ?? null;
  const log = lastAction?.output?.trim() ? lastAction.output : null;

  if (phase === "cancelled") {
    return {
      kind: "cancelled",
      reason: "用户主动取消",
      command,
      log,
      suggestion: CANCELLED_SUGGESTION,
      logPath: null,
    };
  }

  // A halt has a reason the engine already wrote for the student.
  if (halted) {
    return {
      kind: "permissionDenied",
      reason: halted,
      command,
      log,
      suggestion: "右键以管理员身份重新运行本程序。",
      logPath: null,
    };
  }

  const failureKind = classifyFailure(lastAction);
  const failedStep = session?.steps.find((s) => s.status === "failed") ?? null;

  return {
    kind: failureKind,
    reason:
      executionError ??
      failureReason(failureKind, failedStep?.name ?? runningStep?.name ?? null),
    command,
    log: log ?? lastAction?.error ?? null,
    suggestion: suggestionFor(failureKind),
    logPath: null,
  };
}

const CANCELLED_SUGGESTION = "重新点击「开始安装」可以继续未完成的步骤。";

/**
 * Names the failure from the evidence in the session, never from a guess.
 *
 * Order matters: the executor's own classification is the most specific signal,
 * so it is consulted before falling back to the generic non-zero exit.
 */
function classifyFailure(
  lastAction: { outcome: AttemptOutcome } | null,
): InstallFailureKind {
  if (lastAction?.outcome === "permissionDenied") return "permissionDenied";
  if (lastAction?.outcome === "unavailable") return "unavailable";
  if (lastAction?.outcome === "cancelled") return "cancelled";
  return "nonZeroExit";
}

function failureReason(kind: InstallFailureKind, name: string | null): string {
  const subject = name ?? "该项目";
  switch (kind) {
    case "cancelled":
      return "用户主动取消";
    case "permissionDenied":
      return "安装需要管理员权限";
    case "unavailable":
      return `未找到安装 ${subject} 所需的工具`;
    case "verifyFailed":
      return "安装执行完成，但是未检测到命令。";
    case "nonZeroExit":
      return `${subject} 安装失败`;
  }
}

function suggestionFor(kind: InstallFailureKind): string {
  switch (kind) {
    case "cancelled":
      return CANCELLED_SUGGESTION;
    case "permissionDenied":
      return "右键以管理员身份重新运行本程序。";
    case "unavailable":
      return "检查网络连接，或确认系统已安装 winget。";
    case "verifyFailed":
      return "命令可能在新的终端窗口中才生效，请重启本程序后再试。";
    case "nonZeroExit":
      return "检查网络连接，或稍后重试。";
  }
}

/**
 * The post-install checklist.
 *
 * This is the brief's "detect whether the command exists → read its version →
 * report" step, and its most important property is what it does with a
 * *zero-exit* run whose program is absent. `verify_install_result` re-probes the
 * machine, so `ok: false` here means "the command finished and the program is
 * not usable" — reported as a failure, never as a green tick.
 */
function VerificationList({ report }: { report: PostInstallReport }) {
  if (report.checks.length === 0) return null;

  const problems = report.checks.filter((c) => !c.ok);

  return (
    <div className="mt-7" data-testid="install-verification">
      <SectionLabel>安装结果检查</SectionLabel>
      <div className="stagger mt-2 flex flex-col gap-1.5">
        {report.checks.map((check) => (
          <div
            key={check.id}
            className={clsx(
              "flex items-start gap-3 rounded-[10px] border px-3.5 py-2.5",
              check.ok
                ? "border-[color:var(--line-subtle)]/70"
                : "border-bad/25 bg-[color:var(--status-bad)]/[0.05]",
            )}
            data-testid={`verify-${check.id}`}
            data-ok={check.ok ? "true" : "false"}
          >
            <SoftwareIcon id={check.id} size={26} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
                  {check.name}
                </span>
                {check.ok && check.version && (
                  <span className="text-[color:var(--text-quiet)] tnum text-[12px]">
                    版本: {check.version}
                  </span>
                )}
              </div>
              <p
                className={clsx(
                  "mt-0.5 text-[12.5px] leading-relaxed",
                  check.ok
                    ? "text-[color:var(--text-tertiary)]"
                    : "text-[color:var(--text-secondary)]",
                )}
              >
                {check.message}
              </p>
              {!check.ok && check.hint && (
                <p className="text-[color:var(--text-quiet)] mt-1 text-[12px]">
                  {check.hint}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* A one-line rollup, so the outcome is legible without reading every row.
          Only shown when something is wrong: "全部通过" on a clean run would be
          noise on a screen that already says 安装完成. */}
      {problems.length > 0 && (
        <p className="text-[color:var(--text-secondary)] mt-2.5 text-[12.5px]">
          有 {problems.length} 项安装执行完成，但是未检测到命令。
        </p>
      )}
    </div>
  );
}

/**
 * The panel a stopped or failed run shows.
 *
 * The brief asks for the reason, the running command, the log so far and a
 * suggestion, because `已取消` alone left the student with nothing to act on.
 * The `data-*` attributes are the test contract.
 */
function FailurePanel({
  view,
  canRetry,
  remainingCount,
  retrying,
  onRetry,
}: {
  view: InstallFailureView;
  /** Whether continuing the run is actually possible. */
  canRetry: boolean;
  remainingCount: number;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className={clsx(
        "fade mt-4 rounded-[12px] border px-4 py-3.5",
        view.kind === "cancelled"
          ? "border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/40"
          : "border-bad/25 bg-[color:var(--status-bad)]/[0.06]",
      )}
      data-testid="install-failure-panel"
      data-reason={view.kind === "cancelled" ? "user-cancelled" : view.kind}
    >
      <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
        {view.kind === "cancelled" ? "安装已取消" : "安装未完成"}
      </div>

      <dl className="mt-2 flex flex-col gap-1 text-[12.5px] leading-relaxed">
        <div className="flex gap-1.5">
          <dt className="text-[color:var(--text-quiet)] shrink-0">原因:</dt>
          <dd className="text-[color:var(--text-secondary)]">{view.reason}</dd>
        </div>
        {view.command && (
          <div className="flex gap-1.5">
            <dt className="text-[color:var(--text-quiet)] shrink-0">正在执行:</dt>
            <dd className="text-[color:var(--text-secondary)] break-all">
              {view.command}
            </dd>
          </div>
        )}
        {view.log && (
          <div className="flex gap-1.5">
            <dt className="text-[color:var(--text-quiet)] shrink-0">日志:</dt>
            {/* Truncated: the panel is a summary, and the full file is one
                command away. Showing everything would push the suggestion off
                screen, which is the part the student acts on. */}
            <dd className="text-[color:var(--text-tertiary)] max-h-24 overflow-y-auto break-all whitespace-pre-wrap">
              {view.log.slice(-600)}
            </dd>
          </div>
        )}
        {view.suggestion && (
          <div className="flex gap-1.5">
            <dt className="text-[color:var(--text-quiet)] shrink-0">建议:</dt>
            <dd className="text-[color:var(--text-secondary)]">{view.suggestion}</dd>
          </div>
        )}
      </dl>

      {/* The action the brief asks for alongside the diagnosis.
          Without it the panel explains a failure and then leaves the student to
          find their own way out, which is the corridor this screen exists to
          close. Only offered when continuing is actually possible:
          `canRetry` is false for a cancelled run — the student stopped it on
          purpose, so "重试" would be an odd way to put it — and false when the
          run has nothing left to resume. */}
      {canRetry && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="quiet"
            data-testid="install-retry"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? "正在重试…" : `重试（还剩 ${remainingCount} 项）`}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The dialog shown when back is pressed during a run.
 *
 * The brief's promise is that returning does not stop the install, and that the
 * student can choose either way. Both facts come from the store: `goBack()` does
 * not reset `session`/`plan`/`installing`, which is what makes
 * 「继续后台安装」 true rather than merely comforting.
 */
function BackDuringInstallDialog({
  stepName,
  onContinue,
  onCancelAndLeave,
}: {
  stepName: string | null;
  onContinue: () => void;
  onCancelAndLeave: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      role="dialog"
      aria-modal="true"
      data-testid="install-back-dialog"
    >
      <div className="glass w-full max-w-[420px] rounded-[16px] px-6 py-5">
        <div className="text-[color:var(--text-strong)] text-[16px] font-semibold">
          正在安装: {stepName ?? "当前项目"}
        </div>
        <p className="text-[color:var(--text-secondary)] mt-2 text-[13px] leading-relaxed">
          返回不会停止安装。安装会在后台继续，你可以稍后回到这个页面查看进度。
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancelAndLeave}>
            取消安装并返回
          </Button>
          <Button onClick={onContinue}>继续后台安装</Button>
        </div>
      </div>
    </div>
  );
}
