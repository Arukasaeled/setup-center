/**
 * The FREE / PRO badge.
 *
 * ## Why this is its own component
 *
 * The brief asks for the version state at the top of the window, and the top of
 * the window is `TitleBar` — which renders on *every* screen, including the
 * wizard steps that have nothing to do with licensing. Putting the licence
 * subscription in `TitleBar` would make the whole window re-render whenever the
 * entitlement changed, and would put a licensing concern in the chrome.
 *
 * So the subscription lives here and `TitleBar` just places the component. One
 * `useApp` selector, one file, and the title bar keeps its job.
 *
 * ## Why the badge shows `免费版` rather than nothing in the free tier
 *
 * A badge that only appears when paid is a badge the customer cannot interpret:
 * they see it once, at the moment of purchase, with no prior state to compare
 * it against. Showing `免费版` from the first launch is what makes the paid
 * state legible when it arrives.
 *
 * ## Why it renders nothing before the licence is read
 *
 * `entitlements === null` means "not read yet", which is different from "free".
 * Rendering `免费版` during that gap would flash a wrong answer on every cold
 * start — and for an activated customer, flashing `免费版` at the top of their
 * own paid application is the most alarming possible thing to show.
 */
import { useApp } from "../lib/store";

export function VersionBadge() {
  const entitlements = useApp((s) => s.entitlements);

  // Not "free" — simply "not known yet". See the note above.
  if (!entitlements) return null;

  const isPro = entitlements.tier === "pro";
  // A device mismatch is neither: the customer holds a real code that does not
  // belong to this machine, and labelling them "免费版" would hide why.
  const mismatch = entitlements.state === "deviceMismatch";

  const label = isPro ? "PRO" : "FREE";
  const title = isPro
    ? "已激活专业版"
    : mismatch
      ? "授权已绑定其他设备"
      : "当前版本：免费版";

  return (
    <span
      data-testid="version-badge"
      data-tier={entitlements.tier}
      data-state={entitlements.state}
      title={title}
      className={[
        "rounded-[5px] border px-1.5 py-[1px] text-[10px] font-semibold tracking-[0.04em] select-none",
        isPro
          ? "border-[color:var(--accent-line,var(--line-default))] bg-[color:var(--surface-inset)] text-[color:var(--text-strong)]"
          : mismatch
            ? "border-[color:var(--status-warn)] text-[color:var(--text-secondary)]"
            : "border-[color:var(--line-default)] text-[color:var(--text-quiet)]",
      ].join(" ")}
    >
      {label}
    </span>
  );
}
