/**
 * StatusBadge — a status as a *word*, not only as a glyph.
 *
 * ## Why this exists next to `StatusMark`
 *
 * `StatusMark` draws the four-state vocabulary (✓ / ✕ / ! / –) as a glyph, and
 * that vocabulary is right. But a glyph alone only works for a reader who has
 * already learned it, and the previous screens leaned on exactly that: a row
 * showed `✕ Git` and left the student to infer whether that meant "missing",
 * "failed" or "we could not check".
 *
 * A badge pairs the glyph with its word so the state is unambiguous at a glance
 * and in a grid, where there is no room for a sentence. The words are the same
 * ones `StatusMark`'s `aria-label`s use, which is deliberate: screen readers and
 * sighted users should not be told two different things.
 *
 * ## The four states are not decoration
 *
 * The mapping is the product's most important honesty rule, and it is copied
 * from `StatusMark` rather than re-derived:
 *
 * | state     | word        | means                                          |
 * |-----------|-------------|------------------------------------------------|
 * | `ok`      | 已安装       | verified present                               |
 * | `fail`    | 未安装       | checked and absent, and this tool manages it   |
 * | `unknown` | 无法确认     | could not be determined — *not* the same as absent |
 * | `skipped` | 需自行安装   | deliberately absent; the tool never offered it |
 *
 * `unknown` must never collapse into `fail`: telling a student to install
 * something they may already have is the worst message this product can send.
 */

import clsx from "clsx";
import type { Confidence } from "../lib/types";
import { StatusMark } from "./ui";

/** The word each state carries, and the tone it is drawn in. */
const STATES: Record<
  Confidence,
  { label: string; tone: "ok" | "bad" | "warn" | "quiet"; title: string }
> = {
  ok: { label: "已安装", tone: "ok", title: "已确认存在" },
  fail: { label: "未安装", tone: "bad", title: "已检查，确认不存在" },
  unknown: { label: "无法确认", tone: "warn", title: "没能检查到结果，不代表没有" },
  skipped: { label: "需自行安装", tone: "quiet", title: "本工具只检测，不会替你安装" },
};

export function StatusBadge({
  confidence,
  /** Overrides the default word, for states that carry more context. */
  label,
  size = "md",
  className,
}: {
  confidence: Confidence;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const state = STATES[confidence];

  return (
    <span
      title={state.title}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border",
        size === "sm" ? "px-1.5 py-[1px] text-[10.5px]" : "px-2 py-[3px] text-[11px]",
        state.tone === "ok" &&
          "border-[color:var(--status-ok)]/25 text-[color:var(--status-ok)]",
        state.tone === "bad" &&
          "border-[color:var(--status-bad)]/25 text-[color:var(--status-bad)]",
        state.tone === "warn" &&
          "border-[color:var(--status-warn)]/25 text-[color:var(--status-warn)]",
        state.tone === "quiet" &&
          "border-[color:var(--line-default)] text-[color:var(--text-quiet)]",
        className,
      )}
    >
      <StatusMark confidence={confidence} size="sm" decorative />
      {label ?? state.label}
    </span>
  );
}

/**
 * The word for a state, for callers that need the text without the pill
 * (a `<select>` option, an `aria-label`, a sentence).
 *
 * Exported as a function rather than left inline so the badge and any prose
 * built from it cannot drift apart.
 */
export function statusWord(confidence: Confidence): string {
  return STATES[confidence].label;
}
