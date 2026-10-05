/**
 * The paid-tier lock, in two intensities.
 *
 * ## Why two components rather than a `variant` prop
 *
 * They are not the same component at two sizes — they make different claims and
 * appear in different places:
 *
 * * [`ProHint`] is a *weak* line under an install button. It informs someone who
 *   has not tried yet. The brief is explicit: "不要弹窗骚扰用户". It is a
 *   paragraph, deliberately styled like body text rather than like a warning,
 *   and it is dismissible by simply not reading it.
 * * [`ProNotice`] is what appears *after* a refusal, when the customer has
 *   already acted and now needs to know what happened and what to do. It is
 *   allowed to be more prominent because the alternative — a silent no-op — is
 *   the behaviour that makes software feel broken.
 *
 * A boolean variant would have collapsed the "informing" case and the
 * "explaining a refusal" case into one appearance, and the honest difference
 * between them is the whole point.
 *
 * ## Contact details
 *
 * Hard-coded here rather than fetched: there is no server (a product
 * constraint), and putting them in a config file would create a second place for
 * them to be wrong. If the author changes their QQ number, this constant is the
 * one edit.
 */
import { useApp } from "../lib/store";

/** Where to buy. Single source of truth for both components and the About page. */
export const CONTACT = {
  qq: "1700142491",
  wechat: "Arukas_0623",
} as const;

/**
 * A quiet line offering the paid version, for placement under a gated control.
 *
 * Renders nothing when the customer already has the feature, so it can be
 * dropped into a layout unconditionally and it disappears on purchase.
 */
export function ProHint({ className = "" }: { className?: string }) {
  const entitlements = useApp((s) => s.entitlements);

  // Not loaded yet, or already entitled: nothing to say either way.
  if (!entitlements || entitlements.canInstall) return null;

  return (
    <p
      data-testid="pro-hint"
      className={[
        "text-[color:var(--text-quiet)] text-[11.5px] leading-relaxed",
        className,
      ].join(" ")}
    >
      需要自动安装与配置功能？联系作者获取专业版（QQ {CONTACT.qq}）。
    </p>
  );
}

/**
 * The explanation shown after a gated action was refused.
 *
 * Reads the refusal out of the store rather than taking it as a prop, because
 * the refusal can arrive from any gated command — install, resume, bootstrap —
 * and threading a callback through all three would mean three places deciding
 * what to render for the same event.
 */
export function ProNotice() {
  const gateBlocked = useApp((s) => s.gateBlocked);
  const clearGateBlock = useApp((s) => s.clearGateBlock);
  const setSection = useApp((s) => s.setSection);

  if (!gateBlocked) return null;

  return (
    <div
      data-testid="pro-notice"
      role="status"
      className="glass border-[color:var(--status-warn)] flex items-start gap-3 rounded-[10px] border p-4"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[color:var(--text-strong)] text-[13px] font-medium">
          专业版功能
        </div>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[12.5px] leading-relaxed">
          {gateBlocked}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              clearGateBlock();
              setSection("license");
            }}
            className="text-[color:var(--text-primary)] border-[color:var(--line-default)] hover:bg-[color:var(--surface-hover)] rounded-[7px] border px-2.5 py-1 text-[12px]"
          >
            查看版本与激活
          </button>
          <button
            type="button"
            onClick={clearGateBlock}
            className="text-[color:var(--text-quiet)] hover:text-[color:var(--text-secondary)] px-1 py-1 text-[12px]"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
