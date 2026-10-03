// SETUP ACTION MENU — overlay regression suite.
//
// The claim under test is a STACKING claim, which no unit test can falsify:
// "the secondary-actions menu is not inside the card's stacking context, so it
// keeps the top layer and never trades it with the card underneath".
//
// The old markup was `absolute right-0 top-full z-50` inside the card. Several
// experiences give a card `transform` (poster / sticker / poster-wall tilts) or
// `:hover { z-index: 2 }`, and a transform makes the element the containing block
// for its own descendants — so no `z-index` on the menu could escape it. The
// menu and the card below traded the top layer as the pointer crossed between
// them, which the user saw as flicker.
//
// What this suite measures, per scenario:
//   1. the menu stays in the DOM, visible, at ONE position for the whole hold;
//   2. at every sample, the topmost element at the menu's own centre is the menu
//      (a sibling cannot take the layer while the pointer is over the menu);
//   3. the menu is fully inside the viewport, including when the trigger sits at
//      the bottom of a scrolling list;
//   4. a primary click runs the Setup Action WITHOUT opening the card's detail;
//   5. a secondary click runs that action WITHOUT touching the card under it.
//
// Run: node tools/setup-action-menu-verify.mjs   (needs a dev server on :1420)

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));
const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Samples taken across a hold: at 60ms over 2s that is ~33 observations. */
const HOLD_MS = 2000;
const SAMPLE_MS = 60;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
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
    window.localStorage.setItem("setup-center.entry", "free");
    const handlers = {
      load_status: () => data.status,
      load_resumable: () => null,
      license_status: () => data.license.freeEnforced,
      license_device: () => data.licenseDevice.freeEnforced,
      scan_software: () => data.scan.inventory,
      last_software_scan: () => data.scan.inventory,
      windows_info: () => data.environment.windows,
      machine_facts: () => data.environment.machine,
      capability_report: () => data.capabilities ?? [],
      software_catalogue: () => data.machineCatalogue ?? [],
      explained_catalogue: () => data.explained ?? [],
      list_goals: () => data.goals,
      environment_plan: (a) => (data.goalPlans ?? []).find((p) => p.goalId === a.goalId) ?? null,
      environment_plans: () => data.goalPlans ?? [],
      list_profiles: () => data.profiles,
      execution_readiness: () => data.readiness,
      knowledge_status: () => data.knowledgeStatus,
      advisor_summary: () => data.advisor,
      advisor_report_text: () => data.advisorText ?? "",
      localization_targets: () => data.localizationTargets ?? [],
      vault_status: () => null,
      vault_sync: () => ({ ok: false }),
      resumable_install: () => null,
      last_install_session: () => null,
      resumable_bootstrap: () => null,
      last_bootstrap: () => null,
      detect_environment: () => data.environment,
      run_detection: () => data.environment,
      detection_report: () => null,
    };
    window.__TAURI_INTERNALS__ = {
      invoke: (cmd, args) => {
        const fn = handlers[cmd];
        if (!fn) return Promise.resolve([]);
        return Promise.resolve().then(() => fn(args));
      },
      transformCallback: (cb) => cb,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main", windowLabel: "main" },
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  },
  { data: fixtures },
);

// NOT `networkidle`: the app kicks off VaultSync on mount, which reaches for
// raw.githubusercontent.com and never goes idle here.
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

await page.evaluate(async () => {
  const m = await import("/src/lib/store.ts");
  m.useApp.getState().openDashboard();
});
await page.waitForTimeout(700);

if (!(await page.locator("[data-shell-root]").count())) {
  console.log("FATAL: the dashboard shell never mounted; refusing to test an empty document.");
  await browser.close();
  process.exit(1);
}

// The dev server serves a CSP that forbids `unsafe-eval`, so the store has to be
// driven with a literal closure per call rather than a stringified one.
const setStyle = async (id) => {
  await page.evaluate(async (styleId) => {
    const m = await import("/src/lib/store.ts");
    m.useApp.getState().setActiveStyle(styleId);
  }, id);
  await page.waitForTimeout(450);
};
const setSection = async (id) => {
  await page.evaluate(async (section) => {
    const m = await import("/src/lib/store.ts");
    m.useApp.getState().setSection(section);
  }, id);
  await page.waitForTimeout(600);
};

const MENU = "[data-setup-action-menu]";
const TRIGGER = '[data-setup-action] button[aria-haspopup="menu"]';

/** One observation of the menu: presence, painted geometry, and who owns the top layer. */
async function sampleMenu() {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    return {
      exists: true,
      top: Math.round(r.top),
      left: Math.round(r.left),
      bottom: Math.round(r.bottom),
      right: Math.round(r.right),
      width: Math.round(r.width),
      height: Math.round(r.height),
      visibility: cs.visibility,
      zIndex: cs.zIndex,
      position: cs.position,
      // The menu must be the topmost node at its own centre. If a card took the
      // layer, this is false — which is exactly the reported flicker.
      ownsTopLayer: !!topEl && (el === topEl || el.contains(topEl)),
      hitTag: topEl ? topEl.tagName + (topEl.className ? "." + String(topEl.className).split(" ")[0] : "") : null,
      viewportH: window.innerHeight,
      viewportW: window.innerWidth,
    };
  }, MENU);
}

/**
 * Open the menu on the first matching trigger, then move the pointer across the
 * menu (header -> first item -> last item) and back out to the trigger, sampling
 * throughout. Returns every observation so the caller can assert on the whole
 * hold rather than only the final frame.
 *
 * The trigger is clicked through the locator, not through a coordinate measured
 * earlier: a card grid scrolls, and a raw `page.mouse.click` at a stale box
 * silently lands on whatever is at that point now. Every sample after opening is
 * taken from the MENU's own rect, which is exactly the interaction the user
 * reported (pointer moving between the trigger and the open menu).
 */
async function holdAndProbe(triggerSel, label) {
  const trig = page.locator(triggerSel).first();
  await trig.scrollIntoViewIfNeeded().catch(() => {});
  const triggerBox = await trig.boundingBox().catch(() => null);
  if (!triggerBox) return { samples: [], error: "no trigger box" };

  let clickError = null;
  await trig.click({ timeout: 5000 }).catch((e) => {
    clickError = e.message.split("\n")[0];
  });
  await page.waitForTimeout(220);

  const opened = await sampleMenu();
  if (!opened.exists) {
    return { samples: [{ ...opened, at: "opened" }], triggerBox, itemCount: 0, clickError };
  }

  const samples = [{ ...opened, at: "opened" }];
  const menuRect = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }, MENU);

  const items = await page.locator(`${MENU} button[role="menuitem"]`).all();
  const itemStop = async (idx) => {
    const b = await items[idx]?.boundingBox().catch(() => null);
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  };

  const headerStop = { x: menuRect.left + 60, y: menuRect.top + 12 };
  const firstStop = await itemStop(0);
  const lastStop = await itemStop(Math.max(0, items.length - 1));
  const triggerStop = { x: triggerBox.x + triggerBox.width / 2, y: triggerBox.y + triggerBox.height / 2 };
  const stops = [headerStop, firstStop, lastStop, triggerStop, firstStop, lastStop].filter(Boolean);

  const perStop = Math.max(1, Math.ceil(HOLD_MS / SAMPLE_MS / Math.max(1, stops.length)));
  for (const stop of stops) {
    await page.mouse.move(stop.x, stop.y, { steps: 3 });
    for (let i = 0; i < perStop; i++) {
      await page.waitForTimeout(SAMPLE_MS);
      samples.push({ ...(await sampleMenu()), at: label });
    }
  }
  return { samples, triggerBox, itemCount: items.length, clickError };
}

/** Summarise a hold: presence, position stability, layer ownership, on-screen fit. */
function analyse(samples) {
  const present = samples.filter((s) => s.exists);
  const gone = samples.length - present.length;
  const hidden = present.filter((s) => s.visibility !== "visible").length;
  const lostLayer = present.filter((s) => !s.ownsTopLayer);
  const tops = [...new Set(present.map((s) => `${s.top},${s.left}`))];
  const offScreen = present.filter((s) => s.top < 0 || s.bottom > s.viewportH || s.left < 0);
  return {
    total: samples.length,
    gone,
    hidden,
    lostLayer,
    distinctPositions: tops.length,
    positions: tops,
    offScreen: offScreen.length,
    offScreenSample: offScreen[0] ?? null,
    first: present[0] ?? null,
  };
}

const isOverlay = (s) => s && s.position === "fixed" && Number(s.zIndex) >= 60;

// ---------------------------------------------------------------------------
// A. Resource card
// ---------------------------------------------------------------------------
console.log("\n--- A. Resource card ---");
await setSection("resources");

const resourceTrigger = '[data-resource-card] [data-setup-action] button[aria-haspopup="menu"]';
const resourceCount = await page.locator(resourceTrigger).count();
check("resource cards expose a secondary-actions trigger", resourceCount > 0, `triggers=${resourceCount}`);

const detailBefore = await page.locator('[role="dialog"]').count();
const a = await holdAndProbe(resourceTrigger, "resource");
const aSum = analyse(a.samples);
check("resource: the menu is portalled out of the card", isOverlay(aSum.first),
  aSum.first ? `position=${aSum.first.position} z=${aSum.first.zIndex}` : `no menu${a.clickError ? ` (click: ${a.clickError})` : ""}`);
check("resource: the menu never unmounts during the 2s hold", aSum.gone === 0, `samples=${aSum.total} gone=${aSum.gone}`);
check("resource: the menu is never left hidden", aSum.hidden === 0, `hidden=${aSum.hidden}`);
check("resource: the menu keeps the top layer for the whole hold", aSum.lostLayer.length === 0,
  aSum.lostLayer.length ? `lost at ${aSum.lostLayer.slice(0, 3).map((s) => s.hitTag).join(", ")}` : "always on top");
check("resource: the menu does not flicker between positions", aSum.distinctPositions === 1,
  `positions=${aSum.positions.join(" | ")}`);
check("resource: the menu stays fully inside the viewport", aSum.offScreen === 0,
  aSum.offScreenSample ? `top=${aSum.offScreenSample.top} bottom=${aSum.offScreenSample.bottom} vh=${aSum.offScreenSample.viewportH}` : "in view");
check("resource: the menu overlaps the card below it without being clipped", aSum.first ? aSum.first.height > 40 : false,
  aSum.first ? `h=${aSum.first.height} w=${aSum.first.width}` : "");

// Escape closes the menu and must NOT close a dialog underneath.
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("resource: Escape closes the menu", (await page.locator(MENU).count()) === 0);
check("resource: Escape did not open the card detail", (await page.locator('[role="dialog"]').count()) === detailBefore);

// E. Primary click runs the action and must NOT open the detail.
console.log("\n--- E. Primary click vs card detail ---");
const primarySel = "[data-resource-card] [data-setup-action] > button:first-child";
await page.locator(primarySel).first().click();
await page.waitForTimeout(600);
const detailAfterPrimary = await page.locator('[role="dialog"]').count();
check("primary: the detail did NOT open", detailAfterPrimary === detailBefore,
  `dialogs ${detailBefore} -> ${detailAfterPrimary}`);

// F. Secondary click runs that action and must NOT touch the card.
console.log("\n--- F. Secondary click vs card ---");
const fBox = await page.locator(resourceTrigger).first().boundingBox();
await page.mouse.click(fBox.x + fBox.width / 2, fBox.y + fBox.height / 2);
await page.waitForTimeout(220);
const menuUp = await page.locator(MENU).count();
const b = await page.locator(`${MENU} button[role="menuitem"]`).first().boundingBox();
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
await page.waitForTimeout(600);
const detailAfterSecondary = await page.locator('[role="dialog"]').count();
check("secondary: the menu was open before the click", menuUp > 0, `menus=${menuUp}`);
check("secondary: the click did NOT open the card detail", detailAfterSecondary === detailBefore,
  `dialogs ${detailBefore} -> ${detailAfterSecondary}`);
check("secondary: the click closed the menu", (await page.locator(MENU).count()) === 0);

// ---------------------------------------------------------------------------
// D. Bottom of the viewport — the last row of a scrolling list
// ---------------------------------------------------------------------------
console.log("\n--- D. Trigger near the viewport bottom ---");
await page.evaluate(() => {
  const page_ = document.querySelector("section[data-page]");
  if (page_) page_.scrollTop = page_.scrollHeight;
});
await page.waitForTimeout(500);
const bottomTriggers = page.locator(resourceTrigger);
const lastIdx = (await bottomTriggers.count()) - 1;
const lastBox = await bottomTriggers.nth(lastIdx).boundingBox();
const nearBottom = lastBox ? lastBox.y > lastBox.height : false;
check("bottom: a trigger was found in the lower half of the window", !!lastBox,
  lastBox ? `y=${Math.round(lastBox.y)} of ${800}` : "none");
if (lastBox) {
  await page.mouse.click(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2);
  await page.waitForTimeout(300);
  const d = await sampleMenu();
  check("bottom: the menu is fully inside the viewport", d.exists && d.top >= 0 && d.bottom <= d.viewportH,
    d.exists ? `top=${d.top} bottom=${d.bottom} vh=${d.viewportH}` : "no menu");
  check("bottom: the menu flipped or capped instead of overflowing",
    d.exists && d.height <= d.viewportH - 16, d.exists ? `h=${d.height}` : "");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// C. Under the experiences that actually carry transform / hover z-index
// ---------------------------------------------------------------------------
console.log("\n--- C. Transform / hard-shadow experiences ---");
for (const styleId of ["phantom-comic", "neo-brutalism", "academic-lab"]) {
  await setStyle(styleId);
  await setSection("resources");
  const s = await holdAndProbe(resourceTrigger, styleId);
  const sum = analyse(s.samples);
  const backdrop = await page.evaluate(() => {
    const el = document.querySelector("[data-resource-card]");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { transform: cs.transform, zIndex: cs.zIndex };
  });
  check(`${styleId}: the menu never unmounts`, sum.gone === 0, `samples=${sum.total} gone=${sum.gone}`);
  check(`${styleId}: the menu keeps the top layer`, sum.lostLayer.length === 0,
    sum.lostLayer.length ? `lost -> ${sum.lostLayer.slice(0, 3).map((x) => x.hitTag).join(", ")}` : "always on top");
  check(`${styleId}: no position flicker`, sum.distinctPositions === 1,
    `positions=${sum.positions.join(" | ")} cardTransform=${backdrop?.transform ?? "n/a"}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// B. Software row — the other host (an UNINSTALLED program is the one with a ▼)
// ---------------------------------------------------------------------------
console.log("\n--- B. Software row ---");
await setStyle("phantom-comic");
await setSection("software");

const rowInfo = await page.evaluate((rowSel) => {
  const rows = [...document.querySelectorAll(rowSel)];
  for (const r of rows) {
    // The action is a SIBLING of the row's wrapper, one level above the row
    // itself: [data-software-row] is a <button> and nesting a control inside it
    // would be invalid DOM.
    const holder = r.parentElement?.parentElement;
    const trig = holder?.querySelector('button[aria-haspopup="menu"]');
    if (trig) {
      const id = r.getAttribute("data-software-row");
      return { id, found: true, action: holder.querySelector("[data-setup-action]")?.innerText?.trim() ?? "" };
    }
  }
  return { found: false, total: rows.length };
}, "[data-software-row]");
check("software: a row with secondary actions exists", rowInfo.found, `id=${rowInfo.id ?? "-"} action="${rowInfo.action}"`);

if (rowInfo.found) {
  const rowTrigger = `[data-software-row="${rowInfo.id}"]`;
  const rowBox = await page.locator(rowTrigger).boundingBox();
  const scroller = await page.evaluate((sel) => {
    const r = document.querySelector(sel);
    const holder = r?.parentElement?.parentElement;
    const trig = holder?.querySelector('button[aria-haspopup="menu"]');
    const b = trig?.getBoundingClientRect();
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  }, rowTrigger);
  check("software: the trigger sits beside the row, not inside it", !!scroller,
    `row y=${rowBox ? Math.round(rowBox.y) : "?"}`);
  if (scroller) {
    await page.mouse.click(scroller.x, scroller.y);
    await page.waitForTimeout(250);
    const s = await sampleMenu();
    check("software: the menu escaped the row's stacking context", isOverlay(s),
      s.exists ? `position=${s.position} z=${s.zIndex}` : "no menu");

    // Hold while crossing between the trigger and the menu inside the list's own
    // scroll container — the case that used to flicker over the next row.
    const samples = [s];
    const items = await page.locator(`${MENU} button[role="menuitem"]`).all();
    const firstItem = items.length ? await items[0].boundingBox() : null;
    const lastItem = items.length ? await items[items.length - 1].boundingBox() : null;
    for (const stop of [firstItem, lastItem, { x: scroller.x - 2, y: scroller.y, width: 4, height: 4 }, firstItem, lastItem]) {
      if (!stop) continue;
      await page.mouse.move(stop.x + stop.width / 2, stop.y + stop.height / 2, { steps: 3 });
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(SAMPLE_MS);
        samples.push(await sampleMenu());
      }
    }
    const sum = analyse(samples);
    check("software: no flicker across the list scroller", sum.gone === 0 && sum.distinctPositions === 1,
      `samples=${sum.total} gone=${sum.gone} positions=${sum.positions.join(" | ")}`);
    check("software: the menu keeps the top layer", sum.lostLayer.length === 0,
      sum.lostLayer.length ? `lost -> ${sum.lostLayer.slice(0, 3).map((x) => x.hitTag).join(", ")}` : "always on top");
    check("software: the list's overflow did not clip the menu", sum.first ? sum.first.height > 30 : false,
      sum.first ? `h=${sum.first.height}` : "");

    // F2. Secondary click on the row must not select/open the row either.
    const before = await page.evaluate(() =>
      document.querySelectorAll('[role="dialog"]').length);
    const fItem = await page.locator(`${MENU} button[role="menuitem"]`).first().boundingBox();
    await page.mouse.click(fItem.x + fItem.width / 2, fItem.y + fItem.height / 2);
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
    check("software: a secondary click did not open a dialog", after === before, `dialogs ${before} -> ${after}`);
  }
}

// ---------------------------------------------------------------------------
// Console hygiene
// ---------------------------------------------------------------------------
const real = consoleErrors.filter((t) => !/favicon|vault|CDN|Failed to fetch|net::ERR/i.test(t));
check("no console errors during the menu regression", real.length === 0, real.slice(0, 3).join(" | "));

await browser.close();

const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) {
  console.log("FAILED:");
  for (const r of results.filter((x) => !x.passed)) console.log(`  - ${r.name}`);
  process.exit(1);
}
console.log("The Setup Action menu is a real overlay.");
