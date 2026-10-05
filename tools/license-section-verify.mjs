/**
 * Reads the activated licence section off the running application.
 *
 * Separated from `release-verify.mjs` because it needs a machine that is already
 * activated, whereas that script's pass 1 must start from a fresh FREE one.
 *
 * Start the installed app first:
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"
 *   Start-Process "D:\Setup Center\ai-student-setup.exe"
 */
const BASE = "http://127.0.0.1:9333";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.log("FAIL  no page target"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
/**
 * A CDP reply can be lost when the renderer replaces its execution context.
 * Every call must be able to give up rather than leave a top-level await
 * unsettled — an earlier version hung here and reported nothing at all.
 */
const send = (method, params = {}) =>
  new Promise((res) => {
    const myId = ++id;
    const timer = setTimeout(() => { pending.delete(myId); res({ __timeout: true }); }, 12000);
    pending.set(myId, (m) => { clearTimeout(timer); res(m); });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
await new Promise((res) => ws.addEventListener("open", res));
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return r?.result?.result?.value;
};
const waitFor = async (expression, ms = 25000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await evaluate(expression)) return true;
    await wait(700);
  }
  return false;
};

const clickText = async (pattern) =>
  await evaluate(`(() => {
    const re = new RegExp(${JSON.stringify(pattern)});
    const el = [...document.querySelectorAll('button, a, [role="button"]')]
      .find(b => re.test((b.innerText || '').trim().replace(/\\s+/g, ' ')));
    if (!el) return false; el.click(); return true;
  })()`);

const results = [];
const check = (n, ok, d) => results.push([n, ok, d]);

// The app boots onto Welcome (图1). Reach the dashboard the way a customer does.
// `titlebar-page` exists on both screens, so the welcome heading is what
// actually distinguishes them. A leftover 内容与更新中心 modal is closed first:
// it is a full-width shell, so a stale one leaves the sidebar unclickable.
await waitFor(`document.body && document.body.innerText.length > 0`);
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '关闭详情 (Esc)' || (b.innerText || '').trim() === '✕');
  if (btn) { btn.click(); return true } return false
})()`);
await wait(1200);
if (await evaluate(`!!document.querySelector('[data-testid="welcome-heading"]')`)) {
  await clickText("检查电脑环境");
  await waitFor(`!document.querySelector('[data-testid="welcome-heading"]')`);
}
const nav = await clickText("版本与激活");
check("sidebar item 版本与激活 is clickable", nav === true);
await waitFor(`!!document.querySelector('[data-testid="license-heading"]')`);

// innerText is uppercased by CSS on this heading, so the comparison is
// case-insensitive — matching the rendered string exactly would be asserting
// the stylesheet rather than the product.
const heading = await evaluate(
  `document.querySelector('[data-testid="license-heading"]')?.innerText.trim() ?? null`,
);
check(
  "licence heading names the activated product",
  (heading || "").toLowerCase() === "setup center professional",
  String(heading),
);

check("PRO state panel renders", (await evaluate(`!!document.querySelector('[data-testid="license-pro-state"]')`)) === true);
check("device-mismatch panel is absent", (await evaluate(`!!document.querySelector('[data-testid="license-mismatch"]')`)) === false);

const text = String(await evaluate("document.body.innerText"));
check("scope list marks install as 已授权", text.includes("已授权，可自动下载并安装"));
check("scope list marks configuration as 已授权", text.includes("已授权，可初始化环境与配置文件"));
check("the local-only honesty line is present", text.includes("本版本不联网校验授权"));
check("the activated device block is shown", text.includes("设备绑定") && text.includes("激活时间"));
check("no 应用程序本体 anywhere on the licence section", !text.includes("应用程序本体"));
check("no App Release wording anywhere on the licence section", !text.includes("App Release"));

const badge = await evaluate(`(() => {
  const el = document.querySelector('[data-testid="version-badge"]');
  return el ? { t: el.innerText.trim(), tier: el.dataset.tier, state: el.dataset.state } : null;
})()`);
check("top badge shows PRO / active", badge?.tier === "pro" && badge?.state === "active", JSON.stringify(badge));

let failed = 0;
console.log("");
for (const [n, ok, d] of results) { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  → ${d}` : ""}`); if (!ok) failed++; }
console.log(`\n${results.length - failed}/${results.length} licence-section assertions passed`);
ws.close();
process.exit(failed ? 1 : 0);
