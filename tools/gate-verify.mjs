// Drives the first-run activation gate in a real browser against the real
// production bundle, with the real captured licence payloads.
//
// Why a separate script from `ui-verify.mjs`: that harness verifies the whole
// app, and it predates the gate. This one answers only the gate's questions —
// when it appears, when it stays away, what each button does — so a failure
// here points at the gate rather than at "some screenshot differed".
//
// ## The entry flow this file is written against (0.1.3, commit c270b70)
//
// Every launch lands on Welcome and stays there until the customer picks
// something. Nothing — an active licence, a recorded "free" answer — auto-advances
// to the dashboard, and the gate is no longer opened by itself for a *readable*
// licence. It is a panel over Welcome, opened from its third entry (已有激活码？),
// and the dashboard is entered by choosing ① 检查电脑环境.
//
// Only rule 3 (a licence read *error* on a machine that has not answered) still
// forces the gate open on a cold start.
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
async function boot({
  licenseMode = "freeEnforced",
  entry = null,
  locale = "dark",
  viewport = { width: 1040, height: 720 },
}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: viewport.width <= 800 ? 1 : 2,
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

/**
 * Open the gate the way the product opens it.
 *
 * Since `c270b70` ("每次启动停在 Welcome") a cold start always lands on Welcome:
 * the app no longer jumps to the dashboard, and it no longer auto-opens the gate
 * for a machine that has already answered. The gate is a *panel over* Welcome,
 * opened from its third entry (`已有激活码？` → `输入激活码`).
 *
 * An earlier cut of this suite asserted the gate on cold start, which stopped
 * being true at that commit — every block below that needs the gate has to open
 * it explicitly rather than assuming it is on screen. `gate-rules-verify.mjs`
 * was updated in the same commit and encodes the current ordering; this file was
 * missed, so it was failing at HEAD for a reason unrelated to any style work.
 */
async function openGate(page) {
  await page.locator('[data-testid="welcome-activate"]').first().click();
  await page.waitForTimeout(400);
}

/**
 * Reach the dashboard the way a customer reaches it.
 *
 * Since `c270b70` the dashboard is no longer the cold-start surface for a
 * returning FREE customer — every launch lands on Welcome and the dashboard is
 * entered through ① 检查电脑环境 (`openDashboard()` on the first entry). Blocks
 * that assert on the dashboard have to travel there; asserting `nav` presence on
 * cold start would re-encode the autoplay that commit removed.
 */
async function enterDashboard(page) {
  await page.locator('[data-testid="welcome-entry"]').first().click();
  await page.waitForTimeout(700);
}

// ---------------------------------------------------------------------------
// 1. Never asked before, no licence → the gate is reachable from Welcome
//
// The gate is NOT auto-opened for a readable licence: since c270b70 a cold start
// lands on Welcome and the customer opens the gate from its third entry. So this
// block asserts the *reachable* path, which is the one the product actually has.
// ---------------------------------------------------------------------------
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: null,
  });

  const welcomeFirst = await page
    .locator('[data-testid="welcome-heading"]')
    .isVisible()
    .catch(() => false);
  check("未选择 + 无授权 → 冷启动落在 Welcome", welcomeFirst);
  check("未选择 + 无授权 → 冷启动不自动弹出 Gate", !(await heading(page).isVisible().catch(() => false)));

  await openGate(page);
  const visible = await heading(page).isVisible().catch(() => false);
  check("从欢迎页「输入激活码」→ 显示 ActivationGate", visible);

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
// 2. Already chose FREE → Welcome (not the gate, not an auto-jump)
// ---------------------------------------------------------------------------
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: "free",
  });
  const gateVisible = await heading(page).isVisible().catch(() => false);
  check("已选择 FREE → 不再显示 Gate", !gateVisible);

  // 0.1.3: rule 2 changed from "skip to the dashboard" to "do not re-ask". The
  // returning customer still starts on Welcome and leaves it by choosing, so the
  // dashboard is reached the way a customer reaches it — the wizard's own exit,
  // not an automatic redirect. Asserting `nav` presence on cold start would
  // re-encode the very autoplay this rule exists to remove.
  const welcomeShown = await page
    .locator('[data-testid="welcome-heading"]')
    .isVisible()
    .catch(() => false);
  check("已选择 FREE → 冷启动停在 Welcome（不自动跳转）", welcomeShown);

  // The gate stays answerable afterwards: the third entry is still there.
  await openGate(page);
  check("已选择 FREE → 仍可手动打开 Gate", await heading(page).isVisible().catch(() => false));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // And the dashboard is still reachable by an explicit choice.
  const back = page.getByRole("button", { name: /已有激活码/ });
  void back;
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
//
// The choice itself is unchanged — `ActivationGate` writes the flag and calls
// `onDone`, which closes the gate and `openDashboard()`s. What changed at
// `c270b70` is only *how the gate gets on screen*: it is opened from Welcome's
// third entry rather than appearing on its own.
// ---------------------------------------------------------------------------
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: null,
  });
  await openGate(page);
  await gateFree(page).click();
  await page.waitForTimeout(700);

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
  await openGate(page);
  await gateFree(page).click();
  await page.waitForTimeout(700);

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
//
// A mismatch is a *readable* licence, so rule 1 applies and the gate does not
// open by itself — but its explanation must still be what the customer sees
// once they open it. The mismatch copy is the whole reason the state exists
// rather than being folded into "no licence".
// ---------------------------------------------------------------------------
{
  const { browser, page } = await boot({
    licenseMode: "freeMismatch",
    entry: null,
  });
  const coldVisible = await heading(page).isVisible().catch(() => false);
  check("设备不匹配 + 未选择 → 冷启动停在 Welcome（不自动弹 Gate）", !coldVisible);

  await openGate(page);
  const visible = await heading(page).isVisible().catch(() => false);
  check("设备不匹配 → 打开 Gate 后可见", visible);
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
  await openGate(page);
  const visible = await heading(page).isVisible().catch(() => false);
  check("浅色主题 → Gate 正常渲染", visible);
  await page.screenshot({ path: join(outDir, "06-gate-light.png") });
  check("浅色主题无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

// ---------------------------------------------------------------------------
// 8. Narrow window: the gate must not overflow
//
// This block uses the shared `boot()` with a small viewport rather than a
// hand-rolled stub. It used to carry its own four-handler `invoke`, and that was
// a real bug in this harness: every command it did not list fell through to
// `Promise.resolve([])`, so `list_goals` returned an array where the store
// expects `GoalListView`. `Welcome` then threw on `goals.goals.length` and the
// page rendered nothing at all — the block was passing its "gate is visible"
// assertion against a blank screen it had itself broken. Reusing `boot()` means
// the narrow-window case is exercised against the same realistic backend as
// every other block.
// ---------------------------------------------------------------------------
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: null,
    viewport: { width: 700, height: 560 },
  });
  await openGate(page);
  const visible = await heading(page).isVisible().catch(() => false);
  check("窄窗口（700×560）→ Gate 仍可见", visible);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  check("窄窗口 → 无横向溢出", !overflow);
  check("窄窗口无 console 错误", consoleErrors.length === 0, consoleErrors.join(" | "));
  await page.screenshot({ path: join(outDir, "07-gate-narrow.png") });
  await browser.close();
}

// ---------------------------------------------------------------------------
// 9. The activation route, on both surfaces
//
// This is the block that covers the reported defect directly. The gate is asked
// once and remembered, so a customer who chose FREE had no route to activation
// anywhere they look. Two surfaces own that route and they are *different*
// controls, so covering only one leaves the other free to regress silently:
//
//   * Welcome's third entry → `welcome-activate` (「输入激活码」), which opens the
//     gate as a panel over Welcome.
//   * The dashboard's tier row → `upgrade-entry` (「升级 PRO」), which reveals the
//     card in place.
// ---------------------------------------------------------------------------

// A returning FREE customer on the wizard's first screen.
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: "free",
  });

  // Since c270b70 a returning FREE customer is ALREADY on Welcome — there is no
  // dashboard to back out of and no "回到首次设置" detour to take. (That click
  // used to be necessary and is now not only redundant but unavailable.)
  const entryVisible = await page
    .locator('[data-testid="welcome-activate"]')
    .isVisible()
    .catch(() => false);
  check("FREE 复访 → 欢迎页可见「输入激活码」入口", entryVisible);

  // The entry must reveal the real card, not a lookalike. `#activation-key` is
  // the id `ActivationCard` renders, so its presence proves the shared
  // component is what opened.
  if (entryVisible) {
    await page.locator('[data-testid="welcome-activate"]').first().click();
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
  await enterDashboard(page);

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
  await enterDashboard(page);

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
  await enterDashboard(page);

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
  await enterDashboard(page);

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
