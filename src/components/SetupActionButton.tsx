import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import type { PackageManager, PrerequisitesStatus, SetupAction } from "../core/setup/types";
import { executeSetupAction } from "../core/setup/executor";

/**
 * The secondary-actions menu is rendered through a portal into `document.body`
 * and positioned against the trigger's viewport rect, rather than as an
 * `absolute` child of the button.
 *
 * Why: the old markup was `absolute right-0 top-full z-50` inside the card, so
 * the menu lived INSIDE the card's stacking context. Several experiences lift a
 * card with `transform` (poster tilts `rotate(-0.8deg)`, sticker `rotate(-0.5deg)`)
 * or with `:hover { z-index: 2 }`, and a transform makes the element the
 * containing block for its descendants — so no `z-index` on the menu, however
 * large, could escape the card. The menu and the card below it therefore traded
 * the top layer as the pointer crossed between them, which the user saw as
 * flicker. Raising the number cannot fix a stacking-context escape; the menu has
 * to stop being a descendant of the card.
 *
 * `position: fixed` is only viewport-relative while no ancestor establishes a
 * containing block, which is exactly why the portal target is `body` (`html`,
 * `body` and `#root` carry no transform/filter in this app).
 */
const MENU_GAP = 4;
const MENU_EDGE = 8;
const MENU_MIN_WIDTH = 200;
/**
 * Above every other layer in the app (`z-40` titlebar, `z-50` modal shells).
 * A Setup Action also lives in the DetailShell footer, so the menu has to paint
 * over the `z-50` dialog it was opened from — this is a deliberate layer, not an
 * escalation of the old `z-50`.
 */
const MENU_Z = 60;

interface MenuPosition {
  top: number;
  left: number;
  maxHeight: number;
  placement: "below" | "above";
}

export interface SetupActionButtonProps {
  action: SetupAction;
  itemMeta?: { id: string; name: string; type?: string };
  secondaryActions?: SetupAction[];
  availablePackageManagers?: PackageManager[];
  prerequisites?: PrerequisitesStatus;
  onActionSuccess?: (msg: string) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
  showPmSelector?: boolean;
  /**
   * Renders the control inert with its reason visible. Used for content the
   * running build cannot honour — an experience whose manifest declares a newer
   * `runtimeCapability`, or a draft that is not implemented yet — where offering
   * a button that would silently do nothing is worse than offering none.
   */
  disabled?: boolean;
  disabledReason?: string;
}

export function SetupActionButton({
  action,
  itemMeta,
  secondaryActions = [],
  availablePackageManagers,
  prerequisites,
  onActionSuccess,
  size = "md",
  className,
  showPmSelector = true,
  disabled = false,
  disabledReason,
}: SetupActionButtonProps) {
  const [activePm, setActivePm] = useState<PackageManager>(
    action.activePackageManager || (availablePackageManagers?.[0] ?? "pnpm"),
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  /**
   * Position the menu against the trigger's viewport rect, flipping above the
   * trigger when there is not enough room below, and capping the height when
   * neither side can hold it.
   *
   * This is what keeps the menu on screen near the bottom of the window: the
   * resource grid and the software list both scroll, so the last row's menu is a
   * routine case, and an uncapped `fixed` menu would simply run off the bottom.
   * Capping is preferred over moving the trigger, because the trigger is content.
   */
  const placeMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const natural = menuRef.current?.offsetHeight ?? 0;
    const width = Math.max(MENU_MIN_WIDTH, rect.width);
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - MENU_EDGE;
    const spaceAbove = rect.top - MENU_GAP - MENU_EDGE;

    // Below wins whenever it fits — a menu that opens downward is the expected
    // reading. Otherwise the roomier side is used, capped to what it can hold, so
    // the menu is always fully inside the viewport and never scrolls the page.
    // Until the height is known, stay below: measuring happens in the same frame,
    // and defaulting to the flip direction would make the first paint jump.
    const fitsBelow = natural > 0 && natural <= spaceBelow;
    const fitsAbove = natural > 0 && natural <= spaceAbove;
    const placement: MenuPosition["placement"] =
      natural === 0 || fitsBelow || (!fitsAbove && spaceBelow >= spaceAbove)
        ? "below"
        : "above";
    const available = Math.max(0, placement === "below" ? spaceBelow : spaceAbove);
    const maxHeight = Math.max(120, available);
    const rendered = natural > 0 ? Math.min(natural, maxHeight) : natural;

    const top = placement === "below" ? rect.bottom + MENU_GAP : rect.top - MENU_GAP - rendered;
    // Right-align to the trigger, then clamp into the viewport so a menu on the
    // last column cannot hang off the right edge.
    const left = Math.min(
      Math.max(MENU_EDGE, rect.right - width),
      window.innerWidth - width - MENU_EDGE,
    );
    setMenuPos({ top: Math.max(MENU_EDGE, top), left, maxHeight, placement });
  }, []);

  // Measure before paint so the menu never renders at a stale position for a
  // frame, and re-measure once the height is known (that is what enables a flip).
  useLayoutEffect(() => {
    if (!dropdownOpen) {
      setMenuPos(null);
      return;
    }
    placeMenu();
    const raf = requestAnimationFrame(() => placeMenu());
    return () => cancelAnimationFrame(raf);
  }, [dropdownOpen, placeMenu]);

  /**
   * While open: follow the trigger on scroll/resize (capture phase catches the
   * card grid's own scroll container, not just the window), close on Escape, and
   * close on a click outside both trigger and menu.
   *
   * The outside-click test cannot be "is the target inside the button" any more,
   * because the menu is not a descendant of the button. It is inside EITHER the
   * trigger OR the portalled menu.
   */
  useEffect(() => {
    if (!dropdownOpen) return;

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setDropdownOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase, and stop there: `DetailShell` also listens for Escape on
      // `window` (to close the whole dialog), and inside the dialog's footer this
      // button's menu is the innermost open layer. Escape must dismiss the menu
      // first, not the dialog that contains it. Two listeners on the same target
      // both run unless the event never reaches the second one, so this is
      // registered with `capture: true` — that is what makes the stop effective,
      // `stopPropagation` alone between two bubble-phase window listeners is not.
      e.stopPropagation();
      setDropdownOpen(false);
    };
    // `true` = capture, so the grid's own scroller is observed too.
    const handleReflow = () => placeMenu();

    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleReflow);
    window.addEventListener("scroll", handleReflow, true);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleReflow);
      window.removeEventListener("scroll", handleReflow, true);
    };
  }, [dropdownOpen, placeMenu]);

  // Compute active payload if package manager is switched
  const currentAction: SetupAction = {
    ...action,
    activePackageManager: activePm,
    payload:
      action.packageCommands?.[activePm] ||
      action.payload,
    label:
      action.type === "command" && action.packageCommands
        ? `复制 ${activePm} 命令`
        : action.label,
  };

  /**
   * Every control in this component runs inside a clickable container — a
   * resource card and a style card both open their detail view from the card's
   * own `onClick`. Running a Setup Action must not also open the detail, and the
   * portal does not change that: React re-attaches portal events to the React
   * tree, so a click in the menu still bubbles to the card that rendered the
   * button. The stop has to be explicit, at the control.
   */
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const handleRun = async (actToRun: SetupAction) => {
    setIsExecuting(true);
    try {
      const result = await executeSetupAction(actToRun, itemMeta);
      if (result.ok) {
        setFeedback(result.message);
        onActionSuccess?.(result.message);
        setTimeout(() => setFeedback(null), 2200);
      } else {
        setFeedback(result.message);
        setTimeout(() => setFeedback(null), 3000);
      }
    } catch (err) {
      setFeedback("操作失败");
      setTimeout(() => setFeedback(null), 2000);
    } finally {
      setIsExecuting(false);
      setDropdownOpen(false);
    }
  };

  const sizeClasses = {
    sm: "px-2.5 py-1 text-[12px] gap-1.5",
    md: "px-4 py-2 text-[13px] gap-2 font-medium",
    lg: "px-5 py-2.5 text-[14px] gap-2.5 font-semibold",
  }[size];

  const hasMissingPrereq = prerequisites && !prerequisites.satisfied;

  return (
    <div className={clsx("inline-flex flex-col gap-1.5", className)}>
      {/* `rounded-[var(--radius-control)]` rather than a literal: this is the
          primary control of every card in the app, so a radius override that
          does not reach *this* button would not look like it reached anything.
          The fill reads `--accent` and its foreground reads `--accent-on`,
          both runtime-owned, so an accent override reaches the control the user
          is looking at when they change it. */}
      <div
        data-setup-action
        className="inline-flex items-center rounded-[var(--radius-control)] border border-[color:var(--line-strong)] bg-[color:var(--surface-raised)] shadow-sm"
      >
        {/* Main Action Button */}
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            void handleRun(currentAction);
          }}
          disabled={isExecuting || disabled}
          className={clsx(
            "inline-flex items-center justify-center rounded-l-[var(--radius-control)] transition-all duration-150 active:scale-[0.98]",
            disabled
              ? "bg-[color:var(--surface-hover)] text-[color:var(--text-quiet)] cursor-not-allowed"
              : "bg-[color:var(--accent)] text-[color:var(--accent-on)] hover:brightness-110",
            sizeClasses,
            secondaryActions.length === 0 && !availablePackageManagers?.length && "rounded-r-[var(--radius-control)]",
          )}
          title={currentAction.description || currentAction.label}
        >
          {isExecuting ? (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
          ) : feedback ? (
            <span className="flex items-center gap-1 text-[12px]">
              <span className="font-bold">✓</span> {feedback}
            </span>
          ) : (
            <>
              <span className="tracking-tight">{currentAction.label}</span>
              {currentAction.type === "command" && (
                <span className="text-[10px] opacity-75 font-mono px-1 rounded bg-black/20">
                  {activePm}
                </span>
              )}
            </>
          )}
        </button>

        {/* Package Manager Quick Selector */}
        {showPmSelector && availablePackageManagers && availablePackageManagers.length > 1 && (
          <div className="flex items-center border-l border-[color:var(--accent-on)]/20 bg-[color:var(--accent)]/90 px-1 py-1">
            {availablePackageManagers.map((pm) => (
              <button
                key={pm}
                type="button"
                onClick={(e) => {
                  stop(e);
                  setActivePm(pm);
                  if (action.packageCommands?.[pm]) {
                    void handleRun({
                      ...action,
                      activePackageManager: pm,
                      payload: action.packageCommands[pm]!,
                      label: `复制 ${pm} 命令`,
                    });
                  }
                }}
                className={clsx(
                  "px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors",
                  activePm === pm
                    ? "bg-[color:var(--accent-on)] text-[color:var(--accent)] font-bold shadow-xs"
                    : "text-[color:var(--accent-on)]/80 hover:text-[color:var(--accent-on)] hover:bg-[color:var(--accent-on)]/10",
                )}
                title={`切换至 ${pm} 命令并直接执行`}
              >
                {pm}
              </button>
            ))}
          </div>
        )}

        {/* Secondary Actions Dropdown Trigger */}
        {secondaryActions.length > 0 && (
          <div className="relative" ref={triggerRef}>
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                setDropdownOpen(!dropdownOpen);
              }}
              className={clsx(
                "flex items-center justify-center rounded-r-[var(--radius-control)] border-l border-[color:var(--line-strong)] bg-[color:var(--surface-inset)] px-2.5 py-2 text-[color:var(--text-quiet)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors",
                size === "sm" ? "h-7" : size === "lg" ? "h-10" : "h-9",
              )}
              aria-label="更多操作选项"
              aria-expanded={dropdownOpen}
              aria-haspopup="menu"
            >
              <span className="text-[10px] leading-none">▼</span>
            </button>
          </div>
        )}
      </div>

      {/* Secondary Actions Menu — portalled out of the card's stacking context.
          `onMouseDown` is stopped as well as `onClick`: the card's outside-click
          handlers and its selection marker react to the press, and letting the
          press through would close the menu before the click landed on the item. */}
      {dropdownOpen &&
        secondaryActions.length > 0 &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            data-setup-action-menu
            onMouseDown={stop}
            onClick={stop}
            style={{
              position: "fixed",
              top: menuPos ? `${menuPos.top}px` : undefined,
              left: menuPos ? `${menuPos.left}px` : undefined,
              minWidth: `${MENU_MIN_WIDTH}px`,
              zIndex: MENU_Z,
              // Avoid a first-paint jump from (0,0) to the measured rect: the
              // layout effect normally beats paint, but a fixed menu has no
              // useful default position, so keep it hidden until measured.
              visibility: menuPos ? "visible" : "hidden",
              boxShadow: "0 12px 30px rgba(0,0,0,0.35), 0 0 0 1px var(--line-default)",
            }}
            className="rounded-xl border border-[color:var(--line-strong)] bg-[color:var(--surface-base)] py-1.5"
          >
            <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-[color:var(--text-tertiary)] border-b border-[color:var(--line-subtle)] mb-1">
              其他可用操作
            </div>
            {secondaryActions.map((sec) => (
              <button
                key={sec.id}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  stop(e);
                  void handleRun(sec);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-[color:var(--text-primary)] hover:bg-[color:var(--surface-hover)] flex items-center justify-between gap-2 transition-colors"
              >
                <span>{sec.label}</span>
                <span className="text-[10px] font-mono text-[color:var(--text-tertiary)]">
                  {sec.type}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}

      {/* Prerequisite Guidance Warning */}
      {hasMissingPrereq && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-500/90 font-mono">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span>{prerequisites.warningHint || `环境依赖: ${prerequisites.missingNames.join("、")}`}</span>
        </div>
      )}

      {disabled && disabledReason && (
        <div className="text-[11px] font-mono text-[color:var(--text-quiet)]">
          {disabledReason}
        </div>
      )}
    </div>
  );
}
