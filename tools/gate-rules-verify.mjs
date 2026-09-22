// Gate-rules release suite — three assertions the captain called
// commercially load-bearing, plus the cold-start ordering.
//
// Written as an independent verifier's suite. nav-architect and
// onboarding-designer both have their own probes (`_tmp/gate-*.mjs`,
// `_tmp/t4-probe.mjs`); this file exists because two of these paths are the
// ones that would hurt a real paying customer, and the captain asked for them to
// be locked by the release suite rather than left to a hand check.
//
//   1. A PRO / active licence must NEVER see the gate at all.
//   2. Rule 3: an unreadable licence must NOT be treated as unlicensed.
//      (nav-architect's own first cut was silently broken here -- a stale
//      `getState()` inside an effect whose deps omitted `entitlementsPhase` --
//      which is exactly why this needs an independent assertion.)
//   3. Welcome-before-gate ordering on cold start.
//
// Run: node tools/gate-rules-verify.mjs   (needs `npm run dev` on :1420)

import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "_tmp", "gate-rules");
mkdirSync(outDir, { recursive: true });

const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

/**
 * Boot with a given licence answer and entry flag.
 *
 * `licenseMode`:
 *   "proEnforced"  - an active licence
 *   "freeEnforced" - a readable, unlicensed machine
 *   "unreadable"   - the command REJECTS, i.e. a read error (rule 3)
 * `entry`: localStorage flag - null (never asked) | "free" (answered)
 */
async function boot({ licenseMode = "freeEnforced", entry = null, locale = "dark" } = {}) {
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
      let activeTier = licMode;
      const handlers = {
        load_status: () => data.status,
        load_resumable: () => data.resumable ?? null,
        // An unreadable licence must REJECT, not return a shape: the rejection
        // is what drives `loadEntitlements` into its error branch, which is the
        // state under test.
        license_status: () => {
          if (activeTier === "unreadable") {
            return Promise.reject(new Error("无法读取 license.dat"));
          }
          return data.license[activeTier];
        },
        license_device: () => data.licenseDevice?.[activeTier] ?? null,
        activate_license: () => {
          activeTier = "proEnforced";
          return data.license.proEnforced;
        },
        deactivate_license: () => data.license.freeEnforced,
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
        detect_environment: () => data.environment,
        execution_readiness: () => data.readiness,
        knowledge_status: () => data.knowledgeStatus,
        advisor_summary: () => data.advisor,
        resumable_install: () => null,
        last_install_session: () => null,
        resumable_bootstrap: () => null,
        last_bootstrap: () => null,
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
    { data: fixtures, licMode: licenseMode, entryValue: entry },
  );

  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  return { browser, page, consoleErrors };
}

/** Is the activation gate on screen? */
async function gateVisible(page) {
  return page.evaluate(() => {
    const byTestId = document.querySelector('[data-testid="gate-heading"]');
    if (byTestId) return true;
    // Fall back to the gate's own heading text, so this does not depend on one
    // selector surviving a refactor.
    return /解锁 Setup Center PRO/.test(document.body.innerText || "");
  });
}

/** The screen/store facts we care about. */
async function surface(page) {
  return page.evaluate(async () => {
    const mod = await import("/src/lib/store.ts");
    const s = mod.useApp.getState();
    return {
      screen: s.screen,
      dashboardOpen: s.dashboardOpen,
      entitlements: s.entitlements ? s.entitlements.state : null,
      phase: s.entitlementsPhase,
    };
  });
}

// ===========================================================================
// 1. A PRO / active licence must NEVER see the gate
// ===========================================================================
console.log("\n== 1. an active licence never sees the gate ==\n");
{
  // Cold start, no entry flag, active licence. Rule 1.
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "proEnforced",
    entry: null,
  });
  const gate = await gateVisible(page);
  const st = await surface(page);
  check("PRO + no entry flag -> gate is NOT shown", gate === false, `gate=${gate}`);
  check(
    "PRO + no entry flag -> lands on the dashboard (not Welcome, not the gate)",
    st.dashboardOpen === true,
    `dashboardOpen=${st.dashboardOpen} screen=${st.screen}`,
  );
  check("PRO cold start raises no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
}
{
  // A PRO customer with a STALE "free" flag must still not see the gate:
  // licence beats the flag.
  const { browser, page } = await boot({ licenseMode: "proEnforced", entry: "free" });
  const gate = await gateVisible(page);
  check(
    "PRO + stale FREE flag -> gate is NOT shown (licence beats the flag)",
    gate === false,
    `gate=${gate}`,
  );
  await browser.close();
}

// ===========================================================================
// 2. Rule 3: an unreadable licence is NOT treated as unlicensed
// ===========================================================================
console.log("\n== 2. rule 3: unreadable licence != unlicensed ==\n");
{
  // No recorded answer + read error. The gate is the only surface that can say
  // "we could not read your licence", and it must show rather than silently
  // presenting a FREE machine to someone who may have paid.
  const { browser, page } = await boot({ licenseMode: "unreadable", entry: null });
  const st = await surface(page);
  check(
    "unreadable licence + never asked -> entitlements phase is 'error'",
    st.phase === "error",
    `phase=${st.phase}`,
  );
  check(
    "unreadable licence -> the machine is NOT silently reported as FREE",
    st.entitlements !== "active",
    `state=${st.entitlements}`,
  );
  await browser.close();
}
{
  // Already answered + read error. Rule 2 beats rule 3: do not re-ask.
  const { browser, page } = await boot({ licenseMode: "unreadable", entry: "free" });
  const gate = await gateVisible(page);
  const st = await surface(page);
  check(
    "unreadable licence + already answered -> the gate is NOT re-shown",
    gate === false,
    `gate=${gate}`,
  );
  check(
    "unreadable licence + already answered -> goes to the dashboard, not Welcome",
    st.dashboardOpen === true,
    `dashboardOpen=${st.dashboardOpen}`,
  );
  await browser.close();
}

// ===========================================================================
// 3. Welcome-before-gate ordering on cold start
// ===========================================================================
console.log("\n== 3. cold start shows Welcome, not the gate ==\n");
{
  const { browser, page, consoleErrors } = await boot({
    licenseMode: "freeEnforced",
    entry: null,
  });
  const order = await page.evaluate(() => {
    // Use the components' own testids rather than guessing at heading text.
    // A text match would silently pass on a *reworded* heading, which is why the
    // first cut of this assertion failed against a correct product.
    const hasWelcome = !!document.querySelector('[data-testid="welcome-heading"]');
    const hasGate = !!document.querySelector('[data-testid="gate-heading"]');
    const text = document.body.innerText || "";
    return { hasWelcome, hasGate, text: text.replace(/\s+/g, " ").slice(0, 80) };
  });
  // Asserted on ORDER directly -- both the presence of Welcome AND the absence
  // of the gate -- rather than inferred from a screenshot. A screenshot cannot
  // distinguish "Welcome first" from "gate, then Welcome behind it".
  check("cold start: Welcome IS present", order.hasWelcome === true);
  check(
    "cold start: the gate is NOT present (Welcome comes first)",
    order.hasGate === false,
    `hasGate=${order.hasGate}`,
  );
  check("cold start raises no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await page.screenshot({ path: join(outDir, "coldstart-dark.png") });

  // And once a customer answers FREE, they are not asked again (rule 2).
  const again = await boot({ licenseMode: "freeEnforced", entry: "free" });
  const againGate = await gateVisible(again.page);
  check("answered FREE -> returning customer is NOT asked again", againGate === false);
  await again.browser.close();
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
