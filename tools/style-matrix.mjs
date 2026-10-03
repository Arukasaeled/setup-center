// Experience screenshot matrix — the artifact that makes "these styles are
// actually different products" checkable instead of asserted.
//
// WHY THIS EXISTS
//
// The whole point of the Experience refactor is that switching a style changes
// the *shape* of the product, not just its colours. That claim cannot be
// verified by reading a diff: a stylesheet that sets `--radius-panel` in a
// dozen places looks impressive and may still render the same left-rail layout
// twenty times. So this script applies each experience for real, walks the same
// three pages, and writes one PNG per (experience, page) pair.
//
// It also writes a GRAYSCALE copy of every shot. Colour is the cheapest way to
// look different, and the brief's acceptance gate is explicitly the opposite:
// two experiences must remain distinguishable when colour is removed. Running
// the same shot through `filter: grayscale(1)` turns that gate into an
// artifact a human can check in two seconds rather than an argument.
//
// This driver needs the *dev* server, not `vite preview`: it reaches the
// running app's store by importing `/src/lib/store.ts`, which only exists as a
// module in dev. Against a production build that import 404s and falls back to
// index.html, so the boot below fails loudly rather than screenshotting the
// wrong surface.
//
// Run: node tools/style-matrix.mjs            (needs `npm run dev`, see BASE_URL)
//      BASE_URL=http://localhost:5199 node tools/style-matrix.mjs
//      STYLES=neo-brutalism,dos-utility node tools/style-matrix.mjs
//      PAGES=style node tools/style-matrix.mjs
//      GRAYSCALE=0 node tools/style-matrix.mjs

import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "tools", "style-matrix");
mkdirSync(outDir, { recursive: true });

const fixturePath = join(here, "fixtures.json");
if (!existsSync(fixturePath)) {
  console.error("missing fixtures.json -- run `cargo run --bin probe` first");
  process.exit(1);
}
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

/**
 * The experiences worth a full page set.
 *
 * These are the eight the brief names as flagship, i.e. the ones whose claim is
 * "this is a different product" rather than "this is a different palette".
 *
 * The set is every experience that declares a Tier-3/Tier-4 grammar — i.e. one
 * that changes composition, card or shell, not just tokens. The four remaining
 * registry entries (default, academic-lab, monochrome-research, y2k-digital)
 * are Tier-1/Tier-2 token themes whose whole difference IS the palette and the
 * control style; a swatch grid communicates those better than a screenshot, and
 * including them would pad the artifact with near-duplicate outlines. They can
 * still be captured on demand: `STYLES=academic-lab node tools/style-matrix.mjs`.
 */
const DEFAULT_STYLES = [
  "neo-brutalism",
  "japanese-editorial",
  "retro-mac",
  "dos-utility",
  "spatial-glass",
  "phantom-comic",
  "blueprint",
  "newspaper-editorial",
  "nordic-frost",
  "swiss-dark",
  "swiss-editorial",
  "soft-product-minimal",
  "cyber-neon",
  "industrial-console",
  "terminal-crt",
  "bauhaus",
];

const DEFAULT_PAGES = ["overview", "resources", "style"];

const styles = (process.env.STYLES ?? DEFAULT_STYLES.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const pages = (process.env.PAGES ?? DEFAULT_PAGES.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const wantGrayscale = process.env.GRAYSCALE !== "0";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";

const failures = [];
const written = [];

function record(ok, name, detail = "") {
  if (!ok) failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

/**
 * Boot the production frontend headless with the Tauri backend stubbed.
 *
 * The handler table is deliberately minimal: this script only needs the
 * dashboard to render, so commands it never exercises answer `null` and the
 * screens degrade to their empty states. That is fine for layout comparison —
 * an empty list still has a shape.
 */
async function boot() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1180, height: 780 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.addInitScript(
    ({ data }) => {
      // Answer the activation gate up front so a cold load lands in the app.
      window.localStorage.setItem("setup-center.entry", "free");
      const handlers = {
        load_status: () => data.status,
        load_resumable: () => null,
        license_status: () => data.license.freeEnforced,
        license_device: () => data.licenseDevice?.freeEnforced ?? null,
        windows_info: () => data.environment.windows,
        scan_software: () => data.scan.inventory,
        last_software_scan: () => data.scan.inventory,
        capability_report: () => data.capabilities ?? [],
        software_catalogue: () => data.machineCatalogue ?? [],
        machine_facts: () => data.environment?.machine ?? null,
        explained_catalogue: () => data.explained ?? [],
        list_goals: () =>
          data.goals ?? { goals: [], goalsWithoutProfiles: [], defaultGoal: "" },
        environment_plan: () => null,
        environment_plans: () => data.goalPlans ?? [],
        list_profiles: () => data.profiles,
        detection_report: () => data.environment,
        detect_environment: () => data.environment,
        run_detection: () => data.environment,
        execution_readiness: () => data.readiness,
        knowledge_status: () => data.knowledgeStatus,
        advisor_summary: () => data.advisor,
        advisor_report_text: () => data.advisorText ?? "",
        localization_targets: () => data.localizationTargets ?? [],
        resumable_install: () => null,
        last_install_session: () => null,
        resumable_bootstrap: () => null,
        last_bootstrap: () => null,
        vault_status: () => null,
        vault_sync: () => null,
      };
      window.__TAURI_INTERNALS__ = {
        invoke: (cmd, args) => {
          const h = handlers[cmd];
          if (!h) return Promise.resolve(null);
          try {
            return Promise.resolve(h(args));
          } catch (e) {
            return Promise.reject(e);
          }
        },
        transformCallback: (cb) => cb,
        unregisterCallback: () => {},
        convertFileSrc: (p) => p,
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
      };
    },
    { data: fixtures },
  );

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  // The gate is answered in localStorage above, but a build that decides to
  // show it anyway must not silently produce twenty shots of the gate.
  if (await page.locator('[data-testid="gate-heading"]').isVisible().catch(() => false)) {
    await page.locator('[data-testid="gate-free"]').click();
    await page.waitForTimeout(600);
  }

  // Reach the store the running app is using. Importing the module (rather than
  // expecting a global) gives the genuine instance, because Vite serves one
  // module instance to both the app and this evaluate().
  await page.evaluate(async () => {
    const store = (await import("/src/lib/store.ts")).useApp;
    window.__matrix = {
      s: () => store.getState(),
      setActiveStyle: (id) => store.getState().setActiveStyle(id),
      setSection: (section) => store.getState().setSection(section),
      openDashboard: () => store.getState().openDashboard(),
      runtime: () => {
        const el = document.documentElement;
        const attrs = {};
        for (const name of [
          "data-style",
          "data-tier",
          "data-shell",
          "data-nav",
          "data-detail",
          "data-card",
          "data-composition",
          "data-density",
          "data-motion",
        ]) {
          attrs[name] = el.getAttribute(name);
        }
        const css = getComputedStyle(el);
        return {
          attrs,
          radiusPanel: css.getPropertyValue("--radius-panel").trim(),
          borderWidth: css.getPropertyValue("--border-width").trim(),
          shadowHard: css.getPropertyValue("--shadow-hard").trim(),
          accent: css.getPropertyValue("--status-accent").trim(),
        };
      },
    };
  });

  await page.evaluate(() => window.__matrix.openDashboard());
  await page.waitForTimeout(600);

  return { browser, page, consoleErrors };
}

/**
 * Apply one experience and capture one page.
 *
 * The grayscale pass is a second screenshot of the same rendered state with a
 * filter on `<html>`. Filtering the live page rather than post-processing the
 * PNG keeps this dependency-free, and it is the same pixels the browser
 * composites — which is the property the outline test cares about.
 */
async function capture(page, styleId, pageName, name) {
  await page.evaluate(
    ({ s, p }) => {
      window.__matrix.setActiveStyle(s);
      window.__matrix.setSection(p);
    },
    { s: styleId, p: pageName },
  );
  // Two frames plus a settle: the runtime writes variables in an effect, and
  // the grammar rules are attribute selectors, so a shot taken too early can
  // catch the previous experience's geometry. Timing out on a state instead of
  // a duration would be nicer; the attribute assertion below is the guard.
  await page.waitForTimeout(450);

  const applied = await page.evaluate((s) => {
    const r = window.__matrix.runtime();
    return { style: r.attrs["data-style"], attrs: r.attrs };
  }, styleId);
  if (applied.style !== styleId) {
    record(false, `${name} applied`, `data-style is ${applied.style}, expected ${styleId}`);
    return null;
  }

  await page.screenshot({ path: join(outDir, `${name}.png`) });
  written.push(`${name}.png`);

  if (wantGrayscale) {
    await page.evaluate(() => {
      document.documentElement.style.setProperty("filter", "grayscale(1)", "important");
    });
    await page.waitForTimeout(120);
    await page.screenshot({ path: join(outDir, `${name}.gray.png`) });
    written.push(`${name}.gray.png`);
    await page.evaluate(() => {
      document.documentElement.style.removeProperty("filter");
    });
  }

  return applied.attrs;
}

const { browser, page, consoleErrors } = await boot();

/** Every capture's runtime attribute row, so the matrix is also machine-readable. */
const manifest = [];

for (const styleId of styles) {
  for (const pageName of pages) {
    const name = `${styleId}--${pageName}`;
    const attrs = await capture(page, styleId, pageName, name);
    if (attrs) {
      manifest.push({ style: styleId, page: pageName, file: `${name}.png`, grammars: attrs });
      record(
        true,
        name,
        `${attrs["data-shell"]} / ${attrs["data-nav"]} / ${attrs["data-card"]} / ${attrs["data-composition"]} / ${attrs["data-density"]} / ${attrs["data-motion"]}`,
      );
    }
  }
}

// A shot of the whole window in each experience is not enough on its own: two
// styles can differ in the shell while sharing every card, or vice versa. The
// distinctness claim is therefore checked here on the attribute row, not on the
// pixels -- the pixels are for the human, the attributes are for the gate.
//
// The signature is grouped per *experience*, not per capture: the three pages
// of one experience are supposed to share a grammar (that is what makes it an
// experience rather than three unrelated layouts). What must not repeat is the
// signature of one experience versus another.
const signatureOf = (attrs) =>
  [
    attrs["data-shell"],
    attrs["data-nav"],
    attrs["data-detail"],
    attrs["data-card"],
    attrs["data-composition"],
    attrs["data-density"],
    attrs["data-motion"],
  ].join("|");

const signatures = new Map();
for (const row of manifest) {
  const key = signatureOf(row.grammars);
  if (!signatures.has(key)) signatures.set(key, new Set());
  signatures.get(key).add(row.style);
}
for (const [key, owners] of signatures) {
  if (owners.size > 1) {
    record(false, "grammar distinctness", `${[...owners].join(" + ")} share ${key}`);
  }
}
record(
  signatures.size === styles.length,
  "every requested experience has a unique grammar signature",
  `${signatures.size} signatures / ${styles.length} experiences`,
);

await page.evaluate(() => {
  document.documentElement.style.removeProperty("filter");
});
await browser.close();

if (consoleErrors.length) {
  record(false, "no console errors", consoleErrors.slice(0, 5).join(" | "));
} else {
  record(true, "no console errors");
}

// The written files are listed so the artifact can be found without guessing a
// naming convention, and so a missing capture is visible in the log itself.
console.log(`\n${written.length} files in tools/style-matrix/`);
if (process.env.VERBOSE === "1") {
  for (const f of written) console.log(`  ${f}`);
}

console.log(
  failures.length
    ? `\n${failures.length} FAILURE(S):\n  ${failures.join("\n  ")}`
    : "\nall checks passed",
);
process.exit(failures.length ? 1 : 0);
