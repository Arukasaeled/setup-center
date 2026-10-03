/**
 * Setup Center — Unified Cross-Category Search Engine
 *
 * Backed by DiscoveryService / LocalSearchIndex for single runtime truth.
 * Software, Styles, Resources, Templates, Patterns, and Starter Packs
 * resolve actionable SetupActions through resolveSetupAction.
 */

import { DiscoveryService } from "../discovery/service";
import type { SetupAction } from "./types";

export interface UnifiedSearchResult {
  id: string;
  name: string;
  category: string;
  type: "software" | "style" | "resource" | "template" | "pattern" | "collection" | "skill" | "learning";
  description: string;
  tags?: string[];
  score: number;
  setupAction: SetupAction;
  rawItem: unknown;
}

export function searchUnified(query: string, maxResults: number = 24): UnifiedSearchResult[] {
  const items = DiscoveryService.searchLocal(query, undefined, maxResults);
  return items.map((item, idx) => ({
    id: item.id,
    name: item.title,
    category: item.categoryLabel || item.category,
    type: item.type as any,
    description: item.description,
    tags: item.tags,
    score: 100 - idx,
    setupAction: item.action!,
    rawItem: item.raw || item,
  }));
}
