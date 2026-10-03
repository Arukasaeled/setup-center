/**
 * Setup Center — My Library Screen
 *
 * Consolidated personal development library combining:
 * - Bookmarks (收藏清单)
 * - Recently Viewed (最近使用历史)
 * - Custom Starter Packs (个性化开发套件 + 导出给 AI)
 * - Transfer Inbox (稍后整理收集箱)
 */

import { useState, useEffect } from "react";
import clsx from "clsx";
import { Bookmarks } from "../core/transfer/bookmarks";
import { RecentTracker, type RecentItem } from "../core/transfer/recent";
import { PersonalNotes } from "../core/transfer/notes";
import { CustomPacks, type CustomPack } from "../core/transfer/packs";
import { TransferInbox } from "../core/transfer/inbox";
import { PersonalCatalog } from "../core/transfer/catalog";
import { LocalSearchIndex } from "../core/discovery/searchIndex";
import type { DiscoveryItem } from "../core/discovery/types";
import type { TransferInboxItem } from "../core/transfer/types";
import { RepoDetailModal } from "../components/RepoDetailModal";
import { CloneRepoModal } from "../components/CloneRepoModal";

type LibraryTab = "bookmarks" | "recent" | "packs" | "inbox";

export function LibraryScreen() {
  const [tab, setTab] = useState<LibraryTab>("bookmarks");
  const [bookmarkIds, setBookmarkIds] = useState<string[]>(Bookmarks.getAll());
  const [recentItems, setRecentItems] = useState<RecentItem[]>(RecentTracker.getAll());
  const [packs, setPacks] = useState<CustomPack[]>(CustomPacks.getAll());
  const [inboxItems, setInboxItems] = useState<TransferInboxItem[]>(TransferInbox.getAll());
  const [notes, setNotes] = useState<Record<string, string>>(PersonalNotes.getAll());

  const [searchFilter, setSearchFilter] = useState("");
  const [activeDetailItem, setActiveDetailItem] = useState<DiscoveryItem | null>(null);
  const [activeCloneItem, setActiveCloneItem] = useState<DiscoveryItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // New Pack Modal state
  const [isCreatingPack, setIsCreatingPack] = useState(false);
  const [newPackTitle, setNewPackTitle] = useState("");
  const [newPackDesc, setNewPackDesc] = useState("");

  const [, setCatalogTick] = useState(0);

  // Subscriptions
  useEffect(() => {
    const unsubBookmarks = Bookmarks.subscribe((b) => setBookmarkIds(b));
    const unsubRecent = RecentTracker.subscribe((r) => setRecentItems(r));
    const unsubPacks = CustomPacks.subscribe((p) => setPacks(p));
    const unsubInbox = TransferInbox.subscribe((i) => setInboxItems(i));
    const unsubNotes = PersonalNotes.subscribe((n) => setNotes(n));
    const unsubCatalog = PersonalCatalog.subscribe(() => setCatalogTick((t) => t + 1));

    return () => {
      unsubBookmarks();
      unsubRecent();
      unsubPacks();
      unsubInbox();
      unsubNotes();
      unsubCatalog();
    };
  }, []);

  const resolveItem = (id: string): DiscoveryItem | undefined => {
    return PersonalCatalog.getItem(id) || LocalSearchIndex.get(id);
  };

  const bookmarkedItems = bookmarkIds
    .map((id) => resolveItem(id))
    .filter((i): i is DiscoveryItem => Boolean(i));

  const filteredBookmarks = bookmarkedItems.filter((i) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q);
  });

  const handleCopyAgentPrompt = (pack: CustomPack) => {
    const prompt = CustomPacks.exportForAgent(pack);
    navigator.clipboard.writeText(prompt).then(() => {
      setNotice(`已生成「${pack.title}」精简 AI 提示词并复制到剪贴板`);
      setTimeout(() => setNotice(null), 3000);
    });
  };

  const handleCopyMarkdown = (pack: CustomPack) => {
    const md = CustomPacks.exportMarkdown(pack);
    navigator.clipboard.writeText(md).then(() => {
      setNotice(`已复制「${pack.title}」Markdown 清单`);
      setTimeout(() => setNotice(null), 3000);
    });
  };

  const handleCreatePack = () => {
    if (!newPackTitle.trim()) return;
    CustomPacks.create(newPackTitle, newPackDesc);
    setIsCreatingPack(false);
    setNewPackTitle("");
    setNewPackDesc("");
    setNotice("开发包创建成功");
    setTimeout(() => setNotice(null), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Notice Banner */}
      {notice && (
        <div className="rounded-lg border border-blue-500/40 bg-blue-900/30 px-4 py-2.5 text-[12.5px] font-medium text-blue-200 animate-fade-in flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-zinc-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Screen Header */}
      <div className="rounded-2xl border border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/90 p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-bold text-[color:var(--text-strong)]">
              我的库 (My Library)
            </h2>
            <p className="text-[12.5px] text-[color:var(--text-tertiary)] mt-1">
              本地沉淀的开发资产中心 · 管理个人收藏、浏览痕迹、开发套件与收集箱。
            </p>
          </div>

          {tab === "packs" && (
            <button
              type="button"
              onClick={() => setIsCreatingPack(true)}
              className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12px] font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer shadow-sm"
            >
              + 新建开发包
            </button>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-2 border-t border-[color:var(--line-subtle)] pt-3 flex-wrap">
          {[
            { id: "bookmarks", label: `我的收藏 (${bookmarkIds.length})` },
            { id: "recent", label: `最近使用 (${recentItems.length})` },
            { id: "packs", label: `开发套件 (${packs.length})` },
            { id: "inbox", label: `收集箱 (${inboxItems.length})` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as LibraryTab)}
              className={clsx(
                "rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium transition-colors cursor-pointer",
                tab === t.id
                  ? "bg-[color:var(--status-accent)] text-[color:var(--accent-on)] font-bold shadow-sm"
                  : "bg-[color:var(--surface-sunken)] text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: BOOKMARKS */}
      {tab === "bookmarks" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="在收藏中快速筛选..."
              className="max-w-xs w-full rounded-lg border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] px-3 py-1.5 text-[12.5px] text-[color:var(--text-primary)] placeholder-[color:var(--text-tertiary)] focus:outline-hidden"
            />
            <span className="text-[12px] text-[color:var(--text-quiet)] font-mono">
              共 {filteredBookmarks.length} 项收藏
            </span>
          </div>

          {filteredBookmarks.length === 0 ? (
            <div className="py-20 text-center rounded-2xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/40 p-8 space-y-2">
              <div className="text-[14px] font-bold text-[color:var(--text-strong)]">
                暂无收藏项
              </div>
              <p className="text-[12px] text-[color:var(--text-tertiary)]">
                在软件库、开发资源、项目模板或 Repo Finder 中点击 ★ 即可收纳至此。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredBookmarks.map((item) => {
                const noteText = notes[item.id];
                return (
                  <div
                    key={item.id}
                    onClick={() => setActiveDetailItem(item)}
                    className="group relative flex flex-col justify-between rounded-[var(--radius-panel)] border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] p-4 hover:border-[color:var(--line-strong)] hover:shadow-md transition-all cursor-pointer"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="font-bold text-[14.5px] text-[color:var(--text-strong)] group-hover:text-[color:var(--status-accent)] transition-colors truncate">
                            {item.title}
                          </span>
                          <div className="font-mono text-[11px] text-[color:var(--text-quiet)] mt-0.5 truncate">
                            {item.categoryLabel || item.category} · {item.type}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            Bookmarks.toggle(item.id, item.title);
                          }}
                          className="text-amber-400 font-bold text-[13px] hover:scale-125 transition-transform"
                          title="取消收藏"
                        >
                          ★
                        </button>
                      </div>

                      <p className="mt-2 text-[12px] text-[color:var(--text-secondary)] line-clamp-2 leading-relaxed">
                        {item.description}
                      </p>

                      {noteText && (
                        <div className="mt-2.5 rounded bg-zinc-900/60 border border-zinc-800 p-2 text-[11.5px] text-zinc-300 italic">
                          <span className="text-zinc-500 not-italic font-mono mr-1">Note:</span>
                          {noteText}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 pt-2 border-t border-[color:var(--line-subtle)] flex items-center justify-between text-[11.5px]">
                      <span className="text-[color:var(--text-quiet)] font-mono">
                        {item.origin?.stars ? `★ ${item.origin.stars}` : item.category}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveCloneItem(item);
                        }}
                        className="font-bold text-[color:var(--status-accent)] hover:underline"
                      >
                        开始使用 →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: RECENT */}
      {tab === "recent" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[color:var(--text-quiet)] font-mono">
              记录最近访问的 30 项资产
            </span>
            {recentItems.length > 0 && (
              <button
                type="button"
                onClick={() => RecentTracker.clear()}
                className="text-[11.5px] text-zinc-400 hover:text-rose-400 cursor-pointer font-mono"
              >
                清空最近浏览
              </button>
            )}
          </div>

          {recentItems.length === 0 ? (
            <div className="py-20 text-center rounded-2xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/40 p-8 text-zinc-400 text-[13px] font-mono">
              暂无浏览记录，点击任意卡片将自动记录到此处。
            </div>
          ) : (
            <div className="divide-y divide-[color:var(--line-subtle)] rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] overflow-hidden">
              {recentItems.map((r) => {
                const found = resolveItem(r.id) || ({
                  id: r.id,
                  title: r.title,
                  subtitle: r.subtitle,
                  description: `${r.category} · ${r.type}`,
                  category: (r.category as any) || "software",
                  type: (r.type as any) || "tool",
                  tags: [r.category, r.type],
                } as DiscoveryItem);
                return (
                  <div
                    key={`${r.id}-${r.visitedAt}`}
                    onClick={() => {
                      setActiveDetailItem(found);
                    }}
                    className="flex items-center justify-between gap-4 p-3.5 hover:bg-[color:var(--surface-hover)] transition-colors cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[13.5px] text-[color:var(--text-strong)] truncate">
                          {r.title}
                        </span>
                        <span className="rounded bg-[color:var(--surface-sunken)] px-1.5 py-0.2 text-[10px] font-mono text-[color:var(--text-quiet)] border border-[color:var(--line-subtle)]">
                          {r.type}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-[color:var(--text-quiet)] mt-0.5">
                        {r.category} · 浏览于 {new Date(r.visitedAt).toLocaleTimeString()}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="text-[12px] text-[color:var(--status-accent)] hover:underline font-medium shrink-0"
                    >
                      查看详情 →
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CUSTOM PACKS */}
      {tab === "packs" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {packs.map((pack) => (
              <div
                key={pack.id}
                className="flex flex-col justify-between rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] p-5 space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[16px] font-bold text-[color:var(--text-strong)]">
                        {pack.title}
                      </h3>
                      <p className="text-[12px] text-[color:var(--text-tertiary)] mt-1 leading-relaxed">
                        {pack.description || "自定义开发套件"}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => CustomPacks.deletePack(pack.id)}
                      className="text-zinc-500 hover:text-rose-400 text-[12px]"
                      title="删除此套件"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Items list */}
                  <div className="mt-3 divide-y divide-zinc-800/60 rounded-lg border border-zinc-800 bg-[#0c0e12] overflow-hidden">
                    {pack.items.length === 0 ? (
                      <div className="p-3 text-center text-[11.5px] text-zinc-500 font-mono">
                        套件暂无内容，在资源或工具卡片中选择「添加至开发包」。
                      </div>
                    ) : (
                      pack.items.map((it) => (
                        <div key={it.id} className="flex items-center justify-between p-2.5 text-[12px]">
                          <div className="min-w-0 flex-1 truncate">
                            <span className="font-semibold text-zinc-200">{it.name}</span>
                            <span className="ml-2 font-mono text-[10.5px] text-zinc-500">[{it.type}]</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => CustomPacks.removeItem(pack.id, it.id)}
                            className="text-zinc-500 hover:text-rose-400 text-[11px] ml-2"
                          >
                            移除
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-[color:var(--line-subtle)] flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-[color:var(--text-quiet)]">
                    共 {pack.items.length} 项资产
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyMarkdown(pack)}
                      className="rounded border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-[11.5px] font-medium text-zinc-300 hover:text-white"
                    >
                      Markdown 导出
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyAgentPrompt(pack)}
                      className="rounded bg-blue-600 px-3 py-1 text-[11.5px] font-bold text-white hover:bg-blue-500 shadow-sm"
                    >
                      复制给 AI ↗
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: TRANSFER INBOX */}
      {tab === "inbox" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-[12px] text-[color:var(--text-quiet)]">
            <span>临时收集的网址或项目 · 稍后整理归档</span>
            <span className="font-mono">{inboxItems.length} 条待整理</span>
          </div>

          {inboxItems.length === 0 ? (
            <div className="py-20 text-center rounded-2xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/40 p-8 text-zinc-400 text-[13px] font-mono space-y-2">
              <div className="font-bold text-white text-[14px]">收集箱目前为空</div>
              <p className="text-[12px] text-zinc-400 max-w-md mx-auto">
                在 GitHub 探索或外部网页中点击「加入 Setup Center」，内容将出现在此处供你稍后整理。
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[color:var(--line-subtle)] rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] overflow-hidden">
              {inboxItems.map((item) => (
                <div key={item.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[14px] text-white truncate">
                        {item.title || item.url}
                      </span>
                      <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10.5px] text-zinc-400">
                        {item.suggestedCategory || item.suggestedType || "链接"}
                      </span>
                    </div>
                    {item.note && (
                      <p className="text-[12px] text-zinc-300 mt-1 line-clamp-1">{item.note}</p>
                    )}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[11px] text-blue-400 hover:underline mt-0.5 block truncate max-w-md"
                    >
                      {item.url}
                    </a>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => TransferInbox.updateStatus(item.id, "processed")}
                      className="rounded border border-emerald-600/40 bg-emerald-900/20 px-2.5 py-1 text-[11.5px] font-bold text-emerald-300 hover:bg-emerald-800/30"
                    >
                      归档保存
                    </button>
                    <button
                      type="button"
                      onClick={() => TransferInbox.updateStatus(item.id, "rejected")}
                      className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11.5px] text-zinc-400 hover:text-rose-400"
                    >
                      移除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Pack Modal */}
      {isCreatingPack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-[#12151b] p-6 text-white space-y-4">
            <h3 className="text-[16px] font-bold">新建个性化开发套件</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[12px] text-zinc-300 block mb-1">套件名称</label>
                <input
                  type="text"
                  value={newPackTitle}
                  onChange={(e) => setNewPackTitle(e.target.value)}
                  placeholder="例如: 社团新生 AI 必备包"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-[13px] text-white focus:outline-hidden focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[12px] text-zinc-300 block mb-1">套件说明</label>
                <textarea
                  rows={2}
                  value={newPackDesc}
                  onChange={(e) => setNewPackDesc(e.target.value)}
                  placeholder="例如: 一站式包含 VS Code、Ollama 以及常用前端起步模板..."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-[13px] text-white focus:outline-hidden focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreatingPack(false)}
                className="px-3 py-1.5 text-[12px] text-zinc-400 hover:text-white"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreatePack}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-[12px] font-bold text-white hover:bg-blue-500"
              >
                确认创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Details & Clone modals */}
      {activeDetailItem && (
        <RepoDetailModal
          isOpen={true}
          onClose={() => setActiveDetailItem(null)}
          item={activeDetailItem}
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
    </div>
  );
}
