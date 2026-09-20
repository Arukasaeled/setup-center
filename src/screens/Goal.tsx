/**
 * First-run screen 1 — what are you trying to become?
 *
 * ## Why this screen exists at all
 *
 * The earlier flow detected first and asked second. That order is backwards for
 * a first-year student: a wall of results about a machine they cannot evaluate
 * is noise, and the question "do you have Node.js" is meaningless before they
 * know whether they need it.
 *
 * Asking the goal first means every subsequent screen has a frame. The same
 * measurement is then read as "2 of 3 things you need" rather than as four
 * unexplained ✓ / ✗ marks.
 *
 * ## Why it is a list and not cards
 *
 * The brief said "不要大量卡片" and the reason is concrete: six cards in a grid
 * turns a single decision into a comparison task, and a student who is unsure
 * ends up reading all six to pick one. A list with the selected row expanded
 * shows exactly one explanation at a time.
 *
 * ## Why the needs are visible before choosing
 *
 * Because a student who does not yet know what "MCP" is deserves to see that a
 * direction mentions it, and to see that another direction does not. Hiding the
 * requirements until after the choice would make the choice uninformed — and
 * this screen is the one place the app can explain what a direction costs before
 * anything is installed.
 */

import { useEffect } from "react";
import clsx from "clsx";
import { Button, SectionLabel } from "../components/ui";
import { useApp } from "../lib/store";
import type { EnvironmentPlan, GoalView } from "../lib/types";

export function GoalScreen() {
  const goals = useApp((s) => s.goals);
  const selectedGoalId = useApp((s) => s.selectedGoalId);
  const selectGoal = useApp((s) => s.selectGoal);
  const goalPlan = useApp((s) => s.goalPlan);
  const goalPlanPhase = useApp((s) => s.goalPlanPhase);
  const loadGoals = useApp((s) => s.loadGoals);
  const goTo = useApp((s) => s.goTo);
  const runDetection = useApp((s) => s.runDetection);
  const detect = useApp((s) => s.detect);
  const selectProfile = useApp((s) => s.selectProfile);

  useEffect(() => {
    if (!goals) void loadGoals();
  }, [goals, loadGoals]);

  const start = async () => {
    const plan = useApp.getState().goalPlan;
    // The goal and the profile are two names for one install. Selecting the
    // profile here means the rest of the existing flow — plan, install,
    // bootstrap — needs no change to work with goals.
    if (plan) selectProfile(plan.profileId);
    if (detect.kind === "idle" || detect.kind === "error") {
      await runDetection();
    }
    goTo("detect");
  };

  if (!goals) {
    return (
      <div className="flex h-full items-center justify-center px-10">
        <div className="text-[color:var(--text-quiet)] text-[13px]">正在读取可选方向…</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <header className="fade shrink-0">
        <h2 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          你想往哪个方向走？
        </h2>
        <p className="text-[color:var(--text-quiet)] mt-1 text-[13px]">
          先选一个目标，之后会告诉你这台电脑还差什么
        </p>
      </header>

      <div className="mt-7 -mr-1 flex-1 overflow-y-auto pr-1">
        {goals.goalsWithoutProfiles.length > 0 && (
          <div className="glass-soft mb-4 rounded-[12px] p-4">
            <div className="text-[color:var(--status-warn)] text-[12.5px] font-medium">
              以下方向暂时无法自动安装
            </div>
            <p className="text-[color:var(--text-tertiary)] mt-1 text-[12.5px]">
              {goals.goalsWithoutProfiles.join("、")} —— 缺少对应的方案文件，分析结果仍然有效。
            </p>
          </div>
        )}

        <div className="stagger flex flex-col">
          {goals.goals.map((goal) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              selected={goal.id === selectedGoalId}
              onSelect={() => selectGoal(goal.id)}
              plan={goal.id === selectedGoalId ? goalPlan : null}
              loading={goal.id === selectedGoalId && goalPlanPhase === "loading"}
            />
          ))}
        </div>
      </div>

      <footer className="fade mt-6 flex shrink-0 items-center justify-between border-t border-[color:var(--line-subtle)] pt-5">
        <span className="text-[color:var(--text-quiet)] text-[12.5px]">
          可以随时回到这里换方向
        </span>
        <Button disabled={!selectedGoalId || goalPlanPhase === "loading"} onClick={() => void start()}>
          开始检测
        </Button>
      </footer>
    </div>
  );
}

function GoalRow({
  goal,
  selected,
  onSelect,
  plan,
  loading,
}: {
  goal: GoalView;
  selected: boolean;
  onSelect: () => void;
  plan: EnvironmentPlan | null;
  loading: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        "group relative w-full border-b border-[color:var(--line-subtle)] px-1 py-4 text-left",
        "transition-colors duration-150 last:border-b-0",
      )}
    >
      {selected && (
        <span className="bg-[color:var(--status-accent)] absolute top-3.5 bottom-3.5 -left-3 w-[2px] rounded-full" />
      )}

      <div className="flex items-start gap-4">
        <span
          className={clsx(
            "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
            selected
              ? "border-[color:var(--status-accent)] bg-[color:var(--status-accent)]"
              : "border-[color:var(--line-strong)] group-hover:border-[color:var(--text-quiet)]",
          )}
        >
          {selected && <span className="bg-[color:var(--surface-raised)] h-1.5 w-1.5 rounded-full" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <span
              className={clsx(
                "text-[15px] font-medium tracking-[-0.01em] transition-colors duration-150",
                selected ? "text-[color:var(--text-strong)]" : "text-[color:var(--text-primary)]",
              )}
            >
              {goal.name}
            </span>
            <span className="text-[color:var(--text-quiet)] text-[12.5px]">{goal.tagline}</span>
          </div>

          <div className="text-[color:var(--text-quiet)] mt-1 text-[12.5px]">{goal.audience}</div>

          {selected && (
            <div className="fade mt-3.5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <SectionLabel>需要什么</SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {goal.needs.map((n) => (
                      <span
                        key={n}
                        className="border-[color:var(--line-default)] bg-[color:var(--surface-inset)] text-[color:var(--text-primary)] rounded-[6px] border px-2 py-[3px] text-[12px]"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </div>

                {goal.bonuses.length > 0 && (
                  <div>
                    <SectionLabel>有了更好</SectionLabel>
                    <div className="text-[color:var(--text-quiet)] flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
                      {goal.bonuses.map((b) => (
                        <span key={b}>{b}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {loading && (
                <div className="text-[color:var(--text-quiet)] mt-3.5 text-[12.5px]">
                  正在对照这台电脑…
                </div>
              )}

              {plan && !loading && <PlanPreview plan={plan} />}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

/**
 * What this direction would take on this machine.
 *
 * Rendered *before* the student commits, which is the point of asking here. A
 * missing measurement is shown as "待检测" rather than as a gap, because at
 * first run nothing has been measured yet and reporting three gaps would be a
 * claim about a machine nobody looked at.
 */
function PlanPreview({ plan }: { plan: EnvironmentPlan }) {
  const ready = plan.completion === 100;
  const onlyUnknown = plan.gaps.length === 0 && plan.unmeasured.length > 0;

  return (
    <div className="mt-3.5 border-t border-[color:var(--line-subtle)] pt-3.5">
      <div className="flex items-baseline gap-3">
        <span
          className={clsx(
            "tnum text-[15px] font-medium",
            ready
              ? "text-[color:var(--status-ok)]"
              : "text-[color:var(--text-primary)]",
          )}
        >
          {plan.completion}%
        </span>
        <span className="text-[color:var(--text-tertiary)] text-[12.5px]">{plan.overall}</span>
      </div>

      <p className="text-[color:var(--text-secondary)] mt-2 text-[12.5px] leading-relaxed">
        {plan.headline}
      </p>

      {plan.gaps.length > 0 && (
        <div className="mt-3">
          <SectionLabel>还缺</SectionLabel>
          <div className="flex flex-col gap-1">
            {plan.gaps.map((g) => (
              <div key={g.capabilityId} className="text-[color:var(--text-secondary)] text-[12.5px]">
                <span>{g.name}</span>
                {g.summary && (
                  <span className="text-[color:var(--text-quiet)]"> — {g.summary}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {onlyUnknown && (
        <p className="text-[color:var(--text-quiet)] mt-3 text-[12.5px]">
          这台电脑还未检测，先看看需要什么，检测后才知道具体缺哪些。
        </p>
      )}
    </div>
  );
}
