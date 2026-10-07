/**
 * Setup Center — GitHub Repository Detail Modal
 *
 * Rich factual display of an inspected GitHub repository, featuring:
 * - One-click Transfer into local Library/Inbox
 * - Clone Repo via native CLI
 * - Personal Note editing
 * - Side-by-side Compare entry
 *
 * Implements Issue H01 (semantic tokens) and H05 (AccessibleDialog + accessibility names).
 */

import { useState } from "react";
import clsx from "clsx";
import type { DiscoveryItem } from "../core/discovery/types";
import { Bookmarks } from "../core/transfer/bookmarks";
import { PersonalNotes } from "../core/transfer/notes";
import { TransferInbox } from "../core/transfer/inbox";
import { CustomPacks } from "../core/transfer/packs";
import { CloneRepoModal } from "./CloneRepoModal";
import { AccessibleDialog } from "./AccessibleDialog";

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

  return (
    <>
      <AccessibleDialog
        isOpen={isOpen}
        onClose={onClose}
        titleId="repo-detail-title"
        dataProtectedUi={true}
        maxWidth="max-w-2xl"
        panelClassName="relative z-10 flex h-full w-full max-h-[88vh] max-w-2xl flex-col overflow-hidden rounded-2xl border border-[color:var(--line-strong)] bg-[color:var(--surface-base)] text-[color:var(--text-primary)] shadow-2xl"
      >
        {/* Header */}
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/80 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 id="repo-detail-title" className="text-[18px] font-bold text-[color:var(--text-strong)] truncate">
                {item.title}
              </h3>
              {origin?.stars && (
                <span className="rounded bg-[color:var(--surface-sunken)] border border-[color:var(--line-default)] px-2 py-0.5 text-[11px] font-bold text-[color:var(--status-warn)]">
                  ★ {origin.stars}
                </span>
              )}
              {item.health === "archived" && (
                <span className="rounded bg-[color:var(--surface-sunken)] border border-[color:var(--status-bad)]/40 px-2 py-0.5 text-[11px] font-bold text-[color:var(--status-bad)]">
                  已归档 (Archived)
                </span>
              )}
              {item.health === "quiet" && (
                <span className="rounded bg-[color:var(--surface-sunken)] border border-[color:var(--line-subtle)] px-2 py-0.5 text-[11px] text-[color:var(--text-quiet)]">
                  久未活跃
                </span>
              )}
            </div>
            <p className="font-mono text-[12px] text-[color:var(--text-tertiary)] mt-1 truncate">
              {origin?.author ? `${origin.author} / ` : ""}{item.title} · {origin?.language || "通用"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleStar}
              aria-label={isBookmarked ? "取消收藏" : "加入收藏"}
              title={isBookmarked ? "取消收藏" : "加入收藏"}
              className="flex min-h-[32px] items-center gap-1.5 rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] px-2.5 text-[12px] font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors cursor-pointer"
            >
              <span>{isBookmarked ? "★ 已收藏" : "☆ 收藏"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭仓库详情"
              className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] text-[color:var(--text-quiet)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors cursor-pointer"
            >
              <span className="text-[13px] leading-none">✕</span>
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Description */}
          <div className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-4 space-y-2">
            <div className="text-[11.5px] font-bold uppercase tracking-wider text-[color:var(--text-tertiary)]">
              项目说明
            </div>
            <p className="text-[13.5px] text-[color:var(--text-primary)] leading-relaxed">
              {item.description}
            </p>
          </div>

          {/* Facts Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3">
              <div className="text-[11px] text-[color:var(--text-quiet)]">主要语言</div>
              <div className="text-[13.5px] font-bold text-[color:var(--text-strong)] mt-1">
                {origin?.language || "未知"}
              </div>
            </div>
            <div className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3">
              <div className="text-[11px] text-[color:var(--text-quiet)]">开源协议</div>
              <div className="text-[13.5px] font-bold text-[color:var(--text-strong)] mt-1">
                {origin?.license || "未声明"}
              </div>
            </div>
            <div className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3">
              <div className="text-[11px] text-[color:var(--text-quiet)]">最近更新</div>
              <div className="text-[13px] font-bold text-[color:var(--text-strong)] mt-1">
                {origin?.lastUpdated || "近期"}
              </div>
            </div>
            <div className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3">
              <div className="text-[11px] text-[color:var(--text-quiet)]">收录状态</div>
              <div className="text-[13px] font-bold text-[color:var(--status-ok)] mt-1">
                {item.isCurated ? "✓ 精选收录" : transferDone ? "已转入库" : "公开探索"}
              </div>
            </div>
          </div>

          {/* Topics */}
          {item.tags && item.tags.length > 0 && (
            <div>
              <div className="text-[11.5px] font-bold uppercase tracking-wider text-[color:var(--text-tertiary)] mb-2">
                标签与主题 (Topics)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-[color:var(--surface-sunken)] px-2 py-0.5 font-mono text-[11px] text-[color:var(--text-secondary)] border border-[color:var(--line-subtle)]"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Personal Note */}
          <div className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11.5px] font-bold uppercase tracking-wider text-[color:var(--text-tertiary)]">
                个人随手笔记 (Personal Note)
              </div>
              {!isEditingNote && (
                <button
                  type="button"
                  onClick={() => setIsEditingNote(true)}
                  className="text-[11.5px] text-[color:var(--status-accent)] hover:underline cursor-pointer"
                >
                  {note ? "修改备注" : "+ 添加备注"}
                </button>
              )}
            </div>

            {isEditingNote ? (
              <div className="space-y-2">
                <textarea
                  id="repo-note-textarea"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例如：用于团队 AI 评审，支持导出追踪..."
                  className="w-full rounded-lg border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] p-2.5 text-[12.5px] text-[color:var(--text-primary)] focus:border-[color:var(--status-accent)] focus:outline-none transition-colors"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingNote(false)}
                    className="flex min-h-[32px] items-center px-2.5 py-1 text-[11.5px] text-[color:var(--text-quiet)] hover:text-[color:var(--text-primary)] cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveNote}
                    className="flex min-h-[32px] items-center rounded bg-[color:var(--status-accent)] px-3 py-1 text-[11.5px] font-bold text-black hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    保存备注
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[12.5px] text-[color:var(--text-secondary)] italic">
                {note || "暂无备注。点击「+ 添加备注」写下你的想法，保存在本机。"}
              </p>
            )}
          </div>

          {/* Pack Picker Popover */}
          {showPackPicker && (
            <div className="rounded-xl border border-[color:var(--status-accent)]/40 bg-[color:var(--surface-raised)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-bold text-[color:var(--text-strong)]">
                  选择要收录进的开发套件:
                </span>
                <button
                  type="button"
                  onClick={() => setShowPackPicker(false)}
                  aria-label="关闭套件选择器"
                  className="text-[color:var(--text-quiet)] hover:text-[color:var(--text-primary)] text-[12px] cursor-pointer"
                >
                  ✕
                </button>
              </div>
              {packs.length === 0 ? (
                <p className="text-[12px] text-[color:var(--text-quiet)]">尚未创建任何开发套件，请先至「我的库」新建开发包。</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {packs.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleAddToPack(p.id)}
                      className="min-h-[36px] rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] p-2.5 text-left hover:border-[color:var(--status-accent)]/50 hover:bg-[color:var(--surface-hover)] transition-colors cursor-pointer"
                    >
                      <div className="font-bold text-[12.5px] text-[color:var(--text-strong)] truncate">{p.title}</div>
                      <div className="text-[11px] text-[color:var(--text-quiet)] mt-0.5 truncate">{p.items.length} 项工具</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/90 px-6 py-3.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPackPicker((prev) => !prev)}
              className="flex min-h-[32px] items-center rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors cursor-pointer"
            >
              + 加入开发套件
            </button>

            {!item.isCurated && (
              <button
                type="button"
                onClick={handleTransferIntoSetup}
                disabled={transferDone}
                className={clsx(
                  "flex min-h-[32px] items-center rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer",
                  transferDone
                    ? "border-[color:var(--status-ok)]/40 bg-[color:var(--surface-sunken)] text-[color:var(--status-ok)]"
                    : "border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)]",
                )}
              >
                {transferDone ? "✓ 已收录至 Setup Center" : "+ 收录进 Setup Center"}
              </button>
            )}

            {onStartCompare && (
              <button
                type="button"
                onClick={() => onStartCompare(item)}
                className="flex min-h-[32px] items-center rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors cursor-pointer"
              >
                加入横向对比
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleCopyClone}
              className="flex min-h-[32px] items-center rounded-lg border border-[color:var(--line-subtle)] bg-transparent px-3 py-1.5 text-[12px] font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors cursor-pointer"
            >
              复制 Clone 命令
            </button>

            <a
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[32px] items-center rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors cursor-pointer"
            >
              在 GitHub 打开 ↗
            </a>

            <button
              type="button"
              onClick={() => {
                if (onClone) {
                  onClone();
                } else {
                  setIsCloneOpen(false);
                  setIsCloneOpen(true);
                }
              }}
              className="flex min-h-[32px] items-center rounded-lg bg-[color:var(--status-accent)] px-4 py-1.5 text-[12.5px] font-bold text-black hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
            >
              克隆到本机 (Clone)
            </button>
          </div>
        </footer>
      </AccessibleDialog>

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
}
