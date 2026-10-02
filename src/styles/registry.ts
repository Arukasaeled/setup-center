import type { SetupStyle, StyleId } from "./types";

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

/** The active runtime style registry list (automatically discovered) */
export const STYLE_REGISTRY: SetupStyle[] = discoveredStyles;

/** Retrieve a style by its registered identifier */
export function getStyle(id: StyleId): SetupStyle | undefined {
  if (id === "p5-comic") {
    return STYLE_REGISTRY.find((s) => s.id === "phantom-comic");
  }
  return STYLE_REGISTRY.find((s) => s.id === id);
}

/** Register or override a style dynamically in the registry */
export function registerStyle(style: SetupStyle): void {
  const existingIdx = STYLE_REGISTRY.findIndex((s) => s.id === style.id);
  if (existingIdx >= 0) {
    STYLE_REGISTRY[existingIdx] = style;
  } else {
    STYLE_REGISTRY.push(style);
  }
}

/** Get active style definition with fallback */
export function getActiveStyleDefinition(id: StyleId): SetupStyle {
  return (
    getStyle(id) ??
    STYLE_REGISTRY.find((s) => s.id === "phantom-comic") ??
    STYLE_REGISTRY[0]
  );
}

const STORAGE_KEY = "setup-center.style";

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
