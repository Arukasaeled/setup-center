/**
 * Dashboard — the surface a student lives in.
 *
 * ## What this replaces
 *
 * The previous build was a seven-step wizard: `welcome → detect → software →
 * choose → install → bootstrap → done`. Every question ("do I have Git?", "is my
 * Python on PATH?", "what would Docker get me?") lived on a step you had to walk
 * to, and the answers were orphaned the moment you moved on.
 *
 * This screen inverts that. It opens on the machine's *current state*, in four
 * sections a student can move between freely, with a detail pane that explains
 * whatever they point at. Nothing is a step; nothing must be completed.
 *
 * ## The three-column structure, and why each column exists
 *
 * * **Left** — five sections. Answers "what kinds of fact are there about my
 *   computer". Fixed, small, and never a progress indicator.
 * * **Centre** — the actual state. Rows of `name · status · version · purpose`.
 * * **Right** — the selected row, expanded: what it is, why it matters, what we
 *   observed, and (when something is missing) the one action that would fix it.
 *
 * The right column is the part that was missing entirely before. Every row used
 * to say `Git · 已安装` and nothing said why a student should care. Explanations
 * belong somewhere with room for them, not crammed into a row and not hidden
 * behind a modal that interrupts.
 *
 * ## Why the rail was kept
 *
 * The first-run wizard still exists and is still the honest way to describe a
 * multi-minute install. The dashboard's last item is a door back into it, offered
 * as "规划一次完整安装" rather than as a "next" button — it is one option among
 * several, not the continuation of a flow.
 */

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Button, ScoreReadout, SectionLabel, StatusMark } from "../components/ui";
import { SoftwareIcon } from "../components/SoftwareIcon";
import { describeSoftware } from "../lib/software";
import { useApp, type Section } from "../lib/store";
import type {
  CapabilityStatus,
  Confidence,
  EnvironmentPlan,
  ExplainedSoftware,
  MachineFacts,
  Recommendation,
  RequirementOutcome,
  SoftwareDescriptor,
  SoftwareInfo,
} from "../lib/types";

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: "overview", label: "环境概览", hint: "总体状态与缺口" },
  { id: "software", label: "软件", hint: "这台电脑装了什么" },
  { id: "config", label: "配置", hint: "身份、路径、代理" },
  { id: "history", label: "历史记录", hint: "做过什么，如何恢复" },
  { id: "license", label: "版本", hint: "当前权益与激活" },
];

export function Dashboard() {
  const section = useApp((s) => s.section);
  const setSection = useApp((s) => s.setSection);
  const closeDashboard = useApp((s) => s.closeDashboard);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);

  const capabilities = useApp((s) => s.capabilities);
  const capabilitiesPhase = useApp((s) => s.capabilitiesPhase);
  const environment = useApp((s) => s.environment);
  const inventory = useApp((s) => s.inventory);
  const inventoryPhase = useApp((s) => s.inventoryPhase);
  const detect = useApp((s) => s.detect);
  const runDetection = useApp((s) => s.runDetection);
  const scanInstalled = useApp((s) => s.scanInstalled);
  const loadCapabilities = useApp((s) => s.loadCapabilities);
  const selectedItemId = useApp((s) => s.selectedItemId);
  const selectItem = useApp((s) => s.selectItem);

  // The dashboard is self-sufficient: opening it on a cold start must produce a
  // complete picture without the student having visited the wizard. Running and
  // scanning in parallel keeps the wait to the slower of the two rather than
  // their sum, and neither depends on the other.
  useEffect(() => {
    if (!environment && detect.kind === "idle") void runDetection();
    if (!inventory && inventoryPhase === "idle") void scanInstalled();
  }, [
    environment,
    detect.kind,
    runDetection,
    inventory,
    inventoryPhase,
    scanInstalled,
  ]);

  useEffect(() => {
    if (capabilitiesPhase === "idle") void loadCapabilities();
  }, [capabilitiesPhase, loadCapabilities]);

  const loading =
    detect.kind === "idle" ||
    detect.kind === "running" ||
    inventoryPhase === "idle" ||
    inventoryPhase === "scanning";

  return (
    <div className="flex h-full">
      <DashboardNav
        section={section}
        onSelect={setSection}
        onExit={closeDashboard}
        theme={theme}
        onTheme={setTheme}
      />

      <div className="flex min-w-0 flex-1">
        <section className="min-w-0 flex-1 overflow-y-auto px-8 py-7">
          {section === "overview" && (
            <OverviewSection
              loading={loading}
              onRecheck={() => {
                void runDetection();
                void scanInstalled();
              }}
            />
          )}
          {section === "software" && <SoftwareSection />}
          {section === "config" && <ConfigSection />}
          {section === "history" && <HistorySection />}
          {section === "license" && <LicenseSection />}
        </section>

        <aside className="border-[color:var(--line-subtle)] w-[340px] shrink-0 overflow-y-auto border-l px-6 py-7">
          <DetailPane
            selectedId={selectedItemId}
            capabilities={capabilities}
            onClear={() => selectItem(null)}
          />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function DashboardNav({
  section,
  onSelect,
  onExit,
  theme,
  onTheme,
}: {
  section: Section;
  onSelect: (s: Section) => void;
  onExit: () => void;
  theme: "light" | "dark" | "system";
  onTheme: (t: "light" | "dark" | "system") => void;
}) {
  // Counts are shown beside two sections only. A badge on every item would turn
  // navigation into a scoreboard, which reads as pressure rather than
  // information; these two are the ones a student acts on.
  const capabilities = useApp((s) => s.capabilities);
  const softwareGaps = useApp((s) => {
    const items = s.inventory?.items ?? [];
    return items.filter((i) => !i.installed && i.confidence !== "unknown").length;
  });

  const capabilityGaps = capabilities.filter((c) => c.status !== "available").length;

  const badges: Partial<Record<Section, number>> = {
    software: softwareGaps,
    aiTools: capabilityGaps,
  };

  return (
    <nav
      aria-label="导航"
      className="border-[color:var(--line-subtle)] flex w-[188px] shrink-0 flex-col border-r px-3 py-7"
    >
      <div className="px-2.5 pb-5">
        <div className="text-[color:var(--text-strong)] text-[13.5px] font-semibold tracking-[-0.01em]">
          Setup Center
        </div>
        <div className="text-[color:var(--text-quiet)] mt-0.5 text-[11.5px]">
          本机状态
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        {SECTIONS.map((s) => {
          const active = s.id === section;
          const badge = badges[s.id];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "group flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left",
                "transition-colors duration-150",
                active
                  ? "bg-[color:var(--surface-active)]"
                  : "hover:bg-[color:var(--surface-hover)]",
              )}
            >
              <span
                className={clsx(
                  "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200",
                  active
                    ? "bg-[color:var(--status-accent)]"
                    : "bg-[color:var(--line-default)] group-hover:bg-[color:var(--text-quiet)]",
                )}
              />
              <span
                className={clsx(
                  "flex-1 text-[13px] transition-colors duration-150",
                  active
                    ? "text-[color:var(--text-strong)]"
                    : "text-[color:var(--text-secondary)]",
                )}
              >
                {s.label}
              </span>
              {badge != null && badge > 0 && (
                <span className="text-[color:var(--text-quiet)] tnum text-[11.5px]">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-6">
        <ThemeSwitch theme={theme} onTheme={onTheme} />
        <Button variant="quiet" size="sm" onClick={onExit} className="justify-start">
          回到首次设置
        </Button>
      </div>
    </nav>
  );
}

/**
 * Light / dark / system.
 *
 * Three options rather than a toggle. A two-state switch forces a lie: most
 * people leave their OS on a schedule, and "follow the system" is the answer they
 * actually want. The control is segmented rather than a select because there are
 * only three values and seeing all of them is faster than opening a menu.
 */
function ThemeSwitch({
  theme,
  onTheme,
}: {
  theme: "light" | "dark" | "system";
  onTheme: (t: "light" | "dark" | "system") => void;
}) {
  const options: { id: "light" | "dark" | "system"; label: string }[] = [
    { id: "light", label: "浅色" },
    { id: "dark", label: "深色" },
    { id: "system", label: "跟随系统" },
  ];

  return (
    <div
      className="border-[color:var(--line-subtle)] flex gap-0.5 rounded-[9px] border p-0.5"
      role="group"
      aria-label="主题"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onTheme(o.id)}
          aria-pressed={theme === o.id}
          className={clsx(
            "flex-1 rounded-[7px] py-1.5 text-[11.5px] transition-colors duration-150",
            theme === o.id
              ? "bg-[color:var(--surface-active)] text-[color:var(--text-strong)]"
              : "text-[color:var(--text-quiet)] hover:text-[color:var(--text-secondary)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: overview
// ---------------------------------------------------------------------------

function OverviewSection({
  loading,
  onRecheck,
}: {
  loading: boolean;
  onRecheck: () => void;
}) {
  const environment = useApp((s) => s.environment);
  const capabilities = useApp((s) => s.capabilities);
  const machine = useApp((s) => s.machine);
  const selectItem = useApp((s) => s.selectItem);
  const setSection = useApp((s) => s.setSection);

  // Stage 5: the overview leads with the goal, not with a generic score.
  //
  // The score alone said "how much of everything is present", which a student
  // cannot act on — 60% of what? Framing the same measurement against a chosen
  // direction is what turns it into advice, and it is the reason the goal screen
  // comes first.
  const advisor = useApp((s) => s.advisor);
  const goalPlan = useApp((s) => s.goalPlan);
  const allPlans = useApp((s) => s.allPlans);
  const goals = useApp((s) => s.goals);
  const selectedGoalId = useApp((s) => s.selectedGoalId);
  const selectGoal = useApp((s) => s.selectGoal);
  const loadAdvisor = useApp((s) => s.loadAdvisor);
  const loadGoals = useApp((s) => s.loadGoals);
  const knowledgeStatus = useApp((s) => s.knowledgeStatus);

  const groups = useMemo(() => groupCapabilities(capabilities), [capabilities]);

  useEffect(() => {
    if (!advisor) void loadAdvisor();
    if (!goals) void loadGoals();
  }, [advisor, goals, loadAdvisor, loadGoals]);

  if (loading && !environment) return <LoadingBlock label="正在读取这台电脑的状态…" />;
  if (!environment) {
    return (
      <EmptyBlock
        title="暂时读不到环境信息"
        body="可能是权限或系统查询失败。可以重试一次。"
        action={{ label: "重新检测", onClick: onRecheck }}
      />
    );
  }

  const available = capabilities.filter((c) => c.status === "available").length;
  const gaps = capabilities.filter((c) => c.status !== "available");
  const selectedGoal = goals?.goals.find((g) => g.id === selectedGoalId) ?? null;

  return (
    <div className="flex flex-col gap-8">
      <header className="rise">
        <div className="flex items-baseline justify-between">
          <h1 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
            环境概览
          </h1>
          <button
            type="button"
            onClick={onRecheck}
            className="text-[color:var(--text-quiet)] hover:text-[color:var(--text-secondary)] text-[12px] transition-colors"
          >
            重新检测
          </button>
        </div>

        {/* The goal frame. When a direction is chosen, its completion is the
            headline number; the generic score becomes a secondary line. When
            none is chosen — a dashboard opened cold — the generic score stands
            alone rather than showing a goal the student never picked. */}
        {goalPlan && selectedGoal ? (
          <div className="mt-5">
            <GoalReadout plan={goalPlan} goalName={selectedGoal.name} />
            <div className="text-[color:var(--text-quiet)] mt-3 flex items-baseline gap-2 text-[12px]">
              <span className="tnum">
                整体评分 {advisor?.summary.score ?? environment.score} / 100
              </span>
              <span>·</span>
              <span>{advisor?.summary.headline ?? `已经可以做 ${available} 件事`}</span>
            </div>
          </div>
        ) : (
          <div className="mt-5">
            <ScoreReadout score={environment.score} max={environment.scoreMax} />
            <p className="text-[color:var(--text-tertiary)] mt-4 text-[13px] leading-relaxed">
              {gaps.length === 0
                ? "这台电脑已经具备全部条件，可以直接开始开发。"
                : `已经可以做 ${available} 件事，还有 ${gaps.length} 件需要补一下就绪。`}
            </p>
          </div>
        )}
      </header>

      {/* Recommended actions, ordered. This is the section a student reads when
          they only want to know what to do next, so it comes before the full
          capability breakdown rather than after it.

          Hardware limits are filtered out and shown separately. The distinction
          is the whole reason `kind` carries four values: a memory upgrade is
          correct information but not a next step, and placing it at the top of a
          to-do list asks the student to do something they cannot. */}
      {advisor && advisor.summary.recommendations.some((r) => r.kind !== "hardware") && (
        <section className="rise">
          <SectionLabel>建议的下一步</SectionLabel>
          <div className="stagger flex flex-col gap-2">
            {advisor.summary.recommendations
              .filter((r) => r.kind !== "hardware")
              .slice(0, 5)
              .map((r) => (
                <RecommendationRow key={`${r.order}-${r.title}`} recommendation={r} />
              ))}
          </div>
        </section>
      )}

      {/* What the machine cannot be made to do. Stated plainly rather than
          dressed as a task, and given the same prominence as the advice because
          it explains why some directions will stay out of reach. */}
      {advisor && advisor.summary.recommendations.some((r) => r.kind === "hardware") && (
        <section className="rise">
          <SectionLabel>受硬件限制</SectionLabel>
          <div className="flex flex-col gap-2">
            {advisor.summary.recommendations
              .filter((r) => r.kind === "hardware")
              .map((r) => (
                <div
                  key={`${r.order}-${r.title}`}
                  className="border-[color:var(--line-default)] border-l-2 px-3 py-1"
                >
                  <div className="text-[color:var(--text-secondary)] text-[12.5px]">
                    {r.title}
                  </div>
                  <div className="text-[color:var(--text-quiet)] mt-0.5 text-[11.5px] leading-relaxed">
                    {r.reason}。这类限制无法通过安装解决。
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* What this machine is well suited for. Shown only once a direction is
          already in play — a cold dashboard should not push a student toward
          choosing, since the goal screen is where that decision belongs. */}
      {goalPlan && allPlans.length > 1 && (
        <section className="rise">
          <SectionLabel>其他方向</SectionLabel>
          <div className="flex flex-col gap-0.5">
            {allPlans
              .filter((p) => p.goalId !== goalPlan.goalId)
              .slice(0, 4)
              .map((p) => (
                <button
                  key={p.goalId}
                  type="button"
                  onClick={() => selectGoal(p.goalId)}
                  className="hover:bg-[color:var(--surface-hover)] flex items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-colors duration-150"
                >
                  <span className="text-[color:var(--text-secondary)] min-w-0 flex-1 truncate text-[13px]">
                    {p.goalName}
                  </span>
                  <span className="text-[color:var(--text-quiet)] tnum shrink-0 text-[11.5px]">
                    {p.completion}%
                  </span>
                </button>
              ))}
          </div>
        </section>
      )}

      {/* Capability groups. This is the answer to "what can I do", which no
          previous screen asked — they all answered "which programs are
          installed", which is a different and much less useful question. */}
      {groups.map((g) => (
        <section key={g.key} className="rise">
          <SectionLabel>{g.name}</SectionLabel>
          <div className="stagger flex flex-col gap-1">
            {g.items.map((c) => (
              <CapabilityRow
                key={c.id}
                capability={c}
                selected={false}
                onClick={() => selectItem(capabilityKey(c.id))}
              />
            ))}
          </div>
        </section>
      ))}

      <section className="rise">
        <SectionLabel>这台机器</SectionLabel>
        <MachineSummary
          machine={machine}
          onSelect={(id) => {
            setSection("software");
            selectItem(id);
          }}
        />
        {advisor?.machine && advisor.machine.notes.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {advisor.machine.notes.map((note) => (
              <li key={note} className="text-[color:var(--text-quiet)] text-[12px] leading-relaxed">
                · {note}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Knowledge coverage. Shown only when something is actually wrong — a
          healthy knowledge base needs no section, and a permanent "0 warnings"
          line trains students to ignore the area where warnings would appear. */}
      {knowledgeStatus && knowledgeStatus.warnings.length > 0 && (
        <section className="rise">
          <SectionLabel>说明内容</SectionLabel>
          <ul className="flex flex-col gap-1">
            {knowledgeStatus.warnings.slice(0, 4).map((w) => (
              <li key={w} className="text-[color:var(--text-quiet)] text-[12px] leading-relaxed">
                {w}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * The goal's completion, as the overview's headline.
 *
 * Four numbers rather than one, because they mean different things to a
 * student: what works, what is missing, what could not be checked, and what is
 * a bonus. Collapsing them into a single percentage is what makes a progress
 * figure unactionable — 67% does not say whether to install something or to
 * re-run the scan.
 */
function GoalReadout({ plan, goalName }: { plan: EnvironmentPlan; goalName: string }) {
  const total = plan.strengths.length + plan.gaps.length + plan.unmeasured.length;
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="text-[color:var(--text-quiet)] text-[12px]">目标</span>
        <span className="text-[color:var(--text-primary)] text-[14px] font-medium">
          {goalName}
        </span>
        <span className="text-[color:var(--text-quiet)] text-[12px]">· {plan.profileName}</span>
      </div>

      <div className="mt-3 flex items-baseline gap-3">
        <span
          className={clsx(
            "tnum text-[34px] leading-none font-semibold tracking-[-0.03em]",
            plan.completion === 100
              ? "text-[color:var(--status-ok)]"
              : "text-[color:var(--text-strong)]",
          )}
        >
          {plan.completion}
          <span className="text-[color:var(--text-quiet)] text-[16px] font-normal">%</span>
        </span>
        {total > 0 && (
          <span className="text-[color:var(--text-quiet)] tnum text-[12px]">
            {plan.strengths.length}/{total} 项就绪
          </span>
        )}
      </div>

      {/* The percentage is scoped to *this direction*, and it has to say so.
          `GoalReadout` and the `整体评分` line below it sit within a few pixels
          of each other, and side by side "100%" next to "整体评分 73 / 100" reads
          as a contradiction unless the reader already knows one is per-goal and
          the other is the machine. A student seeing this for the first time has
          no way to know that, and the app looked like it was disagreeing with
          itself. Naming the scope costs one line and removes the ambiguity.
          The word "方向" matches the sidebar's "其他方向" list, so the two
          numbers are visibly about different subjects. */}
      <p className="text-[color:var(--text-quiet)] mt-2 text-[12px]">
        以上为「{goalName}」方向的完成度
      </p>

      <p className="text-[color:var(--text-tertiary)] mt-3 text-[13px] leading-relaxed">
        {plan.headline}
      </p>

      {/* The unmeasured count is stated separately and never folded into the
          gap count. "We could not check" is not "you do not have it", and this
          is the line a student would otherwise misread. */}
      {plan.unmeasured.length > 0 && (
        <p className="text-[color:var(--text-quiet)] mt-2 text-[12px]">
          另有 {plan.unmeasured.length} 项无法确认，不计入完成度。
        </p>
      )}
    </div>
  );
}

function RecommendationRow({ recommendation }: { recommendation: Recommendation }) {
  return (
    <div className="bg-[color:var(--surface-inset)] flex items-start gap-3 rounded-[10px] px-3 py-2.5">
      <span className="text-[color:var(--text-quiet)] tnum mt-[1px] shrink-0 text-[12px]">
        {recommendation.order}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[color:var(--text-primary)] text-[13px]">{recommendation.title}</div>
        <div className="text-[color:var(--text-quiet)] mt-0.5 text-[12px] leading-relaxed">
          {recommendation.reason}
        </div>
      </div>
      {/* The kind is shown, not just implied: an action only the student can
          perform must not look like a button they are waiting for. */}
      <span className="text-[color:var(--text-quiet)] shrink-0 text-[11px]">
        {recommendationKindLabel(recommendation.kind)}
      </span>
    </div>
  );
}

function recommendationKindLabel(kind: Recommendation["kind"]): string {
  switch (kind) {
    case "install":
      return "可自动安装";
    case "configure":
      return "需配置";
    case "manual":
      return "需你操作";
    // Hardware is called out separately because it is the one kind nobody can
    // act on from inside this app. Sitting beside "可自动安装" without a label,
    // a memory upgrade reads as a task the student is expected to complete.
    case "hardware":
      return "受硬件限制";
  }
}

function CapabilityRow({
  capability,
  selected,
  onClick,
}: {
  capability: CapabilityStatus;
  selected: boolean;
  onClick: () => void;
}) {
  const tone = capabilityTone(capability.status);
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-150",
        selected
          ? "bg-[color:var(--surface-active)]"
          : "hover:bg-[color:var(--surface-hover)]",
      )}
    >
      <StatusMark confidence={tone.confidence} />
      <span className="text-[color:var(--text-primary)] min-w-0 flex-1 truncate text-[13.5px]">
        {capability.name}
      </span>
      <span className="text-[color:var(--text-quiet)] tnum shrink-0 text-[11.5px]">
        {capability.metCount}/{capability.requiredCount}
      </span>
    </button>
  );
}

/** Maps a capability status onto the shared glyph vocabulary. */
function capabilityTone(status: string): { confidence: Confidence; label: string } {
  switch (status) {
    case "available":
      return { confidence: "ok", label: "已就绪" };
    case "partial":
      return { confidence: "unknown", label: "部分就绪" };
    case "unknown":
      return { confidence: "unknown", label: "无法确认" };
    default:
      return { confidence: "fail", label: "尚不可用" };
  }
}

function MachineSummary({
  machine,
  onSelect,
}: {
  machine: MachineFacts | null;
  onSelect: (id: string) => void;
}) {
  const rows: { key: string; label: string; value: string; confidence: Confidence }[] =
    [];

  if (machine?.cpu) {
    const detail =
      machine.cpu.physicalCores && machine.cpu.logicalCores
        ? `${machine.cpu.physicalCores} 核 ${machine.cpu.logicalCores} 线程`
        : machine.cpu.logicalCores
          ? `${machine.cpu.logicalCores} 线程`
          : "";
    rows.push({
      key: "machine.cpu",
      label: "处理器",
      value: [machine.cpu.name, detail].filter(Boolean).join(" · "),
      confidence: "ok",
    });
  } else {
    rows.push({
      key: "machine.cpu",
      label: "处理器",
      value: "无法读取",
      confidence: "unknown",
    });
  }

  if (machine?.memory) {
    rows.push({
      key: "machine.memory",
      label: "内存",
      value: formatBytes(machine.memory.totalBytes),
      confidence: "ok",
    });
  } else {
    rows.push({
      key: "machine.memory",
      label: "内存",
      value: "无法读取",
      confidence: "unknown",
    });
  }

  if (machine && machine.gpus.length > 0) {
    // The best card is named explicitly, and integrated-only is stated as a
    // caveat rather than as a failure — most student laptops are fine.
    const best = machine.gpus.reduce<typeof machine.gpus[number] | null>(
      (acc, g) => ((g.vramBytes ?? 0) > (acc?.vramBytes ?? 0) ? g : acc),
      null,
    );
    const vram = best?.vramBytes;
    rows.push({
      key: "machine.gpu",
      label: "显卡",
      value: vram
        ? `${best?.name} · ${formatBytes(vram)}`
        : machine.gpus.map((g) => g.name).join(" / "),
      confidence: "ok",
    });
  } else {
    rows.push({
      key: "machine.gpu",
      label: "显卡",
      value: "无法读取",
      confidence: "unknown",
    });
  }

  rows.push(
    machine?.virtualizationEnabled == null
      ? {
          key: "machine.virtualization",
          label: "虚拟化",
          value: "无法确认",
          confidence: "unknown" as Confidence,
        }
      : {
          key: "machine.virtualization",
          label: "虚拟化",
          value: machine.virtualizationEnabled
            ? "已启用（WSL2 / Docker 可用）"
            : "未启用",
          confidence: machine.virtualizationEnabled
            ? ("ok" as Confidence)
            : ("unknown" as Confidence),
        },
  );

  return (
    <div className="stagger flex flex-col gap-0.5">
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => onSelect(machineKey(r.key))}
          className="hover:bg-[color:var(--surface-hover)] flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-left transition-colors duration-150"
        >
          <StatusMark confidence={r.confidence} />
          <span className="text-[color:var(--text-secondary)] w-[64px] shrink-0 text-[12.5px]">
            {r.label}
          </span>
          <span className="text-[color:var(--text-primary)] min-w-0 flex-1 truncate text-[13px]">
            {r.value}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: software
// ---------------------------------------------------------------------------

function SoftwareSection() {
  const inventory = useApp((s) => s.inventory);
  const phase = useApp((s) => s.inventoryPhase);
  const error = useApp((s) => s.inventoryError);
  const scanInstalled = useApp((s) => s.scanInstalled);
  const catalogue = useApp((s) => s.catalogue);
  const selectedItemId = useApp((s) => s.selectedItemId);
  const selectItem = useApp((s) => s.selectItem);
  const explained = useApp((s) => s.explained);
  const explainedPhase = useApp((s) => s.explainedPhase);
  const loadExplained = useApp((s) => s.loadExplained);

  useEffect(() => {
    if (explainedPhase === "idle") void loadExplained();
  }, [explainedPhase, loadExplained]);

  if (phase === "error") {
    return (
      <EmptyBlock
        title="无法读取软件信息"
        body={error ?? "未知原因"}
        action={{ label: "重新检查", onClick: () => void scanInstalled() }}
      />
    );
  }

  const items = inventory?.items ?? [];
  if (phase === "idle" || phase === "scanning") {
    return <LoadingBlock label="正在通过注册表、PATH 与 winget 检查…" />;
  }

  // Grouped by the category Rust assigns, in the catalog's own order. Grouping
  // rather than one flat list because "which of these 21 programs do I have"
  // is a different question per kind of tool.
  const byCategory = new Map<string, SoftwareInfo[]>();
  for (const item of items) {
    const descriptor = catalogue.find((c) => c.id === item.id);
    const key = descriptor?.category ?? "development";
    const list = byCategory.get(key) ?? [];
    list.push(item);
    byCategory.set(key, list);
  }

  const order = ["development", "editor", "aiTool", "runtime"];

  // Knowledge is looked up per row rather than fetched per row. The map is built
  // once so a 21-row list does not do 21 linear scans.
  const knowledgeById = new Map(explained.map((e) => [e.knowledge.id as string, e]));

  return (
    <div className="flex flex-col gap-8">
      <header className="rise">
        <h1 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          这台电脑装了什么
        </h1>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px]">
          检查了 {items.length} 个程序，
          {items.filter((i) => i.installed).length} 个已安装
          {items.some((i) => !i.installed && i.confidence === "unknown") &&
            `，${items.filter((i) => !i.installed && i.confidence === "unknown").length} 个无法确认`}
        </p>
      </header>

      {/* Only rendered when something is actually missing, so a healthy install
          does not carry a permanent notice students learn to skip. */}
      {explainedPhase === "error" && (
        <div className="glass-soft rounded-[12px] px-4 py-3">
          <p className="text-[color:var(--text-tertiary)] text-[12.5px]">
            说明内容未能读取，下面只显示检测结果。程序是否可以安装不受影响。
          </p>
        </div>
      )}

      {order.map((key) => {
        const list = byCategory.get(key);
        if (!list || list.length === 0) return null;
        const name = catalogue.find((c) => c.category === key)?.categoryName ?? key;
        return (
          <section key={key} className="rise">
            <SectionLabel>
              {name} · {list.length}
            </SectionLabel>
            <div className="stagger flex flex-col gap-1">
              {list.map((item) => {
                const id = softwareKey(item.id);
                return (
                  <SoftwareRow
                    key={item.id}
                    item={item}
                    catalogue={catalogue}
                    knowledge={knowledgeById.get(item.id) ?? null}
                    selected={selectedItemId === id}
                    onClick={() => selectItem(id)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SoftwareRow({
  item,
  catalogue,
  knowledge,
  selected,
  onClick,
}: {
  item: SoftwareInfo;
  catalogue: SoftwareDescriptor[];
  /**
   * The explanation for this program, or `null` when the knowledge layer has no
   * entry for it.
   *
   * `null` is not an error state. The row falls back to the catalog's own
   * `purpose`, which is what the app showed before this layer existed — so a
   * missing knowledge file degrades to the previous behaviour rather than to a
   * blank row.
   */
  knowledge: ExplainedSoftware | null;
  selected: boolean;
  onClick: () => void;
}) {
  const meta = describeSoftware(item.id, catalogue);
  const descriptor = catalogue.find((c) => c.id === item.id);
  const detectOnly = descriptor ? !descriptor.installable : false;

  // The knowledge file's own purpose wins when it has one: it is written for a
  // student and is editable without a rebuild.
  const purpose =
    knowledge && knowledge.knowledge.purposes.length > 0
      ? knowledge.knowledge.purposes[0]
      : meta.purpose;

  const detail = item.installed
    ? [item.version && `版本 ${item.version}`, item.onPath && "命令行可用"]
        .filter(Boolean)
        .join(" · ") || purpose
    : item.confidence === "unknown"
      ? "检测未完成，无法判断"
      : // The purpose line is the point of the row. "未安装" alone tells a
        // student nothing they could act on; knowing it is "代码版本管理与下载"
        // is what lets them decide.
        purpose;

  // The mark distinguishes three situations that a single `confidence` cannot.
  //
  // A program this tool *manages* and that is absent is a real, actionable gap —
  // a red cross is right. A program it only *detects* being absent is not a
  // defect at all: the tool never offered to install it, so drawing the same red
  // cross reports a failure the student never agreed to. That case gets a hollow
  // mark, which reads as "not present, nothing is wrong" rather than as an error.
  //
  // This was a real complaint on the rendered screen: CMake showed a red ✗ beside
  // "管理 C/C++ 项目的构建", which reads as though the tool had tried and failed.
  const mark: Confidence =
    !item.installed && item.confidence === "fail" && detectOnly
      ? "skipped"
      : item.confidence;

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-150",
        selected
          ? "bg-[color:var(--surface-active)]"
          : "hover:bg-[color:var(--surface-hover)]",
      )}
    >
      <SoftwareIcon id={item.id} size={28} />

      <StatusMark confidence={mark} />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-[color:var(--text-primary)] truncate text-[13.5px]">
            {knowledge?.knowledge.name ?? item.name}
          </span>
          {detectOnly && (
            <span
              className="text-[color:var(--text-quiet)] shrink-0 text-[10.5px]"
              title="本工具只检测，不会替你安装"
            >
              仅检测
            </span>
          )}
        </span>
        <span className="text-[color:var(--text-quiet)] block truncate text-[12px]">
          {detail}
        </span>
      </span>

      <Chevron />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section: config
// ---------------------------------------------------------------------------

function ConfigSection() {
  const capabilities = useApp((s) => s.capabilities);
  const selectedItemId = useApp((s) => s.selectedItemId);
  const selectItem = useApp((s) => s.selectItem);

  // Config problems are pulled from the capabilities' *manual* requirements —
  // the ones the tool can report on but not satisfy by itself (Git identity,
  // proxy, SSH). Derived rather than re-probed, so this pane can never disagree
  // with the capability rows that produced it.
  const manual = capabilities.flatMap((c) =>
    c.requirements
      .filter((r) => r.key.startsWith("config."))
      .map((r) => ({ capability: c, requirement: r })),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="rise">
        <h1 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          需要你亲自完成的部分
        </h1>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed">
          有些配置涉及你的身份或账号，本工具不会替你填。这里只告诉你缺什么、怎么补。
        </p>
      </header>

      {manual.length === 0 ? (
        <EmptyBlock
          title="暂时没有需要你手动配置的项"
          body="当检测到 Git 身份等信息缺失时，会出现在这里。"
        />
      ) : (
        <div className="rise flex flex-col gap-2">
          {manual.map(({ capability, requirement }) => (
            <button
              key={`${capability.id}-${requirement.key}`}
              type="button"
              onClick={() => selectItem(requirementKey(requirement.key))}
              className={clsx(
                "flex items-start gap-3 rounded-[10px] px-3.5 py-3 text-left transition-colors duration-150",
                selectedItemId === requirementKey(requirement.key)
                  ? "bg-[color:var(--surface-active)]"
                  : "hover:bg-[color:var(--surface-hover)]",
              )}
            >
              <StatusMark confidence={requirementConfidence(requirement)} />
              <span className="min-w-0 flex-1">
                <span className="text-[color:var(--text-primary)] block text-[13.5px]">
                  {requirement.label}
                </span>
                <span className="text-[color:var(--text-quiet)] mt-0.5 block text-[12px] leading-relaxed">
                  {requirement.unknown
                    ? "无法确认当前状态"
                    : (requirement.remedy ?? requirement.observed)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Section: history
// ---------------------------------------------------------------------------

function HistorySection() {
  const session = useApp((s) => s.session);
  const bootstrapSession = useApp((s) => s.bootstrapSession);
  const canResume = useApp((s) => s.canResume);
  const canResumeBootstrap = useApp((s) => s.canResumeBootstrap);
  const resumeInstall = useApp((s) => s.resumeInstall);
  const goTo = useApp((s) => s.goTo);
  const closeDashboard = useApp((s) => s.closeDashboard);
  const reportText = useApp((s) => s.reportText);
  const downloadReport = useApp((s) => s.downloadReport);

  const enterWizard = (screen: "install" | "bootstrap") => {
    closeDashboard();
    goTo(screen);
  };

  const hasAnything = session || bootstrapSession;

  return (
    <div className="flex flex-col gap-8">
      <header className="rise">
        <h1 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          做过什么
        </h1>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed">
          每次安装与配置都会留档。被打断的运行可以接着做，不必从头开始。
        </p>
      </header>

      {(canResume || canResumeBootstrap) && (
        <section className="glass rise rounded-[12px] p-4">
          <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
            有未完成的操作
          </div>
          <p className="text-[color:var(--text-tertiary)] mt-1 text-[12.5px] leading-relaxed">
            上次的{canResumeBootstrap && !canResume ? "环境初始化" : "安装"}
            没有走完，可以直接继续，已经完成的部分不会重做。
          </p>
          <div className="mt-3 flex gap-2">
            {canResume && (
              <Button
                size="sm"
                onClick={() => {
                  void resumeInstall();
                  enterWizard("install");
                }}
              >
                继续安装
              </Button>
            )}
            {canResumeBootstrap && (
              <Button
                size="sm"
                variant={canResume ? "ghost" : "primary"}
                onClick={() => enterWizard("bootstrap")}
              >
                继续初始化
              </Button>
            )}
          </div>
        </section>
      )}

      {!hasAnything && !canResume && !canResumeBootstrap && (
        <EmptyBlock
          title="还没有执行过安装或配置"
          body="回到首次设置开始，或先在上面几个页面看看这台电脑的情况。"
        />
      )}

      {session && <SessionCard session={session} />}
      {bootstrapSession && <BootstrapCard session={bootstrapSession} />}

      {reportText && (
        <section className="rise">
          <SectionLabel>环境报告</SectionLabel>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={() => void downloadReport()}>
              导出报告文件
            </Button>
            <span className="text-[color:var(--text-quiet)] text-[12px]">
              包含检测结果、验证结论与未完成项
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

function SessionCard({ session }: { session: ReturnType<typeof useApp.getState>["session"] }) {
  if (!session) return null;
  const succeeded = session.steps.filter(
    (s) => s.status === "succeeded" || s.status === "succeededWithWarning",
  ).length;

  return (
    <section className="rise">
      <SectionLabel>最近一次安装</SectionLabel>
      <div className="border-[color:var(--line-subtle)] rounded-[10px] border px-3.5 py-3">
        <div className="flex items-center gap-3">
          <StatusMark confidence={session.failedSteps.length === 0 ? "ok" : "fail"} />
          <span className="text-[color:var(--text-primary)] flex-1 text-[13px]">
            {session.profileId}
          </span>
          <span className="text-[color:var(--text-quiet)] tnum text-[12px]">
            {succeeded} / {session.steps.length} 项完成
          </span>
        </div>
        {session.haltedReason && (
          <p className="text-[color:var(--status-warn)] mt-2 text-[12px] leading-relaxed">
            {session.haltedReason}
          </p>
        )}
        <p className="text-[color:var(--text-quiet)] mt-1.5 text-[11.5px]">
          开始于 {formatStamp(session.startedAt)}
        </p>
      </div>
    </section>
  );
}

function BootstrapCard({
  session,
}: {
  session: ReturnType<typeof useApp.getState>["bootstrapSession"];
}) {
  if (!session) return null;
  return (
    <section className="rise">
      <SectionLabel>最近一次环境初始化</SectionLabel>
      <div className="border-[color:var(--line-subtle)] rounded-[10px] border px-3.5 py-3">
        <div className="flex items-center gap-3">
          <StatusMark
            confidence={
              session.failedSteps.length === 0
                ? "ok"
                : session.remaining.length > 0
                  ? "unknown"
                  : "fail"
            }
          />
          <span className="text-[color:var(--text-primary)] flex-1 text-[13px]">
            {session.profileId}
          </span>
          <span className="text-[color:var(--text-quiet)] tnum text-[12px]">
            {session.succeededCount} / {session.steps.length} 项完成
          </span>
        </div>
        {session.verification && (
          <p className="text-[color:var(--text-quiet)] mt-2 text-[12px]">
            {session.verification.summary}
          </p>
        )}
        {session.haltedReason && (
          <p className="text-[color:var(--status-warn)] mt-2 text-[12px] leading-relaxed">
            {session.haltedReason}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Detail pane
// ---------------------------------------------------------------------------

/**
 * The right-hand explanation pane.
 *
 * Keyed strings rather than raw ids, because the pane must be able to explain
 * three different kinds of thing — a capability, a program, a machine fact, a
 * config requirement — and a bare id could collide between them. The prefixes are
 * the cheapest way to keep the namespaces honest without a second store field.
 */
function DetailPane({
  selectedId,
  capabilities,
  onClear,
}: {
  selectedId: string | null;
  capabilities: CapabilityStatus[];
  onClear: () => void;
}) {
  const catalogue = useApp((s) => s.catalogue);
  const inventory = useApp((s) => s.inventory);
  const machine = useApp((s) => s.machine);
  const explained = useApp((s) => s.explained);

  if (!selectedId) {
    return <DetailPlaceholder />;
  }

  if (selectedId.startsWith("cap:")) {
    const id = selectedId.slice(4);
    const capability = capabilities.find((c) => c.id === id);
    if (!capability) return <DetailPlaceholder />;
    return <CapabilityDetail capability={capability} onClear={onClear} />;
  }

  if (selectedId.startsWith("sw:")) {
    const id = selectedId.slice(3);
    const item = inventory?.items.find((i) => i.id === id);
    const descriptor = catalogue.find((c) => c.id === id);
    if (!item || !descriptor) return <DetailPlaceholder />;
    const knowledge = explained.find((e) => e.knowledge.id === id) ?? null;
    return (
      <SoftwareDetail
        item={item}
        descriptor={descriptor}
        knowledge={knowledge}
        onClear={onClear}
      />
    );
  }

  if (selectedId.startsWith("fact:")) {
    return (
      <DetailShell title={factTitle(selectedId)} onClear={onClear}>
        <MachineFactDetail id={selectedId} machine={machine} />
      </DetailShell>
    );
  }

  if (selectedId.startsWith("req:")) {
    const requirement = capabilities
      .flatMap((c) => c.requirements)
      .find((r) => requirementKey(r.key) === selectedId);
    if (!requirement) return <DetailPlaceholder />;
    return <RequirementDetail requirement={requirement} onClear={onClear} />;
  }

  return <DetailPlaceholder />;
}

function DetailPlaceholder() {
  return (
    <div className="text-[color:var(--text-quiet)] pt-2 text-[12.5px] leading-relaxed">
      选择左边的任意一项，这里会说明它是什么、为什么需要它，以及当前的具体情况。
    </div>
  );
}

function DetailShell({
  title,
  subtitle,
  onClear,
  children,
}: {
  title: string;
  subtitle?: string;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fade flex flex-col gap-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[color:var(--text-strong)] text-[15px] font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClear}
            className="text-[color:var(--text-quiet)] hover:text-[color:var(--text-secondary)] mt-0.5 shrink-0 text-[14px] leading-none"
            aria-label="关闭详情"
          >
            ✕
          </button>
        </div>
        {subtitle && (
          <p className="text-[color:var(--text-tertiary)] mt-2 text-[12.5px] leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function CapabilityDetail({
  capability,
  onClear,
}: {
  capability: CapabilityStatus;
  onClear: () => void;
}) {
  const tone = capabilityTone(capability.status);
  const required = capability.requirements.filter((r) => r.necessity === "required");
  const optional = capability.requirements.filter((r) => r.necessity === "optional");

  return (
    <DetailShell
      title={capability.name}
      subtitle={capability.description}
      onClear={onClear}
    >
      <div className="flex items-center gap-2">
        <StatusMark confidence={tone.confidence} />
        <span className="text-[color:var(--text-primary)] text-[12.5px]">
          {tone.label}
        </span>
        <span className="text-[color:var(--text-quiet)] tnum ml-auto text-[11.5px]">
          {capability.metCount}/{capability.requiredCount}
        </span>
      </div>

      <div>
        <SectionLabel>需要满足</SectionLabel>
        <div className="flex flex-col gap-2">
          {required.map((r) => (
            <RequirementLine key={r.key} requirement={r} />
          ))}
        </div>
      </div>

      {optional.length > 0 && (
        <div>
          <SectionLabel>可选加分项</SectionLabel>
          <div className="flex flex-col gap-2">
            {optional.map((r) => (
              <RequirementLine key={r.key} requirement={r} />
            ))}
          </div>
        </div>
      )}

      {capability.status !== "available" && (
        <div className="border-[color:var(--line-subtle)] border-t pt-4">
          <SectionLabel>怎么补</SectionLabel>
          <p className="text-[color:var(--text-primary)] text-[12.5px] leading-relaxed">
            {capability.summary || "缺少可执行的建议。"}
          </p>
        </div>
      )}
    </DetailShell>
  );
}

function RequirementLine({ requirement }: { requirement: RequirementOutcome }) {
  return (
    <div className="flex items-start gap-2.5">
      <StatusMark confidence={requirementConfidence(requirement)} />
      <div className="min-w-0 flex-1">
        <div className="text-[color:var(--text-secondary)] text-[12.5px] leading-snug">
          {requirement.label}
        </div>
        <div className="text-[color:var(--text-quiet)] text-[11.5px]">
          {requirement.unknown ? "无法确认" : requirement.observed}
        </div>
      </div>
    </div>
  );
}

function SoftwareDetail({
  item,
  descriptor,
  knowledge,
  onClear,
}: {
  item: SoftwareInfo;
  descriptor: SoftwareDescriptor;
  /**
   * The explanation for this program, or `null` when the knowledge layer has no
   * entry.
   *
   * Every knowledge-backed section below is conditional on this. A program with
   * no knowledge file shows status and detection sources — less, not nothing, and
   * certainly not an empty "为什么需要" heading that reads as a bug.
   */
  knowledge: ExplainedSoftware | null;
  onClear: () => void;
}) {
  // Same distinction as the row: an absent program this tool does not manage is
  // "not present", not "something failed". It gets the neutral mark and a status
  // word that says who would install it.
  const status: Confidence = item.installed
    ? "ok"
    : !descriptor.installable && item.confidence === "fail"
      ? "skipped"
      : item.confidence;

  const k = knowledge?.knowledge ?? null;

  return (
    <DetailShell
      // The knowledge name wins when there is one: a school can correct it
      // without a rebuild, which is the reason the file exists.
      title={k?.name ?? descriptor.name}
      subtitle={k?.description ?? descriptor.purpose}
      onClear={onClear}
    >
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <DetailRow
          label="状态"
          value={
            item.installed
              ? "已安装"
              : item.confidence === "unknown"
                ? "无法确认"
                : descriptor.installable
                  ? "未安装"
                  : "未安装（需自行获取）"
          }
          confidence={status}
        />
        {item.version && <DetailRow label="版本" value={item.version} />}
        <DetailRow
          label="命令行"
          value={item.onPath ? "可用" : item.installed ? "不可用" : "—"}
          confidence={item.installed ? (item.onPath ? "ok" : "unknown") : "skipped"}
        />
        <DetailRow
          label="管理方式"
          value={descriptor.installable ? "本工具可安装" : "仅检测，需自行安装"}
        />
        {/* The category, when knowledge supplies one, gives the row context the
            catalog's own grouping does not — "编程语言" against "开发工具". */}
        {k && k.category && <DetailRow label="分类" value={k.category} />}
      </div>

      {/*
        Version notes, and the deliberate absence of a verdict.
        ────────────────────────────────────────────────────────
        The note states that 3.13/3.14 are newer than most of the AI ecosystem
        targets. It does not say the student chose wrong — a note carries a range
        and a reason, never a pass/fail, so nothing here can render as an error
        mark. See `modules/knowledge/mod.rs`.
      */}
      {knowledge && knowledge.applicableNotes.length > 0 && (
        <div>
          <SectionLabel>关于这个版本</SectionLabel>
          <div className="flex flex-col gap-2.5">
            {knowledge.applicableNotes.map((note) => (
              <div
                key={note.topic}
                className="border-[color:var(--line-default)] border-l-2 pl-3"
              >
                <div className="text-[color:var(--text-secondary)] text-[12px] font-medium">
                  {note.topic}
                </div>
                <p className="text-[color:var(--text-tertiary)] mt-1 text-[12px] leading-relaxed">
                  {note.note.trim()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* "为什么需要" — the section the whole knowledge layer exists to fill. */}
      {k && k.purposes.length > 0 && (
        <div>
          <SectionLabel>为什么需要</SectionLabel>
          <ul className="flex flex-col gap-1.5">
            {k.purposes.map((p) => (
              <li
                key={p}
                className="text-[color:var(--text-secondary)] flex items-start gap-2 text-[12.5px] leading-relaxed"
              >
                <span className="text-[color:var(--text-quiet)] mt-[3px] shrink-0 text-[10px]">
                  ·
                </span>
                <span className="min-w-0 flex-1">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The paragraph a student reads when they have never heard of this. */}
      {k && k.studentExplanation && (
        <div>
          <SectionLabel>说明</SectionLabel>
          <p className="text-[color:var(--text-tertiary)] text-[12.5px] leading-relaxed whitespace-pre-line">
            {k.studentExplanation.trim()}
          </p>
        </div>
      )}

      {/* The links between this program and the rest of the model. Rendered as
          names rather than ids, because an id is developer vocabulary. */}
      {knowledge && knowledge.capabilityNames.length > 0 && (
        <div>
          <SectionLabel>关联能力</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {knowledge.capabilityNames.map((n) => (
              <span
                key={n}
                className="border-[color:var(--line-default)] bg-[color:var(--surface-inset)] text-[color:var(--text-primary)] rounded-[6px] border px-2 py-[3px] text-[11.5px]"
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {k && k.dependsOn.length > 0 && (
        <div>
          <SectionLabel>需要先装</SectionLabel>
          <div className="text-[color:var(--text-secondary)] text-[12.5px]">
            {k.dependsOn.map((d) => d).join("、")}
          </div>
        </div>
      )}

      {k && k.commonlyUsedBy.length > 0 && (
        <div>
          <SectionLabel>常与它一起使用</SectionLabel>
          <div className="text-[color:var(--text-secondary)] text-[12.5px]">
            {k.commonlyUsedBy.join("、")}
          </div>
        </div>
      )}

      {item.path && (
        <div>
          <SectionLabel>位置</SectionLabel>
          <p className="selectable text-[color:var(--text-tertiary)] break-all font-mono text-[11px] leading-relaxed">
            {item.path}
          </p>
        </div>
      )}

      {item.hints.length > 0 && (
        <div>
          <SectionLabel>需要注意</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {item.hints.map((h) => (
              <p
                key={h}
                className="border-[color:var(--status-warn)] text-[color:var(--text-secondary)] border-l-2 pl-2.5 text-[12px] leading-relaxed"
              >
                {h}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* The per-source audit trail. This is what makes a surprising result
          ("why does it think I don't have Git?") answerable rather than
          mysterious, and it is the whole reason the Rust side keeps the negative
          findings instead of discarding them. */}
      <div>
        <SectionLabel>检测来源</SectionLabel>
        <div className="flex flex-col gap-1.5">
          {item.evidence.map((ev, i) => (
            <div key={`${ev.source}-${i}`} className="flex items-start gap-2.5">
              <StatusMark
                confidence={
                  ev.outcome === "present"
                    ? "ok"
                    : ev.outcome === "unavailable"
                      ? "unknown"
                      : "fail"
                }
              />
              <span className="text-[color:var(--text-quiet)] w-14 shrink-0 text-[11.5px]">
                {sourceLabel(ev.source)}
              </span>
              <span className="selectable text-[color:var(--text-tertiary)] min-w-0 flex-1 break-all text-[11.5px]">
                {ev.outcome === "present"
                  ? (ev.detail ?? "已检测到")
                  : ev.outcome === "unavailable"
                    ? `无法检查：${ev.detail ?? "未知原因"}`
                    : "未找到"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </DetailShell>
  );
}

function MachineFactDetail({
  id,
  machine,
}: {
  id: string;
  machine: MachineFacts | null;
}) {
  const key = id.slice(5);

  if (!machine) {
    return (
      <p className="text-[color:var(--text-tertiary)] text-[12.5px] leading-relaxed">
        还没有读取到这台机器的信息，请先重新检测。
      </p>
    );
  }

  if (key === "machine.gpu") {
    return (
      <div className="flex flex-col gap-3">
        {machine.gpus.map((g, i) => (
          <div key={`${g.name}-${i}`} className="border-[color:var(--line-subtle)] rounded-[9px] border px-3 py-2.5">
            <div className="text-[color:var(--text-primary)] text-[12.5px]">
              {g.name}
            </div>
            <div className="text-[color:var(--text-quiet)] mt-0.5 text-[11.5px]">
              {g.vramBytes
                ? `显存 ${formatBytes(g.vramBytes)}`
                : "显存未识别（集显或驱动未报告）"}
            </div>
          </div>
        ))}
        <p className="text-[color:var(--text-tertiary)] text-[12px] leading-relaxed">
          显存决定能不能在本地跑大模型。集成显卡共用内存，通常读不到独立显存。
        </p>
      </div>
    );
  }

  const rows: { label: string; value: string }[] = [];
  if (key === "machine.cpu" && machine.cpu) {
    rows.push({ label: "型号", value: machine.cpu.name });
    if (machine.cpu.physicalCores)
      rows.push({ label: "物理核心", value: `${machine.cpu.physicalCores}` });
    if (machine.cpu.logicalCores)
      rows.push({ label: "逻辑线程", value: `${machine.cpu.logicalCores}` });
    if (machine.cpu.maxClockMhz)
      rows.push({ label: "主频", value: `${machine.cpu.maxClockMhz} MHz` });
  }
  if (key === "machine.memory" && machine.memory) {
    rows.push({ label: "总容量", value: formatBytes(machine.memory.totalBytes) });
    if (machine.memory.availableBytes)
      rows.push({
        label: "当前可用",
        value: formatBytes(machine.memory.availableBytes),
      });
  }
  if (key === "machine.virtualization") {
    rows.push({
      label: "虚拟化",
      value:
        machine.virtualizationEnabled == null
          ? "无法确认"
          : machine.virtualizationEnabled
            ? "已启用"
            : "未启用",
    });
    if (machine.hypervisorPresent != null)
      rows.push({
        label: "Hypervisor",
        value: machine.hypervisorPresent ? "运行中" : "未运行",
      });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <DetailRow key={r.label} label={r.label} value={r.value} />
      ))}
    </div>
  );
}

function RequirementDetail({
  requirement,
  onClear,
}: {
  requirement: RequirementOutcome;
  onClear: () => void;
}) {
  return (
    <DetailShell title={requirement.label} onClear={onClear}>
      <div className="flex items-center gap-2">
        <StatusMark confidence={requirementConfidence(requirement)} />
        <span className="text-[color:var(--text-primary)] text-[12.5px]">
          {requirement.unknown ? "无法确认" : requirement.observed}
        </span>
      </div>
      {requirement.remedy ? (
        <div>
          <SectionLabel>怎么做</SectionLabel>
          <p className="text-[color:var(--text-primary)] text-[12.5px] leading-relaxed">
            {requirement.remedy}
          </p>
        </div>
      ) : (
        <p className="text-[color:var(--text-tertiary)] text-[12.5px] leading-relaxed">
          {requirement.met
            ? "这一项已经符合要求。"
            : "这一项需要你在本机自行完成，本工具不会代劳。"}
        </p>
      )}
    </DetailShell>
  );
}

function DetailRow({
  label,
  value,
  confidence,
}: {
  label: string;
  value: string;
  confidence?: Confidence;
}) {
  return (
    <div className="flex items-baseline gap-2">
      {confidence && <StatusMark confidence={confidence} className="translate-y-0.5" />}
      <span className="text-[color:var(--text-quiet)] w-[68px] shrink-0 text-[11.5px]">
        {label}
      </span>
      <span className="text-[color:var(--text-secondary)] min-w-0 flex-1 break-words text-[12px]">
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Key prefixes for the detail pane's single selection field. */
function capabilityKey(id: string): string {
  return `cap:${id}`;
}
function softwareKey(id: string): string {
  return `sw:${id}`;
}
function machineKey(id: string): string {
  return `fact:${id}`;
}
function requirementKey(key: string): string {
  return `req:${key}`;
}

function requirementConfidence(r: RequirementOutcome): Confidence {
  if (r.met) return "ok";
  return r.unknown ? "unknown" : "fail";
}

function factTitle(id: string): string {
  const key = id.slice(5);
  switch (key) {
    case "machine.cpu":
      return "处理器";
    case "machine.memory":
      return "内存";
    case "machine.gpu":
      return "显卡";
    case "machine.virtualization":
      return "虚拟化支持";
    default:
      return "机器信息";
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case "registry":
      return "注册表";
    case "path":
      return "PATH";
    case "winget":
      return "winget";
    default:
      return source;
  }
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

/** Renders an ISO stamp as `2026-01-01 10:05`, or nothing if unparseable. */
function formatStamp(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : iso;
}

function groupCapabilities(capabilities: CapabilityStatus[]) {
  const order = ["development", "aiTooling", "systems"];
  return order
    .map((key) => ({
      key,
      name:
        capabilities.find((c) => c.group === key)?.groupName ??
        (key === "development"
          ? "开发能力"
          : key === "aiTooling"
            ? "AI 工具链"
            : "系统环境"),
      items: capabilities.filter((c) => c.group === key),
    }))
    .filter((g) => g.items.length > 0);
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="border-[color:var(--line-subtle)] flex items-center gap-3 rounded-[10px] border border-dashed px-3 py-2.5"
        >
          <span className="bg-[color:var(--line-default)] h-4 w-4 rounded-full" />
          <span className="bg-[color:var(--line-subtle)] h-3 w-28 rounded" />
          <span className="bg-[color:var(--line-subtle)] h-3 flex-1 rounded" />
        </div>
      ))}
      <p className="text-[color:var(--text-quiet)] mt-1 text-[12.5px]">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 版本 / 授权
// ---------------------------------------------------------------------------

/**
 * The licensing section.
 *
 * ## What this screen has to avoid saying
 *
 * A tier badge next to a working button is the most confusing thing a licence
 * screen can show, and it is exactly what this build produces: the gate ships
 * open, so a "免费版" label sits above a fully enabled install button. The
 * `reason` line returned by Rust is what dissolves that — it says, in the
 * student's own language, that this build does not restrict installation.
 *
 * So the order of the page matters: state what you have, then whether anything
 * is limited, then the activation form. Leading with activation would frame a
 * tool that already works as a tool that is withholding something.
 */
function LicenseSection() {
  const entitlements = useApp((s) => s.entitlements);
  const phase = useApp((s) => s.entitlementsPhase);
  const error = useApp((s) => s.entitlementsError);
  const activating = useApp((s) => s.activatingLicense);
  const loadEntitlements = useApp((s) => s.loadEntitlements);
  const activateLicense = useApp((s) => s.activateLicense);
  const deactivateLicense = useApp((s) => s.deactivateLicense);

  const [key, setKey] = useState("");

  useEffect(() => {
    if (phase === "idle") void loadEntitlements();
  }, [phase, loadEntitlements]);

  if (phase === "loading" && !entitlements) {
    return (
      <div className="flex flex-col gap-6">
        <SectionLabel>版本与授权</SectionLabel>
        <div className="text-[color:var(--text-tertiary)] text-[13px]">
          正在读取…
        </div>
      </div>
    );
  }

  if (!entitlements) {
    return (
      <div className="flex flex-col gap-6">
        <SectionLabel>版本与授权</SectionLabel>
        <EmptyBlock
          title="无法读取授权状态"
          body={
            error ??
            "读取本机授权信息时出错。这不影响检测、安装与配置功能。"
          }
          action={{ label: "重试", onClick: () => void loadEntitlements() }}
        />
      </div>
    );
  }

  const isPro = entitlements.tier === "pro";

  return (
    <div className="flex flex-col gap-8">
      <header className="rise">
        <h1 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          你当前使用的是{entitlements.tierLabel}
        </h1>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed">
          {entitlements.reason}
        </p>
      </header>

      {/* What the tier actually permits, in capability terms rather than
          marketing ones. The second row is the one that matters in this build:
          it spells out that installation is not being withheld. */}
      <section className="glass rose rise rounded-[12px] p-5">
        <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
          功能范围
        </div>
        <div className="mt-3 flex flex-col gap-2.5">
          <EntitlementRow
            label="环境检测"
            detail="读取系统信息、扫描已装软件、分析缺口"
            allowed
          />
          <EntitlementRow
            label="安装与配置"
            detail={
              entitlements.canInstall
                ? entitlements.enforced
                  ? "已授权，可执行安装与初始化"
                  : "本版本不限制此功能"
                : "当前版本未授权，激活后可用"
            }
            allowed={entitlements.canInstall}
          />
        </div>
      </section>

      {/* The activation form. Present even when the gate is open, because a
          student who has a key should be able to enter it, and because the
          absence of a visible activation path is what makes software feel
          crippled. */}
      <section className="rise">
        <SectionLabel>激活</SectionLabel>
        {isPro ? (
          <div className="glass-soft mt-3 rounded-[12px] p-5">
            <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
              已激活
            </div>
            <p className="text-[color:var(--text-tertiary)] mt-1 text-[12.5px] leading-relaxed">
              本机已保存激活信息。卸载或更换电脑后需要重新激活。
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3.5"
              disabled={activating}
              onClick={() => void deactivateLicense()}
            >
              {activating ? "处理中…" : "取消激活"}
            </Button>
          </div>
        ) : (
          <div className="glass-soft mt-3 rounded-[12px] p-5">
            <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
              输入激活码
            </div>
            <p className="text-[color:var(--text-tertiary)] mt-1 text-[12.5px] leading-relaxed">
              没有激活码也可以正常使用本工具。
            </p>
            <div className="mt-3.5 flex gap-2">
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="AISS-XXXX-XXXX"
                aria-label="激活码"
                className="glass-soft text-[color:var(--text-primary)] placeholder:text-[color:var(--text-quiet)] min-w-0 flex-1 rounded-[8px] px-3 py-2 text-[13px] outline-none"
              />
              <Button
                size="sm"
                disabled={activating || key.trim().length === 0}
                onClick={async () => {
                  // Cleared only on success, so a rejected key stays on screen
                  // for the student to correct rather than vanishing.
                  if (await activateLicense(key)) setKey("");
                }}
              >
                {activating ? "激活中…" : "激活"}
              </Button>
            </div>
            {error && (
              <p className="text-[color:var(--text-tertiary)] mt-2.5 text-[12px] leading-relaxed">
                {error}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Honesty about what activation does not do. This build has no account
          and no server, and saying so is better than letting a student assume
          an activation they entered is protecting a purchase it is not. */}
      <p className="text-[color:var(--text-quiet)] rise text-[12px] leading-relaxed">
        本版本不联网校验授权，不收集账号信息，激活信息仅保存在本机。
      </p>
    </div>
  );
}

function EntitlementRow({
  label,
  detail,
  allowed,
}: {
  label: string;
  detail: string;
  allowed: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={clsx(
          "mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full",
          allowed ? "bg-[color:var(--accent)]" : "bg-[color:var(--text-quiet)]",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="text-[color:var(--text-primary)] block text-[13px]">
          {label}
        </span>
        <span className="text-[color:var(--text-tertiary)] mt-0.5 block text-[12px] leading-relaxed">
          {detail}
        </span>
      </span>
    </div>
  );
}

function EmptyBlock({
  title,
  body,
  action,
}: {  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="glass-soft rise rounded-[12px] p-5">
      <div className="text-[color:var(--text-primary)] mb-1.5 text-[13px] font-medium">
        {title}
      </div>
      <p className="text-[color:var(--text-tertiary)] text-[12.5px] leading-relaxed">
        {body}
      </p>
      {action && (
        <Button variant="ghost" size="sm" className="mt-3.5" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="text-[color:var(--text-quiet)] h-3 w-3 shrink-0"
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
  );
}
