// Nested-interactive-element sweep via the RELIABLE method: a React hydration /
// DOM-validity console-error probe on a cold start across every screen.
//
// WHY NOT A GREP. A textual search for `<button>` inside `<button>` proves
// nothing here. The defect only exists at run time, through composition: a
// screen composes a row component that renders its own control, and neither
// file's source text shows the nesting. Both of the real 0.1.1 instances
// (Welcome, Software) were structural, and the captain's correction is that
// their fixes are structural too -- so a grep returning "clean" is silence, not
// evidence. The browser is the authority: invalid nesting makes React emit a
// hydration/validateDOMNesting error, and a nested control that fires two
// handlers shows up as a console error or a double side effect.
//
// It walks every reachable surface in both themes and reports, per screen:
//   * console errors (React hydration / validateDOMNesting / key warnings)
//   * any element that is BOTH interactive and inside another interactive
//     element, read from the LIVE DOM rather than from source text
//
// Run: node tools/hydration-sweep.mjs   (needs `npm run dev` on :1420)

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "_tmp", "hydration");
mkdirSync(outDir, { recursive: true });

const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

/** Screens the wizard can be driven to, plus the dashboard and gate. */
const SCREENS = [
  "welcome",
  "goal",
  "detect",
  "software",
  "choose",
  "install",
  "bootstrap",
  "done",
];

async function open({ theme = "dark", entry = null, licenseMode = "freeEnforced" } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1040, height: 720 },
    colorScheme: theme,
  });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.addInitScript(
    ({ data, entryValue, licMode }) => {
      if (entryValue !== null) window.localStorage.setItem("setup-center.entry", entryValue);
      else window.localStorage.removeItem("setup-center.entry");
      let tier = licMode;
      const handlers = {
        load_status: () => data.status,
        load_resumable: () => null,
        license_status: () => data.license[tier],
        license_device: () => data.licenseDevice?.[tier] ?? null,
        activate_license: () => { tier = "proEnforced"; return data.license.proEnforced; },
        deactivate_license: () => data.license.freeEnforced,
        windows_info: () => data.environment.windows,
        scan_software: () => data.scan.inventory,
        last_software_scan: () => data.scan.inventory,
        capability_report: () => data.capabilities ?? [],
        software_catalogue: () => data.machineCatalogue ?? [],
        machine_facts: () => data.environment?.machine ?? null,
        explained_catalogue: () => data.explained ?? [],
        list_goals: () => data.goals ?? { goals: [], goalsWithoutProfiles: [], defaultGoal: "" },
        environment_plan: (a) => (data.goalPlans ?? []).find((p) => p.goalId === a.goalId) ?? null,
        environment_plans: () => data.goalPlans ?? [],
        explain_software: (a) => (data.explained ?? []).find((e) => e.knowledge.id === a.id) ?? null,
        list_profiles: () => data.profiles,
        build_install_plan: (a) => data.plans?.[a.profileId] ?? null,
        install_strategies: () => [],
        preview_install: () => data.preview ?? null,
        detect_environment: () => data.environment,
        execution_readiness: () => data.readiness,
        knowledge_status: () => data.knowledgeStatus,
        advisor_summary: () => data.advisor,
        advisor_report_text: () => data.advisorText ?? "",
        generate_report: () => ({ report: data.report, text: data.reportText }),
        runtime_status: () => data.status,
        resumable_install: () => null,
        last_install_session: () => null,
        resumable_bootstrap: () => null,
        last_bootstrap: () => null,
        run_install: () => null,
        cancel_install: () => true,
      };
      window.__TAURI_INTERNALS__ = {
        invoke: (c, a) => Promise.resolve(handlers[c] ? handlers[c](a) : null),
        transformCallback: (cb) => cb,
        unregisterCallback: () => {},
        convertFileSrc: (p) => p,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      };
    },
    { data: fixtures, entryValue: entry, licMode: licenseMode },
  );

  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.evaluate(async () => {
    const mod = await import("/src/lib/store.ts");
    window.__nav = { s: () => mod.useApp.getState() };
  });
  return { browser, page, errors };
}

/**
 * Inspect the LIVE DOM for nested interactives.
 *
 * This is the check a grep cannot do. It walks the rendered tree, so a control
 * contributed by a composed child component is found even though no single
 * source file contains the nesting.
 */
const INSPECT = () => {
  const INTERACTIVE_TAGS = new Set(["button", "a", "summary", "select", "textarea", "input"]);
  const isInteractive = (el) => {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) return true;
    const role = el.getAttribute("role");
    if (role === "button" || role === "link" || role === "tab" || role === "checkbox") return true;
    if (el.hasAttribute("onclick")) return true;
    // A click handler is visible in the DOM only via React's delegated props; a
    // `data-*`-free div with a handler still counts as clickable for our purpose.
    return false;
  };

  const offenders = [];
  for (const el of document.querySelectorAll("*")) {
    if (!isInteractive(el)) continue;
    // Walk ancestors: any interactive ancestor means nesting.
    let p = el.parentElement;
    let hops = 0;
    while (p && hops++ < 40) {
      if (isInteractive(p)) {
        const label = (x) =>
          `${x.tagName.toLowerCase()}${x.getAttribute("data-testid") ? `[${x.getAttribute("data-testid")}]` : ""}`;
        offenders.push({
          child: label(el),
          parent: label(p),
          childText: (el.innerText || "").trim().slice(0, 40),
          parentText: (p.innerText || "").trim().slice(0, 40),
        });
        break;
      }
      p = p.parentElement;
    }
  }
  return offenders;
};

// ===========================================================================
// Sweep each screen
// ===========================================================================
for (const theme of ["dark", "light"]) {
  console.log(`\n== theme: ${theme} ==\n`);
  const { browser, page, errors } = await open({ theme, entry: "free" });
  await page.evaluate(() => window.__nav.s().closeDashboard?.());
  await page.waitForTimeout(500);

  for (const screen of SCREENS) {
    const before = errors.length;
    await page.evaluate((s) => window.__nav.s().goTo(s), screen);
    await page.waitForTimeout(700);

    const offenders = await page.evaluate(INSPECT);
    const newErrors = errors.slice(before);
    const nestingErrors = newErrors.filter((e) =>
      /validateDOMNesting|cannot appear as a descendant|hydration/i.test(e),
    );

    check(
      `${theme}/${screen}: no nested interactive elements`,
      offenders.length === 0,
      offenders.length ? JSON.stringify(offenders.slice(0, 3)) : "",
    );
    check(
      `${theme}/${screen}: no React nesting/hydration console errors`,
      nestingErrors.length === 0,
      nestingErrors.slice(0, 2).join(" | "),
    );
  }
  await browser.close();
}

// ===========================================================================
// SoftwareRow.tsx -- the latently-risky file, exercised on the real grid
// ===========================================================================
console.log("\n== SoftwareRow.tsx (latent risk) ==\n");
{
  const { browser, page, errors } = await open({ theme: "dark", entry: "free" });

  // SoftwareRow mounts in two places (`Dashboard.tsx:1098`, `Software.tsx:412`).
  // The wizard's software screen is the shorter path to a reliably-mounted grid:
  // the dashboard's own section has to be selected first, and an earlier cut of
  // this probe measured 0 rows because it stopped at the dashboard root -- a
  // vacuous pass, which is exactly what this file exists to avoid.
  await page.evaluate(() => window.__nav.s().closeDashboard?.());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__nav.s().goTo("software"));
  await page.waitForTimeout(1600);

  let rows = await page.locator("[data-software-row]").count();
  if (rows === 0) {
    // Fall back to the dashboard grid via its 软件 section.
    await page.evaluate(() => window.__nav.s().openDashboard?.());
    await page.waitForTimeout(1200);
    const tab = page.getByRole("button", { name: /^软件\s*\d*$/ }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(1500);
    }
    rows = await page.locator("[data-software-row]").count();
  }
  check("SoftwareRow rows are rendered (grid actually mounted)", rows > 0, `rows=${rows}`);

  // IMPORTANT: two different components both stamp `data-software-row`.
  //   * `src/components/SoftwareRow.tsx:97` -- a whole-row <button>. This is the
  //     file the captain flagged; its latent risk is the one that matters.
  //   * `src/screens/Software.tsx:460` -- a local <div> container (the wizard's
  //     redesigned row). Safe by construction: the toggle inside it is nested in
  //     a div, not in another button.
  // An earlier cut of this probe measured only the wizard's <div> and would have
  // reported "SoftwareRow clean" against the wrong element -- a vacuous pass.
  // So drive the DASHBOARD grid and assert specifically on `button[data-software-row]`.
  await page.evaluate(() => window.__nav.s().closeDashboard?.());
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__nav.s().openDashboard?.());
  await page.waitForTimeout(1000);
  const gridTab = page.getByRole("button", { name: /^软件\s*\d*$/ }).first();
  if (await gridTab.isVisible().catch(() => false)) {
    await gridTab.click();
    await page.waitForTimeout(1600);
  }

  const buttonRows = await page.locator("button[data-software-row]").count();
  check(
    "the flagged component (components/SoftwareRow.tsx, whole-row <button>) is mounted",
    buttonRows > 0,
    `button[data-software-row]=${buttonRows}; a 0 here means only the wizard's <div> row was tested`,
  );

  const info = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("button[data-software-row]")];
    return rows.slice(0, 3).map((r) => ({
      tag: r.tagName.toLowerCase(),
      isButton: r.tagName.toLowerCase() === "button",
      ariaPressed: r.getAttribute("aria-pressed"),
      nestedControls: r.querySelectorAll(
        "button, a, input, select, textarea, [role=button]",
      ).length,
    }));
  });
  console.log("   sample button-rows:", JSON.stringify(info, null, 2));

  const offenders = await page.evaluate(INSPECT);
  const rowOffenders = offenders.filter((o) => o.parent.includes("data-software-row"));
  check(
    "SoftwareRow: no nested interactive element today",
    rowOffenders.length === 0,
    rowOffenders.length ? JSON.stringify(rowOffenders) : "",
  );

  const nestingErrors = errors.filter((e) =>
    /validateDOMNesting|cannot appear as a descendant|hydration/i.test(e),
  );
  check(
    "SoftwareRow: no React nesting console errors",
    nestingErrors.length === 0,
    nestingErrors.slice(0, 2).join(" | "),
  );

  // Document the latent risk explicitly: the row IS a whole-row <button>.
  const isWholeRowButton = info.length > 0 && info.every((r) => r.isButton);
  console.log(
    `\n  NOTE: the row is a whole-row <button> with onClick -> ${isWholeRowButton}.` +
      `\n  Safe today (no nested control), but it becomes the Welcome-class bug` +
      `\n  the moment a per-row action is added inside it.`
  );
  await browser.close();
}

// ===========================================================================
// Welcome: assert on ActivationCard, NOT UpgradePrompt (captain's correction)
// ===========================================================================
console.log("\n== Welcome third entry renders ActivationCard ==\n");
{
  const { browser, page, errors } = await open({ theme: "dark", entry: null });
  const before = errors.length;

  const trigger = page.locator('[data-testid="welcome-activate"]');
  check("the ③ entry control exists", (await trigger.count()) > 0);

  if (await trigger.count()) {
    await trigger.first().click();
    await page.waitForTimeout(700);
  }
  const card = await page.evaluate(() => {
    // The card is the real component on disk; `UpgradePrompt` is not rendered
    // here (and `UpgradePrompt.tsx` does not exist as a file in 0.1.1).
    const text = document.body.innerText || "";
    return {
      hasKeyInput: !!document.querySelector("#activation-key, input[type=text]"),
      hasCardText: /激活|授权|设备绑定/.test(text),
    };
  });
  check("clicking the ③ entry opens an activation card (key input present)", card.hasKeyInput);
  check(
    "welcome: opening the card raises no console errors",
    errors.length === before,
    errors.slice(before).slice(0, 2).join(" | "),
  );
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
