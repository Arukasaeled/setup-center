/**
 * Setup Center — Bundled Offline Vault Snapshot
 *
 * Implements Issue D14:
 * Provides a 100% complete, verified offline baseline snapshot for clean
 * installs with no network connectivity or when remote releases are unreachable.
 *
 * Aggregates:
 * - 14 design system styles with full metadata and scoped CSS
 * - Curated resource catalog (172 items)
 * - 28 scaffolding templates
 * - 34 UI patterns
 * - 21 developer and agent skills
 */

import type { CachedVaultData, VaultManifest } from "./types";
import { BUNDLED_STYLES } from "./baseline/styles";
import { RESOURCE_CATALOG } from "../../content/resources";
import { BUNDLED_TEMPLATES } from "./baseline/templates";
import { BUNDLED_PATTERNS } from "./baseline/patterns";
import { BUNDLED_SKILLS } from "./baseline/skills";

export const BUNDLED_CONTENT_VERSION = "2026.10.04.2-bundled";

export const BUNDLED_MANIFEST: VaultManifest = {
  schemaVersion: "1.0.0",
  contentVersion: BUNDLED_CONTENT_VERSION,
  name: "Setup Center Bundled Offline Vault Snapshot",
  description:
    "Embedded offline baseline vault snapshot holding built-in developer tools, design systems, templates, patterns, skills, and creative resources.",
  updatedAt: "2026-10-04T03:13:10Z",
  maintainer: "Arukasaeled",
  repository: "https://github.com/Arukasaeled/setup-center-vault",
  collections: {
    styles: {
      version: "1.0.0",
      count: Object.keys(BUNDLED_STYLES).length,
      items: Object.values(BUNDLED_STYLES).map((s) => ({
        id: s.id,
        name: s.name,
        path: `styles/${s.id}/manifest.json`,
        cssPath: s.cssPath,
        updatedAt: s.updatedAt,
      })),
    },
    resources: {
      version: "1.0.0",
      count: RESOURCE_CATALOG.length,
    },
    templates: {
      version: "1.0.0",
      count: BUNDLED_TEMPLATES.length,
      items: BUNDLED_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        path: `templates/${t.id.replace(/^tpl:/, "")}/template.json`,
        updatedAt: t.updatedAt,
      })),
    },
    patterns: {
      version: "1.0.0",
      count: BUNDLED_PATTERNS.length,
      items: BUNDLED_PATTERNS.map((p) => ({
        id: p.id,
        name: p.name,
        path: `patterns/${p.id.replace(/^pat:/, "")}/pattern.json`,
        updatedAt: p.updatedAt,
      })),
    },
    skills: {
      version: "1.0.0",
      count: BUNDLED_SKILLS.length,
      items: BUNDLED_SKILLS.map((sk) => ({
        id: sk.id,
        name: sk.name,
        path: `skills/${sk.id.replace(/^skill:/, "")}.json`,
        updatedAt: sk.updatedAt,
      })),
    },
  },
};

export const BUNDLED_VAULT_SNAPSHOT: CachedVaultData = {
  manifest: BUNDLED_MANIFEST,
  syncedAt: "2026-10-04T03:13:10Z",
  styles: BUNDLED_STYLES,
  resources: RESOURCE_CATALOG as unknown as Array<Record<string, unknown>>,
  templates: BUNDLED_TEMPLATES,
  patterns: BUNDLED_PATTERNS,
  skills: BUNDLED_SKILLS,
};

/**
 * Returns an immutable deep clone of the bundled snapshot to prevent
 * accidental in-memory mutations.
 */
export function getBundledSnapshot(): CachedVaultData {
  return JSON.parse(JSON.stringify(BUNDLED_VAULT_SNAPSHOT)) as CachedVaultData;
}
