import { useEffect, type ReactNode } from "react";
import clsx from "clsx";

export interface DetailShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  tags?: string[];
  actions?: ReactNode;
  children: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
}

/**
 * Unified detail overlay shell for Style, Resource, Template and Pattern items.
 *
 * Provides a refined modal/dialog surface with backdrop blur, keyboard dismissal,
 * clean typography, and decoupled deep content presentation.
 */
export function DetailShell({
  isOpen,
  onClose,
  title,
  subtitle,
  badge,
  tags,
  actions,
  children,
  width = "lg",
}: DetailShellProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const widthClass = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  }[width];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-shell-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Surface Card */}
      <div
        className={clsx(
          "relative w-full rounded-2xl border border-[color:var(--line-strong)] bg-[color:var(--surface-base)] text-[color:var(--text-primary)] shadow-2xl transition-all duration-200 flex flex-col max-h-[90vh] overflow-hidden",
          widthClass,
        )}
        style={{
          boxShadow: "0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px var(--line-default)",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--line-subtle)] px-6 py-5 bg-[color:var(--surface-raised)]/80">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2
                id="detail-shell-title"
                className="text-[18px] font-bold tracking-tight text-[color:var(--text-strong)]"
              >
                {title}
              </h2>
              {badge}
            </div>
            {subtitle && (
              <p className="text-[12px] font-mono text-[color:var(--text-tertiary)] mt-1">
                {subtitle}
              </p>
            )}
            {tags && tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-[color:var(--surface-sunken)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--text-quiet)] border border-[color:var(--line-subtle)]"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭详情"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] text-[color:var(--text-quiet)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors shrink-0"
          >
            <span className="text-[14px] leading-none">✕</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {children}
        </div>

        {/* Footer Actions */}
        {actions && (
          <div className="border-t border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/90 px-6 py-4 flex items-center justify-between gap-3">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
