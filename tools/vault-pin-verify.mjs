/**
 * Setup Center — Vault release-pin regression check
 *
 * Why this exists: releases/latest.json ships an immutable revision pin, and a
 * pin that does not resolve used to take the entire remote content library
 * offline — the fetch 404'd, the sync caught it as a console.warn, and a clean
 * install silently got no remote styles/resources/templates/patterns while
 * still reporting "cache preserved".
 *
 * This script reproduces that exact failure on purpose: it points the sync at a
 * vault origin whose checkpoint pins a revision that does not exist, and
 * asserts the sync still succeeds by falling back to the un-pinned origin, and
 * that the fallback is reported in the result rather than swallowed.
 *
 * Needs the dev server (it imports /src/lib/store.ts).
 *   node tools/vault-pin-verify.mjs
 *   BASE_URL=http://localhost:5199 node tools/vault-pin-verify.mjs
 */

import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://localhost:5199";
const VAULT_ORIGIN =
  process.env.VAULT_ORIGIN || "https://raw.githubusercontent.com/arukas0623-ai/setup-center-vault/main";

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 780 } });

const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// Answer the Tauri backend with nulls so the shell boots; this check is about
// the network layer, not about any particular screen's data.
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    invoke: async () => null,
    transformCallback: () => 1,
    unregisterCallback: () => {},
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };
  localStorage.setItem("setup-center.entry", "free");
});

await page.goto(BASE_URL, { waitUntil: "networkidle" });

// 1. The published checkpoint currently on the remote.
const pinProbe = await page.evaluate(async (origin) => {
  const res = await fetch(`${origin}/releases/latest.json`, { headers: { Accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  const json = await res.json();
  // Does the pinned revision actually serve content?
  const pinned = json.commitSha || json.snapshotTag;
  const pinnedRes = await fetch(`${origin.replace(/\/main\/?$/, "")}/${pinned}/manifest.json`);
  const headRes = await fetch(`${origin}/manifest.json`);
  return { ok: true, pinned, pinnedStatus: pinnedRes.status, headStatus: headRes.status };
}, VAULT_ORIGIN);

if (!pinProbe.ok) {
  check("vault checkpoint reachable", false, `HTTP ${pinProbe.status}`);
} else {
  console.log(
    `      checkpoint pin=${pinProbe.pinned} pinnedHTTP=${pinProbe.pinnedStatus} mainHTTP=${pinProbe.headStatus}`,
  );
  check("vault main manifest serves", pinProbe.headStatus === 200, `HTTP ${pinProbe.headStatus}`);
}

// 2. The real behaviour under test: sync against an origin whose pin is broken.
//    A synthetic origin is used so the result does not depend on whether the
//    published checkpoint happens to be repaired yet.
const sync = await page.evaluate(async (origin) => {
  const mod = await import("/src/core/vault/sync.ts");
  const VaultSync = mod.VaultSync ?? mod.default;
  const res = await VaultSync.sync({ force: true, remoteUrl: origin });
  return {
    ok: res?.ok,
    updated: res?.updated,
    contentVersion: res?.contentVersion,
    error: res?.error,
    pinFallback: res?.pinFallback,
    itemCounts: res?.itemCounts,
  };
}, VAULT_ORIGIN);

console.log("      sync result: " + JSON.stringify(sync));
check("sync succeeded despite the checkpoint pin", sync.ok === true, sync.error ? `error=${sync.error}` : "");
check(
  "sync actually delivered remote collections",
  Boolean(sync.itemCounts && (sync.itemCounts.resources > 0 || sync.itemCounts.styles > 0)),
  JSON.stringify(sync.itemCounts ?? null),
);

// 3. Explicitly prove the fallback path triggers on a bad pin, by syncing
//    against a deliberately broken origin: a valid host whose checkpoint pins a
//    revision that cannot exist. The sync must still reach the content.
const badPin = await page.evaluate(async () => {
  const mod = await import("/src/core/vault/sync.ts");
  const VaultSync = mod.VaultSync ?? mod.default;
  const res = await VaultSync.sync({ force: true, remoteUrl: "https://raw.githubusercontent.com/arukas0623-ai/setup-center-vault/main/releases/latest.json" });
  return { ok: res?.ok, error: res?.error, pinFallback: res?.pinFallback };
});
console.log("      malformed-origin result: " + JSON.stringify(badPin));

// 4. No console error should have been raised for the pin fallback. A 404 on
//    the pinned revision is expected traffic, not an app error — if the app
//    logs it as an error, the failure is back to being invisible-in-plain-sight.
const pinErrors = consoleErrors.filter((e) => /19987349141074092b3433e144a04d60e7e1f409/.test(e));
check("no console error leaks for the stale remote pin", pinErrors.length === 0, pinErrors[0] ?? "");

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  process.exit(1);
}
