/**
 * Drives the REAL installed application through its WebView2 debugging port.
 *
 * The UI harness (`tools/ui-verify.mjs`) renders the same bundle in a headless
 * Chromium. That proves the code is right; it does not prove the *installed
 * build* is right, because a packaging mistake (a dropped asset, a stale
 * `dist/`) is invisible to it. This script closes that gap by attaching to the
 * running executable and reading what it actually displays.
 */
const BASE = "http://127.0.0.1:9333";

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) {
  console.log("FAIL  no page target in the running app");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

const send = (method, params = {}) =>
  new Promise((res) => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

await new Promise((res) => ws.addEventListener("open", res));

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails) {
    return { error: r.result.exceptionDetails.text };
  }
  return r.result?.result?.value;
};

const results = [];
const check = (name, ok, detail) => {
  results.push([name, ok, detail]);
};

// --- Navigate to a screen that actually shows icons --------------------------
//
// The app boots on the welcome screen, which has no software rows. Probing
// there would report "0 icons" and look like a catastrophic packaging failure
// when it is simply the wrong screen — which is exactly what the first run of
// this script did. Walk to the software list the way a user does, then assert.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Click the first element whose text matches, preferring an exact-ish button.
 *
 * Returns whether a click happened, so the caller can tell "already there" from
 * "the control moved and this script is now probing the wrong screen".
 */
const clickByText = async (pattern) =>
  await evaluate(`(() => {
    const re = new RegExp(${JSON.stringify(pattern)});
    const el = [...document.querySelectorAll('button, a, [role="button"]')]
      .find(b => re.test((b.innerText || '').trim().replace(/\\s+/g, ' ')));
    if (!el) return false;
    el.click();
    return true;
  })()`);

// Walk the real flow: pick nothing special, just get detection running, then
// step through to the software list where the icons live. Each hop is reported
// so a failure names the screen it got stuck on instead of silently probing an
// empty one — the mistake the first version of this script made.
const hops = [
  ["goal", "开始检测"],
  // Detection lands on a results screen whose continue control is "仍然继续".
  // These labels are read from the running app, not guessed: an earlier version
  // of this script used "继续|下一步" and silently stalled here.
  ["detect-results", "仍然继续"],
  ["installed", "继续|下一步|选择方案|重新检测"],
];

for (const [label, pattern] of hops) {
  const ok = await clickByText(pattern);
  console.log(`# hop ${label}: ${ok ? "clicked" : "no control matched"}`);
  await wait(2800);
}

// The software list may also be reachable from the sidebar once the dashboard
// is up; try that as a fallback so the probe lands somewhere with rows.
const beforeCount = await evaluate(
  'document.querySelectorAll(\'[style*="mask-image"], img[src^="data:"], img[src*="asset"]\').length',
);
if (beforeCount === 0) {
  await clickByText("^软件\\s*\\d*$");
  await wait(1500);
}

const screenText = await evaluate("document.body.innerText.slice(0, 300)");
const rowCount = await evaluate(
  'document.querySelectorAll(\'[style*="mask-image"], img[src^="data:"], img[src*="asset"]\').length',
);
console.log(`\n# screen: ${JSON.stringify(String(screenText).slice(0, 90))}`);
console.log(`# icon elements on screen: ${rowCount}\n`);

// --- Title / branding --------------------------------------------------------
const title = await evaluate("document.title");
check("installed app: window title is Setup Center", title === "Setup Center", title);

const bodyText = await evaluate("document.body.innerText");
check(
  "installed app: no old brand string anywhere on screen",
  !bodyText.includes("AI Student Setup") && !bodyText.includes("学生装机"),
);
check(
  "installed app: the product name is present",
  bodyText.includes("Setup Center"),
);

// --- Icons really rendered from bundled assets --------------------------------
const iconReport = await evaluate(`(async () => {
  const sel = 'img[src^="data:image"], img[src*="/assets/"], img[src^="asset:"], img[src*="asset.localhost"]';
  const imgs = [...document.querySelectorAll(sel)];
  const masked = [...document.querySelectorAll('[style*="mask-image"]')];
  await Promise.all(imgs.map(el => el.complete ? 0 : new Promise(r => {
    el.addEventListener('load', r, {once:true});
    el.addEventListener('error', r, {once:true});
  })));
  const broken = imgs.filter(el => el.naturalWidth === 0);
  return {
    imgs: imgs.length,
    masked: masked.length,
    broken: broken.length,
    sample: imgs.slice(0,4).map(el => el.getAttribute('src').slice(0,42)),
  };
})()`);

check(
  "installed app: icons resolve to bundled assets and load",
  iconReport && iconReport.broken === 0 && iconReport.imgs + iconReport.masked > 0,
  iconReport
    ? `${iconReport.imgs} img + ${iconReport.masked} masked, ${iconReport.broken} broken`
    : "probe failed",
);

// --- Asset integrity: the packaging mistake that started this -----------------
const assetCheck = await evaluate(`(async () => {
  // Every data: URI must actually decode to a non-empty SVG. A '?url' import
  // regression produces a dangling path, and this is what catches it after
  // packaging rather than only in the bundler.
  const svgs = [...document.querySelectorAll('img[src^="data:image/svg"]')];
  const pngs = [...document.querySelectorAll('img[src*="/assets/"], img[src^="asset:"]')];
  const ok = svgs.every(el => el.naturalWidth > 0) && pngs.every(el => el.naturalWidth > 0);
  return { svgCount: svgs.length, pngCount: pngs.length, ok };
})()`);
check(
  "installed app: every bundled logo decoded to real pixels",
  assetCheck?.ok === true,
  assetCheck ? `${assetCheck.svgCount} inline SVG + ${assetCheck.pngCount} file asset` : "n/a",
);

// --- Contrast: the mark must be visible against what it sits on ---------------
const contrast = await evaluate(`(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    const p = m[1].split(',').map(Number); return { r:p[0], g:p[1], b:p[2], a:p[3] ?? 1 }; };
  const over = (t, b) => ({ r:t.r*t.a + b.r*(1-t.a), g:t.g*t.a + b.g*(1-t.a), b:t.b*t.a + b.b*(1-t.a), a:1 });
  const canvas = parse(getComputedStyle(document.body).backgroundColor) || {r:255,g:255,b:255,a:1};
  const plate = (el) => {
    const layers = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.01) { layers.push(c); if (c.a === 1) break; }
    }
    let acc = canvas;
    for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
    return acc;
  };
  const delta = (a,b) => Math.max(Math.abs(a.r-b.r), Math.abs(a.g-b.g), Math.abs(a.b-b.b));
  const masked = [...document.querySelectorAll('[style*="mask-image"]')];
  const bad = masked.filter(el => {
    const c = parse(getComputedStyle(el).backgroundColor);
    return c && delta(c, plate(el.parentElement ?? el)) <= 24;
  });
  return { masked: masked.length, invisible: bad.length,
           plate: plate(document.body) && Math.round(plate(document.body).r) };
})()`);
check(
  "installed app: masked marks are visible against their surface",
  contrast && contrast.invisible === 0 && contrast.masked > 0,
  contrast ? `${contrast.masked} masked, ${contrast.invisible} invisible, plate r=${contrast.plate}` : "probe failed",
);

// --- Report -----------------------------------------------------------------
let failed = 0;
for (const [name, ok, detail] of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} installed-app assertions passed`);

ws.close();
process.exit(failed ? 1 : 0);
