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
/** Where to buy / contact. Single source of truth for About page. */
export const CONTACT = {
  qq: "1700142491",
  wechat: "Arukas_0623",
} as const;

/**
 * A quiet line offering the paid version, for placement under a gated control.
 *
 * Fully free mode: always renders nothing.
 */
export function ProHint(_props?: { className?: string }) {
  return null;
}

export function ProNotice() {
  return null;
}
