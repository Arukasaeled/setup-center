/**
 * Style System compatibility bridge.
 *
 * Re-exports the unified Style Contract and Registry from `src/styles`
 * for existing modules while consolidating internal boundaries.
 */

export * from "../styles";
export type { SetupStyle as StylePreset } from "../styles";
export { STYLE_REGISTRY as STYLE_PRESETS } from "../styles";
