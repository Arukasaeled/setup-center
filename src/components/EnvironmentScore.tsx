/**
 * EnvironmentScore — the dashboard's headline: this machine, in one line.
 *
 * ## Why this replaced a bare percentage
 *
 * The overview already showed a score, and the audit found it did not work:
 * "78%" is a number about *everything*, which a student cannot act on — 78% of
 * what, and does the missing 22% matter? The brief's phase 6 asks for a status
 * centre instead, and the difference is entirely in what sits next to the
 * number:
 *
 * ```
 *   晚上好
 *
 *   你的开发环境          78%
 *   ████████░░
 *
 *   已准备   编辑器 · Git · Python
 *   还差     容器环境 · Node.js
 *
 *   [ 装好 Node.js —— 这是解锁「AI 应用开发」的下一步 ]
 * ```
 *
 * Two lists rather than one gap list, because "what I have" is the thing that
 * makes a student willing to look at "what I lack". A screen that only lists
 * deficiencies reads as a scolding and gets closed.
 *
 * ## The greeting is the only thing here that is not data
 *
 * Everything else comes from the environment and capability layers. The
 * greeting is a time-of-day word, and it is included because the brief asks for
 * it and because a wall of measurements with no human opening reads as a
 * diagnostic dump — which is the "机器语言" the brief forbids. It carries no
 * claim about the machine, so it cannot be wrong about it.
 *
 * ## What is deliberately absent
 *
 * No 检测完成 / 扫描完成 / 步骤完成. Those are the machine's words for its own
 * internal phases, and they tell a student nothing about their computer. The
 * audit found them in exactly two places (`Detect`, `Bootstrap`) and both are
 * on the wizard path; this component is the dashboard's counter-example.
 */

import clsx from "clsx";
import type { CapabilityStatus, Confidence } from "../lib/types";

export function EnvironmentScore({
  score,
  capabilities,
  greeting,
}: {
  /** 0–100. From the advisor when it has run, otherwise the detection score. */
  score: number;
  capabilities: CapabilityStatus[];
  /** Time-of-day word ("晚上好"), computed by the caller so this stays pure. */
  greeting: string;
}) {
  const ready = capabilities.filter((c) => c.status === "available");
  const partial = capabilities.filter((c) => c.status === "partial");
  const missing = capabilities.filter((c) => c.status === "unavailable");
  const unknown = capabilities.filter((c) => c.status === "unknown");

  const total = capabilities.length;
  const filled = Math.max(0, Math.min(20, Math.round((score / 100) * 20)));

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
    <div className="rise">
      <div className="text-[color:var(--text-tertiary)] text-[13px]">{greeting}</div>

      <div className="mt-1 flex items-baseline justify-between gap-4">
        <h1 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          你的开发环境
        </h1>
        <span className={clsx("tnum text-[26px] leading-none font-semibold tracking-[-0.03em]", tone)}>
          {score}
          <span className="text-[color:var(--text-quiet)] text-[14px] font-normal">%</span>
        </span>
      </div>

      {/* Twenty segments rather than a continuous bar: a bar implies a precision
          this measurement does not have, and segments make "about three
          quarters" legible at a glance. */}
      <div className="mt-3 flex gap-[3px]" role="img" aria-label={`开发环境就绪度 ${score}%`}>
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

      {total === 0 ? (
        <p className="text-[color:var(--text-quiet)] mt-4 text-[12.5px]">
          正在读取这台电脑的能力情况…
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          <Group
            label="已准备"
            confidence="ok"
            items={ready.map((c) => c.name)}
            empty="还没有一项完全就绪"
          />
          {/* `partial` and `unavailable` are listed separately on purpose.
              "缺一部分" and "还不具备" need different actions — one is a missing
              prerequisite, the other is a missing thing — and merging them
              would hide which is which. */}
          <Group
            label="缺一部分"
            confidence="unknown"
            items={partial.map((c) => c.name)}
          />
          <Group
            label="还差"
            confidence="fail"
            items={missing.map((c) => c.name)}
            empty={ready.length === total ? "什么都不缺" : undefined}
          />
          {/* Never folded into 还差. "We could not check" is not "you do not
              have it", and a student told otherwise reinstalls things. */}
          {unknown.length > 0 && (
            <Group
              label="无法确认"
              confidence="unknown"
              items={unknown.map((c) => c.name)}
              note="没能读到结果，不代表没有"
            />
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  label,
  confidence,
  items,
  empty,
  note,
}: {
  label: string;
  confidence: Confidence;
  items: string[];
  empty?: string;
  note?: string;
}) {
  if (items.length === 0 && !empty) return null;

  const dot =
    confidence === "ok"
      ? "bg-[color:var(--status-ok)]"
      : confidence === "fail"
        ? "bg-[color:var(--status-bad)]"
        : "bg-[color:var(--status-warn)]";

  return (
    <div className="flex items-start gap-3">
      <span className="text-[color:var(--text-quiet)] mt-[2px] w-[52px] shrink-0 text-[12px]">
        {label}
      </span>
      {items.length === 0 ? (
        <span className="text-[color:var(--text-quiet)] text-[12.5px]">{empty}</span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {items.map((name) => (
            <span key={name} className="flex items-center gap-1.5">
              <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", dot)} aria-hidden />
              <span className="text-[color:var(--text-secondary)] text-[12.5px]">{name}</span>
            </span>
          ))}
          {note && (
            <span className="text-[color:var(--text-quiet)] text-[11.5px]">{note}</span>
          )}
        </span>
      )}
    </div>
  );
}
