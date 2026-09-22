// Full-500 licence verification loop — requirement 6 of the t5 release suite.
//
// Why this is a separate script and not part of the JS UI harnesses: verifying
// "all 500 historical codes still validate" is NOT a browser test. It must
// exercise the REAL Rust checksum against the REAL ledger. A JS reimplementation
// of the checksum would agree with itself and prove nothing about the Rust
// algorithm -- it could not fail for the right reason. Approved by the captain
// as the stated rule for requirement 6.
//
// Method: parse every code out of the 10 plaintext export pages, then drive the
// prebuilt `license_admin.exe verify` once per code and assert ACCEPTANCE for
// all 500. Any single rejection fails the run.
//
// Run: node tools/license-500-verify.mjs
//      node tools/license-500-verify.mjs --from 1 --to 500     (partial range)

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "_tmp");
mkdirSync(outDir, { recursive: true });

const DEVKIT = "D:\\license-export\\开发端\\SetupCenter-DevKit";
// Overridable so the suite can be pointed at a deliberately always-accept tool
// to prove the negative control actually bites. A self-test that cannot fail is
// not a test -- see the teeth check in the `_tmp` diagnostic.
const ADMIN = process.env.LICENSE_ADMIN_EXE || join(DEVKIT, "license_admin.exe");
const EXPORT_DIR = process.env.LICENSE_EXPORT_DIR || "D:\\license-export";

// --- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const FROM = argOf("--from", 1);
const TO = argOf("--to", 500);

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

// --- 1. Collect the 500 codes from the export pages --------------------------
if (!existsSync(ADMIN)) {
  console.error(`license_admin.exe not found at ${ADMIN}`);
  process.exit(1);
}

const pages = readdirSync(EXPORT_DIR)
  .filter((f) => /^codes_export_\d+_p\d+\.txt$/.test(f))
  .sort();

const codes = new Map(); // id -> code
for (const page of pages) {
  for (const line of readFileSync(join(EXPORT_DIR, page), "utf8").split(/\r?\n/)) {
    // Format: "001 SC-ZKDW4-3108S-VRSD3-T600V"
    const m = line.match(/^\s*(\d{3,4})\s+(SC-[A-Z0-9-]+)\s*$/);
    if (m) codes.set(Number(m[1]), m[2]);
  }
}

check("export pages found (expect 10)", pages.length === 10, `found ${pages.length}`);
check("distinct codes parsed (expect 500)", codes.size === 500, `parsed ${codes.size}`);
check(
  "id range is contiguous 001..500",
  codes.size === 500 && Math.min(...codes.keys()) === 1 && Math.max(...codes.keys()) === 500,
  `min=${Math.min(...codes.keys())} max=${Math.max(...codes.keys())}`,
);

// --- 2. Verify each code through the real Rust tool -------------------------
function verifyOne(code) {
  let out;
  try {
    // `.cmd`/`.bat` cannot be spawned directly by execFileSync on Windows
    // (EINVAL), so route through the shell when the target is a script. The real
    // `license_admin.exe` needs no shell, but the teeth-test fake does.
    const isScript = /\.(cmd|bat)$/i.test(ADMIN);
    out = execFileSync(isScript ? process.env.ComSpec || "cmd.exe" : ADMIN,
      isScript ? ["/c", ADMIN, "verify", code] : ["verify", code],
      { encoding: "utf8", timeout: 20000, windowsHide: true });
  } catch (err) {
    return { ok: false, why: `spawn/exit error: ${err.message}` };
  }
  // The tool prints "valid      : yes -- ..." on acceptance and a localized
  // NO message on rejection. Match the affirmative token, not the absence of a
  // negative one: a crashed tool printing nothing must not read as a pass.
  if (/^\s*valid\s*:\s*yes/m.test(out)) return { ok: true, out };
  const why =
    (out.match(/^\s*valid\s*:\s*(.+)$/m) || [, "no 'valid:' line in output"])[1].trim();
  return { ok: false, why, out };
}

const ids = [...codes.keys()].sort((a, b) => a - b).filter((id) => id >= FROM && id <= TO);
console.log(`\nverifying ${ids.length} codes (${FROM}..${TO}) via license_admin.exe...\n`);

const failures = [];
let verified = 0;
const started = Date.now();

for (const id of ids) {
  const code = codes.get(id);
  const r = verifyOne(code);
  if (r.ok) {
    verified++;
  } else {
    failures.push({ id, code, why: r.why });
    console.log(`FAIL  #${String(id).padStart(3, "0")} ${code} -- ${r.why}`);
  }
  if (id % 50 === 0 || id === ids[ids.length - 1]) {
    console.log(`  ... ${verified}/${verified + failures.length} verified (through #${id})`);
  }
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);

// --- 3. Assertions -----------------------------------------------------------
check(
  `all ${ids.length} codes in range validate against the real Rust checksum`,
  failures.length === 0,
  `${verified}/${ids.length} accepted, ${failures.length} rejected, ${elapsed}s`,
);

// A negative control, so a tool that accepts everything cannot produce a pass.
// Without this, a `verify` that always printed "yes" would make assertion 1
// vacuous -- the exact failure mode this suite exists to prevent.
{
  const good = codes.get(ids[0]);
  const tampered = good.slice(0, -1) + (good.endsWith("X") ? "Y" : "X");
  const r = verifyOne(tampered);
  check(
    "negative control: a tampered code is REJECTED",
    !r.ok,
    r.ok ? `accepted a tampered code (${tampered}) -- verify is not discriminating` : r.why,
  );
}

// --- 4. Report ---------------------------------------------------------------
const failed = results.filter((r) => !r.passed);
if (failures.length) {
  console.log("\nrejected codes:");
  for (const f of failures.slice(0, 20)) console.log(`  #${f.id} ${f.code} -- ${f.why}`);
  if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
}

const report = [
  `# Full-500 licence verification`,
  ``,
  `Date: ${new Date().toISOString()}`,
  `Range: ${FROM}..${TO} (${ids.length} codes)`,
  `Tool: ${ADMIN}`,
  `Ledger: ${join(DEVKIT, "license_inventory.csv")}`,
  `Source: ${EXPORT_DIR}\\codes_export_20260921_p01..p10.txt`,
  ``,
  `Accepted: ${verified}`,
  `Rejected: ${failures.length}`,
  `Elapsed : ${elapsed}s`,
  ``,
  ...(failures.length
    ? [`## Rejected`, ...failures.map((f) => `- #${f.id} \`${f.code}\` -- ${f.why}`)]
    : [`Result: **all ${ids.length} codes accepted** against the real Rust checksum.`]),
  ``,
  `Negative control: tampered code rejected = ${!results[3].passed === false}`,
].join("\n");
writeFileSync(join(outDir, "license-500-verify.md"), report);

console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`report: _tmp/license-500-verify.md`);
process.exit(failed.length ? 1 : 0);
