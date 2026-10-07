import type { ReactNode } from "react";
import type { DetailGrammar } from "../styles/types";
import {
  DetailPresenter,
  type DetailPresenterProps,
  resolveDetailPresentation,
  SUPPORTED_DETAIL_MODES,
  DEFERRED_DETAIL_MODES,
} from "./DetailPresenter";

export {
  resolveDetailPresentation,
  SUPPORTED_DETAIL_MODES,
  DEFERRED_DETAIL_MODES,
};

export interface DetailShellProps {
  isOpen: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  tags?: string[];
  actions?: ReactNode;
  children: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  grammar?: DetailGrammar;
}

/**
 * Unified detail overlay shell for Style, Resource, Template and Pattern items.
 *
 * Implements Issue H02:
 * Maps to DetailPresenter which honors the active experience's DetailGrammar
 * (modal, sheet, rail) or renders an honest degradation banner for deferred
 * complex modes (floating-inspector, window, inline, full-page).
 */
export function DetailShell(props: DetailShellProps) {
  return <DetailPresenter {...props} />;
}
