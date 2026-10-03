/**
 * ExperienceSpecimen — a miniature of the product, painted from one experience's
 * resolved tokens and grammar.
 *
 * ## Why this is not a screenshot or an iframe
 *
 * The Style Gallery used to show three colour dots, which is a database row
 * pretending to be a design gallery: it can only ever communicate "which hues",
 * never "what this product becomes". The gallery needs to show the *composition*
 * and the token playground needs to show a *live* response to a radius slider —
 * and neither can afford to re-theme the whole app to do it.
 *
 * An iframe would give perfect fidelity but a second document, so it could not
 * share the user's in-flight (unsaved) token values. Instead the specimen reads
 * the same variable table the document root does — [`computeRuntimeVars`] — and
 * arranges itself from the same grammar enum the shell reads. So the radius in
 * the specimen and the radius in the app cannot disagree, because there is one
 * table and one enum behind both.
 *
 * The specimen is deliberately honest about its scope: it is a *token and
 * grammar* specimen, not a pixel clone of the page. A per-style stylesheet's
 * bespoke ornament (a pinstripe texture, a scanline overlay) is the style's own
 * business and shows up when the experience is applied or previewed live.
 */

import { useMemo } from "react";
import clsx from "clsx";
import type { SetupStyle, TokenOverrides } from "../styles/types";
import {
  CARD_LABEL,
  computeRuntimeVars,
  DENSITY_LABEL,
  DETAIL_LABEL,
  NAV_LABEL,
  resolveExperienceProfile,
  resolveTokens,
  SHELL_LABEL,
  TIER_SHORT,
} from "../styles/runtime";

type Scale = "mini" | "full";

interface SpecimenProps {
  style: SetupStyle;
  overrides?: TokenOverrides;
  scale?: Scale;
  className?: string;
  /** Dims the specimen's own chrome when it is used as a gallery thumbnail. */
  quiet?: boolean;
}

const COMPOSITION_COLUMNS: Record<string, number> = {
  "solid-grid": 3,
  "magazine-index": 1,
  "character-list": 1,
  "finder-list": 2,
  "floating-panels": 2,
  "news-columns": 2,
  "drafting-index": 2,
  "poster-wall": 2,
  roadmap: 1,
  ledger: 1,
};

/** How each card grammar wants to be shaped, before the style CSS weighs in. */
const CARD_STYLE: Record<string, React.CSSProperties> = {
  panel: {},
  "flat-row": { display: "flex", alignItems: "center", gap: "0.5em", minHeight: "0" },
  "editorial-block": { borderTopWidth: "2px", borderTopStyle: "solid", paddingLeft: "0" },
  poster: { transform: "rotate(-1.4deg)" },
  "terminal-line": { fontFamily: "var(--font-mono, monospace)", borderRadius: "0" },
  window: { borderTopWidth: "0.55em" },
  tile: { aspectRatio: "1 / 1", display: "flex", flexDirection: "column", justifyContent: "flex-end" },
  "index-entry": { borderWidth: "0", borderBottomWidth: "1px", borderRadius: "0" },
  "floating-surface": { transform: "translateY(-2px)" },
  "borderless-group": { borderWidth: "0", background: "transparent" },
  sticker: { transform: "rotate(1.8deg)" },
};

export function ExperienceSpecimen({
  style,
  overrides = {},
  scale = "full",
  className,
  quiet = false,
}: SpecimenProps) {
  const profile = useMemo(() => resolveExperienceProfile(style), [style]);
  const tokens = useMemo(() => resolveTokens(style, overrides), [style, overrides]);
  const vars = useMemo(() => computeRuntimeVars(tokens), [tokens]);

  const navigation = profile.navigation ?? "sidebar";
  const detail = profile.detail ?? "rail";
  const card = profile.card ?? "panel";
  const composition = profile.composition ?? "solid-grid";

  const mini = scale === "mini";
  const rowCount = mini ? 4 : 6;
  const rows = Array.from({ length: rowCount });
  const columns = COMPOSITION_COLUMNS[composition] ?? 3;

  // The specimen reads the tokens through its own inline variable table, so the
  // preview responds to unsaved slider values without touching the app.
  const surface = vars["--surface-raised"];
  const radiusPanel = vars["--radius-panel"];
  const radiusControl = vars["--radius-control"];
  const borderWidth = vars["--border-width"];
  const accent = vars["--status-accent"];
  const shadow = vars["--shadow-hard"];
  const text = vars["--text-primary"];
  const densityGap = vars["--density-gap"];
  const densityPad = vars["--density-pad"];

  const navLabel = [style.name, `${TIER_SHORT[profile.tier]}`, DENSITY_LABEL[tokens.density]]
    .filter(Boolean)
    .join(" · ");

  const isStripNav = navigation === "sidebar" || navigation === "dock";
  const navAtBottom = navigation === "dock";

  const nav = (
    <div
      className={clsx("flex items-center", navAtBottom ? "justify-center" : "flex-col items-stretch")}
      style={{
        gap: navAtBottom ? "0.4em" : "0.28em",
        padding: navAtBottom ? "0.35em 0.5em" : "0.5em 0.45em",
        borderRight: isStripNav && !navAtBottom ? `${borderWidth} solid ${accent}` : undefined,
        borderTop: navAtBottom ? `${borderWidth} solid ${accent}` : undefined,
        borderBottom:
          navigation === "topbar" || navigation === "tab-strip" || navigation === "menu-bar"
            ? `${borderWidth} solid ${accent}`
            : undefined,
        background: navigation === "menu-bar" || navigation === "command-bar" ? text : "transparent",
        color: navigation === "menu-bar" || navigation === "command-bar" ? surface : undefined,
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: "0.62em",
          letterSpacing: "0.04em",
          textTransform: navigation === "menu-bar" ? "uppercase" : undefined,
        }}
      >
        {navigation === "menu-bar" ? `文件  编辑  视图   ${style.name}` : style.name}
      </span>
      {rows.slice(0, mini ? 3 : 4).map((_, i) => (
        <span
          key={i}
          style={{
            fontSize: "0.56em",
            padding: navigation === "dock" ? "0.2em 0.5em" : "0.22em 0.4em",
            borderRadius: navigation === "dock" ? radiusControl : "0",
            background: i === 0 ? accent : "transparent",
            color: i === 0 ? (navigation === "menu-bar" ? text : surface) : "inherit",
            opacity: i === 0 ? 1 : 0.62,
            whiteSpace: "nowrap",
          }}
        >
          {["概览", "软件", "资源", "风格"][i]}
        </span>
      ))}
    </div>
  );

  const cardBlock = (i: number) => (
    <div
      key={i}
      style={{
        background: card === "borderless-group" ? "transparent" : surface,
        border: `${borderWidth} solid ${accent}`,
        borderRadius: radiusPanel,
        boxShadow: shadow,
        padding: `calc(${densityPad} * 0.5)`,
        display: "flex",
        flexDirection: "column",
        gap: "0.3em",
        minWidth: 0,
        ...(CARD_STYLE[card] ?? {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4em" }}>
        <span style={{ fontWeight: 700, fontSize: "0.62em", whiteSpace: "nowrap", overflow: "hidden" }}>
          {["Ollama", "shadcn/ui", "Zed", "Cursor", "Bun", "Awwwards"][i % 6]}
        </span>
        {card !== "terminal-line" && (
          <span
            style={{
              fontSize: "0.5em",
              padding: "0.1em 0.4em",
              borderRadius: card === "sticker" ? "0.7em" : radiusControl,
              background: accent,
              color: surface,
              whiteSpace: "nowrap",
            }}
          >
            {["安装", "复制", "Clone", "打开"][i % 4]}
          </span>
        )}
      </div>
      {card !== "flat-row" && card !== "terminal-line" && card !== "index-entry" && (
        <span style={{ fontSize: "0.5em", opacity: 0.55, lineHeight: 1.5 }}>
          本地推理运行时 · 一条命令完成安装与模型拉取
        </span>
      )}
      {card === "window" && (
        <span style={{ fontSize: "0.46em", opacity: 0.45 }}>— 单击此处展开窗口内容 —</span>
      )}
    </div>
  );

  const content = (
    <div
      className="min-w-0 flex-1"
      style={{ padding: `calc(${densityPad} * 0.55)`, display: "flex", flexDirection: "column", gap: densityGap }}
    >
      {/* Page header slot: every experience keeps it, but not every one frames it. */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.5em",
          borderBottom:
            composition === "magazine-index" || composition === "news-columns"
              ? `2px solid ${text}`
              : undefined,
          paddingBottom: "0.3em",
        }}
      >
        <span style={{ fontWeight: 800, fontSize: `calc(0.85em * ${vars["--type-heading-scale"]})` }}>
          {composition === "news-columns" ? "SETUP CENTER 日报" : "开发资源索引"}
        </span>
        <span style={{ fontSize: "0.5em", opacity: 0.5, marginLeft: "auto" }}>
          {tokens.density === "compact" ? "128 条" : "128 条 · 已同步"}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: densityGap,
        }}
      >
        {rows.slice(0, columns === 1 ? (mini ? 3 : 5) : columns * (mini ? 1 : 2)).map((_, i) => cardBlock(i))}
      </div>

      {/* Toolbar slot: an input and the primary control, which is where the
          accent token proves whether it actually reaches the UI. */}
      <div style={{ display: "flex", gap: "0.4em", alignItems: "center", marginTop: "auto" }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            border: `${borderWidth} solid ${accent}`,
            borderRadius: radiusControl,
            padding: "0.25em 0.45em",
            fontSize: "0.52em",
            opacity: 0.7,
            background: surface,
          }}
        >
          搜索资源、软件、模板…
        </div>
        <div
          style={{
            background: accent,
            color: surface,
            borderRadius: radiusControl,
            padding: "0.28em 0.7em",
            fontSize: "0.54em",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          立即应用
        </div>
      </div>
    </div>
  );

  const detailStrip = (
    <div
      style={{
        width: detail === "rail" ? "28%" : "100%",
        borderLeft: detail === "rail" ? `${borderWidth} solid ${accent}` : undefined,
        borderTop: detail === "rail" ? undefined : `${borderWidth} solid ${accent}`,
        padding: `calc(${densityPad} * 0.45)`,
        display: "flex",
        flexDirection: "column",
        gap: "0.3em",
        fontSize: "0.5em",
        background: detail === "floating-inspector" ? surface : "transparent",
        boxShadow: detail === "floating-inspector" ? shadow : undefined,
        borderRadius: detail === "floating-inspector" ? radiusPanel : undefined,
        transform: detail === "floating-inspector" ? "translateY(-2%)" : undefined,
      }}
    >
      <span style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.5 }}>
        {detail === "window" ? "详情窗口" : detail === "sheet" ? "抽屉详情" : "详情"}
      </span>
      <span style={{ opacity: 0.6, lineHeight: 1.5 }}>选中项的展开说明与主操作。</span>
      <span style={{ marginTop: "auto", color: accent, fontWeight: 700 }}>主操作 →</span>
    </div>
  );

  return (
    <div
      data-specimen={style.id}
      data-specimen-card={card}
      data-specimen-composition={composition}
      className={clsx("overflow-hidden", className)}
      style={{
        ...(vars as unknown as React.CSSProperties),
        display: "flex",
        flexDirection: navAtBottom ? "column" : "row",
        background: "var(--surface-inset, #101317)",
        color: text,
        fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
        lineHeight: 1.45,
        position: "relative",
      }}
    >
      {!quiet && (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 6,
            fontSize: "0.44em",
            letterSpacing: "0.06em",
            opacity: 0.4,
            pointerEvents: "none",
          }}
        >
          {navLabel}
        </span>
      )}
      {nav}
      {detail === "rail" ? (
        <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
          {content}
          {detailStrip}
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, minWidth: 0, flexDirection: "column" }}>
          {content}
          {detailStrip}
        </div>
      )}
    </div>
  );
}

/** The gallery thumbnail: same spec menu, small budget. */
export function ExperienceThumbnail({
  style,
  className,
}: {
  style: SetupStyle;
  className?: string;
}) {
  return (
    <ExperienceSpecimen
      style={style}
      scale="mini"
      quiet
      className={clsx("h-[104px] w-full text-[13px]", className)}
    />
  );
}

/** A one-line description of what an experience actually changes. */
export function describeGrammar(style: SetupStyle): string {
  const p = resolveExperienceProfile(style);
  const parts = [
    SHELL_LABEL[p.shell ?? "sidebar"],
    NAV_LABEL[p.navigation ?? "sidebar"],
    DETAIL_LABEL[p.detail ?? "rail"],
    CARD_LABEL[p.card ?? "panel"],
  ].map((s) => s ?? "—");
  return parts.join(" / ");
}

