// Drives the new first-run activation gate in a real browser against the real
// production bundle, with the real captured licence payloads.
//
// Why a separate script from `ui-verify.mjs`: that harness verifies the whole
// app, and it predates the gate. This one answers only the gate's questions —
// when it appears, when it stays away, what each button does — so a failure
// here points at the gate rather than at "some screenshot differed".
//
// The licence payloads come from `tools/fixtures.json`, which was captured from
// the real Rust commands. So the gate is exercised against the shapes the
// backend actually returns, not against invented ones.
//
// Run: node tools/gate-verify.mjs   (needs `npm run dev` on :1420)

import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "_tmp", "gate");
mkdirSync(outDir, { recursive: true });

const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Opens the app with a given licence answer and a given first-run flag.
 *
 * `entry` is what `localStorage` should hold before the app boots: `null` for a
 * machine that has never been asked, `"free"` for one that chose FREE.
 */
async function boot({ licenseMode = "freeEnforced", entry = null, locale = "dark" }) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1040, height: 720 },
    deviceScaleFactor: 2,
    colorScheme: locale,
  });

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}\nSTACK: ${e.stack}`));

  await page.addInitScript(
    ({ data, licMode, entryValue }) => {
      // Seed the first-run flag before any app code runs.
      if (entryValue !== null) {
        window.localStorage.setItem("setup-center.entry", entryValue);
      } else {
        window.localStorage.removeItem("setup-center.entry");
      }

      const invoke = (cmd, args) => {
        const noop = { unlisten: () => Promise.resolve() };
        const handlers = {
          load_status: () => data.status,
          load_resumable: () => data.resumable ?? null,
          license_status: () => data.license[licMode],
          license_device: () => data.licenseDevice[licMode],
          activate_license: () => data.license.freeEnforced,
          // The dashboard's own data. Mirrors the command names `ui-verify.mjs`
          // stubs, so the surface the gate hands off to is a real one rather
          // than one that only exists because half its calls failed.
          windows_info: () => data.environment.windows,
          scan_software: () => data.scan.inventory,
          last_software_scan: () => data.scan.inventory,
          capability_report: () => data.capabilities ?? [],
          software_catalogue: () => data.machineCatalogue ?? [],
          machine_facts: () => data.environment?.machine ?? null,
          explained_catalogue: () => data.explained ?? [],
          list_goals: () =>
            data.goals ?? { goals: [], goalsWithoutProfiles: [], defaultGoal: "" },
          environment_plan: (a) =>
            (data.goalPlans ?? []).find((p) => p.goalId === a.goalId) ?? null,
          environment_plans: () => data.goalPlans ?? [],
          explain_software: (a) =>
            (data.explained ?? []).find((e) => e.knowledge.id === a.id) ?? null,
          list_profiles: () => data.profiles,
          execution_readiness: () => data.readiness,
          knowledge_status: () => data.knowledgeStatus,
          advisor_summary: () => data.advisor,
          advisor_report_text: () => data.advisorText ?? "",
          localization_targets: () => data.localizationTargets ?? [],
          resumable_install: () => null,
          last_install_session: () => null,
          resumable_bootstrap: () => null,
          last_bootstrap: () => null,
        };
        const fn = handlers[cmd];
        if (fn) return Promise.resolve(fn(args));
        return Promise.resolve([]);
      };

      window.__TAURI_INTERNALS__ = {
        invoke,
        transformCallback: (cb) => cb,
        metadata: { currentWindow: { label: "main" } },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    },
    { data: fixtures, licMode: licenseMode, entryValue: entry },
  );

  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  return { browser, page, consoleErrors };
}

const heading = (page) => page.locator('[data-testid="gate-heading"]');
const gateFree = (page) => page.locator('[data-testid="gate-free"]');

// ---------------------------------------------------------------------------
// 1. Never asked before, no licence → the gate appears
// ---------------------------------------------------------------------------
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: null,
  });
  const visible = await heading(page).isVisible().catch(() => false);
  check("未选择 + 无授权 → 显示 ActivationGate", visible);

  if (visible) {
    const text = await heading(page).textContent();
    check("Gate 标题为「解锁 Setup Center PRO」", text.includes("解锁 Setup Center PRO"), text);

    // FREE must be a real, enabled button — not a greyed-out link.
    const freeEnabled = await gateFree(page).isEnabled();
    check("「使用 FREE 版」可见且可点击", freeEnabled);

    // The activation input must be the focused element: it is the primary
    // action on this screen.
    const focusedId = await page.evaluate(() => document.activeElement?.id ?? null);
    check("激活码输入框默认获得焦点", focusedId === "activation-key", String(focusedId));

    // The activate button must be disabled while the input is empty.
    const activateBtn = page.locator('button:has-text("激活 PRO")');
    const disabledEmpty = await activateBtn.isDisabled();
    check("空输入时「激活 PRO」为 disabled", disabledEmpty);

    await page.screenshot({ path: join(outDir, "01-gate-first-run.png") });
  }
  check("Gate 首启无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

// ---------------------------------------------------------------------------
// 2. Already chose FREE → straight to the dashboard, no gate
// ---------------------------------------------------------------------------
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: "free",
  });
  const gateVisible = await heading(page).isVisible().catch(() => false);
  check("已选择 FREE → 不再显示 Gate", !gateVisible);

  const dashPresent = await page.locator('nav[aria-label="导航"]').count();
  check("已选择 FREE → 进入主界面", dashPresent > 0, `nav count=${dashPresent}`);
  const bodyNow = (await page.locator("body").innerText()).slice(0, 200);
  console.log(`    [debug] body starts: ${JSON.stringify(bodyNow)}`);
  await page.screenshot({ path: join(outDir, "02-free-returning.png") });
  check("FREE 复访无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

// ---------------------------------------------------------------------------
// 3. Active PRO → straight in, even with a stale FREE flag
// ---------------------------------------------------------------------------
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "proEnforced",
    entry: null,
  });
  const gateVisible = await heading(page).isVisible().catch(() => false);
  check("已激活 PRO（无首启标记）→ 跳过 Gate", !gateVisible);
  await page.screenshot({ path: join(outDir, "03-pro-direct.png") });
  check("PRO 直入无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

{
  const { browser, page } = await boot({ licenseMode: "proEnforced", entry: "free" });
  const gateVisible = await heading(page).isVisible().catch(() => false);
  check("PRO + 旧 FREE 标记 → 授权优先，跳过 Gate", !gateVisible);
  await browser.close();
}

// ---------------------------------------------------------------------------
// 4. Choosing FREE writes the flag and enters the dashboard
// ---------------------------------------------------------------------------
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: null,
  });
  await gateFree(page).click();
  await page.waitForTimeout(500);

  const stored = await page.evaluate(() =>
    window.localStorage.getItem("setup-center.entry"),
  );
  check("点击「使用 FREE 版」→ 持久化 entry=free", stored === "free", String(stored));

  const gateGone = !(await heading(page).isVisible().catch(() => false));
  check("点击「使用 FREE 版」→ Gate 关闭", gateGone);

  const dashPresent = await page.locator('nav[aria-label="导航"]').count();
  check("点击「使用 FREE 版」→ 进入主界面", dashPresent > 0);
  await page.screenshot({ path: join(outDir, "04-free-chosen.png") });
  check("选择 FREE 无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

// ---------------------------------------------------------------------------
// 5. FREE tier keeps its PRO restrictions after entering
// ---------------------------------------------------------------------------
{
  const { browser, page } = await boot({
    licenseMode: "freeEnforced",
    entry: null,
  });
  await gateFree(page).click();
  await page.waitForTimeout(500);

  // The licence section must still report the enforced-free state, i.e. the
  // gate did not accidentally grant anything. It lives on the 版本 section, so
  // navigate there rather than hoping it is on the overview.
  await page.locator('button:has-text("版本")').first().click();
  await page.waitForTimeout(400);
  const bodyText = await page.locator("body").innerText();
  check(
    "FREE 进入后仍受 PRO 限制（文案含「不包含自动安装」）",
    bodyText.includes("不包含自动安装"),
    bodyText.slice(0, 160).replace(/\n/g, " | "),
  );
  await browser.close();
}

// ---------------------------------------------------------------------------
// 6. Device mismatch still reaches the gate, and explains itself
// ---------------------------------------------------------------------------
{
  const { browser, page } = await boot({
    licenseMode: "freeMismatch",
    entry: null,
  });
  const visible = await heading(page).isVisible().catch(() => false);
  check("设备不匹配 → 显示 Gate", visible);
  if (visible) {
    const mismatch = await page
      .locator('[data-testid="license-mismatch"]')
      .isVisible()
      .catch(() => false);
    check("设备不匹配 → Gate 内显示 mismatch 说明", mismatch);
    await page.screenshot({ path: join(outDir, "05-mismatch.png") });
  }
  await browser.close();
}

// ---------------------------------------------------------------------------
// 7. Light theme renders the gate
// ---------------------------------------------------------------------------
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: null,
    locale: "light",
  });
  const visible = await heading(page).isVisible().catch(() => false);
  check("浅色主题 → Gate 正常渲染", visible);
  await page.screenshot({ path: join(outDir, "06-gate-light.png") });
  check("浅色主题无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

// ---------------------------------------------------------------------------
// 8. Narrow window: the gate must not overflow
// ---------------------------------------------------------------------------
{
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 700, height: 560 },
    colorScheme: "dark",
  });
  await page.addInitScript(
    ({ data }) => {
      window.localStorage.removeItem("setup-center.entry");
      const handlers = {
        load_status: () => data.status,
        load_resumable: () => null,
        license_status: () => data.license.freeEnforced,
        license_device: () => data.licenseDevice.freeEnforced,
      };
      window.__TAURI_INTERNALS__ = {
        invoke: (cmd) => Promise.resolve(handlers[cmd] ? handlers[cmd]() : []),
        transformCallback: (cb) => cb,
        metadata: { currentWindow: { label: "main" } },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    },
    { data: fixtures },
  );
  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const visible = await heading(page).isVisible().catch(() => false);
  check("窄窗口（700×560）→ Gate 仍可见", visible);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  check("窄窗口 → 无横向溢出", !overflow);
  await page.screenshot({ path: join(outDir, "07-gate-narrow.png") });
  await browser.close();
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("failures:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
}
process.exit(failed.length ? 1 : 0);
