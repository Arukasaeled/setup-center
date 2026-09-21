/**
 * QuickAction — one recommended next step, and only the actions that exist.
 *
 * ## The rule this component exists to enforce
 *
 * `NextStep.kind` carries four values and they are not cosmetic. Three of them
 * are things this app can do or lead to; the fourth (`manual`) is something only
 * the student can do — signing in to an account, setting a Git identity. Drawing
 * a button for the fourth would be a lie of the exact kind the product cannot
 * afford: a click that does nothing, or worse, does something different from
 * what its label says.
 *
 * So the buttons are derived from `kind`, and `manual` and `hardware` get no
 * button at all — they get a statement of who has to do the work. That is the
 * same distinction the audit found already correct in the config section
 * ("不会替你…"), kept consistent here.
 *
 * ## Why the reason is not truncated
 *
 * A recommendation without its reason is an order. The `reason` field is what
 * turns "装上 Node.js" into "装上 Node.js —— 「AI 应用开发」需要它", which is the
 * difference between a student doing something and a student deciding to. It is
 * rendered in full rather than clamped.
 */

import clsx from "clsx";
import { Button } from "./ui";
import type { NextStep } from "../lib/types";

/**
 * The minimum a recommendation must have to be rendered.
 *
 * Structural rather than `NextStep` itself, because `NextStep` carries a
 * `capabilityId` this component never reads — and `Recommendation` (the type the
 * advisor's summary uses) is the same thing without it. Requiring the full
 * `NextStep` would force the overview to fabricate an id to render a row it
 * already has all the information for.
 */
export type QuickActionItem = Pick<NextStep, "title" | "reason" | "kind">;

/** Who performs the work, stated plainly. */
function ownerOf(kind: NextStep["kind"]): { tag: string; tone: "auto" | "manual" } {
  switch (kind) {
    case "install":
      return { tag: "本工具可安装", tone: "auto" };
    case "configure":
      return { tag: "本工具可配置", tone: "auto" };
    case "manual":
      return { tag: "需要你自己操作", tone: "manual" };
    case "hardware":
      return { tag: "硬件限制", tone: "manual" };
  }
}

export function QuickAction({
  step,
  /** Runs the step when this app can. Omitted for `manual` / `hardware`. */
  onRun,
  /** True while this app's own action for this step is in flight. */
  busy = false,
}: {
  step: QuickActionItem;
  onRun?: () => void;
  busy?: boolean;
}) {
  const owner = ownerOf(step.kind);
  // The button is offered only when there is something to run *and* the caller
  // supplied a handler. A disabled button for a manual step would read as
  // "you cannot do this yet", which is the opposite of the truth.
  const actionable = owner.tone === "auto" && onRun !== undefined;

  return (
    <div
      className={clsx(
        "border-[color:var(--line-subtle)] flex items-start gap-3 rounded-[12px] border px-3.5 py-3",
        owner.tone === "auto"
          ? "bg-[color:var(--surface-inset)]"
          : "border-l-2 border-l-[color:var(--line-strong)]",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[color:var(--text-primary)] text-[13px] font-medium">
            {step.title}
          </span>
          <span className="text-[color:var(--text-quiet)] text-[11px]">{owner.tag}</span>
        </div>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[12px] leading-relaxed">
          {step.reason}
        </p>
      </div>

      {actionable && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 shrink-0"
          disabled={busy}
          onClick={onRun}
        >
          {busy ? "处理中…" : "去处理"}
        </Button>
      )}
    </div>
  );
}
