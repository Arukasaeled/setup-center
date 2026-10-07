/**
 * Setup Center — Content Canonical ID & Alias Mapping System
 *
 * Implements Issue D11:
 * Unifies fragmented ID representations across local catalogs, remote Vault releases,
 * user bookmarks, and transfer history.
 *
 * Canonical format conventions:
 * - Software:    sw:<slug>
 * - Styles:      style:<slug>
 * - Resources:   res:<slug>
 * - Templates:   tpl:<slug>
 * - Patterns:    pat:<slug>
 * - Skills:      skill:<slug>
 * - Collections: col:<slug>
 */

import type { ContentType } from "./types";

/**
 * Historical or hardcoded alias remappings where legacy items were renamed
 */
export const KNOWN_ID_ALIASES: Record<string, string> = {
  // Legacy bare resource IDs to canonical
  "shadcn-ui": "res:shadcn-ui",
  "magic-ui": "res:magic-ui",
  "tailwind-css": "res:tailwind-css",
  "lucide-icons": "res:lucide-icons",
  "framer-motion": "res:framer-motion",
  "threejs": "res:threejs",
  "zustand": "res:zustand",
  // Legacy template IDs
  "tauri-v2-react": "tpl:tauri-v2-react",
  "create-t3-app": "tpl:create-t3-app",
  "rust-cli-starter": "tpl:rust-cli-starter",
  "python-uv-fastapi": "tpl:python-uv-fastapi",
};

/**
 * Normalizes an arbitrary ID to its canonical prefixed representation.
 */
export function canonicalizeId(rawId: string, inferredType?: ContentType): string {
  if (!rawId || typeof rawId !== "string") return "";
  const trimmed = rawId.trim();

  // 1. Direct match in known aliases table
  if (KNOWN_ID_ALIASES[trimmed]) {
    return KNOWN_ID_ALIASES[trimmed];
  }

  // 2. Already canonical prefix
  if (
    trimmed.startsWith("sw:") ||
    trimmed.startsWith("style:") ||
    trimmed.startsWith("res:") ||
    trimmed.startsWith("tpl:") ||
    trimmed.startsWith("pat:") ||
    trimmed.startsWith("skill:") ||
    trimmed.startsWith("col:")
  ) {
    return trimmed;
  }

  // 3. Alternative prefix migration
  if (trimmed.startsWith("resource:")) {
    return `res:${trimmed.slice("resource:".length)}`;
  }
  if (trimmed.startsWith("template:")) {
    return `tpl:${trimmed.slice("template:".length)}`;
  }
  if (trimmed.startsWith("pattern:")) {
    return `pat:${trimmed.slice("pattern:".length)}`;
  }
  if (trimmed.startsWith("collection:")) {
    return `col:${trimmed.slice("collection:".length)}`;
  }

  // 4. Inferred type prefix
  if (inferredType) {
    switch (inferredType) {
      case "software":
        return `sw:${trimmed}`;
      case "style":
        return `style:${trimmed}`;
      case "resource":
        return `res:${trimmed}`;
      case "template":
        return `tpl:${trimmed}`;
      case "pattern":
        return `pat:${trimmed}`;
      case "skill":
        return `skill:${trimmed}`;
      default:
        break;
    }
  }

  return trimmed;
}

/**
 * Strips known type prefixes from an ID, returning the pure item slug.
 */
export function stripIdPrefix(id: string): string {
  if (!id || typeof id !== "string") return "";
  return id
    .replace(/^(sw|style|res|resource|tpl|template|pat|pattern|skill|col|collection):/, "")
    .trim();
}

/**
 * Checks if two IDs refer to the same logical content item,
 * taking aliases and prefix conventions into account.
 */
export function isSameContentId(idA: string, idB: string): boolean {
  if (!idA || !idB) return false;
  if (idA === idB) return true;

  const canonicalA = canonicalizeId(idA);
  const canonicalB = canonicalizeId(idB);
  if (canonicalA === canonicalB) return true;

  // Compare bare slugs if both share the same inferred namespace or lack prefix
  const slugA = stripIdPrefix(idA);
  const slugB = stripIdPrefix(idB);
  return slugA.length > 0 && slugA === slugB;
}
