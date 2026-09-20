/**
 * Software presentation registry for the frontend.
 *
 * Names, purposes, categories and installability all come from Rust
 * (`software_catalogue`), because a program should be described in exactly one
 * place and the catalog is that place. This module holds only what Rust has no
 * business knowing: presentation concerns, and the client-side rules about
 * which programs need a prerequisite.
 *
 * ## What used to live here
 *
 * A `MARKS` table of two-letter abbreviations (`VS`, `Py`, `Cx`) rendered in the
 * progress rail and the software list. It was removed in favour of
 * [`SoftwareIcon`](../components/SoftwareIcon.tsx), which draws a brand-coloured
 * mark per program: the abbreviations read as placeholder text — "AI 味太重" —
 * rather than as product identity. Icons are now a single component keyed by the
 * same `SoftwareId`, so there is one place a program's visual identity is
 * defined instead of two.
 */

import type { SoftwareDescriptor, SoftwareId } from "./types";

/** What a screen needs to render one program's row. */
export interface SoftwareMeta {
  name: string;
  /** Why a student needs it. */
  purpose: string;
}

/**
 * Describes a program for display.
 *
 * `catalogue` is **required**, not optional, and that is a bug fix rather than a
 * style preference. When it was optional, four screens (`Install`, `Software`,
 * `Choose`, and the action trace) simply omitted it — TypeScript was happy, the
 * code compiled, and every one of them silently rendered the raw id. A student
 * saw `vscode` / `git` / `python` instead of `VS Code` / `Git` / `Python`, with
 * no purpose line at all: exactly the "AI 味太重" impression this product cannot
 * afford, produced by a missing argument that no test noticed.
 *
 * Making the parameter required turns that whole class of mistake into a compile
 * error. The caller must decide *which* catalogue, and the one honest answer is
 * the one in the store.
 *
 * Passing an empty array is still allowed and still falls back to the id — that
 * is the real "catalogue has not loaded yet" state, which is legitimate.
 */
export function describeSoftware(
  id: SoftwareId,
  catalogue: SoftwareDescriptor[],
): SoftwareMeta {
  const entry = catalogue.find((d) => d.id === id);
  return {
    name: entry?.name ?? id,
    purpose: entry?.purpose ?? "",
  };
}

/** Steps that need Node.js to be installed first (npm-based CLIs). */
export const REQUIRES_NODE: SoftwareId[] = [
  "claude_code",
  "codex",
  "gemini",
  "opencode",
  "pnpm",
];

export function needsNode(id: SoftwareId): boolean {
  return REQUIRES_NODE.includes(id);
}
