// Self-selected installation — the release suite for "a PRO user picks the
// programs they want".
//
// ===========================================================================
// The bug this file exists to keep dead
// ===========================================================================
//
// A PRO customer opened the software list, pressed 安装 on Cherry Studio, and
// got a plan for Claude Code — with Claude as a step they could not decline.
// Declining everything to avoid Claude left the run button disabled, which is
// how it was reported: "不选 claude 还不让安装".
//
// Two separate mechanisms produced that, and both have to stay fixed:
//
//   1. **Rust**: the capability `ai-cli-assistant` required `ClaudeCode` by
//      name, so every goal that wanted "a terminal AI assistant" demanded
//      Claude. Guarded by `required_ai_vendor_by_name` in `capability.rs` and
//      its two tests — verified in `cargo test`, not here.
//   2. **The frontend**: the row's 安装 button called `goTo("install")` with *no
//      program id*, so the install screen built a plan from the selected
//      profile. Whatever the student had pointed at, they got the profile.
//
// This suite covers the second one end to end, against the real fixtures
// (`tools/fixtures.json` → `pickedPlans`), which are produced by the same
// `install::build_plan_with` the command calls.
//
// Run: node tools/self-select-verify.mjs   (needs `npm run dev` on :1420)

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "_tmp", "self-select");
mkdirSync(outDir, { recursive: true });

const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

/**
 * Boots the app with the fixture backend, licence active.
 *
 * The pick handlers mirror the real commands: `build_install_plan_for` and
 * `install_strategies_for` are keyed by the id list, exactly as the fixture
 * generator keyed them. A missing key returns null, which the store treats as a
 * failed build — deliberately loud, because a silently-null plan would let this
 * suite pass while the app did nothing.
 */
async function boot() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.addInitScript(
    ({ data }) => {
      window.localStorage.removeItem("setup-center.entry");
      const key = (ids) => (ids ?? []).join("+");
      const handlers = {
        runtime_status: () => data.status,
        license_status: () => data.license.proEnforced,
        license_device: () => data.licenseDevice?.proEnforced ?? null,
        windows_info: () => data.environment.windows,
        detect_environment: () => data.environment,
        scan_software: () => data.scan.inventory,
        last_software_scan: () => data.scan.inventory,
        software_catalogue: () => data.machineCatalogue ?? [],
        machine_facts: () => data.environment?.machine ?? null,
        capability_report: () => data.capabilities ?? [],
        explained_catalogue: () => data.explained ?? [],
        list_goals: () =>
          data.goals ?? { goals: [], goalsWithoutProfiles: [], defaultGoal: "" },
        environment_plan: (a) =>
          (data.goalPlans ?? []).find((p) => p.goalId === a.goalId) ?? null,
        environment_plans: () => data.goalPlans ?? [],
        explain_software: (a) =>
          (data.explained ?? []).find((e) => e.knowledge.id === a.id) ?? null,
        list_profiles: () => data.profiles,
        get_profile: (a) => data.profiles.find((p) => p.id === a.id) ?? null,
        profile_capabilities: (a) =>
          data.profileCapabilities?.[a.profileId] ?? { derived: [], unknownDeclared: [] },
        knowledge_status: () => data.knowledgeStatus,
        advisor_summary: () => data.advisor,
        localization_targets: () => data.localizationTargets ?? [],
        execution_readiness: () => data.readiness,
        resumable_install: () => null,
        last_install_session: () => null,
        resumable_bootstrap: () => null,
        last_bootstrap: () => null,
        // --- the path under test -------------------------------------------
        build_install_plan_for: (a) => data.pickedPlans?.[key(a.ids)] ?? null,
        install_strategies_for: (a) => data.pickedStrategies?.[key(a.ids)] ?? [],
        // Profile-scoped variants stay wired so a regression that quietly goes
        // back to them still renders something rather than crashing.
        build_install_plan: (a) => data.plans?.[a.profileId] ?? null,
        install_strategies: (a) => data.strategies?.[a.profileId] ?? [],
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
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      };
    },
    { data: fixtures },
  );

  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  return { browser, page, consoleErrors };
}

/** Store facts, including the plan the install screen is working from. */
async function surface(page) {
  return page.evaluate(async () => {
    const store = window.useApp ?? (await import("/src/lib/store.ts")).useApp;
    const s = store.getState();
    return {
      screen: s.screen,
      entitlements: s.entitlements ? s.entitlements.state : null,
      tier: s.entitlements ? s.entitlements.tier : null,
      canInstall: s.entitlements ? s.entitlements.canInstall : null,
      plan: s.plan
        ? {
            profileId: s.plan.profileId,
            estimatedMinutes: s.plan.estimatedMinutes,
            steps: s.plan.steps.map((st) => ({ id: st.id, satisfied: st.satisfied })),
          }
        : null,
      strategies: (s.strategies ?? []).map((st) => ({
        id: st.id,
        preferred: st.preferred,
      })),
      chosenSteps: s.chosenSteps === null ? null : [...s.chosenSteps],
      planError: s.planError,
    };
  });
}

async function goToSoftware(page) {
  await page.evaluate(async () => {
    const store = window.useApp ?? (await import("/src/lib/store.ts")).useApp;
    store.getState().goTo("software");
  });
  await page.waitForSelector('[data-software-row="cherry_studio"]', { timeout: 10000 });
}

// ===========================================================================
// 1. The reported request: press 安装 on Cherry Studio
// ===========================================================================
console.log("\n== 1. Cherry Studio: 安装 builds a Cherry Studio plan ==\n");
{
  const { browser, page, consoleErrors } = await boot();
  await goToSoftware(page);

  // **Guard the fixture, not just the product.** `proEnforced` used to be built
  // with `..Default::default()`, and `LicenseFile::default()` is `Tier::Free` —
  // so this fixture was a FREE activation named PRO, and every suite "testing a
  // PRO customer" was testing a free one. If that regresses, all the assertions
  // below would pass while testing the wrong tier, so it is asserted first.
  const ent = await surface(page);
  check(
    "the fixture really is a PRO customer that may install",
    ent.tier === "pro" && ent.canInstall === true,
    `tier=${ent.tier} canInstall=${ent.canInstall}`,
  );

  const rowLabel = await page.getAttribute(
    '[data-software-row="cherry_studio"] [data-testid="row-action-install"]',
    "aria-label",
  );
  check(
    "the Cherry Studio row offers a real install action",
    rowLabel !== null && rowLabel.includes("安装"),
    `aria-label=${rowLabel}`,
  );

  await page.click('[data-software-row="cherry_studio"] [data-testid="row-action-install"]');
  await page.waitForTimeout(900);

  const st = await surface(page);
  const ids = (st.plan?.steps ?? []).map((s) => s.id);

  check("pressing 安装 navigates to the install screen", st.screen === "install", `screen=${st.screen}`);
  check("the plan contains the program that was pressed", ids.includes("cherry_studio"), `ids=${ids}`);
  check(
    "the plan does NOT contain Claude Code",
    !ids.includes("claude_code"),
    `ids=${ids}`,
  );
  check(
    "no AI CLI is smuggled in from a profile",
    !ids.some((id) => ["claude_code", "codex", "gemini", "qwen_code", "kimi_cli"].includes(id)),
    `ids=${ids}`,
  );
  check(
    "the plan is not the profile plan (profileId is empty)",
    st.plan?.profileId === "",
    `profileId=${JSON.stringify(st.plan?.profileId)}`,
  );
  check("no plan error was raised", st.planError === null, `planError=${st.planError}`);

  // A chosen program must arrive with a real install method. The pre-fix screen
  // said "安装方式还没有收录" for anything outside the selected profile.
  const strat = st.strategies.find((s) => s.id === "cherry_studio");
  check(
    "Cherry Studio arrives with an install method, not an empty one",
    strat !== undefined && strat.preferred.trim().length > 0,
    `preferred=${JSON.stringify(strat?.preferred)}`,
  );

  // No profile ⇒ no time estimate. The screen must show nothing rather than a
  // number invented from a step count.
  check(
    "no estimate is claimed for a hand-picked plan",
    st.plan?.estimatedMinutes === null,
    `estimatedMinutes=${JSON.stringify(st.plan?.estimatedMinutes)}`,
  );

  // And the screen the student sees agrees with the store.
  const choose = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      text: text.replace(/\s+/g, " "),
      installables: [...document.querySelectorAll('input[type="checkbox"]')].map(
        (c) => c.getAttribute("aria-label"),
      ),
    };
  });
  check(
    "the choice screen offers Cherry Studio and nothing about Claude",
    choose.text.includes("Cherry Studio") && !/Claude/.test(choose.text),
    `installables=${JSON.stringify(choose.installables)}`,
  );
  check(
    "the run button is enabled — nothing is being forced",
    !choose.text.includes("至少选一项才能开始") && /开始安装|安装选中的/.test(choose.text),
    choose.text.slice(0, 160),
  );

  check("no console errors on the self-select path", consoleErrors.length === 0, consoleErrors.join(" | "));
  await page.screenshot({ path: join(outDir, "cherry-studio-choose.png") });
  await browser.close();
}

// ===========================================================================
// 2. An already-installed pick is honest about it
// ===========================================================================
console.log("\n== 2. a program that is already installed says so ==\n");
{
  const { browser, page } = await boot();
  await goToSoftware(page);
  await page.waitForSelector('[data-software-row="codex"]', { timeout: 10000 });

  // Codex is installed on the reference machine, so its row is 已安装 and the
  // row action is disabled. Asserting the *state* rather than clicking keeps
  // this independent of which machine the fixtures came from.
  const installed = await page.evaluate(() => {
    const row = document.querySelector('[data-software-row="codex"]');
    if (!row) return null;
    return {
      disabled: !!row.querySelector('[data-testid="row-action-installed"]'),
      text: (row.innerText || "").replace(/\s+/g, " "),
    };
  });
  check(
    "an installed program offers no install action",
    installed === null || installed.disabled,
    JSON.stringify(installed),
  );
  await browser.close();
}

// ===========================================================================
// 3. The capability layer, read through the dashboard, is not Claude-only
// ===========================================================================
console.log("\n== 3. the capability rows no longer name one vendor ==\n");
{
  const { browser, page } = await boot();
  // The capability rule itself is enforced in Rust
  // (`no_capability_requires_one_ai_vendor_by_name`,
  // `the_single_vendor_guard_has_teeth`,
  // `cherry_studio_alone_satisfies_the_desktop_assistant`). What is checked here
  // is that the fixture the UI renders came out of that resolver: the
  // desktop-assistant requirement reads as a category, and Cherry Studio is one
  // of the named choices.
  const summary = await page.evaluate(async () => {
    const store = window.useApp ?? (await import("/src/lib/store.ts")).useApp;
    await store.getState().loadCapabilities();
    const s = store.getState();
    return (s.capabilities ?? [])
      .filter((c) => c.id === "ai-desktop-assistant")
      .map((c) => ({ id: c.id, summary: c.summary, requirements: c.requirements.map((r) => r.label) }));
  });
  const desktop = summary[0];
  check("the desktop-assistant capability is present", desktop !== undefined);
  if (desktop) {
    const joined = `${desktop.summary} ${desktop.requirements.join(" ")}`;
    check(
      "its requirement is stated as a category, not one product",
      /之一/.test(joined),
      joined.slice(0, 200),
    );
    check(
      "Cherry Studio is named as an acceptable choice",
      /Cherry Studio/.test(joined),
      joined.slice(0, 200),
    );
  }
  await browser.close();
}

// ===========================================================================
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failures:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
}
process.exit(failed.length ? 1 : 0);
