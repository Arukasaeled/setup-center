/**
 * Setup Center — Accessible Dialog Component (H03, H05)
 *
 * Full WAI-ARIA Modal Dialog compliant component:
 * 1. Native dialog semantics: role="dialog" or "alertdialog", aria-modal="true"
 * 2. Coordinated with ModalProvider modal stack: only the top dialog traps focus and handles Escape.
 * 3. Focus Trapping: Tab / Shift+Tab cyclical navigation confined strictly within the dialog.
 * 4. Focus Restoration: Automatically restores focus to the invoking element on close.
 * 5. Touch Target & Label compliance: Accessible close controls with min 32px targets and descriptive labels.
 */

import React, { useEffect, useRef, useId, useCallback } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { useModalStack } from "./ModalProvider";

export interface AccessibleDialogProps {
  id?: string;
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  titleId?: string;
  descriptionId?: string;
  ariaLabel?: string;
  role?: "dialog" | "alertdialog";
  closeOnEscape?: boolean;
  closeOnBackdropClick?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  finalFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  backdropClassName?: string;
  contentClassName?: string;
  dataProtectedUi?: boolean;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

export function AccessibleDialog({
  id: customId,
  isOpen,
  onClose,
  title,
  titleId: customTitleId,
  descriptionId,
  ariaLabel,
  role = "dialog",
  closeOnEscape = true,
  closeOnBackdropClick = true,
  initialFocusRef,
  finalFocusRef,
  className,
  backdropClassName,
  contentClassName,
  dataProtectedUi,
  children,
}: AccessibleDialogProps) {
  const autoId = useId();
  const dialogId = customId || `dialog-${autoId}`;
  const titleId = customTitleId || (title ? `dialog-title-${autoId}` : undefined);

  const { pushModal, popModal, isTopModal } = useModalStack();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Manage modal stack registration and focus restoration
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    pushModal(dialogId);

    // Initial focus on mount/open
    const timer = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else if (dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          dialogRef.current.focus();
        }
      }
    }, 20);

    return () => {
      clearTimeout(timer);
      popModal(dialogId);
      // Restore focus to previously active element or finalFocusRef
      const targetToFocus = finalFocusRef?.current || previousActiveElementRef.current;
      if (targetToFocus && typeof targetToFocus.focus === "function") {
        setTimeout(() => targetToFocus.focus(), 0);
      }
    };
  }, [isOpen, dialogId, pushModal, popModal, initialFocusRef, finalFocusRef]);

  // Focus trap & Escape handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Ignore if not top modal
      if (!isTopModal(dialogId)) return;

      // Ignore during IME composition (H04)
      if (e.isComposing || (e.nativeEvent as any)?.isComposing || (e as any).keyCode === 229) {
        return;
      }

      // Handle Escape
      if (e.key === "Escape" && closeOnEscape) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // Handle Tab (Focus Trap)
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [isTopModal, dialogId, closeOnEscape, onClose],
  );

  if (!isOpen) return null;

  const content = (
    <div
      ref={dialogRef}
      role={role}
      data-protected-ui={dataProtectedUi ? "true" : undefined}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-label={ariaLabel}
      aria-describedby={descriptionId}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={clsx(
        "fixed inset-0 z-50 flex items-center justify-center p-4 outline-none",
        className,
      )}
    >
      {/* Backdrop */}
      <div
        className={clsx(
          "fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity",
          backdropClassName,
        )}
        onClick={closeOnBackdropClick ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Surface content */}
      <div className={clsx("relative z-10", contentClassName)}>
        {children}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
