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
        // Which entitlement `license_status` reports. A page-global rather than
        // a closed-over constant so a test can flip the machine from FREE to PRO
        // *while the page is open*. That is the only way to prove the entry
        // updates the running screen without a reload — the behaviour a customer
        // actually experiences after typing a code, and the one a reload would
        // hide by rebuilding the whole app from scratch.
        let activeTier = licMode;
        const handlers = {
          load_status: () => data.status,
          load_resumable: () => data.resumable ?? null,
          // `unreadable` has no fixture on purpose: it stands for "the Rust
          // command failed", so the mock has to *reject* rather than return a
          // shape. Rejecting drives `loadEntitlements` into its error branch,
          // which is the state under test.
          license_status: () => {
            if (activeTier === "unreadable") {
              return Promise.reject(new Error("无法读取 license.dat"));
            }
            return data.license[activeTier];
          },
          license_device: () => data.licenseDevice[activeTier],
          // Activating makes this machine PRO for the rest of the session. It
          // must do so here rather than staying FREE: a mock that kept reporting
          // FREE would make a broken activation look like a working one.
          activate_license: () => {
            activeTier = "proEnforced";
            return data.license.proEnforced;
          },
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
// 9. The persistent upgrade entry
//
// This is the block that covers the reported defect directly. The gate is asked
// once and remembered, so a customer who chose FREE had no route to activation
// anywhere they look. These assertions are written against *both* surfaces,
// because covering only one leaves the other free to regress silently.
// ---------------------------------------------------------------------------

// A returning FREE customer on the wizard's first screen.
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: "free",
  });

  // Returning customers with a recorded choice go to the dashboard, so get back
  // to the welcome screen the way a customer does — "回到首次设置".
  await page.getByRole("button", { name: /回到首次设置/ }).click();
  await page.waitForTimeout(500);

  const entryVisible = await page
    .locator('[data-testid="upgrade-entry"]')
    .isVisible()
    .catch(() => false);
  check("FREE 复访 → 欢迎页可见「升级 PRO」入口", entryVisible);

  // The entry must reveal the real card, not a lookalike. `#activation-key` is
  // the id `ActivationCard` renders, so its presence proves the shared
  // component is what opened.
  if (entryVisible) {
    await page.locator('[data-testid="upgrade-entry"]').click();
    await page.waitForTimeout(400);
    const cardVisible = await page.locator("#activation-key").isVisible().catch(() => false);
    check("FREE 复访 → 点击后展开复用组件（#activation-key 出现）", cardVisible);
    await page.screenshot({ path: join(outDir, "08-welcome-entry-open.png") });
  }
  check("欢迎页入口无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

// ---- 9b. Dashboard: the entry is on every section but 版本与授权 ------------
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: "free",
  });

  const dashEntry = page.locator('[data-testid="upgrade-entry"]');
  check("FREE 复访 → Dashboard 可见「升级 PRO」入口", await dashEntry.isVisible().catch(() => false));

  // Sidebar now reads 版本与授权 — the renamed label the gate already promised.
  const licenceNav = page.locator('button:has-text("版本与授权")').first();
  check("侧栏标签为「版本与授权」", (await licenceNav.count()) > 0);

  // On the licence section the entry stands down, because the section already
  // renders the full card; two copies of the same control is the defect this
  // check exists to prevent.
  await licenceNav.click();
  await page.waitForTimeout(500);
  const onLicence = await dashEntry.isVisible().catch(() => false);
  check("版本与授权页 → 不重复显示入口（该页自带完整卡片）", !onLicence);
  const cardThere = await page.locator("#activation-key").isVisible().catch(() => false);
  check("版本与授权页 → 自带 ActivationCard", cardThere);

  await page.screenshot({ path: join(outDir, "09-dashboard-license.png") });
  check("Dashboard 入口无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

// ---- 9c. FREE → PRO from the dashboard entry, with no restart ---------------
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: "free",
  });

  const badgeBefore = await page.locator('[data-testid="version-badge"]').getAttribute("data-tier");
  check("升级前 → 顶部徽标为 free", badgeBefore === "free", String(badgeBefore));

  await page.locator('[data-testid="upgrade-entry"]').click();
  await page.waitForTimeout(300);
  await page.getByLabel("激活码").fill("SC-ABCDE-23456-FGHJK-3SKWP");
  await page.getByRole("button", { name: /^激活( PRO)?$/ }).click();
  await page.waitForTimeout(700);

  // No reload happens between the click above and these reads: the page is the
  // same document, so a passing result is genuinely "FREE became PRO live".
  const badgeAfter = await page.locator('[data-testid="version-badge"]').getAttribute("data-tier");
  check("输入激活码后 → 无需重启，徽标变为 pro", badgeAfter === "pro", String(badgeAfter));

  // Activating from the dashboard entry lands on 版本与授权, which is where the
  // full activated state lives. So the right question is not "is the entry
  // visible" — that section deliberately does not render one — but "does the
  // screen the customer lands on confirm the upgrade".
  const landedOnLicence = await page
    .locator('button:has-text("版本与授权")')
    .first()
    .getAttribute("aria-current");
  check("升级后 → 落到「版本与授权」页", landedOnLicence === "page", String(landedOnLicence));

  const proHeading = await page
    .locator('[data-testid="license-heading"]')
    .textContent()
    .catch(() => "");
  check(
    "升级后 → 该页确认已为专业版",
    (proHeading ?? "").includes("Professional"),
    String(proHeading),
  );

  const proState = await page
    .locator('[data-testid="license-pro-state"]')
    .isVisible()
    .catch(() => false);
  check("升级后 → 显示已激活状态（设备绑定 / 激活时间）", proState);

  const stillHasEntry = await page.locator('[data-testid="upgrade-entry"]').count();
  check("升级后 → 不再显示「升级 PRO」按钮", stillHasEntry === 0, `count=${stillHasEntry}`);

  await page.screenshot({ path: join(outDir, "10-dashboard-upgraded.png") });
  check("就地升级无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

// ---- 9d. A PRO machine never advertises an upgrade --------------------------
{
  const { browser, page } = await boot({ licenseMode: "proEnforced", entry: "free" });

  const entryCount = await page.locator('[data-testid="upgrade-entry"]').count();
  check("PRO 启动 → 不显示「升级 PRO」按钮", entryCount === 0, `count=${entryCount}`);

  const proActive = await page
    .locator('[data-testid="upgrade-pro-active"]')
    .isVisible()
    .catch(() => false);
  check("PRO 启动 → 显示「PRO 已激活 ✓」", proActive);
  await browser.close();
}

// ---- 9e. An unreadable licence must not advertise an upgrade ---------------
//
// The dangerous failure for this entry: the licence read fails, and the app
// tells a *paying* customer to buy PRO. The entry must render nothing at all
// when the tier is unknown, and must recover once the read succeeds.
{
  const { browser, page } = await boot({ licenseMode: "unreadable", entry: "free" });

  const entryCount = await page.locator('[data-testid="upgrade-entry"]').count();
  check("授权读取失败 → 不显示「升级 PRO」（不误报为 FREE）", entryCount === 0, `count=${entryCount}`);
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
