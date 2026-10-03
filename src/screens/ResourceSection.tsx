import { useState, useMemo, useEffect } from "react";
import clsx from "clsx";
import { Button } from "../components/ui";
import {
  RESOURCE_CATEGORIES,
  RESOURCE_CATALOG,
  searchResources,
  type ResourceCategory,
  type ResourceItem,
} from "../content/resources";
import {
  Bookmarks,
  AssetDownloader,
  type DownloadTask,
} from "../core/transfer";
import { VaultSync, type VaultSyncStatus, type VaultSyncResult } from "../core/vault";
import { ScaffoldModal } from "../components/ScaffoldModal";
import { TransferInboxDrawer } from "../components/TransferInboxDrawer";
import { DetailShell } from "../components/DetailShell";
import { SetupActionButton } from "../components/SetupActionButton";
import { resolveSetupAction } from "../core/setup";
import { useApp } from "../lib/store";

/**
 * Identity handed to the executor so TransferHistory records the *content* that
 * was acted on rather than the action id. Declared once because every surface
 * that renders a Setup Action — card, detail, future surfaces — must report the
 * same thing.
 */
function itemMeta(item: ResourceItem) {
  return { id: item.id, name: item.name, type: "resource" };
}

export function ResourceSection() {
  const [selectedCategory, setSelectedCategory] = useState<ResourceCategory | "all" | "bookmarks">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedResourceForDetail, setSelectedResourceForDetail] = useState<ResourceItem | null>(null);

  // Bookmarks reactive state
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>(() => Bookmarks.getAll());
  useEffect(() => {
    return Bookmarks.subscribe((b) => setBookmarkedIds(b));
  }, []);

  // Vault Sync reactive state
  const [syncStatus, setSyncStatus] = useState<VaultSyncStatus>(VaultSync.getStatus());
  const [syncResult, setSyncResult] = useState<VaultSyncResult | undefined>(VaultSync.getLastResult());
  useEffect(() => {
    return VaultSync.subscribe((status, result) => {
      setSyncStatus(status);
      if (result) setSyncResult(result);
    });
  }, []);

  // Active Downloads
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);
  useEffect(() => {
    return AssetDownloader.subscribe((tasks) => setDownloads(tasks));
  }, []);

  // Modals state
  const [scaffoldTemplate, setScaffoldTemplate] = useState<{
    id: string;
    name: string;
    description: string;
    command?: string;
    defaultDir?: string;
    postInstallNotice?: string;
  } | null>(null);

  const [showInbox, setShowInbox] = useState(false);

  /**
   * The scaffold action is a `scaffold` Setup Action, and executing one
   * dispatches `setup:open-scaffold` with the template id. This is the single
   * listener for that event, which is why the card no longer needs a
   * `category === "templates"` branch of its own.
   *
   * The command is derived from the repository rather than left to the modal's
   * fallback. The fallback is a Tauri-specific command, so before this the
   * "创建工程" button on *every* template in the catalogue offered to scaffold a
   * Tauri app, regardless of which template the user clicked.
   */
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ templateId?: string }>).detail;
      const item = RESOURCE_CATALOG.find((r) => r.id === detail?.templateId);
      if (!item) return;
      setScaffoldTemplate({
        id: item.id,
        name: item.name,
        description: item.description,
        command: item.repository ? `git clone ${item.repository} {{projectName}}` : undefined,
        defaultDir: item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        postInstallNotice: item.homepage ? `项目文档：${item.homepage}` : undefined,
      });
    };
    window.addEventListener("setup:open-scaffold", onOpen);
    return () => window.removeEventListener("setup:open-scaffold", onOpen);
  }, []);

  // Trigger manual sync
  const handleSyncVault = async () => {
    await VaultSync.sync({ force: true });
  };

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: RESOURCE_CATALOG.length,
      bookmarks: bookmarkedIds.length,
    };
    for (const item of RESOURCE_CATALOG) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, [bookmarkedIds]);

  // Filtered resources
  const filteredResources = useMemo(() => {
    let list: ResourceItem[] = [];
    if (selectedCategory === "bookmarks") {
      list = RESOURCE_CATALOG.filter((item) => bookmarkedIds.includes(item.id));
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        list = list.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.description.toLowerCase().includes(q) ||
            i.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }
    } else {
      list = searchResources(searchQuery, selectedCategory);
    }

    if (selectedTag) {
      list = list.filter((item) => item.tags.includes(selectedTag));
    }
    return list;
  }, [searchQuery, selectedCategory, selectedTag, bookmarkedIds]);

  // Featured list for showcase banner
  const featuredResources = useMemo(() => {
    return RESOURCE_CATALOG.filter((item) => item.featured).slice(0, 4);
  }, []);

  const getCategoryLabel = (catId: string) => {
    const cat = RESOURCE_CATEGORIES.find((c) => c.id === catId);
    return cat ? cat.name : catId;
  };

  const inventory = useApp((s) => s.inventory);

  const currentResourceIdx = useMemo(() => {
    if (!selectedResourceForDetail) return -1;
    return filteredResources.findIndex((r) => r.id === selectedResourceForDetail.id);
  }, [selectedResourceForDetail, filteredResources]);

  const hasPrev = currentResourceIdx > 0;
  const hasNext = currentResourceIdx >= 0 && currentResourceIdx < filteredResources.length - 1;
  const handlePrev = () => {
    if (hasPrev) setSelectedResourceForDetail(filteredResources[currentResourceIdx - 1]);
  };
  const handleNext = () => {
    if (hasNext) setSelectedResourceForDetail(filteredResources[currentResourceIdx + 1]);
  };

  const resolvedSetup = useMemo(() => {
    if (!selectedResourceForDetail) return null;
    return resolveSetupAction({ type: "resource", data: selectedResourceForDetail }, inventory);
  }, [selectedResourceForDetail, inventory]);

  /**
   * Resolved once per visible card and reused by the card's action bar, so the
   * card and the detail view are guaranteed to agree about what the primary
   * action for an item is — they call the same function with the same input.
   *
   * Keyed by id rather than by render because the resolver allocates new action
   * objects each call; without memoising, every keystroke in the search box
   * would rebuild an action for every card on screen.
   */
  const resolvedByCard = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveSetupAction>>();
    for (const item of filteredResources) {
      map.set(item.id, resolveSetupAction({ type: "resource", data: item }, inventory));
    }
    return map;
  }, [filteredResources, inventory]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header & Purpose Banner */}
      <header className="rise flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider bg-[color:var(--status-accent)] text-[color:var(--text-inverse)]">
            RESOURCE EXPLORER // 开发与设计资源索引
          </div>
          <h1 className="text-[color:var(--text-strong)] mt-2 text-[22px] font-bold tracking-[-0.02em]">
            开源项目、设计系统与工程基石
          </h1>
          <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed max-w-2xl">
            收录 <strong>{RESOURCE_CATALOG.length}</strong> 个开源项目、前沿设计系统、动效库、高效工具链与学习路线图。采用紧凑卡片网格浏览，点击任意卡片查看详细推荐原因与核心价值。
          </p>
        </div>

        {/* Vault Status & Actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)] px-3 py-1.5 text-[11.5px]">
            <span
              className={`h-2 w-2 rounded-full ${
                syncStatus === "syncing" || syncStatus === "checking"
                  ? "bg-amber-400 animate-pulse"
                  : syncStatus === "error"
                    ? "bg-rose-400"
                    : "bg-emerald-400"
              }`}
            />
            <span className="font-mono text-[color:var(--text-secondary)]">
              Vault: {syncResult?.contentVersion || "builtin"}
            </span>
            <button
              type="button"
              onClick={handleSyncVault}
              disabled={syncStatus === "syncing" || syncStatus === "checking"}
              className="text-[color:var(--status-accent)] font-semibold hover:underline ml-1"
            >
              {syncStatus === "syncing" ? "同步中..." : "同步 Vault"}
            </button>
          </div>

          <Button size="sm" variant="quiet" onClick={() => setShowInbox(true)}>
            外部收集箱 ↓
          </Button>
        </div>
      </header>

      {/* Featured Highlights */}
      {!searchQuery && !selectedTag && selectedCategory === "all" && (
        <section className="rise rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--status-accent)]">
              精选聚焦 / Featured Spotlights
            </span>
            <span className="text-[11.5px] text-[color:var(--text-quiet)]">
              最值得第一时间收藏与体验的开创性项目
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {featuredResources.map((feat) => {
              const isStarred = bookmarkedIds.includes(feat.id);
              return (
                <div
                  key={feat.id}
                  onClick={() => setSelectedResourceForDetail(feat)}
                  className="group relative flex flex-col justify-between rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3 cursor-pointer hover:border-[color:var(--status-accent)] hover:bg-[color:var(--surface-inset)] transition-all duration-150"
                >
                  <div>
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="font-bold text-[13.5px] text-[color:var(--text-strong)] group-hover:text-[color:var(--status-accent)] transition-colors leading-tight">
                        {feat.name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            Bookmarks.toggle(feat.id, feat.name);
                          }}
                          className={`text-[12px] p-0.5 hover:scale-125 transition-transform ${
                            isStarred ? "text-amber-400" : "text-[color:var(--text-quiet)] opacity-50"
                          }`}
                          title={isStarred ? "取消收藏" : "收藏"}
                        >
                          {isStarred ? "★" : "☆"}
                        </button>
                        {feat.stars && (
                          <span className="text-[10.5px] font-mono font-semibold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            ★ {feat.stars}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-[color:var(--text-tertiary)] line-clamp-2 leading-relaxed">
                      {feat.description}
                    </p>
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-[color:var(--line-subtle)] flex items-center justify-between text-[11px] text-[color:var(--text-quiet)]">
                    <span>{feat.author}</span>
                    <span className="text-[color:var(--status-accent)] font-semibold group-hover:translate-x-0.5 transition-transform">
                      详情 ↗
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Category Navigation Pills */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <button
          type="button"
          onClick={() => {
            setSelectedCategory("all");
            setSelectedTag(null);
          }}
          className={clsx(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 border",
            selectedCategory === "all"
              ? "bg-[color:var(--status-accent)] text-black border-transparent shadow-sm"
              : "border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/70 text-[color:var(--text-secondary)] hover:border-[color:var(--line-default)] hover:text-[color:var(--text-strong)]",
          )}
        >
          <span>全部资源</span>
          <span className="rounded-full bg-black/10 px-1.5 py-0.2 text-[10.5px] font-mono">
            {categoryCounts.all}
          </span>
        </button>

        {/* Bookmarks Tab */}
        <button
          type="button"
          onClick={() => {
            setSelectedCategory("bookmarks");
            setSelectedTag(null);
          }}
          className={clsx(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 border",
            selectedCategory === "bookmarks"
              ? "bg-amber-400 text-black border-transparent shadow-sm font-bold"
              : "border-amber-500/30 bg-amber-500/5 text-amber-300 hover:border-amber-400 hover:bg-amber-500/10",
          )}
        >
          <span>★ 我的收藏</span>
          <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10.5px] font-mono">
            {categoryCounts.bookmarks}
          </span>
        </button>

        {RESOURCE_CATEGORIES.map((cat) => {
          const isSelected = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                setSelectedCategory(cat.id);
                setSelectedTag(null);
              }}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all duration-150 border",
                isSelected
                  ? "bg-[color:var(--status-accent)] text-black border-transparent font-bold shadow-sm"
                  : "border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/70 text-[color:var(--text-secondary)] hover:border-[color:var(--line-default)] hover:text-[color:var(--text-strong)]",
              )}
            >
              <span className="text-[12px] font-mono">{cat.icon}</span>
              <span>{cat.name}</span>
              <span className="rounded-full bg-black/10 px-1.5 py-0.2 text-[10.5px] font-mono">
                {categoryCounts[cat.id] || 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search Bar & Counter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索开源库、技术栈、作者、用途或标签…"
            className="w-full rounded-lg border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] px-3 py-2 text-[12.5px] text-[color:var(--text-primary)] placeholder-[color:var(--text-quiet)] focus:border-[color:var(--status-accent)] focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[color:var(--text-quiet)] hover:text-[color:var(--text-primary)]"
            >
              ✕
            </button>
          )}
        </div>

        {/* Counter and Tag Clear */}
        <div className="flex items-center gap-2 text-[12px] text-[color:var(--text-tertiary)]">
          {selectedTag && (
            <div className="flex items-center gap-1.5 rounded bg-[color:var(--surface-active)] px-2 py-0.5 text-[11.5px] text-[color:var(--text-strong)] border border-[color:var(--line-default)]">
              <span>标签: {selectedTag}</span>
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className="hover:text-[color:var(--status-bad)] ml-1 font-bold"
              >
                ✕
              </button>
            </div>
          )}
          <span>
            共检索到 <strong className="text-[color:var(--text-strong)]">{filteredResources.length}</strong> 个资源
          </span>
        </div>
      </div>

      {/* Resource Cards Grid (Clean, Scannable Cards) */}
      {filteredResources.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/30 p-12 text-center">
          <div className="text-2xl font-mono text-[color:var(--text-quiet)] mb-2">∅</div>
          <div className="text-[14px] font-semibold text-[color:var(--text-secondary)]">没有找到匹配的资源</div>
          <p className="text-[12px] text-[color:var(--text-quiet)] mt-1">
            {selectedCategory === "bookmarks"
              ? "你还没有收藏任何资源。在资源卡片右上角点击 ★ 即可收藏！"
              : "尝试更换关键词，或切换到全部分类"}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-4"
            onClick={() => {
              setSearchQuery("");
              setSelectedCategory("all");
              setSelectedTag(null);
            }}
          >
            重置所有筛选
          </Button>
        </div>
      ) : (
        <div
          data-composition-grid
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5"
        >
          {filteredResources.map((item) => {
            const isStarred = bookmarkedIds.includes(item.id);
            const downloadTask = downloads.find((d) => d.url === item.downloadUrl);
            const resolved = resolvedByCard.get(item.id);
            if (!resolved) return null;

            return (
              <div
                key={item.id}
                data-resource-card={item.id}
                onClick={() => setSelectedResourceForDetail(item)}
                className="group relative flex flex-col justify-between rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/80 p-4 transition-all duration-200 cursor-pointer select-none hover:border-[color:var(--line-strong)] hover:bg-[color:var(--surface-raised)] hover:shadow-md"
              >
                <div>
                  {/* Top Bar: Title & Stars */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="text-[15px] font-bold text-[color:var(--text-strong)] group-hover:text-[color:var(--status-accent)] transition-colors leading-tight"
                          title={item.name}
                        >
                          {item.name}
                        </span>
                        {item.featured && (
                          <span className="rounded bg-[color:var(--status-accent)] px-1.5 py-0.2 text-[10px] font-black text-black shrink-0">
                            精选
                          </span>
                        )}
                        {item.license && (
                          <span className="rounded bg-[color:var(--surface-hover)] px-1.5 py-0.2 text-[10px] font-mono text-[color:var(--text-quiet)] border border-[color:var(--line-subtle)] shrink-0">
                            {item.license}
                          </span>
                        )}
                      </div>
                      <div className="text-[color:var(--text-quiet)] text-[11px] mt-1 truncate">
                        {item.author} · {getCategoryLabel(item.category)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          Bookmarks.toggle(item.id, item.name);
                        }}
                        className={`text-[13px] p-0.5 hover:scale-125 transition-transform ${
                          isStarred ? "text-amber-400 font-bold" : "text-[color:var(--text-quiet)] opacity-50 hover:opacity-100"
                        }`}
                        title={isStarred ? "已收藏" : "点击收藏"}
                      >
                        {isStarred ? "★" : "☆"}
                      </button>
                      {item.stars && (
                        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.2 text-[10.5px] font-mono font-semibold text-amber-400 border border-amber-500/20">
                          ★ {item.stars}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Concise 2-line Description */}
                  <p className="mt-2 text-[12px] text-[color:var(--text-secondary)] leading-relaxed line-clamp-2">
                    {item.description}
                  </p>

                  {/* Tags */}
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {item.tags.slice(0, 3).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTag(tag);
                        }}
                        className={clsx(
                          "rounded px-1.5 py-0.2 text-[10.5px] transition-colors border",
                          selectedTag === tag
                            ? "bg-[color:var(--status-accent)] text-black border-transparent font-bold"
                            : "bg-[color:var(--surface-hover)] text-[color:var(--text-quiet)] border-[color:var(--line-subtle)] hover:text-[color:var(--text-secondary)]",
                        )}
                      >
                        #{tag}
                      </button>
                    ))}
                    {item.tags.length > 3 && (
                      <span className="text-[10px] text-[color:var(--text-quiet)] font-mono self-center">
                        +{item.tags.length - 3}
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom Actions.

                    One control, one resolver. The card previously hand-wrote
                    four branches here — repository → GitHub, homepage → 官网,
                    category === "templates" → 创建工程, actionType === "download"
                    → 下载 — which is a second, private action system that the
                    Universal Setup Action contract knew nothing about, and which
                    drifted from the detail view's actions for the same item.

                    Now the card asks the same resolver the detail view asks, and
                    renders whatever it returns. A card cannot offer an action the
                    contract does not define, and adding an action type to
                    `resolveSetupAction` reaches every card at once. */}
                <div
                  className="mt-3.5 pt-2.5 border-t border-[color:var(--line-subtle)] flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <SetupActionButton
                    action={resolved.primaryAction}
                    itemMeta={itemMeta(item)}
                    secondaryActions={resolved.secondaryActions}
                    availablePackageManagers={resolved.availablePackageManagers}
                    prerequisites={resolved.prerequisites}
                    size="sm"
                    showPmSelector={false}
                    className="min-w-0 flex-1"
                  />
                  {downloadTask?.status === "downloading" && (
                    <span className="tnum shrink-0 text-[10.5px] font-mono text-[color:var(--text-quiet)]">
                      {downloadTask.progress}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Resource Detail Modal (DetailShell) */}
      {selectedResourceForDetail && (
        <DetailShell
          isOpen={true}
          onClose={() => setSelectedResourceForDetail(null)}
          onPrev={handlePrev}
          onNext={handleNext}
          hasPrev={hasPrev}
          hasNext={hasNext}
          title={selectedResourceForDetail.name}
          subtitle={`作者 / 组织：${selectedResourceForDetail.author} · 分类：${getCategoryLabel(
            selectedResourceForDetail.category,
          )}`}
          tags={selectedResourceForDetail.tags}
          badge={
            <div className="flex items-center gap-1.5 flex-wrap">
              {selectedResourceForDetail.featured && (
                <span className="rounded bg-[color:var(--status-accent)] px-2 py-0.5 text-[11px] font-black text-black">
                  官方精选
                </span>
              )}
              {selectedResourceForDetail.license && (
                <span className="rounded bg-[color:var(--surface-hover)] px-2 py-0.5 text-[11px] font-mono text-[color:var(--text-quiet)] border border-[color:var(--line-subtle)]">
                  {selectedResourceForDetail.license}
                </span>
              )}
              {selectedResourceForDetail.stars && (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-mono font-bold text-amber-400 border border-amber-500/30">
                  ★ {selectedResourceForDetail.stars}
                </span>
              )}
            </div>
          }
          actions={
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    Bookmarks.toggle(selectedResourceForDetail.id, selectedResourceForDetail.name);
                  }}
                  className="rounded-lg border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--text-secondary)] hover:text-[color:var(--text-strong)] transition-colors"
                >
                  {bookmarkedIds.includes(selectedResourceForDetail.id)
                    ? "★ 已收藏"
                    : "☆ 加入收藏"}
                </button>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                {resolvedSetup && (
                  <SetupActionButton
                    action={resolvedSetup.primaryAction}
                    secondaryActions={resolvedSetup.secondaryActions}
                    availablePackageManagers={resolvedSetup.availablePackageManagers}
                    prerequisites={resolvedSetup.prerequisites}
                    itemMeta={{
                      id: selectedResourceForDetail.id,
                      name: selectedResourceForDetail.name,
                      type: "resource",
                    }}
                  />
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedResourceForDetail(null)}
                >
                  关闭
                </Button>
              </div>
            </>
          }
        >
          {/* Detailed Description */}
          <div>
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--text-secondary)] mb-1.5">
              项目描述
            </h3>
            <p className="text-[13px] text-[color:var(--text-secondary)] leading-relaxed">
              {selectedResourceForDetail.description}
            </p>
          </div>

          {/* Core Recommendation Reason */}
          <div className="rounded-xl border border-[color:var(--status-accent)]/40 bg-[color:var(--surface-sunken)] p-4">
            <div className="text-[11.5px] font-bold text-[color:var(--status-accent)] uppercase tracking-wider flex items-center gap-1.5">
              <span>◈ 推荐理由与核心价值</span>
            </div>
            <p className="text-[12.5px] text-[color:var(--text-primary)] mt-1.5 leading-relaxed">
              {selectedResourceForDetail.recommendedReason}
            </p>
          </div>

          {/* Technical Metadata Table */}
          <div>
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--text-secondary)] mb-2">
              元数据与流转规格
            </h3>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] px-3 py-2">
                <span className="text-[color:var(--text-quiet)]">资源标识符：</span>
                <span className="font-mono text-[color:var(--text-secondary)] ml-1">
                  {selectedResourceForDetail.id}
                </span>
              </div>
              <div className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] px-3 py-2">
                <span className="text-[color:var(--text-quiet)]">开源协议：</span>
                <span className="font-mono text-[color:var(--text-secondary)] ml-1">
                  {selectedResourceForDetail.license || "未注明"}
                </span>
              </div>
              <div className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] px-3 py-2">
                <span className="text-[color:var(--text-quiet)]">分类领域：</span>
                <span className="text-[color:var(--text-secondary)] ml-1">
                  {getCategoryLabel(selectedResourceForDetail.category)}
                </span>
              </div>
              <div className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] px-3 py-2">
                <span className="text-[color:var(--text-quiet)]">流转动作：</span>
                <span className="font-mono text-[color:var(--text-secondary)] ml-1">
                  {selectedResourceForDetail.actionType}
                </span>
              </div>
            </div>
          </div>

          {/* Transfer Ecosystem Insight */}
          <div className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/60 p-3.5 text-[12px] text-[color:var(--text-tertiary)]">
            <div className="font-semibold text-[color:var(--text-secondary)] mb-1">
              Setup Center · Transfer 生态集成
            </div>
            该资产由 Setup Center 精选收录并标准化归档，支持离线快照检索、个人星标收藏与本地工程无缝初始化，降低项目构建与设计实践的冷启动成本。
          </div>
        </DetailShell>
      )}

      {/* Template Scaffold Modal */}
      {scaffoldTemplate && (
        <ScaffoldModal
          template={scaffoldTemplate}
          onClose={() => setScaffoldTemplate(null)}
        />
      )}

      {/* Transfer Inbox Drawer */}
      {showInbox && <TransferInboxDrawer onClose={() => setShowInbox(false)} />}
    </div>
  );
}
