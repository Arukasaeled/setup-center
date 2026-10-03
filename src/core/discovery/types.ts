/**
 * Setup Center — Unified Discovery Runtime Contract
 *
 * Unifies local catalog search (Software, Resources, Templates, Skills, Patterns, Styles)
 * with remote discovery providers (GitHub Public Search, Winget Finder).
 */

import type { SetupAction } from "../setup/types";

export type DiscoveryItemType =
  | "software"
  | "resource"
  | "repo"
  | "template"
  | "pattern"
  | "skill"
  | "learning"
  | "style";

export type DiscoveryItemHealth = "active" | "quiet" | "archived" | "installed" | "ready";

export interface DiscoveryOrigin {
  type: "builtin" | "github" | "winget" | "vault" | "community";
  url?: string;
  repository?: string;
  author?: string;
  stars?: string | number;
  license?: string;
  language?: string;
  lastUpdated?: string;
  isArchived?: boolean;
  packageId?: string;
  source?: string;
}

export interface DiscoveryItem {
  id: string;
  type: DiscoveryItemType;
  title: string;
  subtitle?: string;
  description: string;
  category: string;
  categoryLabel?: string;
  tags: string[];
  origin?: DiscoveryOrigin;
  action?: SetupAction;
  secondaryActions?: SetupAction[];
  health?: DiscoveryItemHealth;
  installed?: boolean;
  installedVersion?: string;
  isCurated?: boolean;
  raw?: unknown;
}

export interface DiscoveryFilter {
  type?: DiscoveryItemType | "all";
  category?: string | "all";
  searchOnline?: boolean;
  searchWinget?: boolean;
}

export interface DiscoverySearchResult {
  query: string;
  localItems: DiscoveryItem[];
  onlineItems: DiscoveryItem[];
  wingetItems: DiscoveryItem[];
  total: number;
  fromCache?: boolean;
  rateLimited?: boolean;
  rateLimitMessage?: string;
  durationMs: number;
}
