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

function openUrl(url?: string) {
  if (!url) return;
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    // fallback
  }
}

export function ResourceSection() {
  const [selectedCategory, setSelectedCategory] = useState<ResourceCategory | "all" | "bookmarks">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-6">
      {/* Header & Purpose Banner */}
      <header className="rise flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider bg-[color:var(--status-accent)] text-[color:var(--text-inverse)]">
            CREATIVE & DEV BOOTSTRAP HUB // 开发与创作资源中心
          </div>
          <h1 className="text-[color:var(--text-strong)] mt-2 text-[22px] font-bold tracking-[-0.02em]">
            开源项目、设计系统与工程基石
          </h1>
          <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed max-w-2xl">
            Setup Center 不再只是软件安装器，更是面向构建者的启动枢纽。精选收录 <strong>{RESOURCE_CATALOG.length}</strong> 个开源项目、前沿设计系统、动效库、高效工具链与学习路线图。
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
            📥 外部收集箱
          </Button>
        </div>
      </header>

      {/* Featured Highlights (Shown when browsing all or no search active) */}
      {!searchQuery && !selectedTag && selectedCategory === "all" && (
        <section className="rise rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--status-accent)]">
              ★ 站长精选高星推荐 / Featured Spotlights
            </span>
            <span className="text-[11.5px] text-[color:var(--text-quiet)]">
              最值得第一时间收藏与体验的开创性项目
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {featuredResources.map((feat) => {
              const isStarred = bookmarkedIds.includes(feat.id);
              return (
                <div
                  key={feat.id}
                  onClick={() => openUrl(feat.repository || feat.homepage)}
                  className="group relative flex flex-col justify-between rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3 cursor-pointer hover:border-[color:var(--status-accent)] hover:bg-[color:var(--surface-inset)] transition-all duration-150"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-[13.5px] text-[color:var(--text-strong)] group-hover:text-[color:var(--status-accent)] transition-colors truncate">
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
                      浏览 ↗
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
              <span className="text-[12px]">{cat.icon}</span>
              <span>{cat.name}</span>
              <span className="rounded-full bg-black/10 px-1.5 py-0.2 text-[10.5px] font-mono">
                {categoryCounts[cat.id] || 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search Bar & Active Filters Bar */}
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
            共找到 <strong className="text-[color:var(--text-strong)]">{filteredResources.length}</strong> 个资源
          </span>
        </div>
      </div>

      {/* Resource Cards Grid */}
      {filteredResources.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/30 p-12 text-center">
          <div className="text-3xl mb-2">🔍</div>
          <div className="text-[14px] font-semibold text-[color:var(--text-secondary)]">没有找到匹配的资源</div>
          <p className="text-[12px] text-[color:var(--text-quiet)] mt-1">
            {selectedCategory === "bookmarks"
              ? "你还没有收藏任何资源。点击资源卡片右上角的 ★ 即可收藏！"
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredResources.map((item) => {
            const isStarred = bookmarkedIds.includes(item.id);
            const downloadTask = downloads.find((d) => d.url === item.downloadUrl);

            return (
              <div
                key={item.id}
                data-resource-card={item.id}
                className="group relative flex flex-col justify-between rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/80 p-4 transition-all duration-200 select-none hover:border-[color:var(--line-strong)] hover:bg-[color:var(--surface-raised)]"
              >
                <div>
                  {/* Top Bar: Name, Badges & Stars */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[15px] font-bold text-[color:var(--text-strong)] truncate">
                          {item.name}
                        </span>
                        {item.featured && (
                          <span className="rounded bg-[color:var(--status-accent)] px-1.5 py-0.2 text-[10px] font-black text-black">
                            精选
                          </span>
                        )}
                        {item.license && (
                          <span className="rounded bg-[color:var(--surface-hover)] px-1.5 py-0.2 text-[10px] font-mono text-[color:var(--text-quiet)] border border-[color:var(--line-subtle)]">
                            {item.license}
                          </span>
                        )}
                      </div>
                      <div className="text-[color:var(--text-quiet)] text-[11px] mt-0.5">
                        作者 / 组织：{item.author}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => Bookmarks.toggle(item.id, item.name)}
                        className={`text-[14px] p-0.5 hover:scale-125 transition-transform ${
                          isStarred ? "text-amber-400 font-bold" : "text-[color:var(--text-quiet)] hover:text-amber-300"
                        }`}
                        title={isStarred ? "已收藏 (点击取消)" : "点击收藏"}
                      >
                        {isStarred ? "★" : "☆"}
                      </button>
                      {item.stars && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-mono font-bold text-amber-400 border border-amber-500/20">
                          ★ {item.stars}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <p className="mt-2 text-[12px] text-[color:var(--text-secondary)] leading-relaxed line-clamp-3">
                    {item.description}
                  </p>

                  {/* Recommendation Rationale Box */}
                  <div className="mt-2.5 rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-2.5 text-[11.5px]">
                    <div className="font-semibold text-[color:var(--status-accent)] flex items-center gap-1">
                      <span>💡 推荐价值：</span>
                    </div>
                    <div className="text-[color:var(--text-tertiary)] mt-0.5 leading-snug">
                      {item.recommendedReason}
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTag(tag);
                        }}
                        className={clsx(
                          "rounded px-1.5 py-0.5 text-[10.5px] transition-colors border",
                          selectedTag === tag
                            ? "bg-[color:var(--status-accent)] text-black border-transparent font-bold"
                            : "bg-[color:var(--surface-hover)] text-[color:var(--text-quiet)] border-[color:var(--line-subtle)] hover:text-[color:var(--text-secondary)] hover:border-[color:var(--line-default)]",
                        )}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="mt-4 pt-3 border-t border-[color:var(--line-subtle)] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {item.repository && (
                      <button
                        type="button"
                        onClick={() => openUrl(item.repository)}
                        className="inline-flex items-center gap-1 rounded bg-[color:var(--surface-active)] px-2.5 py-1 text-[11.5px] font-bold text-[color:var(--text-primary)] hover:bg-[color:var(--status-accent)] hover:text-black transition-colors border border-[color:var(--line-default)]"
                      >
                        <span>GitHub</span>
                        <span className="text-[10px]">↗</span>
                      </button>
                    )}
                    {item.homepage && (
                      <button
                        type="button"
                        onClick={() => openUrl(item.homepage)}
                        className="inline-flex items-center gap-1 rounded bg-[color:var(--surface-inset)] px-2.5 py-1 text-[11.5px] font-medium text-[color:var(--text-secondary)] hover:text-[color:var(--text-strong)] hover:border-[color:var(--line-strong)] transition-colors border border-[color:var(--line-subtle)]"
                      >
                        <span>官网</span>
                        <span className="text-[10px]">↗</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Template Scaffold Trigger */}
                    {item.category === "templates" && (
                      <button
                        type="button"
                        onClick={() =>
                          setScaffoldTemplate({
                            id: item.id,
                            name: item.name,
                            description: item.description,
                            defaultDir: item.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
                          })
                        }
                        className="rounded-lg px-2.5 py-1 text-[11px] font-bold bg-[color:var(--status-accent)] text-black hover:opacity-90 transition-opacity"
                      >
                        创建工程 ◩
                      </button>
                    )}

                    {/* Direct Downloader Trigger */}
                    {item.actionType === "download" && item.downloadUrl && (
                      <button
                        type="button"
                        disabled={downloadTask?.status === "downloading"}
                        onClick={() =>
                          AssetDownloader.startDownload(
                            item.downloadUrl!,
                            `${item.name.toLowerCase().replace(/\s+/g, "_")}.zip`,
                            item.name,
                          )
                        }
                        className="rounded-lg px-2.5 py-1 text-[11px] font-bold bg-emerald-400 text-black hover:bg-emerald-300 transition-colors"
                      >
                        {downloadTask?.status === "downloading"
                          ? `下载中 ${downloadTask.progress}%`
                          : "下载资产 ⤓"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
