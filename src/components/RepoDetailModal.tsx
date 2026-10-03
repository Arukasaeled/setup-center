/**
 * Setup Center — GitHub Repository Detail Modal
 *
 * Rich factual display of an inspected GitHub repository, featuring:
 * - One-click Transfer into local Library/Inbox
 * - Clone Repo via native CLI
 * - Personal Note editing
 * - Side-by-side Compare entry
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import type { DiscoveryItem } from "../core/discovery/types";
import { Bookmarks } from "../core/transfer/bookmarks";
import { PersonalNotes } from "../core/transfer/notes";
import { TransferInbox } from "../core/transfer/inbox";
import { CustomPacks } from "../core/transfer/packs";
import { CloneRepoModal } from "./CloneRepoModal";

export interface RepoDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: DiscoveryItem;
  onStartCompare?: (item: DiscoveryItem) => void;
  onNotice?: (msg: string) => void;
  onClone?: () => void;
}

export function RepoDetailModal({
  isOpen,
  onClose,
  item,
  onStartCompare,
  onNotice,
  onClone,
}: RepoDetailModalProps) {
  const [isBookmarked, setIsBookmarked] = useState(Bookmarks.isBookmarked(item.id));
  const [note, setNote] = useState(PersonalNotes.get(item.id));
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [isCloneOpen, setIsCloneOpen] = useState(false);
  const [transferDone, setTransferDone] = useState(false);
  const [showPackPicker, setShowPackPicker] = useState(false);
  const packs = CustomPacks.getAll();

  if (!isOpen) return null;

  const origin = item.origin;
  const repoUrl = origin?.repository || origin?.url || `https://github.com/${item.title}`;

  const handleToggleStar = () => {
    const next = Bookmarks.toggle(item.id, item.title, item);
    setIsBookmarked(next);
    onNotice?.(next ? "已加入收藏清单" : "已从收藏中移除");
  };

  const handleSaveNote = () => {
    PersonalNotes.set(item.id, note);
    setIsEditingNote(false);
    onNotice?.("备注已保存");
  };

  const handleTransferIntoSetup = () => {
    TransferInbox.add({
      url: repoUrl,
      title: item.title,
      note: `从 GitHub 探索收录: ${item.description}`,
      suggestedType: "resource",
      suggestedCategory: "tools",
    });
    setTransferDone(true);
    onNotice?.(`已收录「${item.title}」至我的库 · 稍后整理`);
  };

  const handleAddToPack = (packId: string) => {
    CustomPacks.addItem(packId, {
      id: item.id,
      name: item.title,
      type: "repo",
      category: "GitHub 仓库",
      url: repoUrl,
      command: `git clone ${repoUrl}.git`,
      note: item.description,
    });
    setShowPackPicker(false);
    onNotice?.(`已将「${item.title}」加入开发套件`);
  };

  const handleCopyClone = async () => {
    try {
      await navigator.clipboard.writeText(`git clone ${repoUrl}.git`);
      onNotice?.("Clone 命令已复制到剪贴板");
    } catch {
      onNotice?.("复制失败");
    }
  };

  const content = (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="repo-detail-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      >
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        <div className="relative z-10 flex h-full w-full max-h-[88vh] max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-[#12151b] text-zinc-100 shadow-2xl">
          {/* Header */}
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-800 bg-[#141820] px-6 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 id="repo-detail-title" className="text-[18px] font-bold text-white truncate">
                  {item.title}
                </h3>
                {origin?.stars && (
                  <span className="rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                    ★ {origin.stars}
                  </span>
                )}
                {item.health === "archived" && (
                  <span className="rounded bg-rose-950/60 border border-rose-800/50 px-2 py-0.5 text-[11px] font-bold text-rose-300">
                    已归档 (Archived)
                  </span>
                )}
                {item.health === "quiet" && (
                  <span className="rounded bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
                    久未活跃
                  </span>
                )}
              </div>
              <p className="font-mono text-[12px] text-zinc-400 mt-1 truncate">
                {origin?.author ? `${origin.author} / ` : ""}{item.title} · {origin?.language || "通用"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleStar}
                title={isBookmarked ? "取消收藏" : "加入收藏"}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2.5 text-[12px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
              >
                <span>{isBookmarked ? "★ 已收藏" : "☆ 收藏"}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>
          </header>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Description */}
            <div className="rounded-xl border border-zinc-800 bg-[#0e1116] p-4.5 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                项目说明
              </div>
              <p className="text-[13.5px] text-zinc-200 leading-relaxed">
                {item.description}
              </p>
            </div>

            {/* Facts Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded-lg border border-zinc-800 bg-[#0e1116] p-3">
                <div className="text-[11px] text-zinc-400">主要语言</div>
                <div className="text-[13.5px] font-bold text-white mt-1">
                  {origin?.language || "未知"}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-[#0e1116] p-3">
                <div className="text-[11px] text-zinc-400">开源协议</div>
                <div className="text-[13.5px] font-bold text-white mt-1">
                  {origin?.license || "未声明"}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-[#0e1116] p-3">
                <div className="text-[11px] text-zinc-400">最近更新</div>
                <div className="text-[13px] font-bold text-white mt-1">
                  {origin?.lastUpdated || "近期"}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-[#0e1116] p-3">
                <div className="text-[11px] text-zinc-400">收录状态</div>
                <div className="text-[13px] font-bold text-emerald-400 mt-1">
                  {item.isCurated ? "✓ 精选收录" : transferDone ? "已转入库" : "公开探索"}
                </div>
              </div>
            </div>

            {/* Topics */}
            {item.tags && item.tags.length > 0 && (
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  标签与主题 (Topics)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-zinc-800/80 px-2 py-0.5 font-mono text-[11px] text-zinc-300 border border-zinc-700/60"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Personal Note */}
            <div className="rounded-xl border border-zinc-800 bg-[#0e1116] p-4.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  个人随手笔记 (Personal Note)
                </div>
                {!isEditingNote && (
                  <button
                    type="button"
                    onClick={() => setIsEditingNote(true)}
                    className="text-[11px] text-blue-400 hover:underline cursor-pointer"
                  >
                    {note ? "修改备注" : "+ 添加备注"}
                  </button>
                )}
              </div>

              {isEditingNote ? (
                <div className="space-y-2">
                  <textarea
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="例如：用于团队 AI 评审，支持导出追踪..."
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2.5 text-[12.5px] text-white focus:border-blue-500 focus:outline-hidden"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingNote(false)}
                      className="px-2.5 py-1 text-[11.5px] text-zinc-400 hover:text-white"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveNote}
                      className="rounded bg-blue-600 px-3 py-1 text-[11.5px] font-bold text-white hover:bg-blue-500"
                    >
                      保存备注
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[12.5px] text-zinc-300 italic">
                  {note || "暂无备注。点击「+ 添加备注」写下你的想法，保存在本机。"}
                </p>
              )}
            </div>

            {/* Pack Picker Popover */}
            {showPackPicker && (
              <div className="rounded-xl border border-blue-500/40 bg-[#151c28] p-4 space-y-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-bold text-blue-200">
                    选择要收录进的开发套件:
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPackPicker(false)}
                    className="text-zinc-400 hover:text-white text-[12px] cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                {packs.length === 0 ? (
                  <p className="text-[12px] text-zinc-400">尚未创建任何开发套件，请先至「我的库」新建开发包。</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {packs.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleAddToPack(p.id)}
                        className="rounded-lg border border-zinc-700 bg-zinc-800/70 p-2.5 text-left hover:border-blue-500/50 hover:bg-zinc-800 transition-colors cursor-pointer"
                      >
                        <div className="font-bold text-[12.5px] text-white truncate">{p.title}</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5 truncate">{p.items.length} 项工具</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-[#141820] px-6 py-3.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPackPicker((prev) => !prev)}
                className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-[12px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
              >
                + 加入开发套件
              </button>

              {!item.isCurated && (
                <button
                  type="button"
                  onClick={handleTransferIntoSetup}
                  disabled={transferDone}
                  className={clsx(
                    "rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer",
                    transferDone
                      ? "border-emerald-600/40 bg-emerald-900/20 text-emerald-300"
                      : "border-zinc-700 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700 hover:text-white",
                  )}
                >
                  {transferDone ? "✓ 已收录至 Setup Center" : "+ 收录进 Setup Center"}
                </button>
              )}

              {onStartCompare && (
                <button
                  type="button"
                  onClick={() => onStartCompare(item)}
                  className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-[12px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
                >
                  加入横向对比
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleCopyClone}
                className="rounded-lg border border-zinc-700 bg-transparent px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              >
                复制 Clone 命令
              </button>

              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-[12px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
              >
                在 GitHub 打开 ↗
              </a>

              <button
                type="button"
                onClick={() => {
                  if (onClone) {
                    onClone();
                  } else {
                    setIsCloneOpen(true);
                  }
                }}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-[12.5px] font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer shadow-sm"
              >
                克隆到本机 (Clone)
              </button>
            </div>
          </footer>
        </div>
      </div>

      {isCloneOpen && (
        <CloneRepoModal
          isOpen={true}
          onClose={() => setIsCloneOpen(false)}
          repoUrl={repoUrl}
          repoName={item.title}
        />
      )}
    </>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
