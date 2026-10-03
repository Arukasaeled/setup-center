/**
 * Setup Center — GitHub Repository Finder Screen
 *
 * Instant local curated repo lookup + GitHub public API online search with
 * one-click Clone, Transfer to Library, and side-by-side comparison.
 */

import { useState, useEffect, useTransition } from "react";
import clsx from "clsx";
import { searchGitHubRepos } from "../core/discovery/github";
import { LocalSearchIndex } from "../core/discovery/searchIndex";
import type { DiscoveryItem } from "../core/discovery/types";
import { Bookmarks } from "../core/transfer/bookmarks";
import { RecentTracker } from "../core/transfer/recent";
import { RepoDetailModal } from "../components/RepoDetailModal";
import { CloneRepoModal } from "../components/CloneRepoModal";
import { RepoCompareModal } from "../components/RepoCompareModal";

export function RepoFinderScreen() {
  const [query, setQuery] = useState("");
  const [searchOnline, setSearchOnline] = useState(true);
  const [selectedTopic, setSelectedTopic] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"default" | "stars" | "updated">("default");

  const [localResults, setLocalResults] = useState<DiscoveryItem[]>([]);
  const [onlineResults, setOnlineResults] = useState<DiscoveryItem[]>([]);
  const [isLoadingOnline, setIsLoadingOnline] = useState(false);
  const [rateLimitNotice, setRateLimitNotice] = useState<string | null>(null);

  const [activeDetailItem, setActiveDetailItem] = useState<DiscoveryItem | null>(null);
  const [activeCloneItem, setActiveCloneItem] = useState<DiscoveryItem | null>(null);
  const [compareItems, setCompareItems] = useState<DiscoveryItem[]>([]);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [, startTransition] = useTransition();

  // Local search reacts immediately
  useEffect(() => {
    startTransition(() => {
      const items = LocalSearchIndex.search(query, {
        category: selectedTopic === "all" ? undefined : selectedTopic,
      });
      // Filter items that have a repository URL
      const repoItems = items.filter((it) => it.origin?.repository || it.type === "repo");
      setLocalResults(repoItems);
    });
  }, [query, selectedTopic]);

  // Online GitHub search with debouncing
  useEffect(() => {
    if (!searchOnline || !query.trim() || query.trim().length < 2) {
      setOnlineResults([]);
      setIsLoadingOnline(false);
      return;
    }

    setIsLoadingOnline(true);
    setRateLimitNotice(null);

    const timer = setTimeout(() => {
      searchGitHubRepos(query, { perPage: 16, sort: sortBy })
        .then((res) => {
          setOnlineResults(res.items);
          if (res.rateLimited && res.rateLimitMessage) {
            setRateLimitNotice(res.rateLimitMessage);
          }
        })
        .finally(() => {
          setIsLoadingOnline(false);
        });
    }, 400);

    return () => clearTimeout(timer);
  }, [query, searchOnline, sortBy]);

  const handleOpenDetail = (item: DiscoveryItem) => {
    RecentTracker.record({
      id: item.id,
      title: item.title,
      type: "repo",
      category: item.category,
      subtitle: item.subtitle,
    });
    setActiveDetailItem(item);
  };

  const handleToggleBookmark = (item: DiscoveryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = Bookmarks.toggle(item.id, item.title);
    setNotice(next ? `已收藏「${item.title}」` : `已取消收藏「${item.title}」`);
    setTimeout(() => setNotice(null), 2000);
  };

  const handleAddToCompare = (item: DiscoveryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (compareItems.some((i) => i.id === item.id)) {
      setNotice("该项目已在对比清单中");
    } else if (compareItems.length >= 4) {
      setNotice("最多支持同时对比 4 个项目");
    } else {
      setCompareItems((prev) => [...prev, item]);
      setNotice(`已将「${item.title}」加入横向对比`);
    }
    setTimeout(() => setNotice(null), 2000);
  };

  // Combine results without duplicates
  const seenIds = new Set<string>();
  const combined: DiscoveryItem[] = [];

  for (const it of localResults) {
    seenIds.add(it.id);
    combined.push(it);
  }
  for (const it of onlineResults) {
    if (!seenIds.has(it.id)) {
      seenIds.add(it.id);
      combined.push(it);
    }
  }

  const topics = [
    { id: "all", label: "全部领域" },
    { id: "ai", label: "AI & 大模型" },
    { id: "frontend", label: "前端架构" },
    { id: "components", label: "UI 组件库" },
    { id: "tools", label: "开发效率" },
    { id: "templates", label: "项目模板" },
  ];

  return (
    <div className="space-y-6">
      {/* Notice Banner */}
      {notice && (
        <div className="rounded-lg border border-blue-500/40 bg-blue-900/30 px-4 py-2.5 text-[12.5px] font-medium text-blue-200 animate-fade-in flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-zinc-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Header & Search */}
      <div className="rounded-2xl border border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/90 p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-[20px] font-bold text-[color:var(--text-strong)]">
            GitHub 项目探索 (Repo Finder)
          </h2>
          <p className="text-[12.5px] text-[color:var(--text-tertiary)] mt-1">
            聚合 Setup Center 精选项目与 GitHub 全网开源资源 · 免配置直接检索、收藏与克隆。
          </p>
        </div>

        {/* Search Input Bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索开源项目、框架名、作者或关键词 (如: rust terminal, tauri, react ui, local ai)..."
              className="w-full rounded-xl border border-[color:var(--line-strong)] bg-[color:var(--surface-inset)] px-4 py-2.5 text-[13.5px] text-[color:var(--text-strong)] placeholder-[color:var(--text-tertiary)] focus:border-[color:var(--status-accent)] focus:outline-hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-2.5 text-zinc-400 hover:text-white text-[12px]"
              >
                清除
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setSearchOnline(!searchOnline)}
              className={clsx(
                "rounded-xl border px-3.5 py-2 text-[12px] font-medium transition-all cursor-pointer",
                searchOnline
                  ? "border-[color:var(--status-accent)] bg-[color:var(--status-accent)]/15 text-[color:var(--status-accent)]"
                  : "border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] text-[color:var(--text-quiet)]",
              )}
            >
              {searchOnline ? "✓ 已开启 GitHub 全网检索" : "仅搜本地收录"}
            </button>

            {compareItems.length > 0 && (
              <button
                type="button"
                onClick={() => setIsCompareOpen(true)}
                className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-[12px] font-bold text-amber-300 hover:bg-amber-500/25 transition-colors cursor-pointer"
              >
                横向对比 ({compareItems.length}) ↗
              </button>
            )}
          </div>
        </div>

        {/* Filter Chips & Sort */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[color:var(--line-subtle)]">
          <div className="flex flex-wrap gap-1.5">
            {topics.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTopic(t.id)}
                className={clsx(
                  "rounded-lg px-3 py-1 text-[11.5px] font-medium transition-colors cursor-pointer",
                  selectedTopic === t.id
                    ? "bg-[color:var(--status-accent)] text-[color:var(--accent-on)] font-bold"
                    : "bg-[color:var(--surface-sunken)] text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)]",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-[12px] text-[color:var(--text-quiet)] font-mono">
            <span>排序:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] px-2 py-0.5 text-[11.5px] text-[color:var(--text-secondary)] focus:outline-hidden"
            >
              <option value="default">综合相关度</option>
              <option value="stars">最多 Stars</option>
              <option value="updated">最新活跃</option>
            </select>
          </div>
        </div>
      </div>

      {/* Rate Limit Message */}
      {rateLimitNotice && (
        <div className="rounded-lg border border-amber-600/40 bg-amber-950/30 p-3 text-[12px] text-amber-300 flex items-center justify-between">
          <span>ⓘ {rateLimitNotice}</span>
          <button onClick={() => setRateLimitNotice(null)} className="text-zinc-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Results Header */}
      <div className="flex items-center justify-between text-[12px] text-[color:var(--text-quiet)] px-1">
        <span>共发现 {combined.length} 个匹配开源项目</span>
        {isLoadingOnline && <span className="text-[color:var(--status-accent)] animate-pulse">正在查询 GitHub 实时数据…</span>}
      </div>

      {/* Results Grid */}
      {combined.length === 0 ? (
        <div className="py-20 text-center rounded-2xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/40 p-8 space-y-3">
          <div className="text-[15px] font-bold text-[color:var(--text-strong)]">
            未发现匹配的项目
          </div>
          <p className="text-[12.5px] text-[color:var(--text-tertiary)] max-w-md mx-auto">
            尝试输入英文缩写或更通用的技术词（例如: "react ui", "cli", "python api", "tauri", "agent"）。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {combined.map((item) => {
            const isStarred = Bookmarks.isBookmarked(item.id);
            const isInCompare = compareItems.some((i) => i.id === item.id);

            return (
              <div
                key={item.id}
                onClick={() => handleOpenDetail(item)}
                className="group relative flex flex-col justify-between rounded-[var(--radius-panel)] border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] p-4 hover:border-[color:var(--line-strong)] hover:shadow-md transition-all cursor-pointer"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[14.5px] text-[color:var(--text-strong)] group-hover:text-[color:var(--status-accent)] transition-colors truncate">
                          {item.title}
                        </span>
                        {item.origin?.stars && (
                          <span className="rounded bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.2 text-[10.5px] font-mono font-bold text-amber-400">
                            ★ {item.origin.stars}
                          </span>
                        )}
                        {item.isCurated && (
                          <span className="rounded bg-blue-500/15 border border-blue-500/30 px-1.5 py-0.2 text-[10px] font-mono text-blue-300">
                            精选
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-[color:var(--text-quiet)] mt-0.5 truncate">
                        {item.origin?.author || item.category} · {item.origin?.language || "通用"}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => handleToggleBookmark(item, e)}
                      className={`text-[13px] p-0.5 hover:scale-125 transition-transform ${
                        isStarred ? "text-amber-400 font-bold" : "text-zinc-500 hover:text-zinc-300"
                      }`}
                      title={isStarred ? "取消收藏" : "加入收藏"}
                    >
                      {isStarred ? "★" : "☆"}
                    </button>
                  </div>

                  <p className="mt-2 text-[12px] text-[color:var(--text-secondary)] line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="mt-3 pt-2.5 border-t border-[color:var(--line-subtle)] flex items-center justify-between gap-2">
                  <div className="text-[10.5px] font-mono text-[color:var(--text-quiet)]">
                    {item.origin?.lastUpdated || item.origin?.license || "MIT"}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => handleAddToCompare(item, e)}
                      className={clsx(
                        "rounded px-2 py-0.5 text-[11px] font-mono transition-colors",
                        isInCompare
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800",
                      )}
                    >
                      {isInCompare ? "已在对比" : "对比"}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveCloneItem(item);
                      }}
                      className="rounded bg-[color:var(--surface-sunken)] border border-[color:var(--line-subtle)] px-2.5 py-1 text-[11.5px] font-bold text-[color:var(--text-primary)] hover:border-[color:var(--status-accent)] hover:text-[color:var(--status-accent)] transition-colors"
                    >
                      克隆 (Clone)
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {activeDetailItem && (
        <RepoDetailModal
          isOpen={true}
          onClose={() => setActiveDetailItem(null)}
          item={activeDetailItem}
          onStartCompare={(it) => {
            if (!compareItems.some((i) => i.id === it.id)) {
              setCompareItems((prev) => [...prev, it]);
            }
            setIsCompareOpen(true);
          }}
          onNotice={(msg) => {
            setNotice(msg);
            setTimeout(() => setNotice(null), 2500);
          }}
        />
      )}

      {activeCloneItem && (
        <CloneRepoModal
          isOpen={true}
          onClose={() => setActiveCloneItem(null)}
          repoUrl={activeCloneItem.origin?.repository || activeCloneItem.origin?.url || ""}
          repoName={activeCloneItem.title}
        />
      )}

      {isCompareOpen && (
        <RepoCompareModal
          isOpen={true}
          onClose={() => setIsCompareOpen(false)}
          items={compareItems}
          onRemoveItem={(id) => setCompareItems((prev) => prev.filter((i) => i.id !== id))}
          onCloneItem={(it) => {
            setIsCompareOpen(false);
            setActiveCloneItem(it);
          }}
        />
      )}
    </div>
  );
}
