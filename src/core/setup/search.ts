/**
 * Setup Center — Unified Cross-Category Search Engine
 *
 * Indexes Software, Styles, Resources, Templates, Patterns, and Starter Packs
 * with fuzzy scoring and direct SetupAction resolution for instant execution.
 */

import { RESOURCE_CATALOG } from "../../content/resources";
import { STYLE_REGISTRY } from "../../styles";
import { VaultSync } from "../vault/sync";
import { KID_SOFTWARE_MAP } from "../../lib/softwareMeta";
import { SOFTWARE_IDS } from "../../lib/types";
import { SETUP_COLLECTIONS } from "./collections";
import { resolveSetupAction } from "./resolver";
import type { SetupAction } from "./types";
import { useApp } from "../../lib/store";
import { PersonalCatalog } from "../transfer/catalog";

export interface UnifiedSearchResult {
  id: string;
  name: string;
  category: string;
  type: "software" | "style" | "resource" | "template" | "pattern" | "collection";
  description: string;
  tags?: string[];
  score: number;
  setupAction: SetupAction;
  rawItem: unknown;
}

export function searchUnified(query: string, maxResults: number = 24): UnifiedSearchResult[] {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const results: UnifiedSearchResult[] = [];

  const inventory = useApp.getState().inventory;

  // 1. Index Software
  for (const swId of SOFTWARE_IDS) {
    const meta = KID_SOFTWARE_MAP[swId];
    const name = meta?.nick || swId;
    const desc = meta?.metaphor || "";
    const tags = [swId, meta?.category || "", meta?.badge || ""];

    const score = calculateScore(tokens, name, desc, tags);
    if (!tokens.length || score > 0) {
      const resolved = resolveSetupAction({ type: "software", id: swId, name }, inventory);
      results.push({
        id: swId,
        name,
        category: "系统软件",
        type: "software",
        description: desc,
        tags,
        score,
        setupAction: resolved.primaryAction,
        rawItem: { id: swId, meta },
      });
    }
  }

  // 2. Index Styles
  for (const style of STYLE_REGISTRY) {
    const name = style.name;
    const desc = style.subtitle || style.description;
    const tags = [...(style.tags || []), style.id, style.author || ""];

    const score = calculateScore(tokens, name, desc, tags);
    if (!tokens.length || score > 0) {
      const resolved = resolveSetupAction({ type: "style", data: style }, inventory);
      results.push({
        id: style.id,
        name,
        category: "设计系统风格",
        type: "style",
        description: desc,
        tags,
        score,
        setupAction: resolved.primaryAction,
        rawItem: style,
      });
    }
  }

  // 3. Index Resources
  for (const res of RESOURCE_CATALOG) {
    const name = res.name;
    const desc = res.description;
    const tags = [...(res.tags || []), res.category, res.author || ""];

    const score = calculateScore(tokens, name, desc, tags);
    if (!tokens.length || score > 0) {
      const resolved = resolveSetupAction({ type: "resource", data: res }, inventory);
      results.push({
        id: res.id,
        name,
        category: res.category,
        type: "resource",
        description: desc,
        tags,
        score,
        setupAction: resolved.primaryAction,
        rawItem: res,
      });
    }
  }

  // 4. Index Templates
  for (const tpl of VaultSync.getTemplates()) {
    const name = tpl.name;
    const desc = tpl.description;
    const tags = [...(tpl.tags || []), tpl.category, "template", "scaffold"];

    const score = calculateScore(tokens, name, desc, tags);
    if (!tokens.length || score > 0) {
      const resolved = resolveSetupAction({ type: "template", data: tpl }, inventory);
      results.push({
        id: tpl.id,
        name,
        category: tpl.category || "项目模板",
        type: "template",
        description: desc,
        tags,
        score,
        setupAction: resolved.primaryAction,
        rawItem: tpl,
      });
    }
  }

  // 5. Index Starter Packs / Collections
  for (const col of SETUP_COLLECTIONS) {
    const name = col.title;
    const desc = col.subtitle || col.description;
    const tags = [col.name, col.category, "starter pack", "kit"];

    const score = calculateScore(tokens, name, desc, tags);
    if (!tokens.length || score > 0) {
      results.push({
        id: col.id,
        name,
        category: "Starter Packs",
        type: "collection",
        description: desc,
        tags,
        score,
        setupAction: {
          id: `col-open-${col.id}`,
          type: "open",
          label: "查看套件清单",
          payload: col.id,
          isPrimary: true,
        },
        rawItem: col,
      });
    }
  }

  // 6. Index Personal Catalog items (Saved software, online repos, bookmarked items)
  for (const pItem of PersonalCatalog.getAllItems()) {
    const name = pItem.title;
    const desc = pItem.description || "";
    const tags = [...(pItem.tags || []), pItem.category, pItem.type, "personal"];

    const score = calculateScore(tokens, name, desc, tags);
    if (!tokens.length || score > 0) {
      results.push({
        id: pItem.id,
        name,
        category: pItem.categoryLabel || pItem.category || "个人资产",
        type:
          pItem.type === "software"
            ? "software"
            : pItem.type === "style"
              ? "style"
              : "resource",
        description: desc,
        tags,
        score: score + 15, // slight bonus for user-saved assets
        setupAction: pItem.action
          ? {
              id: pItem.action.id,
              type: pItem.action.type as any,
              label: pItem.action.label,
              payload: pItem.action.payload,
              isPrimary: true,
            }
          : {
              id: `personal-open-${pItem.id}`,
              type: "open",
              label: "查看详情",
              payload: pItem.id,
              isPrimary: true,
            },
        rawItem: pItem,
      });
    }
  }

  // Sort descending by relevance score
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, maxResults);
}

function calculateScore(tokens: string[], name: string, desc: string, tags: string[]): number {
  if (!tokens.length) return 1;

  const n = name.toLowerCase();
  const d = (desc || "").toLowerCase();
  const t = tags.map((s) => (s || "").toLowerCase()).join(" ");

  let totalScore = 0;

  for (const token of tokens) {
    let tokenScore = 0;
    if (n === token) {
      tokenScore += 100;
    } else if (n.startsWith(token)) {
      tokenScore += 50;
    } else if (n.includes(token)) {
      tokenScore += 25;
    }

    if (t.includes(token)) {
      tokenScore += 15;
    }

    if (d.includes(token)) {
      tokenScore += 10;
    }

    if (tokenScore === 0) {
      return 0; // All tokens must match something
    }

    totalScore += tokenScore;
  }

  return totalScore;
}
