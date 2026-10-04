import type { SetupStyle, StyleId } from "./types";
import { loadVaultCache } from "../core/vault/cache";

// Auto-load all style CSS files dynamically across any style folder
// Vite bundles every matched CSS file into the application stylesheet automatically
import.meta.glob("./*/*.css", { eager: true });

// Auto-discover all style manifests
const manifestModules = import.meta.glob<{
  [key: string]: unknown;
}>("./*/manifest.ts", { eager: true });

function extractStyle(mod: Record<string, unknown>): SetupStyle | null {
  if (
    mod.default &&
    typeof mod.default === "object" &&
    "id" in mod.default &&
    "name" in mod.default
  ) {
    return mod.default as SetupStyle;
  }
  for (const key of Object.keys(mod)) {
    const val = mod[key];
    if (
      val &&
      typeof val === "object" &&
      "id" in val &&
      "name" in val &&
      "palette" in val
    ) {
      return val as SetupStyle;
    }
  }
  return null;
}

const discoveredStyles: SetupStyle[] = [];
for (const path in manifestModules) {
  const mod = manifestModules[path];
  const style = extractStyle(mod);
  if (style) {
    discoveredStyles.push(style);
  }
}

// Preserve desired display order: phantom-comic first, default second, then remaining implemented, then drafts
discoveredStyles.sort((a, b) => {
  if (a.id === "phantom-comic") return -1;
  if (b.id === "phantom-comic") return 1;
  if (a.id === "default") return -1;
  if (b.id === "default") return 1;
  if (a.implemented && !b.implemented) return -1;
  if (!a.implemented && b.implemented) return 1;
  return a.name.localeCompare(b.name, "zh-CN");
});

export type RegistryListener = (version: number) => void;

/**
 * Mount or update dynamic style CSS in DOM for remotely synced styles.
 */
export function mountDynamicStyleCss(styleId: string, cssContent: string): void {
  if (typeof document === "undefined" || !cssContent) return;
  const tagId = `vault-style-${styleId}`;
  let styleTag = document.getElementById(tagId) as HTMLStyleElement | null;
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = tagId;
    styleTag.setAttribute("data-vault-style", styleId);
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = cssContent;
}

/**
 * Style Registry Manager — Unified Reactive Design System Registry
 *
 * Emits change events whenever built-ins, remote Vault styles, or local
 * custom variants are registered, updated, or removed.
 */
export class StyleRegistryManager {
  private version = 1;
  private listeners = new Set<RegistryListener>();
  private styles: SetupStyle[] = [...discoveredStyles];

  public getVersion(): number {
    return this.version;
  }

  public getStyles(): SetupStyle[] {
    return this.styles;
  }

  public getStyle(id: StyleId): SetupStyle | undefined {
    if (id === "p5-comic") {
      return this.styles.find((s) => s.id === "phantom-comic");
    }
    return this.styles.find((s) => s.id === id);
  }

  public subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notify(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      try {
        listener(this.version);
      } catch (err) {
        console.error("[StyleRegistry] listener error:", err);
      }
    }
  }

  public registerStyleInternal(style: SetupStyle, shouldNotify = true): void {
    const existingIdx = this.styles.findIndex((s) => s.id === style.id);
    if (existingIdx < 0) {
      this.styles.push(style);
    } else {
      const existing = this.styles[existingIdx];
      this.styles[existingIdx] = {
        ...style,
        implemented: style.implemented || existing.implemented,
        experience: style.experience ?? existing.experience,
      };
    }
    if (shouldNotify) {
      this.notify();
    }
  }

  public registerStyle(style: SetupStyle): void {
    this.registerStyleInternal(style, true);
  }

  public removeStyle(id: StyleId): void {
    const idx = this.styles.findIndex((s) => s.id === id);
    if (idx >= 0) {
      this.styles.splice(idx, 1);
      this.notify();
    }
  }
}

export const StyleRegistry = new StyleRegistryManager();

/** The active runtime style registry list (kept in sync with manager) */
export const STYLE_REGISTRY: SetupStyle[] = StyleRegistry.getStyles();

/** Retrieve a style by its registered identifier */
export function getStyle(id: StyleId): SetupStyle | undefined {
  return StyleRegistry.getStyle(id);
}

/**
 * Register or override a style dynamically in the registry.
 */
export function registerStyle(style: SetupStyle): void {
  StyleRegistry.registerStyle(style);
}

/**
 * Remove a style dynamically from the registry.
 */
export function removeStyle(id: StyleId): void {
  StyleRegistry.removeStyle(id);
}

/** Get active style definition with fallback */
export function getActiveStyleDefinition(id: StyleId): SetupStyle {
  return (
    getStyle(id) ??
    StyleRegistry.getStyle("phantom-comic") ??
    STYLE_REGISTRY[0]
  );
}

const STORAGE_KEY = "setup-center.style";

/**
 * Synchronously hydrates cached Vault styles and local custom variants into the registry.
 * This runs BEFORE loadSavedStyle() is evaluated, ensuring that Vault-only or Custom-only
 * styles are present in StyleRegistry when the app initializes, preventing fallback.
 */
export function hydrateRegistrySync(): void {
  // 1. Hydrate Vault LKG Cache synchronously
  try {
    const cached = loadVaultCache();
    if (cached && cached.styles) {
      for (const [id, s] of Object.entries(cached.styles)) {
        const setupStyle: SetupStyle = {
          id,
          name: s.name,
          version: s.version || "1.0.0",
          subtitle: s.subtitle || "",
          description: s.description,
          inspiration: s.inspiration || "",
          author: s.author,
          tags: s.tags ?? [],
          features: s.features ?? [],
          implemented: s.implemented ?? true,
          palette: {
            baseBg: s.palette.bg,
            surface: s.palette.surface,
            cardBorder: s.palette.border,
            accent: s.palette.primary,
            text: s.palette.text,
          },
          tokens: {
            borderWidth: s.tokens?.borderWidth,
            hardShadow: s.tokens?.shadowDepth,
            borderRadius: s.tokens?.cardRadius,
            fontHeading: s.tokens?.fontHeading,
            fontBody: s.tokens?.fontBody,
          },
          designPrinciples: s.designPrinciples ?? [],
          ...(s.experience ? { experience: s.experience } : {}),
        };
        StyleRegistry.registerStyleInternal(setupStyle, false);
        if (s.cssContent) {
          mountDynamicStyleCss(id, s.cssContent);
        }
      }
    }
  } catch (err) {
    console.warn("[StyleRegistry] Failed to hydrate vault cache synchronously:", err);
  }

  // 2. Hydrate Custom Experiences synchronously from localStorage
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("setup-center.custom-experiences.v2") : null;
    if (raw) {
      const customs = JSON.parse(raw);
      if (Array.isArray(customs)) {
        for (const custom of customs) {
          const base = StyleRegistry.getStyle(custom.baseStyleId);
          if (!base) continue;
          StyleRegistry.registerStyleInternal({
            ...base,
            id: custom.id,
            name: custom.name,
            subtitle: `${base.subtitle} · 派生`,
            description: `基于「${base.name}」的派生体验，仅覆盖令牌，不复制样式表。`,
            inspiration: base.inspiration,
            tags: [...base.tags, "自定义"],
            implemented: true,
            experience: base.experience ? {
              ...base.experience,
              tokens: { ...base.experience.tokens, ...custom.overrides },
              specimenNote: `派生自 ${base.name}`,
            } : undefined,
          }, false);
        }
      }
    }
  } catch (err) {
    console.warn("[StyleRegistry] Failed to hydrate custom experiences synchronously:", err);
  }
}

// Execute synchronous hydration immediately upon module initialization
hydrateRegistrySync();

/** Load user preference from storage, safely defaulting to phantom-comic */
export function loadSavedStyle(): StyleId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      if (saved === "p5-comic" || saved === "phantom-comic") {
        return "phantom-comic";
      }
      if (STYLE_REGISTRY.some((s) => s.id === saved && s.implemented)) {
        return saved;
      }
    }
  } catch {
    // fallback if local storage is restricted
  }
  return "phantom-comic";
}

/** Persist user choice */
export function saveStylePreference(id: StyleId): void {
  try {
    const normalizedId = id === "p5-comic" ? "phantom-comic" : id;
    localStorage.setItem(STORAGE_KEY, normalizedId);
  } catch {
    // ignore
  }
}
