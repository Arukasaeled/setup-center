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
 * ## Layout is declared, not inferred
 *
 * This screen used to describe itself as a fixed "three-column structure": a
 * 188px navigation rail, a centre column, and a 340px detail rail. That stopped
 * being true the moment Style and Resources were added, and the code coped the
 * way code usually copes — with a growing chain of exclusions deciding whether
 * the detail rail was allowed to exist:
 *
 *     section !== "style" && section !== "resources" &&
 *     !(section === "software" && selectedItemId?.startsWith("sw:")) && …
 *
 * Four sections that nobody remembered (`history`, `plugins`, `license`,
 * `about`) therefore mounted a 340px column whose only possible content was an
 * empty placeholder. The bug was not the chain; it was that layout was inferred
 * from a list of exceptions rather than declared per page.
 *
 * Each section now declares a {@link PageLayoutContract}: a layout *mode* and
 * whether selecting an item in that section can produce a detail. A new section
 * cannot forget to opt out, because the default is explicit and the shell reads
 * the contract rather than a pile of `section !== …` conditions.
 *
 * ## The three slots, and why they are still semantic
 *
 * Whatever the arrangement, the dashboard renders three roles — navigation,
 * primary content, and detail — tagged with `data-nav`, `data-page` and
 * `data-detail`. The **Experience runtime** writes `data-shell`,
 * `data-nav`, `data-detail` and `data-composition` onto `<html>`, and
 * `src/styles/shell.css` rearranges these same elements accordingly. That is how
 * a style can turn the sidebar into a dock or a menu bar without a single
 * `if (style === …)` reaching this file, and why a style published to the Vault
 * later can do the same without a rebuild.
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
import { Button, SectionLabel, StatusMark } from "../components/ui";
import { StatusBadge } from "../components/StatusBadge";
import { CategoryTabs, type CategoryTab } from "../components/CategoryTabs";
import {
  SoftwareRow,
  recommendationMap,
  type RecommendationTier,
} from "../components/SoftwareRow";
import { EnvironmentScore } from "../components/EnvironmentScore";
import { QuickAction } from "../components/QuickAction";
import { ProNotice } from "../components/ProGate";
import { useApp, type Section } from "../lib/store";
import {
  ContactRows,
  LicenseSection,
  UpgradePrompt,
} from "../components/ActivationPanel";
import { PluginsSection } from "../components/PluginsSection";
import { STYLE_REGISTRY } from "../styles";
import type { PageLayoutContract, SetupStyle } from "../styles/types";
import { ResourceSection } from "./ResourceSection";
import { DetailShell } from "../components/DetailShell";
import { SetupActionButton } from "../components/SetupActionButton";
import { ExperienceSpecimen, ExperienceThumbnail } from "../components/ExperienceSpecimen";
import { ExperiencePlayground } from "../components/TokenTweaker";
import { TransferHistoryTimeline } from "../components/TransferHistoryTimeline";
import { Bookmarks } from "../core/transfer";
import { resolveSetupAction } from "../core/setup/resolver";
import {
  CARD_LABEL,
  COMPOSITION_LABEL,
  DENSITY_LABEL,
  DETAIL_LABEL,
  isRenderable,
  MOTION_LABEL,
  NAV_LABEL,
  resolveExperienceProfile,
  SHELL_LABEL,
  TIER_LABEL,
  TIER_SHORT,
} from "../styles/runtime";
import type {
  CapabilityStatus,
  Confidence,
  EnvironmentPlan,
  ExplainedSoftware,
  MachineFacts,
  Recommendation,
  RequirementOutcome,
  SoftwareDescriptor,
  SoftwareId,
  SoftwareInfo,
} from "../lib/types";

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: "overview", label: "环境概览", hint: "总体状态与缺口" },
  { id: "software", label: "软件", hint: "这台电脑装了什么" },
  { id: "resources", label: "开发资源", hint: "开源项目、模板与灵感" },
  { id: "style", label: "风格", hint: "视觉风格与主题试验场" },
  { id: "config", label: "配置", hint: "身份、路径、代理" },
  { id: "history", label: "历史记录", hint: "做过什么，如何恢复" },
  { id: "plugins", label: "插件", hint: "Claude 中文与效率增强" },
  // "版本与授权" rather than "版本". The section manages the version, the
  // licence, activation and device binding, and `ActivationGate` already
  // promises the customer they can "随时可以在「版本与授权」中升级" — a label
  // reading only 版本 sent them looking for a page that does not exist by that
  // name. One string, two places that must agree.
  { id: "license", label: "版本与授权", hint: "当前权益与激活" },
  { id: "about", label: "关于", hint: "购买与联系作者" },
];

/**
 * The page-layout contract, per section.
 *
 * This replaces the chain of `section !== …` exclusions that used to decide
 * whether the detail rail existed. Read it as the answer to two questions per
 * page: *how is this page laid out*, and *can selecting something in it produce
 * a detail*.
 *
 * The distinction that matters is `selectable`. Only three sections ever put a
 * key into the store's `selectedItemId`: overview (`cap:` and `fact:` keys),
 * software (`sw:`), and config (`config.*` requirements). Every other section
 * used to receive the same 340px rail anyway, which is why opening 历史记录 or
 * 关于 showed a permanently empty column.
 */
const PAGE_LAYOUTS: Record<Section, PageLayoutContract> = {
  // Capabilities and machine facts both select into the detail rail.
  overview: { mode: "master-detail", selectable: true },
  // The software list has its own in-section master-detail pane; the global
  // rail stands down so the same explanation is never rendered twice.
  software: { mode: "master-detail", selectable: true },
  // A dense browsable index with its own filters, search and category pills.
  resources: { mode: "explorer", selectable: false },
  // A gallery of specimens whose detail opens over the page, not beside it.
  style: { mode: "gallery", selectable: false },
  // Config requirements select into the rail: this is genuinely master-detail.
  config: { mode: "master-detail", selectable: true },
  // Resumable sessions and a transfer timeline, read top to bottom.
  history: { mode: "timeline", selectable: false },
  // Plugin toggles and licence scope are prose and controls.
  plugins: { mode: "document", selectable: false },
  license: { mode: "document", selectable: false },
  about: { mode: "document", selectable: false },
};

/** The layout contract for a section, with an explicit default for unknowns. */
function pageLayout(section: Section): PageLayoutContract {
  return PAGE_LAYOUTS[section] ?? { mode: "document", selectable: false };
}

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

  /* Whether the *global* detail slot is on screen with something to show, as
     opposed to whether this page could have one at all.
     The `modal` and `full-page` detail grammars need that distinction; the
     rail-style grammars do not read it.

     `asideMounted` must be computed the same way the render below computes it,
     not merely from `selectable`: in the software section the global rail stands
     down while a program is selected (the section draws its own pane inside
     `section[data-page]`), so a full-page grammar that collapsed the page there
     would hide the pane that is doing the work. */
  const asideMounted =
    pageLayout(section).selectable &&
    !(section === "software" && selectedItemId?.startsWith("sw:"));
  const detailOpen = asideMounted && selectedItemId !== null;

  return (
    <div
      data-shell-root
      /* `data-detail-open` tells the `modal` and `full-page` detail grammars
         whether there is genuinely something to show. Those two grammars cover
         the page when a detail exists, so they must not fire on a page that is
         merely *selectable* but has never been clicked — that collapsed the page
         into an empty dialog. Every other grammar ignores the attribute. */
      data-detail-open={detailOpen ? "" : undefined}
      className="flex h-full"
    >
      <DashboardNav
        section={section}
        onSelect={setSection}
        onExit={closeDashboard}
        theme={theme}
        onTheme={setTheme}
      />

      {/* `display: contents` for layout, a real element for React. The page and
          the detail rail are the shell's direct flex children, so a shell
          grammar can reorder or resize them without fighting a wrapper that
          hardcodes `flex-1`. */}
      <div data-shell-body className="flex min-w-0 flex-1">
        <section
          data-page
          data-window-title={`Setup Center — ${SECTIONS.find((s) => s.id === section)?.label ?? ""}`}
          className="min-w-0 flex-1 overflow-y-auto px-8 py-7"
        >
          {/* The persistent tier row. It sits at the top of every section rather
              than only on 版本与授权, because the whole gap this closes is that a
              FREE customer had no visible route to activation anywhere they
              habitually look.

              The licence section does not get a second copy: it renders the full
              scope list, the contacts and the card already, and stacking the
              entry on top of them would put the same control on screen twice. */}
          {section !== "license" && (
            <div className="mb-6 flex justify-end">
              <UpgradePrompt
                onNavigate={() => setSection("license")}
                onUpgraded={() => setSection("license")}
              />
            </div>
          )}

          {/* A refused gated action surfaces here rather than inside whichever
              section triggered it: the refusal can come from install, resume or
              bootstrap, and the customer should see the same explanation and the
              same route to activation regardless of which one it was. */}
          <ProNotice />
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
          {section === "resources" && <ResourceSection />}
          {section === "style" && <StyleSection />}
          {section === "config" && <ConfigSection />}
          {section === "history" && <HistorySection />}
          {section === "plugins" && <PluginsSection />}
          {section === "license" && <LicenseSection />}
          {section === "about" && <AboutSection />}
        </section>

        {/* The global detail rail, mounted only when the page's layout contract
            says this page can produce a detail.

            Two conditions, and both are facts about the page rather than a list
            of section names to exclude:

            * `selectable` — only overview, software and config ever write a
              `selectedItemId`. Every other section used to mount this column and
              render `DetailPlaceholder` into it forever.
            * the software section renders its *own* pane beside its list, so the
              global rail stands down while a program is selected there rather
              than showing the same explanation in two columns at once. */}
        {asideMounted && (
          <aside
            data-detail
            className="border-[color:var(--line-subtle)] w-[340px] shrink-0 overflow-y-auto border-l px-6 py-7"
          >
              <DetailPane
                selectedId={selectedItemId}
                capabilities={capabilities}
                onClear={() => selectItem(null)}
              />
            </aside>
          )}
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
  // One badge, on the section a student acts on. A badge on every item would
  // turn navigation into a scoreboard, which reads as pressure rather than as
  // information.
  const softwareGaps = useApp((s) => {
    const items = s.inventory?.items ?? [];
    return items.filter((i) => !i.installed && i.confidence !== "unknown").length;
  });

  const badges: Partial<Record<Section, number>> = {
    software: softwareGaps,
  };

  return (
    <nav
      aria-label="导航"
      data-nav
      className="border-[color:var(--line-subtle)] flex w-[188px] shrink-0 flex-col border-r px-3 py-7"
    >
      <div data-nav-brand className="px-2.5 pb-5">
        <div className="text-[color:var(--text-strong)] text-[13.5px] font-semibold tracking-[-0.01em]">
          Setup Center
        </div>
        <div className="text-[color:var(--text-quiet)] mt-0.5 text-[11.5px]">
          本机状态
        </div>
      </div>

      <div data-nav-list className="flex flex-col gap-0.5">
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

      <div data-nav-foot className="mt-auto flex flex-col gap-2 pt-6">
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
  const selectedGoal = goals?.goals.find((g) => g.id === selectedGoalId) ?? null;

  // An advisor summary is only meaningful once a detection has run behind it.
  //
  // `advisor?.summary.score ?? environment.score` looked like a safe fallback but
  // was not: `??` only falls through on null/undefined, and an advisor built
  // against an un-detected machine reports a *defined* 0. On a cold start that
  // put "0% · 没有一项检测完成" at the top of a screen whose own capability lists
  // read "已准备 Python 开发 · C/C++ 学习 · Git 协作…" — the app contradicting
  // itself in its largest type. `detected` exists on the view precisely to
  // distinguish "measured, and it is zero" from "not measured yet", so the
  // fallback is guarded by it.
  const advisorScore = advisor?.detected ? advisor.summary.score : null;
  const advisorHeadline = advisor?.detected ? advisor.summary.headline : null;
  const overallScore = advisorScore ?? environment.score;

  return (
    <div className="flex flex-col gap-8">
      <header>
        {/* The status centre. Phase 6 of the brief asked for 个人状态中心 in place
            of 检测报告, and this is that: a greeting, one number scoped to the
            whole machine, and the two lists a student actually reads — what is
            ready and what is not.

            It is rendered *above* the goal readout rather than instead of it.
            The two answer different questions ("总的来说怎么样" versus "我选的这个
            方向离目标还差多少") and the existing assertion that the goal figure
            names its own scope is what keeps them from reading as a
            contradiction. */}
        <div className="flex items-start justify-between gap-4">
          <EnvironmentScore
            score={overallScore}
            capabilities={capabilities}
            greeting={greeting()}
          />
          <button
            type="button"
            onClick={onRecheck}
            className="text-[color:var(--text-quiet)] hover:text-[color:var(--text-secondary)] mt-1 shrink-0 text-[12px] transition-colors"
          >
            重新检测
          </button>
        </div>

        {/* The goal frame. When a direction is chosen, its completion becomes a
            second, narrower reading of the same machine. When none is chosen — a
            dashboard opened cold — this is absent rather than showing a goal the
            student never picked. */}
        {goalPlan && selectedGoal && (
          <div className="mt-6">
            <GoalReadout plan={goalPlan} goalName={selectedGoal.name} />
            <div className="text-[color:var(--text-quiet)] mt-3 flex items-baseline gap-2 text-[12px]">
              <span className="tnum">
                整体评分 {overallScore} / 100
              </span>
              <span>·</span>
              <span>{advisorHeadline ?? `已经可以做 ${available} 件事`}</span>
            </div>
          </div>
        )}
      </header>

      {/* Recommended actions, ordered. This is the section a student reads when
          they only want to know what to do next, so it comes before the full
          capability breakdown rather than after it.

          Hardware limits are filtered out and shown separately. The distinction
          is the whole reason `kind` carries four values: a memory upgrade is
          correct information but not a next step, and placing it at the top of a
          to-do list asks the student to do something they cannot.

          The first item is promoted out of the list and given the QuickAction
          treatment, because "推荐下一步：安装 Node.js" is the brief's single
          most-wanted line and a five-item list buries it. */}
      {advisor && (
        <section className="rise">
          <SectionLabel>建议的下一步</SectionLabel>
          <div className="stagger flex flex-col gap-2">
            {advisor.summary.recommendations.some((r) => r.kind !== "hardware") ? (
              advisor.summary.recommendations
                .filter((r) => r.kind !== "hardware")
                .slice(0, 5)
                .map((r) => (
                  <RecommendationRow key={`${r.order}-${r.title}`} recommendation={r} />
                ))
            ) : (
              <div className="rounded-[10px] border border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/40 px-3 py-2 text-[12.5px] text-[color:var(--text-secondary)]">
                当前核心工具已全部就绪，无需补装。你可以直接开始项目开发，或前往「软件」自选更多工具。
              </div>
            )}
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
  // Delegates to `QuickAction` rather than re-drawing the same card. The two
  // used to be separate renderers for one concept — "a recommended step and who
  // performs it" — which is how the overview and the goal readout ended up
  // describing the same action with different vocabulary.
  //
  // `onRun` is deliberately not passed: the advisor's recommendations are
  // *pointers*, and turning them into buttons here would promise this app will
  // carry them out. A student who wants to act clicks the capability or the
  // program, which is where a real, verified action lives.
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-[color:var(--text-quiet)] tnum mt-3 shrink-0 text-[12px]">
        {recommendation.order}
      </span>
      <div className="min-w-0 flex-1">
        <QuickAction step={recommendation} />
      </div>
    </div>
  );
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
  // Read here rather than inside the grid so the recommendation tiers come from
  // the same capability resolution the overview renders beside them.
  const capabilities = useApp((s) => s.capabilities);

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

  // Knowledge is looked up per card rather than fetched per card. The map is
  // built once so a 24-card grid does not do 24 linear scans.
  const knowledgeById = new Map(explained.map((e) => [e.knowledge.id as string, e]));

  // The catalog's own category for each item, used for both the tabs and the
  // grid's grouping. Resolved once here rather than per card.
  const categoryOf = new Map<SoftwareId, SoftwareDescriptor>();
  for (const item of items) {
    const descriptor = catalogue.find((c) => c.id === item.id);
    if (descriptor) categoryOf.set(item.id, descriptor);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="rise software-main-header">
        <div className="software-badge-strip inline-flex items-center gap-2 rounded px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider mb-2">
          AUDIT REPORT // 本机软件生态全景
        </div>
        <h1 className="text-[color:var(--text-strong)] text-[22px] font-bold tracking-[-0.02em] software-main-title">
          这台电脑装了什么
        </h1>
        <p className="text-[color:var(--text-tertiary)] mt-1.5 text-[13px] software-stat-line">
          共审计了 <span className="stat-count text-[color:var(--text-strong)] font-semibold">{items.length}</span> 个程序，
          <span className="stat-installed font-bold text-[color:var(--status-ok)] ml-1">
            {items.filter((i) => i.installed).length} 个已安装就绪
          </span>
          {items.some((i) => !i.installed && i.confidence === "unknown") &&
            `，${items.filter((i) => !i.installed && i.confidence === "unknown").length} 个无法确认`}
        </p>
      </header>

      {/* Only rendered when something is actually wrong, so a healthy install
          does not carry a permanent notice students learn to skip. */}
      {explainedPhase === "error" && (
        <div className="glass-soft rounded-[12px] px-4 py-3">
          <p className="text-[color:var(--text-tertiary)] text-[12.5px]">
            说明内容未能读取，下面只显示检测结果。程序是否可以安装不受影响。
          </p>
        </div>
      )}

      {/* Quick link banner to the rich card-grid self-select screen */}
      <div className="rise software-hero-banner flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 shadow-sm">
        <div>
          <div className="text-[14px] font-bold text-[color:var(--text-strong)] banner-title">
            自由自选软件卡片库
          </div>
          <p className="text-[color:var(--text-tertiary)] mt-0.5 text-[12px] banner-desc">
            支持 36 款主流 AI 助手、代码编辑器与开发环境，以卡片形式自由勾选、一键批量安装
          </p>
        </div>
        <Button
          size="sm"
          className="banner-cta"
          onClick={() => {
            useApp.getState().closeDashboard();
            useApp.getState().goTo("software");
          }}
        >
          打开自选卡片库 →
        </Button>
      </div>

      {/* The master-detail split. The right column is wider than the global
          `aside` because a software explanation carries a purpose paragraph, a
          capability list and the action buttons — it is the main event of this
          section, not a footnote to it.

          The breakpoint is `lg` (1024px) rather than `xl` (1280px) because the
          desktop window is commonly ~1040px wide, and at `xl` that produces the
          stacked layout — the list with the explanation *below* it — which is
          not the two-column shape this section is for. Below `lg` they stack,
          because squeezing both into 320px wraps the explanation to one word per
          line, which is worse than scrolling. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-7">
        <div className="min-w-0 flex-1">
          <SoftwareGrid
            items={items}
            categoryOf={categoryOf}
            catalogue={catalogue}
            knowledgeById={knowledgeById}
            recommendations={recommendationMap(capabilities)}
            selectedItemId={selectedItemId}
            onSelect={selectItem}
          />
        </div>

        {/* Only shown once something is selected, so the section does not open
            with an empty pane occupying half the width. */}
        {selectedItemId?.startsWith("sw:") && (
          <div className="shrink-0 lg:sticky lg:top-0 lg:w-[380px]">
            <DetailPane
              selectedId={selectedItemId}
              capabilities={capabilities}
              onClear={() => selectItem(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The software master-detail: a list on the left, the explanation on the right.
 *
 * ## Why the grid became a list
 *
 * The grid was a wall of equal-weight tiles, and its own detail pane lived
 * outside it — so the section read as two unrelated surfaces. A master list is
 * what makes the pane make sense: you scan down, you land on a row, the pane
 * answers what you landed on. That is the whole of this round's UI brief.
 *
 * ## Search and category both narrow the same list
 *
 * They compose rather than replace each other, because the questions are
 * independent: "where is Git" and "show me the AI tools" are both asked about
 * the same catalogue. Applying one does not clear the other.
 *
 * Splitting this out of `SoftwareSection` is what lets the filter state exist
 * at all: the section above also owns the loading and error branches, and
 * holding a `useState` there would put a hook next to early returns.
 */
function SoftwareGrid({
  items,
  categoryOf,
  catalogue,
  knowledgeById,
  recommendations,
  selectedItemId,
  onSelect,
}: {
  items: SoftwareInfo[];
  categoryOf: Map<SoftwareId, SoftwareDescriptor>;
  catalogue: SoftwareDescriptor[];
  knowledgeById: Map<string, ExplainedSoftware>;
  recommendations: Map<string, RecommendationTier>;
  selectedItemId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");

  // Tabs are built from the *rendered* items, in the catalog's declared order.
  //
  // Built from the data rather than hard-coded so a renamed or added category
  // in Rust appears here automatically. A hard-coded list would let a tab select
  // a group that no longer exists and silently show an empty grid.
  //
  // `aiCreative` was added in 0.1.2 with the AIGC entries. It is listed *after*
  // `aiTool` deliberately: a student looking for a coding assistant should reach
  // "AI 工具" first, and the video/image tools are the second question.
  const order = ["development", "editor", "aiTool", "aiCreative", "runtime"];
  const tabs: CategoryTab[] = [
    { key: "", label: "全部", count: items.length },
    ...order
      .map((key) => {
        const list = items.filter((i) => categoryOf.get(i.id)?.category === key);
        return {
          key,
          // The display name comes from the same descriptor the row reads, so
          // the tab and the row's own category label cannot disagree.
          label: categoryOf.get(list[0]?.id)?.categoryName ?? key,
          count: list.length,
        };
      })
      .filter((t) => t.count > 0),
  ];

  // A rescan can empty the selected category (a program can disappear). Falling
  // back to 全部 rather than rendering nothing is what stops the list from
  // looking broken right after a recheck.
  const inCategory =
    category === ""
      ? items
      : items.filter((i) => categoryOf.get(i.id)?.category === category);
  const activeTab = inCategory.length > 0 ? category : "";

  // Search matches the names a student would actually type: the knowledge name
  // when there is one, the catalogue name, and the raw id. Matching only the
  // display name would fail on "vscode" for a row titled "Visual Studio Code".
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? inCategory.filter((item) => {
        const knowledge = knowledgeById.get(item.id);
        const descriptor = categoryOf.get(item.id);
        const haystack = [
          item.id,
          item.name,
          knowledge?.knowledge.name,
          descriptor?.name,
          descriptor?.purpose,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
    : inCategory;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CategoryTabs tabs={tabs} active={activeTab} onSelect={setCategory} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索软件…"
          aria-label="搜索软件"
          data-software-search
          className={clsx(
            "w-[168px] shrink-0 rounded-[9px] border px-3 py-1.5 text-[12.5px]",
            "border-[color:var(--line-subtle)] bg-transparent",
            "text-[color:var(--text-primary)] placeholder:text-[color:var(--text-quiet)]",
            "focus:border-[color:var(--line-strong)] focus:outline-none",
            "transition-colors duration-150",
          )}
        />
      </div>

      {/* The list is its own scroll container so a long catalogue does not push
          the header off screen while the pane stays where it is. */}
      <div
        data-software-list
        className="stagger flex max-h-[calc(100vh-260px)] flex-col gap-0.5 overflow-y-auto pr-1"
      >
        {visible.length === 0 ? (
          <p className="text-[color:var(--text-quiet)] px-3 py-6 text-center text-[12.5px]">
            {needle
              ? `没有匹配「${query.trim()}」的软件`
              : "这一类暂时没有软件"}
          </p>
        ) : (
          visible.map((item) => {
            const id = softwareKey(item.id);
            const descriptor = categoryOf.get(item.id);
            const knowledge = knowledgeById.get(item.id) ?? null;
            // Every software row carries its own resolved Setup Action, exactly
            // like a resource card does — the row is never a dead entry that
            // only becomes actionable after you open its detail.
            //
            // The action renders as a SIBLING of the row, not inside it: the row
            // root is a whole-row <button>, and nesting a control there is the
            // DOM bug tools/hydration-sweep.mjs asserts against. It also keeps
            // the row's own accessible name (and innerText) untouched.
            const resolved = resolveSetupAction({
              type: "software",
              id: item.id,
              name: knowledge?.knowledge.name ?? item.name,
              installed: item.installed,
            });
            return (
              <div key={item.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SoftwareRow
                    item={item}
                    catalogue={catalogue}
                    knowledge={knowledge}
                    // A program this tool cannot install is never "可选": offering it
                    // as a recommendation would promise an action that does not exist.
                    recommendation={
                      descriptor && !descriptor.installable
                        ? "detectOnly"
                        : (recommendations.get(item.id) ?? "optional")
                    }
                    selected={selectedItemId === id}
                    onClick={() => onSelect(id)}
                  />
                </div>
                <SetupActionButton
                  action={resolved.primaryAction}
                  secondaryActions={resolved.secondaryActions}
                  itemMeta={{ id: item.id, name: item.name, type: "software" }}
                  size="sm"
                  showPmSelector={false}
                  className="shrink-0"
                />
              </div>
            );
          })
        )}
      </div>
    </div>
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

      {/* Transfer 流转履历 */}
      <TransferHistoryTimeline />
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
      <DetailPaneShell title={factTitle(selectedId)} onClear={onClear}>
        <MachineFactDetail id={selectedId} machine={machine} />
      </DetailPaneShell>
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

function DetailPaneShell({
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

/**
 * The Setup Action for a software item, resolved from the same contract every
 * other card type uses.
 *
 * `reveal` used to be a dead label — a student was told 「已在环境就绪」 with no
 * way to act, and the executor had no `reveal` arm at all, so the button would
 * have reported 「未知的 Setup 操作类型」. Both sides are now real: this renders
 * whatever the resolver decides, and the executor knows how to honour it.
 */
function DetailSetupAction({
  item,
  knowledge,
}: {
  item: SoftwareInfo;
  knowledge: ExplainedSoftware | null;
}) {
  const resolved = resolveSetupAction({
    type: "software",
    id: item.id,
    name: knowledge?.knowledge.name ?? item.name,
    installed: item.installed,
  });
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>可执行操作</SectionLabel>
      <SetupActionButton
        action={resolved.primaryAction}
        secondaryActions={resolved.secondaryActions}
        itemMeta={{
          id: resolved.itemId,
          name: resolved.name,
          type: "software",
        }}
        size="sm"
        showPmSelector={false}
        className="w-full"
      />
      {resolved.primaryAction.description && (
        <p className="text-[color:var(--text-quiet)] text-[11.5px] leading-relaxed">
          {resolved.primaryAction.description}
        </p>
      )}
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
    <DetailPaneShell
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
    </DetailPaneShell>
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
    <DetailPaneShell
      // The knowledge name wins when there is one: a school can correct it
      // without a rebuild, which is the reason the file exists.
      title={k?.name ?? descriptor.name}
      subtitle={k?.description ?? descriptor.purpose}
      onClear={onClear}
    >
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        {/* The status as a badge rather than only as a `DetailRow` mark. The row
            shape puts the glyph and the word at opposite ends of the pane, so a
            student had to join them up themselves; the badge states the bare
            fact once, and the rows below add the detail that qualifies it. */}
        <div className="mb-1">
          <StatusBadge confidence={status} />
        </div>
        <DetailRow
          label="状态"
          value={
            item.installed
              ? "已安装"
              : item.confidence === "unknown"
                ? "无法确认"
                : descriptor.installable
                  ? "未安装"
                  : "未安装（需你手动安装）"
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
          value={descriptor.installable ? "本工具可一键安装" : "仅检测（需你手动安装）"}
        />
        {/* The category, when knowledge supplies one, gives the row context the
            catalog's own grouping does not — "编程语言" against "开发工具". */}
        {k && k.category && <DetailRow label="分类" value={k.category} />}
      </div>

      {/* The detail pane carries the same resolved action as the row, so the two
          never disagree and neither is the only door to the real flow. */}
      <DetailSetupAction item={item} knowledge={knowledge} />

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
    </DetailPaneShell>
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
    <DetailPaneShell title={requirement.label} onClear={onClear}>
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
    </DetailPaneShell>
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

/**
 * The status centre's opening word.
 *
 * The brief asks the dashboard to greet a student rather than to report at
 * them. This is the only string on the overview that is not derived from a
 * measurement, so it is kept trivial on purpose: it says nothing about the
 * machine, which means it cannot be wrong about it.
 *
 * Buckets rather than an exact hour, because "凌晨好" at 03:00 is technically
 * accurate and socially odd.
 */
function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
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
 * ## The two states the brief specifies
 *
 * ```text
 * 免费版  →  当前版本：免费版 / 可检测环境，不包含自动安装 / [输入激活码]
 * 专业版  →  已激活专业版 / 自动安装与配置功能已解锁 / 设备绑定 + 激活时间
 * ```
 *
 * Both are rendered from `entitlements` rather than from a frontend tier check,
 * so the wording of a lock and the reason for it are one decision made in Rust.
 *
 * ## What this screen deliberately does not offer
 *
 * No export, no "view full key", no copy button, and no way to see the
 * activation code — the brief's "用户不可查看". This is enforced upstream as
 * well as here: `license_status` returns only an abbreviated device digest, and
 * there is no command that returns the code at all. So this is not a promise the
 * screen is keeping; it is a screen that has nothing to leak.
 *
 * ## The device-mismatch state
 *
 * A third rendering, not a variant of "free". A customer who copied `license.dat`
 * to a second PC holds a real code and needs to be told that, rather than told
 * their key is invalid. It also reports whether the hardware probes were
 * *reliable*, because a mismatch on a machine where they were not is not
 * evidence of anything and must not read as an accusation.
 */

/**
 * Experience Gallery.
 *
 * Browses what this build can render as *whole products*, not as palettes. Each
 * card shows a live specimen of the experience's shell, navigation, composition
 * and card language, and states its tier and grammar in words — because "Neo
 * Brutalism vs DOS Utility" has to be legible as a structural difference, not
 * just as a difference in hue.
 *
 * Two rules the previous gallery broke and this one keeps:
 *
 *  - **Preview before Apply.** Seeing an experience used to require becoming it
 *    app-wide, so browsing repainted the whole window on every click. The
 *    specimen renders from the same token table and the same grammar enum the
 *    app does, so preview fidelity is structural rather than approximate.
 *  - **No hand-written actions.** Apply, 调校, 导出 and 另存为 all come from
 *    `resolveSetupAction`, the same resolver every resource card uses. The
 *    gallery cannot drift from the contract because it does not own one.
 */
function StyleSection() {
  const activeStyle = useApp((s) => s.activeStyle);
  const inventory = useApp((s) => s.inventory);
  // Subscribed rather than read once: forking a style registers a new entry in
  // STYLE_REGISTRY from outside React, so the grid has to be told to re-render.
  const customVersion = useApp((s) => s.customExperiencesVersion);
  const [styleBookmarks, setStyleBookmarks] = useState<string[]>(() => Bookmarks.getAll());
  const [previewStyle, setPreviewStyle] = useState<SetupStyle | null>(null);
  const [playgroundStyleId, setPlaygroundStyleId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "implemented" | "bookmarks">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => Bookmarks.subscribe((b) => setStyleBookmarks(b)), []);

  // The playground is opened by the Setup Action executor rather than by a
  // button in this file, so a card's 「调校此体验」 secondary works through the
  // same contract every other action uses.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ styleId?: string }>).detail;
      setPreviewStyle(null);
      setPlaygroundStyleId(detail?.styleId ?? activeStyle);
    };
    window.addEventListener("setup:open-playground", onOpen);
    return () => window.removeEventListener("setup:open-playground", onOpen);
  }, [activeStyle]);

  const filteredStyles = useMemo(() => {
    return STYLE_REGISTRY.filter((preset) => {
      if (filter === "implemented" && !preset.implemented) return false;
      if (filter === "bookmarks" && !styleBookmarks.includes(preset.id)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = preset.name.toLowerCase().includes(q);
        const matchesSub = preset.subtitle.toLowerCase().includes(q);
        const matchesInspiration = preset.inspiration.toLowerCase().includes(q);
        const matchesTags = preset.tags.some((t) => t.toLowerCase().includes(q));
        if (!matchesName && !matchesSub && !matchesInspiration && !matchesTags) return false;
      }
      return true;
    });
    // `customVersion` is a dependency on purpose: it is how a newly forked
    // experience reaches this list without a reload.
  }, [filter, styleBookmarks, searchQuery, customVersion]);

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const preset of STYLE_REGISTRY) {
      const tier = resolveExperienceProfile(preset).tier;
      counts[tier] = (counts[tier] ?? 0) + 1;
    }
    return counts;
  }, [customVersion]);

  const isActiveStyle = (id: string) =>
    activeStyle === id || (activeStyle === "p5-comic" && id === "phantom-comic");

  const resolvedFor = (preset: SetupStyle) =>
    resolveSetupAction({ type: "style", data: preset }, inventory);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="rise flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider bg-[color:var(--status-accent)] text-[color:var(--text-inverse)]">
            EXPERIENCE GALLERY // 体验画廊
          </div>
          <h1 className="text-[color:var(--text-strong)] mt-2 text-[22px] font-bold tracking-[-0.02em]">
            完整体验与版式语法画廊
          </h1>
          <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed max-w-2xl">
            每一套体验声明自己的外壳语法、导航语法、详情呈现、卡片语言与版面构成，不再只是换色。
            卡片上是缩略样张，点击可预览完整样张后再决定是否应用。
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--text-quiet)]">
            {(["token", "component", "composition", "experience"] as const).map((tier) => (
              <span key={tier} className="font-mono">
                {TIER_SHORT[tier]} {TIER_LABEL[tier].split("·")[1]?.trim() ?? tier}
                <span className="text-[color:var(--text-secondary)]"> {tierCounts[tier] ?? 0}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant={playgroundStyleId ? "primary" : "quiet"}
            onClick={() =>
              setPlaygroundStyleId((prev) => (prev ? null : activeStyle))
            }
          >
            {playgroundStyleId ? "收起调校台" : "⌗ 调校当前体验"}
          </Button>
        </div>
      </header>

      {/* The Experience Playground. It replaces the old standalone "token
          tweaker": adjustments happen against a specimen beside the controls and
          only reach the app on 应用到应用, so dragging a slider no longer
          repaints the whole window on every frame. */}
      {playgroundStyleId && (
        <div className="rise">
          <ExperiencePlayground styleId={playgroundStyleId} />
        </div>
      )}

      {notice && (
        <div className="rise rounded-[var(--radius-control)] border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] px-3.5 py-2 text-[12px] text-[color:var(--text-primary)]">
          {notice}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={clsx(
              "px-3 py-1.5 rounded-[var(--radius-control)] text-[12px] font-medium transition-colors border",
              filter === "all"
                ? "bg-[color:var(--status-accent)] text-[color:var(--accent-on)] border-transparent font-bold"
                : "border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/70 text-[color:var(--text-secondary)] hover:text-[color:var(--text-strong)]",
            )}
          >
            全部体验 ({STYLE_REGISTRY.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("implemented")}
            className={clsx(
              "px-3 py-1.5 rounded-[var(--radius-control)] text-[12px] font-medium transition-colors border",
              filter === "implemented"
                ? "bg-[color:var(--status-accent)] text-[color:var(--accent-on)] border-transparent font-bold"
                : "border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/70 text-[color:var(--text-secondary)] hover:text-[color:var(--text-strong)]",
            )}
          >
            已实装 ({STYLE_REGISTRY.filter((s) => s.implemented).length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("bookmarks")}
            className={clsx(
              "px-3 py-1.5 rounded-[var(--radius-control)] text-[12px] font-medium transition-colors border",
              filter === "bookmarks"
                ? "bg-amber-400 text-black border-transparent font-bold"
                : "border-amber-500/30 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10",
            )}
          >
            ★ 收藏 ({styleBookmarks.filter((id) => STYLE_REGISTRY.some((s) => s.id === id)).length})
          </button>
        </div>

        <div className="relative max-w-xs w-full">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索体验名称、灵感、标签…"
            className="w-full rounded-[var(--radius-control)] border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] px-3 py-1.5 text-[12px] text-[color:var(--text-primary)] placeholder-[color:var(--text-quiet)] focus:border-[color:var(--status-accent)] focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Gallery — composed by the live composition grammar rather than a fixed
          four-up grid, so the page itself demonstrates what the styles claim. */}
      <div data-composition-grid className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
        {filteredStyles.map((preset) => {
          const profile = resolveExperienceProfile(preset);
          const resolved = resolvedFor(preset);
          const isActive = isActiveStyle(preset.id);
          const isStarred = styleBookmarks.includes(preset.id);
          const live = isRenderable(preset);

          return (
            <div
              key={preset.id}
              data-style-card={preset.id}
              data-tier={profile.tier}
              onClick={() => setPreviewStyle(preset)}
              className={clsx(
                "group relative flex flex-col justify-between rounded-[var(--radius-panel)] border p-3.5 transition-all duration-200 cursor-pointer select-none",
                isActive
                  ? "border-[color:var(--status-accent)] bg-[color:var(--surface-raised)] shadow-[var(--shadow-hard)]"
                  : "border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/70 hover:border-[color:var(--line-strong)] hover:bg-[color:var(--surface-raised)]",
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[14.5px] font-bold text-[color:var(--text-strong)] truncate">
                        {preset.name}
                      </span>
                      <span className="rounded bg-[color:var(--surface-hover)] px-1.5 py-0.2 text-[10px] font-mono font-bold text-[color:var(--text-secondary)] border border-[color:var(--line-subtle)]">
                        {TIER_SHORT[profile.tier]}
                      </span>
                      {isActive && (
                        <span className="rounded bg-[color:var(--status-accent)] px-1.5 py-0.2 text-[10px] font-black text-[color:var(--accent-on)]">
                          已启用
                        </span>
                      )}
                      {!live && (
                        <span className="rounded bg-zinc-500/20 px-1.5 py-0.2 text-[10px] text-zinc-400">
                          需要更新应用
                        </span>
                      )}
                    </div>
                    <div className="text-[color:var(--text-quiet)] text-[11px] font-mono mt-0.5 truncate">
                      {preset.subtitle}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      Bookmarks.toggle(preset.id, preset.name);
                    }}
                    className={`text-[13px] p-0.5 shrink-0 hover:scale-125 transition-transform ${
                      isStarred
                        ? "text-amber-400 font-bold"
                        : "text-[color:var(--text-quiet)] opacity-50 hover:opacity-100"
                    }`}
                    title={isStarred ? "取消收藏" : "收藏"}
                    aria-label={isStarred ? "取消收藏" : "收藏"}
                  >
                    {isStarred ? "★" : "☆"}
                  </button>
                </div>

                {/* The specimen replaces three colour dots. A design gallery has
                    to show what the product becomes, and a palette swatch can
                    only ever answer "which hues" — never "which layout". */}
                <div className="mt-3 overflow-hidden rounded-[var(--radius-control)] border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)]">
                  <ExperienceThumbnail style={preset} className="h-[132px] w-full" />
                </div>

                {/* Grammar readout: what makes this entry Tier 3/4 rather than a
                    palette, stated plainly so the difference is not inferred. */}
                <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-[color:var(--text-quiet)]">
                  <span className="truncate">{SHELL_LABEL[profile.shell ?? "sidebar"]}</span>
                  <span className="truncate">{NAV_LABEL[profile.navigation ?? "sidebar"]}</span>
                  <span className="truncate">{COMPOSITION_LABEL[profile.composition ?? "solid-grid"]}</span>
                  <span className="truncate">{CARD_LABEL[profile.card ?? "panel"]}</span>
                </div>

                <p className="mt-2 text-[11.5px] text-[color:var(--text-tertiary)] line-clamp-2 leading-relaxed">
                  {preset.description}
                </p>
              </div>

              {/* Primary Setup Action, straight from the resolver — the card and
                  the detail view cannot disagree about what applying means,
                  because neither of them wrote the action. */}
              <div className="mt-3 pt-2.5 border-t border-[color:var(--line-subtle)]">
                <SetupActionButton
                  action={resolved.primaryAction}
                  secondaryActions={resolved.secondaryActions}
                  itemMeta={{ id: preset.id, name: preset.name, type: "style" }}
                  size="sm"
                  showPmSelector={false}
                  disabled={!live}
                  onActionSuccess={(m) => setNotice(m)}
                  className="w-full"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewStyle(preset);
                  }}
                  className="mt-2 w-full text-left text-[11px] text-[color:var(--status-accent)] hover:underline"
                >
                  预览完整样张 ↗
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredStyles.length === 0 && (
        <EmptyBlock
          title="没有匹配的体验"
          body="换个关键词，或切回「全部体验」。"
        />
      )}

      {/* Preview-before-Apply. Applying a style used to be the only way to see
          it, which meant every browse repainted the whole app; the specimen
          shows the tokens, the shell grammar and the card language without
          committing anything. */}
      {previewStyle && (
        <StylePreviewShell
          style={previewStyle}
          inventory={inventory}
          active={isActiveStyle(previewStyle.id)}
          starred={styleBookmarks.includes(previewStyle.id)}
          onToggleStar={() => Bookmarks.toggle(previewStyle.id, previewStyle.name)}
          onClose={() => setPreviewStyle(null)}
          onNotice={setNotice}
        />
      )}
    </div>
  );
}

/**
 * The Style preview + detail surface: a full-size specimen on the left and the
 * experience's declared grammar, palette and design principles on the right.
 *
 * It exists as its own component because it needs the hook order of a component
 * (it resolves actions) while `StyleSection` renders it conditionally.
 */
function StylePreviewShell({
  style,
  inventory,
  active,
  starred,
  onToggleStar,
  onClose,
  onNotice,
}: {
  style: SetupStyle;
  inventory: ReturnType<typeof useApp.getState>["inventory"];
  active: boolean;
  starred: boolean;
  onToggleStar: () => void;
  onClose: () => void;
  onNotice: (msg: string) => void;
}) {
  const profile = resolveExperienceProfile(style);
  const resolved = useMemo(
    () => resolveSetupAction({ type: "style", data: style }, inventory),
    [style, inventory],
  );
  const live = isRenderable(style);

  const grammar: Array<[string, string]> = [
    ["体验等级", TIER_LABEL[profile.tier]],
    ["外壳语法", SHELL_LABEL[profile.shell ?? "sidebar"]],
    ["导航语法", NAV_LABEL[profile.navigation ?? "sidebar"]],
    ["详情呈现", DETAIL_LABEL[profile.detail ?? "rail"]],
    ["卡片语言", CARD_LABEL[profile.card ?? "panel"]],
    ["版面构成", COMPOSITION_LABEL[profile.composition ?? "solid-grid"]],
    ["密度", DENSITY_LABEL[profile.density ?? "normal"]],
    ["动效", MOTION_LABEL[profile.motion ?? "normal"]],
  ];

  const swatches: Array<[string, string]> = [
    ["基底色 (Base)", style.palette.baseBg],
    ["面板色 (Surface)", style.palette.surface],
    ["强调色 (Accent)", style.palette.accent],
    ...(style.palette.accentSecondary
      ? ([["次级强调 (Secondary)", style.palette.accentSecondary]] as Array<[string, string]>)
      : []),
    ["正文字色 (Text)", style.palette.text],
    ["边框色 (Border)", style.palette.cardBorder],
  ];

  return (
    <DetailShell
      isOpen={true}
      onClose={onClose}
      title={style.name}
      subtitle={`${style.subtitle} · v${style.version} · 由 ${style.author} 维护`}
      tags={style.tags}
      width="xl"
      badge={
        active ? (
          <span className="rounded bg-[color:var(--status-accent)] px-2 py-0.5 text-[11px] font-black text-[color:var(--accent-on)]">
            全局已启用
          </span>
        ) : live ? (
          <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300 border border-emerald-500/30">
            可立即使用
          </span>
        ) : (
          <span className="rounded bg-zinc-500/20 px-2 py-0.5 text-[11px] text-zinc-400">
            需要更新应用
          </span>
        )
      }
      actions={
        <>
          <button
            type="button"
            onClick={onToggleStar}
            className="rounded-[var(--radius-control)] border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--text-secondary)] hover:text-[color:var(--text-strong)] transition-colors"
          >
            {starred ? "★ 已收藏" : "☆ 加入收藏"}
          </button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <SetupActionButton
            action={resolved.primaryAction}
            secondaryActions={resolved.secondaryActions}
            itemMeta={{ id: style.id, name: style.name, type: "style" }}
            size="sm"
            showPmSelector={false}
            disabled={!live}
            onActionSuccess={onNotice}
          />
        </>
      }
    >
      {/* Live Specimen Preview (brief §34): the whole point is that seeing an
          experience must not require becoming it app-wide. */}
      <div data-specimen-frame className="overflow-hidden rounded-[var(--radius-panel)] border border-[color:var(--line-default)]">
        <ExperienceSpecimen style={style} scale="full" />
      </div>

      <div>
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--text-secondary)] mb-2">
          体验语法 (Experience Grammar)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {grammar.map(([label, value]) => (
            <div
              key={label}
              className="rounded-[var(--radius-control)] border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] px-2.5 py-1.5"
            >
              <div className="text-[10.5px] text-[color:var(--text-quiet)]">{label}</div>
              <div className="text-[11.5px] text-[color:var(--text-primary)] truncate">{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--text-secondary)] mb-2">
          色彩语义调色板 (Color Palette)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {swatches.map(([label, hex]) => (
            <div
              key={label}
              className="flex items-center gap-2.5 rounded-[var(--radius-control)] border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-2"
            >
              <span
                className="h-6 w-6 shrink-0 border border-white/10"
                style={{
                  backgroundColor: hex,
                  borderRadius: "var(--radius-control)",
                }}
              />
              <div className="min-w-0">
                <div className="text-[11px] text-[color:var(--text-quiet)]">{label}</div>
                <div className="text-[11.5px] font-mono text-[color:var(--text-primary)] truncate">
                  {hex}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--text-secondary)] mb-1.5">
          设计语言概述
        </h3>
        <p className="text-[13px] text-[color:var(--text-secondary)] leading-relaxed">
          {style.description}
        </p>
      </div>

      <div className="rounded-[var(--radius-control)] border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3.5">
        <div className="text-[11px] font-bold text-[color:var(--text-secondary)] uppercase tracking-wider">
          设计语言灵感来源
        </div>
        <p className="text-[12px] text-[color:var(--text-tertiary)] mt-1 leading-relaxed">
          {style.inspiration}
        </p>
      </div>

      <div>
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--text-secondary)] mb-2">
          关键视觉特征
        </h3>
        <ul className="space-y-1.5 text-[12.5px] text-[color:var(--text-secondary)]">
          {style.features.map((feat, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="text-[color:var(--status-accent)] shrink-0 mt-0.5">•</span>
              <span>{feat}</span>
            </li>
          ))}
        </ul>
      </div>

      {style.designPrinciples && style.designPrinciples.length > 0 && (
        <div>
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--text-secondary)] mb-2">
            设计规范与原则参考
          </h3>
          <div className="rounded-[var(--radius-control)] border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3.5">
            <ul className="space-y-2 text-[12px] text-[color:var(--text-secondary)] font-mono">
              {style.designPrinciples.map((dp, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-[color:var(--status-accent)] shrink-0 mt-0.5">◈</span>
                  <span>{dp}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </DetailShell>
  );
}

/** The 关于 section: version facts, and what the tool does not do. */
function AboutSection() {
  const entitlements = useApp((s) => s.entitlements);
  const status = useApp((s) => s.status);
  const loadStatus = useApp((s) => s.loadStatus);

  useEffect(() => {
    if (!status) void loadStatus();
  }, [status, loadStatus]);

  const isPro = entitlements?.state === "active";

  return (
    <div className="flex flex-col gap-8">
      <header className="rise">
        <h1 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          Setup Center
        </h1>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed">
          Windows 环境初始化助手。检测系统环境、说明缺什么，并（专业版）自动装好。
        </p>
        {status && (
          <p className="text-[color:var(--text-quiet)] mt-1.5 text-[12px]">
            版本 {status.appVersion}
          </p>
        )}
      </header>

      <section className="glass rose rise rounded-[12px] p-5">
        <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
          {isPro ? "你已拥有专业版" : "购买专业版"}
        </div>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[12.5px] leading-relaxed">
          {isPro
            ? "自动安装与配置功能已解锁，无需重复购买。"
            : "解锁自动安装、环境初始化与配置功能。激活码与本机绑定，一对一只需购买一次。"}
        </p>
        {!isPro && (
          <div className="mt-3.5">
            <ContactRows />
          </div>
        )}
      </section>

      <section className="rise">
        <SectionLabel>当前版本</SectionLabel>
        <div className="mt-3 flex flex-col gap-1.5 text-[12.5px]">
          <DetailRow
            label="授权状态"
            value={entitlements ? entitlements.tierLabel : "读取中…"}
            confidence={isPro ? "ok" : undefined}
          />
          <DetailRow
            label="环境检测"
            value="可用"
            confidence="ok"
          />
          <DetailRow
            label="软件推荐"
            value="可用"
            confidence="ok"
          />
          <DetailRow
            label="自动安装"
            value={entitlements?.canInstall ? "可用" : "需专业版"}
            confidence={entitlements?.canInstall ? "ok" : "skipped"}
          />
        </div>
      </section>

      <p className="text-[color:var(--text-quiet)] rise text-[12px] leading-relaxed">
        本工具完全离线运行，不联网校验授权、不收集账号信息、
        不上传任何检测结果。所有授权信息仅保存在本机。
      </p>
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
