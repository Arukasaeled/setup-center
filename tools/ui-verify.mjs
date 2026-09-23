// Renders the production frontend in a headless browser with a mock Tauri
// backend, so the UI can be verified (and screenshotted) without a display.
//
// Why this exists: capturing the real desktop window is unreliable on a machine
// with other windows open, and it cannot exercise the "detect" screen at all
// without a human clicking. This harness lets a script drive the whole flow.
//
// It stubs `__TAURI_INTERNALS__.invoke` with the *real* payloads captured from
// the Rust commands (see probe.rs / captured.json), so the UI is exercised
// against genuine data shapes rather than invented fixtures.

import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "_tmp", "ui");
mkdirSync(outDir, { recursive: true });

const fixturePath = join(here, "fixtures.json");
if (!existsSync(fixturePath)) {
  console.error("missing fixtures.json — run `cargo run --bin probe` first");
  process.exit(1);
}
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1040, height: 720 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});

// Fail loudly on any console error: a React key warning or an undefined
// property read is exactly the kind of thing a screenshot alone would hide.
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

await page.addInitScript((data) => {
  const noop = () => ({ unlisten: () => Promise.resolve() });
  let maximised = false;

  // This harness verifies the *wizard*, which since the commercial revision sits
  // behind the first-run activation gate. It does NOT seed the gate's flag: it
  // walks the gate the way a real customer does, because the gate is now part of
  // the first-run path this file exists to verify. Seeding the flag would skip
  // that path and leave the harness testing a route no customer takes.
  //
  // The gate itself is covered in depth by `gate-verify.mjs` /
  // `gate-interact.mjs`; this file only needs to get past it.

  // Which demo session the install screen should receive. The harness flips
  // this before the run, so the same page exercises the success, partial-failure
  // and permission-halt branches without three separate browser launches.
  const mode = {
    session: "completed",
    started: 0,
    profileId: null,
    bootstrapSession: "completed",
    bootstrapStarted: 0,
    // Which licence answer the next `license_status` returns. Starts at the
    // shipping default — which since the commercial revision is the *enforced
    // free* tier, so the section is verified in its real configuration rather
    // than in a permissive one that no customer will see.
    //
    // Read back from `sessionStorage` so a staged mode survives the reload used
    // to apply it; `__setLicenseMode` writes both.
    licenseMode: window.sessionStorage.getItem("__licenseMode") ?? "freeEnforced",
    // Models "has a detection landed in the Rust cache yet". The advisor is a
    // *view over* the detection report, so before this flips the Rust side
    // genuinely answers with the pre-detection summary (`detected: false`,
    // score 0, the "没有一项检测完成" headline). `detect_environment` flips it.
    //
    // That is the whole cold-start race: the advisor was fetched once on mount —
    // before detection landed — and never refreshed, so the overview announced
    // "nothing was detected" above capability lists read from a finished report.
    //
    // Seeded from `sessionStorage` rather than from a plain variable because this
    // init script re-runs on every `page.reload()`, which would otherwise reset
    // the switch before the reload that stages the race.
    advisorStale: window.sessionStorage.getItem("__advisorStale") === "1",
    detectionRan: false,
  };

  // Sessions are per profile, and the chosen profile is whatever the last
  // `build_install_plan` call named. Indexing by it is what keeps the session's
  // step ids aligned with the plan the screen is rendering.
  const sessionFor = (name) => {
    const byProfile = data.sessions[mode.profileId] ?? data.sessions;
    return byProfile[name] ?? null;
  };

  const handlers = {
    detect_environment: () => {
      // On the real machine detection is network-bound and takes seconds, which
      // is what creates the cold-start race: the dashboard mounts and asks for
      // the advisor *while* detection is still in flight.
      //
      // The delay is applied only while the race is being staged. Returning
      // instantly here made the race unstageable — the advisor was always
      // fetched after `detectionRan` had flipped, so the regression could not be
      // reproduced and the guard was untestable. Keeping it conditional leaves
      // the other assertions on their existing, deterministic timing.
      const settle = (resolve) => {
        mode.detectionRan = true;
        resolve(data.environment);
      };
      return new Promise((resolve) =>
        mode.advisorStale ? setTimeout(() => settle(resolve), 1500) : settle(resolve),
      );
    },
    windows_info: () => data.environment.windows,
    scan_software: () => data.scan.inventory,
    last_software_scan: () => data.scan.inventory,
    list_profiles: () => data.profiles,
    get_profile: (a) => data.profiles.find((p) => p.id === a.id),
    build_install_plan: (a) => {
      mode.profileId = a.profileId;
      return data.plans[a.profileId];
    },
    install_strategies: (a) => data.strategies[a.profileId] ?? [],
    preview_install: (a) => data.previews[a.plan.profileId] ?? data.preview,
    execution_readiness: () => data.readiness,
    // The real engine takes minutes; the harness returns a pre-built session
    // immediately. The session objects come from Rust (`demo_session` in
    // probe.rs), so the shapes are the ones the engine actually produces.
    run_install: () => {
      mode.started += 1;
      return sessionFor(mode.session);
    },
    resume_install: () => sessionFor("completed"),
    cancel_install: () => true,
    resumable_install: () => (mode.session === "empty" ? null : sessionFor("halted")),
    last_install_session: () => sessionFor(mode.session),
    verify_installation: (a) => data.verificationByProfile[a.plan.profileId],
    planned_config_actions: (a) => data.configActions[a.profileId] ?? [],
    generate_report: () => ({
      report: data.report,
      text: data.reportText,
    }),
    save_report: () => "C:\\Users\\student\\Documents\\AI Student Setup\\report.txt",
    runtime_status: () => data.status,

    // --- Bootstrap (stage 4) ------------------------------------------------
    // The bootstrap plan comes straight from Rust, so the screen renders real
    // step ids and real blocked/skip reasons for this machine. The sessions are
    // built through the real `BootstrapSession` type on the Rust side and their
    // verification comes from the real verifier fed a synthetic machine state —
    // so the report rendered here is the one the real code would produce.
    build_bootstrap_plan: () => data.bootstrapPlans[mode.profileId] ?? null,
    run_bootstrap: () => {
      mode.bootstrapStarted += 1;
      const byProfile = data.bootstrapSessions[mode.profileId] ?? {};
      return byProfile[mode.bootstrapSession] ?? null;
    },
    cancel_bootstrap: () => true,
    resumable_bootstrap: () => {
      const byProfile = data.bootstrapSessions[mode.profileId] ?? {};
      return byProfile.halted ?? null;
    },
    last_bootstrap: () => {
      const byProfile = data.bootstrapSessions[mode.profileId] ?? {};
      return byProfile[mode.bootstrapSession] ?? null;
    },
    verify_bootstrap: () => {
      const byProfile = data.bootstrapSessions[mode.profileId] ?? {};
      return byProfile[mode.bootstrapSession]?.verification ?? null;
    },
    localization_targets: () => data.localizationTargets ?? [],

    // --- Capability layer (stage 5) -----------------------------------------
    // Real resolve output from this machine, so the dashboard's capability rows
    // and the numbers in their detail panes are genuine. A hand-written fixture
    // here would let the UI render a status the Rust resolver never produces.
    capability_report: () => data.capabilities ?? [],
    profile_capabilities: (a) =>
      data.profileCapabilities?.[a.profileId] ?? { derived: [], unknownDeclared: [] },
    software_catalogue: () => data.machineCatalogue ?? [],
    machine_facts: () => data.environment?.machine ?? null,

    // --- Knowledge, goals and advisor (stage 5) -----------------------------
    // All of these come straight from the real loader and the real resolvers, so
    // the harness renders the knowledge the binary ships with and the plans this
    // machine actually produces. `knowledge_status` in particular reports the
    // real parse warnings, which means a YAML mistake in a checked-in file shows
    // up as a visible notice rather than as a silently unexplained row.
    explained_catalogue: () => data.explained ?? [],
    explain_software: (a) =>
      (data.explained ?? []).find((e) => e.knowledge.id === a.id) ?? null,
    list_goals: () =>
      data.goals ?? { goals: [], goalsWithoutProfiles: [], defaultGoal: "" },
    environment_plan: (a) =>
      (data.goalPlans ?? []).find((p) => p.goalId === a.goalId) ?? null,
    environment_plans: () => data.goalPlans ?? [],
    advisor_summary: () =>
      mode.advisorStale && !mode.detectionRan
        ? {
            ...data.advisor,
            detected: false,
            summary: {
              ...data.advisor.summary,
              score: 0,
              grade: "unknown",
              headline: `共 ${data.advisor.summary.capabilitiesChecked} 项能力，但没有一项检测完成，暂时无法给出评估。`,
            },
          }
        : (data.advisor ?? null),
    advisor_report_text: () => data.advisorText ?? "",
    concept_notes: (a) =>
      a.capabilityId
        ? (data.concepts ?? []).filter((c) =>
            c.relatedCapabilities.includes(a.capabilityId),
          )
        : (data.concepts ?? []),
    knowledge_status: () =>
      data.knowledgeStatus ?? {
        softwareCount: 0,
        conceptCount: 0,
        sourceDir: null,
        warnings: [],
        withoutKnowledge: [],
      },

    // --- Licensing (stage 5) ------------------------------------------------
    // Served from the real `Entitlements::of` projection, so the section is
    // exercised against the same answers the binary produces. `licenseMode`
    // selects which one; the default is the shipping config, which since the
    // commercial revision is `freeEnforced` — the free tier really does refuse
    // to install now.
    license_status: () => data.license[mode.licenseMode] ?? data.license.freeEnforced,
    activate_license: () => {
      mode.licenseMode = "proEnforced";
      return data.license.proEnforced;
    },
    deactivate_license: () => {
      mode.licenseMode = "freeEnforced";
      return data.license.freeEnforced;
    },
    // The device summary the licence screen reads alongside the tier. Derived
    // from the same `mode`, so the badge and the section can never disagree
    // about which machine this is.
    license_device: () => data.licenseDevice[mode.licenseMode] ?? data.licenseDevice.freeEnforced,
  };

  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      const fn = handlers[cmd];
      if (!fn) return undefined;
      return fn(args ?? {});
    },
    transformCallback: (cb) => cb,
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    plugins: {},
  };

  // Test-only hooks so the harness can select which session the next run returns.
  window.__setSessionMode = (name) => {
    mode.session = name;
  };
  window.__installStarted = () => mode.started;
  window.__setBootstrapMode = (name) => {
    mode.bootstrapSession = name;
  };
  window.__bootstrapStarted = () => mode.bootstrapStarted;
  // Selects which licence answer the section reads. Written through to
  // `sessionStorage` for the same reason as `advisorStale` below: this init
  // script re-runs on `page.reload()`, so an in-memory switch would be reset by
  // the very reload used to stage the state.
  window.__setLicenseMode = (name) => {
    mode.licenseMode = name;
    window.sessionStorage.setItem("__licenseMode", name);
  };
  // Lets the harness reproduce the cold-start race from outside: the advisor
  // answers as a pre-detection summary while the capability layer is already
  // fully populated.
  //
  // Written to `sessionStorage` as well as to `mode`, because this init script
  // re-runs on the `page.reload()` that stages the race — an in-memory flag is
  // wiped by that reload, and the switch silently reads back as `false`, which
  // is exactly how this probe managed to pass while the bug was present.
  window.__setAdvisorStale = (on) => {
    mode.advisorStale = on;
    if (on) window.sessionStorage.setItem("__advisorStale", "1");
    else window.sessionStorage.removeItem("__advisorStale");
  };

  // Minimal window API used by TitleBar.
  window.__TAURI_INTERNALS__.invoke = ((original) => async (cmd, args) => {
    if (cmd.startsWith("plugin:window|")) {
      if (cmd === "plugin:window|is_maximized") return maximised;
      if (cmd === "plugin:window|toggle_maximize") {
        maximised = !maximised;
        return null;
      }
      return null;
    }
    return original(cmd, args);
  })(window.__TAURI_INTERNALS__.invoke);
}, fixtures);

await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const shots = [];
const seen = [];
// `NO_SHOT=1` runs every assertion while writing no PNGs.
//
// The text captured here is what the assertions read; the image is only ever a
// human artifact. Keeping the two separable means the suite can be run on a
// request of "verify it, but do not screenshot" without quietly skipping the
// checks that happen to be interleaved with `shot()` calls.
const noShot = process.env.NO_SHOT === "1";
async function shot(name) {
  if (!noShot) {
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
  }
  shots.push(name);
  // Capture the visible text at each step. Asserting only against the *final*
  // DOM would silently miss everything that appeared earlier, which is exactly
  // how a flow like this ends up tested on one screen out of five.
  seen.push({ name, text: await page.locator("body").innerText() });
}

const textAt = (name) => seen.find((s) => s.name === name)?.text ?? "";

/**
 * Reloads the app and lands on the wizard's welcome screen.
 *
 * Since the commercial revision a clean first launch shows the activation gate,
 * and a machine that has answered it lands on the dashboard rather than the
 * wizard. Both are correct product behaviour, so the harness has to walk them
 * instead of assuming the wizard is what a cold load produces.
 *
 * The gate answer is only clicked when the gate is actually on screen — after
 * the first pass the flag is set and the gate does not reappear, so this stays
 * idempotent across the several reloads in this file.
 */
async function bootToWizard() {
  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  // First launch only: answer the gate by declining the paid tier.
  if (await page.locator('[data-testid="gate-heading"]').isVisible().catch(() => false)) {
    await page.locator('[data-testid="gate-free"]').click();
    await page.waitForTimeout(700);
  }

  // A returning customer lands on the dashboard; the wizard is one click away.
  const back = page.getByRole("button", { name: /回到首次设置/ });
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    await page.waitForTimeout(700);
  }
}

// --- 0. Reach the wizard -----------------------------------------------------
// On a clean machine this walks the activation gate (declining the paid tier)
// and then the dashboard's 回到首次设置, which is exactly the path a customer
// takes to the wizard now that the gate exists.
await bootToWizard();

// --- 1. Welcome --------------------------------------------------------------
await shot("01-welcome");

// --- 2. Goal selection -------------------------------------------------------
// New in phase 5, and it comes *before* detection on purpose: measuring first
// and asking second left a student facing results about a machine they had no
// frame for. This screenshot is the evidence that the goal row shows what a
// direction needs before the student commits to it.
await page.locator('[data-testid="welcome-entry"][data-entry="②"]').click();
await page.waitForTimeout(900);
await shot("01b-goal");

// Selecting a goal must resolve it against the machine and show the completion
// before the student proceeds. This is the whole point of asking here.
await page.getByRole("button", { name: /算法与模型研究/ }).first().click();
await page.waitForTimeout(900);
await shot("01c-goal-selected");
const goalPreview = await page.evaluate(() => {
  const text = document.body.innerText;
  const match = text.match(/(\d+)%/);
  return { completion: match ? Number(match[1]) : null, hasNeed: text.includes("需要什么") };
});

// --- 3. Detection (drive the real store action) ------------------------------
await page.getByRole("button", { name: /开始检测/ }).click();
await page.waitForTimeout(2600);
await shot("02-detect");

// --- 4. Software status (the Software Intelligence Layer's screen) ------------
await page.getByRole("button", { name: /^继续|^仍然继续$/ }).click();
await page.waitForTimeout(900);
await shot("03-software");

// Expanding a row must reveal the per-source evidence. This is asserted rather
// than eyeballed because the evidence list is the entire justification for the
// three-provider design — if it does not render, the screen is just a list of
// names with no way to audit a surprising answer.
const firstRow = page.getByRole("button", { name: /VS Code|Git|Python/ }).first();
await firstRow.click();
await page.waitForTimeout(400);
await shot("03b-software-evidence");
const evidenceShown = await page.evaluate(() => {
  const text = document.body.innerText;
  const hasProvider = ["注册表", "PATH", "winget"].filter((p) => text.includes(p));
  return { providers: hasProvider };
});

// --- 4. Profile choice -------------------------------------------------------
await page.getByRole("button", { name: /^继续$/ }).last().click();
await page.waitForTimeout(600);
await shot("04-choose");

// The chosen direction must arrive here already selected, or the goal screen is
// cosmetic — a student would pick a direction and then be asked to pick a
// profile over again with no memory of what they said.
//
// Asserted by reading which row carries `aria-pressed`, not by matching text:
// every profile name is on screen regardless, so a text check would pass even
// when nothing was carried over.
const planCarriedGoal = await page.evaluate(() => {
  const pressed = [...document.querySelectorAll("button[aria-pressed='true']")];
  // `算法与模型研究` maps to the ai_engineer profile, displayed as "AI 开发".
  return pressed.some((b) => /AI 开发/.test(b.textContent ?? ""));
});

await page.getByRole("button", { name: /AI 编程/ }).first().click();
await page.waitForTimeout(700);
await shot("04-choose-selected");

// The profile list's *reachability*, not a "fits without scrolling" guarantee.
//
// This assertion used to require that every row be visible at once, which was
// true when three packages shipped and became false at six — the content is
// 649px against 410px of viewport. Forcing it back would mean deleting packages
// students need, so the constraint is replaced by the one that actually
// protects the student:
//
//   * every row is reachable by scrolling (nothing is clipped or hidden)
//   * the last row can be scrolled fully into view
//   * the scroll container is genuinely scrollable rather than overflowing its
//     own bounds, which is the difference between "scroll for more" and "the
//     last two packages are unreachable"
//
// Driven off the *rendered* rows rather than a hard-coded name list: that list
// silently went stale the moment two packages were added.
const chooserReach = await page.evaluate(() => {
  const scroller = document.querySelector("main div.overflow-y-auto");
  if (!scroller) return { ok: lastVisible, reason: "no scroller" };
  const rows = [...scroller.querySelectorAll("button")];
  if (rows.length < 3) return { ok: lastVisible, reason: `only ${rows.length} rows` };

  // Scroll to the end and re-measure: this is what proves the final row is
  // actually reachable rather than merely present in the DOM.
  const restore = scroller.scrollTop;
  scroller.scrollTop = scroller.scrollHeight;
  const box = scroller.getBoundingClientRect();
  const last = rows[rows.length - 1].getBoundingClientRect();
  const lastVisible = last.bottom <= box.bottom + 1 && last.top >= box.top - 1;

  const result = {
    ok: lastVisible,
    count: rows.length,
    scrollable: scroller.scrollHeight > scroller.clientHeight,
    lastRowBottom: Math.round(last.bottom),
    containerBottom: Math.round(box.bottom),
  };

  // Put it back, so the screenshot that follows shows the list as a student
  // first sees it rather than scrolled to the bottom.
  scroller.scrollTop = restore;
  return result;
});

// --- 5. Install (real execution flow) ----------------------------------------
await page.getByRole("button", { name: /下一步/ }).click();
await page.waitForTimeout(1200);
await shot("05-install-choose");

// Phase 7: the screen opens on a decision, not on a running engine. Asserted
// here rather than further down because "did it start by itself" is the one
// behaviour this phase removed, and a screenshot taken after the click could
// not tell the two designs apart.
const startedBeforeCommit =
  (await page.evaluate(() => window.__installStarted())) === 0;

// Structure of the choose phase on whatever plan the flow reached.
//
// This profile has only one program left to install on this machine, so the
// *mechanism* ("unchecking changes the run") is verified on a profile that
// really offers a choice — see section 5d below. What is asserted here is the
// part that must hold on any machine: the work is listed and selectable before
// anything runs.
const chooseReport = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll("input[type=checkbox]")];
  return { boxes: boxes.length };
});

await page.getByRole("button", { name: /开始安装/ }).click();
await page.waitForTimeout(1600);
await shot("05-install");

// The install screen starts the engine on the student's click. Assert it started
// exactly once: React's double-invoke in development would otherwise launch two
// runs, which for an installer means two winget processes over one package.
const startedOnce = (await page.evaluate(() => window.__installStarted())) === 1;

// Advanced mode: the raw action trace.
await page.getByRole("button", { name: /高级模式/ }).click();
await page.waitForTimeout(400);
await shot("06-install-advanced");

// --- 5b. A failed run must say so, and offer to continue ----------------------
// Driven against "AI 开发" because it is the profile with programs this machine
// does not have. On the "AI 编程" profile every step is already satisfied, so a
// failure branch would have nothing to fail — and asserting "failed" against a
// run that legitimately had no work would be testing the fixture, not the UI.
await page.evaluate(() => window.__setSessionMode("partial"));
await page.getByRole("button", { name: /返回/ }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: /AI 开发/ }).first().click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /下一步/ }).click();
await page.waitForTimeout(1200);
// Phase 7: the run is committed by this screen's own button now, not by the
// navigation that reached it.
await page.getByRole("button", { name: /开始安装/ }).click();
await page.waitForTimeout(1600);
await shot("06b-install-failed");

// --- 5c. A permission halt must explain itself and keep the rest resumable ----
await page.evaluate(() => window.__setSessionMode("halted"));
await page.getByRole("button", { name: /返回/ }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: /下一步/ }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /开始安装/ }).click();
await page.waitForTimeout(1600);
await shot("06c-install-halted");

// --- 5d. Selective install: declining a program changes what runs ------------
//
// Driven on "程序员版" because it is the profile with **two** programs this
// machine still needs. The first attempt at this probe used "AI 编程" and failed
// — not because the feature was broken, but because that profile has exactly one
// program left to install here, so there was no second checkbox to uncheck. The
// check would have been asserting a property of this machine rather than of the
// product, which is the failure mode the harness's own comments warn about.
//
// What is verified is the mechanism end to end: the count the button promises
// moves when a program is declined, and the narrowed selection is what the engine
// is actually handed.
await bootToWizard();
await page.locator('[data-testid="welcome-entry"][data-entry="②"]').click();
await page.waitForTimeout(700);
await page.getByRole("button", { name: /开始检测/ }).click();
await page.waitForTimeout(2600);
await page.getByRole("button", { name: /^继续|^仍然继续$/ }).click();
await page.waitForTimeout(900);
await page.getByRole("button", { name: /^继续$/ }).last().click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /^程序员版/ }).first().click();
await page.waitForTimeout(700);
await page.getByRole("button", { name: /下一步/ }).click();
await page.waitForTimeout(1200);
await shot("06d-install-choose-multi");

const selective = await page.evaluate(() => {
  const countOf = () => {
    const m = document.body.innerText.match(/已选 (\d+) 项/);
    return m ? Number(m[1]) : null;
  };
  const boxes = [...document.querySelectorAll("input[type=checkbox]")];
  const before = countOf();
  const buttonBefore = [...document.querySelectorAll("button")]
    .map((b) => b.innerText)
    .find((t) => /安装/.test(t));
  if (boxes.length >= 2) boxes[1].click();
  return { boxes: boxes.length, before, buttonBefore };
});
await page.waitForTimeout(400);
const selectiveAfter = await page.evaluate(() => {
  const m = document.body.innerText.match(/已选 (\d+) 项/);
  const button = [...document.querySelectorAll("button")]
    .map((b) => b.innerText)
    .find((t) => /安装/.test(t));
  return { after: m ? Number(m[1]) : null, button };
});
await shot("06e-install-unchecked");

// Commit the narrowed run so the screen is left in a normal, non-error state for
// the sections that follow (which expect an install screen they can go 返回 from).
await page.getByRole("button", { name: /安装选中的|开始安装/ }).first().click();
await page.waitForTimeout(1600);

// Back to the successful session, on the profile the report screens use.
await page.evaluate(() => window.__setSessionMode("completed"));
await page.getByRole("button", { name: /返回/ }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: /AI 编程/ }).first().click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /下一步/ }).click();
await page.waitForTimeout(1200);
// "AI 编程" has every step already satisfied on this machine, so there is no run
// to commit — the screen offers 下一步 instead, which is the empty case the
// choose phase has to handle without showing a dead button.
const installWasEmpty = await page.evaluate(() =>
  document.body.innerText.includes("这次没有需要安装的"),
);
if (installWasEmpty) {
  await page.getByRole("button", { name: /^下一步$/ }).click();
} else {
  await page.getByRole("button", { name: /开始安装/ }).click();
}
await page.waitForTimeout(1600);

// --- 6. Bootstrap (the Bootstrap Layer's screen) -----------------------------

/**
 * Walks the whole flow from a fresh load to a rendered bootstrap screen.
 *
 * Reloading rather than clicking 返回 repeatedly, for two reasons: the footer's
 * buttons depend on which phase the previous run reached (a finished install
 * offers 返回 where a pending one offers 下一步), and re-walking is closer to what
 * a student does after reading a failure — they start from the decision again.
 *
 * `setMode` runs *after* the reload and *before* the bootstrap screen mounts.
 * That ordering is load-bearing: the init script that installs the mock backend
 * re-runs on every navigation, so a mode set before a reload is silently reset,
 * and the branch would render the default success case.
 */
async function walkToBootstrap(profileName, setMode) {
  await bootToWizard();
  await page.locator('[data-testid="welcome-entry"][data-entry="②"]').click();
  // The goal screen sits between the welcome screen and detection. Skipped
  // through with the default direction, since this helper is about reaching the
  // bootstrap branches rather than about the goal choice.
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /开始检测/ }).click();
  await page.waitForTimeout(2600);
  await page.getByRole("button", { name: /^继续|^仍然继续$/ }).click();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /^继续$/ }).last().click();
  await page.waitForTimeout(600);
  // The name is matched *literally*, not as a pattern. Passing it to `RegExp`
  // unescaped meant a profile called "AI 开发版 + 桌面应用" was parsed as a
  // quantifier and matched nothing — the harness then hung for 30s on a row that
  // was on screen the whole time.
  const exact = new RegExp(`^${profileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  await page.getByRole("button", { name: exact }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.waitForTimeout(1200);
  // Phase 7 moved the engine start from the install screen's mount to its own
  // commit button, so reaching bootstrap means passing through it.
  await page.getByRole("button", { name: /开始安装|^下一步$/ }).first().click();
  await page.waitForTimeout(1600);
  // Set the branch immediately before entering the bootstrap screen, which is
  // the moment its `run_bootstrap` call happens.
  if (setMode) await page.evaluate(setMode);
  await page.getByRole("button", { name: /继续配置环境/ }).click();
  await page.waitForTimeout(1600);
}

await walkToBootstrap("AI 编程");
await shot("07-bootstrap");

// The screen starts the configuration engine on mount. Asserted for the same
// reason the install run is: two concurrent runs would race over the same
// `settings.json`, and the second write would undo the first's merge.
const bootstrapStartedOnce =
  (await page.evaluate(() => window.__bootstrapStarted())) === 1;

// Every stage must be listed, including the ones the profile asks nothing of.
// A stage that vanishes is how a student concludes the app forgot their profile.
const bootstrapStages = await page.evaluate(() => {
  const text = document.body.innerText;
  return ["VS Code 环境", "Git 配置", "MCP 配置", "Skills", "语言设置"].filter(
    (s) => text.includes(s),
  );
});

// Expanding a stage must reveal its individual steps — the plan is what the
// student would check if a stage came back red.
await page.getByRole("button", { name: /VS Code 环境/ }).first().click();
await page.waitForTimeout(400);
await shot("07b-bootstrap-expanded");

// Detailed mode: the verification results, the localisation sources, and the
// explicit list of what was deliberately not done.
await page.getByRole("button", { name: /详细信息/ }).click();
await page.waitForTimeout(400);
await shot("07c-bootstrap-detail-verification");

// --- 6b. The partial-failure branch ------------------------------------------
// Driven on "AI 开发" because it is the profile with work this machine still
// does not have. Asserting a failure against a run that legitimately had nothing
// to do would be testing the fixture rather than the screen.
//
// `walkToBootstrap` reloads the page, so the mode must be set *after* the load:
// the init script below is re-run on every navigation, which resets `mode` to its
// defaults. Setting it before the reload silently produced the success branch
// twice — the two screenshots were byte-identical, which is how the mistake was
// caught.
await walkToBootstrap("AI 开发版 + 桌面应用", () => window.__setBootstrapMode("partial"));
await shot("07d-bootstrap-failed");

// --- 6c. The permission-halt branch ------------------------------------------
await walkToBootstrap("AI 开发版 + 桌面应用", () => window.__setBootstrapMode("halted"));
await shot("07e-bootstrap-halted");

// Back to the successful branch, on the profile the report screens use.
await walkToBootstrap("AI 编程");

// --- 7. Done / report --------------------------------------------------------
await page.getByRole("button", { name: /查看结果/ }).click();
await page.waitForTimeout(1400);
await shot("08-done");

await page.getByRole("button", { name: /查看完整报告/ }).click();
await page.waitForTimeout(400);
await shot("09-report");

// --- 8. Dashboard (stage 5) --------------------------------------------------
//
// Driven from a fresh page load so the dashboard is exercised on its *own*
// entry path rather than as a state left behind by the wizard. That is the path
// a returning student takes, and it is the one the capabilities have to load
// correctly from cold.
//
// Since the gate exists, a cold load on a machine that has answered it lands on
// the dashboard *directly* — which is the improvement, and is what this block
// now verifies. `bootToWizard` still walks the gate on the very first call, so
// on this later call the flag is set and the load resolves straight to the
// dashboard; the 回到首次设置 click below puts us back on the welcome screen so
// the rest of this block keeps exercising its original entry route.
await bootToWizard();
await page.locator('[data-testid="welcome-entry"][data-entry="①"]').click();
await page.waitForTimeout(2600);
await shot("10-dashboard-overview");

// The status centre (brief phase 6). Asserted on its four required parts
// separately, because each answers a different part of the brief and three of
// them could be present while the fourth silently regressed:
//
//   greeting   — "晚上好" rather than a bare report
//   score      — the one number, scoped to the whole machine
//   have/lack  — 已准备 beside the gap list, which is what makes a score actionable
//   next step  — 建议的下一步, already required by the phase-5 assertions
//
// The greeting is matched as one of the five buckets rather than by equality, so
// the assertion does not depend on what time the harness happens to run.
//
// ## Why the "have/lack" check counts groups instead of demanding 还差
//
// This machine has 8 capabilities fully available and 3 partial — **zero**
// unavailable. An earlier version of this probe required both 已准备 and 还差 to
// be on screen and failed, which was the probe asserting a property of this
// machine rather than of the product: 还差 correctly renders nothing when nothing
// is outright missing.
//
// What must hold on *any* machine is the pairing itself — that what is ready is
// shown alongside what is not, rather than a bare gap list. So the probe counts
// how many of the three group labels are present and requires at least two, which
// is satisfied here by 已准备 + 缺一部分 and would be satisfied on a weaker machine
// by 已准备 + 还差.
const statusCentre = await page.evaluate(() => {
  const text = document.body.innerText;
  const groups = ["已准备", "缺一部分", "还差", "无法确认"].filter((l) =>
    text.includes(l),
  );
  // The specific contradiction this guard exists for.
  //
  // The advisor summary is a view over the detection report. When it was fetched
  // once on mount, a cold start computed it *before* detection landed and then
  // never recomputed it, so the headline read "共 11 项能力，但没有一项检测完成"
  // directly above capability lists that had just been read from the finished
  // report. `advisor?.summary.score ?? environment.score` did not save it: the
  // stale advisor reports a *defined* 0, and `??` only falls through on
  // null/undefined.
  //
  // Stated as an invariant rather than as a number, because the number is a
  // property of the machine and the contradiction is a property of the code:
  // "nothing was detected" and "here is what is ready" cannot both be true.
  const claimsNotDetected = text.includes("没有一项检测完成") || text.includes("尚未检测");
  const listsReady = /已准备[\s\S]{0,240}?[^\s]/.test(text) && groups.includes("已准备");
  return {
    greeting: /早上好|中午好|下午好|晚上好|夜深了/.test(text),
    score: /你的开发环境/.test(text) && /\d{1,3}\s*%/.test(text),
    groups,
    nextStep: text.includes("建议的下一步"),
    contradiction: claimsNotDetected && listsReady,
  };
});

// --- The cold-start race, reproduced on purpose ------------------------------
//
// The invariant above is only worth asserting if it can fail. On the real
// fixture the advisor is always `detected: true`, so the contradiction branch is
// unreachable and the assertion would pass even with the bug present — a test
// that cannot fail is worse than no test, because it certifies a lie.
//
// So the race is staged explicitly: `advisor_summary` is made to answer as it
// does *before* detection lands (score 0, "没有一项检测完成") while the capability
// layer keeps returning the real, fully-populated report. That is precisely the
// state the shipped build entered. The guard added to the dashboard
// (`advisor?.detected ? … : null`) is what must keep the headline off the screen.
await page.evaluate(() => window.__setAdvisorStale(true));
// `bootToWizard` rather than a bare reload: after the gate, a cold load lands on
// the dashboard, so the welcome screen this block clicks through has to be
// reached the same way as everywhere else in this file. The stale advisor mode
// is read live, so it survives the navigation.
await bootToWizard();
await page.locator('[data-testid="welcome-entry"][data-entry="①"]').click();
await page.waitForTimeout(2600);

const staleRace = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    saysNotDetected:
      text.includes("没有一项检测完成") || text.includes("尚未检测"),
    listsReady: text.includes("已准备"),
    shownScore: (text.match(/整体评分\s*(\d+)\s*\/\s*100/) ?? [])[1] ?? null,
    zeroPercent: /你的开发环境\s*0\s*%/.test(text),
  };
});
await page.evaluate(() => window.__setAdvisorStale(false));
// Same reason as above: reload without the gate walk lands on the dashboard, so
// the welcome screen this clicks through has to be reached via `bootToWizard`.
await bootToWizard();
await page.locator('[data-testid="welcome-entry"][data-entry="①"]').click();
await page.waitForTimeout(2600);

// Selecting a capability must populate the right-hand explanation pane. The
// pane is the entire answer to "it only shows status", so its content is
// asserted rather than its existence.
const capabilityRow = page
  .locator("button")
  .filter({ hasText: /Python 开发|AI Agent 开发|Git 协作|Node\.js 开发/ })
  .first();
await capabilityRow.click();
await page.waitForTimeout(500);
await shot("10b-dashboard-capability-detail");

await page.getByRole("button", { name: /^软件\s*\d*$/ }).click();
await page.waitForTimeout(700);
await shot("11-dashboard-software");

// Captured here rather than at the end of the run: the icon probe must run while
// the software rows are the mounted screen. Sampling it later (after the theme
// sweep, which leaves the page on the licence section) found zero `<img>`
// elements and reported "no bundled icon found" — a `false` failure about the
// probe's timing, not about the product.
const iconReport = await collectIconReport();

/**
 * Reads `SoftwareIcon.tsx`'s own exports from the running dev server, so the
 * mark/exempt coverage assertion below compares the *real* lists rather than a
 * copy this file would drift away from.
 *
 * Loaded through Vite (`/src/...`), which compiles the TSX on demand — the same
 * transform the app uses, so what is asserted is what ships. `ALL_IDS` comes
 * from the Rust-side list via `lib/types`; it is read here so the assertion can
 * report "in neither list" for an id that was added to the product but wired to
 * no icon at all.
 */
const iconExports = await page.evaluate(async () => {
  const mod = await import("/src/components/SoftwareIcon.tsx");
  // `SoftwareId` is a type-level union with no runtime value, so the id list is
  // taken from the Rust catalog's mirrored key list in `lib/types.ts` when it
  // exists, and otherwise reconstructed from the two icon lists themselves.
  let allIds = [];
  try {
    const types = await import("/src/lib/types.ts");
    allIds = types.SOFTWARE_IDS ?? [];
  } catch {
    allIds = [];
  }
  return {
    ICON_IDS: mod.ICON_IDS ?? [],
    NO_BRAND_ASSET: mod.NO_BRAND_ASSET ?? [],
    ALL_IDS: allIds,
  };
});

// --- 8a. The software grid (brief phase 3) and its category tabs (phase 4) ----
//
// Asserted on *structure*, not on appearance: the count of cards, whether the
// cards carry the four things the brief asks for, and whether selecting a
// category actually changes what is rendered. "It looks like a grid" is not
// something a DOM probe can answer, and pretending otherwise would be a check
// that passes on a broken layout.
const gridReport = await page.evaluate(() => {
  // The rows live inside the list container the section marks with
  // `data-software-list`. Selecting a row mounts the explanation beside it, so
  // the contract this probes is master-detail rather than "a grid with N
  // columns": a list you scan down, and a pane that answers what you landed on.
  //
  // Matching on the container rather than on "every button that has an icon and
  // a tier word" also stops the probe from silently counting unrelated buttons
  // on the same screen, which is how the previous selector could pass while the
  // list it meant to measure was gone.
  const list = document.querySelector("[data-software-list]");
  const rows = list
    ? [...list.querySelectorAll("[data-software-row]")]
    : [];

  const container = list ?? null;
  // One column is the *intended* shape for the list half of a master-detail
  // split, so the old `columns >= 2` check is inverted into the thing that can
  // actually go wrong here: the list must be a real vertical stack, not a
  // single horizontal strip that clips every row to one line.
  const rowHeights = rows.slice(0, 5).map((r) => r.getBoundingClientRect().height);
  const stackedVertically =
    rows.length >= 2 &&
    rows[0].getBoundingClientRect().top < rows[1].getBoundingClientRect().top;
  const rowsHaveHeight = rowHeights.length > 0 && rowHeights.every((h) => h >= 20);

  const sample = rows[0]?.innerText ?? "";
  return {
    count: rows.length,
    stackedVertically,
    rowsHaveHeight,
    // The three required contents, sampled on the first row.
    hasStatus: /已安装|未安装|无法确认|需自行安装|已就绪|尚不可用|部分就绪/.test(sample),
    hasRecommendation: /必备|推荐|可选|仅检测/.test(sample),
    // The row's secondary line is the version when the program is present; the
    // purpose sentence deliberately moved to the detail pane, so "at least two
    // lines" is what replaces the old three-line check.
    hasDetail: sample.split("\n").filter((l) => l.trim()).length >= 2,
    containerExists: Boolean(container),
  };
});

// The tabs: every category the catalog can produce, plus 全部.
const tabsReport = await page.evaluate(() => {
  const tablist = document.querySelector("[role=tablist]");
  if (!tablist) return { tabs: [], labels: [] };
  const tabs = [...tablist.querySelectorAll("[role=tab]")];
  return {
    tabs: tabs.length,
    labels: tabs.map((t) => t.innerText.replace(/\s+/g, " ").trim()),
  };
});
await shot("11-tabs");

// Switching category must change the set of rows, not merely the selected tab.
// Without this the "filter" is a highlight and the list never narrows.
const beforeFilter = gridReport.count;
let afterFilter = beforeFilter;
const secondTab = page.locator("[role=tab]").nth(1);
if (await secondTab.count()) {
  await secondTab.click();
  await page.waitForTimeout(500);
  // Counted through the same container the report above uses, so the two numbers
  // are measurements of the same thing. The previous global "any button with an
  // icon and a tier word" selector could disagree with the list under test.
  afterFilter = await page.evaluate(
    () => document.querySelectorAll("[data-software-list] [data-software-row]").length,
  );
  await shot("11b-software-filtered");
  // Back to 全部 for the screenshots and the detail-pane check below.
  await page.locator("[role=tab]").first().click();
  await page.waitForTimeout(500);
}

// --- 8b. Accessibility of the new components (brief phase 10) ----------------
//
// The brief lists 无障碍 as a verification target. What is checked is the part
// that can be measured objectively and the part most likely to regress when a
// component is redrawn:
//
//   * every interactive element is reachable by keyboard and has an accessible
//     name — a card grid full of icon-only buttons is the classic failure here
//   * the status pills do not announce their state twice, which is what happens
//     when a glyph's own `aria-label` is left on beside the word
//   * the tab strip exposes selection state to assistive tech, not only visually
const a11yReport = await page.evaluate(() => {
  const named = (el) =>
    (el.getAttribute("aria-label") ||
      el.innerText ||
      el.textContent ||
      "").trim().length > 0;

  const buttons = [...document.querySelectorAll("button")];
  const unnamed = buttons.filter((b) => !named(b)).length;

  // Focusability: an element that is `tabindex="-1"` or `disabled` cannot be
  // reached, and a grid of cards that skips every item would pass a DOM-presence
  // check while being unusable without a mouse.
  const focusable = buttons.filter((b) => !b.disabled && b.tabIndex >= 0).length;

  // Double announcement: a status pill must carry the state exactly once as
  // text. Counting the glyph's label and the word together is how
  // "通过 已安装" reaches a screen reader.
  const pills = [...document.querySelectorAll("span[title]")].filter((s) =>
    /已确认存在|已检查|没能检查|只检测/.test(s.getAttribute("title") || ""),
  );
  const doubled = pills.filter((p) => {
    const labels = p.querySelectorAll("[aria-label]");
    return labels.length > 0;
  }).length;

  const tablist = document.querySelector("[role=tablist]");
  const tabs = tablist ? [...tablist.querySelectorAll("[role=tab]")] : [];
  const tabsWithState = tabs.filter(
    (t) => t.hasAttribute("aria-selected"),
  ).length;

  return {
    buttonCount: buttons.length,
    unnamed,
    focusable,
    pills: pills.length,
    doubled,
    tabs: tabs.length,
    tabsWithState,
  };
});

// Selecting a program shows its purpose, its install state, and the per-source
// evidence — the same audit trail the wizard's software screen renders, now
// available without walking a flow.
const softwareRow = page
  .locator("button")
  .filter({ hasText: /VS Code|Git|Python|Node\.js/ })
  .first();
await softwareRow.click();
await page.waitForTimeout(400);
await shot("11b-dashboard-software-detail");

// The knowledge-backed detail pane is asserted on its *content*, not on its
// existence: the failure this guards against is a pane that renders the
// headings with nothing under them, which looks fine in a screenshot and is
// useless to a student.
const softwareDetail = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    hasWhy: text.includes("为什么需要"),
    hasExplanation: text.includes("说明"),
    // The audit trail must survive the knowledge layer being added — it is the
    // only way a surprising answer is answerable.
    hasEvidence: text.includes("检测来源"),
  };
});

await page.getByRole("button", { name: /^配置\s*\d*$/ }).click();
await page.waitForTimeout(500);
await shot("12-dashboard-config");

await page.getByRole("button", { name: /^历史记录\s*\d*$/ }).click();
await page.waitForTimeout(500);
await shot("13-dashboard-history");

// --- 8b. Licence section -----------------------------------------------------
// Driven in the *shipping* state, which since the commercial revision is
// enforced-free: installation is locked until a key is entered. Asserting this
// state rather than a permissive one is the point — a licence screen is most
// likely to mislead precisely when something is locked.
// The sidebar item reads 版本与授权. The regex accepts both that and the older
// bare 版本 so this assertion tracks the "which section holds the licence"
// question rather than the exact label — the label changed to match what the
// gate already promised the customer, and a hard-coded `^版本$` turned that
// rename into a test failure instead of a UI fact.
await page.getByRole("button", { name: /^版本(与授权)?\s*\d*$/ }).click();
await page.waitForTimeout(600);
await shot("13b-dashboard-license-free");

// Activating must move the screen to the activated state without a reload.
// The button reads 激活 PRO rather than a bare 激活, which is the gate's
// requirement that the primary action name what it grants; the regex accepts
// either so the assertion survives the wording without silently skipping.
await page.getByLabel("激活码").fill("SC-ABCDE-23456-FGHJK-3SKWP");
await page.getByRole("button", { name: /^激活( PRO)?$/ }).click();
await page.waitForTimeout(700);
await shot("13c-dashboard-license-activated");

// Captured here, while the activated licence screen is mounted, because the
// brief's "用户不可查看/复制" is a claim about *controls that do not exist*.
//
// An earlier version of this assertion searched the screen's text for
// "复制"/"导出" and was defeated by the screen's own honest disclosure that the
// activation cannot be exported — it was testing prose rather than the UI, and
// a real copy button would have been caught only by accident. This probe looks
// for capability: clickable affordances, and any input holding a value.
const licenseSurface = await page.evaluate(() => {
  const forbidden = /复制|导出|查看激活|显示激活|激活码.*(复制|导出)/;
  const controls = [...document.querySelectorAll("button, a, [role=button]")];
  return {
    offendingControls: controls
      .map((n) => (n.getAttribute("aria-label") || n.textContent || "").trim())
      .filter((label) => label && forbidden.test(label)),
    // A revealed key would have to live in an input's value.
    preFilledInputs: [...document.querySelectorAll("input")]
      .map((i) => i.value)
      .filter((v) => v.trim().length > 0),
  };
});

// Deactivating returns to the default, and must say so.
await page.getByRole("button", { name: /取消激活/ }).click();
await page.waitForTimeout(700);
await shot("13d-dashboard-license-deactivated");

// The third state: a valid code bound to different hardware. Staged by asking
// the mock for the mismatch entitlement, which is what a copied `license.dat`
// produces. Without this the screen could render a mismatch as "never
// activated" and every assertion above would still pass.
//
// The reload is needed for the *store*, not the mock: `license_status` reads
// `mode.licenseMode` live, but the section only fetches entitlements once per
// mount (`phase === "idle"`), so an already-loaded page would keep showing the
// previous tier. `bootToWizard` performs that reload and then walks back to the
// welcome screen, which is why the same two clicks as the advisor-race block
// above are repeated here.
await page.evaluate(() => window.__setLicenseMode("freeMismatch"));
await bootToWizard();
await page.locator('[data-testid="welcome-entry"][data-entry="①"]').click();
await page.waitForTimeout(2600);
// The sidebar item reads 版本与授权. The regex accepts both that and the older
// bare 版本 so this assertion tracks the "which section holds the licence"
// question rather than the exact label — the label changed to match what the
// gate already promised the customer, and a hard-coded `^版本$` turned that
// rename into a test failure instead of a UI fact.
await page.getByRole("button", { name: /^版本(与授权)?\s*\d*$/ }).click();
await page.waitForTimeout(700);
await shot("13e-dashboard-license-mismatch");

// --- 9. Theme ----------------------------------------------------------------
// Both themes are asserted because only one of them can be the default, and the
// previous build had no light theme at all. Reading the computed background is
// the only way to prove the tokens actually flipped rather than the attribute
// being set on an unchanged surface.
const darkBg = await page.evaluate(
  () => getComputedStyle(document.body).backgroundColor,
);

await page.getByRole("button", { name: /^浅色$/ }).click();
await page.waitForTimeout(600);
await shot("14-dashboard-light");
const lightBg = await page.evaluate(
  () => getComputedStyle(document.body).backgroundColor,
);
const lightThemeOk = lightBg !== darkBg && isLight(lightBg);

// The software list is captured in the light theme specifically because that is
// where a stencil mark is most likely to disappear: Cursor, Windsurf, LM Studio,
// OpenCode and Continue are drawn in the *text* colour, which is near-black on
// paper and near-white on ink. Only one of those two can be the default, so a
// dark-only screenshot cannot prove both work.
await page.getByRole("button", { name: /^软件\s*\d*$/ }).click();
await page.waitForTimeout(700);
await shot("14b-software-light");
const lightIconContrast = await collectIconContrastReport();

await page.getByRole("button", { name: /^深色$/ }).click();
await page.waitForTimeout(600);
await shot("15-dashboard-dark");
const restoredBg = await page.evaluate(
  () => getComputedStyle(document.body).backgroundColor,
);
const darkThemeOk = !isLight(restoredBg);
const darkIconContrast = await collectIconContrastReport();
await shot("15b-software-dark");

// --- 9b. Branding / icons / window chrome -------------------------------------
//
// These three probes feed the branding assertions. They are gathered here, after
// the flow has been walked, so `page` is on a content screen with the title bar
// and the software rows present.

/** How many times the product name appears in the rendered title bar. */
const titlebarText = await page.evaluate(() => {
  const bar = document.querySelector(".titlebar-drag");
  return bar ? bar.textContent ?? "" : "";
});
function titlebarOccurrences() {
  return titlebarText.split("Setup Center").length - 1;
}

/**
 * Proves the icons are real, loaded assets rather than DOM nodes that 404'd.
 *
 * A broken `<img>` still exists in the DOM and still has a `src`, so presence
 * checks are worthless here. `naturalWidth` is 0 for a failed load and the
 * intrinsic size for a success — the only reliable discriminator.
 *
 * ## Why the selector accepts three forms
 *
 * Vite inlines any asset under 4 kB as a `data:` URI, so most of these marks are
 * NOT at an `/assets/` path in the built bundle — only the ones over the
 * threshold (`rust.svg`, the two PNGs) get a hashed filename. A selector that
 * matched only `/assets/` would have silently checked 4 of 16 icons and reported
 * success. All three forms are therefore in scope: hashed paths, `data:` URIs,
 * and `asset:` URLs (the Tauri protocol form used in dev).
 */
/**
 * Proves the icons are real, loaded assets rather than DOM nodes that 404'd.
 *
 * A broken `<img>` still exists in the DOM and still has a `src`, so presence
 * checks are worthless here. `naturalWidth` is 0 for a failed load and the
 * intrinsic size for a success — the only reliable discriminator.
 *
 * ## Why the selector accepts three forms
 *
 * Vite inlines any asset under 4 kB as a `data:` URI, so most of these marks are
 * NOT at an `/assets/` path in the built bundle — only the ones over the
 * threshold (`rust.svg`, the two PNGs) get a hashed filename. A selector that
 * matched only `/assets/` would have silently checked 4 of 17 icons and reported
 * success. All three forms are therefore in scope: hashed paths, `data:` URIs,
 * and `asset:` URLs (the Tauri protocol form used in dev).
 *
 * ## Why masked marks are counted separately
 *
 * Four vendors ship a pure-black `currentColor` glyph, which cannot work through
 * `<img>` (no cascade in an isolated document) and is drawn with a CSS mask
 * instead. Those have no intrinsic image size to read, so they are verified by
 * the mask property being present and non-empty — the correct check for that
 * rendering path, not a weaker one.
 */
async function collectIconReport() {
  const selector =
    'img[src^="data:image"], img[src*="/assets/"], img[src^="asset:"], img[src*="asset.localhost"]';
  return await page.evaluate(async (sel) => {
    const imgs = [...document.querySelectorAll(sel)];
    const masked = [...document.querySelectorAll('[style*="mask-image"]')];

    if (imgs.length === 0 && masked.length === 0) {
      return { ok: false, detail: "no bundled icon element found on the software rows" };
    }

    await Promise.all(
      imgs.map((el) =>
        el.complete
          ? Promise.resolve()
          : new Promise((res) => {
              el.addEventListener("load", res, { once: true });
              el.addEventListener("error", res, { once: true });
            }),
      ),
    );
    const broken = imgs.filter((el) => el.naturalWidth === 0);
    const sizes = [...new Set(imgs.map((el) => `${el.naturalWidth}x${el.naturalHeight}`))];
    const total = imgs.length + masked.length;
    return {
      ok: broken.length === 0,
      detail:
        broken.length === 0
          ? `${total} marks loaded (${imgs.length} img + ${masked.length} masked), intrinsic sizes: ${sizes.join(", ")}`
          : `${broken.length}/${total} failed: ${broken
              .map((el) => el.getAttribute("src")?.slice(0, 40))
              .slice(0, 4)
              .join(", ")}`,
    };
  }, selector);
}

/**
 * Proves every rendered mark actually has visible contrast against its surface.
 *
 * ## Why this probe exists
 *
 * `collectIconReport` proves the assets *load*. It cannot prove they are
 * *visible*, and those are different failures. Three real cases in this codebase
 * loaded perfectly and were invisible:
 *
 * - Rust, Java and JetBrains ship `fill="#000000"`, drawn on a `#0c0e11` surface.
 * - ChatGPT declares no `fill` at all and inherits black the same way.
 * - Continue ships `fill="white"` — legible on dark, invisible on paper.
 *
 * A masked mark renders through `background-color` and an `<img>` through its own
 * pixels, so the colour has to be read from whichever path applies. Chromium is
 * asked for the computed `background-color` of masked marks; for `<img>` the
 * pixels are sampled from a canvas.
 *
 * The threshold is deliberately loose (per-channel delta > 24 against the plate
 * behind the row). It is not a perceptual contrast model — it only needs to
 * separate "this is a real mark" from "this is the same colour as its surface".
 */
async function collectIconContrastReport() {
  return await page.evaluate(async () => {
    // Resolve the surface an icon actually sits on by walking up from the mark
    // and compositing every layer over the page canvas.
    //
    // The naive version of this probe read `document.querySelector("main")`
    // and got `rgba(0, 0, 0, 0)` — so it compared every icon against *black in
    // both themes*, and passed the light-theme case by luck. The rows use
    // `--surface-raised` at 40% over the page background, so the true plate is a
    // composite, not a single computed colour.
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(",").map((n) => parseFloat(n));
      return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
    };

    /** Composite `top` (with alpha) over `bottom` (opaque). */
    const over = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1,
    });

    const canvasRgb = parse(getComputedStyle(document.documentElement).backgroundColor) ??
      parse(getComputedStyle(document.body).backgroundColor);
    const pageRgb = canvasRgb && canvasRgb.a > 0
      ? canvasRgb
      : { r: 255, g: 255, b: 255, a: 1 };

    /** Walk ancestors, collecting opaque-ish background layers, then composite. */
    const plateBehind = (el) => {
      const layers = [];
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.01) {
          layers.push(c);
          if (c.a === 1) break;
        }
      }
      let acc = pageRgb;
      for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
      return acc;
    };

    const delta = (a, b) =>
      Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));

    const items = [];
    const masked = [...document.querySelectorAll('[style*="mask-image"]')];
    for (const el of masked) {
      const c = parse(getComputedStyle(el).backgroundColor);
      if (c) items.push({ kind: "mask", c, plate: plateBehind(el.parentElement ?? el) });
    }

    const imgs = [...document.querySelectorAll(
      'img[src^="data:image"], img[src*="/assets/"], img[src^="asset:"], img[src*="asset.localhost"]',
    )];
    for (const el of imgs) {
      if (!el.complete || el.naturalWidth === 0) continue;
      try {
        const cv = document.createElement("canvas");
        cv.width = el.naturalWidth;
        cv.height = el.naturalHeight;
        const ctx = cv.getContext("2d");
        ctx.drawImage(el, 0, 0);
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        // Average only the pixels that are actually painted. An SVG logo is
        // mostly transparent margin, and averaging that in would wash the mark
        // out toward the plate and hide the very failure being tested for.
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 40) continue;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
        const plate = plateBehind(el.parentElement ?? el);
        if (n === 0) {
          items.push({ kind: "img", c: { r: 0, g: 0, b: 0 }, plate, empty: true });
          continue;
        }
        items.push({ kind: "img", c: { r: r / n, g: g / n, b: b / n }, plate });
      } catch {
        // A tainted canvas cannot happen for bundled assets, but a read failure
        // must not be reported as a contrast failure.
      }
    }

    if (items.length === 0) {
      return { ok: false, detail: "no rendered marks to measure" };
    }

    const empty = items.filter((i) => i.empty).length;
    const invisible = items.filter((i) => delta(i.c, i.plate) <= 24);
    const deltas = items
      .map((i) => Math.round(delta(i.c, i.plate)))
      .sort((a, b) => a - b);

    // Report the plate too: if this reads 0,0,0 on the light theme again, the
    // probe is broken and the pass is meaningless.
    const plateSample = items[0].plate;
    const plateStr = `${Math.round(plateSample.r)},${Math.round(plateSample.g)},${Math.round(plateSample.b)}`;

    return {
      ok: invisible.length === 0 && empty === 0,
      detail:
        invisible.length === 0 && empty === 0
          ? `${items.length} marks visible on plate ${plateStr} — smallest channel delta ${deltas[0]}`
          : `${invisible.length} of ${items.length} marks blend into plate ${plateStr} (deltas ${deltas.slice(0, 5).join(", ")}), ${empty} fully transparent`,
    };
  });
}

/**
 * Proves the window can be dragged.
 *
 * The bug this guards was reported as "窗口不能拖动": the drag strip existed but
 * was 36px and sat only in the gap left by `justify-end`, so a student aiming at
 * the top of the window hit non-draggable content. Asserting the attribute
 * exists would not have caught that — the assertion is that the strip is tall
 * enough to hit (>= 48px) and spans the full width at the very top of the page.
 */
const dragReport = await page.evaluate(() => {
  const bar = document.querySelector(".titlebar-drag");
  if (!bar) return { ok: false, detail: "no .titlebar-drag element found" };
  const r = bar.getBoundingClientRect();
  const topHit = document.elementFromPoint(r.width / 2, r.height / 2);
  const inside = Boolean(topHit && bar.contains(topHit));
  const tall = r.height >= 48;
  return {
    ok: tall && inside && r.top < 2,
    detail: `h=${Math.round(r.height)}px top=${Math.round(r.top)} width=${Math.round(
      r.width,
    )}px centre-hits-drag=${inside}`,
  };
});


function isLight(rgb) {
  const m = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Rec. 601 luma: a cheap, adequate "is this a light surface" test.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

// --- Assertions --------------------------------------------------------------
// The purchase contacts, duplicated from `src/components/ProGate.tsx` on
// purpose. A test that imported them would assert nothing: it would pass even if
// the component rendered no contacts at all, because both sides would move
// together. Pinning the literal values is what catches a changed or dropped
// QQ/WeChat number, which is a silent commercial failure — the customer simply
// has no way to buy.
const CONTACT_QQ = "1700142491";
const CONTACT_WECHAT = "Arukas_0623";

// Checked per screen, against the text that was actually on screen at the time.
const welcome = textAt("01-welcome");
const goalScreen = textAt("01b-goal");
const goalSelected = textAt("01c-goal-selected");
const detect = textAt("02-detect");
const software = textAt("03-software");
const evidence = textAt("03b-software-evidence");
const choose = textAt("04-choose");
const install = textAt("05-install");
const advanced = textAt("06-install-advanced");
const failedRun = textAt("06b-install-failed");
const haltedRun = textAt("06c-install-halted");
const bootstrap = textAt("07-bootstrap");
const bootstrapExpanded = textAt("07b-bootstrap-expanded");
const bootstrapDetail = textAt("07c-bootstrap-detail-verification");
const bootstrapFailed = textAt("07d-bootstrap-failed");
const bootstrapHalted = textAt("07e-bootstrap-halted");
const done = textAt("08-done");
const report = textAt("09-report");
const dashboardOverview = textAt("10-dashboard-overview");
const dashboardCapabilityDetail = textAt("10b-dashboard-capability-detail");
const dashboardSoftware = textAt("11-dashboard-software");
const dashboardConfig = textAt("12-dashboard-config");
const dashboardHistory = textAt("13-dashboard-history");
const licenseFree = textAt("13b-dashboard-license-free");
const licenseActivated = textAt("13c-dashboard-license-activated");
const licenseDeactivated = textAt("13d-dashboard-license-deactivated");
const licenseMismatch = textAt("13e-dashboard-license-mismatch");

const checks = [
  // Labels updated for the 0.1.1 first-run redesign. The Welcome screen now
  // states the product name and what it is for, rather than the old
  // "配置这台电脑" headline and "检查这台电脑" door. Asserted as the brief's
  // own wording so a copy change that loses the beginner framing fails here.
  ["welcome headline", welcome.includes("Setup Center")],
  ["welcome subtitle", welcome.includes("帮你快速配置 AI 编程环境")],
  ["welcome cta", welcome.includes("检查电脑环境")],

  // --- Goal selection (phase 5) ---------------------------------------------
  // The screen the phase exists to add. It is asserted on the *ordering* claim
  // as well as its content: asking before measuring is the change, and a screen
  // that only appeared after detection would pass a naive content check.
  ["goal: the question is asked in the student's terms", goalScreen.includes("你想往哪个方向走")],
  [
    "goal: every direction is offered",
    goalScreen.includes("AI 应用开发") &&
      goalScreen.includes("AI 日常使用") &&
      goalScreen.includes("计算机课程学习") &&
      goalScreen.includes("算法与模型研究"),
  ],
  [
    "goal: a direction's requirements are visible before committing",
    goalSelected.includes("需要什么") && goalSelected.includes("Python 开发"),
  ],
  [
    "goal: completion is computed before detection has finished",
    goalPreview.completion !== null,
  ],
  [
    "goal: the preview states a measured percentage, not a placeholder",
    /%/.test(goalSelected) || /待检测/.test(goalSelected),
  ],
  ["goal: the chosen direction is carried into the plan", planCarriedGoal],

  ["detect: real windows version", /Windows (10|11)/.test(detect)],
  ["detect: every probe row rendered", ["Windows 版本", "管理员权限", "磁盘空间", "网络连接"].every((k) => detect.includes(k))],
  ["detect: score shown", /环境评分/.test(detect) && /\d+\s*%/.test(detect)],
  ["detect: disk value is real", /GB 可用/.test(detect)],
  ["detect: no false blocking claim", !/不可写/.test(detect)],

  // --- The Software Intelligence Layer's screen -----------------------------
  ["software: headline answers the stage-2 question", software.includes("软件与安装方案")],
  ["software: real inventory, not the old placeholders", software.includes("检查了") && /已安装/.test(software)],
  ["software: installed programs are listed with versions", /版本 \d/.test(software)],
  ["software: provider corroboration is visible", ["注册表", "PATH", "winget"].some((p) => software.includes(p))],
  ["software: evidence expands to per-source detail", evidenceShown.providers.length >= 2],
  ["software: no blanket 'not installed' claim", !/无法确认[\s\S]{0,40}未安装/.test(software)],

  [
    // Counted rather than name-matched: the shipping set grows, and the previous
    // name list quietly became a subset check.
    "choose: every shipped profile is offered",
    choose.includes("AI 基础版") &&
      choose.includes("AI 编程") &&
      choose.includes("程序员版") &&
      choose.includes("AI 开发版"),
  ],
  [
    // The defect this guards: `AI 办公` and `AI 基础版` both promised "just get
    // AI working", and `AI 开发版`/`AI 开发` differed by one character. Two rows
    // a student cannot tell apart make the choice feel arbitrary, which is worse
    // than offering fewer options.
    "choose: no two profiles carry the same name",
    (() => {
      const names = fixtures.profiles.map((p) => p.name);
      return new Set(names).size === names.length;
    })(),
  ],
  [
    // And the payload of that guarantee: the rows must differ in what they
    // install, not merely in wording.
    "choose: no two profiles install the same set",
    (() => {
      const sets = fixtures.profiles.map((p) => [...p.software].sort().join(","));
      return new Set(sets).size === sets.length;
    })(),
  ],
  ["choose: selected profile shows its software", choose.includes("VS Code") && choose.includes("Git")],
  ["choose: audience text rendered", choose.includes("写课程设计") || choose.includes("刚接触 AI")],
  [
    "choose: every package is reachable by scrolling (nothing clipped)",
    chooserReach.ok,
    chooserReach.ok
      ? `${chooserReach.count} packages, last row fully visible at the end of the list`
      : `last row bottom ${chooserReach.lastRowBottom} vs container ${chooserReach.containerBottom}`,
  ],
  [
    // The check that makes the one above meaningful: a list that overflows its
    // own box without scrolling is how "the last two packages are unreachable"
    // ships.
    "choose: the list scrolls rather than overflowing its container",
    chooserReach.scrollable !== false,
  ],

  // --- The Execution Engine's screen ----------------------------------------
  ["install: the engine is started by the screen", install.includes("安装完成") || install.includes("正在安装")],

  // --- Install flow freedom (brief phase 7) ---------------------------------
  //
  // The brief's requirement is that the flow no longer locks the student into
  // "选择 → 安装 → 完成". Three things follow, and each is asserted:
  //
  //   * the engine does not start until the student says so
  //   * the student can decline individual programs
  //   * declining one changes what the button promises to do
  [
    "install: nothing is installed until the student commits",
    startedBeforeCommit,
  ],
  [
    "install: every program to be installed is listed before the run",
    chooseReport.boxes >= 1,
    `${chooseReport.boxes} selectable rows`,
  ],
  [
    // Verified on 程序员版, the profile with two programs still missing here. Saying
    // *which* profile it ran against is part of the evidence: the same check on a
    // single-program profile would pass vacuously or fail for a reason that has
    // nothing to do with the product.
    "install: unchecking a program narrows what will be installed",
    selective.before !== null &&
      selectiveAfter.after !== null &&
      selectiveAfter.after === selective.before - 1,
    `${selective.before} → ${selectiveAfter.after} selected of ${selective.boxes}`,
  ],
  [
    // The visible half of the same thing: the button must stop promising the
    // whole plan once the student has declined part of it. A count that changed
    // while the label still said "开始安装（2 项）" would be a lying button.
    "install: the commit button states how many will actually run",
    typeof selectiveAfter.button === "string" &&
      /安装选中的 1 项|开始安装（1 项）/.test(selectiveAfter.button),
    selectiveAfter.button ?? "",
  ],
  ["install: steps are marked from the real session", /完成|跳过|失败/.test(install)],
  ["install: a completed run reports its outcome", install.includes("安装完成")],
  ["install: elapsed time is shown from the session", /用时|已用时/.test(install)],
  ["install: satisfied programs are skipped, not reinstalled", install.includes("已安装")],
  ["install: advanced mode reveals the real action trace", advanced.includes("执行记录")],
  ["install: the trace names the command that ran", advanced.includes("winget") || advanced.includes("官方安装包") || advanced.includes("npm")],
  ["install: the trace records an exit code", /退出码/.test(advanced)],
  ["install: exactly one engine run was started", startedOnce],
  [
    "install: a failed step is reported as failed",
    failedRun.includes("失败") || failedRun.includes("部分项目需要处理"),
  ],
  [
    "install: a failed run offers to continue",
    /继续安装/.test(failedRun),
  ],
  [
    "install: a permission halt explains itself",
    haltedRun.includes("需要管理员权限") && haltedRun.includes("安装已暂停"),
  ],
  [
    "install: a halted run keeps the remaining steps",
    /继续安装（还剩 \d+ 项）/.test(haltedRun),
  ],

  // --- The Bootstrap Layer's screen -----------------------------------------
  // The design requirement here is negative as much as positive: no progress
  // bar, no stack of cards. Most of these assertions are about the *content*
  // being real rather than about a widget existing.
  [
    "bootstrap: the screen renders the initialisation headline",
    bootstrap.includes("初始化") || bootstrap.includes("正在初始化"),
  ],
  [
    "bootstrap: every stage is listed, including empty ones",
    bootstrapStages.length === 5,
    bootstrapStages.length === 5 ? "" : `only ${bootstrapStages.join(", ")}`,
  ],
  [
    "bootstrap: stages show their real state, not a percentage",
    /已完成|已应用|无需修改|待处理|项/.test(bootstrap),
  ],
  [
    "bootstrap: completed stages are marked done",
    // At least one stage must have come back green on this machine.
    bootstrap.includes("✓") || /已应用|无需修改/.test(bootstrap),
  ],
  [
    "bootstrap: a stage expands to its individual steps",
    bootstrapExpanded.includes("插件") ||
      bootstrapExpanded.includes("VS Code") ||
      /code --install-extension|ms-python|ms-ceintl/.test(bootstrapExpanded),
  ],
  [
    "bootstrap: no traditional progress bar is rendered",
    // The brief forbids it. Asserted by its absence: no `<progress>` element and
    // no percentage readout.
    !/\b\d{1,3}\s*%\b/.test(bootstrap),
  ],
  [
    "bootstrap: the engine is started by the screen, exactly once",
    bootstrapStartedOnce,
  ],
  [
    "bootstrap: detail mode shows the real verification results",
    bootstrapDetail.includes("验证结果") || bootstrapDetail.includes("通过"),
  ],
  [
    "bootstrap: verification names what it checked",
    /插件|Git 设置|配置文件|语言设置|汉化/.test(bootstrapDetail),
  ],
  [
    "bootstrap: the localisation source is disclosed",
    // We ask the student to run someone else's script or install someone else's
    // package; the report must say whose.
    /github\.com|microsoft|官方语言包|上游社区方案/.test(bootstrapDetail),
  ],
  [
    "bootstrap: scope honesty section present",
    bootstrapDetail.includes("本次未做"),
  ],
  [
    "bootstrap: a failed step is reported as failed",
    bootstrapFailed.includes("失败") ||
      bootstrapFailed.includes("部分项目需要处理"),
  ],
  [
    "bootstrap: a halted run explains the permission problem",
    bootstrapHalted.includes("需要管理员权限") ||
      bootstrapHalted.includes("初始化已暂停"),
  ],

  ["done: package rows rendered", /正常|需检查/.test(done)],
  ["done: report body reachable", report.includes("Setup Center Report") && report.includes("环境评分")],
  ["done: scope honesty section present", report.includes("本次未做")],

  // --- The dashboard (stage 5) ---------------------------------------------
  //
  // The assertions below are about *meaning*, not layout. The complaint this
  // screen exists to answer was "it only shows status, not what any of it is
  // for", so the checks are: is there an explanation, is a purpose line present
  // on the rows, does the detail pane say something a student could act on.
  [
    "dashboard: reached from the welcome screen without walking a flow",
    dashboardOverview.length > 0 && dashboardOverview.includes("环境概览"),
  ],
  [
    "dashboard: shows the environment score",
    /\d{1,3}\s*%|满分/.test(dashboardOverview),
  ],

  // --- The status centre (brief phase 6) ------------------------------------
  //
  // Four separate assertions rather than one, because the brief asks for four
  // distinct things and three of them can hold while the fourth regresses. The
  // failure this guards against is specific: the overview drifting back into a
  // "检测报告" — a bare score with a gap list and no greeting, no framing.
  [
    "status centre: opens with a greeting, not a report header",
    statusCentre.greeting,
  ],
  [
    "status centre: the score is scoped to the whole machine",
    statusCentre.score,
  ],
  [
    // The load-bearing one. A screen that lists only what is missing reads as a
    // scolding and gets closed; showing what is ready *beside* what is not is
    // what makes the score something a student is willing to look at.
    //
    // At least two groups, because which second group is present depends on the
    // machine: this one has partial capabilities and nothing outright missing.
    "status centre: what is ready is shown beside what is not",
    statusCentre.groups.length >= 2,
    statusCentre.groups.join(" + ") || "no groups rendered",
  ],
  [
    // The cold-start regression, pinned.
    //
    // The app must never say "nothing was detected" on a screen that is
    // simultaneously listing what is ready. That is not a wording preference: it
    // is the app contradicting itself in its largest type, and it shipped once
    // because the stale advisor value was a defined 0 rather than a null.
    "status centre: never claims nothing was detected while listing what is ready",
    !statusCentre.contradiction,
    statusCentre.contradiction
      ? "the overview said nothing was detected while showing ready capabilities"
      : "consistent",
  ],
  [
    // The teeth. Same invariant, but staged against a genuinely stale advisor —
    // without this the assertion above cannot fail on this fixture, because the
    // recorded advisor is always `detected: true`.
    "status centre: a stale pre-detection advisor cannot hijack the headline",
    !staleRace.saysNotDetected && !staleRace.zeroPercent,
    `saidNotDetected=${staleRace.saysNotDetected} zeroPercent=${staleRace.zeroPercent} shownScore=${staleRace.shownScore} listsReady=${staleRace.listsReady}`,
  ],
  [
    "status centre: a next step is named on the overview",
    statusCentre.nextStep,
  ],
  [
    // Two percentages sit within a few pixels of each other and mean different
    // things: the chosen goal's completion and the machine's overall score.
    // Rendered bare they read as the app contradicting itself ("100%" directly
    // above "整体评分 73 / 100"). This asserts the machine score is labelled as
    // such *and* that the goal figure names its own scope, so neither number can
    // drift back to being unlabelled.
    "dashboard: the two scores state what they measure",
    dashboardOverview.includes("整体评分") &&
      /以上为「.+」方向的完成度/.test(dashboardOverview),
  ],
  [
    "dashboard: capabilities are grouped, not a flat list",
    dashboardOverview.includes("开发能力") ||
      dashboardOverview.includes("AI 工具链") ||
      dashboardOverview.includes("系统环境"),
  ],
  [
    "dashboard: hardware is reported from the real machine",
    /处理器|内存|显卡/.test(dashboardOverview),
  ],
  [
    "dashboard: the nav exposes every section",
    ["环境概览", "软件", "配置", "历史记录"].every((s) =>
      dashboardOverview.includes(s),
    ),
  ],
  [
    "dashboard: software rows carry a purpose line, not just a status",
    // The single most important content change in this phase. `Git · 已安装`
    // tells a student nothing; `代码版本管理与下载` tells them why to care.
    /版本管理|编辑器|运行环境|AI 编程助手|命令行/.test(dashboardSoftware),
  ],
  [
    "dashboard: unknown is rendered as its own state, never as missing",
    // On a machine where every probe answered, this is vacuously true; when a
    // probe fails it is the difference between useful and actively misleading.
    !/无法确认[\s\S]{0,20}未安装/.test(dashboardSoftware),
  ],
  [
    // A program this tool does not manage must not be drawn as a failure. CMake
    // absent showed a red cross beside its purpose line on the first render,
    // which reads as "we tried and failed" for something never offered.
    "dashboard: an unmanaged program is not rendered as a failure",
    dashboardSoftware.includes("仅检测") || dashboardSoftware.includes("需自行"),
  ],

  // --- The software master-detail (this round's UI brief) --------------------
  //
  // The brief replaced the card grid with a list beside the explanation. Each
  // required property is still asserted separately: a list that renders but drops
  // the recommendation, or the status word, is the failure mode, and a single
  // "a list exists" check would pass on all of them.
  [
    "list: programs render as rows in the list container",
    gridReport.count >= 8 && gridReport.containerExists,
    `${gridReport.count} rows`,
  ],
  [
    // The shape that can actually go wrong here. The list half of a
    // master-detail split *should* be one column, so the old multi-column check
    // is replaced by the two properties that make it a usable list: the rows
    // stack vertically, and each has real height rather than being clipped to a
    // strip that shows one line of text.
    "list: the rows stack vertically with real height",
    gridReport.stackedVertically && gridReport.rowsHaveHeight,
    `stacked=${gridReport.stackedVertically} heights=${gridReport.rowsHaveHeight}`,
  ],
  [
    "list: each row states its install status in words",
    gridReport.hasStatus,
  ],
  [
    "list: each row states whether it is recommended, from the capability table",
    gridReport.hasRecommendation,
  ],
  [
    // The row carries name plus a secondary line (the version when installed).
    // The purpose sentence moved to the detail pane on purpose, so this checks
    // the row still says something beyond the name rather than insisting on the
    // three-line card it replaced.
    "list: each row carries a second line, not only a name",
    gridReport.hasDetail,
  ],

  // --- Category tabs (brief phase 4) -----------------------------------------
  [
    "tabs: every category is offered, plus 全部",
    tabsReport.tabs >= 2 && tabsReport.labels.some((l) => l.startsWith("全部")),
    tabsReport.labels.join(" | "),
  ],
  [
    // The check that makes the tabs real rather than decorative: selecting a
    // category must change how many cards are on screen. A tab strip that only
    // moved a highlight would pass every content assertion above.
    "tabs: selecting a category narrows the grid",
    afterFilter < beforeFilter,
    `${beforeFilter} → ${afterFilter}`,
  ],

  // --- Accessibility of the new components (brief phase 10) ------------------
  [
    "a11y: every control on the grid has an accessible name",
    a11yReport.unnamed === 0,
    `${a11yReport.unnamed} of ${a11yReport.buttonCount} unnamed`,
  ],
  [
    // A card grid whose items cannot be reached by Tab is unusable without a
    // mouse, and a DOM-presence assertion would never notice.
    "a11y: the cards are keyboard reachable",
    a11yReport.focusable >= a11yReport.buttonCount * 0.9,
    `${a11yReport.focusable}/${a11yReport.buttonCount} focusable`,
  ],
  [
    // The regression this guards: a status pill that announces "通过 已安装" —
    // the same state twice, in two vocabularies. The word is the accessible
    // content; the glyph must be decorative inside a pill.
    "a11y: a status pill states its state once, not twice",
    a11yReport.doubled === 0,
    `${a11yReport.doubled} of ${a11yReport.pills} pills double-announce`,
  ],
  [
    "a11y: the category tabs expose their selection state",
    a11yReport.tabs > 0 && a11yReport.tabsWithState === a11yReport.tabs,
    `${a11yReport.tabsWithState}/${a11yReport.tabs}`,
  ],
  [
    "dashboard: the detail pane explains the selection",
    dashboardCapabilityDetail.length > 80 &&
      /需要满足|可选加分项|怎么做|怎么补|已就绪/.test(dashboardCapabilityDetail),
  ],
  [
    "dashboard: the config section says who must do the work",
    dashboardConfig.includes("不会替你") || dashboardConfig.includes("亲自"),
  ],
  [
    // The dashboard is entered here from a cold page load, so there is no session
    // to resume and the "继续" offer correctly does not appear. What must always
    // hold is that the section states the recovery guarantee — that an interrupted
    // run is continued rather than restarted. Asserting the button instead would
    // have tested the fixture's state rather than the product's behaviour.
    "dashboard: history states that interrupted work is resumed, not restarted",
    dashboardHistory.includes("接着做") ||
      dashboardHistory.includes("不会重做") ||
      dashboardHistory.includes("未完成"),
  ],
  [
    // The single most important licensing assertion, and it was *inverted* by
    // the commercial revision. The old build shipped the gate open, so this
    // assertion required the screen to say installation was "不限制". Now the
    // free tier genuinely refuses.
    //
    // Both halves read the entitlement: the fixture must actually be locked
    // (otherwise this tests the fixture, not the product), and the screen must
    // say so. The contradiction case — a screen promising a lock while the gate
    // is open, or vice versa — is what the teeth check exposed, so it is now
    // asserted directly rather than left to chance.
    "license: the free tier states that installation is locked",
    fixtures.license.freeEnforced.canInstall === false &&
      licenseFree.includes("免费版") &&
      licenseFree.includes("不包含自动安装"),
  ],
  [
    // The reverse direction of the same claim. A build with the gate open must
    // NOT tell the customer installation is locked. This is the assertion that
    // would have caught the hard-coded subtitle.
    "license: the screen never claims a lock the entitlement does not apply",
    (fixtures.license.freeEnforced.canInstall === true) ===
      !licenseFree.includes("不包含自动安装"),
  ],
  [
    "license: every capability row states its own scope",
    licenseFree.includes("环境检测") &&
      licenseFree.includes("软件推荐") &&
      licenseFree.includes("自动安装") &&
      licenseFree.includes("自动配置"),
  ],
  [
    // Reads the fixture rather than a string, so this fails when the *gate*
    // changes and not merely when the copy does. Written this way after the
    // teeth check showed the previous version passed on a hard-coded sentence
    // that contradicted the entitlement it was supposed to describe.
    "license: the free tier marks the paid capabilities as locked",
    fixtures.license.freeEnforced.canInstall === false &&
      licenseFree.includes("激活专业版后可用"),
  ],
  [
    // The failure this guards against: a locked button with no explanation of
    // what would unlock it.
    "license: activation path is offered when not activated",
    licenseFree.includes("输入激活码"),
  ],
  [
    "license: the free tier offers a way to buy",
    licenseFree.includes(CONTACT_QQ) && licenseFree.includes(CONTACT_WECHAT),
  ],
  [
    "license: activating switches the screen to the pro state",
    licenseActivated.includes("Professional") &&
      licenseActivated.includes("已激活") &&
      licenseActivated.includes("已解锁"),
  ],
  [
    // The brief's pro-state fields: device binding and activation time.
    "license: the pro state shows the device binding and activation time",
    licenseActivated.includes("设备绑定") && licenseActivated.includes("激活时间"),
  ],
  [
    // The brief's "用户不可查看/复制/导出", asserted against *affordances* rather
    // than against the wording. A text search was the wrong instrument: the
    // screen legitimately says the activation cannot be exported, so a
    // word-match both false-failed on that sentence and would have missed a
    // copy button labelled "复制". What matters is that no control offers it and
    // no input is holding a key.
    "license: no control offers to reveal, copy or export the activation",
    licenseSurface.offendingControls.length === 0,
  ],
  [
    "license: no input on the activated screen holds a pre-filled code",
    licenseSurface.preFilledInputs.length === 0,
  ],
  [
    // The stored activation file is DPAPI-encrypted; the screen must never
    // claim to show the key it cannot decrypt into view.
    "license: the pro state does not print a code-shaped string",
    !/SC-[0-9A-Z]{5}-[0-9A-Z]{5}/.test(licenseActivated),
  ],
  [
    "license: deactivating returns to the default tier",
    licenseDeactivated.includes("免费版") &&
      licenseDeactivated.includes("输入激活码"),
  ],
  [
    // Honesty requirement: no account, no server. A customer who entered a key
    // should not be left believing it was checked against a licensing service.
    "license: local-only activation is disclosed",
    licenseFree.includes("仅保存在本机") || licenseFree.includes("不联网校验"),
  ],
  [
    // The consequence of local-only checking, stated rather than hidden: the
    // file cannot be moved, which is the "绑定设备" behaviour in the customer's
    // own terms.
    "license: the device binding is disclosed before purchase",
    licenseFree.includes("绑定"),
  ],
  [
    // A device mismatch is a third state, not "free". The customer holds a real
    // code and must be told that rather than told their key is invalid.
    "license: a device mismatch is distinguished from being unactivated",
    licenseMismatch.includes("已绑定其他设备") &&
      licenseMismatch.includes("输入激活码"),
  ],
  [
    // The short id the *fixture* carries, not a constant. It was hardcoded to an
    // earlier random value (`3f9a2c41`), which meant the assertion only described
    // the fixture it was written against: regenerating fixtures from this machine
    // changed the id and the check failed while the screen was correct.
    //
    // Reading it back from the fixture keeps the assertion about the product —
    // "the mismatch screen prints the machine id the backend reported" — and it
    // still fails if the screen prints a different machine's id or none at all.
    "license: the mismatch state names this machine so support can compare",
    licenseMismatch.includes(fixtures.licenseDevice.freeEnforced.shortId),
  ],
  [
    "dashboard: light theme applies and is legible",
    lightThemeOk,
  ],  [
    "dashboard: dark theme restores the ink surface",
    darkThemeOk,
  ],
  [
    "dashboard: no console errors on the dashboard",
    consoleErrors.length === 0,
  ],
  [
    // The bug this guards: four screens called `describeSoftware(id)` without
    // the catalogue, so every raw id leaked into the UI as the product's name.
    // A student read "vscode", "git", "python" where the app meant
    // "VS Code", "Git", "Python" — and no existing assertion noticed, because
    // each one checked a *feature* rather than the copy.
    //
    // Checked across every captured screen, not just one: the omission was
    // per-screen, so a single-screen check would have missed three of the four.
    "no screen shows a raw software id where a product name belongs",
    (() => {
      // Only ids whose catalogue name *differs* from the id can leak visibly.
      // `npm`, `pnpm` and `uv` are genuinely named that (they are real product
      // names), so their presence is correct and checking them would be a
      // permanent false positive.
      const risky = fixtures.machineCatalogue.filter(
        (d) => d.name.toLowerCase() !== d.id && d.name !== d.id,
      );
      const leaks = [];
      for (const { name, text } of seen) {
        // Strip the two legitimate places a lowercase id appears on screen.
        //
        // 1. Filesystem paths. A real screen shows
        //    `D:\工具软件\cursor\resources\app\bin\cursor.cmd`, where `cursor` is
        //    a directory name, not a mis-rendered product name.
        // 2. VS Code extension ids. `ms-python.vscode-pylance` contains both
        //    `vscode` and `python`, and it must be shown verbatim — the student
        //    needs it to find the extension. A naive word-boundary check flags
        //    it, which is how this assertion first failed on correct UI.
        const scannable = text
          .split("\n")
          .filter((line) => !/[A-Za-z]:\\|\\\\|\/|\.exe|\.cmd|\.bat/i.test(line))
          // `publisher.extension` — a dot-joined identifier with no spaces.
          .map((line) => line.replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+/g, " "))
          .join("\n");
        for (const d of risky) {
          const pattern = new RegExp(`(^|[^A-Za-z0-9_])${d.id}([^A-Za-z0-9_.]|$)`);
          if (pattern.test(scannable)) leaks.push(`${name}:${d.id}`);
        }
      }
      return [
        leaks.length === 0,
        leaks.length ? leaks.slice(0, 6).join(", ") : `${risky.length} ids checked`,
      ];
    })(),
  ],

  // --- Branding overhaul ------------------------------------------------------
  //
  // Every assertion below is a *regression guard* for the specific thing this
  // phase exists to fix. Two of them are non-obvious and worth stating:
  //
  // * "no AI-brand scaffolding" scans every captured screen for the old
  //   product's vocabulary. It is a list rather than one string because the
  //   defect was never a single word — it was a whole register ("AI 环境顾问",
  //   "AI 开发准备度") that the app used as its voice, and any one of those
  //   coming back is the same failure.
  // * "icons load from bundled assets" reads the natural size of each rendered
  //   `<img>`. A broken image and a correctly-loaded one are *both* present in
  //   the DOM, so a DOM-presence check would pass on a 404. `naturalWidth === 0`
  //   is the only signal that distinguishes them.
  [
    "brand: every captured screen carries the Setup Center name",
    seen.some(({ text }) => text.includes("Setup Center")),
  ],
  [
    "brand: no user-visible surface still says 'AI Student Setup'",
    !seen.some(({ text }) => text.includes("AI Student Setup")),
    (() => {
      const bad = seen.filter(({ text }) => text.includes("AI Student Setup"));
      return bad.length ? bad.map((s) => s.name).join(", ") : "";
    })(),
  ],
  [
    "brand: no screen claims the old product was an AI assistant/advisor",
    !seen.some(({ text }) =>
      /AI Environment Advisor|AI 环境顾问|AI Development Readiness|AI 开发准备度|AI Assistant/.test(
        text,
      ),
    ),
  ],
  [
    "brand: the old 'AI 能力' register is gone from user-visible copy",
    !seen.some(({ text }) => /AI 能力|拥有 AI|成为 AI 开发者/.test(text)),
  ],
  [
    "brand: the window title is Setup Center",
    await page.title() === "Setup Center",
    await page.title(),
  ],
  [
    "brand: the title bar shows the product name, not the page name alone",
    titlebarOccurrences() > 0,
  ],
  [
    "icons: rendered marks come from bundled assets and actually load",
    [iconReport.ok, iconReport.detail],
  ],
  [
    "icons: no mark is rendered as a bare first-letter tile",
    // The fallback tile is allowed *only* for ids with no official asset. A
    // letter tile appearing on a row that has a brand mark is the bug.
    !/^(vs$|cl$|ch$|cu$|gi$|py$|no$)/im.test(dashboardSoftware),
  ],
  [
    "icons: every mark is visible against the light surface",
    // Loading is not seeing. A `fill="white"` glyph loads at full size and
    // disappears on paper — that was Continue, and only a contrast probe catches
    // it. See `collectIconContrastReport` for the three real cases behind this.
    [lightIconContrast.ok, lightIconContrast.detail],
  ],
  [
    "icons: every mark is visible against the dark surface",
    [darkIconContrast.ok, darkIconContrast.detail],
  ],
  [
    "icons: every id with an official asset has one, the rest are on the record",
    // `SoftwareIcon.tsx` has claimed since v2 that "`tools/ui-verify.mjs`
    // asserts this list and `MARKS` together cover every id". It did not — the
    // exports existed and nothing read them, so a software row added without an
    // icon passed silently. This is that assertion.
    //
    // It reads the two module exports directly rather than the DOM, because the
    // failure it guards against is "nobody wired the id up", which the DOM
    // cannot distinguish from "this id is on the exempt list".
    (() => {
      const { ICON_IDS, NO_BRAND_ASSET } = iconExports;
      const all = iconExports.ALL_IDS;
      const both = ICON_IDS.filter((id) => NO_BRAND_ASSET.includes(id));
      const missing = all.filter(
        (id) => !ICON_IDS.includes(id) && !NO_BRAND_ASSET.includes(id),
      );
      const detail = [];
      if (both.length) detail.push(`in both lists: ${both.join(", ")}`);
      if (missing.length) detail.push(`in neither list: ${missing.join(", ")}`);
      detail.push(
        `${ICON_IDS.length} official marks, ${NO_BRAND_ASSET.length} exempt (${NO_BRAND_ASSET.join(", ")})`,
      );
      return [both.length === 0 && missing.length === 0, detail.join("; ")];
    })(),
  ],
  [
    "titlebar: a drag region exists and reaches the top edge",
    [dragReport.ok, dragReport.detail],
  ],
];

let failed = 0;
for (const entry of checks) {
  // A check is `[name, ok]` or `[name, [ok, detail]]`. The second form lets a
  // failing assertion say *what* leaked, which is the difference between "raw id
  // found" and a five-second fix.
  const name = entry[0];
  const raw = entry[1];
  const ok = Array.isArray(raw) ? raw[0] : raw;
  const detail = Array.isArray(raw) ? raw[1] : undefined;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
  if (!ok) failed++;
}
if (consoleErrors.length) {
  console.log("\nconsole errors:");
  consoleErrors.slice(0, 10).forEach((e) => console.log("  " + e));
}

console.log(
  `\n${checks.length - failed}/${checks.length} assertions passed`,
);
console.log(`screenshots: ${shots.join(", ")}`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
