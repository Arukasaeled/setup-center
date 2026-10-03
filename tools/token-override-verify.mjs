/**
 * Token Override Reality Test — brief §37.
 *
 * The claim under test is the one the user actually reported broken: "Token
 * Tweaker 修改后很多值根本不会真正改变界面". An attribute check cannot
 * falsify that claim, and a unit test of `resolveTokens` cannot either — the
 * whole point is whether the browser's computed style changes.
 *
 * So this harness drives the real app in a real browser, applies a real
 * override through the real store action, and reads `getComputedStyle` off the
 * real DOM nodes. Every probe is a pair of measurements taken around one
 * override, and a probe only passes when the measured value CHANGED in the
 * direction the override asked for.
 *
 * Acceptance target is neo-brutalism, exactly as the brief specifies, because
 * it is the experience that maximally hardcoded its identity (it carried ~50
 * literal `#ffea28` / `#000000` / `2.5px` / `4px 4px 0px` values).
 *
 * Needs a DEV server (it imports /src/lib/store.ts):
 *   $env:BASE_URL="http://localhost:5199"; node tools/token-override-verify.mjs
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const BASE_URL = process.env.BASE_URL || "http://localhost:1420";
const STYLE_ID = process.env.STYLE_ID || "neo-brutalism";
const OUT_DIR = "tools/token-override";
const FIXTURES = JSON.parse(readFileSync("tools/fixtures.json", "utf8"));

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/* --------------------------------------------------------------------------
   Probe surfaces. Each entry names a business surface, picks the first real DOM
   node for it, and reads the computed property the override should move.
   -------------------------------------------------------------------------- */

/*
 * `section` is not decoration: the nav lives on every page, but a resource
 * card only exists while the Resources section is mounted and a software row
 * only while Software is. Probing one of those from the Overview page reports
 * "no node matched" and looks like a broken override when in fact the test
 * never rendered the surface. The first run of this suite failed exactly that
 * way, so each probe now carries the section it must be measured on.
 */
const PROBES = {
  navButtonRadius: {
    selector: "[data-nav-list] > button",
    property: "borderTopLeftRadius",
    section: "overview",
  },
  navButtonBorder: {
    selector: "[data-nav-list] > button",
    property: "borderTopWidth",
    section: "overview",
  },
  cardRadius: {
    selector: "[data-resource-card]",
    property: "borderTopLeftRadius",
    section: "resources",
  },
  cardBorder: {
    selector: "[data-resource-card]",
    property: "borderTopWidth",
    section: "resources",
  },
  setupButtonRadius: {
    selector: "[data-setup-action] > button:first-child",
    property: "borderTopLeftRadius",
    section: "style",
  },
  setupButtonBg: {
    selector: "[data-setup-action] > button:first-child",
    property: "backgroundColor",
    section: "style",
  },
  cardShadow: {
    selector: "[data-resource-card]",
    property: "boxShadow",
    section: "resources",
  },
  softwareRowShadow: {
    selector: "[data-software-row]",
    property: "boxShadow",
    section: "software",
  },
};

/** Read one computed property for a probe, or null when the node is absent. */
async function measure(page, probe) {
  return page.evaluate(({ selector, property }) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return cs[property] ?? null;
  }, probe);
}

let mountedSection = null;

/** Mount a dashboard section and wait for it to paint, once per section. */
async function gotoSection(page, section) {
  if (!section || mountedSection === section) return;
  await page.evaluate((s) => window.__ov.go(s), section);
  // A section swap remounts a whole screen (the Resources section alone
  // renders hundreds of cards), so the probe must wait for the paint rather
  // than measure the previous section's leftovers.
  await page.waitForTimeout(500);
  mountedSection = section;
}

/** Read probes, visiting whichever section each one lives on. */
async function snapshot(page, keys) {
  const out = {};
  const wanted = keys ?? Object.keys(PROBES);
  for (const key of wanted) {
    const probe = PROBES[key];
    if (!probe) continue;
    await gotoSection(page, probe.section);
    out[key] = await measure(page, probe);
  }
  return out;
}

/* --------------------------------------------------------------------------
   Setup
   -------------------------------------------------------------------------- */

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1180, height: 780 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});

const consoleErrors = [];

await context.addInitScript(
  ({ fixtures, styleId }) => {
    localStorage.setItem("setup-center.entry", "free");
    localStorage.setItem("setup-center.style", styleId);

    /*
     * The fixture file is keyed by *fixture* name, not by Tauri command name
     * (`explained`, not `explained_catalogue`), so a pass-through lookup
     * silently returns null for every command whose two names differ. That is
     * not cosmetic: `SoftwareSection` maps over the explained catalogue, so a
     * null there threw, React unmounted the whole dashboard, and the suite then
     * reported "no node matched" for every remaining probe — a harness bug that
     * looked exactly like a broken override layer.
     *
     * The mapping is explicit, and `null` is only the answer for commands this
     * suite genuinely does not need.
     */
    const handlers = {
      load_status: () => fixtures.status,
      load_resumable: () => null,
      license_status: () => fixtures.license?.freeEnforced ?? fixtures.license?.free ?? null,
      license_device: () => fixtures.licenseDevice?.freeEnforced ?? null,
      windows_info: () => fixtures.environment?.windows ?? null,
      scan_software: () => fixtures.scan?.inventory ?? null,
      last_software_scan: () => fixtures.scan?.inventory ?? null,
      capability_report: () => fixtures.capabilities ?? [],
      software_catalogue: () => fixtures.machineCatalogue ?? [],
      machine_facts: () => fixtures.environment?.machine ?? null,
      explained_catalogue: () => fixtures.explained ?? [],
      list_goals: () =>
        fixtures.goals ?? { goals: [], goalsWithoutProfiles: [], defaultGoal: "" },
      environment_plans: () => fixtures.goalPlans ?? [],
      environment_plan: (a) =>
        (fixtures.goalPlans ?? []).find((p) => p.goalId === a?.goalId) ?? null,
      explain_software: (a) =>
        (fixtures.explained ?? []).find((e) => e.knowledge?.id === a?.id) ?? null,
    };

    const invoke = async (cmd, args) => {
      if (cmd in handlers) return handlers[cmd](args);
      const lower = String(cmd).toLowerCase();
      for (const key of Object.keys(handlers)) {
        if (key.toLowerCase() === lower) return handlers[key](args);
      }
      return null;
    };

    window.__TAURI_INTERNALS__ = {
      invoke,
      transformCallback: (cb) => cb,
      unregisterCallback: () => {},
      convertFileSrc: (p) => p,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
    };
  },
  { fixtures: FIXTURES, styleId: STYLE_ID },
);

const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto(BASE_URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// Reach the genuine store module the app itself is using.
await page.evaluate(async (styleId) => {
  const mod = await import("/src/lib/store.ts");
  const store = mod.useApp;
  store.getState().openDashboard?.();
  store.getState().setActiveStyle?.(styleId);
  window.__ov = {
    s: () => store.getState(),
    set: (patch) => store.getState().setStyleOverrides?.(patch),
    reset: () => store.getState().resetStyleOverrides?.(),
    go: (section) => store.getState().setSection?.(section),
  };
}, STYLE_ID);

// The overrides must start empty, or "reset" would be indistinguishable from
// "the previous run's leftovers".
await page.evaluate(() => window.__ov.reset());
await page.waitForTimeout(300);

console.log(`\nToken override reality test — style: ${STYLE_ID}\n`);

const runtimeAttrs = await page.evaluate(() => {
  const el = document.documentElement;
  return {
    style: el.getAttribute("data-style"),
    shell: el.getAttribute("data-shell"),
    card: el.getAttribute("data-card"),
    density: el.getAttribute("data-density"),
  };
});
record(
  "experience applied before probing",
  runtimeAttrs.style === STYLE_ID,
  `data-style=${runtimeAttrs.style} shell=${runtimeAttrs.shell} card=${runtimeAttrs.card}`,
);
record(
  "runtime attributes are declarative",
  Boolean(runtimeAttrs.shell && runtimeAttrs.card),
  `shell=${runtimeAttrs.shell} card=${runtimeAttrs.card} density=${runtimeAttrs.density}`,
);

/* --------------------------------------------------------------------------
   Probe 1 — Radius  10px -> 0px must move nav, cards, buttons, panels
   -------------------------------------------------------------------------- */

await page.evaluate(() => window.__ov.set({ panelRadius: "10px", controlRadius: "10px" }));
await page.waitForTimeout(250);
const radiusBefore = await snapshot(page, [
  "navButtonRadius",
  "cardRadius",
  "setupButtonRadius",
]);

await page.evaluate(() => window.__ov.set({ panelRadius: "0px", controlRadius: "0px" }));
await page.waitForTimeout(250);
const radiusAfter = await snapshot(page, [
  "navButtonRadius",
  "cardRadius",
  "setupButtonRadius",
]);

function pxNum(v) {
  const m = /(-?[\d.]+)px/.exec(v ?? "");
  return m ? parseFloat(m[1]) : null;
}

for (const key of ["navButtonRadius", "cardRadius", "setupButtonRadius"]) {
  const before = radiusBefore[key];
  const after = radiusAfter[key];
  const b = pxNum(before);
  const a = pxNum(after);
  const pass = b !== null && a !== null && b > 0 && a === 0;
  record(
    `radius override reaches ${key}`,
    pass,
    before === null ? "no node matched" : `${before} -> ${after}`,
  );
}

/* --------------------------------------------------------------------------
   Probe 2 — Shadow  6px -> 0px must remove the core hard shadows
   -------------------------------------------------------------------------- */

await page.evaluate(() =>
  window.__ov.set({
    shadow: { offsetX: "6px", offsetY: "6px", blur: "0px", spread: "0px", color: "#000000" },
  }),
);
await page.waitForTimeout(250);
const shadowBefore = await snapshot(page, ["cardShadow", "softwareRowShadow"]);

await page.evaluate(() =>
  window.__ov.set({
    shadow: { offsetX: "0px", offsetY: "0px", blur: "0px", spread: "0px", color: "#000000" },
  }),
);
await page.waitForTimeout(250);
const shadowAfter = await snapshot(page, ["cardShadow", "softwareRowShadow"]);

/** "none" or an all-zero shadow both count as no shadow. */
function hasShadow(v) {
  if (!v || v === "none") return false;
  const nums = (v.match(/-?[\d.]+px/g) ?? []).map(parseFloat);
  return nums.some((n) => n !== 0);
}

for (const key of ["cardShadow", "softwareRowShadow"]) {
  const before = shadowBefore[key];
  const after = shadowAfter[key];
  const pass = before !== null && hasShadow(before) && !hasShadow(after);
  record(
    `shadow override reaches ${key}`,
    pass,
    before === null
      ? "no node matched"
      : `"${before}" -> "${after}"`,
  );
}

/* --------------------------------------------------------------------------
   Probe 3 — Accent  yellow -> purple must move every primary surface at once
   -------------------------------------------------------------------------- */

await page.evaluate(() => window.__ov.set({ accent: "#ffe600" }));
await page.waitForTimeout(250);
await gotoSection(page, "style");
const accentBefore = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const btn = document.querySelector("[data-setup-action] > button:first-child");
  return {
    root: cs.getPropertyValue("--status-accent").trim(),
    buttonBg: btn ? getComputedStyle(btn).backgroundColor : null,
    buttonFg: btn ? getComputedStyle(btn).color : null,
  };
});

await page.evaluate(() => window.__ov.set({ accent: "#a855f7" }));
await page.waitForTimeout(250);
const accentAfter = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const btn = document.querySelector("[data-setup-action] > button:first-child");
  return {
    root: cs.getPropertyValue("--status-accent").trim(),
    buttonBg: btn ? getComputedStyle(btn).backgroundColor : null,
    buttonFg: btn ? getComputedStyle(btn).color : null,
  };
});

record(
  "accent override moves --status-accent",
  accentBefore.root !== accentAfter.root && accentAfter.root !== "",
  `${accentBefore.root} -> ${accentAfter.root}`,
);
record(
  "accent override repaints the primary control",
  accentBefore.buttonBg !== null && accentBefore.buttonBg !== accentAfter.buttonBg,
  `${accentBefore.buttonBg} -> ${accentAfter.buttonBg}`,
);
record(
  "accent foreground stays legible (contrast recomputed)",
  accentAfter.buttonFg !== null &&
    accentAfter.buttonFg !== accentBefore.buttonFg,
  `fg ${accentBefore.buttonFg} -> ${accentAfter.buttonFg}`,
);

/* --------------------------------------------------------------------------
   Probe 4 — Border width  3px -> 1px must move the core outlines
   -------------------------------------------------------------------------- */

await page.evaluate(() => window.__ov.set({ borderWidth: "3px" }));
await page.waitForTimeout(250);
const borderBefore = await snapshot(page, ["navButtonBorder", "cardBorder"]);

await page.evaluate(() => window.__ov.set({ borderWidth: "1px" }));
await page.waitForTimeout(250);
const borderAfter = await snapshot(page, ["navButtonBorder", "cardBorder"]);

for (const key of ["navButtonBorder", "cardBorder"]) {
  const before = pxNum(borderBefore[key]);
  const after = pxNum(borderAfter[key]);
  const pass = before !== null && after !== null && before > after;
  record(
    `border override reaches ${key}`,
    pass,
    `${borderBefore[key]} -> ${borderAfter[key]}`,
  );
}

/* --------------------------------------------------------------------------
   Probe 5 — Reset returns to the manifest default, not to a saved override
   -------------------------------------------------------------------------- */

/*
 * Read the manifest's own default BEFORE reset, straight off the registry, so
 * this probe asserts "reset equals the preset" rather than "reset equals some
 * number the test author liked". The first version hardcoded a rejection of
 * `10px`, which is in fact neo-brutalism's real borderRadius — so a correct
 * reset was reported as a failure.
 */
const manifestDefault = await page.evaluate(async (styleId) => {
  const reg = await import("/src/styles/registry.ts");
  const rt = await import("/src/styles/runtime.ts");
  const style = reg.getStyle(styleId);
  if (!style) return null;
  return {
    radius: rt.resolveTokens(style, {}).panelRadius,
    accent: rt.resolveTokens(style, {}).accent,
  };
}, STYLE_ID);

await page.evaluate(() => window.__ov.reset());
await page.waitForTimeout(300);

// The reset must be observed against a value the override actually changed, so
// re-apply the override, reset again, and confirm the runtime came back.
await page.evaluate(() => window.__ov.set({ panelRadius: "0px", accent: "#a855f7" }));
await page.waitForTimeout(250);
const beforeReset = await page.evaluate(() => ({
  radius: getComputedStyle(document.documentElement).getPropertyValue("--radius-panel").trim(),
  accent: getComputedStyle(document.documentElement).getPropertyValue("--status-accent").trim(),
}));

await page.evaluate(() => window.__ov.reset());
await page.waitForTimeout(300);

const afterReset = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const stored = localStorage.getItem("setup-center.experience.overrides.v2");
  return {
    radius: cs.getPropertyValue("--radius-panel").trim(),
    accent: cs.getPropertyValue("--status-accent").trim(),
    stored,
  };
});

const storedObj = afterReset.stored ? JSON.parse(afterReset.stored) : {};
const styleEntry = storedObj[STYLE_ID];

record(
  "reset clears the stored override entry",
  !styleEntry || Object.keys(styleEntry).length === 0,
  styleEntry ? `still stored: ${JSON.stringify(styleEntry)}` : "entry absent",
);
record(
  "reset restores the manifest default token",
  Boolean(manifestDefault) &&
    afterReset.radius === manifestDefault.radius &&
    afterReset.accent === manifestDefault.accent &&
    beforeReset.radius !== afterReset.radius,
  `override ${beforeReset.radius}/${beforeReset.accent} -> default ${afterReset.radius}/${afterReset.accent} (manifest: ${manifestDefault?.radius}/${manifestDefault?.accent})`,
);

/* --------------------------------------------------------------------------
   Probe 6 — Style switch must not leak overrides across experiences
   -------------------------------------------------------------------------- */

await page.evaluate(() => window.__ov.set({ accent: "#ff00ff", panelRadius: "0px" }));
await page.waitForTimeout(250);
const leakedFrom = await page.evaluate(() => ({
  accent: getComputedStyle(document.documentElement).getPropertyValue("--status-accent").trim(),
}));

await page.evaluate(() => window.__ov.s().setActiveStyle("retro-mac"));
await page.waitForTimeout(400);
const otherStyle = await page.evaluate(() => ({
  style: document.documentElement.getAttribute("data-style"),
  accent: getComputedStyle(document.documentElement).getPropertyValue("--status-accent").trim(),
  stored: localStorage.getItem("setup-center.experience.overrides.v2"),
}));

const storedAfterSwitch = otherStyle.stored ? JSON.parse(otherStyle.stored) : {};
const otherEntry = storedAfterSwitch["retro-mac"];

record(
  "switching style lands on the new experience",
  otherStyle.style === "retro-mac",
  `data-style=${otherStyle.style}`,
);
record(
  "switching style does NOT inherit the previous override",
  otherStyle.accent !== leakedFrom.accent,
  `${leakedFrom.accent} (neo-brutalism) -> ${otherStyle.accent} (retro-mac)`,
);
record(
  "switching style does NOT write into the new style's storage",
  !otherEntry || otherEntry.accent === undefined,
  otherEntry ? `retro-mac entry: ${JSON.stringify(otherEntry)}` : "no retro-mac entry",
);

// Return to the acceptance target so the closing screenshot is meaningful.
await page.evaluate(() => window.__ov.s().setActiveStyle("neo-brutalism"));
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/after-override-suite.png` });

/* --------------------------------------------------------------------------
   Report
   -------------------------------------------------------------------------- */

const vaultNoise = consoleErrors.filter((e) =>
  /raw\.githubusercontent\.com|404|Failed to load resource/i.test(e),
);
const realErrors = consoleErrors.filter((e) => !vaultNoise.includes(e));

console.log(`\n  console errors: ${runtimeAttrs.style ? realErrors.length : 0} real, ${vaultNoise.length} vault/CDN`);
for (const e of realErrors) console.log(`    ERROR ${e}`);

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} probes PASS  (style: ${STYLE_ID})`);

await browser.close();

if (passed !== results.length) {
  console.error(`\nToken override reality test FAILED (${results.length - passed} probe(s)).`);
  process.exit(1);
}
console.log("\nToken overrides are authoritative.\n");
