/**
 * SoftwareCard — one program, as a card in the grid.
 *
 * The brief's phase 3 asks for a grid whose cards each carry: 官方图标 · 名称 ·
 * 一句话说明 · 当前状态 · 是否推荐 · 点击展开详情. This file is that card.
 *
 * ## Why a card and not the row that was here before
 *
 * The audit's finding was that a row list of `icon · mark · name · purpose`
 * reads as a technician's checklist. The row was not *wrong*; it was low
 * density in the wrong direction — every program got the same one-line shape
 * whether it was installed, missing, or never managed by this tool at all.
 * A card has room for the verdict (a status word) *and* the reason (a purpose
 * line) *and* the recommendation, so the student can decide from the grid
 * without opening anything.
 *
 * ## "是否推荐" is derived, never invented
 *
 * The brief sketches a ★★★★★ rating. This product's hard rule is that no
 * user-visible claim may be fabricated, and a literal star rating has no data
 * behind it — so the recommendation is computed from the *capability table*
 * that Rust already ships (`capability.rs`), where each capability names the
 * programs it needs and whether each is `required` or `optional`:
 *
 * | tier    | meaning                                                | source            |
 * |---------|--------------------------------------------------------|-------------------|
 * | 必备     | ≥1 capability cannot work without it                    | `necessity: required` |
 * | 推荐     | ≥1 capability lists it as a bonus                       | `necessity: optional` |
 * | 可选     | no capability needs it, but this tool can install it    | neither, `installable` |
 * | 仅检测   | this tool cannot install it at all                      | `!installable`    |
 *
 * That mapping is why the tiers are stated in words rather than stars: "必备"
 * is a fact about the capability table, and five stars would be an opinion.
 *
 * ## `unknown` and `skipped` again
 *
 * The same honesty rule as the row this replaces: a program whose probes failed
 * shows 无法确认 rather than 未安装, and one this tool never offered to install
 * shows 需自行安装 rather than a red cross — the mark must not report a failure
 * the student never agreed to.
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

export function SoftwareCard({
  item,
  catalogue,
  knowledge,
  installed,
  recommendation,
  selected,
  onClick,
}: {
  item: SoftwareInfo;
  /**
   * The full catalog. Required rather than optional — the same reasoning as
   * `describeSoftware`: a missing catalogue renders raw ids (`vscode`) instead
   * of product names, and making it required turns that into a compile error.
   */
  catalogue: SoftwareDescriptor[];
  /** The explanation for this program, or `null` when no knowledge file exists. */
  knowledge: ExplainedSoftware | null;
  /**
   * `null` means the scans have not both returned yet, so the card renders an
   * unresolved state rather than claiming anything.
   */
  installed: boolean | null;
  recommendation: RecommendationTier;
  selected: boolean;
  onClick: () => void;
}) {
  const descriptor = catalogue.find((d) => d.id === item.id);
  const meta = describeSoftware(item.id, catalogue);
  const name = knowledge?.knowledge.name ?? item.name ?? meta.name;

  // The knowledge file's own purpose wins when it has one: it is written for a
  // student and is editable without a rebuild. Falls back to the catalog's
  // purpose, so a missing knowledge file degrades instead of blanking the card.
  const purpose =
    knowledge && knowledge.knowledge.purposes.length > 0
      ? knowledge.knowledge.purposes[0]
      : meta.purpose;

  // Three states that a single `confidence` cannot express, exactly as on the
  // row this replaced: this tool *manages* an absent program (✓ actionable gap)
  // versus only *detects* it (nothing is wrong) versus could not tell at all.
  const mark: Confidence =
    item.installed
      ? "ok"
      : item.confidence === "unknown"
        ? "unknown"
        : descriptor && !descriptor.installable
          ? "skipped"
          : item.confidence;

  // The second line: the version when present, otherwise the reason to care.
  // A card showing "未安装" with no purpose tells a student nothing they can
  // act on; knowing it is "代码版本管理与下载" is what lets them decide.
  const detail = item.installed
    ? item.version
      ? `版本 ${item.version}${item.onPath ? " · 命令行可用" : ""}`
      : purpose
    : item.confidence === "unknown"
      ? "检测未完成，无法判断"
      : purpose;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        "group relative flex flex-col items-start gap-2.5 rounded-[12px] border p-3.5 text-left",
        "transition-[background-color,border-color,transform] duration-150 ease-out",
        "active:translate-y-[0.5px]",
        selected
          ? "border-[color:var(--line-strong)] bg-[color:var(--surface-active)]"
          : "border-[color:var(--line-subtle)] hover:border-[color:var(--line-default)] hover:bg-[color:var(--surface-hover)]",
        // Unresolved is drawn muted rather than hidden: the program exists in
        // the catalog either way, and a card that appears after a delay reads
        // as a loading glitch.
        installed === null && "opacity-55",
      )}
    >
      <span className="flex w-full items-start gap-3">
        <SoftwareIcon id={item.id} size={34} />

        <span className="min-w-0 flex-1">
          <span className="text-[color:var(--text-primary)] block truncate text-[13.5px] font-medium">
            {name}
          </span>
          <span className="text-[color:var(--text-quiet)] mt-0.5 block text-[11.5px]">
            {RECOMMENDATION_LABEL[recommendation]}
          </span>
        </span>
      </span>

      <span className="text-[color:var(--text-tertiary)] line-clamp-2 min-h-[32px] w-full text-[12px] leading-relaxed">
        {detail}
      </span>

      <span className="flex w-full items-center justify-between gap-2">
        <StatusBadge confidence={mark} size="sm" />
        {/* The affordance that says "this opens something". A card that only
            looks hoverable is the classic grid complaint. */}
        <span className="text-[color:var(--text-quiet)] text-[11px] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          查看详情
        </span>
      </span>
    </button>
  );
}

/**
 * How strongly the capability table asks for each program.
 *
 * Built once per render from the capability list rather than per card, so a
 * 24-card grid does not do 24 × N scans. The key format is produced by Rust
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
