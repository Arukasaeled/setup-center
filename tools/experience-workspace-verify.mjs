// EXPERIENCE PREVIEW WORKSPACE — Reality Verification Suite
//
// Tests:
//   1. Separation of Quick Detail (DetailShell) and Full Preview (ExperiencePreviewWorkspace)
//   2. Neutral Tool Chrome isolation (never deformed by phantom-comic, dos-utility, etc.)
//   3. High-level Overlay hierarchy: Portal to body, dashboard nav behind scrim
//   4. Fixed Sticky Header & Sticky Footer Action Bar during scroll
//   5. Hero Preview Stage with zoom & mode toggles
//   6. 4 Structured Tabs (Preview, Grammar, Tokens, Principles)
//   7. Deep-Scroll Reality Test: scroll to bottom -> open -> visible at top; Esc -> restore scrollTop & focus
//   8. SetupAction dropdown regression inside workspace footer
//   9. Responsive scaling at 980x640 and 1500x1000
//  10. ActiveStyle immutability during preview vs true apply on confirm

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

await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

await page.evaluate(async () => {
  const m = await import("/src/lib/store.ts");
  m.useApp.getState().openDashboard();
});
await page.waitForTimeout(600);

const setSection = async (id) => {
  await page.evaluate(async (section) => {
    const m = await import("/src/lib/store.ts");
    m.useApp.getState().setSection(section);
  }, id);
  await page.waitForTimeout(500);
};

const setStyle = async (id) => {
  await page.evaluate(async (styleId) => {
    const m = await import("/src/lib/store.ts");
    m.useApp.getState().setActiveStyle(styleId);
  }, id);
  await page.waitForTimeout(500);
};

const getActiveStyle = async () => {
  return await page.evaluate(async () => {
    const m = await import("/src/lib/store.ts");
    return m.useApp.getState().activeStyle;
  });
};

console.log("\n=== TEST SUITE: EXPERIENCE PREVIEW WORKSPACE ===\n");

// Navigate to Style gallery
await setSection("style");
await page.waitForTimeout(500);

// ---------------------------------------------------------------------------
// 1. Separation of Quick Detail vs Full Preview Workspace
// ---------------------------------------------------------------------------
console.log("--- 1. Quick Detail vs Full Preview Separation ---");

const firstCard = page.locator("[data-style-card]").first();
const cardTitle = firstCard.locator("span.font-bold").first();
await cardTitle.click();
await page.waitForTimeout(300);

// Assert Quick Detail dialog is open
const quickDetailDialog = page.locator('div[role="dialog"]');
const isQuickDetailOpen = (await quickDetailDialog.count()) > 0;
check("card click: opens lightweight Quick Detail modal", isQuickDetailOpen);

// Assert Quick Detail does NOT contain giant specimen
const quickSpecimen = quickDetailDialog.locator("[data-specimen-stage]");
check("card click: Quick Detail does NOT embed giant specimen", (await quickSpecimen.count()) === 0);

// Assert Quick Detail has "进入完整预览工作区" CTA
const ctaButton = quickDetailDialog.locator('button:has-text("进入完整预览工作区")');
check("card click: Quick Detail has direct CTA to full workspace", (await ctaButton.count()) > 0);

// Click CTA to open ExperiencePreviewWorkspace
await ctaButton.click();
await page.waitForTimeout(400);

const workspace = page.locator('[data-experience-workspace="true"]');
const isWorkspaceOpen = (await workspace.count()) > 0;
check("CTA click: seamlessly transitions to ExperiencePreviewWorkspace", isWorkspaceOpen);

// Close workspace with Esc
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Escape: closes ExperiencePreviewWorkspace", (await workspace.count()) === 0);

// Direct trigger on card: "预览完整样张 ↗"
const previewTrigger = page.locator('button[data-preview-trigger="phantom-comic"]');
await previewTrigger.scrollIntoViewIfNeeded();
await previewTrigger.click();
await page.waitForTimeout(400);

check("preview trigger: directly opens ExperiencePreviewWorkspace", (await workspace.count()) > 0);

// ---------------------------------------------------------------------------
// 2. High Overlay Hierarchy & Portal to document.body
// ---------------------------------------------------------------------------
console.log("\n--- 2. Overlay Hierarchy & Scrim ---");

// Assert workspace is a direct child of document.body (portalled)
const isDirectBodyChild = await page.evaluate(() => {
  const ws = document.querySelector('[data-experience-workspace="true"]');
  return ws?.parentElement === document.body;
});
check("portal: workspace is mounted directly on document.body", isDirectBodyChild);

// Assert Dashboard Navigation is visually covered by the overlay
const navBehindOverlay = await page.evaluate(() => {
  const nav = document.querySelector("nav[data-nav]");
  if (!nav) return false;
  const rect = nav.getBoundingClientRect();
  const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const ws = document.querySelector('[data-experience-workspace="true"]');
  // Top element should be part of the workspace overlay, not the nav button
  return ws?.contains(topEl) || topEl?.hasAttribute("aria-hidden");
});
check("layer: dashboard nav is covered behind overlay scrim", navBehindOverlay);

// ---------------------------------------------------------------------------
// 3. Neutral Chrome Isolation under Extreme Experience (Phantom Comic)
// ---------------------------------------------------------------------------
console.log("\n--- 3. Neutral Tool Chrome Isolation ---");

// Check workspace header styling: should NOT have skew, rotate, or yellow comic styles
const chromeStyles = await page.evaluate(() => {
  const ws = document.querySelector('[data-experience-workspace="true"]');
  if (!ws) return null;
  const header = ws.querySelector("header");
  const closeBtn = header?.querySelector("button");
  const tabBtn = header?.querySelector("nav button");

  const headerStyle = header ? window.getComputedStyle(header) : null;
  const closeStyle = closeBtn ? window.getComputedStyle(closeBtn) : null;
  const tabStyle = tabBtn ? window.getComputedStyle(tabBtn) : null;

  return {
    headerTransform: headerStyle?.transform,
    closeTransform: closeStyle?.transform,
    tabTransform: tabStyle?.transform,
    fontFamily: headerStyle?.fontFamily,
  };
});

check(
  "chrome: header transform is clean",
  chromeStyles?.headerTransform === "none" || !chromeStyles?.headerTransform,
  chromeStyles?.headerTransform,
);
check(
  "chrome: close button is not skewed by phantom-comic",
  chromeStyles?.closeTransform === "none" || !chromeStyles?.closeTransform,
  chromeStyles?.closeTransform,
);
check(
  "chrome: tab buttons are not skewed by phantom-comic",
  chromeStyles?.tabTransform === "none" || !chromeStyles?.tabTransform,
  chromeStyles?.tabTransform,
);

// ---------------------------------------------------------------------------
// 4. Hero Preview Stage with Zoom & Mode Toggles
// ---------------------------------------------------------------------------
console.log("\n--- 4. Hero Preview Stage & Modes ---");

const stage = workspace.locator("[data-specimen-stage]");
check("stage: preview stage is visible and hero sized", (await stage.count()) > 0);

const stageBox = await stage.boundingBox();
check("stage: stage has substantial height (>= 400px)", (stageBox?.height ?? 0) >= 400, `h=${stageBox?.height}`);

// Switch zoom to 75%
const zoom75Btn = workspace.locator('button:has-text("75%")');
await zoom75Btn.click();
await page.waitForTimeout(200);

const fontSize75 = await page.evaluate(() => {
  const el = document.querySelector("[data-specimen-stage] > div:nth-child(2)");
  return el ? window.getComputedStyle(el).fontSize : "";
});
check("zoom: 75% applies compact font scale", fontSize75 === "15px", `fontSize=${fontSize75}`);

// Switch zoom to 100%
const zoom100Btn = workspace.locator('button:has-text("100%")');
await zoom100Btn.click();
await page.waitForTimeout(200);

const fontSize100 = await page.evaluate(() => {
  const el = document.querySelector("[data-specimen-stage] > div:nth-child(2)");
  return el ? window.getComputedStyle(el).fontSize : "";
});
check("zoom: 100% applies crisp full life-size scale", fontSize100 === "20px", `fontSize=${fontSize100}`);

// Switch mode to Software List
const softwareModeBtn = workspace.locator('button:has-text("实际页面 · 软件列表")');
await softwareModeBtn.click();
await page.waitForTimeout(250);

const hasSoftwareMock = (await workspace.locator('text=开发软件仓库').count()) > 0;
check("mode: software page mock renders successfully", hasSoftwareMock);

// Switch mode to Resources
const resourceModeBtn = workspace.locator('button:has-text("实际页面 · 开发资源")');
await resourceModeBtn.click();
await page.waitForTimeout(250);

const hasResourceMock = (await workspace.locator('text=开发资源索引').count()) > 0;
check("mode: resource page mock renders successfully", hasResourceMock);

// Switch back to Specimen
const specimenModeBtn = workspace.locator('button:has-text("体验样张 (综合模拟)")');
await specimenModeBtn.click();
await page.waitForTimeout(250);

// ---------------------------------------------------------------------------
// 5. 4 Structured Tabs (Grammar, Tokens, Principles)
// ---------------------------------------------------------------------------
console.log("\n--- 5. Structured Tabs ---");

// Tab 2: 体验语法
await workspace.locator('header nav button:has-text("体验语法")').click();
await page.waitForTimeout(250);
const grammarCardCount = await workspace.locator('text=外壳语法').count();
check("tab: grammar inspector displays 8 dimensions", grammarCardCount > 0);

// Tab 3: 色彩与令牌
await workspace.locator('header nav button:has-text("色彩与令牌")').click();
await page.waitForTimeout(250);
const swatchCount = await workspace.locator('text=基底背景').count();
check("tab: tokens tab displays color palette & metrics", swatchCount > 0);

// Tab 4: 规范与原则
await workspace.locator('header nav button:has-text("规范与原则")').click();
await page.waitForTimeout(250);
const principlesCount = await workspace.locator('text=关键视觉特征').count();
check("tab: principles tab displays design principles & specs", principlesCount > 0);

// Switch back to Preview tab
await workspace.locator('header nav button:has-text("体验样张")').click();
await page.waitForTimeout(200);

// ---------------------------------------------------------------------------
// 6. Fixed Header & Fixed Footer during Scroll
// ---------------------------------------------------------------------------
console.log("\n--- 6. Fixed Header & Footer Pinning ---");

const headerBoxBefore = await workspace.locator("header").boundingBox();
const footerBoxBefore = await workspace.locator("footer").boundingBox();

// Scroll the workspace body down
const scrollBody = workspace.locator(".overflow-y-auto");
await scrollBody.evaluate((el) => {
  el.scrollTop = 500;
});
await page.waitForTimeout(250);

const headerBoxAfter = await workspace.locator("header").boundingBox();
const footerBoxAfter = await workspace.locator("footer").boundingBox();

check(
  "scroll: header stays pinned at top",
  Math.abs((headerBoxAfter?.y ?? 0) - (headerBoxBefore?.y ?? 0)) < 2,
  `yBefore=${headerBoxBefore?.y} yAfter=${headerBoxAfter?.y}`,
);
check(
  "scroll: footer action bar stays pinned at bottom",
  Math.abs((footerBoxAfter?.y ?? 0) - (footerBoxBefore?.y ?? 0)) < 2,
  `yBefore=${footerBoxBefore?.y} yAfter=${footerBoxAfter?.y}`,
);

// ---------------------------------------------------------------------------
// 7. SetupAction Secondary Menu Regression inside Workspace
// ---------------------------------------------------------------------------
console.log("\n--- 7. SetupAction Dropdown inside Workspace ---");

const dropdownToggle = workspace.locator('footer button:has-text("▼")');
if ((await dropdownToggle.count()) > 0) {
  await dropdownToggle.click();
  await page.waitForTimeout(250);

  const menu = page.locator("[data-setup-action-menu]");
  const menuVisible = (await menu.count()) > 0;
  check("dropdown: secondary actions menu opens from workspace footer", menuVisible);

  if (menuVisible) {
    const menuZ = await menu.evaluate((el) => window.getComputedStyle(el).zIndex);
    check("dropdown: menu has z-index 60 above workspace z-50", menuZ === "60", `z=${menuZ}`);

    // Verify menu center is top layer
    const menuCenterTop = await menu.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return el.contains(topEl);
    });
    check("dropdown: menu center is unobstructed top layer", menuCenterTop);

    // Close menu with Esc
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
} else {
  console.log("SKIP dropdown check (single action only)");
}

// Close workspace
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
// 8. DEEP-SCROLL REALITY TEST (Preserve scrollTop & containing block immunity)
// ---------------------------------------------------------------------------
console.log("\n--- 8. Deep-Scroll Reality Test ---");

const testExperiences = ["phantom-comic", "dos-utility", "spatial-glass", "japanese-editorial"];

for (const expId of testExperiences) {
  // Apply the experience globally so its CSS transforms/filters are active on page
  await setStyle(expId);
  await page.waitForTimeout(400);

  // Scroll style page to bottom trigger
  const scrollContainer = page.locator("section[data-page]");
  const lastCardTrigger = page.locator("button[data-preview-trigger]").last();
  await lastCardTrigger.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);

  const scrollTopBefore = await scrollContainer.evaluate((el) => el.scrollTop);

  check(
    `${expId}: scrolled page to deep bottom`,
    scrollTopBefore > 600,
    `scrollTop=${scrollTopBefore}`,
  );

  await lastCardTrigger.dispatchEvent("click");
  await page.waitForTimeout(400);

  // Check workspace is immediately visible in viewport
  const ws = page.locator('[data-experience-workspace="true"]');
  const wsBox = await ws.boundingBox();

  check(
    `${expId}: workspace is immediately in current viewport`,
    (wsBox?.y ?? 999) < 60 && (wsBox?.height ?? 0) > 400,
    `y=${wsBox?.y} h=${wsBox?.height}`,
  );

  // Check background did NOT jump to 0 while open
  const backgroundScrollDuring = await scrollContainer.evaluate((el) => el.scrollTop);
  check(
    `${expId}: background scroll position preserved while open`,
    Math.abs(backgroundScrollDuring - scrollTopBefore) <= 2,
    `during=${backgroundScrollDuring} before=${scrollTopBefore}`,
  );

  // Dismiss with Escape
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Check background scroll position after close
  const scrollTopAfter = await scrollContainer.evaluate((el) => el.scrollTop);
  check(
    `${expId}: background scroll position restored accurately on close`,
    Math.abs(scrollTopAfter - scrollTopBefore) <= 2,
    `after=${scrollTopAfter} before=${scrollTopBefore}`,
  );

  // Check focus restored
  const activeTag = await page.evaluate(() => document.activeElement?.getAttribute("data-preview-trigger"));
  check(
    `${expId}: focus returned to preview trigger button`,
    Boolean(activeTag),
    `focused=${activeTag}`,
  );
}

// ---------------------------------------------------------------------------
// 9. Window Size Responsiveness (980x640 min vs 1500x1000 large)
// ---------------------------------------------------------------------------
console.log("\n--- 9. Window Size Reality Test ---");

// Minimum window size: 980x640
await page.setViewportSize({ width: 980, height: 640 });
await page.waitForTimeout(300);

const trigger = page.locator("button[data-preview-trigger]").first();
await trigger.scrollIntoViewIfNeeded();
await trigger.click();
await page.waitForTimeout(300);

const wsMinBox = await workspace.boundingBox();
check(
  "responsive: 980x640 workspace fits comfortably inside window",
  (wsMinBox?.width ?? 0) <= 980 && (wsMinBox?.height ?? 0) <= 640 && (wsMinBox?.height ?? 0) > 450,
  `w=${wsMinBox?.width} h=${wsMinBox?.height}`,
);

await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// Large window size: 1500x1000
await page.setViewportSize({ width: 1500, height: 1000 });
await page.waitForTimeout(300);

await trigger.click();
await page.waitForTimeout(300);

const wsLargeBox = await workspace.boundingBox();
check(
  "responsive: 1500x1000 workspace expands generously",
  (wsLargeBox?.width ?? 0) >= 1200 && (wsLargeBox?.height ?? 0) >= 800,
  `w=${wsLargeBox?.width} h=${wsLargeBox?.height}`,
);

await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// ---------------------------------------------------------------------------
// 10. ActiveStyle Immutability vs Application
// ---------------------------------------------------------------------------
console.log("\n--- 10. ActiveStyle Immutability ---");

const initialStyle = await getActiveStyle();

// Open preview of another style
const altTrigger = page.locator('button[data-preview-trigger="retro-mac"]');
await altTrigger.scrollIntoViewIfNeeded();
await altTrigger.click();
await page.waitForTimeout(300);

// Assert activeStyle is unchanged while previewing
const styleDuringPreview = await getActiveStyle();
check(
  "immutability: activeStyle does NOT change when previewing",
  styleDuringPreview === initialStyle,
  `active=${styleDuringPreview} initial=${initialStyle}`,
);

// Click "立即应用" in footer
const applyBtn = workspace.locator('footer button:has-text("应用")').first();
await applyBtn.click();
await page.waitForTimeout(600);

const styleAfterApply = await getActiveStyle();
check(
  "apply: clicking apply actually changes activeStyle",
  styleAfterApply === "retro-mac",
  `newStyle=${styleAfterApply}`,
);

// Final Console Error Check
check("safety: zero console errors during workspace verification", consoleErrors.length === 0, consoleErrors.join("; "));

await browser.close();

console.log("\n==================================================");
const passedCount = results.filter((r) => r.passed).length;
console.log(`TOTAL: ${passedCount}/${results.length} PASSED`);
console.log("==================================================\n");

if (passedCount !== results.length) {
  process.exit(1);
}
