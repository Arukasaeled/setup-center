#!/usr/bin/env node
/**
 * Setup Center — UI Parts Prototype Standalone Smoke Check
 *
 * Verifies that standalone UI Part assets, contracts, tokens, and code exports
 * can be consumed, parsed, and executed without broken references.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

console.log("=== UI Parts Prototype Smoke Check ===");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// 1. Check research prototype directories
const parts = ["clip-launch-grid", "safe-triangle", "persistent-statusline"];

for (const part of parts) {
  console.log(`\nChecking part: ${part}`);
  const partDir = path.join(projectRoot, "research/ui-parts", part);
  assert(fs.existsSync(partDir), `Directory exists: ${part}`);

  // Check part.json
  const partJsonPath = path.join(partDir, "part.json");
  assert(fs.existsSync(partJsonPath), `part.json exists`);
  try {
    const json = JSON.parse(fs.readFileSync(partJsonPath, "utf-8"));
    assert(Boolean(json.id && json.name && json.kind), `part.json has id, name, kind`);
    assert(Boolean(json.portablePrinciple && json.portablePrinciple.rule), `part.json has portablePrinciple`);
    assert(Boolean(json.evidence && json.evidence.structure), `part.json has structured evidence`);
  } catch (err) {
    assert(false, `part.json parses as valid JSON: ${err.message}`);
  }

  // Check exports
  const exportDir = path.join(partDir, "export");
  assert(fs.existsSync(exportDir), `export directory exists`);

  const componentPath = path.join(exportDir, "component.tsx");
  assert(fs.existsSync(componentPath) && fs.statSync(componentPath).size > 200, `export/component.tsx is non-empty`);

  const tokensPath = path.join(exportDir, "tokens.json");
  assert(fs.existsSync(tokensPath), `export/tokens.json exists`);
  try {
    const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf-8"));
    assert(typeof tokens === "object", `export/tokens.json parses as valid JSON`);
  } catch (err) {
    assert(false, `tokens.json parses as valid JSON: ${err.message}`);
  }

  if (part === "safe-triangle") {
    const hookPath = path.join(exportDir, "useSafeTriangle.ts");
    assert(fs.existsSync(hookPath) && fs.statSync(hookPath).size > 200, `export/useSafeTriangle.ts exists and is non-empty`);
  }

  const briefPath = path.join(exportDir, "agent-brief.md");
  assert(fs.existsSync(briefPath) && fs.statSync(briefPath).size > 100, `export/agent-brief.md exists`);
}

// 2. Check formal seed data in src/core/uiparts/seedData.ts
console.log("\nChecking core seed data (src/core/uiparts/seedData.ts)...");
const seedDataPath = path.join(projectRoot, "src/core/uiparts/seedData.ts");
assert(fs.existsSync(seedDataPath), "seedData.ts exists");

try {
  const content = fs.readFileSync(seedDataPath, "utf-8");
  assert(content.includes('id": "clip-launch-grid"'), "seed contains clip-launch-grid");
  assert(content.includes('id": "safe-triangle"'), "seed contains safe-triangle");
  assert(content.includes('id": "persistent-statusline"'), "seed contains persistent-statusline");
  assert(content.includes('maxVerticalSpread'), "safe-triangle records maxVerticalSpread parameter");
  assert(content.includes('expires'), "persistent-statusline records absolute expiry timestamp");
} catch (err) {
  assert(false, `Failed reading seedData.ts: ${err.message}`);
}

// 3. Check types in src/core/uiparts/types.ts
console.log("\nChecking types contract (src/core/uiparts/types.ts)...");
const typesPath = path.join(projectRoot, "src/core/uiparts/types.ts");
assert(fs.existsSync(typesPath), "types.ts exists");
const typesContent = fs.readFileSync(typesPath, "utf-8");
assert(typesContent.includes('export type UIPartLifecycle = "raw" | "enriched" | "prototyped" | "validated"'), "Lifecycle includes raw, enriched, prototyped, validated");
assert(typesContent.includes('export interface UIPartPackage'), "UIPartPackage defined");

console.log(`\nSmoke Check Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All standalone UI Parts assets are smoke check green!");
}
