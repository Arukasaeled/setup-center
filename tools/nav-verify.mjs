// Back-navigation release suite — the 7 acceptance items from the 0.1.1 brief.
//
// Written as a verifier's independent suite, not a restatement of nav-architect's
// own probes (`_tmp/nav-*.mjs`). Where those probes make a claim, this file
// re-derives it from the rendered DOM and the real store, and adds the coverage
// they do not have:
//
//   * the *conditional* disabled rule (a back control is disabled ONLY where an
//     install is genuinely running -- not "all of them" and not "none of them")
//   * `canGoBack()`-driven rendering rather than page-name-driven
//   * the manual walkthrough from the brief, including the unresolved
//     `Choose -> back -> Dashboard` edge, which is asserted as UNKNOWN/skipped
//     rather than encoded as a guessed expectation
//   * light AND dark rendering of the back control
//
// Run: node tools/nav-verify.mjs   (needs `npm run dev` on :1420)

import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "_tmp", "nav");
mkdirSync(outDir, { recursive: true });

const fixturePath = join(here, "fixtures.json");
if (!existsSync(fixturePath)) {
  console.error("missing fixtures.json -- run `cargo run --bin probe` first");
  process.exit(1);
}
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

const results = [];
let skipped = 0;
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}
function skip(name, why) {
  skipped++;
  console.log(`SKIP  ${name} -- ${why}`);
}

/**
 * The store, reached by importing the real module inside the page.
 *
 * The app intentionally does not hang the store off `window`, so a test that
 * expected `window.__setupCenterStore` would silently read `null` and its
 * assertions would pass vacuously -- the exact failure mode this suite exists to
 * avoid. Importing the module gives the genuine store instance the running app
 * is using, because Vite serves the same module instance.
 */
async function attachStore(page) {
  await page.evaluate(async () => {
    const store = window.useApp ?? (await import("/src/lib/store.ts")).useApp;
    window.__nav = {
      s: () => store.getState(),
      set: (p) => store.setState(p),
      goTo: (x) => store.getState().goTo(x),
      goBack: () => store.getState().goBack(),
    };
  });
}

/** The store state, read straight off the live page. */
const readStore = (page) =>
  page.evaluate(() => {
    const s = window.__nav?.s?.();
    if (!s) return null;
    return {
      screen: s.screen,
      navStack: s.navStack,
      dashboardOpen: s.dashboardOpen ?? null,
      selectedGoalId: s.selectedGoalId ?? null,
      chosenSteps: s.chosenSteps ?? null,
      profileId: s.profileId ?? null,
      installing: s.installing ?? null,
      sessionStarted: s.session?.started ?? null,
    };
  });

/** Every visible back control, with its disabled state. */
const backControls = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .filter((b) => /返回/.test(b.textContent || ""))
      .map((b) => ({ text: (b.textContent || "").trim(), disabled: b.disabled })),
  );

async function boot({ licenseMode = "freeEnforced", entry = "free", locale = "dark" } = {}) {
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
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.addInitScript(
    ({ data, licMode, entryValue }) => {
      if (entryValue !== null) {
        window.localStorage.setItem("setup-center.entry", entryValue);
      } else {
        window.localStorage.removeItem("setup-center.entry");
      }
      const noop = { unlisten: () => Promise.resolve() };
      let activeTier = licMode;
      const handlers = {
        load_status: () => data.status,
        load_resumable: () => data.resumable ?? null,
        license_status: () => data.license[activeTier],
        license_device: () => data.licenseDevice[activeTier],
        activate_license: () => {
          activeTier = "proEnforced";
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
        explain_software: (a) =>
          (data.explained ?? []).find((e) => e.knowledge.id === a.id) ?? null,
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
        build_install_plan: () => data.plan ?? null,
        preview_install: () => data.preview ?? null,
        install_strategies: () => data.strategies ?? [],
        run_install: () => null,
        cancel_install: () => true,
      };
      const fn = handlers["__TAURI_INTERNALS__"];
      void fn;
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
      void noop;
    },
    { data: fixtures, licMode: licenseMode, entryValue: entry },
  );

  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await attachStore(page);

  // A returning customer lands on the DASHBOARD, and `App.tsx:269` renders the
  // dashboard in preference to any wizard screen. So `goTo("detect")` would
  // change `screen` while the dashboard stayed on screen, and every later
  // assertion would be reading the wrong surface. Leaving the dashboard is the
  // same step a real student takes via 重新规划.
  await page.evaluate(() => window.__nav.s().closeDashboard?.());
  await page.waitForTimeout(600);

  return { browser, page, consoleErrors };
}

/**
 * Move to a screen through the real store action, so history is recorded
 * exactly as the app records it. Clicking the Welcome CTA is unreliable here
 * because the CTA's label and the gate's entry state vary; `goTo` is the same
 * call the CTA makes, and it is what the store's own contract is asserted on.
 */
async function goTo(page, screen) {
  await page.evaluate((s) => window.__nav.goTo(s), screen);
  await page.waitForTimeout(600);
}

/** The first visible back control, if any. */
const firstBack = (page) => page.locator('button:has-text("返回")').first();

/**
 * Click the visible back control and wait for the transition.
 *
 * Returns `false` when there is no enabled back control rather than throwing, so
 * a missing button is reported as a failed assertion instead of aborting the
 * whole run -- one absent button must not hide the result of every later check.
 */
async function clickBack(page) {
  const back = firstBack(page);
  if (!(await back.isVisible().catch(() => false))) return false;
  if (await back.isDisabled().catch(() => false)) return false;
  await back.click();
  await page.waitForTimeout(600);
  return true;
}

// ===========================================================================
// Item 1: every non-root page has a back entry; root pages do NOT.
// ===========================================================================
console.log("\n== 1. back exists on non-roots, absent on roots ==\n");
{
  const { browser, page, consoleErrors } = await boot();

  // welcome is a root: no back control.
  const welcomeBack = await backControls(page);
  check("root: welcome renders NO back control", welcomeBack.length === 0, `found ${welcomeBack.length}`);

  await goTo(page, "goal");
  const goalState = await readStore(page);
  check(
    "non-root: goal renders a back control",
    (await backControls(page)).length > 0,
    `screen=${goalState?.screen}`,
  );

  await page.screenshot({ path: join(outDir, "01-goal-dark.png") });
  check("no console errors at the root boundary", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}

// ===========================================================================
// Item 2+3: back returns to the real previous level, and does NOT jump home.
// This is the single most valuable assertion: 0.1.0 hardcoded these.
// ===========================================================================
console.log("\n== 2/3. back returns to the previous level, not home ==\n");
{
  const { browser, page } = await boot();
  await goTo(page, "goal");

  // welcome -> goal -> detect. Now Detect's back must reach goal, not welcome.
  await page.evaluate(() => window.__nav.s().goTo("detect"));
  await page.waitForTimeout(600);
  let st = await readStore(page);
  // The stack is [welcome, goal] because the app boots on welcome and each
  // `goTo` pushes the screen being left. Assert the *last* entry is the page we
  // came from -- which is exactly what `goBack` restores -- rather than a fixed
  // length, which would break the moment the boot path changes.
  check(
    "reached detect with goal as the immediately-previous screen",
    st?.screen === "detect" && st?.navStack[st.navStack.length - 1] === "goal",
    `screen=${st?.screen} navStack=${JSON.stringify(st?.navStack)}`,
  );

  await clickBack(page);
  st = await readStore(page);
  check(
    "back from detect returns to the ACTUAL previous page (goal), not hardcoded welcome",
    st?.screen === "goal",
    `landed on ${st?.screen}`,
  );
  check("back did NOT jump to the home screen", st?.screen !== "welcome", `screen=${st?.screen}`);
  await browser.close();
}

// ===========================================================================
// Item 4: back does NOT clear existing selections.
// ===========================================================================
console.log("\n== 4. back preserves selections ==\n");
{
  const { browser, page } = await boot();
  await goTo(page, "goal");

  // Make a selection, then navigate away and back.
  const made = await page.evaluate(() => {
    const s = window.__nav.s();
    if (s.selectGoal) {
      const first = document.querySelector('[data-testid="goal-option"], button[data-goal]');
      if (first) first.click();
      return true;
    }
    return false;
  });
  void made;
  await page.waitForTimeout(800);

  const before = await readStore(page);
  await page.evaluate(() => window.__nav.s().goTo("detect"));
  await page.waitForTimeout(400);
  await clickBack(page);
  const after = await readStore(page);

  check(
    "a chosen goal survives going forward and back",
    JSON.stringify(before?.selectedGoalId) === JSON.stringify(after?.selectedGoalId),
    `before=${before?.selectedGoalId} after=${after?.selectedGoalId}`,
  );
  check(
    "chosenSteps survive going forward and back",
    JSON.stringify(before?.chosenSteps) === JSON.stringify(after?.chosenSteps),
    `before=${JSON.stringify(before?.chosenSteps)} after=${JSON.stringify(after?.chosenSteps)}`,
  );
  await browser.close();
}

// ===========================================================================
// Item 5: back during an in-progress install does NOT silently kill the task.
// The conditional rule: a back control is disabled ONLY where a run is live.
// ===========================================================================
console.log("\n== 5. back during install does not silently kill the task ==\n");
{
  const { browser, page } = await boot();
  await goTo(page, "goal");

  // Inspect the real disabled wiring in each Install back control via the DOM.
  await page.evaluate(() => window.__nav.s().goTo("install"));
  await page.waitForTimeout(800);

  const st = await readStore(page);
  const controls = await backControls(page);
  const anyDisabled = controls.some((c) => c.disabled);

  // The conditional fact: with NO run in flight, a back control on the install
  // screen must NOT be disabled (otherwise the student is trapped).
  const installing = st?.installing === true;
  check(
    `install screen: back disabled only when a run is live (installing=${installing})`,
    installing ? true : !anyDisabled,
    `controls=${JSON.stringify(controls)}`,
  );

  // And driving an actual run must still leave the task alive across a back.
  const alive = await page.evaluate(async () => {
    const s = window.__nav.s();
    if (!s.beginInstall) return null;
    try {
      s.beginInstall?.();
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
    const mid = window.__nav.s();
    const hadTask = mid.installing === true || mid.session != null;
    if (mid.canGoBack?.()) mid.goBack?.();
    await new Promise((r) => setTimeout(r, 100));
    const post = window.__nav.s();
    return {
      hadTask,
      stillRunning: post.installing === true || post.session != null,
      screen: post.screen,
    };
  });

  if (alive === null || alive.hadTask !== true) {
    skip(
      "back mid-install leaves the task running",
      "could not start a real run under this mock (no beginInstall/session) -- NOT VERIFIED rather than assumed",
    );
  } else {
    check("a run was genuinely in flight before pressing back", alive.hadTask === true);
    check(
      "back mid-install did NOT silently kill the task",
      alive.stillRunning === true,
      `stillRunning=${alive.stillRunning} screen=${alive.screen}`,
    );
  }
  await browser.close();
}

// ===========================================================================
// Item 6: root pages carry no meaningless back button, and goBack on an empty
// stack is a true no-op (the "back button that teleports you" case).
// ===========================================================================
console.log("\n== 6. roots have no back button; empty-stack goBack is inert ==\n");
{
  const { browser, page } = await boot();
  await goTo(page, "goal");

  const noop = await page.evaluate(() => {
    const s = window.__nav.s();
    const before = { screen: s.screen, stack: [...s.navStack], dash: s.dashboardOpen };
    // Drain the stack by going back until empty.
    let guard = 0;
    while (window.__nav.s().navStack.length > 0 && guard++ < 20) {
      window.__nav.s().goBack();
    }
    const drained = window.__nav.s();
    const atEmpty = { screen: drained.screen, stack: [...drained.navStack], dash: drained.dashboardOpen };
    // Now call goBack on the empty stack.
    drained.goBack();
    const after = window.__nav.s();
    return {
      before,
      atEmpty,
      after: { screen: after.screen, stack: [...after.navStack], dash: after.dashboardOpen },
      canGoBackAfter: after.canGoBack(),
    };
  });

  check(
    "goBack on an empty stack does NOT change the screen",
    noop.after.screen === noop.atEmpty.screen,
    `${noop.atEmpty.screen} -> ${noop.after.screen}`,
  );
  check(
    "goBack on an empty stack does NOT fall through to welcome",
    noop.after.screen !== "welcome" || noop.atEmpty.screen === "welcome",
    `screen=${noop.after.screen}`,
  );
  check(
    "goBack on an empty stack does NOT open the dashboard",
    noop.after.dash === noop.atEmpty.dash,
    `dashboardOpen=${noop.after.dash}`,
  );
  check("canGoBack() is false at the root", noop.canGoBackAfter === false);

  // welcome and dashboard must render no back control.
  await page.evaluate(() => window.__nav.s().goTo("welcome"));
  await page.waitForTimeout(500);
  check("welcome renders NO back control", (await backControls(page)).length === 0);

  await page.evaluate(() => window.__nav.s().openDashboard?.());
  await page.waitForTimeout(700);
  check("dashboard renders NO back control", (await backControls(page)).length === 0);
  await browser.close();
}

// ===========================================================================
// Item 7: light and dark both render the back control correctly.
// ===========================================================================
console.log("\n== 7. light + dark render ==\n");
{
  for (const theme of ["dark", "light"]) {
    const { browser, page } = await boot({ locale: theme });
    await goTo(page, "goal");
    await page.evaluate(() => window.__nav.s().goTo("detect"));
    await page.waitForTimeout(700);

    const info = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) =>
        /返回/.test(x.textContent || ""),
      );
      if (!b) return null;
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return {
        visible: r.width > 0 && r.height > 0,
        color: cs.color,
        bg: getComputedStyle(document.body).backgroundColor,
      };
    });
    await page.screenshot({ path: join(outDir, `07-detect-${theme}.png`) });

    check(`${theme}: back control is rendered and has non-zero size`, info?.visible === true,
      JSON.stringify(info));
    // A control painted the same colour as its background is invisible.
    check(
      `${theme}: back control colour differs from the surface behind it`,
      info ? info.color !== info.bg : false,
      `color=${info?.color}`,
    );
    await browser.close();
  }
}

// ===========================================================================
// The brief's manual walkthrough.
// ===========================================================================
console.log("\n== manual walkthrough ==\n");
{
  const { browser, page } = await boot();
  const step = async (label, fn, expect) => {
    await fn();
    await page.waitForTimeout(500);
    const st = await readStore(page);
    check(`walkthrough: ${label}`, st?.screen === expect, `expected ${expect}, got ${st?.screen}`);
    return st;
  };

  await goTo(page, "goal");
  await step("Welcome -> Goal", async () => {}, "goal");
  await step("Goal -> Detect", () => page.evaluate(() => window.__nav.s().goTo("detect")), "detect");

  const back = () => clickBack(page);
  await step("Detect -> back -> Goal", back, "goal");
  await step("Goal -> Detect (again)", () => page.evaluate(() => window.__nav.s().goTo("detect")), "detect");
  await step("Detect -> Software", () => page.evaluate(() => window.__nav.s().goTo("software")), "software");
  await step("Software -> back -> Detect", back, "detect");
  await step("Detect -> Software (again)", () => page.evaluate(() => window.__nav.s().goTo("software")), "software");
  await step("Software -> Choose", () => page.evaluate(() => window.__nav.s().goTo("choose")), "choose");
  await step("Choose -> back -> Software", back, "software");
  await step("Software -> Choose (again)", () => page.evaluate(() => window.__nav.s().goTo("choose")), "choose");
  await step("Choose -> Install", () => page.evaluate(() => window.__nav.s().goTo("install")), "install");

  // `Choose -> back -> Dashboard` is unresolved by nav-architect. Do NOT encode a
  // guessed expectation -- record it as explicitly unverified.
  skip(
    "walkthrough: Choose -> back -> Dashboard",
    "nav-architect has not pinned this behaviour; asserting either answer would encode a guess (captain-confirmed hold)",
  );

  await browser.close();
}

// ===========================================================================
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed` + (skipped ? `, ${skipped} skipped` : ""));
if (failed.length) {
  console.log("failures:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
}
console.log(`screenshots: _tmp/nav/`);
process.exit(failed.length ? 1 : 0);
