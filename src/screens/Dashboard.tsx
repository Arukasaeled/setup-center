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
import { useApp, type Section } from "../lib/store";
import {
  LicenseSection,
  UpgradePrompt,
} from "../components/ActivationPanel";
import { ProNotice } from "../components/ProGate";
import { PluginsSection } from "../components/PluginsSection";
import { StoragePolicyCard } from "../components/StoragePolicyCard";
import { STYLE_REGISTRY } from "../styles";
import type { PageLayoutContract, SetupStyle } from "../styles/types";
import { ResourceSection } from "./ResourceSection";
import { UIPartsSection } from "./UIPartsSection";
import { DetailShell } from "../components/DetailShell";
import { ExperiencePreviewWorkspace } from "../components/ExperiencePreviewWorkspace";
import { SetupActionButton } from "../components/SetupActionButton";
import { ExperienceThumbnail } from "../components/ExperienceSpecimen";
import { ExperiencePlayground } from "../components/TokenTweaker";
import { TransferHistoryTimeline } from "../components/TransferHistoryTimeline";
import { Bookmarks } from "../core/transfer";
import { resolveSetupAction } from "../core/setup/resolver";
import { AwardAtlas } from "../components/AwardAtlas";
import { PatternLab } from "../components/PatternLab";
import type { ExperienceFamily } from "../styles/types";
import {
  CARD_LABEL,
  COMPOSITION_LABEL,
  DENSITY_LABEL,
  DETAIL_LABEL,
  FAMILY_LABEL,
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
import { GoalModeScreen } from "./GoalMode";
import { RepoFinderScreen } from "./RepoFinder";
import { LibraryScreen } from "./Library";
import { LocalSearchIndex } from "../core/discovery/searchIndex";
import { searchWingetPackages } from "../core/discovery/winget";
import { RecentTracker } from "../core/transfer/recent";
import type { DiscoveryItem } from "../core/discovery/types";
import { RepoDetailModal } from "../components/RepoDetailModal";
import { CloneRepoModal } from "../components/CloneRepoModal";
import { DynamicSoftwareDetailModal } from "../components/DynamicSoftwareDetailModal";
import { OverflowNavigation } from "../components/OverflowNavigation";
import { AccessibleDialog } from "../components/AccessibleDialog";
import { HealthBlockersSummary } from "./dashboard/HealthBlockersSummary";

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: "overview", label: "开发起步", hint: "全局搜索、快捷入口与本机状态" },
  { id: "goals", label: "目标向导", hint: "按技术路线定制开发环境" },
  { id: "software", label: "软件清单", hint: "这台电脑装了什么 & Winget 检索" },
  { id: "repos", label: "GitHub 项目", hint: "开源优质仓库、对比与克隆" },
  { id: "resources", label: "开发资源", hint: "开源项目、模板与灵感" },
  { id: "uiparts", label: "UI 零部件库", hint: "视觉零件 · 归档、拆解、提取与原型" },
  { id: "library", label: "我的库", hint: "个人收藏、最近与自定义包" },
  { id: "style", label: "视觉实验室", hint: "Design Lab · 体验矩阵、标杆与交互原型" },
  { id: "config", label: "环境配置", hint: "身份、路径、代理" },
  { id: "history", label: "历史记录", hint: "做过什么，如何恢复" },
  { id: "plugins", label: "插件增强", hint: "Claude 中文与效率增强" },
  { id: "license", label: "版本与激活", hint: "当前权益、激活与内容更新" },
  { id: "about", label: "关于", hint: "关于 Setup Center 与开源社区" },
];

/**
 * The page-layout contract, per section.
 */
const PAGE_LAYOUTS: Record<Section, PageLayoutContract> = {
  overview: { mode: "master-detail", selectable: true },
  goals: { mode: "document", selectable: false },
  software: { mode: "master-detail", selectable: true },
  repos: { mode: "explorer", selectable: false },
  resources: { mode: "explorer", selectable: false },
  uiparts: { mode: "gallery", selectable: false },
  library: { mode: "explorer", selectable: false },
  style: { mode: "gallery", selectable: false },
  config: { mode: "master-detail", selectable: true },
  history: { mode: "timeline", selectable: false },
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
              than only on 版本与激活, because the whole gap this closes is that a
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
          {section === "goals" && <GoalModeScreen />}
          {section === "software" && <SoftwareSection />}
          {section === "repos" && <RepoFinderScreen />}
          {section === "resources" && <ResourceSection />}
          {section === "uiparts" && <UIPartsSection />}
          {section === "library" && <LibraryScreen />}
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
  const navPreferences = useApp((s) => s.navPreferences);
  const [showNavConfig, setShowNavConfig] = useState(false);

  // One badge, on the section a student acts on.
  const softwareGaps = useApp((s) => {
    const items = s.inventory?.items ?? [];
    return items.filter((i) => !i.installed && i.confidence !== "unknown").length;
  });

  const badges: Partial<Record<Section, number>> = {
    software: softwareGaps,
  };

  const visibleSections = useMemo(() => {
    return SECTIONS.filter(
      (s) => !navPreferences.hiddenSections.includes(s.id) || s.id === section,
    );
  }, [navPreferences.hiddenSections, section]);

  return (
    <>
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

        <OverflowNavigation
          items={visibleSections}
          activeSection={section}
          onSelect={onSelect}
          badges={badges}
        />

        <div data-nav-foot className="mt-auto flex flex-col gap-2 pt-6">
          <button
            type="button"
            onClick={() => setShowNavConfig(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] text-[color:var(--text-quiet)] hover:text-[color:var(--text-primary)] rounded transition-colors text-left cursor-pointer"
          >
            <span>⚙</span>
            <span>导航偏好设置</span>
          </button>
          <ThemeSwitch theme={theme} onTheme={onTheme} />
          <Button variant="quiet" size="sm" onClick={onExit} className="justify-start">
            回到首次设置
          </Button>
        </div>
      </nav>

      {showNavConfig && (
        <NavPreferencesModal isOpen={showNavConfig} onClose={() => setShowNavConfig(false)} />
      )}
    </>
  );
}

function NavPreferencesModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const navPreferences = useApp((s) => s.navPreferences);
  const setDefaultSection = useApp((s) => s.setDefaultSection);
  const toggleSectionVisibility = useApp((s) => s.toggleSectionVisibility);
  const toggleReducedDecoration = useApp((s) => s.toggleReducedDecoration);

  if (!isOpen) return null;

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      titleId="nav-prefs-title"
      dataProtectedUi={true}
      maxWidth="max-w-md"
      panelClassName="relative w-full max-w-md rounded-2xl border border-[color:var(--line-strong)] bg-[color:var(--surface-base)] p-5 text-[color:var(--text-primary)] shadow-2xl space-y-4"
    >
      <div className="flex items-center justify-between border-b border-[color:var(--line-subtle)] pb-3">
        <h3 id="nav-prefs-title" className="text-[16px] font-bold text-[color:var(--text-strong)] flex items-center gap-2">
          <span>⚙ 导航偏好设置</span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭导航偏好设置"
          className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] text-[color:var(--text-quiet)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors cursor-pointer"
        >
          <span className="text-[13px] leading-none">✕</span>
        </button>
      </div>

      {/* 1. Default Startup Section */}
      <div className="space-y-1.5">
        <label htmlFor="nav-prefs-default-section-select" className="text-[12.5px] font-semibold text-[color:var(--text-secondary)] block">
          默认启动分区 (Default Startup Section):
        </label>
        <select
          id="nav-prefs-default-section-select"
          value={navPreferences.defaultSection}
          onChange={(e) => setDefaultSection(e.target.value as Section)}
          className="w-full rounded-lg border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] px-3 py-2 text-[13px] text-[color:var(--text-primary)] focus:border-[color:var(--status-accent)] focus:outline-none transition-colors"
        >
          {SECTIONS.map((s) => (
            <option key={s.id} value={s.id} className="bg-[color:var(--surface-base)] text-[color:var(--text-primary)]">
              {s.label} ({s.id})
            </option>
          ))}
        </select>
        <p className="text-[11.5px] text-[color:var(--text-quiet)]">
          打开应用或 cold start 时自动进入的分区，已持久化于本地存储。
        </p>
      </div>

      {/* 2. Hidden Sections Toggle */}
      <div className="space-y-2 pt-2 border-t border-[color:var(--line-subtle)]">
        <label className="text-[12.5px] font-semibold text-[color:var(--text-secondary)] block">
          导航项显示与隐藏 (Show / Hide):
        </label>
        <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
          {SECTIONS.map((s) => {
            const isOverview = s.id === "overview";
            const isHidden = navPreferences.hiddenSections.includes(s.id);
            return (
              <label
                key={s.id}
                className={clsx(
                  "flex min-h-[32px] items-center justify-between p-2 rounded-lg border text-[12.5px] cursor-pointer transition-colors",
                  isHidden
                    ? "border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)]/40 text-[color:var(--text-quiet)]"
                    : "border-[color:var(--line-default)] bg-[color:var(--surface-raised)] text-[color:var(--text-primary)] hover:border-[color:var(--line-strong)]",
                )}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    disabled={isOverview}
                    onChange={() => toggleSectionVisibility(s.id)}
                    className="accent-[color:var(--status-accent)] h-4 w-4"
                  />
                  <span className="font-medium">{s.label}</span>
                </div>
                <span className="text-[11px] font-mono text-[color:var(--text-quiet)]">
                  {isOverview ? "首页固定" : isHidden ? "已隐藏" : "显示中"}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* 3. Comfortable Reading & Reduced Decoration Mode (Issue H06) */}
      <div className="pt-2 border-t border-[color:var(--line-subtle)] space-y-1.5">
        <label className="text-[12.5px] font-semibold text-[color:var(--text-secondary)] block">
          排版舒适度模式 (Comfortable Reading):
        </label>
        <label className="flex min-h-[36px] items-center justify-between p-2.5 rounded-lg border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] text-[12.5px] text-[color:var(--text-primary)] cursor-pointer hover:border-[color:var(--line-strong)] transition-colors">
          <div className="flex items-center gap-2.5">
            <input
              id="nav-prefs-reduced-decoration-checkbox"
              type="checkbox"
              checked={navPreferences.reducedDecoration ?? false}
              onChange={() => toggleReducedDecoration()}
              className="accent-[color:var(--status-accent)] h-4 w-4"
            />
            <div>
              <span className="font-semibold block text-[13px]">舒适阅读模式 (Reduced Decoration)</span>
              <span className="text-[11.5px] text-[color:var(--text-quiet)] block">
                正文强制 ≥14px，提升 quiet 文本对比度，弱化噪点与复杂装饰
              </span>
            </div>
          </div>
          <span className="text-[11px] font-mono text-[color:var(--text-quiet)] shrink-0 ml-2">
            {navPreferences.reducedDecoration ? "已开启" : "已关闭"}
          </span>
        </label>
      {/* 4. Multi-Profile Workspace Deferral Notice (Issue K03) */}
      <div className="pt-2 border-t border-[color:var(--line-subtle)] space-y-1">
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-semibold text-[color:var(--text-secondary)]">多工作区配置方案 (Profiles)</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[color:var(--surface-sunken)] text-[color:var(--text-quiet)] border border-[color:var(--line-subtle)]">
            DEFERRED_BY_SPEC
          </span>
        </div>
        <p className="text-[11.5px] text-[color:var(--text-quiet)] leading-relaxed">
          双 Profile / 多工作区隔离与跨栈全自动组装当前按规范明确延期，应用运行于统一单工作区个人库模式下。
        </p>
      </div>

      <div className="pt-2 flex justify-end">
        <Button size="sm" variant="primary" onClick={onClose} className="min-h-[32px] px-4">
          完成
        </Button>
      </div>
    </AccessibleDialog>
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

function QuickAccessTile({
  title,
  desc,
  badge,
  onClick,
}: {
  title: string;
  desc: string;
  badge: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col justify-between rounded-2xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-4 text-left hover:border-[color:var(--status-accent)] hover:bg-[color:var(--surface-hover)] transition-all shadow-sm"
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13.5px] font-bold text-[color:var(--text-strong)] group-hover:text-[color:var(--status-accent)] transition-colors">
            {title}
          </span>
          <span className="rounded bg-[color:var(--surface-panel)] border border-[color:var(--line-subtle)] px-1.5 py-0.5 text-[10px] font-mono text-[color:var(--text-quiet)] shrink-0">
            {badge}
          </span>
        </div>
        <p className="mt-1.5 text-[11.5px] text-[color:var(--text-tertiary)] leading-relaxed line-clamp-2">
          {desc}
        </p>
      </div>
      <div className="mt-3 flex items-center gap-1 text-[11.5px] font-medium text-[color:var(--status-accent)]">
        <span>探索</span>
        <span className="group-hover:translate-x-0.5 transition-transform font-mono">→</span>
      </div>
    </button>
  );
}

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

  const advisor = useApp((s) => s.advisor);
  const goalPlan = useApp((s) => s.goalPlan);
  const allPlans = useApp((s) => s.allPlans);
  const goals = useApp((s) => s.goals);
  const selectedGoalId = useApp((s) => s.selectedGoalId);
  const selectGoal = useApp((s) => s.selectGoal);
  const loadAdvisor = useApp((s) => s.loadAdvisor);
  const loadGoals = useApp((s) => s.loadGoals);
  const knowledgeStatus = useApp((s) => s.knowledgeStatus);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeDetailItem, setActiveDetailItem] = useState<DiscoveryItem | null>(null);
  const [activeCloneItem, setActiveCloneItem] = useState<{ title: string; repoUrl: string } | null>(null);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return LocalSearchIndex.search(searchQuery.trim()).slice(0, 8);
  }, [searchQuery]);

  const recentItems = useMemo(() => {
    return RecentTracker.getAll().slice(0, 5);
  }, []);

  const bookmarkedItems = useMemo(() => {
    const ids = Bookmarks.getAll().slice(0, 5);
    return LocalSearchIndex.getAll().filter((i) => ids.includes(i.id));
  }, []);

  const handleSelectSearchItem = (item: DiscoveryItem) => {
    setSearchQuery("");
    if (item.type === "software") {
      setSection("software");
      selectItem(item.id.replace("sw:", ""));
    } else if (item.type === "style") {
      setSection("style");
    } else {
      setActiveDetailItem(item);
    }
  };

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

  const advisorScore = advisor?.detected ? advisor.summary.score : null;
  const advisorHeadline = advisor?.detected ? advisor.summary.headline : null;
  const overallScore = advisorScore ?? environment.score;

  return (
    <div className="flex flex-col gap-8 pb-10">
      {/* 1. Developer Start Center Hero */}
      <section data-page-hero className="space-y-5 rise">
        <div>
          <div className="inline-flex items-center gap-2 rounded px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[color:var(--status-accent)] bg-[color:var(--surface-sunken)] mb-2">
            DEVELOPER START CENTER // 开发起步中心
          </div>
          <h1 className="text-[23px] font-bold text-[color:var(--text-strong)] tracking-[-0.02em]">
            找到东西 → 看懂它 → 决定用它 → 开始使用
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--text-tertiary)] max-w-2xl leading-relaxed">
            全站索引 380+ 开发资源、55+ 生产级模板、GitHub 热门开源项目与 Windows 本机工具链生态。
          </p>
        </div>

        {/* 2. Prominent Hero Search Bar */}
        <div className="relative">
          <div className="flex items-center gap-3 rounded-2xl border-2 border-[color:var(--line-default)] bg-[color:var(--surface-sunken)] px-4 py-3 shadow-sm focus-within:border-[color:var(--status-accent)] transition-all">
            <span className="text-[16px] text-[color:var(--text-quiet)] font-mono">⌕</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索开源项目、开发软件、UI组件库、工程模板、Winget包..."
              className="w-full bg-transparent text-[14px] text-[color:var(--text-strong)] placeholder:text-[color:var(--text-quiet)] outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-[12px] text-[color:var(--text-quiet)] hover:text-[color:var(--text-secondary)] px-1"
              >
                ✕
              </button>
            )}
            <div className="hidden sm:flex items-center gap-1 rounded bg-[color:var(--surface-panel)] border border-[color:var(--line-subtle)] px-2 py-0.5 text-[11px] font-mono text-[color:var(--text-tertiary)]">
              <span>Ctrl</span><span>+</span><span>K</span>
            </div>
          </div>

          {/* Instant Search Dropdown Popover */}
          {searchQuery.trim() && (
            <div className="absolute top-full left-0 right-0 z-30 mt-2 rounded-2xl border border-[color:var(--line-default)] bg-[color:var(--surface-panel)] p-2 shadow-2xl backdrop-blur-xl animate-fade-in space-y-1">
              <div className="px-3 py-1 text-[11px] font-bold text-[color:var(--text-quiet)] uppercase tracking-wider">
                {searchResults.length > 0 ? "本地精选匹配" : "本地未找到匹配项"}
              </div>
              {searchResults.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleSelectSearchItem(item)}
                  className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[color:var(--surface-hover)] cursor-pointer transition-colors group"
                >
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-[color:var(--text-primary)] group-hover:text-[color:var(--status-accent)]">
                        {item.title}
                      </span>
                      <span className="rounded bg-[color:var(--surface-sunken)] px-1.5 py-0.2 text-[10px] text-[color:var(--text-quiet)] uppercase font-mono">
                        {item.type}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-[color:var(--text-tertiary)] truncate mt-0.5">
                      {item.subtitle || item.description}
                    </p>
                  </div>
                  <span className="text-[12px] text-[color:var(--text-quiet)] font-mono shrink-0">
                    查看 →
                  </span>
                </div>
              ))}
              <div className="border-t border-[color:var(--line-subtle)] pt-1.5 mt-1 flex flex-wrap items-center justify-between gap-2 px-3 py-1 text-[12px]">
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSection("repos");
                  }}
                  className="text-[color:var(--status-accent)] hover:underline flex items-center gap-1 font-medium"
                >
                  在 GitHub 全库深度搜索「{searchQuery}」→
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSection("software");
                  }}
                  className="text-[color:var(--text-tertiary)] hover:underline"
                >
                  在 Winget 软件库中搜索 →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 3. Primary Tasks & Quick Access (Issue K03: Setup Computer vs Creative Workbench) */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between text-[11.5px] font-semibold uppercase tracking-wider text-[color:var(--text-quiet)] mb-2">
              <span>基础环境配置 // Setup Computer</span>
              <span className="font-mono text-[10.5px] opacity-75">环境闭环 & 缺口补齐</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <QuickAccessTile
                title="找软件 / 本机清单"
                desc="本机软件诊断、缺口补齐与 Winget 全网秒查"
                badge="36+ 内置"
                onClick={() => setSection("software")}
              />
              <QuickAccessTile
                title="目标规划模式"
                desc="按技术路线 (Web/AI/Rust/算法) 定制专属环境"
                badge="6条路线"
                onClick={() => setSection("goals")}
              />
              <QuickAccessTile
                title="环境配置与履历"
                desc="查看环境变量、Git 配置与安装履历回溯"
                badge="环境链路"
                onClick={() => setSection("config")}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11.5px] font-semibold uppercase tracking-wider text-[color:var(--text-quiet)] mb-2">
              <span>创作与工程资产 // Creative Workbench</span>
              <span className="font-mono text-[10.5px] opacity-75">资源、零件与体验</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <QuickAccessTile
                title="GitHub 项目探索"
                desc="精选热门开源仓库、活跃度对比与一键克隆"
                badge="在线 API"
                onClick={() => setSection("repos")}
              />
              <QuickAccessTile
                title="开发资源全库"
                desc="380+ 精选前端组件库、设计系统与实用工具"
                badge="386 项"
                onClick={() => setSection("resources")}
              />
              <QuickAccessTile
                title="UI 零部件与视觉"
                desc="可复用组件零件与 20 套声明式视觉体验"
                badge="零件 & 体验"
                onClick={() => setSection("uiparts")}
              />
            </div>
          </div>
        </div>

        {/* 4. Recent & Bookmarks Strip (if available) */}
        {(recentItems.length > 0 || bookmarkedItems.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[color:var(--line-subtle)] text-[12px]">
            <span className="text-[color:var(--text-quiet)] font-medium shrink-0">快捷足迹:</span>
            {recentItems.slice(0, 3).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  if (r.type === "software") {
                    setSection("software");
                    selectItem(r.id.replace("sw:", ""));
                  } else if (r.type === "repo") {
                    setSection("repos");
                  } else {
                    setSection("resources");
                  }
                }}
                className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] px-2.5 py-1 text-[11.5px] text-[color:var(--text-secondary)] hover:border-[color:var(--line-default)] hover:text-[color:var(--text-primary)] transition-colors truncate max-w-[160px]"
              >
                {r.title}
              </button>
            ))}
            {bookmarkedItems.slice(0, 3).map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setActiveDetailItem(b)}
                className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 text-[11.5px] text-amber-300 hover:border-amber-500/40 transition-colors truncate max-w-[160px] flex items-center gap-1"
              >
                <span>★</span>
                <span>{b.title}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 5. Machine Environment Status & Diagnostic Strip */}
      <section className="space-y-4 pt-2 border-t border-[color:var(--line-subtle)]">
        <div className="flex items-center justify-between">
          <SectionLabel>本机环境与诊断</SectionLabel>
          <button
            type="button"
            onClick={onRecheck}
            className="text-[color:var(--text-quiet)] hover:text-[color:var(--text-secondary)] text-[12px] transition-colors"
          >
            重新检测
          </button>
        </div>

        {/* Issue K05: Prioritize explicit blockers & unknowns over raw composite score */}
        <HealthBlockersSummary
          report={environment}
          capabilities={capabilities}
          score={overallScore}
          onFixBlockers={() => setSection("software")}
        />

        <div className="flex items-start justify-between gap-4">
          <EnvironmentScore
            score={overallScore}
            capabilities={capabilities}
            greeting={greeting()}
          />
        </div>

        {goalPlan && selectedGoal && (
          <div className="mt-4">
            <GoalReadout plan={goalPlan} goalName={selectedGoal.name} />
            <div className="text-[color:var(--text-quiet)] mt-2 flex items-baseline gap-2 text-[12px]">
              <span className="tnum">整体评分 {overallScore} / 100</span>
              <span>·</span>
              <span>{advisorHeadline ?? `已经可以做 ${available} 件事`}</span>
            </div>
          </div>
        )}
      </section>

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

      {/* Modals for Start Center discovery */}
      {activeDetailItem && (
        <RepoDetailModal
          isOpen={true}
          item={activeDetailItem}
          onClose={() => setActiveDetailItem(null)}
          onClone={() => {
            const r = { title: activeDetailItem.title, repoUrl: activeDetailItem.origin?.repository || "" };
            setActiveDetailItem(null);
            setActiveCloneItem(r);
          }}
        />
      )}

      {activeCloneItem && (
        <CloneRepoModal
          isOpen={true}
          repoUrl={activeCloneItem.repoUrl}
          repoTitle={activeCloneItem.title}
          onClose={() => setActiveCloneItem(null)}
        />
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
            useApp.getState().navigate({ surface: "wizard", screen: "software" });
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
  const [softwareScope, setSoftwareScope] = useState<"curated" | "winget">("curated");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [isWingetSearching, setIsWingetSearching] = useState(false);
  const [wingetItems, setWingetItems] = useState<DiscoveryItem[]>([]);
  const [wingetError, setWingetError] = useState<string | null>(null);
  const [selectedWingetItem, setSelectedWingetItem] = useState<DiscoveryItem | null>(null);

  // Debounced auto-search for Winget (350ms)
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setWingetItems([]);
      setWingetError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsWingetSearching(true);
      setWingetError(null);
      try {
        const res = await searchWingetPackages(trimmed);
        setWingetItems(res);
        if (res.length === 0) {
          setWingetError(`Winget 软件库中未找到关于「${trimmed}」的软件包`);
        }
      } catch (err: any) {
        setWingetError(err?.message || "Winget 检索失败");
      } finally {
        setIsWingetSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query]);

  const order = ["development", "editor", "aiTool", "aiCreative", "runtime"];
  const tabs: CategoryTab[] = [
    { key: "", label: "全部", count: items.length },
    ...order
      .map((key) => {
        const list = items.filter((i) => categoryOf.get(i.id)?.category === key);
        return {
          key,
          label: categoryOf.get(list[0]?.id)?.categoryName ?? key,
          count: list.length,
        };
      })
      .filter((t) => t.count > 0),
  ];

  const inCategory =
    category === ""
      ? items
      : items.filter((i) => categoryOf.get(i.id)?.category === category);
  const activeTab = inCategory.length > 0 ? category : "";

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

  const quickWingetTags = [
    "Git",
    "Python",
    "Node.js",
    "Docker",
    "VS Code",
    "Chrome",
    "Firefox",
    "7-Zip",
    "Obsidian",
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Dual Scope Switcher */}
      <div className="flex items-center gap-2 border-b border-[color:var(--line-subtle)] pb-2.5">
        <button
          type="button"
          onClick={() => setSoftwareScope("curated")}
          className={clsx(
            "rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold transition-all cursor-pointer",
            softwareScope === "curated"
              ? "bg-[color:var(--status-accent)] text-[color:var(--accent-on)] shadow-sm"
              : "bg-[color:var(--surface-sunken)] text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)]",
          )}
        >
          深度管理软件 ({items.length})
        </button>
        <button
          type="button"
          onClick={() => setSoftwareScope("winget")}
          className={clsx(
            "rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold transition-all cursor-pointer flex items-center gap-1.5",
            softwareScope === "winget"
              ? "bg-[color:var(--status-accent)] text-[color:var(--accent-on)] shadow-sm"
              : "bg-[color:var(--surface-sunken)] text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)]",
          )}
        >
          <span>Windows 软件源 (Winget)</span>
          {isWingetSearching && <span className="animate-spin text-[10px]">◷</span>}
          {wingetItems.length > 0 && softwareScope !== "winget" && (
            <span className="rounded-full bg-blue-500/20 px-1.5 py-0.2 text-[10px] font-mono text-blue-300">
              {wingetItems.length}
            </span>
          )}
        </button>
      </div>

      {softwareScope === "curated" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CategoryTabs tabs={tabs} active={activeTab} onSelect={setCategory} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索内置 36 款软件…"
              aria-label="搜索软件"
              data-software-search
              className={clsx(
                "w-[200px] shrink-0 rounded-[9px] border px-3 py-1.5 text-[12.5px]",
                "border-[color:var(--line-subtle)] bg-transparent",
                "text-[color:var(--text-primary)] placeholder:text-[color:var(--text-quiet)]",
                "focus:border-[color:var(--line-strong)] focus:outline-none",
                "transition-colors duration-150",
              )}
            />
          </div>

          {/* Quick bridge banner if user searches and Winget has matches */}
          {needle && wingetItems.length > 0 && (
            <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3 my-0.5 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-bold text-blue-200 truncate">
                  Windows Winget 官方源实时匹配到 {wingetItems.length} 款软件
                </div>
                <div className="text-[11.5px] text-zinc-400 truncate mt-0.5">
                  包含: {wingetItems.slice(0, 3).map((w) => w.title).join(", ")}
                  {wingetItems.length > 3 ? " 等" : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSoftwareScope("winget")}
                className="rounded-lg bg-blue-600 px-3 py-1 text-[11.5px] font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer shrink-0"
              >
                切换至 Winget 视图查看 ({wingetItems.length}) →
              </button>
            </div>
          )}

          {/* The curated list */}
          <div
            data-software-list
            className="stagger flex max-h-[calc(100vh-280px)] flex-col gap-0.5 overflow-y-auto pr-1"
          >
            {visible.length === 0 ? (
              <div className="py-12 text-center rounded-2xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/40 p-6 space-y-2">
                <p className="text-[color:var(--text-quiet)] text-[12.5px]">
                  内置清单中没有匹配「{query.trim()}」的软件
                </p>
                <button
                  type="button"
                  onClick={() => setSoftwareScope("winget")}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12px] font-bold text-white hover:bg-blue-500 cursor-pointer"
                >
                  在 Windows 官方源中检索「{query.trim()}」→
                </button>
              </div>
            ) : (
              visible.map((item) => {
                const id = softwareKey(item.id);
                const descriptor = categoryOf.get(item.id);
                const knowledge = knowledgeById.get(item.id) ?? null;
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
        </>
      ) : (
        /* WINGET UNIVERSE VIEW */
        <div className="space-y-4">
          <div className="space-y-2.5">
            <div className="relative">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="全网搜索 Windows 软件源 (如 git, python, docker, chrome, obsidian)..."
                aria-label="搜索 Winget 软件"
                autoFocus
                className={clsx(
                  "w-full rounded-xl border px-4 py-2.5 text-[13px]",
                  "border-[color:var(--line-default)] bg-[color:var(--surface-inset)]",
                  "text-[color:var(--text-primary)] placeholder:text-[color:var(--text-quiet)]",
                  "focus:border-[color:var(--status-accent)] focus:outline-none shadow-sm",
                  "transition-colors duration-150",
                )}
              />
              {isWingetSearching && (
                <div className="absolute right-3.5 top-3 flex items-center gap-1.5 text-[11px] text-[color:var(--text-quiet)] font-mono">
                  <span className="animate-spin">◷</span>
                  <span>正在检索…</span>
                </div>
              )}
            </div>

            {/* Quick Chips */}
            <div className="flex items-center gap-1.5 flex-wrap text-[11.5px]">
              <span className="text-[color:var(--text-quiet)] font-mono">快速探索:</span>
              {quickWingetTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setQuery(tag)}
                  className="rounded-md border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] px-2 py-0.5 text-[color:var(--text-secondary)] hover:border-[color:var(--line-strong)] hover:text-[color:var(--text-primary)] transition-colors cursor-pointer"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Results display */}
          <div className="max-h-[calc(100vh-320px)] overflow-y-auto space-y-2 pr-1">
            {wingetItems.length > 0 ? (
              wingetItems.map((pkg) => {
                const cleanPkgId = pkg.origin?.packageId || (pkg.id.startsWith("winget:") ? pkg.id.replace(/^winget:/, "") : pkg.id);
                return (
                  <div
                    key={pkg.id}
                    onClick={() => setSelectedWingetItem(pkg)}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] p-3.5 hover:border-[color:var(--line-strong)] hover:shadow-md transition-all cursor-pointer group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[14px] text-[color:var(--text-strong)] group-hover:text-[color:var(--status-accent)] transition-colors truncate">
                          {pkg.title}
                        </span>
                        <span className="rounded bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.2 text-[10px] font-mono text-sky-400">
                          Winget
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11.5px] text-[color:var(--text-quiet)] font-mono mt-1 truncate">
                        <span>ID: {cleanPkgId}</span>
                        {pkg.subtitle && <span>· {pkg.subtitle}</span>}
                      </div>
                      <p className="text-[12px] text-[color:var(--text-secondary)] mt-1.5 line-clamp-1">
                        {pkg.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[color:var(--line-subtle)]">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWingetItem(pkg);
                        }}
                        className="rounded-lg border border-[color:var(--line-default)] bg-[color:var(--surface-sunken)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--text-primary)] hover:bg-[color:var(--surface-hover)] transition-colors cursor-pointer"
                      >
                        详情
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWingetItem(pkg);
                        }}
                        className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12px] font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer shadow-sm"
                      >
                        一键安装
                      </button>
                    </div>
                  </div>
                );
              })
            ) : query.trim().length >= 2 && !isWingetSearching ? (
              <div className="py-16 text-center rounded-2xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/30 p-6 space-y-2">
                <div className="text-[14px] font-bold text-[color:var(--text-strong)]">
                  未找到匹配软件
                </div>
                <p className="text-[12px] text-[color:var(--text-quiet)]">
                  {wingetError || `未在 Windows 软件源中找到「${query.trim()}」，请尝试更简短的关键词`}
                </p>
              </div>
            ) : (
              <div className="py-20 text-center rounded-2xl border border-dashed border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/20 p-8 space-y-2">
                <div className="text-[14px] font-bold text-[color:var(--text-strong)]">
                  Windows 开放软件生态检索
                </div>
                <p className="text-[12.5px] text-[color:var(--text-tertiary)] max-w-md mx-auto">
                  输入任意软件名称、包名或缩写（如 git, python, chrome, vlc），即可直接从微软官方 Windows 软件包管理器实时检索并一键安装。
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dynamic Winget Detail Modal */}
      {selectedWingetItem && (
        <DynamicSoftwareDetailModal
          isOpen={true}
          item={selectedWingetItem}
          onClose={() => setSelectedWingetItem(null)}
        />
      )}
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
          环境与存储配置
        </h1>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed">
          管理软件安装位置、安装包缓存，以及需要你手动填写的开发身份与环境参数。
        </p>
      </header>

      {/* 安装与存储策略 */}
      <StoragePolicyCard />

      <div className="mt-2">
        <SectionLabel>需要你亲自完成的环境参数</SectionLabel>
        <p className="text-[color:var(--text-tertiary)] mt-0.5 text-[12.5px]">
          涉及个人身份、网络代理或安全认证的配置，本工具不会替你代填。
        </p>
      </div>

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
  const navigate = useApp((s) => s.navigate);
  const reportText = useApp((s) => s.reportText);
  const downloadReport = useApp((s) => s.downloadReport);

  const enterWizard = (screen: "install" | "bootstrap") => {
    navigate({ surface: "wizard", screen });
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
type LabTab = "experiences" | "atlas" | "pattern-lab";

const FAMILY_FILTER_OPTIONS: { id: ExperienceFamily | "all"; label: string }[] = [
  { id: "all", label: "全部家族" },
  { id: "editorial", label: "版式社论 Editorial" },
  { id: "spatial", label: "星图空间 Spatial" },
  { id: "hardware", label: "硬件触感 Hardware" },
  { id: "cinematic", label: "宽幅电影 Cinematic" },
  { id: "cyber", label: "桌面视窗 Desktop" },
  { id: "terminal", label: "科学图集 Atlas" },
  { id: "minimal", label: "静谧画廊 Gallery" },
  { id: "playful", label: "先锋海报 Poster" },
];

const STYLE_PAGE_SIZE = 6;

function StyleSection() {
  const activeStyle = useApp((s) => s.activeStyle);
  const inventory = useApp((s) => s.inventory);
  // Subscribed to StyleRegistry version: whenever built-in hydrations, Vault sync,
  // or custom style fork/remove occurs, the entire gallery re-evaluates.
  const registryVersion = useApp((s) => s.styleRegistryVersion);
  const customVersion = useApp((s) => s.customExperiencesVersion);
  const [styleBookmarks, setStyleBookmarks] = useState<string[]>(() => Bookmarks.getAll());
  const [previewWorkspaceStyle, setPreviewWorkspaceStyle] = useState<SetupStyle | null>(null);
  const [quickDetailStyle, setQuickDetailStyle] = useState<SetupStyle | null>(null);
  const [playgroundStyleId, setPlaygroundStyleId] = useState<string | null>(null);

  // Design Lab tabs
  const [labTab, setLabTab] = useState<LabTab>("experiences");
  const [familyFilter, setFamilyFilter] = useState<ExperienceFamily | "all">("all");
  const [page, setPage] = useState<number>(1);
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
      setPreviewWorkspaceStyle(null);
      setQuickDetailStyle(null);
      setPlaygroundStyleId(detail?.styleId ?? activeStyle);
    };
    window.addEventListener("setup:open-playground", onOpen);
    return () => window.removeEventListener("setup:open-playground", onOpen);
  }, [activeStyle]);

  const filteredStyles = useMemo(() => {
    return STYLE_REGISTRY.filter((preset) => {
      const profile = resolveExperienceProfile(preset);
      if (familyFilter !== "all" && profile.family !== familyFilter) return false;
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
  }, [filter, familyFilter, styleBookmarks, searchQuery, registryVersion, customVersion]);

  const totalPages = Math.max(1, Math.ceil(filteredStyles.length / STYLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const pageStyles = useMemo(() => {
    const start = (safePage - 1) * STYLE_PAGE_SIZE;
    return filteredStyles.slice(start, start + STYLE_PAGE_SIZE);
  }, [filteredStyles, safePage]);

  // Arrow key navigation between pages in Experience matrix
  useEffect(() => {
    if (labTab !== "experiences" || previewWorkspaceStyle || quickDetailStyle || playgroundStyleId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active as HTMLElement).isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        setPage((p) => Math.max(1, p - 1));
      } else if (e.key === "ArrowRight") {
        setPage((p) => Math.min(totalPages, p + 1));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [labTab, previewWorkspaceStyle, quickDetailStyle, playgroundStyleId, totalPages]);

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const preset of STYLE_REGISTRY) {
      const tier = resolveExperienceProfile(preset).tier;
      counts[tier] = (counts[tier] ?? 0) + 1;
    }
    return counts;
  }, [registryVersion, customVersion]);

  const isActiveStyle = (id: string) =>
    activeStyle === id || (activeStyle === "p5-comic" && id === "phantom-comic");

  const resolvedFor = (preset: SetupStyle) =>
    resolveSetupAction({ type: "style", data: preset }, inventory);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header data-page-hero className="rise flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider bg-[color:var(--status-accent)] text-[color:var(--accent-on)]">
            DESIGN LAB // 视觉实验室 V3
          </div>
          <h1 className="text-[color:var(--text-strong)] mt-2 text-[22px] font-bold tracking-[-0.02em]">
            前端视觉设计实验场 · 体验矩阵与交互实验室
          </h1>
          <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed max-w-3xl">
            面向未来的体验运行时。通过严苛剪影测试（Silhouette Test）的 8 大旗舰体验家族、行业级设计标杆（Award Atlas）与高保真交互物理原型（Pattern Lab），让同一功能呈现出截然不同的视觉灵魂。
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

      {/* The Experience Playground */}
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

      {/* 3-Segmented Tabs Switcher */}
      <div className="flex items-center gap-2 border-b border-[color:var(--line-default)] pb-px">
        <button
          type="button"
          onClick={() => setLabTab("experiences")}
          className={clsx(
            "flex items-center gap-2 px-4 py-2.5 text-[13px] font-bold border-b-2 transition-all cursor-pointer",
            labTab === "experiences"
              ? "border-[color:var(--status-accent)] text-[color:var(--text-strong)] bg-[color:var(--surface-raised)]/60 rounded-t-[var(--radius-control)]"
              : "border-transparent text-[color:var(--text-secondary)] hover:text-[color:var(--text-strong)] hover:border-[color:var(--line-strong)]",
          )}
        >
          <span>体验矩阵 (Experiences)</span>
          <span className="rounded-full bg-[color:var(--surface-hover)] px-2 py-0.5 text-[10.5px] font-mono text-[color:var(--text-quiet)] border border-[color:var(--line-subtle)]">
            {STYLE_REGISTRY.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setLabTab("atlas")}
          className={clsx(
            "flex items-center gap-2 px-4 py-2.5 text-[13px] font-bold border-b-2 transition-all cursor-pointer",
            labTab === "atlas"
              ? "border-[color:var(--status-accent)] text-[color:var(--text-strong)] bg-[color:var(--surface-raised)]/60 rounded-t-[var(--radius-control)]"
              : "border-transparent text-[color:var(--text-secondary)] hover:text-[color:var(--text-strong)] hover:border-[color:var(--line-strong)]",
          )}
        >
          <span>设计标杆 (Award Atlas)</span>
          <span className="rounded-full bg-[color:var(--status-accent)]/15 px-2 py-0.5 text-[10.5px] font-mono font-bold text-[color:var(--status-accent)]">
            12 案例
          </span>
        </button>

        <button
          type="button"
          onClick={() => setLabTab("pattern-lab")}
          className={clsx(
            "flex items-center gap-2 px-4 py-2.5 text-[13px] font-bold border-b-2 transition-all cursor-pointer",
            labTab === "pattern-lab"
              ? "border-[color:var(--status-accent)] text-[color:var(--text-strong)] bg-[color:var(--surface-raised)]/60 rounded-t-[var(--radius-control)]"
              : "border-transparent text-[color:var(--text-secondary)] hover:text-[color:var(--text-strong)] hover:border-[color:var(--line-strong)]",
          )}
        >
          <span>交互实验室 (Pattern Lab)</span>
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-mono font-bold text-emerald-500">
            6 原型
          </span>
        </button>
      </div>

      {/* Tab 2: Award Atlas */}
      {labTab === "atlas" && (
        <div className="rise">
          <AwardAtlas onNotice={(msg) => setNotice(msg)} />
        </div>
      )}

      {/* Tab 3: Pattern Lab */}
      {labTab === "pattern-lab" && (
        <div className="rise">
          <PatternLab onNotice={(msg) => setNotice(msg)} />
        </div>
      )}

      {/* Tab 1: Experience Matrix */}
      {labTab === "experiences" && (
        <div className="flex flex-col gap-4 rise">
          {/* Family Filter Chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[color:var(--text-quiet)] mr-1">
              视觉家族:
            </span>
            {FAMILY_FILTER_OPTIONS.map((f) => {
              const count =
                f.id === "all"
                  ? STYLE_REGISTRY.length
                  : STYLE_REGISTRY.filter((s) => resolveExperienceProfile(s).family === f.id).length;
              const selected = familyFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setFamilyFilter(f.id);
                    setPage(1);
                  }}
                  className={clsx(
                    "px-2.5 py-1 rounded-[var(--radius-control)] text-[11px] font-medium transition-colors border flex items-center gap-1.5 cursor-pointer",
                    selected
                      ? "bg-[color:var(--status-accent)] text-[color:var(--accent-on)] border-transparent font-bold shadow-sm"
                      : "border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/70 text-[color:var(--text-secondary)] hover:text-[color:var(--text-strong)] hover:border-[color:var(--line-strong)]",
                  )}
                >
                  <span>{f.label}</span>
                  <span
                    className={clsx(
                      "text-[9.5px] font-mono px-1 py-0.2 rounded",
                      selected
                        ? "bg-black/20 text-white"
                        : "bg-[color:var(--surface-hover)] text-[color:var(--text-quiet)]",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sub-Filter and Search Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setFilter("all");
                  setPage(1);
                }}
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
                onClick={() => {
                  setFilter("implemented");
                  setPage(1);
                }}
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
                onClick={() => {
                  setFilter("bookmarks");
                  setPage(1);
                }}
                className={clsx(
                  "px-3 py-1.5 rounded-[var(--radius-control)] text-[12px] font-medium transition-colors border",
                  filter === "bookmarks"
                    ? "bg-[color:var(--status-warn)] text-[color:var(--accent-on)] border-transparent font-bold"
                    : "border-[color:var(--status-warn)]/30 bg-[color:var(--status-warn)]/5 text-[color:var(--status-warn)] hover:bg-[color:var(--status-warn)]/10",
                )}
              >
                ★ 收藏 ({styleBookmarks.filter((id) => STYLE_REGISTRY.some((s) => s.id === id)).length})
              </button>
            </div>

            <div className="relative max-w-xs w-full">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="搜索体验名称、灵感、标签…"
                className="w-full rounded-[var(--radius-control)] border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] px-3 py-1.5 text-[12px] text-[color:var(--text-primary)] placeholder-[color:var(--text-quiet)] focus:border-[color:var(--status-accent)] focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Pagination Toolbar Header */}
          <div className="flex items-center justify-between gap-3 pt-2 text-[12px] text-[color:var(--text-secondary)] border-t border-[color:var(--line-subtle)]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11.5px] text-[color:var(--text-quiet)]">
                显示 {filteredStyles.length > 0 ? (safePage - 1) * STYLE_PAGE_SIZE + 1 : 0}-
                {Math.min(safePage * STYLE_PAGE_SIZE, filteredStyles.length)} / 共 {filteredStyles.length} 套体验
              </span>
              <span className="text-[10px] text-[color:var(--text-quiet)] font-mono hidden md:inline">
                (支持键盘 ← / → 翻页)
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-[var(--radius-control)] border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] text-[12px] font-medium hover:border-[color:var(--line-strong)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                title="上一页 (键盘 ←)"
              >
                ‹ 上一页
              </button>
              <span className="px-2 font-mono text-[12px] font-bold text-[color:var(--text-strong)]">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded-[var(--radius-control)] border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] text-[12px] font-medium hover:border-[color:var(--line-strong)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                title="下一页 (键盘 →)"
              >
                下一页 ›
              </button>
            </div>
          </div>

          {/* 3x2 Grid for 6 items per page */}
          <div data-composition-grid className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {pageStyles.map((preset) => {
              const profile = resolveExperienceProfile(preset);
              const resolved = resolvedFor(preset);
              const isActive = isActiveStyle(preset.id);
              const isStarred = styleBookmarks.includes(preset.id);
              const live = isRenderable(preset);
              const familyLabel = profile.family ? (FAMILY_LABEL[profile.family] ?? profile.family) : null;

              return (
                <div
                  key={preset.id}
                  data-style-card={preset.id}
                  data-tier={profile.tier}
                  onClick={() => setQuickDetailStyle(preset)}
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
                          {familyLabel && (
                            <span className="rounded bg-[color:var(--surface-raised)] px-1.5 py-0.2 text-[9.5px] font-mono text-[color:var(--text-tertiary)] border border-[color:var(--line-subtle)]">
                              {familyLabel.split("/")[0]?.trim()}
                            </span>
                          )}
                          {isActive && (
                            <span className="rounded bg-[color:var(--status-accent)] px-1.5 py-0.2 text-[10px] font-black text-[color:var(--accent-on)]">
                              已启用
                            </span>
                          )}
                          {!live && (
                            <span className="rounded bg-[color:var(--surface-hover)] px-1.5 py-0.2 text-[10px] text-[color:var(--text-quiet)]">
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
                        className={`text-[13px] p-0.5 shrink-0 hover:scale-125 transition-transform cursor-pointer ${
                          isStarred
                            ? "text-[color:var(--status-warn)] font-bold"
                            : "text-[color:var(--text-quiet)] opacity-50 hover:opacity-100"
                        }`}
                        title={isStarred ? "取消收藏" : "收藏"}
                        aria-label={isStarred ? "取消收藏" : "收藏"}
                      >
                        {isStarred ? "★" : "☆"}
                      </button>
                    </div>

                    {/* The specimen thumbnail — clicking it opens the full workspace */}
                    <div
                      className="mt-3 overflow-hidden rounded-[var(--radius-control)] border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] hover:border-[color:var(--status-accent)] transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewWorkspaceStyle(preset);
                      }}
                      title="点击打开完整预览工作区"
                    >
                      <ExperienceThumbnail style={preset} className="h-[132px] w-full" />
                    </div>

                    {/* Grammar readout */}
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

                  {/* Primary Setup Action */}
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
                      data-preview-trigger={preset.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewWorkspaceStyle(preset);
                      }}
                      className="mt-2 w-full text-left text-[11px] text-[color:var(--status-accent)] hover:underline cursor-pointer"
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
              body="换个关键词、清除家族筛选，或切回「全部体验」。"
            />
          )}

          {/* Bottom Pagination Toolbar when multiple pages */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-[color:var(--line-subtle)] text-[12px] text-[color:var(--text-secondary)]">
              <span className="font-mono text-[11.5px] text-[color:var(--text-quiet)]">
                第 {safePage} 页，共 {totalPages} 页 (每页 6 套)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => {
                    setPage((p) => Math.max(1, p - 1));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="px-3 py-1 rounded-[var(--radius-control)] border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] text-[12px] font-medium hover:border-[color:var(--line-strong)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                >
                  ‹ 上一页
                </button>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => {
                    setPage((p) => Math.min(totalPages, p + 1));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="px-3 py-1 rounded-[var(--radius-control)] border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] text-[12px] font-medium hover:border-[color:var(--line-strong)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                >
                  下一页 ›
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Detail modal for brief inspection (DetailShell) */}
      {quickDetailStyle && (
        <StyleQuickDetailModal
          style={quickDetailStyle}
          inventory={inventory}
          active={isActiveStyle(quickDetailStyle.id)}
          starred={styleBookmarks.includes(quickDetailStyle.id)}
          onToggleStar={() => Bookmarks.toggle(quickDetailStyle.id, quickDetailStyle.name)}
          onOpenWorkspace={() => {
            const target = quickDetailStyle;
            setQuickDetailStyle(null);
            setPreviewWorkspaceStyle(target);
          }}
          onClose={() => setQuickDetailStyle(null)}
          onNotice={setNotice}
        />
      )}

      {/* Dedicated Experience Preview Workspace */}
      {previewWorkspaceStyle && (
        <ExperiencePreviewWorkspace
          isOpen={true}
          style={previewWorkspaceStyle}
          active={isActiveStyle(previewWorkspaceStyle.id)}
          starred={styleBookmarks.includes(previewWorkspaceStyle.id)}
          onToggleStar={() => Bookmarks.toggle(previewWorkspaceStyle.id, previewWorkspaceStyle.name)}
          onClose={() => setPreviewWorkspaceStyle(null)}
          onNotice={setNotice}
          hasPrev={
            filteredStyles.findIndex((s) => s.id === previewWorkspaceStyle.id) > 0
          }
          hasNext={
            filteredStyles.findIndex((s) => s.id === previewWorkspaceStyle.id) >= 0 &&
            filteredStyles.findIndex((s) => s.id === previewWorkspaceStyle.id) < filteredStyles.length - 1
          }
          onPrev={() => {
            const idx = filteredStyles.findIndex((s) => s.id === previewWorkspaceStyle.id);
            if (idx > 0) setPreviewWorkspaceStyle(filteredStyles[idx - 1]);
          }}
          onNext={() => {
            const idx = filteredStyles.findIndex((s) => s.id === previewWorkspaceStyle.id);
            if (idx >= 0 && idx < filteredStyles.length - 1) {
              setPreviewWorkspaceStyle(filteredStyles[idx + 1]);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Lightweight Style Quick Detail surface: rendered when clicking a Style Card.
 * Uses DetailShell for concise information without the giant specimen,
 * and provides a direct entry into ExperiencePreviewWorkspace.
 */
function StyleQuickDetailModal({
  style,
  inventory,
  active,
  starred,
  onToggleStar,
  onOpenWorkspace,
  onClose,
  onNotice,
}: {
  style: SetupStyle;
  inventory: ReturnType<typeof useApp.getState>["inventory"];
  active: boolean;
  starred: boolean;
  onToggleStar: () => void;
  onOpenWorkspace: () => void;
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
      width="lg"
      badge={
        active ? (
          <span className="rounded bg-[color:var(--status-accent)] px-2 py-0.5 text-[11px] font-black text-[color:var(--accent-on)]">
            全局已启用
          </span>
        ) : live ? (
          <span className="rounded bg-[color:var(--status-ok)]/20 px-2 py-0.5 text-[11px] font-bold text-[color:var(--status-ok)] border border-[color:var(--status-ok)]/30">
            可立即使用
          </span>
        ) : (
          <span className="rounded bg-[color:var(--surface-hover)] px-2 py-0.5 text-[11px] text-[color:var(--text-quiet)]">
            需要更新应用
          </span>
        )
      }
      actions={
        <>
          <button
            type="button"
            onClick={onToggleStar}
            className="rounded-[var(--radius-control)] border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--text-secondary)] hover:text-[color:var(--text-strong)] transition-colors cursor-pointer"
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
      {/* Prominent CTA to Full Preview Workspace */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-[color:var(--line-strong)] bg-[color:var(--surface-raised)]/90 shadow-sm">
        <div>
          <h4 className="text-[13.5px] font-bold text-[color:var(--text-strong)]">
            想要查看大尺寸真实界面样张与令牌度量？
          </h4>
          <p className="text-[12px] text-[color:var(--text-tertiary)] mt-0.5">
            在专属中性工作区中预览导航、卡片、表单与全套语法参数。
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenWorkspace}
          className="flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-[color:var(--status-accent)] px-3.5 py-1.5 text-[12px] font-bold text-[color:var(--accent-on)] hover:opacity-90 transition-opacity cursor-pointer shrink-0 shadow-sm"
        >
          <span>进入完整预览工作区</span>
          <span>↗</span>
        </button>
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

/** The 关于 section: version facts, open source links, and local-first guarantee. */
function AboutSection() {
  const status = useApp((s) => s.status);
  const loadStatus = useApp((s) => s.loadStatus);

  useEffect(() => {
    if (!status) void loadStatus();
  }, [status, loadStatus]);

  return (
    <div className="flex flex-col gap-8">
      <header className="rise">
        <div className="inline-flex items-center gap-2 rounded px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[color:var(--status-accent)] bg-[color:var(--surface-sunken)] mb-2">
          ABOUT // 关于项目
        </div>
        <h1 className="text-[color:var(--text-strong)] text-[22px] font-bold tracking-[-0.02em]">
          Setup Center
        </h1>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed max-w-xl">
          面向开发者与初学者的 Creative & Development Bootstrap Hub。
          让「找到东西 → 看懂它 → 决定用它 → 开始使用」真正形成无缝闭环。
        </p>
        <p className="text-[color:var(--text-quiet)] mt-1.5 text-[12px] font-mono">
          版本 v0.2.0 · 核心引擎就绪
        </p>
      </header>

      {/* Open Source & Community */}
      <section className="glass rose rise rounded-[12px] p-5">
        <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium mb-1">
          开源与社区交流
        </div>
        <p className="text-[color:var(--text-tertiary)] text-[12.5px] leading-relaxed mb-4">
          Setup Center 完全免费、开源、本地优先。欢迎在 GitHub 上提出 Issue 或参与贡献。
        </p>
        <div className="flex flex-col gap-3 text-[12.5px]">
          <div className="flex items-center justify-between">
            <span className="text-[color:var(--text-secondary)]">主仓库 (GitHub)</span>
            <a
              href="https://github.com/Arukasaeled/setup-center"
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--status-accent)] hover:underline font-mono"
            >
              github.com/Arukasaeled/setup-center ↗
            </a>
          </div>
          <div className="flex items-center justify-between border-t border-[color:var(--line-subtle)] pt-2.5">
            <span className="text-[color:var(--text-secondary)]">Setup Vault 远程内容仓库</span>
            <a
              href="https://github.com/Arukasaeled/setup-center-vault"
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--status-accent)] hover:underline font-mono"
            >
              github.com/Arukasaeled/setup-center-vault ↗
            </a>
          </div>
          <div className="flex items-center justify-between border-t border-[color:var(--line-subtle)] pt-2.5">
            <span className="text-[color:var(--text-secondary)]">开发者技术交流与反馈</span>
            <span className="text-[color:var(--text-primary)] font-mono">
              QQ: 1700142491 · 微信: Arukas_0623
            </span>
          </div>
        </div>
      </section>

      {/* Engine capabilities */}
      <section className="rise">
        <SectionLabel>系统架构与核心组件</SectionLabel>
        <div className="mt-3 flex flex-col gap-1.5 text-[12.5px]">
          <DetailRow
            label="许可协议"
            value="MIT License (完全免费开源)"
            confidence="ok"
          />
          <DetailRow
            label="环境感知"
            value="深度系统检测与硬件侦测已就绪"
            confidence="ok"
          />
          <DetailRow
            label="软件生态"
            value="内置 36 款精选软件 + Winget 官方源实时检索"
            confidence="ok"
          />
          <DetailRow
            label="开发资源"
            value="386+ 精选组件库、工程模板与开发资源"
            confidence="ok"
          />
          <DetailRow
            label="体验系统"
            value="Experience System V2 (20 套原生体验)"
            confidence="ok"
          />
        </div>
      </section>

      <p className="text-[color:var(--text-quiet)] rise text-[12px] leading-relaxed">
        本工具坚持 Local-First 本地优先理念，绝不上传任何硬件信息或个人隐私。全部配置与脚手架均在本地安全执行。
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
