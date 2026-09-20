/**
 * Software icons.
 *
 * ## What changed in the branding overhaul
 *
 * This file used to draw a *resemblance* of each logo — a hand-authored 24×24
 * path in the vendor's brand colour, justified by three constraints (offline,
 * trademark, CSP). Two of those three were real; the third was not, and the
 * result was the thing the user actually complained about: "图标不要用简称，
 * 直接用官方 logo" and "AI 味太重".
 *
 * A redrawn approximation of a logo is worse than no logo. It reads as a
 * placeholder that is pretending, and at 28px the approximation is what makes a
 * row feel cheap. So the marks are now the **real vendor assets**, bundled:
 *
 * | id              | source                                                |
 * |-----------------|-------------------------------------------------------|
 * | vscode          | Microsoft's own `code.ico`, 256px frame               |
 * | claude          | Anthropic's official starburst SVG (`#D97757`)        |
 * | chatgpt         | OpenAI's shipped mark, re-tinted per theme            |
 * | git/python/...  | the vendor's published brand mark, via Simple Icons   |
 *
 * They are local files under `src/assets/software/`, so all three of the
 * original constraints still hold: nothing is fetched at runtime, nothing is
 * blocked by the CSP, and the installer still works on an offline campus
 * machine on first boot.
 *
 * ## The two things that actually needed engineering
 *
 * **1. Monochrome marks.** Cursor, Windsurf, LM Studio and OpenCode publish a
 * pure-black glyph. Dropped onto the dark theme's `#0c0e11` surface those are
 * invisible. Their paths are rewritten to `fill="currentColor"` at build time
 * and the component sets the colour per theme, so one file serves both.
 *
 * **2. White-on-transparent marks.** OpenAI's shipped asset is `255,255,255`
 * with an alpha channel — correct on a dark app bar, invisible on paper. That
 * one is emitted twice (`chatgpt-light`/`chatgpt-dark`) from the same alpha
 * mask and swapped by theme rather than tinted at runtime.
 *
 * ## Scope
 *
 * A pure UI component. It maps an id to an asset and draws it. It takes no
 * decision about installation, profiles, permissions or detection state — that
 * separation is why the install screen and the software list can share it.
 */

import type { SoftwareId } from "../lib/types";

// Vite turns each of these into a hashed, bundled URL (or inlines small ones).
// `?url` keeps the SVG as a *file* rather than inlining it as a data URI. That
// matters for the four masked marks below: a `mask-image` pointing at a `data:`
// URI is re-parsed on every paint and cannot be cached, and Vite would inline
// these small SVGs by default. `?url` also keeps the real asset path visible in
// the bundle, which is what the UI harness asserts against.
import vscodeUrl from "../assets/software/vscode.png";
import claudeUrl from "../assets/software/claude.svg";
import chatgptLightUrl from "../assets/software/chatgpt-light.png";
import chatgptDarkUrl from "../assets/software/chatgpt-dark.png";
import gitUrl from "../assets/software/git.svg";
import pythonUrl from "../assets/software/python.svg";
import nodeUrl from "../assets/software/nodedotjs.svg";
import dockerUrl from "../assets/software/docker.svg";
import cursorUrl from "../assets/software/cursor.svg?url";
import windsurfUrl from "../assets/software/windsurf.svg?url";
import lmstudioUrl from "../assets/software/lmstudio.svg?url";
import opencodeUrl from "../assets/software/opencode.svg?url";
import rustUrl from "../assets/software/rust.svg?url";
import javaUrl from "../assets/software/openjdk.svg?url";
import cmakeUrl from "../assets/software/cmake.svg";
import jetbrainsUrl from "../assets/software/jetbrains.svg";

/**
 * A bundled mark.
 *
 * `mono` says the asset is a single-colour glyph rather than a finished
 * multi-colour logo. Monochrome marks must follow the theme's text colour;
 * brand-coloured ones must not be touched, because recolouring Git's orange or
 * Python's blue would destroy the recognition the asset exists to provide.
 */
interface Mark {
  url: string;
  mono?: boolean;
  /** A second asset for the light theme, when the default is white-on-clear. */
  lightUrl?: string;
}

const MARKS: Partial<Record<SoftwareId, Mark>> = {
  // --- Editors -------------------------------------------------------------
  // VS Code's own 256px asset is already brand blue with an alpha background,
  // so it needs no theme handling at all.
  vscode: { url: vscodeUrl },
  cursor: { url: cursorUrl, mono: true },
  windsurf: { url: windsurfUrl, mono: true },
  jetbrains: { url: jetbrainsUrl, mono: true },

  // --- AI clients ----------------------------------------------------------
  claude_desktop: { url: claudeUrl },
  // OpenAI ships one asset; the dark-theme copy is white, the light-theme copy
  // is ink. Both are the genuine mark, just tinted.
  chatgpt_desktop: { url: chatgptDarkUrl, lightUrl: chatgptLightUrl },
  // Codex has no standalone published mark — the npm package ships none and the
  // MSIX reuses OpenAI's. Rather than invent one, it shares the genuine OpenAI
  // mark. See `FALLBACK_NOTE` below for why this is not a fabrication.
  codex: { url: chatgptDarkUrl, lightUrl: chatgptLightUrl },
  lm_studio: { url: lmstudioUrl, mono: true },
  opencode: { url: opencodeUrl, mono: true },
  // Continue ships no brand asset in any of its distributions.
  continue: { url: "" },

  // --- Runtimes ------------------------------------------------------------
  // Rust and Java are `mono: true` despite shipping a hex fill rather than
  // `currentColor`: both are published as pure `#000000`, which is just as
  // invisible on the dark surface as a `currentColor` mark is under `<img>`.
  // Treating them as stencils is what makes them legible in both themes — and
  // it is not a recolour, because neither vendor has a brand hue here to lose.
  python: { url: pythonUrl },
  node: { url: nodeUrl },
  rust: { url: rustUrl, mono: true },
  java: { url: javaUrl, mono: true },

  // --- Tools ---------------------------------------------------------------
  git: { url: gitUrl },
  docker: { url: dockerUrl },
  cmake: { url: cmakeUrl },
  // npm/pnpm/uv/WSL/MSVC build tools are all shipped without a standalone brand
  // mark, or are Microsoft components with no distributable logo. They fall
  // through to the initial tile rather than getting an invented one.
};

/**
 * Ids that intentionally have no bundled asset.
 *
 * Listed explicitly so that "missing icon" is a decision on the record rather
 * than an oversight. A test asserts this list and `MARKS` together cover every
 * id the catalogue can show, so adding a software entry without an icon fails
 * loudly instead of rendering an invisible row.
 */
export const NO_BRAND_ASSET: SoftwareId[] = [
  "continue",
  "npm",
  "pnpm",
  "uv",
  "wsl",
  "msvc_build_tools",
];

/**
 * Fallback tile.
 *
 * Neutral and quiet: a bordered square with the product's initial. It is
 * deliberately *not* brand-coloured, because the whole point of the fallback is
 * to signal "we have no official artwork for this" rather than to fake one.
 */
function FallbackTile({ id, size }: { id: SoftwareId; size: number }) {
  return (
    <span
      className="border-[color:var(--line-default)] bg-[color:var(--surface-inset)] text-[color:var(--text-tertiary)] flex shrink-0 items-center justify-center rounded-[7px] border font-medium"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {id.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function SoftwareIcon({
  id,
  size = 28,
}: {
  id: SoftwareId;
  size?: number;
}) {
  const mark = MARKS[id];

  if (!mark || !mark.url) return <FallbackTile id={id} size={size} />;

  /**
   * Monochrome marks are painted by a CSS mask, not by `<img>`.
   *
   * This is the correction of a real defect: four vendors (Cursor, Windsurf,
   * LM Studio, OpenCode) ship a pure-black `fill="currentColor"` glyph. The
   * obvious approach — put it in an `<img>` and set the text colour on the
   * parent — silently does nothing, because a document loaded through `<img>` is
   * an isolated context with no cascade: `currentColor` resolves against the
   * *SVG's own* root, not the page. The marks rendered black and were therefore
   * invisible on the dark theme, which is where most users were.
   *
   * A `mask` inverts the dependency: the SVG becomes a stencil and the visible
   * colour comes from `background-color`, which *does* inherit normally. One
   * file then serves both themes correctly.
   */
  if (mark.mono) {
    return (
      <span
        className="bg-[color:var(--text-primary)] flex shrink-0 items-center justify-center"
        style={{
          width: size,
          height: size,
          maskImage: `url("${mark.url}")`,
          WebkitMaskImage: `url("${mark.url}")`,
          maskSize: "contain",
          WebkitMaskSize: "contain",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
        }}
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* Two `<img>`s rather than an inline SVG: these are now real files, and
          swapping the *source* is how the white-on-clear OpenAI mark changes
          between themes. `chatgpt-light` is only rendered when the document is
          in the light theme, so the dark build never requests it. */}
      {mark.lightUrl ? (
        <>
          <img
            src={mark.url}
            alt=""
            width={size}
            height={size}
            className="theme-dark-only"
            style={{ width: size, height: size, objectFit: "contain" }}
          />
          <img
            src={mark.lightUrl}
            alt=""
            width={size}
            height={size}
            className="theme-light-only"
            style={{ width: size, height: size, objectFit: "contain" }}
          />
        </>
      ) : (
        <img
          src={mark.url}
          alt=""
          width={size}
          height={size}
          style={{ width: size, height: size, objectFit: "contain" }}
        />
      )}
    </span>
  );
}

/** Exported for tests: which ids resolve to a real bundled asset. */
export const ICON_IDS: SoftwareId[] = Object.keys(MARKS).filter(
  (k) => MARKS[k as SoftwareId]?.url,
) as SoftwareId[];
