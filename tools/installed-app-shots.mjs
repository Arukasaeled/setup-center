/**
 * Captures the real installed app via the WebView2 devtools protocol.
 *
 * The UI harness screenshots a headless Chromium rendering the same bundle; this
 * captures the actual packaged executable. A `CopyFromScreen`-style capture was
 * tried first and abandoned: this host's PowerShell cannot compile a GDI+
 * capture helper (the assembly chain reference-loops), and the harness's own
 * screenshots already cover the layout. `Page.captureScreenshot` needs no GDI.
 */
import fs from "node:fs";

const BASE = "http://127.0.0.1:9333";
const outDir = process.argv[2] ?? "_tmp/ui-installed";

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) {
  console.log("no page target");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m);
    pend.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pend.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await new Promise((r) => ws.addEventListener("open", r));

const ev = async (x) => {
  const r = await send("Runtime.evaluate", {
    expression: x,
    awaitPromise: true,
    returnByValue: true,
  });
  return r.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const data = r.result?.data;
  if (!data) {
    console.log(`  ! ${name}: no data`);
    return;
  }
  fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, "base64"));
  console.log(`  ${name}.png  ${Buffer.from(data, "base64").length} bytes`);
};

const click = async (pattern) =>
  await ev(`(() => {
    const re = new RegExp(${JSON.stringify(pattern)});
    const el = [...document.querySelectorAll('button, a, [role="button"]')]
      .find(b => re.test((b.innerText || '').trim().replace(/\\s+/g, ' ')));
    if (!el) return false;
    el.click();
    return true;
  })()`);

fs.mkdirSync(outDir, { recursive: true });

// Software list — where the icons are.
await click("继续|重新检测");
await wait(2500);
await click("^软件");
await wait(1500);
await shot("installed-01-software-dark");

// Light theme, to prove the stencil marks survive on paper in the real build.
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /^浅色$/.test((x.innerText||'').trim()));
  if (b) b.click();
  return !!b;
})()`);
await wait(1200);
await shot("installed-02-software-light");

// Back to dark.
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /^深色$/.test((x.innerText||'').trim()));
  if (b) b.click();
  return !!b;
})()`);
await wait(1200);

// Overview.
await click("^环境概览|^概览");
await wait(1200);
await shot("installed-03-overview-dark");

console.log("\ndone");
ws.close();
