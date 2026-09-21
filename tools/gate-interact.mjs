// Covers the activation *interaction* paths the gate suite does not: typing a
// key, the disabled/enabled button transition, a rejected key, and a successful
// activation. These need the mock to change its answer mid-run, so they are
// separate from `gate-verify.mjs` (which boots a fresh page per case).
//
// Run: node tools/gate-interact.mjs   (needs `npm run dev` on :1420)

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
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
 * Boots with a mutable licence answer.
 *
 * `state.mode` is read on every `license_status` call, so a test can flip the
 * answer and then trigger a re-read the way the app would.
 */
async function boot() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1040, height: 760 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.addInitScript(
    ({ data }) => {
      window.localStorage.removeItem("setup-center.entry");
      window.__gateMode = { license: "freeEnforced", activate: "reject" };

      const handlers = {
        load_status: () => data.status,
        load_resumable: () => null,
        license_status: () => data.license[window.__gateMode.license],
        license_device: () => data.licenseDevice[window.__gateMode.license],
        // The real command either returns the new entitlements or throws. The
        // reject case throws with the message the validator produces, so the UI
        // path exercised is the one a customer hits with a bad code.
        activate_license: (a) => {
          if (window.__gateMode.activate === "reject") {
            throw new Error("激活码无效或已被使用。请检查是否输入完整。");
          }
          window.__gateMode.license = "proEnforced";
          return data.license.proEnforced;
        },
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
      window.__TAURI_INTERNALS__ = {
        invoke: (cmd, args) => {
          const fn = handlers[cmd];
          if (!fn) return Promise.resolve([]);
          // Throwing synchronously must become a rejection, like the real IPC.
          return Promise.resolve().then(() => fn(args));
        },
        transformCallback: (cb) => cb,
        metadata: { currentWindow: { label: "main" } },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    },
    { data: fixtures },
  );

  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  return { browser, page, consoleErrors };
}

const input = (page) => page.locator("#activation-key");
const activateBtn = (page) => page.locator('button:has-text("激活")').first();

// ---------------------------------------------------------------------------
// 1. Disabled → enabled as the customer types
// ---------------------------------------------------------------------------
{
  const { browser, page, consoleErrors } = await boot();

  check("空输入 → 激活按钮 disabled", await activateBtn(page).isDisabled());

  await input(page).fill("SC-AAAAA-BBBBB-CCCCC-DDDDD");
  await page.waitForTimeout(150);
  check("输入后 → 激活按钮 enabled", await activateBtn(page).isEnabled());

  // Whitespace alone must not enable it.
  await input(page).fill("    ");
  await page.waitForTimeout(150);
  check("仅空白 → 激活按钮仍 disabled", await activateBtn(page).isDisabled());

  await input(page).fill("SC-AAAAA-BBBBB-CCCCC-DDDDD");
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(outDir, "08-gate-filled.png") });

  // -------------------------------------------------------------------------
  // 2. A rejected key: error shown, input NOT cleared, still on the gate
  // -------------------------------------------------------------------------
  await activateBtn(page).click();
  await page.waitForTimeout(600);

  const err = page.locator('[data-testid="license-error"]');
  const errVisible = await err.isVisible().catch(() => false);
  check("错误激活码 → 显示 license-error", errVisible);
  if (errVisible) {
    const t = await err.textContent();
    check("错误信息非空且可读", t.trim().length > 4, t.trim());
  }

  const val = await input(page).inputValue();
  check("错误激活码 → 输入内容保留（便于修正）", val.length > 0, val);

  const stillGate = await page
    .locator('[data-testid="gate-heading"]')
    .isVisible()
    .catch(() => false);
  check("错误激活码 → 仍停留在 Gate", stillGate);
  await page.screenshot({ path: join(outDir, "09-gate-error.png") });

  check("错误路径无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

// ---------------------------------------------------------------------------
// 3. A valid key: enters the app, and the flag is NOT set to free
// ---------------------------------------------------------------------------
{
  const { browser, page, consoleErrors } = await boot();
  await page.evaluate(() => {
    window.__gateMode.activate = "accept";
  });

  await input(page).fill("SC-AAAAA-BBBBB-CCCCC-DDDDD");
  await page.waitForTimeout(150);
  await activateBtn(page).click();
  await page.waitForTimeout(800);

  const gateGone = !(await page
    .locator('[data-testid="gate-heading"]')
    .isVisible()
    .catch(() => false));
  check("有效激活码 → Gate 关闭", gateGone);

  const navCount = await page.locator('nav[aria-label="导航"]').count();
  check("有效激活码 → 进入主界面", navCount > 0, `nav=${navCount}`);

  const flag = await page.evaluate(() =>
    window.localStorage.getItem("setup-center.entry"),
  );
  check("有效激活码 → 不被写入 FREE 标记", flag === null, String(flag));

  const badge = await page.locator('[data-testid="version-badge"]').first();
  const badgeTier = await badge.getAttribute("data-tier").catch(() => null);
  check("有效激活码 → 顶部徽标为 PRO", badgeTier === "pro", String(badgeTier));
  await page.screenshot({ path: join(outDir, "10-gate-activated.png") });

  check("激活成功路径无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

// ---------------------------------------------------------------------------
// 4. Enter key submits
// ---------------------------------------------------------------------------
{
  const { browser, page } = await boot();
  await page.evaluate(() => {
    window.__gateMode.activate = "accept";
  });
  await input(page).fill("SC-AAAAA-BBBBB-CCCCC-DDDDD");
  await input(page).press("Enter");
  await page.waitForTimeout(800);
  const gateGone = !(await page
    .locator('[data-testid="gate-heading"]')
    .isVisible()
    .catch(() => false));
  check("回车可提交激活（键盘可用）", gateGone);
  await browser.close();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("failures:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
}
process.exit(failed.length ? 1 : 0);
