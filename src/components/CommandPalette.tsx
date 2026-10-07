import { useState, useEffect, useRef } from "react";
import clsx from "clsx";
import { searchUnified, type UnifiedSearchResult } from "../core/setup/search";
import { executeSetupAction } from "../core/setup/executor";

import { useModalStack } from "./ModalProvider";
import { isHotkeyAllowed } from "../lib/keyboard";

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { pushModal, popModal, isTopModal } = useModalStack();

  const results = searchUnified(query, 16);

  // Auto focus input when opened and register with modal stack
  useEffect(() => {
    if (isOpen) {
      pushModal("command-palette");
      setQuery("");
      setSelectedIndex(0);
      setFeedback(null);
      setTimeout(() => inputRef.current?.focus(), 50);
      return () => {
        popModal("command-palette");
      };
    }
  }, [isOpen, pushModal, popModal]);

  // Keep selected index in bounds when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Global Keyboard shortcuts: Escape, ArrowUp, ArrowDown, Enter
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTopModal("command-palette")) return;
      if (!isHotkeyAllowed(e, { allowInInputs: true })) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          results.length > 0 ? (prev - 1 + results.length) % results.length : 0,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const activeItem = results[selectedIndex];
        if (activeItem) {
          handleExecute(activeItem);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, results, selectedIndex, isTopModal, onClose]);

  const handleExecute = async (item: UnifiedSearchResult) => {
    try {
      const res = await executeSetupAction(item.setupAction, {
        id: item.id,
        name: item.name,
        type: item.type,
      });

      if (res.ok) {
        setFeedback(res.message);
        setTimeout(() => {
          setFeedback(null);
          onClose();
        }, 800);
      } else {
        setFeedback(res.message);
        setTimeout(() => setFeedback(null), 2000);
      }
    } catch {
      setFeedback("操作执行失败");
      setTimeout(() => setFeedback(null), 1500);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="全局指令与资产检索面板"
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Surface Card */}
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-[color:var(--line-strong)] bg-[color:var(--surface-base)] text-[color:var(--text-primary)] shadow-2xl transition-all duration-150 overflow-hidden flex flex-col max-h-[80vh]"
        style={{
          boxShadow: "0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px var(--line-default)",
        }}
      >
        {/* Search Header */}
        <div className="flex items-center gap-3 border-b border-[color:var(--line-subtle)] px-4 py-3.5 bg-[color:var(--surface-raised)]/90">
          <span className="text-[14px] text-[color:var(--text-tertiary)] font-mono">⌘K</span>
          <input
            ref={inputRef}
            id="command-palette-search-input"
            aria-label="全局指令与资源搜索"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索软件、风格、组件、模板、Starter Packs... (按 ↑↓ 选择，Enter 执行)"
            className="flex-1 bg-transparent text-[14px] text-[color:var(--text-strong)] placeholder-[color:var(--text-tertiary)] focus:outline-hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="清除搜索输入"
              className="min-h-[32px] min-w-[32px] flex items-center justify-center text-[11px] font-mono text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] px-2 py-1 rounded-md bg-[color:var(--surface-inset)] transition-colors"
            >
              清除
            </button>
          )}
          <kbd className="hidden sm:inline-block rounded border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] px-1.5 py-0.5 text-[10px] font-mono text-[color:var(--text-tertiary)]">
            ESC
          </kbd>
        </div>

        {/* Feedback Banner */}
        {feedback && (
          <div className="bg-[color:var(--accent)] text-[color:var(--accent-on)] px-4 py-2 text-[12px] font-medium flex items-center justify-between animate-fade-in">
            <span>✓ {feedback}</span>
            <span className="text-[10px] opacity-75 font-mono">自动处理中...</span>
          </div>
        )}

        {/* Results List */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-2 space-y-1 divide-y-0"
          style={{ minHeight: "220px", maxHeight: "480px" }}
        >
          {results.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-[color:var(--text-tertiary)] font-mono">
              未检索到匹配项，换一个关键词试试（例如：React, Tailwind, Git, Python, Comic）
            </div>
          ) : (
            results.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  onClick={() => handleExecute(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={clsx(
                    "flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors text-left",
                    isSelected
                      ? "bg-[color:var(--surface-hover)] border border-[color:var(--line-strong)]"
                      : "hover:bg-[color:var(--surface-raised)]/60 border border-transparent",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-[color:var(--text-strong)] truncate">
                        {item.name}
                      </span>
                      <span className="rounded bg-[color:var(--surface-sunken)] px-1.5 py-0.2 text-[10px] font-mono text-[color:var(--text-tertiary)] border border-[color:var(--line-subtle)] shrink-0">
                        {item.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-[color:var(--text-quiet)] line-clamp-1 mt-0.5">
                      {item.description}
                    </p>
                  </div>

                  {/* Action badge */}
                  <div className="shrink-0 flex items-center gap-2">
                    <span
                      className={clsx(
                        "text-[11px] font-mono px-2 py-1 rounded-md transition-colors",
                        isSelected
                          ? "bg-[color:var(--accent)] text-[color:var(--accent-on)] font-medium"
                          : "bg-[color:var(--surface-inset)] text-[color:var(--text-tertiary)]",
                      )}
                    >
                      {item.setupAction.label}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="border-t border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/90 px-4 py-2 flex items-center justify-between text-[11px] text-[color:var(--text-tertiary)] font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ 导航</span>
            <span>↵ 执行主要动作</span>
            <span>ESC 关闭</span>
          </div>
          <div>共 {results.length} 项可用能力</div>
        </div>
      </div>
    </div>
  );
}
