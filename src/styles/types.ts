/**
 * Setup Center — Experience Contract
 *
 * A Style is no longer "a palette plus a radius". A Style is an **Experience**:
 * a declarative description of an entire desktop product's character. This file
 * is the formal specification of that description.
 *
 * ## The four tiers
 *
 * `token`        — colour + typography only. A theme.
 * `component`    — additionally re-specifies controls and the card language.
 * `composition`  — additionally re-specifies how a page composes its content.
 * `experience`   — additionally re-specifies the shell, the navigation and the
 *                  detail presentation. The whole product changes shape.
 *
 * New experiences are expected to be `composition` or `experience`. A `token`
 * tier entry is legitimate, but it is not what this system exists for.
 *
 * ## Why declarative
 *
 * Every axis below is a *closed enum*. A page asks the runtime "which shell am
 * I?" and the runtime answers from the active manifest. No page ever writes
 * `if (style === "dos")`. That is the invariant that keeps the style layer free
 * of business logic and lets a new experience ship as data (see
 * `runtimeCapability` for the escape hatch when data genuinely is not enough).
 *
 * ## Relationship to the old contract
 *
 * `palette`, `tokens` and `features` are retained verbatim so a manifest written
 * against the previous contract still loads — `resolveExperienceProfile()` in
 * `runtime.ts` synthesises a profile for such a manifest instead of failing.
 */

export type StyleId = string;

/** How much of the product an experience re-specifies. */
export type ExperienceTier = "token" | "component" | "composition" | "experience";

/**
 * How the app frame is assembled. This is the single largest driver of "does
 * this feel like a different program" — two experiences with the same shell
 * read as the same product no matter how different their colours are.
 */
export type ShellGrammar =
  /** Left rail + content + optional right rail. The default desktop shape. */
  | "sidebar"
  /** Horizontal bar across the top + content below. */
  | "topbar"
  /** Floating command dock pinned to an edge; content fills the canvas. */
  | "dock"
  /** Two independently scrolling panes, no separate navigation column. */
  | "dual-pane"
  /** Content presented inside a chromed window on a desktop field. */
  | "windowed"
  /** A command surface is the primary object; everything else is secondary. */
  | "command-centered"
  /** A masthead, then a ruled document column. */
  | "editorial"
  /** Navigation is an overlay; the canvas is the product. */
  | "canvas"
  /** Sections stacked in one scrolling column, navigation as a sticky strip. */
  | "stacked";

/**
 * How navigation is presented. The *entry points* are the same in every
 * grammar — only their presentation changes. Losing an entry point is a bug.
 */
export type NavigationGrammar =
  | "sidebar"
  | "topbar"
  | "dock"
  | "tab-strip"
  | "command-bar"
  | "menu-bar"
  | "keyboard-menu";

/**
 * How a selected item's detail is presented. Business code always calls the
 * same `openDetail(item)`; the grammar decides where the detail physically goes.
 */
export type DetailGrammar =
  /** Permanent right rail, always present. */
  | "rail"
  /** Centred dialog over a scrim. */
  | "modal"
  /** Edge-anchored slab that slides in. */
  | "sheet"
  /** Small draggable-feeling inspector panel floating over the content. */
  | "floating-inspector"
  /** A chromed sub-window. */
  | "window"
  /** Detail expands in place, inside the list. */
  | "inline"
  /** The detail *replaces* the page. */
  | "full-page";

/**
 * The shape a single piece of content takes. Not every experience uses a card,
 * and an experience that insists on cards is limited to being a theme.
 */
export type CardGrammar =
  /** The neutral bordered rounded panel. */
  | "panel"
  /** A rule-separated row with no box at all. */
  | "flat-row"
  /** A text block with a rule above and hierarchical type. */
  | "editorial-block"
  /** Oversized, high-contrast, allowed to tilt. */
  | "poster"
  /** A monospace line of text, `>` prefixed. */
  | "terminal-line"
  /** Chrome bar, bevel, close box. */
  | "window"
  /** Compact, aspect-locked, lives on a grid. */
  | "tile"
  /** A catalogue entry: index number, title, dotted leader, page. */
  | "index-entry"
  /** Translucent, elevated, no hard border. */
  | "floating-surface"
  /** Items grouped by proximity and a shared heading, no separating boxes. */
  | "borderless-group"
  /** Rotated, overlapping, deliberately off-grid. */
  | "sticker";

/**
 * How a page arranges its children. This is what makes the *same data* read as
 * a magazine index in one experience and a dual-pane directory in another.
 */
export type CompositionGrammar =
  /** Even, heavy, filled grid. */
  | "solid-grid"
  /** Asymmetric editorial grid with generous whitespace and few boxes. */
  | "magazine-index"
  /** Single dense monospace column, character-cell rhythm. */
  | "character-list"
  /** Nested grouped lists, disclosure triangles, icon column. */
  | "finder-list"
  /** Panels at varying depth on a shared field. */
  | "floating-panels"
  /** Multi-column newspaper flow with standfirsts and section rules. */
  | "news-columns"
  /** Labelled, measured, dashed construction frame. */
  | "drafting-index"
  /** Panel-cut poster wall. */
  | "poster-wall"
  /** Ordered milestones down a spine. */
  | "roadmap"
  /** Tight numeric/spec table rows. */
  | "ledger";

export type DensityGrammar = "compact" | "normal" | "spacious";
export type MotionGrammar = "reduced" | "normal" | "expressive";

/**
 * How a *page* — as opposed to the app frame — is laid out.
 *
 * This exists because the previous build decided "does this section get a detail
 * rail?" with a growing chain of `section !== "style" && section !== "resources"
 * && …` conditions in the shell. Every new section had to remember to extend the
 * chain, and the four sections nobody remembered (`history`, `plugins`,
 * `license`, `about`) rendered a permanently empty 340px column. Making the
 * layout a *declared property of the page* means a section cannot forget: the
 * shell reads the mode, and an unknown section gets an explicit default.
 */
export type PageLayoutMode =
  /** A list on the left, the selected item's detail beside it. */
  | "master-detail"
  /** One full-width document; no secondary column at all. */
  | "full-width"
  /** A grid of specimens or cards whose detail is secondary. */
  | "gallery"
  /** A dense browsable index with its own internal controls. */
  | "explorer"
  /** Prose and settings, read top to bottom. */
  | "document"
  /** A chronological record. */
  | "timeline";

/** The page-layout contract for one dashboard section. */
export interface PageLayoutContract {
  mode: PageLayoutMode;
  /**
   * Whether selecting an item *in this section* can produce a detail. A
   * `master-detail` page with nothing selected still shows its rail in most
   * experiences, because the rail is part of the frame — but a page that can
   * never select anything must not reserve the space.
   */
  selectable: boolean;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * A hard shadow, decomposed.
 *
 * The previous contract stored `hardShadow` as a finished CSS box-shadow string
 * while the tweaker stored a bare `"6px"` — two different data shapes for one
 * concept, which is why the tweaker could not write anything meaningful. The
 * shadow is now five numbers and one colour, and the composed value is derived.
 */
export interface ShadowTokens {
  /** e.g. `"6px"` */
  offsetX: string;
  /** e.g. `"6px"` */
  offsetY: string;
  /** e.g. `"0px"` */
  blur: string;
  /** e.g. `"0px"` */
  spread: string;
  /** e.g. `"#000000"` */
  color: string;
  /**
   * The `inset` keyword. Optional because almost no experience uses it, but it
   * has to be carried: `inset 0 1px 3px rgba(0,0,0,0.6)` and
   * `0 1px 3px rgba(0,0,0,0.6)` are the same five numbers and two different
   * shadows — a recessed well versus a floating panel.
   */
  inset?: boolean;
}

export type ShadowPreset = "none" | "soft" | "hard" | "custom";

/** Everything a user may tune, and therefore everything a manifest may declare. */
export type TokenKey =
  | "panelRadius"
  | "controlRadius"
  | "borderWidth"
  | "shadow"
  | "accent"
  | "accentSecondary"
  | "surface"
  | "text"
  | "density"
  | "headingScale"
  | "bodyScale"
  | "motion";

/**
 * The fully resolved token set for one experience. `runtime.ts` fills every
 * field; a manifest may supply a subset as its defaults.
 */
export interface ExperienceTokens {
  panelRadius: string;
  controlRadius: string;
  borderWidth: string;
  shadow: ShadowTokens;
  accent: string;
  accentSecondary: string;
  surface: string;
  text: string;
  density: DensityGrammar;
  headingScale: number;
  bodyScale: number;
  motion: MotionGrammar;
}

export interface TypographyGrammar {
  headingFamily?: string;
  bodyFamily?: string;
  monoFamily?: string;
  /** Multiplier on the base heading scale. 0.85 – 1.35. */
  headingScale?: number;
  /** Multiplier on the base body size. 0.9 – 1.15. */
  bodyScale?: number;
  headingWeight?: number;
  headingTracking?: string;
  headingTransform?: "none" | "uppercase" | "lowercase";
  /** Unitless line-height for body copy. */
  bodyLeading?: number;
}

/** Lines, corners and the small repeating marks that make a style recognisable. */
export interface OrnamentGrammar {
  /** How separators are drawn. */
  rule?: "none" | "hairline" | "double" | "dashed" | "ascii" | "heavy";
  /** The corner treatment applied to framed things. */
  corner?: "square" | "bevel" | "notch" | "rounded";
  /** A background texture, applied by the experience's own CSS. */
  decoration?: "none" | "grid" | "pinstripe" | "scanline" | "blueprint" | "noise" | "halftone";
  /** Which window-chrome bars this experience draws. */
  chrome?: "none" | "title" | "menu" | "status" | "title-menu" | "full";
}

export type ExperienceFamily =
  | "editorial"
  | "spatial"
  | "hardware"
  | "cinematic"
  | "terminal"
  | "minimal"
  | "cyber"
  | "playful";

export type SceneGrammar =
  | "split-reading"
  | "constellation"
  | "instrument-panel"
  | "viewport-hud"
  | "windowed-desktop"
  | "coordinate-atlas"
  | "poster-canvas"
  | "minimal-gallery";

export type ContentFlowGrammar =
  | "asymmetric-split"
  | "orbital-nodes"
  | "dense-rack"
  | "widescreen-timeline"
  | "floating-windows"
  | "cartesian-matrix"
  | "tilted-columns"
  | "serene-centered";

export type NavigationFlowGrammar =
  | "ticker-rail"
  | "radial-dock"
  | "hardware-tabs"
  | "cinematic-scrubber"
  | "window-taskbar"
  | "coordinate-ruler"
  | "slant-tabs"
  | "ghost-pill";

export type PageTransitionGrammar =
  | "newspaper-fold"
  | "constellation-drift"
  | "knob-snap"
  | "camera-cut"
  | "window-cascade"
  | "telemetry-glitch"
  | "poster-flip"
  | "subtle-fade";

export type HeroModeGrammar =
  | "giant-serif"
  | "hologram"
  | "synth-rack"
  | "anamorphic-scope"
  | "desktop-stage"
  | "data-readout"
  | "bold-marquee"
  | "monolithic-focus";

export type LayeringGrammar =
  | "paper-stack"
  | "deep-space"
  | "chassis-chassis"
  | "optical-glass"
  | "overlapping-windows"
  | "blueprint-grid"
  | "overlapping-stickers"
  | "single-plane";

/**
 * A complete declarative description of one experience.
 *
 * Every field except `tier` is optional so a manifest can be upgraded
 * incrementally; `resolveExperienceProfile()` supplies defaults.
 */
export interface ExperienceProfile {
  tier: ExperienceTier;
  family?: ExperienceFamily;
  scene?: SceneGrammar;
  contentFlow?: ContentFlowGrammar;
  navigationFlow?: NavigationFlowGrammar;
  pageTransition?: PageTransitionGrammar;
  heroMode?: HeroModeGrammar;
  layering?: LayeringGrammar;
  shell?: ShellGrammar;
  navigation?: NavigationGrammar;
  detail?: DetailGrammar;
  card?: CardGrammar;
  composition?: CompositionGrammar;
  density?: DensityGrammar;
  motion?: MotionGrammar;

  typography?: TypographyGrammar;
  ornament?: OrnamentGrammar;

  /** This experience's defaults for the tokens below. */
  tokens?: Partial<ExperienceTokens>;

  /**
   * The token keys the user may tune. `undefined` means "all of them".
   * A manifest that locks a token must also give a reason in `locked`.
   */
  tweakable?: TokenKey[];

  /**
   * key → the sentence shown next to a disabled control, e.g.
   * `{ panelRadius: "DOS 的字符格要求直角，圆角会破坏栅格对齐" }`.
   * A locked control is rendered disabled with this reason, never silently
   * omitted: a missing control reads as a bug, a locked one reads as a rule.
   */
  locked?: Partial<Record<TokenKey, string>>;

  /**
   * Set only when this experience genuinely cannot be rendered from declarative
   * grammar + CSS + tokens. A client whose `EXPERIENCE_RUNTIME_CAPABILITY` is
   * below this value shows "需要更新应用" instead of a broken page. Declarative
   * experiences leave it unset, which is what makes them remotely shippable.
   */
  runtimeCapability?: string;

  /**
   * Numeric capability revision for strict integer-level capability gating (Issue G05).
   * A client whose `EXPERIENCE_CAPABILITY_REVISION` is below this value will refuse
   * rendering rather than rendering a corrupted layout.
   */
  capabilityRevision?: number;

  /** One-line notes used by the gallery specimen, so previews can be honest. */
  specimenNote?: string;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface StylePalette {
  baseBg: string;
  surface: string;
  cardBorder: string;
  accent: string;
  accentSecondary?: string;
  text: string;
}

/**
 * Legacy token bag. Superseded by `ExperienceProfile.tokens`, still read so old
 * manifests and old Vault payloads keep working. `hardShadow` here is the
 * reason the old tweaker was broken — it is migrated, not trusted.
 */
export interface StyleTokens {
  borderWidth?: string;
  hardShadow?: string;
  borderRadius?: string;
  accentHue?: string;
  fontHeading?: string;
  fontBody?: string;
}

export interface SetupStyle {
  id: StyleId;
  name: string;
  version: string;
  subtitle: string;
  description: string;
  inspiration: string;
  author: string;
  tags: string[];
  palette: StylePalette;
  features: string[];
  tokens?: StyleTokens;
  implemented: boolean;
  designPrinciples?: string[];
  license?: string;
  updatedAt?: string;
  /** Monotonically increasing revision counter within the runtime registry (Issue G03). */
  revision?: number;
  /** Base style ID for derived experiences (Issue G02). */
  baseStyleId?: StyleId;
  /** The declarative experience. Absent only on a pre-Experience manifest. */
  experience?: ExperienceProfile;
}

/**
 * A user-derived experience: a preset plus the token overrides that were
 * applied to it. Storing the delta rather than a copy keeps a derived
 * experience valid when the preset underneath it is updated by the Vault.
 */
export interface CustomExperience {
  id: StyleId;
  name: string;
  baseStyleId: StyleId;
  overrides: TokenOverrides;
  createdAt: string;
}

/** A sparse patch over an experience's resolved tokens. */
export interface TokenOverrides {
  panelRadius?: string;
  controlRadius?: string;
  borderWidth?: string;
  shadow?: Partial<ShadowTokens>;
  accent?: string;
  accentSecondary?: string;
  surface?: string;
  text?: string;
  density?: DensityGrammar;
  headingScale?: number;
  bodyScale?: number;
  motion?: MotionGrammar;
}
