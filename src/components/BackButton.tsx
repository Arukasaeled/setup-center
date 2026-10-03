/**
 * The one back button.
 *
 * ## Why it is a component and not a convention
 *
 * Before 0.1.1 every screen inlined its own `返回` and pointed it at a
 * *hardcoded* destination — `goTo("detect")`, `goTo("choose")`, `goTo("install")`.
 * Each of those is correct only for the route the author had in mind, and wrong
 * the moment a student arrives by another one: 已装软件 is reachable from 检测
 * *and* from the dashboard, so two of its three possible arrivals got a button
 * that silently teleported them somewhere they had never been.
 *
 * A single component fixes that by construction. It asks the store for the real
 * previous screen, so every screen that renders it is automatically right, and
 * no screen has to know its own position in a flow. It also means the button's
 * position, wording, icon, focus ring and light/dark legibility are decided in
 * one file rather than re-derived six times.
 *
 * ## Roots do not render it
 *
 * `welcome`, the Dashboard and the cold-start `ActivationGate` have no previous
 * page, so they render nothing. `navStack` makes that a fact about the history
 * rather than a rule each root has to remember — though a root that renders
 * `<BackButton/>` with an empty stack gets a correctly disabled button rather
 * than a broken one, which is the safe failure.
 */

import { Button } from "./ui";
import { useApp, type Screen } from "../lib/store";

export function BackButton({
  /**
   * Return to this screen instead of the real previous one.
   *
   * For the rare case where history is not the right answer — a screen that is
   * *always* a child of one specific page regardless of how it was reached. It
   * is deliberately explicit at the call site so the exception is greppable: a
   * bare `<BackButton />` is history-driven, and every `to=` is a decision
   * someone made on purpose.
   */
  to,
  /**
   * Runs *before* navigation, and may veto it by returning `false`.
   *
   * Exists so a screen can intercept a back press without owning the button.
   * The case that drove it is the install screen: mid-run, a back press must
   * open "继续后台安装 / 取消安装并返回" rather than silently navigating away —
   * but `disabled` cannot express that, because a disabled button cannot open
   * anything. A veto keeps the decision with the screen while the *navigation*
   * stays here, so `goBack()` remains the single primitive and no screen has to
   * reimplement it.
   *
   * `undefined` / any other return navigates normally, so every call site that
   * does not pass this prop behaves exactly as it did before.
   */
  onClick,
  label = "返回",
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: {
  to?: Screen;
  /** Return `false` to cancel this back press. */
  onClick?: () => boolean | void;
  label?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const goBack = useApp((s) => s.goBack);
  const goTo = useApp((s) => s.goTo);
  const canGoBack = useApp((s) => s.canGoBack());

  // With an explicit destination there is always somewhere to go, so the button
  // is enabled; without one, an empty history disables it rather than offering a
  // press that would silently do nothing.
  const inert = disabled || (!to && !canGoBack);

  const activate = () => {
    // The veto runs first, and only an explicit `false` cancels. Everything else
    // — `undefined`, `true`, a stray number — falls through to navigation, so a
    // handler that merely forgets to return cannot strand the student on a
    // screen with a dead back button.
    if (onClick?.() === false) return;

    if (to) goTo(to);
    else goBack();
  };

  return (
    <Button
      type="button"
      variant="quiet"
      onClick={activate}
      disabled={inert}
      // A stable hook for the test suite, matching the app's existing
      // `data-testid` convention. One shared testid is enough for every screen
      // precisely because the control is shared: a test asserts on
      // `[data-testid="back-button"]` rather than on the 返回 text, so the
      // assertion survives a copy change and cannot accidentally match a
      // different button that happens to contain those characters.
      data-testid="back-button"
      // A real `<button>`, so it is tab-reachable, Enter/Space work, and the
      // `:focus-visible` ring in `styles.css` applies. Nothing here re-implements
      // keyboard handling.
      //
      // The accessible name is the visible label by default, which is what the
      // rest of the app does; `aria-label` exists for a caller whose visible
      // label would otherwise be ambiguous out of context.
      aria-label={ariaLabel}
      className={className}
    >
      {/* Inline SVG rather than an icon package: this project has no icon
          dependency (see `package.json`), and `Detect.tsx` already draws its
          chevron this way. `currentColor` is what makes it legible in both
          themes — the arrow inherits the button's `--text-tertiary`, which is
          the same token the hover state lifts to `--text-primary`. */}
      {/* `aria-hidden`: the arrow restates the label that sits next to it, so
          announcing "左箭头 返回" would be noise, not information. */}
      <svg
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5 shrink-0"
        fill="none"
        aria-hidden
      >
        <path
          d="M10 3.5L5.5 8L10 12.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </Button>
  );
}
