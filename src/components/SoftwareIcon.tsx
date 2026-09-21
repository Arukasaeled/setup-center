/**
 * Software icons.
 *
 * ## History, because this file has been wrong twice
 *
 * **v1** drew a *resemblance* of each logo — a hand-authored 24×24 path in the
 * vendor's brand colour. That is what produced the complaint "图标不要用简称，
 * 直接用官方 logo" and "AI 味太重": a redrawn approximation reads as a
 * placeholder pretending to be a logo.
 *
 * **v2** replaced them with real vendor assets but imported seven of them as
 * `foo.svg?url`. That is the load-bearing mistake. `?url` returns the *source
 * path as a string* rather than registering the file as a build asset, so after
 * bundling those paths pointed at nothing and the icons silently fell back to
 * the v1 drawings. The screenshot showing hexagons and monochrome starbursts
 * was a *stale render of the fallback path*, not a missing asset. The fix is
 * plain static imports below, plus the asset assertion in `tools/ui-verify.mjs`
 * that would have caught it (it now checks the bundle really contains each
 * file).
 *
 * ## The render strategies, and why they are not interchangeable
 *
 * The assets are not uniform, and pretending otherwise is how icons go
 * invisible. They split by what colour information they carry — verified by
 * reading every file, not assumed from its filename:
 *
 * | group                 | ids                                  | rendered as      |
 * |-----------------------|--------------------------------------|------------------|
 * | brand colour          | git python node docker cmake claude  | `<img>` as-is    |
 * | brand colour (square) | npm pnpm uv                          | `<img>` as-is    |
 * | brand gradient        | codex gemini                         | `<img>` as-is    |
 * | brand colour (raster) | vscode wsl                           | `<img>` as-is    |
 * | `currentColor`        | cursor windsurf lmstudio opencode    | CSS mask, themed |
 * | white or black glyph  | continue rust java jetbrains chatgpt | CSS mask, themed |
 *
 * **Why the stencil groups must be masked, not tinted.** A document loaded
 * through `<img>` is an isolated context with no cascade: `currentColor`
 * resolves against the *SVG's own* root, so setting the parent's text colour
 * does nothing, a hard-coded `#000000` is simply black, and `fill="white"` is
 * white. On the dark theme's `#0c0e11` surface black is invisible; on the light
 * theme's paper white is. A CSS `mask` inverts the dependency: the SVG becomes
 * a stencil and the visible colour comes from `background-color`, which *does*
 * inherit normally. One file then serves both themes.
 *
 * Two entries are easy to mis-sort by filename alone:
 *
 * - **ChatGPT** declares no `fill` at all, so it inherits the SVG root default
 *   of black. It looks like a coloured logo and is not one.
 * - **Continue** ships `fill="white"`. It is legible on dark and invisible on
 *   light — the mirror image of the usual bug. It is a stencil too.
 *
 * ## Provenance
 *
 * Every mark is the vendor's own published asset, fetched from the vendor's own
 * repository or distribution — never a third-party icon site, never a webpage
 * screenshot, never fetched at runtime. `NO_BRAND_ASSET` below is the only place
 * a letter tile is legitimate, and it is asserted to be disjoint from `MARKS`.
 *
 * ## Scope
 *
 * A pure UI component: it maps an id to an asset and draws it. It takes no
 * decision about installation, profiles, permissions or detection state — that
 * separation is why the install screen and the software list can share it.
 */

import type { SoftwareId } from "../lib/types";

// NOTE: no `?url` on any of these. See the history above — that suffix is what
// made the bundled paths dangle and the icons fall back to placeholder art.
import vscodeUrl from "../assets/software/vscode.png";
import wslUrl from "../assets/software/wsl.png";
import claudeUrl from "../assets/software/claude.svg";
import chatgptUrl from "../assets/software/chatgpt.svg";
import codexUrl from "../assets/software/codex.svg";
import geminiUrl from "../assets/software/gemini.svg";
import continueUrl from "../assets/software/continue.svg";
import gitUrl from "../assets/software/git.svg";
import pythonUrl from "../assets/software/python.svg";
import nodeUrl from "../assets/software/nodedotjs.svg";
import dockerUrl from "../assets/software/docker.svg";
import cmakeUrl from "../assets/software/cmake.svg";
import npmUrl from "../assets/software/npm.svg";
import pnpmUrl from "../assets/software/pnpm.svg";
import uvUrl from "../assets/software/uv.svg";
import cursorUrl from "../assets/software/cursor.svg";
import windsurfUrl from "../assets/software/windsurf.svg";
import lmstudioUrl from "../assets/software/lmstudio.svg";
import opencodeUrl from "../assets/software/opencode.svg";
import rustUrl from "../assets/software/rust.svg";
import javaUrl from "../assets/software/openjdk.svg";
import jetbrainsUrl from "../assets/software/jetbrains.svg";
import kimiCliUrl from "../assets/software/kimi_cli.png";
import crushUrl from "../assets/software/crush.png";
import ccSwitchUrl from "../assets/software/cc_switch.png";

interface Mark {
  url: string;
  /** Single-colour glyph: render as a themed stencil rather than a picture. */
  stencil?: boolean;
}

const MARKS: Partial<Record<SoftwareId, Mark>> = {
  // --- Editors -------------------------------------------------------------
  // VS Code's own 256px asset is already brand blue on alpha; no theme work.
  vscode: { url: vscodeUrl },
  cursor: { url: cursorUrl, stencil: true },
  windsurf: { url: windsurfUrl, stencil: true },
  jetbrains: { url: jetbrainsUrl, stencil: true },

  // --- AI clients ----------------------------------------------------------
  claude_desktop: { url: claudeUrl },
  claude_code: { url: claudeUrl },
  // The real standalone Codex mark — a purple→blue gradient square. v2 wrongly
  // shared OpenAI's mark here because I could not find this asset; it exists.
  codex: { url: codexUrl },
  // OpenAI's published mark is a *glyph*: no `fill` attribute at all, so it
  // inherits black and disappears on dark. The harness caught this as the one
  // `naturalWidth === 0` failure among 17 marks.
  chatgpt_desktop: { url: chatgptUrl, stencil: true },
  gemini: { url: geminiUrl },
  lm_studio: { url: lmstudioUrl, stencil: true },
  opencode: { url: opencodeUrl, stencil: true },
  // Ships `fill="white"`: legible on dark, invisible on light. Stencil.
  continue: { url: continueUrl, stencil: true },
  // The three marks added with the Chinese / Charm agents and CC Switch. Each
  // is the vendor's own published asset, taken from the vendor's repository:
  // `MoonshotAI/kimi-cli` (`web/public/logo.png`),
  // `charmbracelet/crush` (`internal/ui/notification/crush-icon.png`) and
  // `farion1231/cc-switch` (`src-tauri/icons/128x128.png`). All three carry
  // their own colour, so none is a stencil.
  //
  // Qwen Code is deliberately absent — see `NO_BRAND_ASSET`.
  kimi_cli: { url: kimiCliUrl },
  crush: { url: crushUrl },
  cc_switch: { url: ccSwitchUrl },

  // --- Runtimes ------------------------------------------------------------
  python: { url: pythonUrl },
  node: { url: nodeUrl },
  rust: { url: rustUrl, stencil: true },
  java: { url: javaUrl, stencil: true },

  // --- Package managers ----------------------------------------------------
  npm: { url: npmUrl },
  pnpm: { url: pnpmUrl },
  uv: { url: uvUrl },

  // --- Tools ---------------------------------------------------------------
  git: { url: gitUrl },
  docker: { url: dockerUrl },
  cmake: { url: cmakeUrl },
  wsl: { url: wslUrl },
};

/**
 * Ids that intentionally have no bundled asset.
 *
 * Two, and both are Microsoft components whose mark this repository has no
 * distributable copy of — `msvc_build_tools` since the beginning, and
 * `windows_terminal` when it was added to the catalog. Inventing artwork for
 * them would be the v1 mistake again, and fetching one at runtime is ruled out
 * by the "never fetched" rule above.
 *
 * Listed explicitly so "missing icon" is a decision on the record rather than an
 * oversight — `tools/ui-verify.mjs` asserts this list and `MARKS` are disjoint
 * and together cover every id, so adding a software entry without an icon fails
 * loudly instead of rendering an invisible row.
 */
export const NO_BRAND_ASSET: SoftwareId[] = [
  "msvc_build_tools",
  "windows_terminal",
  // Qwen Code publishes no standalone logo file: its repository
  // (`QwenLM/qwen-code`) carries only documentation screenshots, and the rule
  // above forbids substituting a third-party icon or redrawing one. So this is
  // a recorded decision rather than an oversight.
  "qwen_code",
];

/**
 * Fallback tile.
 *
 * Neutral and quiet: a bordered square with the product's initial. Deliberately
 * *not* brand-coloured — the point is to signal "no official artwork for this"
 * rather than to fake one.
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

  if (mark.stencil) {
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
      <img
        src={mark.url}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    </span>
  );
}

/** Exported for tests: which ids resolve to a real bundled asset. */
export const ICON_IDS: SoftwareId[] = Object.keys(MARKS).filter(
  (k) => MARKS[k as SoftwareId]?.url,
) as SoftwareId[];
