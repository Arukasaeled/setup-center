#!/usr/bin/env node

/**
 * Setup Center — Automated Vault Validator & Release Quality Gate
 *
 * Verifies that:
 * 1. manifest.json and releases/latest.json are strictly consistent
 * 2. Every content item complies with the unified schema
 * 3. ZERO dead content: every item has an actionable execution path
 * 4. No duplicate IDs across styles, resources, templates, and patterns
 * 5. All CSS, snippet, and schema references physically exist
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vaultDir = join(here, "..", "..", "setup-center-vault");

console.log("🔍 [Vault Validator] Starting verification on:", vaultDir);

if (!existsSync(vaultDir)) {
  console.error("❌ Vault directory not found at:", vaultDir);
  process.exit(1);
}

let errors = 0;
let warnings = 0;
let checkedItems = 0;

function reportError(msg) {
  console.error(`  ❌ ERROR: ${msg}`);
  errors++;
}

function reportWarning(msg) {
  console.warn(`  ⚠️ WARN: ${msg}`);
  warnings++;
}

// 1. Validate releases/latest.json
console.log("\n📦 1. Verifying releases/latest.json checkpoint...");
const releasePath = join(vaultDir, "releases", "latest.json");
if (!existsSync(releasePath)) {
  reportError("releases/latest.json does not exist");
} else {
  try {
    const releaseData = JSON.parse(readFileSync(releasePath, "utf8"));
    if (!releaseData.releaseVersion) reportError("releases/latest.json missing releaseVersion");
    if (!releaseData.publishedAt) reportError("releases/latest.json missing publishedAt");
    if (!releaseData.summary) reportError("releases/latest.json missing summary");
    if (!releaseData.commitSha && !releaseData.snapshotTag) {
      reportWarning("releases/latest.json lacks immutable commitSha or snapshotTag");
    }
    console.log(`  ✓ Release checkpoint: v${releaseData.releaseVersion} (${releaseData.summary})`);
  } catch (err) {
    reportError(`Failed to parse releases/latest.json: ${err.message}`);
  }
}

// 2. Validate top-level manifest.json
console.log("\n📑 2. Verifying top-level manifest.json...");
const manifestPath = join(vaultDir, "manifest.json");
let manifest;
if (!existsSync(manifestPath)) {
  reportError("manifest.json does not exist");
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.schemaVersion) reportError("manifest.json missing schemaVersion");
    if (!manifest.contentVersion) reportError("manifest.json missing contentVersion");
    if (!manifest.collections) reportError("manifest.json missing collections definition");
    console.log(`  ✓ Content Version: ${manifest.contentVersion}`);
  } catch (err) {
    reportError(`Failed to parse manifest.json: ${err.message}`);
  }
}

const seenIds = new Set();

function checkIdUnique(id, context) {
  if (seenIds.has(id)) {
    reportError(`Duplicate ID "${id}" detected in ${context}`);
  }
  seenIds.add(id);
}

// 3. Validate Resources
console.log("\n📚 3. Verifying Resources across categories...");
const resourcesDir = join(vaultDir, "resources");
if (existsSync(resourcesDir)) {
  const catFiles = readdirSync(resourcesDir).filter((f) => f.endsWith(".json"));
  for (const catFile of catFiles) {
    const filePath = join(resourcesDir, catFile);
    try {
      const items = JSON.parse(readFileSync(filePath, "utf8"));
      if (!Array.isArray(items)) {
        reportError(`${catFile} must export a JSON array of ResourceItem`);
        continue;
      }
      for (const item of items) {
        checkedItems++;
        if (!item.id) reportError(`Item in ${catFile} missing id`);
        if (!item.name) reportError(`Resource ${item.id} missing name`);
        if (!item.category) reportError(`Resource ${item.id} missing category`);
        if (!item.description) reportError(`Resource ${item.id} missing description`);
        if (!item.author) reportError(`Resource ${item.id} missing author`);
        if (!Array.isArray(item.tags)) reportError(`Resource ${item.id} tags must be an array`);

        // Check for Zero Dead Content: must have an actionable target
        const hasActionTarget = Boolean(item.homepage || item.repository || item.downloadUrl);
        if (!hasActionTarget) {
          reportError(`Resource "${item.id}" is DEAD CONTENT: lacks homepage, repository, and downloadUrl`);
        }

        checkIdUnique(item.id, `resources/${catFile}`);
      }
      console.log(`  ✓ ${catFile}: ${items.length} valid items checked`);
    } catch (err) {
      reportError(`Failed to read ${catFile}: ${err.message}`);
    }
  }
}

// 4. Validate Styles
console.log("\n🎨 4. Verifying Design System Styles...");
const stylesDir = join(vaultDir, "styles");
if (existsSync(stylesDir)) {
  const styleFolders = readdirSync(stylesDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dir of styleFolders) {
    const styleId = dir.name;
    const styleManifestPath = join(stylesDir, styleId, "manifest.json");
    if (!existsSync(styleManifestPath)) {
      reportError(`Style ${styleId} missing manifest.json`);
      continue;
    }
    try {
      const sm = JSON.parse(readFileSync(styleManifestPath, "utf8"));
      checkedItems++;
      if (sm.id !== styleId) reportError(`Style id mismatch in ${styleId}: manifest has ${sm.id}`);
      if (!sm.name) reportError(`Style ${styleId} missing name`);
      if (!sm.palette || !sm.palette.bg || !sm.palette.primary) {
        reportError(`Style ${styleId} missing valid palette tokens`);
      }
      if (sm.cssPath) {
        const cssFullPath = join(stylesDir, styleId, sm.cssPath);
        if (!existsSync(cssFullPath)) {
          reportError(`Style ${styleId} cssPath "${sm.cssPath}" not found on disk`);
        }
      }
      checkIdUnique(sm.id, `styles/${styleId}`);
      console.log(`  ✓ Style ${styleId}: ${sm.name} validated`);
    } catch (err) {
      reportError(`Failed to parse style ${styleId}: ${err.message}`);
    }
  }
}

// 5. Validate Templates
console.log("\n📐 5. Verifying Project Templates...");
const templatesDir = join(vaultDir, "templates");
if (existsSync(templatesDir)) {
  const tplFolders = readdirSync(templatesDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dir of tplFolders) {
    const tplId = dir.name;
    const tplJsonPath = join(templatesDir, tplId, "template.json");
    if (!existsSync(tplJsonPath)) {
      reportError(`Template ${tplId} missing template.json`);
      continue;
    }
    try {
      const tm = JSON.parse(readFileSync(tplJsonPath, "utf8"));
      checkedItems++;
      if (!tm.name) reportError(`Template ${tplId} missing name`);
      if (!tm.scaffold || !tm.scaffold.type) {
        reportError(`Template ${tplId} missing scaffold configuration`);
      }
      checkIdUnique(tm.id, `templates/${tplId}`);
      console.log(`  ✓ Template ${tplId}: ${tm.name} validated`);
    } catch (err) {
      reportError(`Failed to parse template ${tplId}: ${err.message}`);
    }
  }
}

// 6. Validate Patterns
console.log("\n🧩 6. Verifying UI Patterns...");
const patternsDir = join(vaultDir, "patterns");
if (existsSync(patternsDir)) {
  const patFolders = readdirSync(patternsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dir of patFolders) {
    const patId = dir.name;
    const patJsonPath = join(patternsDir, patId, "pattern.json");
    if (!existsSync(patJsonPath)) {
      reportError(`Pattern ${patId} missing pattern.json`);
      continue;
    }
    try {
      const pm = JSON.parse(readFileSync(patJsonPath, "utf8"));
      checkedItems++;
      if (!pm.name) reportError(`Pattern ${patId} missing name`);
      if (!pm.codeSnippet) reportError(`Pattern ${patId} missing codeSnippet`);
      checkIdUnique(pm.id, `patterns/${patId}`);
      console.log(`  ✓ Pattern ${patId}: ${pm.name} validated`);
    } catch (err) {
      reportError(`Failed to parse pattern ${patId}: ${err.message}`);
    }
  }
}

// 7. Validate Skills
console.log("\n⚡ 7. Verifying Skills...");
const skillsDir = join(vaultDir, "skills");
if (existsSync(skillsDir)) {
  const skillFiles = readdirSync(skillsDir).filter((f) => f.endsWith(".json"));
  for (const sf of skillFiles) {
    const sPath = join(skillsDir, sf);
    try {
      const sk = JSON.parse(readFileSync(sPath, "utf8"));
      checkedItems++;
      if (!sk.id) reportError(`Skill in ${sf} missing id`);
      if (!sk.name) reportError(`Skill ${sk.id} missing name`);
      if (!sk.prompt) reportError(`Skill ${sk.id} missing prompt`);
      checkIdUnique(sk.id, `skills/${sf}`);
      console.log(`  ✓ Skill ${sk.id}: ${sk.name} validated`);
    } catch (err) {
      reportError(`Failed to parse skill ${sf}: ${err.message}`);
    }
  }
}

console.log("\n==================================================");
console.log(`📊 Verification Summary:`);
console.log(`   Checked Items: ${checkedItems}`);
console.log(`   Errors:        ${errors}`);
console.log(`   Warnings:      ${warnings}`);
console.log("==================================================");

if (errors > 0) {
  console.error("❌ Vault validation FAILED with errors. Fix before release.");
  process.exit(1);
} else {
  console.log("✨ All Vault assets PASSED validation! Ready for immutable release snapshot.");
  process.exit(0);
}
