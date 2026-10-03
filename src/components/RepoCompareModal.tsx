/**
 * Setup Center — Repository Compare Modal
 *
 * Side-by-side factual comparison of 2-4 candidate repositories or frameworks.
 */

import { createPortal } from "react-dom";
import type { DiscoveryItem } from "../core/discovery/types";

export interface RepoCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: DiscoveryItem[];
  onRemoveItem: (id: string) => void;
  onCloneItem?: (item: DiscoveryItem) => void;
}

export function RepoCompareModal({
  isOpen,
  onClose,
  items,
  onRemoveItem,
  onCloneItem,
}: RepoCompareModalProps) {
  if (!isOpen) return null;

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
    >
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 flex h-full w-full max-h-[90vh] max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-[#12151b] text-zinc-100 shadow-2xl">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-[#141820] px-6 py-4">
          <div>
            <h3 id="compare-modal-title" className="text-[17px] font-bold text-white">
              横向对比分析 (Compare {items.length} 项)
            </h3>
            <p className="text-[11.5px] font-mono text-zinc-400 mt-0.5">
              客观事实对比 · 协助你挑选最合适的技术方案
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-[12px] font-medium text-zinc-300 hover:text-white"
          >
            关闭
          </button>
        </header>

        {/* Content Table */}
        <div className="flex-1 overflow-x-auto overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="py-20 text-center text-zinc-400 font-mono text-[13px]">
              暂未选择对比项目，在项目卡片或详情页点击「加入横向对比」即可添加到此处。
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="py-3 px-4 w-32 font-bold text-zinc-400 uppercase tracking-wider text-[11px] bg-zinc-900/40">
                    指标
                  </th>
                  {items.map((it) => (
                    <th key={it.id} className="py-3 px-4 min-w-[220px] bg-[#141820] border-l border-zinc-800">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[15px] text-white truncate">
                          {it.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemoveItem(it.id)}
                          className="text-zinc-500 hover:text-rose-400 text-[12px]"
                          title="移出对比"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-400 truncate mt-0.5">
                        {it.origin?.author || it.category}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 font-mono text-[12px]">
                <tr>
                  <td className="py-3 px-4 font-bold text-zinc-400 bg-zinc-900/30">Star 数量</td>
                  {items.map((it) => (
                    <td key={it.id} className="py-3 px-4 border-l border-zinc-800 font-bold text-amber-300">
                      ★ {it.origin?.stars || "未统计"}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="py-3 px-4 font-bold text-zinc-400 bg-zinc-900/30">开发语言</td>
                  {items.map((it) => (
                    <td key={it.id} className="py-3 px-4 border-l border-zinc-800 text-zinc-200">
                      {it.origin?.language || "多语言 / 全栈"}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="py-3 px-4 font-bold text-zinc-400 bg-zinc-900/30">开源协议</td>
                  {items.map((it) => (
                    <td key={it.id} className="py-3 px-4 border-l border-zinc-800 text-zinc-300">
                      {it.origin?.license || "未知"}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="py-3 px-4 font-bold text-zinc-400 bg-zinc-900/30">最近活跃</td>
                  {items.map((it) => (
                    <td key={it.id} className="py-3 px-4 border-l border-zinc-800 text-zinc-300">
                      {it.origin?.lastUpdated || "近期"}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="py-3 px-4 font-bold text-zinc-400 bg-zinc-900/30">定位说明</td>
                  {items.map((it) => (
                    <td key={it.id} className="py-3 px-4 border-l border-zinc-800 font-sans text-zinc-300 text-[12px] leading-relaxed">
                      {it.description}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="py-3 px-4 font-bold text-zinc-400 bg-zinc-900/30">核心操作</td>
                  {items.map((it) => (
                    <td key={it.id} className="py-3 px-4 border-l border-zinc-800">
                      <div className="flex flex-col gap-1.5 font-sans">
                        {it.origin?.repository && (
                          <a
                            href={it.origin.repository}
                            target="_blank"
                            rel="noreferrer"
                            className="text-center rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:text-white"
                          >
                            访问 GitHub ↗
                          </a>
                        )}
                        {onCloneItem && (
                          <button
                            type="button"
                            onClick={() => onCloneItem(it)}
                            className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-500"
                          >
                            克隆此工程
                          </button>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
