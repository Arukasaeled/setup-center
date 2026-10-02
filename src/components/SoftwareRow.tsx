/**
 * SoftwareRow — one program, as a row in the master list.
 *
 * ## Why a row again, after the card
 *
 * An earlier revision replaced rows with a card grid because the row read as a
 * technician's checklist with no room for a verdict. The grid fixed that but
 * introduced the opposite problem: the software section became its own
 * two-dimensional surface, so clicking a card updated a detail pane *outside*
 * the grid while the grid itself stayed a wall of equal-weight tiles. Picking
 * one of twenty-four tiles is browsing; the brief for this round is a list you
 * scan down and a pane that answers what you landed on.
 *
 * The row keeps what the card got right and drops what it could not afford:
 *
 * | what | card | this row |
 * |---|---|---|
 * | vendor icon | ✓ | ✓ |
 * | name | ✓ | ✓ |
 * | status word | ✓ | ✓ (badge) |
 * | recommendation tier | as its own line | as a short chip, right-aligned |
 * | purpose sentence | 2 clamped lines | the detail pane's job |
 *
 * The purpose sentence is the deliberate omission. In a master-detail layout
 * the pane beside the list exists precisely to say "what is this and why do I
 * care" at full length, and repeating a truncated copy in every row wastes the
 * vertical space that makes scanning twenty-four programs practical.
 *
 * ## States are the same three as before
 *
 * `ok` / `unknown` / `skipped` still come from the same derivation the card
 * used, because the honesty rule has not changed: a program whose probes failed
 * shows 无法确认, and one this tool never offered to install shows 需自行安装
 * rather than a failure mark for something the student never agreed to.
 */

import clsx from "clsx";
import { SoftwareIcon } from "./SoftwareIcon";
import { StatusBadge } from "./StatusBadge";
import { describeSoftware } from "../lib/software";
import type {
  Confidence,
  ExplainedSoftware,
  SoftwareDescriptor,
  SoftwareInfo,
} from "../lib/types";

/** How strongly the capability table asks for a program. */
export type RecommendationTier = "essential" | "recommended" | "optional" | "detectOnly";

const RECOMMENDATION_LABEL: Record<RecommendationTier, string> = {
  essential: "必备",
  recommended: "推荐",
  optional: "可选",
  detectOnly: "仅检测",
};

export function SoftwareRow({
  item,
  catalogue,
  knowledge,
  recommendation,
  selected,
  onClick,
}: {
  item: SoftwareInfo;
  catalogue: SoftwareDescriptor[];
  knowledge: ExplainedSoftware | null;
  recommendation: RecommendationTier;
  selected: boolean;
  onClick: () => void;
}) {
  const descriptor = catalogue.find((d) => d.id === item.id);
  const meta = describeSoftware(item.id, catalogue);
  const name = knowledge?.knowledge.name ?? item.name ?? meta.name;

  // Identical to the card's derivation, and for the same reason: three states
  // that a single `confidence` cannot express.
  const mark: Confidence = item.installed
    ? "ok"
    : item.confidence === "unknown"
      ? "unknown"
      : descriptor && !descriptor.installable
        ? "skipped"
        : item.confidence;

  // The row's one piece of secondary text: the version when we have one. It is
  // the fact that answers "which build am I on", and unlike the purpose it is
  // short enough to belong here rather than in the pane.
  const version = item.installed && item.version ? `v${item.version}` : null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-software-row={item.id}
      className={clsx(
        "group relative flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left",
        "transition-colors duration-150 ease-out",
        selected
          ? "bg-[color:var(--surface-active)]"
          : "hover:bg-[color:var(--surface-hover)]",
      )}
    >
      {/* The selected marker is a left edge rather than a whole-row colour so
          the list keeps a stable reading column when the selection moves. */}
      <span
        aria-hidden
        className={clsx(
          "absolute top-1/2 left-0 h-5 w-[2px] -translate-y-1/2 rounded-full transition-opacity duration-150",
          selected ? "bg-[color:var(--text-strong)] opacity-100" : "opacity-0",
        )}
      />

      <div className="software-row-icon-tray shrink-0 flex items-center justify-center rounded-lg p-0.5 transition-transform group-hover:scale-105">
        <SoftwareIcon id={item.id} size={26} />
      </div>

      <span className="min-w-0 flex-1">
        <span className="software-row-name text-[color:var(--text-primary)] block truncate text-[13px] font-medium">
          {name}
        </span>
        {version && (
          <span className="software-row-version text-[color:var(--text-quiet)] mt-[1px] block truncate text-[11px] font-mono">
            {version}
          </span>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {/* The tier is secondary to the status — it says how strongly the
            capability table asks for the program, not whether it is present.
            Muted so twenty-four rows do not read as twenty-four verdicts. */}
        <span
          data-tier={recommendation}
          className="software-tier-tag text-[color:var(--text-quiet)] text-[10.5px] rounded px-1.5 py-0.5"
        >
          {RECOMMENDATION_LABEL[recommendation]}
        </span>
        <StatusBadge confidence={mark} size="sm" />
      </span>
    </button>
  );
}

/**
 * How strongly the capability table asks for each program.
 *
 * Built once per render from the capability list rather than per row, so a
 * 24-row list does not do 24 × N scans. The key format is produced by Rust
 * (`capability.rs`): `program.{id}` and `onPath.{id}`, where `{id}` is the
 * snake_case `SoftwareId` key — the same string the TypeScript union uses.
 *
 * A program required anywhere outranks one that is only ever a bonus, which is
 * the ordering the tier names promise.
 */
export function recommendationMap(
  capabilities: { requirements: { key: string; necessity: string }[] }[],
): Map<string, RecommendationTier> {
  const byId = new Map<string, RecommendationTier>();

  const rank: Record<RecommendationTier, number> = {
    optional: 0,
    recommended: 1,
    essential: 2,
    detectOnly: 3,
  };

  for (const capability of capabilities) {
    for (const requirement of capability.requirements) {
      const match = /^(?:program|onPath)\.(.+)$/.exec(requirement.key);
      if (!match) continue;
      const id = match[1];
      const tier: RecommendationTier =
        requirement.necessity === "required" ? "essential" : "recommended";

      const current = byId.get(id);
      // Only ever upward: a program required by one capability and merely
      // optional in another is 必备, not 可选.
      if (!current || rank[tier] > rank[current]) byId.set(id, tier);
    }
  }

  return byId;
}
