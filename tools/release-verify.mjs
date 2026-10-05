/**
 * Verifies the 0.2.3 commercial release against the REAL INSTALLED application.
 *
 * The headless harness (`tools/ui-verify.mjs`) renders the bundle in a stubbed
 * Chromium and therefore cannot see anything that matters here: whether the
 * compiled Rust validator accepts a code issued months ago, whether DPAPI
 * round-trips, whether the packaged bundle still carries an App Release update
 * check. This script attaches to the installed executable's WebView2 debugger
 * instead, so every assertion is made against the shipped binary.
 *
 * Usage:
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"
 *   "D:\Setup Center\ai-student-setup.exe"      # launch once, leave running
 *   node tools/release-verify.mjs --pass=1      # free → activate → inspector
 *   # restart the process, then:
 *   node tools/release-verify.mjs --pass=2      # activation survived the restart
 *
 * Pass 1 reloads the page once after attaching, so the network log covers the
 * application's own startup activity rather than only what happens after the
 * debugger arrives.
 */

const BASE = "http://127.0.0.1:9333";
const PASS = Number((process.argv.find((a) => a.startsWith("--pass=")) ?? "--pass=1").split("=")[1]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
let id = 0;
const pending = new Map();
const observed = [];

const send = (method, params = {}) =>
  new Promise((res) => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails) {
    return { __error: r.result.exceptionDetails.text ?? "evaluate failed" };
  }
  return r.result?.result?.value;
};

const attach = async () => {
  const list = await (await fetch(`${BASE}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target in the running app");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Network.requestWillBeSent") {
      observed.push(msg.params?.request?.url ?? "");
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
};

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const badge = async () =>
  await evaluate(`(() => {
    const el = document.querySelector('[data-testid="version-badge"]');
    return el ? { text: el.innerText.trim(), tier: el.dataset.tier, state: el.dataset.state } : null;
  })()`);

const bodyText = async () => String(await evaluate("document.body.innerText"));

const clickText = async (pattern) =>
  await evaluate(`(() => {
    const re = new RegExp(${JSON.stringify(pattern)});
    const el = [...document.querySelectorAll('button, a, [role="button"]')]
      .find(b => re.test((b.innerText || '').trim().replace(/\\s+/g, ' ')));
    if (!el) return false;
    el.click();
    return true;
  })()`);

const typeInto = async (value) =>
  await evaluate(`(() => {
    const el = document.querySelector('#activation-key');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

const submitAndSettle = async () => {
  const clicked = await evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find(b => /激活 PRO/.test(b.innerText));
    if (!el) return false; el.click(); return true;
  })()`);
  if (!clicked) return false;
  for (let i = 0; i < 40; i++) {
    await wait(400);
    const busy = await evaluate(
      `!![...document.querySelectorAll('button')].find(b => /激活中/.test(b.innerText))`,
    );
    if (busy === false) return true;
  }
  return true;
};

// --- attach + capture the application's own startup ---------------------------
await attach();
await send("Network.enable");
await send("Page.enable");
await send("Page.reload");
await wait(9000);

const TITLE = await evaluate("document.title");
check("installed app: window title is Setup Center", TITLE === "Setup Center", TITLE);

const b0 = await badge();

if (PASS === 1) {
  // --- C. FREE on a fresh machine -------------------------------------------
  check(
    "C. fresh machine shows FREE (top badge, real Rust entitlement)",
    b0 && b0.tier === "free" && b0.state === "inactive",
    b0 ? `${b0.text} / tier=${b0.tier} / state=${b0.state}` : "badge absent",
  );

  const welcomeActivate = await evaluate(
    `!!document.querySelector('[data-testid="welcome-activate"]')`,
  );
  check("C. welcome screen exposes 输入激活码 entry", welcomeActivate === true);
  const tiersShown = await evaluate(`!!document.querySelector('[data-testid="welcome-tiers"]')`);
  check("C. welcome screen states the FREE/PRO scope", tiersShown === true);

  // --- B. a wrong code is refused, with a message, without a crash ----------
  const openGate = await clickText("^输入激活码$");
  check("C. the activation entry opens the card", openGate === true);
  await wait(900);

  await typeInto("SC-AAAAA-BBBBB-CCCCC-DDDDD");
  await submitAndSettle();
  const errText = await evaluate(
    `(() => { const e = document.querySelector('[data-testid="license-error"]'); return e ? e.innerText.trim() : null; })()`,
  );
  check(
    "B. a random wrong code is refused with a visible message",
    typeof errText === "string" && errText.length > 0,
    errText,
  );
  check(
    "B. the app did not crash on a rejected code",
    (await evaluate("document.body.innerText.length > 0")) === true,
  );
  const afterBad = await badge();
  check("B. the tier is unchanged after a rejected code", afterBad?.tier === "free", String(afterBad?.tier));

  // --- A. a REAL legacy code activates PRO ----------------------------------
  // SC-ZKDW4-3108S-VRSD3-T600V is ledger id 001, printed 2026-09-21. Supplied
  // lowercase, space-separated and with full-width/typographic dashes on purpose:
  // the point is that a code issued before this release still works through the
  // messy input a real customer produces.
  const CODE = "sc‐ZKDW4 3108s–vrsd3－t600v";
  await typeInto(CODE);
  await submitAndSettle();

  const b1 = await badge();
  check(
    "A. ledger id 001 activates PRO through messy input (legacy code still valid)",
    b1 && b1.tier === "pro" && b1.state === "active",
    b1 ? `${b1.text} / tier=${b1.tier} / state=${b1.state}` : "badge absent",
  );
  // The persistent tier row sits above every section EXCEPT 版本与激活 (which
  // renders the full scope list instead), so it has to be read while still on
  // the dashboard — reading it after the navigation below finds nothing.
  const proHint = await evaluate(
    `document.querySelector('[data-testid="upgrade-pro-label"]')?.innerText.trim() ?? null`,
  );
  check(
    "A. the dashboard tier row stands down to PRO 已激活",
    proHint === "PRO 已激活",
    String(proHint),
  );
  // Activating from the welcome gate lands on the dashboard, so the licence
  // screen has to be opened the way a customer opens it before the PRO panel
  // can be read — the earlier version of this script asserted it from the
  // dashboard and reported a false failure.
  await clickText("版本与激活");
  await wait(1800);
  const proState = await evaluate(`!!document.querySelector('[data-testid="license-pro-state"]')`);
  const mismatch = await evaluate(`!!document.querySelector('[data-testid="license-mismatch"]')`);
  const heading = await evaluate(
    `document.querySelector('[data-testid="license-heading"]')?.innerText.trim() ?? null`,
  );
  check(
    "A. the 版本与激活 section renders the PRO state (not a device mismatch)",
    proState === true && mismatch === false,
    `pro-state=${proState} mismatch=${mismatch} heading=${heading}`,
  );
  // The heading is uppercased by CSS, so this compares case-insensitively:
  // exact matching would assert the stylesheet rather than the product.
  check(
    "A. the licence heading names the activated product",
    (heading || "").toLowerCase() === "setup center professional",
    String(heading),
  );
  const scopeText = await bodyText();
  check(
    "A. the 功能范围 list shows installation as 已授权",
    scopeText.includes("已授权，可自动下载并安装"),
  );
} else {
  // --- A(continued). the activation survived a real process restart ---------
  check(
    "A. PRO survives a real process restart with no re-entry (restart persistence)",
    b0 && b0.tier === "pro" && b0.state === "active",
    b0 ? `${b0.text} / tier=${b0.tier} / state=${b0.state}` : "badge absent",
  );
  const gateShown = await evaluate(
    `!!document.querySelector('#activation-key') ||
     !!document.querySelector('[data-testid="gate-free"]')`,
  );
  check("A. no activation gate is forced on an activated machine", gateShown === false);
}

// --- D. no App Release surface, no App Release request ------------------------
const openInspector = await evaluate(`(() => {
  const el = [...document.querySelectorAll('button')].find(b => /内容更新/.test(b.innerText));
  if (!el) return false; el.click(); return true;
})()`);
check("D. the titlebar rename reaches the installed build (内容更新 button)", openInspector === true);
await wait(2500);

// Trigger the content check explicitly, then let the Vault fetch land, so the
// network log contains the one request this release is supposed to make.
await clickText("立即检查内容批次");
await wait(4500);

const modalText = await bodyText();
check(
  "D. no 应用程序本体 / App Release card on the installed build",
  !modalText.includes("应用程序本体") && !modalText.includes("App Release"),
);
check("D. no 查看 GitHub Releases entry", !modalText.includes("查看 GitHub Releases"));
check("D. no 发布通道连接异常 App-Release warning", !modalText.includes("发布通道连接异常"));
check("D. the Vault content channel is present", modalText.includes("Vault 内容资产通道"));
check("D. the page renamed to 内容与更新中心 (Vault Inspector)", modalText.includes("内容与更新中心"));

const appReleaseRequests = observed.filter(
  (u) => u.includes("api.github.com/repos/") && u.includes("releases"),
);
check(
  "D. zero App Release network requests were issued",
  appReleaseRequests.length === 0,
  appReleaseRequests.join(", ") || "none observed",
);
const vaultRequests = observed.filter((u) => u.includes("setup-center-vault"));
check(
  "D. the Vault channel issued its batch-manifest request (content sync intact)",
  vaultRequests.length > 0,
  vaultRequests.slice(0, 2).join(", ") || "none observed",
);

// --- report -------------------------------------------------------------------
let failed = 0;
console.log(`\n--- pass ${PASS} ---`);
for (const [name, ok, detail] of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} release assertions passed (pass ${PASS})`);

ws.close();
process.exit(failed ? 1 : 0);
