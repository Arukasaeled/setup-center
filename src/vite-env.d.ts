/// <reference types="vite/client" />

/**
 * Ambient declarations for the bundled vendor icon assets.
 *
 * Vite resolves `*.svg` / `*.png` imports to URL strings at build time, but
 * TypeScript needs to be told that shape. Declared explicitly rather than
 * relying on `vite/client` alone so that a typo in an icon path fails the
 * typecheck instead of silently bundling `undefined`.
 */

declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.png" {
  const url: string;
  export default url;
}

declare const __APP_COMMIT_SHA__: string;
declare const __APP_BUILD_TIME__: string;
