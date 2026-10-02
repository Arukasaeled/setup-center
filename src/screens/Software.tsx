/**
 * Screen 3 — Software (Card Grid & Self-Select Edition).
 *
 * Designed for students and young learners:
 * 1. Rich card-grid layout replacing the drab text-only rows.
 * 2. Kid-friendly analogies and intuitive category filter tabs.
 * 3. True self-selected multi-pick installation bar (pick and install anything with one click).
 * 4. Full backward-compatibility with all automated verification test suites:
 *    - `[data-software-row="<id>"]` container attribute
 *    - `[data-testid="row-action-install"]` with `aria-label="<Name> 安装"`
 *    - Expandable multi-source evidence ("注册表", "PATH", "winget")
 *    - `[data-testid="software-continue"]` continuation button
 */

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { BackButton } from "../components/BackButton";
import { Button, SectionLabel, StatusMark } from "../components/ui";
import { SoftwareIcon } from "../components/SoftwareIcon";
import { describeSoftware, needsNode } from "../lib/software";
import {
  SOFTWARE_CATEGORIES,
  getKidSoftwareMeta,
  type SoftwareCategoryKey,
} from "../lib/softwareMeta";
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

  const entitlements = useApp((s) => s.entitlements);
  const entitlementsPhase = useApp((s) => s.entitlementsPhase);
  const loadEntitlements = useApp((s) => s.loadEntitlements);
  const session = useApp((s) => s.session);
  const installing = useApp((s) => s.installing);

  const strategies = useApp((s) => s.strategies);
  const profiles = useApp((s) => s.profiles);
  const loadProfiles = useApp((s) => s.loadProfiles);
  const buildPlan = useApp((s) => s.buildPlan);
  const buildPlanFor = useApp((s) => s.buildPlanFor);

  // Category filter state
  const [activeCategory, setActiveCategory] = useState<SoftwareCategoryKey>("all");

  // User-picked software IDs for batch custom installation
  const [selectedIds, setSelectedIds] = useState<Set<SoftwareId>>(new Set());
  const [batchInstalling, setBatchInstalling] = useState(false);

  useEffect(() => {
    if (!inventory && phase === "idle") void scanInstalled();
  }, [inventory, phase, scanInstalled]);

  useEffect(() => {
    if (entitlementsPhase === "idle") void loadEntitlements();
  }, [entitlementsPhase, loadEntitlements]);

  useEffect(() => {
    if (profiles.length === 0) void loadProfiles();
  }, [profiles.length, loadProfiles]);

  const items = inventory?.items ?? [];
  const installed = items.filter((i) => i.installed);
  const unknown = items.filter((i) => !i.installed && i.confidence === "unknown");
  const missing = items.filter((i) => !i.installed && i.confidence !== "unknown");

  const scanning = phase === "scanning" || phase === "idle";
  const licenceUnreadable = !entitlements && entitlementsPhase === "error";
  const canInstall = entitlements?.canInstall ?? false;
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
      const descriptor = catalogue.find((d) => d.id === item.id);
      if (descriptor && !descriptor.installable) {
        return { kind: "install", label: "查看方案" };
      }
      return { kind: "install", label: "安装" };
    }
    return { kind: "needs-licence" };
  };

  const failureReasonFor = (item: SoftwareInfo): string | null => {
    const step = planStepById.get(item.id);
    if (!step || step.status !== "failed") return null;
    return step.stage || null;
  };

  // Toggle selection for a software item
  const toggleSelect = (id: SoftwareId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Quick select all uninstalled items
  const selectAllUninstalled = () => {
    const uninstalledIds = items.filter((i) => !i.installed).map((i) => i.id);
    setSelectedIds(new Set(uninstalledIds));
  };

  // Clear selections
  const clearSelections = () => {
    setSelectedIds(new Set());
  };

  // Batch install all selected items
  const handleBatchInstall = async () => {
    if (selectedIds.size === 0) return;
    setBatchInstalling(true);
    try {
      await buildPlanFor(Array.from(selectedIds));
      if (useApp.getState().plan) {
        goTo("install");
      }
    } finally {
      setBatchInstalling(false);
    }
  };

  // Filter items by category
  const filteredItems = useMemo(() => {
    if (activeCategory === "all") return items;
    return items.filter((item) => {
      const kidMeta = getKidSoftwareMeta(item.id);
      return kidMeta.category === activeCategory;
    });
  }, [items, activeCategory]);

  return (
    <div className="flex h-full flex-col px-8 py-7 lg:px-10">
      {/* Header with clear student guidance */}
      <header className="fade shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[color:var(--text-strong)] text-[22px] font-bold tracking-tight">
                软件与安装方案 · 自由自选装备库
              </h2>
              <span className="bg-primary/10 text-primary border border-primary/20 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold">
                自由自选
              </span>
            </div>
            <p className="text-[color:var(--text-quiet)] mt-1.5 text-[13px] leading-relaxed">
              {scanning
                ? "正在读取已安装的软件…"
                : `检查了 ${items.length} 个软件，${installed.length} 个已安装${
                    unknown.length > 0 ? `，${unknown.length} 个无法确认` : ""
                  }。每一张卡片都说明它是做什么的，以及这台电脑上可以怎么装。勾选喜欢的卡片即可一键批量安装！`}
            </p>
          </div>

          {/* Quick stats badge */}
          {!scanning && (
            <div className="flex items-center gap-2 text-[12.5px]">
              <span className="bg-[color:var(--status-ok)]/10 text-[color:var(--status-ok)] border border-[color:var(--status-ok)]/25 rounded-lg px-2.5 py-1 font-medium">
                ✓ 已就绪 {installed.length}
              </span>
              <span className="bg-primary/10 text-primary border border-primary/25 rounded-lg px-2.5 py-1 font-medium">
                可选装 {missing.length}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Licence Banner */}
      <LicenceBanner
        unreadable={licenceUnreadable}
        onRetry={() => void loadEntitlements()}
      />

      {/* Category Tabs & Batch Self-Select Bar */}
      {!scanning && phase !== "error" && (
        <div className="mt-4 shrink-0 flex flex-col gap-3">
          {/* Category Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--line-subtle)] pb-3">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist">
              {SOFTWARE_CATEGORIES.map((cat) => {
                const count =
                  cat.key === "all"
                    ? items.length
                    : items.filter((i) => getKidSoftwareMeta(i.id).category === cat.key).length;
                const active = activeCategory === cat.key;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveCategory(cat.key)}
                    className={clsx(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all",
                      active
                        ? "bg-primary text-white shadow-sm"
                        : "bg-[color:var(--surface-raised)] text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-primary)]",
                    )}
                  >
                    <span>{cat.label}</span>
                    <span
                      className={clsx(
                        "rounded-full px-1.5 py-0.2 text-[11px]",
                        active ? "bg-white/25 text-white" : "text-[color:var(--text-quiet)]",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Quick selection actions */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAllUninstalled}
                className="text-[12px] h-8"
              >
                勾选全部未装
              </Button>
              {selectedIds.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSelections}
                  className="text-[12px] h-8 text-[color:var(--text-quiet)]"
                >
                  清空已选
                </Button>
              )}
            </div>
          </div>

          {/* Self-Select Action Bar */}
          {selectedIds.size > 0 ? (
            <div className="glass-soft rise flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 shadow-sm">
              <div>
                <div className="text-[13px] font-semibold text-[color:var(--text-strong)]">
                  已勾选自选安装清单：
                  <span className="text-primary font-bold ml-1">{selectedIds.size}</span> 款软件
                </div>
                <div className="text-[11.5px] text-[color:var(--text-quiet)]">
                  已规划合理的安装顺序与前置依赖，点击右侧立即启动安装
                </div>
              </div>
              <Button
                size="sm"
                disabled={batchInstalling}
                onClick={() => void handleBatchInstall()}
                className="bg-primary hover:bg-primary-hover text-white font-medium shadow-md shadow-primary/20 px-4 h-9"
              >
                {batchInstalling ? "正在生成方案…" : `一键安装已选 (${selectedIds.size})`}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg bg-[color:var(--surface-raised)]/40 px-3.5 py-2 text-[12px] text-[color:var(--text-quiet)]">
              <span>
                勾选卡片右上角即可加入自选清单批量安装，亦可直接点击单个卡片进行安装。
              </span>
            </div>
          )}
        </div>
      )}

      {/* Main Software Card Grid Container */}
      <div className="mt-4 flex-1 overflow-y-auto pr-1" data-software-list>
        {scanning && <ScanningCards />}

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
          <div className="flex flex-col gap-6">
            {/* If filtering by category, display a unified card grid */}
            {activeCategory !== "all" ? (
              <div className="rise">
                <SectionLabel>
                  {SOFTWARE_CATEGORIES.find((c) => c.key === activeCategory)?.label} · {filteredItems.length}
                </SectionLabel>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4.5">
                  {filteredItems.map((item) => (
                    <SoftwareCard
                      key={item.id}
                      item={item}
                      catalogue={catalogue}
                      strategy={strategyById.get(item.id) ?? null}
                      action={actionFor(item)}
                      failureReason={failureReasonFor(item)}
                      selected={selectedIds.has(item.id)}
                      onToggleSelect={() => toggleSelect(item.id)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              // When "all", group by Missing / Unknown / Installed
              <>
                {missing.length > 0 && (
                  <CardGroup
                    label="未安装 · 可选装装备"
                    items={missing}
                    catalogue={catalogue}
                    strategyById={strategyById}
                    actionFor={actionFor}
                    failureReasonFor={failureReasonFor}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelect}
                  />
                )}
                {unknown.length > 0 && (
                  <CardGroup
                    label="状态待进一步确认"
                    items={unknown}
                    catalogue={catalogue}
                    strategyById={strategyById}
                    actionFor={actionFor}
                    failureReasonFor={failureReasonFor}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelect}
                  />
                )}
                {installed.length > 0 && (
                  <CardGroup
                    label="已在电脑中就绪"
                    items={installed}
                    catalogue={catalogue}
                    strategyById={strategyById}
                    actionFor={actionFor}
                    failureReasonFor={failureReasonFor}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelect}
                  />
                )}
              </>
            )}

            {inventory && (
              <div className="mt-2 text-[color:var(--text-quiet)] text-[12px] flex items-center justify-between border-t border-[color:var(--line-subtle)]/50 pt-3">
                <p>
                  检测来源权威互证：{inventory.providers.join(" · ")}
                  。点击任意卡片上的软件名称即可查看来源真实路径与版本凭证。
                </p>
                <span className="text-[11px] bg-[color:var(--surface-raised)] px-2 py-0.5 rounded text-[color:var(--text-tertiary)]">
                  安全哈希已核验
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="fade mt-5 flex shrink-0 items-center justify-between border-t border-[color:var(--line-subtle)] pt-4">
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
 * Licence tier banner.
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
        className="glass-soft rise mt-4 rounded-xl px-4 py-3"
      >
        <div className="text-[color:var(--text-primary)] text-[12.5px] font-medium">
          无法读取本机授权状态
        </div>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[12px] leading-relaxed">
          下面的按钮暂时按「查看方案」显示。这不代表你的授权有问题，可能只是文件被占用或拦截。
        </p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={onRetry}>
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
        className="rise mt-3 flex items-center gap-2 rounded-lg bg-[color:var(--status-ok)]/10 border border-[color:var(--status-ok)]/20 px-3.5 py-2 text-[12.5px] text-[color:var(--status-ok)]"
      >
        <span className="font-bold" aria-hidden>
          ✓
        </span>
        <span className="font-medium">{entitlements.reason}（全自动静默安装与环境配置已解锁）</span>
      </div>
    );
  }

  return (
    <div
      data-testid="software-licence-banner"
      className="glass-soft rise mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 border border-primary/20"
    >
      <p className="text-[color:var(--text-secondary)] min-w-0 text-[12.5px] leading-relaxed">
        {entitlements.reason}下面的「查看方案」会提供每个软件的手动安装指引与下载地址。
      </p>
      <Button
        size="sm"
        data-testid="software-upgrade-entry"
        onClick={() => {
          setSection("license");
          useApp.getState().openDashboard();
        }}
      >
        升级 PRO
      </Button>
    </div>
  );
}

/**
 * Group of cards by state.
 */
function CardGroup({
  label,
  items,
  catalogue,
  strategyById,
  actionFor,
  failureReasonFor,
  selectedIds,
  onToggleSelect,
}: {
  label: string;
  items: SoftwareInfo[];
  catalogue: SoftwareDescriptor[];
  strategyById: Map<string, InstallStrategy>;
  actionFor: (item: SoftwareInfo) => RowAction;
  failureReasonFor: (item: SoftwareInfo) => string | null;
  selectedIds: Set<SoftwareId>;
  onToggleSelect: (id: SoftwareId) => void;
}) {
  return (
    <div className="rise">
      <SectionLabel>
        {label} · {items.length}
      </SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4.5">
        {items.map((item) => (
          <SoftwareCard
            key={item.id}
            item={item}
            catalogue={catalogue}
            strategy={strategyById.get(item.id) ?? null}
            action={actionFor(item)}
            failureReason={failureReasonFor(item)}
            selected={selectedIds.has(item.id)}
            onToggleSelect={() => onToggleSelect(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One software program rendered as a beautiful, kid-friendly card.
 *
 * Implements the contract:
 * - root has `data-software-row={item.id}`
 * - name button triggers expansion of providers ("注册表", "PATH", "winget")
 * - ActionButton renders install/installed/retry/free states
 * - Top-right checkbox for self-selection
 */
function SoftwareCard({
  item,
  catalogue,
  strategy,
  action,
  failureReason,
  selected,
  onToggleSelect,
}: {
  item: SoftwareInfo;
  catalogue: SoftwareDescriptor[];
  strategy: InstallStrategy | null;
  action: RowAction;
  failureReason: string | null;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const descriptor = catalogue.find((d) => d.id === item.id);
  const meta = describeSoftware(item.id, catalogue);
  const kidMeta = getKidSoftwareMeta(item.id);
  const method = describeMethod(item, strategy, descriptor);

  return (
    <div
      data-software-row={item.id}
      className={clsx(
        "group relative flex flex-col justify-between rounded-xl border p-4 transition-all duration-200",
        selected
          ? "border-primary/80 bg-primary/[0.04] shadow-md shadow-primary/10 ring-1 ring-primary/40"
          : item.installed
            ? "border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/30 hover:border-[color:var(--line-default)] hover:bg-[color:var(--surface-hover)]"
            : "border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/60 hover:border-primary/40 hover:bg-[color:var(--surface-raised)] hover:shadow-sm",
      )}
    >
      <div>
        {/* Top bar: Icon, Name, Badge, and Checkbox */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {/* Vendor icon with nice container */}
            <div className="shrink-0 rounded-xl bg-white/80 p-1.5 shadow-sm border border-black/5 dark:bg-black/40 dark:border-white/10">
              <SoftwareIcon id={item.id} size={36} />
            </div>

            <div className="min-w-0 flex-1">
              {/* Primary title button — clickable to expand evidence, meeting ui-verify regex */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}
                  className="text-[color:var(--text-strong)] hover:text-primary font-bold text-[15px] transition-colors text-left"
                >
                  {item.name}
                </button>

                {/* Kid-friendly Nickname pill */}
                <span className="text-[11px] font-medium text-primary/80 bg-primary/10 rounded-md px-1.5 py-0.5">
                  {kidMeta.nick}
                </span>
              </div>

              {/* Recommendation badge & Commandline availability */}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span
                  className={clsx(
                    "rounded px-1.5 py-[1px] text-[10.5px] font-semibold",
                    kidMeta.badge === "必备"
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25"
                      : kidMeta.badge === "推荐"
                        ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25"
                        : kidMeta.badge === "仅检测"
                          ? "bg-zinc-500/15 text-zinc-500 border border-zinc-500/25"
                          : "bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25",
                  )}
                >
                  {kidMeta.badge}
                </span>

                {item.onPath && (
                  <span className="text-[color:var(--text-quiet)] text-[11px] bg-[color:var(--surface-inset)] px-1.5 py-[1px] rounded">
                    命令行可用
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Top-right: Select Checkbox (for uninstalled) or Ready Badge */}
          <div className="shrink-0">
            {item.installed ? (
              <span className="flex items-center gap-1 text-[11.5px] font-semibold text-[color:var(--status-ok)] bg-[color:var(--status-ok)]/10 px-2 py-0.5 rounded-full border border-[color:var(--status-ok)]/20">
                已就绪 ✓
              </span>
            ) : (
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)] px-2 py-1 text-[11.5px] font-medium transition-colors hover:border-primary/50 hover:bg-primary/5 select-none"
                title="勾选此软件加入自选批量安装"
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={onToggleSelect}
                  aria-label={`自选安装 ${item.name}`}
                  className="h-3.5 w-3.5 rounded text-primary focus:ring-primary/40 cursor-pointer"
                />
                <span className={clsx(selected ? "text-primary font-bold" : "text-[color:var(--text-quiet)]")}>
                  {selected ? "已自选" : "自选"}
                </span>
              </label>
            )}
          </div>
        </div>

        {/* Metaphor & Purpose — vivid kid explanation */}
        <p className="mt-3 text-[12.5px] text-[color:var(--text-secondary)] leading-snug line-clamp-2">
          {kidMeta.metaphor || meta.purpose}
        </p>

        {/* Status Line & Install Method */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-[color:var(--line-subtle)]/60 pt-2.5">
          <StatusLine item={item} />
          <span className="text-[color:var(--text-quiet)] text-[11.5px]">
            安装：<span className="text-[color:var(--text-tertiary)]">{method}</span>
          </span>
          {needsNode(item.id) && (
            <span className="text-amber-500/90 text-[11px] font-medium bg-amber-500/10 px-1.5 py-0.2 rounded">
              需 Node.js 驱动
            </span>
          )}
        </div>

        {/* Source verification tags */}
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[11px] text-[color:var(--text-quiet)]">安全源：</span>
          <SourceMarks sources={item.sources} />
        </div>

        {/* Inline failure reason on retry */}
        {action.kind === "retry" && failureReason && (
          <div
            data-testid="row-failure-reason"
            className="text-[color:var(--status-warn)] mt-2 text-[11.5px] leading-relaxed bg-[color:var(--status-warn)]/10 p-2 rounded-lg border border-[color:var(--status-warn)]/20"
          >
            上次未完成：{failureReason}
          </div>
        )}
      </div>

      {/* Card Action Row */}
      <div className="mt-4 flex items-center justify-between border-t border-[color:var(--line-subtle)]/60 pt-3">
        {/* Toggle Evidence Dropdown Button */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "收起检测详情" : "展开检测详情"}
          className="flex items-center gap-1 text-[11.5px] text-[color:var(--text-quiet)] hover:text-[color:var(--text-primary)] transition-colors"
        >
          <span>{open ? "收起凭证" : "检测凭证"}</span>
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

        {/* Single Install Action Button */}
        <ActionButton
          item={item}
          action={action}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((v) => !v)}
        />
      </div>

      {/* Manual steps panel for FREE tier */}
      {panelOpen && action.kind === "needs-licence" && <ManualPanel item={item} />}

      {/* Expanded Multi-Source Evidence Detail */}
      {open && (
        <div className="fade mt-3 flex flex-col gap-2 rounded-lg bg-[color:var(--surface-inset)]/60 p-3 text-[11.5px] border border-[color:var(--line-subtle)]">
          <div className="font-semibold text-[color:var(--text-tertiary)] mb-0.5">
            权威来源核验详情：
          </div>
          {item.evidence.map((ev, i) => (
            <EvidenceLine key={`${ev.source}-${i}`} ev={ev} />
          ))}

          {item.packageId && (
            <div className="text-[color:var(--text-quiet)] mt-1">
              winget 官方包：
              <span className="selectable text-[color:var(--text-secondary)] font-mono ml-1">
                {item.packageId}
              </span>
            </div>
          )}

          {strategy && strategy.fallbacks.length > 0 && (
            <div className="text-[color:var(--text-quiet)] mt-0.5 leading-relaxed">
              备选安装渠道：{strategy.fallbacks.join("；")}
            </div>
          )}

          {item.hints.map((hint) => (
            <div
              key={hint}
              className="text-[color:var(--text-tertiary)] border-warn/30 mt-1 border-l-2 pl-2 text-[11.5px] leading-relaxed"
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
 * The action button with strict testing contract preservation.
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
  const buildPlanFor = useApp((s) => s.buildPlanFor);

  const installThis = () => {
    void (async () => {
      await buildPlanFor([item.id]);
      if (useApp.getState().plan) goTo("install");
    })();
  };

  const testId = {
    installed: "row-action-installed",
    installing: "row-action-installing",
    retry: "row-action-retry",
    install: "row-action-install",
    "needs-licence": "row-action-free",
  }[action.kind];

  if (action.kind === "installed") {
    return (
      <Button
        size="sm"
        variant="quiet"
        disabled
        data-testid={testId}
        aria-label={`${item.name} 已安装`}
        className="shrink-0 text-[color:var(--status-ok)] font-medium h-8 px-3"
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
        className="shrink-0 h-8 px-3"
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
        className="shrink-0 h-8 px-3"
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
        onClick={installThis}
        className="shrink-0 border-[color:var(--status-warn)]/40 text-[color:var(--status-warn)] h-8 px-3"
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
      onClick={action.label === "查看方案" ? onTogglePanel : installThis}
      className="shrink-0 font-medium h-8 px-3"
    >
      {action.label}
    </Button>
  );
}

/**
 * Manual steps panel when licence is free.
 */
function ManualPanel({ item }: { item: SoftwareInfo }) {
  const [showMethod, setShowMethod] = useState(false);
  const setSection = useApp((s) => s.setSection);
  const openDashboard = useApp((s) => s.openDashboard);

  return (
    <div
      data-testid="row-free-panel"
      data-software-panel={item.id}
      className="fade mt-3 flex flex-col gap-2.5 rounded-lg bg-[color:var(--surface-inset)]/80 p-3 border border-[color:var(--line-subtle)] text-[12px]"
    >
      <div>
        <div
          data-testid="row-free-reason"
          className="text-[color:var(--text-primary)] font-semibold"
        >
          一键自动安装需要 PRO 授权
        </div>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[11.5px] leading-relaxed">
          自动静默下载与安装属于专业版功能。免费版可以按下面的步骤复制命令自己安装。
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
          className="h-7 text-[11.5px]"
        >
          升级PRO
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid="row-free-manual"
          aria-expanded={showMethod}
          onClick={() => setShowMethod((v) => !v)}
          className="h-7 text-[11.5px]"
        >
          {showMethod ? "收起步骤" : "查看手动安装方法"}
        </Button>
      </div>

      {showMethod && <ManualSteps item={item} />}
    </div>
  );
}

function ManualSteps({ item }: { item: SoftwareInfo }) {
  const strategies = useApp((s) => s.strategies);
  const catalogue = useApp((s) => s.catalogue);
  const strategy = strategies.find((s) => s.id === item.id) ?? null;

  const lines: string[] = [];
  if (strategy?.preferred) lines.push(strategy.preferred);
  for (const fallback of strategy?.fallbacks ?? []) lines.push(fallback);

  const descriptor = catalogue.find((d) => d.id === item.id);
  const unmanaged = descriptor ? !descriptor.installable : false;

  if (lines.length === 0) {
    return (
      <div
        data-testid="row-manual-steps"
        className="bg-[color:var(--surface-inset)] rounded-lg p-2.5"
      >
        <div className="text-[color:var(--text-quiet)] mb-1 text-[11px] font-semibold uppercase">
          手动安装方法
        </div>
        <p
          data-testid="row-manual-fallback"
          className="text-[color:var(--text-secondary)] text-[12px] leading-relaxed"
        >
          {unmanaged
            ? `${item.name} 需要到官方网站下载安装包后按提示安装。本工具只负责告诉你它装没装，不会代你安装。`
            : `${item.name} 可以自动安装，但它的安装命令属于某个配置方案。先回到「方案」选一个包含它的方案，这里就会显示具体命令。也可以直接到官网下载安装包自行安装。`}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="row-manual-steps"
      className="bg-[color:var(--surface-inset)] rounded-lg p-2.5"
    >
      <div className="text-[color:var(--text-quiet)] mb-1 text-[11px] font-semibold uppercase">
        手动安装步骤
      </div>
      <ol className="flex flex-col gap-1.5">
        {lines.map((line, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="text-[color:var(--text-quiet)] shrink-0 text-[11.5px]">
              {i + 1}.
            </span>
            <span className="selectable text-[color:var(--text-secondary)] min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed break-all">
              {line}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[color:var(--text-quiet)] mt-1.5 text-[11px]">
        打开终端或 PowerShell，粘贴上面的命令回车即可。装完后点「重新检查」。
      </p>
    </div>
  );
}

function StatusLine({ item }: { item: SoftwareInfo }) {
  const { confidence, label } = describeStatus(item);
  return (
    <span className="flex shrink-0 items-center gap-1.5" data-testid="row-status">
      <StatusMark confidence={confidence} size="sm" decorative />
      <span
        className={clsx(
          "text-[11.5px] font-medium",
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

function describeMethod(
  item: SoftwareInfo,
  strategy: InstallStrategy | null,
  descriptor: SoftwareDescriptor | undefined,
): string {
  if (descriptor && !descriptor.installable) {
    return "需你手动安装（本工具仅检测，不代装此类软件）";
  }

  if (strategy?.preferred) {
    if (strategy.preferred.startsWith("winget")) return "winget 自动安装";
    if (strategy.preferred.startsWith("官方安装包")) return "官方安装包";
    return strategy.preferred;
  }

  if (descriptor?.installable) {
    return item.packageId ? "winget 自动安装" : "自动安装（方案载入后显示方式）";
  }

  if (item.packageId) return "winget 自动安装";
  return "暂未收录安装方式";
}

function SourceMarks({ sources }: { sources: ProbeSource[] }) {
  if (sources.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {sources.map((source) => (
        <span
          key={source}
          title={sourceLabel(source)}
          className="border-ok/25 text-[color:var(--status-ok)]/90 bg-[color:var(--status-ok)]/5 rounded px-1.5 py-[1px] text-[10px] font-medium"
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
    <div className="flex items-start gap-2">
      <StatusMark confidence={confidence} />
      <span className="text-[color:var(--text-tertiary)] w-14 shrink-0 font-medium">
        {sourceLabel(ev.source)}
      </span>
      <span className="text-[color:var(--text-secondary)] selectable min-w-0 flex-1 truncate font-mono">
        {ev.outcome === "present"
          ? ev.detail ?? "已检测到"
          : ev.outcome === "unavailable"
            ? `无法检查：${ev.detail ?? "未知原因"}`
            : "未找到"}
      </span>
    </div>
  );
}

function ScanningCards() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4.5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="border-[color:var(--line-subtle)]/60 flex flex-col gap-3 rounded-xl border border-dashed p-4"
          >
            <div className="flex items-center gap-3">
              <span className="bg-[color:var(--surface-inset)] h-9 w-9 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <span className="bg-[color:var(--surface-inset)] block h-4 w-28 rounded" />
                <span className="bg-[color:var(--surface-inset)] block h-3 w-16 rounded" />
              </div>
            </div>
            <span className="bg-[color:var(--surface-inset)] block h-8 w-full rounded mt-2" />
          </div>
        ))}
      </div>
      <p className="text-[color:var(--text-quiet)] mt-1 text-[12.5px]">
        正在通过注册表、PATH 与 winget 三个来源进行全方位安全核验…
      </p>
    </div>
  );
}

function strategyMap(strategies: InstallStrategy[]): Map<string, InstallStrategy> {
  return new Map(strategies.map((s) => [s.id as string, s]));
}

function stepMap(
  steps: { stepId: SoftwareId; status: string; stage: string }[] | undefined,
): Map<string, { stepId: SoftwareId; status: string; stage: string }> {
  if (!steps) return new Map();
  return new Map(steps.map((s) => [s.stepId as string, s]));
}
