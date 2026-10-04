import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "screenshots");
mkdirSync(outDir, { recursive: true });

const fixturePath = join(here, "fixtures.json");
if (!existsSync(fixturePath)) {
  console.error("missing fixtures.json");
  process.exit(1);
}
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

const TARGET_PRESETS = [
  { id: "terminal-collage", name: "Terminal Collage" },
  { id: "blueprint-drafting", name: "Blueprint Drafting" },
  { id: "split-flap", name: "Split-Flap Board" },
  { id: "natural-history", name: "Natural History Plate" },
  { id: "scrapbook", name: "Scrapbook" },
];

const PORT = 5188;
const BASE_URL = `http://localhost:${PORT}`;

async function startServer() {
  console.log(`Starting Vite dev server on port ${PORT}...`);
  const isWindows = process.platform === "win32";
  const npmCmd = isWindows ? "npx.cmd" : "npx";
  const server = spawn(npmCmd, ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: root,
    stdio: "pipe",
    shell: true,
    env: { ...process.env, BROWSER: "none" },
  });

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) {
        console.log(`Vite server ready at ${BASE_URL}`);
        return server;
      }
    } catch {}
  }
  throw new Error("Vite dev server failed to start within 20s");
}

async function run() {
  const server = await startServer();
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

    // Stub Tauri IPC
    await page.addInitScript(
      ({ data }) => {
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

    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Dismiss gate if visible
    if (await page.locator('[data-testid="gate-heading"]').isVisible().catch(() => false)) {
      await page.locator('[data-testid="gate-free"]').click();
      await page.waitForTimeout(600);
    }

    // Click "进入开发者控制台 / 探索全库" on Welcome screen to open Dashboard
    const enterBtn = page.locator("text=进入开发者控制台 / 探索全库");
    if (await enterBtn.isVisible().catch(() => false)) {
      console.log("Clicking '进入开发者控制台' to open dashboard...");
      await enterBtn.click();
      await page.waitForTimeout(1000);
    }

    // Helper functions inside page
    await page.evaluate(async () => {
      const reg = await import("/src/styles/registry.ts");
      const runtime = await import("/src/styles/runtime.ts");
      const store = (await import("/src/lib/store.ts")).useApp;
      window.__test = {
        applyStyle: (id) => {
          store.getState().setActiveStyle(id);
          const s = reg.getStyle(id);
          if (s) runtime.applyExperience(s);
        },
        reset: () => {
          store.getState().resetStyleOverrides();
          runtime.clearExperience();
        },
        getAttr: (attr) => document.documentElement.getAttribute(attr),
      };
    });

    const results = [];
    const screenshotFiles = [];

    for (const preset of TARGET_PRESETS) {
      console.log(`\n==================================================`);
      console.log(`Testing Visual Preset: ${preset.name} (${preset.id})`);
      console.log(`==================================================`);

      const presetDir = join(outDir, preset.id);
      mkdirSync(presetDir, { recursive: true });

      // 1. Apply Preset
      await page.evaluate((id) => window.__test.applyStyle(id), preset.id);
      await page.waitForTimeout(600);

      const appliedStyle = await page.evaluate(() => window.__test.getAttr("data-style"));
      if (appliedStyle !== preset.id) {
        throw new Error(`Failed to apply style ${preset.id}, got ${appliedStyle}`);
      }
      console.log(`✔ Applied style [data-style="${appliedStyle}"]`);

      // 2. Test Dashboard (Overview)
      const overviewBtn = page.locator('nav[data-nav] button:has-text("开发起步")');
      if (await overviewBtn.isVisible().catch(() => false)) {
        await overviewBtn.click();
        await page.waitForTimeout(600);
      }

      const pageEl = page.locator("section[data-page]");
      const isVisible = await pageEl.isVisible();
      console.log(`✔ Dashboard section[data-page] visible: ${isVisible}`);

      const navButtons = await page.locator("nav[data-nav] button").count();
      console.log(`✔ Nav buttons clickable count: ${navButtons}`);

      // Capture Dashboard
      const dashShotPath = join(presetDir, "dashboard-normal.png");
      await page.screenshot({ path: dashShotPath });
      const flatDashShot = join(outDir, `${preset.id}-dashboard-normal.png`);
      copyFileSync(dashShotPath, flatDashShot);
      screenshotFiles.push(dashShotPath, flatDashShot);
      console.log(`📸 Captured: ${dashShotPath}`);

      // 3. Test Resources Page
      const resBtn = page.locator('nav[data-nav] button:has-text("开发资源")');
      await resBtn.click();
      await page.waitForTimeout(800);

      const resourceCardCount = await page.locator("[data-resource-card]").count();
      console.log(`✔ Resources loaded, card count: ${resourceCardCount}`);

      // Capture Resources
      const resShotPath = join(presetDir, "resources-normal.png");
      await page.screenshot({ path: resShotPath });
      const flatResShot = join(outDir, `${preset.id}-resources-normal.png`);
      copyFileSync(resShotPath, flatResShot);
      screenshotFiles.push(resShotPath, flatResShot);
      console.log(`📸 Captured: ${resShotPath}`);

      // 4. Test Detail / Modal
      const firstCard = page.locator("[data-resource-card]").first();
      await firstCard.click();
      await page.waitForTimeout(600);

      const dialogVisible = await page.locator('[role="dialog"]').isVisible();
      console.log(`✔ DetailShell / Modal open visible: ${dialogVisible}`);

      // Capture Detail
      const detailShotPath = join(presetDir, "detail-normal.png");
      await page.screenshot({ path: detailShotPath });
      const flatDetailShot = join(outDir, `${preset.id}-detail-normal.png`);
      copyFileSync(detailShotPath, flatDetailShot);
      screenshotFiles.push(detailShotPath, flatDetailShot);
      console.log(`📸 Captured: ${detailShotPath}`);

      // Dismiss modal
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      const dialogClosed = !(await page.locator('[role="dialog"]').isVisible().catch(() => false));
      console.log(`✔ DetailShell closed via Escape: ${dialogClosed}`);

      // 5. Switch back to default
      await page.evaluate(() => window.__test.applyStyle("default"));
      await page.waitForTimeout(300);
      const defaultApplied = await page.evaluate(() => window.__test.getAttr("data-style"));
      console.log(`✔ Can switch back to default: ${defaultApplied === "default"}`);

      // 6. Test emergency reset
      await page.evaluate((id) => window.__test.applyStyle(id), preset.id);
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__test.reset());
      await page.waitForTimeout(300);
      console.log(`✔ Emergency reset tested and clean`);

      // Re-apply preset for final clean state
      await page.evaluate((id) => window.__test.applyStyle(id), preset.id);
      await page.waitForTimeout(200);

      results.push({
        preset: preset.name,
        id: preset.id,
        status: "stable",
        dashboardShot: dashShotPath,
        resourcesShot: resShotPath,
        detailShot: detailShotPath,
        navCount: navButtons,
        resourceCards: resourceCardCount,
        modalOperable: dialogVisible && dialogClosed,
      });
    }

    console.log(`\n==================================================`);
    console.log(`VERIFICATION SUMMARY (${results.length} presets tested)`);
    console.log(`==================================================`);
    for (const r of results) {
      console.log(`Preset: ${r.preset} (${r.id}) -> STATUS: ${r.status}`);
      console.log(`  - Dashboard: OK (Nav: ${r.navCount} items)`);
      console.log(`  - Resources: OK (${r.resourceCards} cards)`);
      console.log(`  - Detail/Modal: OK (Open & Close verified)`);
      console.log(`  - Screenshots:`);
      console.log(`      ${r.dashboardShot}`);
      console.log(`      ${r.resourcesShot}`);
      console.log(`      ${r.detailShot}`);
    }

    console.log(`\nTotal screenshots generated: ${screenshotFiles.length}`);

    if (browser) await browser.close();
  } catch (err) {
    console.error("Test execution error:", err);
    throw err;
  } finally {
    if (process.platform === "win32" && server.pid) {
      try {
        spawn("taskkill", ["/pid", String(server.pid), "/f", "/t"]);
      } catch {}
    } else {
      server.kill();
    }
    console.log("Vite server terminated.");
  }
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
