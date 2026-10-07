import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import clsx from "clsx";
import type { Section } from "../lib/store";

export interface NavSectionItem {
  id: Section;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

export interface OverflowNavigationProps {
  items: NavSectionItem[];
  activeSection: Section;
  onSelect: (section: Section) => void;
  badges?: Partial<Record<Section, number>>;
  maxHorizontalVisible?: number;
  className?: string;
}

/**
 * OverflowNavigation — Adaptive navigation supporting content growth without clipping.
 *
 * Implements Issue H07:
 * - Automatically collapses excess navigation items into a "More / 更多" dropdown
 *   when laid out in horizontal shells (topbar, dock, stacked, canvas, windowed)
 *   or constrained horizontal space.
 * - Reflects active selection even when the active item resides in the overflow dropdown.
 * - Full WAI-ARIA menu compliance with Escape dismissal, outside click, and min 32px targets.
 * - Emits [data-nav-list] so shell.css rules declare layout without JSX logic.
 */
export function OverflowNavigation({
  items,
  activeSection,
  onSelect,
  badges = {},
  maxHorizontalVisible = 6,
  className,
}: OverflowNavigationProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside or Escape
  useEffect(() => {
    if (!dropdownOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen]);

  // Split visible items and overflow items
  // In vertical sidebar, all visible items can be rendered.
  // In horizontal orientations (or when total items > threshold),
  // we show the primary slice + More dropdown.
  const { visibleItems, overflowItems, activeInOverflow } = useMemo(() => {
    if (items.length <= maxHorizontalVisible) {
      return {
        visibleItems: items,
        overflowItems: [],
        activeInOverflow: false,
      };
    }

    const primary = items.slice(0, maxHorizontalVisible);
    const overflow = items.slice(maxHorizontalVisible);
    const inOverflow = overflow.some((item) => item.id === activeSection);

    return {
      visibleItems: primary,
      overflowItems: overflow,
      activeInOverflow: inOverflow,
    };
  }, [items, maxHorizontalVisible, activeSection]);

  const activeOverflowItem = useMemo(
    () => overflowItems.find((i) => i.id === activeSection),
    [overflowItems, activeSection],
  );

  return (
    <div
      ref={containerRef}
      data-nav-list
      className={clsx("flex flex-col gap-0.5", className)}
    >
      {/* 1. Primary visible navigation items */}
      {visibleItems.map((s) => {
        const active = s.id === activeSection;
        const badge = badges[s.id];

        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-current={active ? "page" : undefined}
            title={s.hint || s.label}
            className={clsx(
              "group flex min-h-[32px] items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left",
              "transition-colors duration-150 cursor-pointer select-none",
              active
                ? "bg-[color:var(--surface-active)]"
                : "hover:bg-[color:var(--surface-hover)]",
            )}
          >
            <span
              className={clsx(
                "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200",
                active
                  ? "bg-[color:var(--status-accent)]"
                  : "bg-[color:var(--line-default)] group-hover:bg-[color:var(--text-quiet)]",
              )}
            />
            <span
              className={clsx(
                "flex-1 text-[13px] transition-colors duration-150 truncate",
                active
                  ? "text-[color:var(--text-strong)] font-semibold"
                  : "text-[color:var(--text-secondary)]",
              )}
            >
              {s.label}
            </span>
            {badge != null && badge > 0 && (
              <span className="text-[color:var(--text-quiet)] tnum text-[11.5px] ml-1">
                {badge}
              </span>
            )}
          </button>
        );
      })}

      {/* 2. Overflow "More / 更多" Dropdown Trigger */}
      {overflowItems.length > 0 && (
        <div ref={dropdownRef} className="relative inline-block">
          <button
            type="button"
            onClick={() => setDropdownOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            aria-current={activeInOverflow ? "page" : undefined}
            aria-label="更多分区导航"
            title="查看更多分区"
            className={clsx(
              "group flex min-h-[32px] w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left",
              "transition-colors duration-150 cursor-pointer select-none",
              activeInOverflow || dropdownOpen
                ? "bg-[color:var(--surface-active)] text-[color:var(--text-strong)] font-semibold"
                : "text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)]",
            )}
          >
            <span
              className={clsx(
                "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200",
                activeInOverflow
                  ? "bg-[color:var(--status-accent)]"
                  : "bg-[color:var(--line-default)] group-hover:bg-[color:var(--text-quiet)]",
              )}
            />
            <span className="flex-1 text-[13px] truncate">
              {activeInOverflow && activeOverflowItem
                ? `更多 · ${activeOverflowItem.label}`
                : "更多分区"}
            </span>
            <span className="text-[10px] text-[color:var(--text-quiet)] leading-none transition-transform duration-150 ml-1">
              {dropdownOpen ? "▴" : "▾"}
            </span>
          </button>

          {/* 3. Popover Menu */}
          {dropdownOpen && (
            <div
              role="menu"
              aria-label="更多导航分区"
              className={clsx(
                "absolute z-50 mt-1 min-w-[200px] max-w-[260px] rounded-xl border border-[color:var(--line-strong)] bg-[color:var(--surface-raised)] p-1.5 shadow-2xl backdrop-blur-md",
                "animate-in fade-in zoom-in-95 duration-150",
              )}
              style={{
                top: "100%",
                left: 0,
              }}
            >
              <div className="px-2 py-1 text-[10.5px] font-mono uppercase tracking-wider text-[color:var(--text-quiet)] border-b border-[color:var(--line-subtle)] mb-1">
                全部扩展分区
              </div>
              <div className="flex flex-col gap-0.5 max-h-[260px] overflow-y-auto">
                {overflowItems.map((item) => {
                  const isItemActive = item.id === activeSection;
                  const itemBadge = badges[item.id];

                  return (
                    <button
                      key={item.id}
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        onSelect(item.id);
                        setDropdownOpen(false);
                      }}
                      aria-current={isItemActive ? "true" : undefined}
                      className={clsx(
                        "flex min-h-[32px] w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors cursor-pointer",
                        isItemActive
                          ? "bg-[color:var(--surface-active)] text-[color:var(--text-strong)] font-semibold"
                          : "text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)]",
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={clsx(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            isItemActive
                              ? "bg-[color:var(--status-accent)]"
                              : "bg-[color:var(--line-default)]",
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {itemBadge != null && itemBadge > 0 && (
                        <span className="text-[11px] font-mono text-[color:var(--text-quiet)]">
                          {itemBadge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
