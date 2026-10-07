import { useEffect, useMemo, type ReactNode } from "react";
import clsx from "clsx";
import type { DetailGrammar } from "../styles/types";
import { useApp } from "../lib/store";
import { getStyle } from "../styles/registry";
import { AccessibleDialog } from "./AccessibleDialog";

export const SUPPORTED_DETAIL_MODES: readonly DetailGrammar[] = [
  "modal",
  "sheet",
  "rail",
] as const;

export const DEFERRED_DETAIL_MODES: readonly DetailGrammar[] = [
  "floating-inspector",
  "window",
  "inline",
  "full-page",
] as const;

export interface DetailPresentationResolution {
  effectiveMode: "modal" | "sheet" | "rail";
  isDegraded: boolean;
  requestedGrammar: DetailGrammar;
  degradationNotice?: string;
}

/**
 * Resolves a requested DetailGrammar against the supported presenters.
 *
 * Mapped modes (Issue H02):
 * - `modal` -> Modal dialog
 * - `sheet` -> Slide-over drawer
 * - `rail`  -> Docked right rail
 *
 * Degraded / Deferred modes (explicitly noted per spec):
 * - `floating-inspector` -> sheet (complex drag/float deferred)
 * - `window`             -> modal (sub-window chrome deferred)
 * - `inline`             -> sheet (in-list expansion deferred)
 * - `full-page`          -> modal (complete page displacement deferred)
 */
export function resolveDetailPresentation(
  grammar: DetailGrammar,
): DetailPresentationResolution {
  switch (grammar) {
    case "modal":
      return {
        effectiveMode: "modal",
        isDegraded: false,
        requestedGrammar: grammar,
      };
    case "sheet":
      return {
        effectiveMode: "sheet",
        isDegraded: false,
        requestedGrammar: grammar,
      };
    case "rail":
      return {
        effectiveMode: "rail",
        isDegraded: false,
        requestedGrammar: grammar,
      };
    case "floating-inspector":
      return {
        effectiveMode: "sheet",
        isDegraded: true,
        requestedGrammar: grammar,
        degradationNotice: "浮动检查器已由规范延期，当前安全降级为抽屉详情呈现",
      };
    case "window":
      return {
        effectiveMode: "modal",
        isDegraded: true,
        requestedGrammar: grammar,
        degradationNotice: "多视窗模式已由规范延期，当前安全降级为模态居中呈现",
      };
    case "inline":
      return {
        effectiveMode: "sheet",
        isDegraded: true,
        requestedGrammar: grammar,
        degradationNotice: "行内展开模式已由规范延期，当前安全降级为抽屉详情呈现",
      };
    case "full-page":
      return {
        effectiveMode: "modal",
        isDegraded: true,
        requestedGrammar: grammar,
        degradationNotice: "整页置换模式已由规范延期，当前安全降级为模态呈现",
      };
    default:
      return {
        effectiveMode: "modal",
        isDegraded: false,
        requestedGrammar: "modal",
      };
  }
}

export interface DetailPresenterProps {
  isOpen: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  tags?: string[];
  actions?: ReactNode;
  children: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  grammar?: DetailGrammar;
}

/**
 * DetailPresenter — unified detail presentation engine for Setup Center.
 *
 * Implements Issue H02:
 * - Declarative grammar mapping for modal, sheet, and rail
 * - Honest degradation notices for the four complex deferred interactions
 * - Semantic token styling throughout (var(--surface-...), var(--text-...))
 * - Full WAI-ARIA compliance with AccessibleDialog integration
 */
export function DetailPresenter({
  isOpen,
  onClose,
  onPrev,
  onNext,
  hasPrev = true,
  hasNext = true,
  title,
  subtitle,
  badge,
  tags,
  actions,
  children,
  width = "lg",
  grammar: explicitGrammar,
}: DetailPresenterProps) {
  const activeStyleId = useApp((s) => s.activeStyle);

  // Derive active grammar from style or prop
  const activeGrammar: DetailGrammar = useMemo(() => {
    if (explicitGrammar) return explicitGrammar;
    const style = getStyle(activeStyleId);
    return style?.experience?.detail ?? "modal";
  }, [explicitGrammar, activeStyleId]);

  const resolution = useMemo(
    () => resolveDetailPresentation(activeGrammar),
    [activeGrammar],
  );

  // Arrow key navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }

      if (e.key === "ArrowLeft" && onPrev && hasPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" && onNext && hasNext) {
        e.preventDefault();
        onNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onPrev, onNext, hasPrev, hasNext]);

  if (!isOpen) return null;

  const widthClass = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  }[width];

  // Header content shared across presenters
  const header = (
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

      <div className="flex items-center gap-1.5 shrink-0">
        {onPrev && (
          <button
            type="button"
            onClick={onPrev}
            disabled={!hasPrev}
            aria-label="上一个条目 (←)"
            title="上一个条目 (快捷键: ←)"
            className={clsx(
              "flex min-h-[32px] min-w-[32px] h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] text-[color:var(--text-quiet)] transition-colors",
              hasPrev
                ? "hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] cursor-pointer"
                : "opacity-30 cursor-not-allowed",
            )}
          >
            <span className="text-[14px] leading-none">‹</span>
          </button>
        )}
        {onNext && (
          <button
            type="button"
            onClick={onNext}
            disabled={!hasNext}
            aria-label="下一个条目 (→)"
            title="下一个条目 (快捷键: →)"
            className={clsx(
              "flex min-h-[32px] min-w-[32px] h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] text-[color:var(--text-quiet)] transition-colors",
              hasNext
                ? "hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] cursor-pointer"
                : "opacity-30 cursor-not-allowed",
            )}
          >
            <span className="text-[14px] leading-none">›</span>
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情 (Esc)"
          title="关闭详情 (快捷键: Esc)"
          className="flex min-h-[32px] min-w-[32px] h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] text-[color:var(--text-quiet)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors ml-1 cursor-pointer"
        >
          <span className="text-[14px] leading-none">✕</span>
        </button>
      </div>
    </div>
  );

  // Degradation banner if requested grammar is deferred
  const degradationBanner = resolution.isDegraded ? (
    <div
      role="note"
      className="flex items-center gap-2 px-6 py-2 bg-[color:var(--surface-sunken)] border-b border-[color:var(--line-subtle)] text-[11.5px] text-[color:var(--text-tertiary)]"
    >
      <span className="font-mono text-[color:var(--status-accent)] font-semibold">
        ◈ 体验模式延期
      </span>
      <span>{resolution.degradationNotice}</span>
      <span className="ml-auto font-mono text-[10.5px] text-[color:var(--text-quiet)]">
        ({resolution.requestedGrammar} → {resolution.effectiveMode})
      </span>
    </div>
  ) : null;

  // Footer actions
  const footer = actions ? (
    <div className="border-t border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/90 px-6 py-4 flex items-center justify-between gap-3 shrink-0">
      {actions}
    </div>
  ) : null;

  // 1. Sheet mode (Edge-anchored drawer sliding from the right)
  if (resolution.effectiveMode === "sheet") {
    return (
      <AccessibleDialog
        isOpen={isOpen}
        onClose={onClose}
        titleId="detail-shell-title"
        dataProtectedUi={true}
        contentClassName="fixed inset-y-0 right-0 z-50 flex h-full w-[520px] max-w-[95vw] flex-col border-l border-[color:var(--line-strong)] bg-[color:var(--surface-base)] text-[color:var(--text-primary)] shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200"
      >
        {header}
        {degradationBanner}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {children}
        </div>
        {footer}
      </AccessibleDialog>
    );
  }

  // 2. Rail mode (Docked panel)
  if (resolution.effectiveMode === "rail") {
    return (
      <AccessibleDialog
        isOpen={isOpen}
        onClose={onClose}
        titleId="detail-shell-title"
        dataProtectedUi={true}
        contentClassName="fixed inset-y-0 right-0 z-50 flex h-full w-[420px] max-w-[95vw] flex-col border-l border-[color:var(--line-strong)] bg-[color:var(--surface-raised)] text-[color:var(--text-primary)] shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200"
      >
        {header}
        {degradationBanner}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {children}
        </div>
        {footer}
      </AccessibleDialog>
    );
  }

  // 3. Modal mode (Centered dialog over scrim) - default
  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      titleId="detail-shell-title"
      dataProtectedUi={true}
      contentClassName={clsx("w-full rounded-2xl border border-[color:var(--line-strong)] bg-[color:var(--surface-base)] text-[color:var(--text-primary)] shadow-2xl transition-all duration-200 flex flex-col max-h-[90vh] overflow-hidden", widthClass)}
    >
      {header}
      {degradationBanner}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {children}
      </div>
      {footer}
    </AccessibleDialog>
  );
}
