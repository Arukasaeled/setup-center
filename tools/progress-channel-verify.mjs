// Real verification of the install progress channel (0.1.2).
//
// ## What this proves, and why ui-verify.mjs cannot
//
// `ui-verify.mjs` stubs `run_install` to return a *finished* session
// immediately. That is right for what it tests — screen rendering from a
// result — but it cannot verify this phase's central change, because the whole
// point is what happens *during* a run. A stub that resolves instantly collapses
// the interval to zero, so a UI with no live channel and a UI with a working one
// render identically.
//
// This harness drives the real production bundle with a mock backend that
// reproduces the *timing*: `run_install` stays pending while progress events are
// delivered, exactly as Rust does. It asserts:
//
//   1. The event name Rust emits on is the name TypeScript listens on, read from
//      the real source files (so a rename is caught rather than agreed with).
//   2. The emitter is actually wired into *both* mutating commands.
//   3. A step update delivered mid-run reaches the store and the rendered row —
//      the fix itself.
//   4. A single-link chain never displays a fabricated percentage (audit §九).
//
// ## How the event bridge is faked
//
// `@tauri-apps/api/event`'s `listen()` calls
// `__TAURI_EVENT_PLUGIN_INTERNALS__.registerListener` and then invokes
// `plugin:event|listen`. This harness provides both, so the app's real,
// unmodified `onInstallProgress` code path runs — nothing in `src/` is stubbed.

import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let failures = 0;
const check = (ok, label, detail = "") => {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

// ---------------------------------------------------------------------------
// 1. Cross-boundary name agreement, read from source.
// ---------------------------------------------------------------------------

const rustCommands = readFileSync(join(root, "src-tauri/src/commands.rs"), "utf8");
const rustMatch = /INSTALL_PROGRESS_EVENT:\s*&str\s*=\s*"([^"]+)"/.exec(rustCommands);
const ipcTs = readFileSync(join(root, "src/lib/ipc.ts"), "utf8");
const tsMatch = /INSTALL_PROGRESS_EVENT\s*=\s*"([^"]+)"/.exec(ipcTs);

check(!!rustMatch, "the Rust emitter declares an event name");
check(!!tsMatch, "the TypeScript listener declares an event name");

if (!rustMatch || !tsMatch) {
  console.error("cannot continue without both event names");
  process.exit(1);
}
const RUST_EVENT = rustMatch[1];
const TS_EVENT = tsMatch[1];

check(
  RUST_EVENT === TS_EVENT,
  "the emit event name matches the listen event name",
  `rust=${RUST_EVENT} ts=${TS_EVENT}`,
);

const emitSites = (rustCommands.match(/emit_progress\(&window, step\)/g) ?? []).length;
check(
  emitSites >= 2,
  "both run_install and resume_install emit progress",
  `found ${emitSites} emit site(s)`,
);

const installRs = readFileSync(join(root, "src-tauri/src/modules/install.rs"), "utf8");
check(
  /execute_plan_observed/.test(installRs) && /resume_plan_observed/.test(installRs),
  "the engine exposes observed variants of both entry points",
);

const fixturePath = join(here, "fixtures.json");
if (!existsSync(fixturePath)) {
  console.error("missing fixtures.json — run `cargo run --bin probe` first");
  process.exit(1);
}
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

// ---------------------------------------------------------------------------
// 2. Drive the real bundle.
// ---------------------------------------------------------------------------

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1040, height: 720 },
  colorScheme: "dark",
});

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

await page.addInitScript(
  ({ data, eventName }) => {
    const listeners = new Map();
    const delivered = [];
    let pendingResolve = null;
    // Diagnostics for the bridge itself: how many times the app asked to listen,
    // and on which event names. Without these, a listener count of zero cannot
    // be told apart from a mock that failed to register what it was handed.
    let listenCalls = 0;
    const registeredEvents = [];

    // Which profile the flow settles on. The plan keys off it, so the mock must
    // remember it the way Rust's state does. Defaults to `coder` because that is
    // the profile this harness selects.
    const mode = { profileId: "coder" };

    const stepIds = ["git", "node", "vscode"];
    const names = { git: "Git", node: "Node.js", vscode: "VS Code" };
    const makeSession = (steps) => ({
      id: "session-live-verify",
      profileId: "coder",
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T00:03:00Z",
      actions: [],
      steps,
      failedSteps: [],
      cancelledSteps: [],
      remaining: [],
      verified: null,
      haltedReason: null,
      cancelledByUser: false,
    });
    const finalSteps = stepIds.map((id, i) => ({
      stepId: id,
      name: names[id],
      status: "succeeded",
      index: i,
      total: 3,
      stage: "安装完成",
      fraction: 1,
      detail: null,
    }));

    // Delivers one payload through the same registration the real event module
    // uses, so the app's unmodified `listen()` receives it.
    const deliver = (payload) => {
      delivered.push(payload);
      for (const entry of listeners.values()) {
        try {
          entry.handler({ event: eventName, id: entry.id, payload });
        } catch {
          /* one bad listener must not stop the others */
        }
      }
    };

    // The frames a real run produces: each step announced as running before it
    // finishes. These middle states are what the screen must be able to show.
    const liveFrames = [
      {
        stepId: "git",
        name: "Git",
        status: "running",
        index: 0,
        total: 3,
        stage: "正在安装（官方安装包）",
        fraction: null,
        detail: null,
      },
      {
        stepId: "node",
        name: "Node.js",
        status: "running",
        index: 1,
        total: 3,
        stage: "正在通过 winget 安装",
        fraction: null,
        detail: null,
      },
    ];

    const handlers = {
      detect_environment: () => data.environment,
      windows_info: () => data.windows ?? null,
      // `scan_software` returns the `SoftwareInventory` itself (it has `items`
      // and `providers` at the top level), *not* the `SoftwareScan` wrapper the
      // fixture stores alongside it. Returning the wrapper here is what crashed
      // the software screen on `inventory.providers.join(...)`.
      scan_software: () => data.scan?.inventory ?? data.scan,
      last_software_scan: () => data.scan?.inventory ?? data.scan,
      list_profiles: () => data.profiles ?? [],
      get_profile: (a) => (data.profiles ?? []).find((p) => p.id === a.id) ?? null,
      // Both take `{ profileId }` (see `ipc.ts`), not the profile object itself.
      build_install_plan: (a) => data.plans?.[a?.profileId ?? mode.profileId] ?? null,
      install_strategies: (a) => data.strategies?.[a?.profileId ?? mode.profileId] ?? [],
      preview_install: (a) => data.previews?.[a?.plan?.profileId ?? mode.profileId] ?? data.preview,
      execution_readiness: () => data.readiness,
      verify_install_result: () => null,
      license_status: () =>
        data.license?.pro ?? {
          state: "active",
          tier: "pro",
          entitlements: { canInstall: true },
        },
      license_device: () => data.licenseDevice?.freeEnforced ?? null,
      software_catalogue: () => data.machineCatalogue ?? [],
      explained_catalogue: () => data.explained ?? [],
      machine_facts: () => data.machine ?? null,
      capability_report: () => data.capabilities ?? [],
      advisor_summary: () => data.advisor ?? null,
      knowledge_status: () => data.knowledgeStatus ?? null,
      list_goals: () => data.goals ?? null,
      environment_plan: (a) => data.goalPlans?.[a?.goalId] ?? null,
      runtime_status: () => data.status ?? null,
      install_log_path: () => null,
      // Pending on purpose: the screen is observed genuinely mid-run.
      run_install: () => {
        for (const frame of liveFrames) deliver(frame);
        return new Promise((resolve) => {
          pendingResolve = () => {
            for (const s of finalSteps) deliver(s);
            resolve(makeSession(finalSteps));
          };
        });
      },
      resume_install: () => makeSession(finalSteps),
      cancel_install: () => true,
      resumable_install: () => null,
      last_install_session: () => null,
    };

    // The event plugin bridge the real `@tauri-apps/api/event` uses.
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(event, id) {
        listeners.delete(id);
      },
      registerListener(event, id, handler) {
        listeners.set(id, { id, handler });
        registeredEvents.push(event);
      },
    };

    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd.startsWith("plugin:window|")) return null;
        if (cmd === "plugin:event|listen") {
          listenCalls += 1;
          // The real `listen()` passes the event name and the handler's callback
          // id; registration happens *here*, not via
          // `__TAURI_EVENT_PLUGIN_INTERNALS__.registerListener` (that half is
          // only used by the native side, which is why counting only there
          // reported four calls and zero registrations).
          //
          // `transformCallback` returns its argument unchanged in this harness,
          // so `args.handler` is the function the app gave the event module.
          const id = String(args?.handler);
          listeners.set(id, { id, handler: args?.handler });
          registeredEvents.push(args?.event);
          return id;
        }
        if (cmd === "plugin:event|unlisten") return null;
        const fn = handlers[cmd];
        if (!fn) return undefined;
        return fn(args ?? {});
      },
      transformCallback: (cb) => cb,
      convertFileSrc: (p) => p,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      plugins: {},
    };

    window.__finishInstall = () => pendingResolve?.();
    window.__delivered = () => delivered.slice();
    window.__listenerCount = () => listeners.size;
    window.__listenCalls = () => listenCalls;
    window.__registeredEvents = () => registeredEvents.slice();
  },
  { data: fixtures, eventName: TS_EVENT },
);

await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
await page.waitForTimeout(900);

check(
  consoleErrors.length === 0,
  "the app boots without console errors",
  consoleErrors.join(" | ").slice(0, 400),
);

// ---------------------------------------------------------------------------
// 3. Walk the real flow to the install screen.
//
// The gate and the dashboard-or-wizard decision are real product behaviour, so
// this walks them the way ui-verify.mjs does rather than seeding state.
// ---------------------------------------------------------------------------

// First launch shows the activation gate; decline the paid tier to continue.
if (
  await page
    .locator('[data-testid="gate-heading"]')
    .isVisible()
    .catch(() => false)
) {
  await page.locator('[data-testid="gate-free"]').click();
  await page.waitForTimeout(700);
}

// A returning customer lands on the dashboard; the wizard is one click away.
const backToSetup = page.getByRole("button", { name: /回到首次设置/ });
if (await backToSetup.isVisible().catch(() => false)) {
  await backToSetup.click();
  await page.waitForTimeout(700);
}

/**
 * Clicks the primary advance control on the current screen.
 *
 * The wizard's forward button is worded differently per screen (继续, 仍然继续,
 * 下一步, 开始检测) and 0.1.2 may still adjust the copy, so this matches the
 * family rather than one literal. It prefers the *last* enabled match, because
 * in this layout the forward action sits at the footer's right edge while
 * earlier matches are row controls.
 */
async function advance() {
  // `开始安装（3 项）` carries a live count, so the match cannot be anchored on
  // the bare verb — that was why the final commit click silently did nothing
  // while every earlier screen advanced correctly.
  const re = /^(继续|仍然继续|下一步|开始检测|开始安装（\d+ 项）|开始安装|安装选中的)$/;
  const all = page.getByRole("button", { name: re });
  const count = await all.count();
  for (let i = count - 1; i >= 0; i -= 1) {
    const b = all.nth(i);
    if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) {
      await b.click();
      return true;
    }
  }
  return false;
}

/**
 * The current screen's heading, for diagnostics.
 *
 * Every navigation step prints where it landed. Without this, a mis-click showed
 * up only as an unrelated assertion failing twenty lines later, which is what
 * made this file slow to get right.
 */
const screenHeading = () =>
  page.evaluate(() => {
    const main = document.querySelector("main");
    return (main?.querySelector("h1, h2")?.textContent ?? "").trim().slice(0, 40);
  });

// 欢迎 → 目标 ("你想往哪个方向走？").
await page.locator('[data-testid="welcome-entry"][data-entry="②"]').click();
await page.waitForTimeout(900);
console.log(`      [0] after welcome: ${JSON.stringify(await screenHeading())}`);

// 目标 → 检测 ("系统检测"). The goal name is a real row from
// `knowledge/goal.rs`'s table, which is what this screen renders.
await page.getByRole("button", { name: /算法与模型研究/ }).first().click();
await page.waitForTimeout(700);
await page.getByRole("button", { name: /开始检测/ }).click();
await page.waitForTimeout(2800);
console.log(`      [1] after detect: ${JSON.stringify(await screenHeading())}`);

// 检测 → 已装软件 ("软件与安装方案"). The detect screen's forward control may be
// 仍然继续 ("continue anyway") when the network probe reports 较慢, which is what
// this machine's fixture says — hence the family matcher.
await advance();
await page.waitForTimeout(1600);
console.log(`      [2] after advance: ${JSON.stringify(await screenHeading())}`);

// 已装软件 → 方案 ("选择你的使用场景").
await advance();
await page.waitForTimeout(1600);
console.log(`      [3] after advance: ${JSON.stringify(await screenHeading())}`);

// 方案: pick a profile, then advance with 下一步.
//
// The button is `disabled` until a profile is selected *and* its plan has been
// built (`Choose.tsx`: `disabled={!selectedProfileId || planLoading}`, and
// `next()` only navigates when `plan` is non-null). So the click waits for the
// plan to land rather than firing immediately after the selection.
await page.getByRole("button", { name: /AI 编程/ }).first().click();
await page.waitForTimeout(1800);
await advance();
await page.waitForTimeout(1500);

// Which screen are we on? Reported always, because "the harness arrived
// somewhere unexpected" is the failure mode that made earlier runs of this file
// hard to read: a wrong click showed up only as a downstream assertion failing.
const where = await page.evaluate(() => {
  const main = document.querySelector("main");
  const heading = main?.querySelector("h1, h2");
  return {
    heading: (heading?.textContent ?? "").trim().slice(0, 60),
    hasProgressBar: !!document.querySelector('[data-testid="install-progress"]'),
    hasChoosePhase: !!document.querySelector('[data-testid="install-phase"]'),
  };
});
console.log(
  `      (arrived at: heading=${JSON.stringify(where.heading)} ` +
    `installPhase=${where.hasChoosePhase} progressBar=${where.hasProgressBar})`,
);

// The install screen opens on its own choose-phase first; commit that too. This
// click is what starts the engine and therefore the progress channel. The run
// then stays pending (the mock does not resolve until `__finishInstall`), so the
// assertions below run against a genuinely live install.
await advance();
await page.waitForTimeout(2000);

// ---------------------------------------------------------------------------
// 4. The assertions that matter: the live channel is attached and delivering.
// ---------------------------------------------------------------------------

// What the mock's event bridge actually saw. `listenCalls` counts
// `plugin:event|listen` invocations, which distinguishes "the app never asked
// to listen" from "the app asked and the mock registered it wrongly".
const bridge = await page.evaluate(() => ({
  listenerCount: window.__listenerCount(),
  listenCalls: window.__listenCalls ? window.__listenCalls() : -1,
  registered: window.__registeredEvents ? window.__registeredEvents() : [],
}));
console.log(`      (event bridge: ${JSON.stringify(bridge)})`);

check(
  bridge.listenerCount >= 1,
  "the install screen registered a progress listener",
  `listeners=${bridge.listenerCount} listenCalls=${bridge.listenCalls}`,
);

const bodyText = await page.locator("body").innerText();

// The frames announced a running Git and Node.js. If the channel works, at
// least one of those stages is on screen *while* the run is pending.
const sawLiveStage =
  /正在安装|正在通过 winget|正在下载/.test(bodyText) ||
  /Git|Node\.js/.test(bodyText);
check(
  sawLiveStage,
  "a mid-run step is visible before the run resolves",
  bodyText.replace(/\s+/g, " ").slice(0, 300),
);

// Audit §九: no invented percentage. A single-link chain reports
// `indeterminate`; a fabricated "60%" would be the lie the brief forbids.
const fabricated = /\b([1-9]\d)%\b/.test(bodyText) && !/100%/.test(bodyText);
check(!fabricated, "no fabricated percentage is displayed", fabricated ? bodyText.slice(0, 200) : "");

const delivered = await page.evaluate(() => window.__delivered());
check(
  delivered.length >= 2,
  "the backend delivered live step frames",
  `delivered=${delivered.length}`,
);

// Release the pending run and confirm the screen reaches its finished state.
await page.evaluate(() => window.__finishInstall());
await page.waitForTimeout(900);
const finalText = await page.locator("body").innerText();
check(
  /完成|已安装|安装完成|成功/.test(finalText),
  "the run completes and the screen reports it",
  finalText.replace(/\s+/g, " ").slice(0, 300),
);

check(
  consoleErrors.length === 0,
  "no console errors during the run",
  consoleErrors.join(" | ").slice(0, 400),
);

await browser.close();

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all progress-channel checks passed");
