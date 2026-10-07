/**
 * Setup Center — Modal Stack & Accessibility Coordination Provider
 *
 * Implements authoritative modal stack management (H03, H04):
 * 1. Coordinates nested & concurrent dialogs in a stack-based order.
 * 2. Identifies the topmost active dialog so only the top modal traps focus
 *    and responds to keyboard events (Escape).
 * 3. Provides global inquiry into whether any modal is open to suppress conflicting
 *    global shortcuts (e.g. Ctrl+K) or IME compositions.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";

export interface ModalContextValue {
  modalStack: string[];
  pushModal: (id: string) => void;
  popModal: (id: string) => void;
  isTopModal: (id: string) => boolean;
  hasOpenModal: boolean;
  topModalId: string | null;
}

const ModalContext = createContext<ModalContextValue | null>(null);

// Static active modal tracker for non-React callbacks (e.g. global window hotkeys)
let globalActiveModalCount = 0;
export function hasActiveModals(): boolean {
  return globalActiveModalCount > 0;
}

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [modalStack, setModalStack] = useState<string[]>([]);

  const pushModal = useCallback((id: string) => {
    setModalStack((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      globalActiveModalCount = next.length;
      return next;
    });
  }, []);

  const popModal = useCallback((id: string) => {
    setModalStack((prev) => {
      const next = prev.filter((m) => m !== id);
      globalActiveModalCount = next.length;
      return next;
    });
  }, []);

  const isTopModal = useCallback(
    (id: string) => {
      if (modalStack.length === 0) return false;
      return modalStack[modalStack.length - 1] === id;
    },
    [modalStack],
  );

  const hasOpenModal = modalStack.length > 0;
  const topModalId = modalStack.length > 0 ? modalStack[modalStack.length - 1] : null;

  // Prevent background scrolling when any modal is open
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (hasOpenModal) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [hasOpenModal]);

  const value = useMemo(
    () => ({
      modalStack,
      pushModal,
      popModal,
      isTopModal,
      hasOpenModal,
      topModalId,
    }),
    [modalStack, pushModal, popModal, isTopModal, hasOpenModal, topModalId],
  );

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModalStack(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    return {
      modalStack: [],
      pushModal: () => {},
      popModal: () => {},
      isTopModal: () => true,
      hasOpenModal: false,
      topModalId: null,
    };
  }
  return ctx;
}
