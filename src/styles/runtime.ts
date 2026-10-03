/**
 * Setup Center — Experience Runtime
 *
 * The one place that turns an experience manifest plus a user's token overrides
 * into (a) CSS custom properties on `<html>` and (b) a set of data attributes
 * that describe the app's grammar.
 *
 * ## Resolution order (the override layer)
 *
 * ```
 *   1. base defaults (this file)            — structural fallbacks
 *   2. legacy manifest.tokens               — pre-Experience manifests
 *   3. experience.tokens                    — the experience's own defaults
 *   4. user overrides                       — what the user tuned
 * ```
 *
 * Later wins. Rule 4 is applied with `setProperty(name, value, "important")`,
 * which is deliberate: an inline `!important` declaration outranks an author
 * `!important` declaration, so a user override beats even a stylesheet rule
 * that used `!important`. That single decision is what makes the tweaker
 * authoritative instead of decorative — every previous "the slider does
 * nothing" complaint traces back to writing a variable that no rule read, or
 * reading a variable that a `!important` rule had already beaten.
 *
 * ## Why the tokens are written as variables rather than as a stylesheet
 *
 * Styles are discovered by glob at build time; a user's override is runtime
 * state. Only variables can bridge the two without regenerating CSS.
 */

import type {
  CardGrammar,
  CompositionGrammar,
  CustomExperience,
  DensityGrammar,
  DetailGrammar,
  ExperienceProfile,
  ExperienceTokens,
  MotionGrammar,
  NavigationGrammar,
  OrnamentGrammar,
  SetupStyle,
  ShadowTokens,
  ShellGrammar,
  StyleId,
  TokenKey,
  TokenOverrides,
} from "./types";
import { getStyle, STYLE_REGISTRY } from "./registry";

// ---------------------------------------------------------------------------
// Runtime defaults
// ---------------------------------------------------------------------------

export const BASE_TOKENS: ExperienceTokens = {
  panelRadius: "18px",
  controlRadius: "10px",
  borderWidth: "1px",
  shadow: { offsetX: "0px", offsetY: "18px", blur: "48px", spread: "-18px", color: "rgba(0,0,0,0.75)" },
  accent: "#6ee7d0",
  accentSecondary: "#3d9c8b",
  surface: "#14171c",
  text: "#e4e7eb",
  density: "normal",
  headingScale: 1,
  bodyScale: 1,
  motion: "normal",
};

export const DEFAULT_EXPERIENCE: Required<
  Pick<
    ExperienceProfile,
    "tier" | "shell" | "navigation" | "detail" | "card" | "composition" | "density" | "motion"
  >
> = {
  tier: "component",
  shell: "sidebar",
  navigation: "sidebar",
  detail: "rail",
  card: "panel",
  composition: "solid-grid",
  density: "normal",
  motion: "normal",
};

export const TIER_LABEL: Record<string, string> = {
  token: "Tier 1 · 色彩主题",
  component: "Tier 2 · 组件主题",
  composition: "Tier 3 · 版式主题",
  experience: "Tier 4 · 完整体验",
};

export const TIER_SHORT: Record<string, string> = {
  token: "T1",
  component: "T2",
  composition: "T3",
  experience: "T4",
};

/**
 * The capability level this build can render. A manifest declaring a
 * `runtimeCapability` string sorts lexicographically higher than this is refused
 * with "需要更新应用" rather than rendered as a broken page.
 */
export const EXPERIENCE_RUNTIME_CAPABILITY = "1.0.0";

// ---------------------------------------------------------------------------
// Grammar labels
// ---------------------------------------------------------------------------
//
// These live here rather than beside any one consumer because three surfaces
// need the same words for the same enum: the specimen, the Setup Action
// resolver (which describes an experience's shell in the Apply tooltip), and
// the gallery card. Three copies of "程序坞外壳" would drift.

export const SHELL_LABEL: Record<ShellGrammar, string> = {
  sidebar: "侧边栏外壳",
  topbar: "顶栏外壳",
  dock: "程序坞外壳",
  "dual-pane": "双栏外壳",
  windowed: "窗口外壳",
  "command-centered": "命令中心外壳",
  editorial: "编辑版式外壳",
  canvas: "画布外壳",
  stacked: "堆叠外壳",
};

export const NAV_LABEL: Record<NavigationGrammar, string> = {
  sidebar: "侧边导航",
  topbar: "顶部导航",
  dock: "程序坞",
  "tab-strip": "标签条",
  "command-bar": "命令栏",
  "menu-bar": "菜单栏",
  "keyboard-menu": "键盘菜单",
};

export const DETAIL_LABEL: Record<DetailGrammar, string> = {
  rail: "右栏详情",
  modal: "模态详情",
  sheet: "抽屉详情",
  "floating-inspector": "浮动检查器",
  window: "窗口详情",
  inline: "行内展开",
  "full-page": "整页详情",
};

export const CARD_LABEL: Record<CardGrammar, string> = {
  panel: "面板卡",
  "flat-row": "平铺行",
  "editorial-block": "编辑块",
  poster: "海报卡",
  "terminal-line": "终端行",
  window: "窗口卡",
  tile: "磁贴",
  "index-entry": "索引条目",
  "floating-surface": "浮面卡",
  "borderless-group": "无框组",
  sticker: "贴纸卡",
};

export const COMPOSITION_LABEL: Record<CompositionGrammar, string> = {
  "solid-grid": "实体网格",
  "magazine-index": "杂志索引",
  "character-list": "字符列表",
  "finder-list": "文件列表",
  "floating-panels": "浮动面板",
  "news-columns": "多栏版面",
  "drafting-index": "图纸索引",
  "poster-wall": "海报墙",
  roadmap: "路线图",
  ledger: "账册",
};

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

/**
 * Split a finished CSS box-shadow string back into its parts.
 *
 * The bare `0` case is not pedantry: `0 2px 10px rgba(...)` is what every
 * conventional shadow writes, and a regex that insists on a unit misses it,
 * which shifts every following slot by one and pushes the leftover `0` into the
 * colour string. The composed value then reads `2px 10px 0px 0px 0 rgba(...)`,
 * which the browser discards in full, so `box-shadow: var(--shadow-hard)`
 * silently painted nothing.
 *
 * Lengths are read as the leading run, which is the idiomatic CSS form
 * (`[inset] <offset-x> <offset-y> [blur] [spread] [colour]`); the remainder is
 * taken verbatim as the colour so `rgba(0,0,0,.6)` survives intact.
 */
export function parseShadow(raw: string | undefined): Partial<ShadowTokens> | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "none") {
    return { offsetX: "0px", offsetY: "0px", blur: "0px", spread: "0px", color: "transparent" };
  }

  // `inset` is a keyword, not a length or a colour, and it may sit at either
  // end. It cannot occur inside a colour literal, so a word-boundary strip is
  // safe.
  const inset = /\binset\b/i.test(trimmed);
  let rest = trimmed.replace(/\binset\b/gi, " ").trim();

  const lengths: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const match = rest.match(/^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vh|vw|ch|ex)(?![a-z%])/i) ?? rest.match(/^0(?![\d.])/);
    if (!match) break;
    // Normalise a bare `0` to `0px` so the zero-collapse check below — and any
    // consumer comparing against the literal `"0px"` — stays true.
    lengths.push(match[0] === "0" ? "0px" : match[0]);
    rest = rest.slice(match[0].length).trim();
  }

  const [offsetX = "0px", offsetY = "0px", blur = "0px", spread = "0px"] = lengths;
  const parsed: Partial<ShadowTokens> = {
    offsetX,
    offsetY,
    blur,
    spread,
    color: rest || "rgba(0,0,0,0.5)",
  };
  if (inset) parsed.inset = true;
  return parsed;
}

/** Compose the parts back into a CSS box-shadow value. */
export function composeShadow(s: ShadowTokens): string {
  const lengths = [s.offsetX, s.offsetY, s.blur, s.spread];
  const allZero = lengths.every((value) => value === "0px" || value === "0");
  // An inset shadow with no offset, blur or spread still paints nothing, but
  // collapsing it to `none` would drop the declaration the manifest declared;
  // only the non-inset case is safe to elide.
  if (allZero && !s.inset) return "none";
  return `${s.inset ? "inset " : ""}${lengths.join(" ")} ${s.color}`;
}

/**
 * Normalise any manifest — including one written against the old contract —
 * into a complete `ExperienceProfile`.
 *
 * A legacy manifest has no `experience`, so it inherits the neutral defaults
 * and is honestly labelled `component` tier. It also has `tokens.hardShadow`
 * (a finished CSS shadow) which is decomposed here rather than trusted.
 */
export function resolveExperienceProfile(style: SetupStyle | undefined): ExperienceProfile {
  if (!style) {
    return { ...DEFAULT_EXPERIENCE, tokens: {} };
  }
  const declared = style.experience;
  const legacy = style.tokens;

  const legacyShadow = parseShadow(legacy?.hardShadow);
  const merged: Partial<ExperienceTokens> = {
    ...(legacy?.borderRadius ? { panelRadius: legacy.borderRadius, controlRadius: legacy.borderRadius } : {}),
    ...(legacy?.borderWidth ? { borderWidth: legacy.borderWidth } : {}),
    ...(legacyShadow ? { shadow: { ...BASE_TOKENS.shadow, ...legacyShadow } as ShadowTokens } : {}),
    ...(legacy?.accentHue ? { accent: legacy.accentHue } : {}),
    ...(style.palette.accent ? { accent: style.palette.accent } : {}),
    ...(style.palette.accentSecondary ? { accentSecondary: style.palette.accentSecondary } : {}),
    ...(style.palette.surface ? { surface: style.palette.surface } : {}),
    ...(style.palette.text ? { text: style.palette.text } : {}),
    // Density and motion are declared on the *profile*, because they are
    // properties of an experience rather than values a style picks. But they
    // are also genuine tokens (`ExperienceTokens.density`/`.motion`) so that a
    // user can tune them and so the runtime has one place to read them. Every
    // manifest wrote `density: "spacious"` at the top level while the runtime
    // read `tokens.density`, so every experience silently reported `normal`.
    // Folding the profile value down here is what makes the declaration real.
    ...(declared?.density ? { density: declared.density } : {}),
    ...(declared?.motion ? { motion: declared.motion } : {}),
  };

  return {
    ...DEFAULT_EXPERIENCE,
    ...declared,
    typography: {
      ...(legacy?.fontHeading ? { headingFamily: legacy.fontHeading } : {}),
      ...(legacy?.fontBody ? { bodyFamily: legacy.fontBody } : {}),
      ...declared?.typography,
    },
    tokens: { ...merged, ...declared?.tokens },
  };
}

/**
 * Resolve a manifest plus user overrides into the final token set.
 * This is the only function that decides what a token is worth.
 */
export function resolveTokens(
  style: SetupStyle | undefined,
  overrides: TokenOverrides = {},
): ExperienceTokens {
  const profile = resolveExperienceProfile(style);
  const declared = profile.tokens ?? {};

  const tokens: ExperienceTokens = {
    ...BASE_TOKENS,
    ...declared,
    shadow: { ...BASE_TOKENS.shadow, ...(declared.shadow ?? {}) },
  };

  // Overrides last, so a user's value always beats a manifest's — EXCEPT where
  // the experience declared the token locked. A lock is a correctness claim
  // ("rounding a character cell stops it being a character cell"), not a UI
  // preference, so it has to be enforced on the data path and not only by
  // hiding the control. Otherwise an override saved against an older build of
  // the style — or imported from a file, or written by a future control that
  // forgets to check — silently breaks the grammar it was locked to protect.
  const lockedKeys = new Set(Object.keys(profile.locked ?? {}));
  const over = (key: keyof ExperienceTokens): boolean => !lockedKeys.has(key as TokenKey);

  if (overrides.panelRadius !== undefined && over("panelRadius")) tokens.panelRadius = overrides.panelRadius;
  if (overrides.controlRadius !== undefined && over("controlRadius")) tokens.controlRadius = overrides.controlRadius;
  if (overrides.borderWidth !== undefined && over("borderWidth")) tokens.borderWidth = overrides.borderWidth;
  if (overrides.accent !== undefined && over("accent")) tokens.accent = overrides.accent;
  if (overrides.accentSecondary !== undefined && over("accentSecondary")) tokens.accentSecondary = overrides.accentSecondary;
  if (overrides.surface !== undefined && over("surface")) tokens.surface = overrides.surface;
  if (overrides.text !== undefined && over("text")) tokens.text = overrides.text;
  if (overrides.density !== undefined && over("density")) tokens.density = overrides.density;
  if (overrides.headingScale !== undefined && over("headingScale")) tokens.headingScale = overrides.headingScale;
  if (overrides.bodyScale !== undefined && over("bodyScale")) tokens.bodyScale = overrides.bodyScale;
  if (overrides.motion !== undefined && over("motion")) tokens.motion = overrides.motion;
  if (overrides.shadow && over("shadow")) tokens.shadow = { ...tokens.shadow, ...overrides.shadow };

  return tokens;
}

// ---------------------------------------------------------------------------
// Tweakability
// ---------------------------------------------------------------------------

const ALL_TOKEN_KEYS: TokenKey[] = [
  "panelRadius",
  "controlRadius",
  "borderWidth",
  "shadow",
  "accent",
  "accentSecondary",
  "surface",
  "text",
  "density",
  "headingScale",
  "bodyScale",
  "motion",
];

/** Everything a user may tune on this experience (after any lock). */
export function tweakableKeys(style: SetupStyle | undefined): TokenKey[] {
  const profile = resolveExperienceProfile(style);
  const declared = profile.tweakable;
  if (!declared) return ALL_TOKEN_KEYS.filter((k) => !profile.locked?.[k]);
  return declared.filter((k) => !profile.locked?.[k]);
}

export function isTweakable(style: SetupStyle | undefined, key: TokenKey): boolean {
  return tweakableKeys(style).includes(key);
}

/** Why a token is locked, or `null` when it is adjustable. */
export function lockReason(style: SetupStyle | undefined, key: TokenKey): string | null {
  const profile = resolveExperienceProfile(style);
  if (profile.locked?.[key]) return profile.locked[key]!;
  return tweakableKeys(style).includes(key) ? null : "此体验未开放该令牌";
}

/** Whether this client can render the experience at all. */
export function isRenderable(style: SetupStyle | undefined): boolean {
  const required = resolveExperienceProfile(style).runtimeCapability;
  if (!required) return true;
  return required <= EXPERIENCE_RUNTIME_CAPABILITY;
}

// ---------------------------------------------------------------------------
// Density / motion scales
// ---------------------------------------------------------------------------

const DENSITY_SCALE: Record<DensityGrammar, { gap: string; pad: string; row: string; label: string }> = {
  compact: { gap: "0.5rem", pad: "0.75rem", row: "1.75rem", label: "紧凑" },
  normal: { gap: "0.875rem", pad: "1.25rem", row: "2.5rem", label: "标准" },
  spacious: { gap: "1.5rem", pad: "2rem", row: "3.25rem", label: "宽松" },
};

const MOTION_SCALE: Record<MotionGrammar, { fast: string; base: string; ease: string; label: string }> = {
  reduced: { fast: "0ms", base: "0ms", ease: "linear", label: "克制" },
  normal: { fast: "120ms", base: "220ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)", label: "标准" },
  expressive: { fast: "200ms", base: "420ms", ease: "cubic-bezier(0.22, 1, 0.36, 1)", label: "强表达" },
};

export const DENSITY_LABEL = Object.fromEntries(
  Object.entries(DENSITY_SCALE).map(([k, v]) => [k, v.label]),
) as Record<DensityGrammar, string>;

export const MOTION_LABEL = Object.fromEntries(
  Object.entries(MOTION_SCALE).map(([k, v]) => [k, v.label]),
) as Record<MotionGrammar, string>;

// ---------------------------------------------------------------------------
// Applying to the document
// ---------------------------------------------------------------------------

/** CSS custom properties the runtime owns. Used when clearing. */
export const RUNTIME_VARIABLES = [
  "--radius-panel",
  "--radius-control",
  "--border-width",
  "--border-width-custom",
  "--shadow-hard",
  "--shadow-hard-x",
  "--shadow-hard-y",
  "--shadow-hard-blur",
  "--shadow-hard-spread",
  "--shadow-hard-color",
  "--status-accent",
  "--status-accent-soft",
  "--accent",
  "--accent-on",
  "--experience-accent",
  "--experience-accent-secondary",
  "--surface-raised",
  "--text-primary",
  "--density-gap",
  "--density-pad",
  "--density-row",
  "--type-heading-scale",
  "--type-body-scale",
  "--type-heading-weight",
  "--type-heading-tracking",
  "--type-heading-transform",
  "--type-body-leading",
  "--experience-font-heading",
  "--experience-font-body",
  "--experience-font-mono",
  "--ornament-rule-style",
  "--ornament-rule-width",
  "--ornament-corner",
  "--ornament-decoration",
  "--motion-fast",
  "--motion-base",
  "--motion-ease",
] as const;

/**
 * Variables the runtime and the stylesheets both describe, per theme.
 *
 * Every style stylesheet declares `--surface-raised` and `--text-primary` twice:
 * once for its dark palette and once inside its `[data-theme="light"]` block
 * (19 of the 20 style stylesheets do; the twentieth, `default`, has no stylesheet
 * at all and inherits both from `styles.css`).
 *
 * The runtime also derives them from the manifest's `palette.surface` /
 * `palette.text`, which is a *single* value — there is no light counterpart in
 * the contract. Writing that one value inline with `!important` outranks every
 * author rule, including the style's own light block, so switching theme moved
 * `--text-strong` but left `--text-primary` frozen at the dark palette value.
 * The visible symptom was eight near-white icon stencils staying near-white on a
 * white surface (caught by `tools/ui-verify.mjs`, assertion
 * `icons: every mark is visible against the light surface`).
 *
 * The override layer keeps its authority: when the user has actually tuned
 * `surface` or `text`, that value is written and wins — that is the whole point
 * of the Token Inspector. When they have not, the stylesheet is left alone,
 * because it is the only place that knows what the value is *per theme*.
 */
const THEME_OWNED_VARIABLES = new Set<string>(["--surface-raised", "--text-primary"]);

/** Which theme-owned variables the user actually overrode. */
function overriddenThemeVariables(overrides: TokenOverrides): Set<string> {
  const written = new Set<string>();
  if (overrides.surface !== undefined) written.add("--surface-raised");
  if (overrides.text !== undefined) written.add("--text-primary");
  return written;
}

/** Attributes the runtime writes so CSS and React can both read the grammar. */
export const RUNTIME_ATTRIBUTES = [
  "data-experience",
  "data-style",
  "data-tier",
  "data-shell",
  "data-nav",
  "data-detail",
  "data-card",
  "data-composition",
  "data-density",
  "data-motion",
] as const;

function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Pick a legible foreground for a filled accent surface.
 *
 * Uses the WCAG relative-luminance formula rather than a naive channel average,
 * because the accents in this system span very light yellows (`#ffe600`) and
 * very dark navies, and a naive mean calls mid-blue "light".
 */
export function readableOn(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return lum > 0.55 ? "#000000" : "#ffffff";
}

export interface AppliedExperience {
  id: StyleId;
  profile: ExperienceProfile;
  tokens: ExperienceTokens;
  shadowCss: string;
}

/**
 * The variable table for a token set.
 *
 * Split out from [`applyExperience`] so the Experience Playground's specimen can
 * be painted from *exactly* the same table the document root is. Two code paths
 * here would mean the specimen could agree with an override while the app
 * disagreed with it, and the specimen exists precisely to be trusted.
 *
 * The optional `profile` contributes the *declared* half of the table — heading
 * family, weight, tracking, ornament — which is grammar rather than a token the
 * user tunes. Passing it keeps one table for both halves so a stylesheet never
 * has to know which kind of value it is reading.
 */
export function computeRuntimeVars(
  tokens: ExperienceTokens,
  profile?: ExperienceProfile,
): Record<string, string> {
  const density = DENSITY_SCALE[tokens.density] ?? DENSITY_SCALE.normal;
  const motion = MOTION_SCALE[tokens.motion] ?? MOTION_SCALE.normal;
  const type = profile?.typography ?? {};
  const ornament = profile?.ornament ?? {};
  return {
    "--radius-panel": tokens.panelRadius,
    "--radius-control": tokens.controlRadius,
    "--border-width": tokens.borderWidth,
    // Kept so pre-Experience stylesheets that already reference it start working.
    "--border-width-custom": tokens.borderWidth,
    "--shadow-hard": composeShadow(tokens.shadow),
    "--shadow-hard-x": tokens.shadow.offsetX,
    "--shadow-hard-y": tokens.shadow.offsetY,
    "--shadow-hard-blur": tokens.shadow.blur,
    "--shadow-hard-spread": tokens.shadow.spread,
    "--shadow-hard-color": tokens.shadow.color,
    "--status-accent": tokens.accent,
    // `--accent` is what the base UI primitives already reference
    // (`bg-[color:var(--accent)]` in SetupActionButton, CommandPalette,
    // ActivationPanel). It was referenced in six places and *defined nowhere*,
    // so those controls painted transparent — a real defect found by auditing
    // "which variables does the UI read, and which does the runtime own".
    "--accent": tokens.accent,
    // Readable text on top of `--accent`. Several call sites hardcoded
    // `text-white` / `text-black` per style; deriving it from the accent's
    // luminance makes a light accent swap keep its button legible.
    "--accent-on": readableOn(tokens.accent),
    "--experience-accent": tokens.accent,
    "--experience-accent-secondary": tokens.accentSecondary,
    "--status-accent-soft": alpha(tokens.accent, 0.16),
    "--surface-raised": tokens.surface,
    "--text-primary": tokens.text,
    "--density-gap": density.gap,
    "--density-pad": density.pad,
    "--density-row": density.row,
    "--type-heading-scale": String(tokens.headingScale),
    "--type-body-scale": String(tokens.bodyScale),
    "--motion-fast": motion.fast,
    "--motion-base": motion.base,
    "--motion-ease": motion.ease,
    // Declared typography. Written as variables rather than baked into a style
    // stylesheet so a Vault-published experience can change its type scale
    // without a rebuild, and so the specimen and the app read one source.
    "--experience-font-heading": type.headingFamily ?? "var(--font-sans)",
    "--experience-font-body": type.bodyFamily ?? "var(--font-sans)",
    "--experience-font-mono": type.monoFamily ?? "var(--font-mono)",
    "--type-heading-weight": String(type.headingWeight ?? 700),
    "--type-heading-tracking": type.headingTracking ?? "-0.02em",
    "--type-heading-transform": type.headingTransform ?? "none",
    "--type-body-leading": String(type.bodyLeading ?? 1.6),
    // Ornament grammar. `none` resolves to a no-op value in each case rather
    // than to the empty string, so a stylesheet can use the variable directly in
    // a shorthand without the declaration becoming invalid.
    "--ornament-rule-style": ORNAMENT_RULE[ornament.rule ?? "hairline"],
    "--ornament-rule-width": ornament.rule === "none" ? "0px" : ornament.rule === "heavy" ? "3px" : "1px",
    "--ornament-corner": ORNAMENT_CORNER[ornament.corner ?? "rounded"],
    "--ornament-decoration": ORNAMENT_DECORATION[ornament.decoration ?? "none"],
  };
}

/** Border-style keyword per ornament rule. `none` must stay a valid keyword. */
const ORNAMENT_RULE: Record<NonNullable<OrnamentGrammar["rule"]>, string> = {
  none: "none",
  hairline: "solid",
  double: "double",
  dashed: "dashed",
  ascii: "dashed",
  heavy: "solid",
};

/** Extra radius a corner treatment adds on top of the token radius. */
const ORNAMENT_CORNER: Record<NonNullable<OrnamentGrammar["corner"]>, string> = {
  square: "0px",
  bevel: "2px",
  notch: "0px",
  rounded: "var(--radius-panel)",
};

/**
 * A background-image layer per decoration. Every value is a complete, valid
 * `background-image` list so a stylesheet can assign it unconditionally.
 */
const ORNAMENT_DECORATION: Record<NonNullable<OrnamentGrammar["decoration"]>, string> = {
  none: "none",
  grid:
    "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
  pinstripe: "repeating-linear-gradient(0deg, transparent 0 3px, rgba(0,0,0,0.10) 3px 4px)",
  scanline: "repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.16) 2px 3px)",
  blueprint:
    "linear-gradient(rgba(100,160,220,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(100,160,220,0.10) 1px, transparent 1px)",
  noise:
    "radial-gradient(circle at 20% 15%, rgba(255,255,255,0.05), transparent 55%), radial-gradient(circle at 80% 85%, rgba(255,255,255,0.04), transparent 60%)",
  halftone:
    "radial-gradient(circle, rgba(0,0,0,0.13) 1px, transparent 1.2px)",
};

/**
 * Write an experience to the document root. Returns the resolved state so a
 * caller (or a test) can assert on exactly what was applied rather than
 * guessing from computed style.
 */
export function applyExperience(
  style: SetupStyle | undefined,
  overrides: TokenOverrides = {},
): AppliedExperience {
  const profile = resolveExperienceProfile(style);
  const tokens = resolveTokens(style, overrides);
  const shadowCss = composeShadow(tokens.shadow);

  if (typeof document === "undefined") {
    return { id: style?.id ?? "default", profile, tokens, shadowCss };
  }

  const root = document.documentElement;
  // "important" is the whole trick: an inline important declaration outranks an
  // author important declaration, so a user override beats every per-style
  // `!important` rule without deleting any of them.
  //
  // The two theme-owned variables are the exception, and they are handled by
  // *clearing* rather than skipping: when the user has not tuned them, the
  // stylesheet's own per-theme value must win, so any stale inline value from a
  // previous experience or a since-reset override is removed. Skipping without
  // removing would leave the old experience's colour pinned on `<html>`.
  const vars = computeRuntimeVars(tokens, profile);
  const userOwned = overriddenThemeVariables(overrides);
  for (const [name, value] of Object.entries(vars)) {
    if (THEME_OWNED_VARIABLES.has(name) && !userOwned.has(name)) {
      root.style.removeProperty(name);
      continue;
    }
    root.style.setProperty(name, value, "important");
  }

  const id = style?.id ?? "default";
  root.setAttribute("data-experience", id);
  root.setAttribute("data-style", id);
  root.setAttribute("data-tier", profile.tier);
  root.setAttribute("data-shell", profile.shell!);
  root.setAttribute("data-nav", profile.navigation!);
  root.setAttribute("data-detail", profile.detail!);
  root.setAttribute("data-card", profile.card!);
  root.setAttribute("data-composition", profile.composition!);
  root.setAttribute("data-density", tokens.density);
  root.setAttribute("data-motion", tokens.motion);

  return { id, profile, tokens, shadowCss };
}

/** Remove every runtime variable and attribute, returning `<html>` to base. */
export function clearExperience(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of RUNTIME_VARIABLES) root.style.removeProperty(name);
  for (const attr of RUNTIME_ATTRIBUTES) root.removeAttribute(attr);
}

// ---------------------------------------------------------------------------
// Reading the active grammar from React
// ---------------------------------------------------------------------------

function attr(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return document.documentElement.getAttribute(name) ?? fallback;
}

/**
 * The grammar currently on `<html>`. A page that needs to know "am I in a shell
 * without a right rail?" asks this, never the style id.
 */
export function readRuntimeGrammar() {
  return {
    shell: attr("data-shell", DEFAULT_EXPERIENCE.shell),
    navigation: attr("data-nav", DEFAULT_EXPERIENCE.navigation),
    detail: attr("data-detail", DEFAULT_EXPERIENCE.detail),
    card: attr("data-card", DEFAULT_EXPERIENCE.card),
    composition: attr("data-composition", DEFAULT_EXPERIENCE.composition),
    density: attr("data-density", DEFAULT_EXPERIENCE.density),
    motion: attr("data-motion", DEFAULT_EXPERIENCE.motion),
    tier: attr("data-tier", DEFAULT_EXPERIENCE.tier),
  };
}

export type RuntimeGrammar = ReturnType<typeof readRuntimeGrammar>;

// ---------------------------------------------------------------------------
// Persistence: overrides and derived experiences
// ---------------------------------------------------------------------------

const OVERRIDE_KEY = "setup-center.experience.overrides.v2";
const CUSTOM_KEY = "setup-center.experience.custom.v2";
/** Migrated forward from the broken v1 tweaker so existing users keep nothing. */
const LEGACY_TWEAKER_PREFIX = "setup-center.token-tweaker.v1";

type OverrideMap = Record<StyleId, TokenOverrides>;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage restricted; the session still works, it just will not persist
  }
}

/**
 * Drop the v1 keys. They stored `shadowDepth` — a bare length — against
 * manifests whose shadow was a full box-shadow, and the mismatch produced a
 * saved value that could never be applied. Carrying them forward would carry
 * the bug forward.
 */
export function purgeLegacyTweakerStorage(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_TWEAKER_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * The override map for every experience at once.
 *
 * Held as a single map keyed by style id rather than one storage key per
 * style, because "which style's overrides am I looking at" must be answered by
 * the *active* style id, never by whichever storage key the component happened
 * to be mounted with. That aliasing is what made switching A → B write A's
 * values into B's slot.
 */
export function loadAllOverrides(): OverrideMap {
  return readJson<OverrideMap>(OVERRIDE_KEY, {});
}

export function loadOverrides(styleId: StyleId): TokenOverrides {
  return loadAllOverrides()[styleId] ?? {};
}

export function saveOverrides(styleId: StyleId, overrides: TokenOverrides): void {
  const all = loadAllOverrides();
  if (!overrides || Object.keys(overrides).length === 0) {
    delete all[styleId];
  } else {
    all[styleId] = overrides;
  }
  writeJson(OVERRIDE_KEY, all);
}

/**
 * Reset means "forget the override", not "write today's default down as an
 * override". After this call the experience's own manifest values are what
 * resolve, because there is nothing left above them.
 */
export function clearOverrides(styleId: StyleId): void {
  const all = loadAllOverrides();
  delete all[styleId];
  writeJson(OVERRIDE_KEY, all);
}

export function hasOverrides(styleId: StyleId): boolean {
  const o = loadOverrides(styleId);
  return Object.keys(o).length > 0;
}

// --- Derived experiences ---------------------------------------------------

export function loadCustomExperiences(): CustomExperience[] {
  return readJson<CustomExperience[]>(CUSTOM_KEY, []);
}

export function saveCustomExperience(entry: CustomExperience): void {
  const all = loadCustomExperiences().filter((c) => c.id !== entry.id);
  all.push(entry);
  writeJson(CUSTOM_KEY, all);
}

export function deleteCustomExperience(id: StyleId): void {
  writeJson(
    CUSTOM_KEY,
    loadCustomExperiences().filter((c) => c.id !== id),
  );
}

/** `Neo Brutalism` + `My Neo Brutalism` names must not collide. */
export function uniqueCustomName(base: string, existing: CustomExperience[]): string {
  const taken = new Set(existing.map((c) => c.name));
  let candidate = `我的 ${base}`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `我的 ${base} ${n}`;
    n += 1;
  }
  return candidate;
}

/**
 * Build a derived experience from a preset plus its current overrides.
 * The CSS is not copied — only the base id and the delta — so when the Vault
 * updates the preset, every derived experience inherits the fix.
 */
export function deriveCustomExperience(
  style: SetupStyle,
  overrides: TokenOverrides,
  name?: string,
): CustomExperience {
  const existing = loadCustomExperiences();
  const id = `custom:${style.id}:${Date.now().toString(36)}`;
  return {
    id,
    name: name ?? uniqueCustomName(style.name, existing),
    baseStyleId: style.id,
    overrides,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Register every derived experience as a first-class `SetupStyle` so the
 * gallery, the resolver and the runtime treat it exactly like a preset — it is
 * a preset with a different token bag, and pretending otherwise would need a
 * second code path everywhere.
 */
export function hydrateCustomExperiences(): CustomExperience[] {
  const customs = loadCustomExperiences();
  for (const custom of customs) {
    const base = getStyle(custom.baseStyleId);
    if (!base) continue;
    const profile = resolveExperienceProfile(base);
    registerDerived({
      ...base,
      id: custom.id,
      name: custom.name,
      subtitle: `${base.subtitle} · 派生`,
      description: `基于「${base.name}」的派生体验，仅覆盖令牌，不复制样式表。`,
      inspiration: base.inspiration,
      tags: [...base.tags, "自定义"],
      implemented: true,
      experience: {
        ...profile,
        tokens: { ...profile.tokens, ...tokensToTokenBag(resolveTokens(base, custom.overrides)) },
        specimenNote: `${TIER_LABEL[profile.tier]} · 派生自 ${base.name}`,
      },
    });
  }
  return customs;
}

function tokensToTokenBag(t: ExperienceTokens): Partial<ExperienceTokens> {
  return {
    panelRadius: t.panelRadius,
    controlRadius: t.controlRadius,
    borderWidth: t.borderWidth,
    shadow: t.shadow,
    accent: t.accent,
    accentSecondary: t.accentSecondary,
    surface: t.surface,
    text: t.text,
    density: t.density,
    headingScale: t.headingScale,
    bodyScale: t.bodyScale,
    motion: t.motion,
  };
}

// Imported late to avoid a cycle with the registry at module-init time.
function registerDerived(style: SetupStyle): void {
  const idx = STYLE_REGISTRY.findIndex((s) => s.id === style.id);
  if (idx >= 0) STYLE_REGISTRY[idx] = style;
  else STYLE_REGISTRY.push(style);
}

// --- Export / import -------------------------------------------------------

export interface ExperienceExport {
  kind: "setup-center.experience";
  formatVersion: 2;
  styleId: StyleId;
  styleName: string;
  exportedAt: string;
  overrides: TokenOverrides;
}

export function buildExport(style: SetupStyle, overrides: TokenOverrides): ExperienceExport {
  return {
    kind: "setup-center.experience",
    formatVersion: 2,
    styleId: style.id,
    styleName: style.name,
    exportedAt: new Date().toISOString(),
    overrides,
  };
}

/**
 * Accept a v2 export, a bare override object, or the v1 `{tokens:{shadowDepth}}`
 * blob. A v1 `shadowDepth` is *not* silently mapped onto a shadow — the two
 * shapes mean different things and guessing produced the original bug — it is
 * reported as unsupported instead.
 */
export function parseImport(text: string): { ok: true; overrides: TokenOverrides; styleId?: StyleId } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "不是合法的 JSON" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "内容不是对象" };
  const obj = parsed as Record<string, unknown>;

  if (obj.kind === "setup-center.experience" && obj.overrides) {
    return { ok: true, overrides: obj.overrides as TokenOverrides, styleId: obj.styleId as StyleId };
  }
  if (obj.tokens) {
    return { ok: false, error: "这是 v1 令牌导出（shadowDepth 单值模型），无法安全映射到新的阴影模型，请重新导出" };
  }
  if (typeof obj === "object") {
    return { ok: true, overrides: obj as TokenOverrides };
  }
  return { ok: false, error: "无法识别的格式" };
}
