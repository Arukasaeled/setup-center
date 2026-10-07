/**
 * Setup Center — Accessible Keyboard & Hotkey Utilities (H04)
 *
 * Ensures global hotkeys:
 * 1. Safely ignore IME composition (Chinese / Japanese / etc. input methods).
 * 2. Don't fire inside form input elements unless explicitly intended.
 * 3. Don't fire behind active modal dialogs.
 */

import { hasActiveModals } from "../components/ModalProvider";

export interface HotkeyEligibilityOptions {
  allowInInputs?: boolean;
  suppressWhenModalOpen?: boolean;
}

export function isHotkeyAllowed(
  e: KeyboardEvent | React.KeyboardEvent,
  options: HotkeyEligibilityOptions = {},
): boolean {
  // 1. IME composition check (H04)
  if (e.isComposing || (e as any).keyCode === 229 || (e.nativeEvent as any)?.isComposing) {
    return false;
  }

  // 2. Suppress if modal is open (H04)
  if (options.suppressWhenModalOpen && hasActiveModals()) {
    return false;
  }

  // 3. Prevent firing inside active editable inputs
  if (!options.allowInInputs) {
    const target = (e.target as HTMLElement) || null;
    if (target) {
      const tag = target.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target.isContentEditable ||
        Boolean(target.closest("[contenteditable='true']"))
      ) {
        return false;
      }
    }
  }

  return true;
}
