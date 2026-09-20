/**
 * Shared UI primitives.
 *
 * Small, unopinionated pieces the screens compose: a button, a section label, a
 * status glyph, a score readout, a hint line and a toast. Nothing here knows
 * what a profile or an installer is — they take strings and state, which is why
 * the wizard and the dashboard can share them.
 *
 * ## The status vocabulary, and why it has four values
 *
 * `StatusMark` is the app's whole visual language for "how did this go", and the
 * fourth value is the important one:
 *
 * | value     | glyph | meaning                                            |
 * |-----------|-------|----------------------------------------------------|
 * | `ok`      | ✓     | verified present / passed                          |
 * | `fail`    | ✕     | checked and absent, and this tool manages it       |
 * | `unknown` | !     | could not be determined — *not* the same as absent |
 * | `skipped` | –     | deliberately not present; nothing is wrong         |
 *
 * Collapsing `unknown` into `fail` is the single most damaging thing this
 * component could do: "we could not check" would render as "you do not have
 * it", and a student would go reinstall something they already have. Likewise
 * `skipped` exists because a program the tool never offered to install must not
 * be drawn as a failure the student agreed to.
 *
 * ## What the branding overhaul changed
 *
 * Two decorations were deleted outright: `StarMark` (a four-point star that was
 * the product's "mark") and `ParticleField` (26 drifting dots behind the first
 * screen). Both were pure "AI product" signalling with no informational
 * content, and `Welcome` was their only consumer. Nothing else referenced them.
 */

import clsx from "clsx";
import type { Confidence } from "../lib/types";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: {
  variant?: "primary" | "ghost" | "quiet";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={clsx(
        "relative inline-flex items-center justify-center gap-2 rounded-[10px]",
        "font-medium tracking-[-0.01em] whitespace-nowrap",
        "transition-[transform,background-color,border-color,color,opacity] duration-150 ease-out",
        "active:translate-y-[0.5px]",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0",
        size === "lg"
          ? "h-11 px-7 text-[15px]"
          : size === "sm"
            ? "h-7 px-2.5 text-[12px]"
            : "h-9 px-4 text-[13px]",
        variant === "primary" &&
          clsx(
            "bg-[color:var(--text-strong)] text-[color:var(--text-inverse)]",
            "hover:brightness-110",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_6px_20px_-8px_rgba(0,0,0,0.45)]",
          ),
        variant === "ghost" &&
          clsx(
            "border border-[color:var(--line-default)] bg-[color:var(--surface-inset)]",
            "text-[color:var(--text-primary)]",
            "hover:border-[color:var(--line-strong)] hover:bg-[color:var(--surface-hover)]",
          ),
        variant === "quiet" &&
          clsx(
            "text-[color:var(--text-tertiary)]",
            "hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-primary)]",
          ),
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// StatusMark
// ---------------------------------------------------------------------------

export function StatusMark({
  confidence,
  className,
}: {
  confidence: Confidence;
  className?: string;
}) {
  const base = "inline-flex h-4 w-4 shrink-0 items-center justify-center";

  if (confidence === "ok") {
    return (
      <span
        className={clsx(base, "text-[color:var(--status-ok)]", className)}
        role="img"
        aria-label="通过"
      >
        <svg viewBox="0 0 16 16" className="h-[13px] w-[13px]" fill="none">
          <path
            d="M3 8.5l3.2 3.2L13 4.8"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (confidence === "fail") {
    return (
      <span
        className={clsx(base, "text-[color:var(--status-bad)]", className)}
        role="img"
        aria-label="未通过"
      >
        <svg viewBox="0 0 16 16" className="h-[13px] w-[13px]" fill="none">
          <path
            d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  if (confidence === "unknown") {
    return (
      <span
        className={clsx(base, "text-[color:var(--status-warn)]", className)}
        role="img"
        aria-label="无法确认"
      >
        <svg viewBox="0 0 16 16" className="h-[13px] w-[13px]" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 5.4v3.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="8" cy="11" r="0.9" fill="currentColor" />
        </svg>
      </span>
    );
  }

  // `skipped`: a dash. Reads as "nothing here, and that is fine" rather than as
  // an error, which a cross would imply.
  return (
    <span
      className={clsx(base, "text-[color:var(--text-quiet)]", className)}
      role="img"
      aria-label="已跳过"
    >
      <svg viewBox="0 0 16 16" className="h-[13px] w-[13px]" fill="none">
        <path d="M4 8h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ScoreReadout
// ---------------------------------------------------------------------------

/**
 * The environment score.
 *
 * Twenty segments rather than a continuous bar: a bar implies precision the
 * measurement does not have, while segments make "about three quarters" legible
 * at a glance. The colour bands (≥85 ok, ≥60 warn, else bad) are the one place
 * the app uses colour to carry a verdict, which is why they are on the number
 * as well as the segments.
 */
export function ScoreReadout({
  score,
  max,
  className,
}: {
  score: number;
  max: number;
  className?: string;
}) {
  const filled = Math.round((score / 100) * 20);
  const tone =
    score >= 85
      ? "text-[color:var(--status-ok)]"
      : score >= 60
        ? "text-[color:var(--status-warn)]"
        : "text-[color:var(--status-bad)]";
  const bar =
    score >= 85
      ? "bg-[color:var(--status-ok)]"
      : score >= 60
        ? "bg-[color:var(--status-warn)]"
        : "bg-[color:var(--status-bad)]";

  return (
    <div className={clsx("flex items-center gap-4", className)}>
      <div className="flex items-baseline gap-1">
        <span className={clsx("tnum text-3xl font-semibold tracking-[-0.03em]", tone)}>
          {score}
        </span>
        <span className="text-[color:var(--text-quiet)] text-sm">%</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <div
          className="flex gap-[3px]"
          role="img"
          aria-label={`环境评分 ${score}%`}
        >
          {Array.from({ length: 20 }, (_, i) => (
            <span
              key={i}
              className={clsx(
                "h-1.5 flex-1 rounded-full transition-colors duration-500",
                i < filled ? bar : "bg-[color:var(--line-default)]",
              )}
              style={{ transitionDelay: `${i * 14}ms` }}
            />
          ))}
        </div>
        <span className="text-[color:var(--text-quiet)] tnum text-[11px]">
          满分 {max.toFixed(0)} 分
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text bits
// ---------------------------------------------------------------------------

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[color:var(--text-quiet)] mb-2.5 text-[11px] font-medium tracking-[0.14em] uppercase">
      {children}
    </div>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[color:var(--text-tertiary)] mt-1.5 text-[12.5px] leading-relaxed">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Notice
// ---------------------------------------------------------------------------

export function Notice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="fade fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className="glass flex items-center gap-3 rounded-[12px] px-4 py-2.5">
        <StatusMark confidence="fail" />
        <span className="text-[color:var(--text-primary)] text-[13px]">{message}</span>
        <button
          onClick={onDismiss}
          className="text-[color:var(--text-quiet)] hover:text-[color:var(--text-primary)] ml-1 text-[13px]"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
