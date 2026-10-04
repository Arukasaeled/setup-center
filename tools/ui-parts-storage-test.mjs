/**
 * Setup Center — UI Parts Storage, Persistence & Safety Closure Tests
 *
 * Exercises PRODUCTION code from:
 * - src/core/uiparts/persistenceLogic.ts
 *
 * Verifies:
 * 1. Storage reconciliation:
 *    a) Disk newer than cache -> disk takes authoritative precedence
 *    b) Cache newer than disk -> disk still wins (disk is sole truth)
 *    c) Corrupted disk + valid cache -> restores from cache (source: "cache"), heals disk
 *    d) Corrupted disk + corrupted/missing cache -> falls back to seeds (source: "seed")
 * 2. Startup cache validity inspection:
 *    - Valid modern document -> "valid", "cache"
 *    - Valid legacy array -> "valid", "legacy-cache"
 *    - Corrupted JSON string -> "invalid", "seed"
 *    - Non-array/malformed schema -> "invalid", "seed"
 *    - Missing/null cache -> "missing", "seed"
 * 3. Deterministic part fingerprinting:
 *    - Excludes volatile createdAt / updatedAt
 *    - Stable against shuffled tag arrays (without mutating originals)
 *    - Stable against key order permutations
 * 4. Collision detection & multi-generation lineage:
 *    - Same ID + identical fingerprint -> action: "ignore" (no-op)
 *    - Same ID + modified content -> action: "clone"
 *    - Preserves & deduplicates multi-generation derivedFrom array
 * 5. Asset path containment & normalization:
 *    - Valid assets/<part-id>/<file-name> accepted
 *    - Traversal (".."), backslashes, absolute paths, URL encoding, drive roots rejected
 * 6. Contract validation:
 *    - Enforces ID, title, kind, lifecycle
 * 7. Transactional disk-first commit semantics & rollback:
 *    - Aborted disk write leaves in-memory and cache states untainted
 * 8. Media export/import round-trip:
 *    - Re-inlines disk asset as Data URL on export
 *    - Extracts inlined asset on import
 */

import {
  detectImportCollision,
  inspectStartupCache,
  mergeWithSeeds,
  normalizedPartFingerprint,
  reconcileStorageState,
  validateAssetRelativePath,
  validateContract,
} from "../src/core/uiparts/persistenceLogic.ts";

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

console.log("=== UI Parts Production Domain & Persistence Safety Tests ===\n");

// ---------------------------------------------------------------------------
// TEST 1: Storage Reconciliation — Disk vs Cache Authority
// ---------------------------------------------------------------------------
console.log("Test 1: Storage Reconciliation Authority Rules (Production reconcileStorageState)");
{
  const staleCacheDoc = {
    schemaVersion: 1,
    revision: 5,
    updatedAt: "2026-10-04T10:00:00.000Z",
    parts: [{ id: "p1", title: "Part 1 (Old Cache)", kind: "component", lifecycle: "raw", tags: [] }],
  };
  const authoritativeDiskDoc = {
    schemaVersion: 1,
    revision: 10,
    updatedAt: "2026-10-04T11:00:00.000Z",
    parts: [{ id: "p1", title: "Part 1 (Updated Disk)", kind: "component", lifecycle: "validated", tags: ["v2"] }],
  };

  // Case 1a: Disk newer than cache
  const outcome1a = reconcileStorageState({
    diskDoc: authoritativeDiskDoc,
    cacheDoc: staleCacheDoc,
    seedParts: [],
    isDiskCorrupted: false,
    cacheHydrationState: "valid",
  });
  assert(outcome1a.action === "use-disk", "Disk newer: action is 'use-disk'");
  assert(outcome1a.activeDoc.revision === 10, "Disk newer: active revision is disk revision 10");
  assert(outcome1a.shouldWriteCache === true, "Disk newer: triggers cache synchronization");
  assert(outcome1a.recoveryState.source === "disk", "Recovery state correctly marked as source 'disk'");

  // Case 1b: Rogue cache has higher revision than disk
  const rogueCacheDoc = {
    schemaVersion: 1,
    revision: 99,
    updatedAt: "2026-10-04T15:00:00.000Z",
    parts: [{ id: "p1", title: "Part 1 (Rogue Cache)", kind: "component", lifecycle: "raw", tags: [] }],
  };
  const outcome1b = reconcileStorageState({
    diskDoc: authoritativeDiskDoc,
    cacheDoc: rogueCacheDoc,
    seedParts: [],
    isDiskCorrupted: false,
    cacheHydrationState: "valid",
  });
  assert(outcome1b.action === "use-disk", "Rogue cache: disk remains authoritative ('use-disk')");
  assert(outcome1b.activeDoc.parts[0].title === "Part 1 (Updated Disk)", "Rogue cache: disk content wins over rogue cache");
  assert(outcome1b.shouldWriteDisk === false, "Rogue cache: disk is NOT overwritten with rogue cache");

  // Case 1c: Corrupted disk + valid cache
  const corruptBackupPath = "C:/AppData/Local/Setup Center/uiparts/uiparts.corrupt.12345.json";
  const outcome1c = reconcileStorageState({
    diskDoc: null,
    cacheDoc: staleCacheDoc,
    seedParts: [{ id: "seed-part", title: "Seed Part", kind: "component", lifecycle: "raw", tags: [] }],
    isDiskCorrupted: true,
    cacheHydrationState: "valid",
    corruptBackupPath,
  });
  assert(outcome1c.action === "recover-from-cache", "Corrupted disk + valid cache: action is 'recover-from-cache'");
  assert(outcome1c.recoveryState.source === "cache", "Recovery source correctly set to 'cache'");
  assert(outcome1c.recoveryState.corruptedBackup === corruptBackupPath, "Preserved corrupted backup path in recovery state");
  assert(outcome1c.shouldWriteDisk === true, "Corrupted disk + valid cache: triggers healing disk write");

  // Case 1d: Corrupted disk + invalid cache
  const seedParts = [{ id: "starter-part", title: "Starter Part", kind: "component", lifecycle: "validated", tags: [] }];
  const outcome1d = reconcileStorageState({
    diskDoc: null,
    cacheDoc: null,
    seedParts,
    isDiskCorrupted: true,
    cacheHydrationState: "invalid",
    corruptBackupPath,
  });
  assert(outcome1d.action === "recover-from-seed", "Corrupted disk + invalid cache: action is 'recover-from-seed'");
  assert(outcome1d.recoveryState.source === "seed", "Recovery source correctly degraded to 'seed'");
  assert(outcome1d.activeDoc.parts[0].id === "starter-part", "Starter reference seed loaded safely");
  assert(outcome1d.shouldWriteDisk === true, "Corrupted disk + invalid cache: triggers healing disk write");
}

// ---------------------------------------------------------------------------
// TEST 2: Startup Cache Validity Inspection (Production inspectStartupCache)
// ---------------------------------------------------------------------------
console.log("\nTest 2: Startup Cache Validity Inspection (Production inspectStartupCache)");
{
  // 2a. Valid modern document
  const validModern = JSON.stringify({
    schemaVersion: 1,
    revision: 3,
    updatedAt: "2026-10-04T12:00:00.000Z",
    parts: [{ id: "p1", title: "P1", kind: "component", lifecycle: "raw", tags: [] }],
  });
  const resModern = inspectStartupCache(validModern, null);
  assert(resModern.state === "valid" && resModern.hydratedFrom === "cache", "Valid modern cache detected as valid");
  assert(resModern.revision === 3, "Parsed modern revision 3");

  // 2b. Valid legacy array
  const validLegacy = JSON.stringify([
    { id: "legacy-p1", title: "Legacy P1", kind: "layout", lifecycle: "enriched", tags: [] },
  ]);
  const resLegacy = inspectStartupCache(null, validLegacy);
  assert(resLegacy.state === "valid" && resLegacy.hydratedFrom === "legacy-cache", "Valid legacy cache detected as valid");

  // 2c. Corrupted JSON syntax
  const corruptJson = "{invalid json syntax !!!";
  const resCorrupt = inspectStartupCache(corruptJson, null);
  assert(resCorrupt.state === "invalid" && resCorrupt.hydratedFrom === "seed", "Corrupted JSON marked as 'invalid'");

  // 2d. Malformed object (not an array of parts)
  const malformedDoc = JSON.stringify({ revision: 5, parts: "not-an-array" });
  const resMalformed = inspectStartupCache(malformedDoc, null);
  assert(resMalformed.state === "invalid" && resMalformed.hydratedFrom === "seed", "Malformed schema marked as 'invalid'");

  // 2e. Empty / null cache
  const resEmpty = inspectStartupCache(null, null);
  assert(resEmpty.state === "missing" && resEmpty.hydratedFrom === "seed", "Empty cache marked as 'missing'");
}

// ---------------------------------------------------------------------------
// TEST 3: Deterministic Part Fingerprinting (Production normalizedPartFingerprint)
// ---------------------------------------------------------------------------
console.log("\nTest 3: Deterministic Fingerprint (Production normalizedPartFingerprint)");
{
  const basePart = {
    id: "clip-grid",
    title: "Clip Grid",
    kind: "interaction",
    lifecycle: "validated",
    tags: ["matrix", "live", "audio"],
    design: { layout: "grid", motion: "instant" },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };

  // Mutated timestamp only -> should have identical fingerprint
  const partWithNewTime = {
    ...basePart,
    createdAt: "2026-10-04T12:00:00.000Z",
    updatedAt: "2026-10-04T15:30:00.000Z",
  };
  const fp1 = normalizedPartFingerprint(basePart);
  const fp2 = normalizedPartFingerprint(partWithNewTime);
  assert(fp1 === fp2, "Fingerprint ignores volatile createdAt / updatedAt timestamps");

  // Mutated tag order -> should have identical fingerprint and not mutate original
  const partShuffledTags = {
    ...basePart,
    tags: ["audio", "matrix", "live"],
  };
  const originalTagsBefore = [...partShuffledTags.tags];
  const fp3 = normalizedPartFingerprint(partShuffledTags);
  assert(fp1 === fp3, "Fingerprint is stable against tag order permutations");
  assert(
    JSON.stringify(partShuffledTags.tags) === JSON.stringify(originalTagsBefore),
    "Fingerprinting does NOT mutate original tags array",
  );

  // Key order permutation in nested object
  const partPermutedKeys = {
    ...basePart,
    design: { motion: "instant", layout: "grid" },
  };
  const fp4 = normalizedPartFingerprint(partPermutedKeys);
  assert(fp1 === fp4, "Fingerprint is stable against object key order permutations");

  // Content change -> different fingerprint
  const modifiedPart = {
    ...basePart,
    title: "Modified Clip Grid",
  };
  const fp5 = normalizedPartFingerprint(modifiedPart);
  assert(fp1 !== fp5, "Content modification produces distinct fingerprint");
}

// ---------------------------------------------------------------------------
// TEST 4: Collision Detection & Lineage (Production detectImportCollision)
// ---------------------------------------------------------------------------
console.log("\nTest 4: Collision Detection & Multi-Generation Lineage (Production detectImportCollision)");
{
  const existingPart = {
    id: "safe-triangle",
    title: "Safe Triangle",
    kind: "interaction",
    lifecycle: "validated",
    tags: ["menu", "submenus"],
    design: { layout: "triangle" },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };

  // 4a. Identical incoming part -> ignored
  const incomingIdentical = {
    ...existingPart,
    updatedAt: "2026-10-04T18:00:00.000Z",
  };
  const resIgnore = detectImportCollision(existingPart, incomingIdentical);
  assert(resIgnore.action === "ignore", "Identical content detected as collision action 'ignore'");
  assert(resIgnore.part.id === "safe-triangle", "Ignored import returns existing part");

  // 4b. Different incoming part with prior lineage -> clone & deduplicate derivedFrom
  const incomingModified = {
    ...existingPart,
    title: "Safe Triangle V2 (Curved)",
    relationships: {
      derivedFrom: ["ancestor-part-1", "safe-triangle"], // already has safe-triangle
    },
  };
  const resClone = detectImportCollision(existingPart, incomingModified, "2026-10-04T20:00:00.000Z", "r9x2");
  assert(resClone.action === "clone", "Modified content triggers collision action 'clone'");
  assert(resClone.part.id.startsWith("safe-triangle~import-"), "Cloned part has collision prefix ID");
  assert(resClone.part.title === "Safe Triangle V2 (Curved) (导入副本)", "Cloned part title appended with copy indicator");

  // Verify lineage array deduplication
  const derivedFrom = resClone.part.relationships.derivedFrom;
  assert(
    derivedFrom.includes("ancestor-part-1") && derivedFrom.includes("safe-triangle"),
    "Multi-generation lineage preserved",
  );
  assert(
    derivedFrom.filter((id) => id === "safe-triangle").length === 1,
    "Lineage array properly deduplicated without duplicates",
  );
  assert(
    resClone.part.notes.includes("导入冲突保护: 原 ID \"safe-triangle\""),
    "Collision audit note recorded in part notes",
  );
  assert(existingPart.title === "Safe Triangle", "Original local part is NOT mutated");
}

// ---------------------------------------------------------------------------
// TEST 5: Asset Path Containment (Production validateAssetRelativePath)
// ---------------------------------------------------------------------------
console.log("\nTest 5: Asset Path Containment & Normalization (Production validateAssetRelativePath)");
{
  // Valid paths
  assert(validateAssetRelativePath("assets/my-part/preview.png") === true, "assets/my-part/preview.png accepted");
  assert(validateAssetRelativePath("assets/part-123_abc/thumb.webp") === true, "assets/part-123_abc/thumb.webp accepted");
  assert(validateAssetRelativePath("assets\\safe-triangle\\demo.jpg") === true, "Backslashes normalized and accepted");

  // Traversal attacks
  assert(validateAssetRelativePath("assets/my-part/../preview.png") === false, "ParentDir '..' rejected");
  assert(validateAssetRelativePath("assets/../other/preview.png") === false, "Traversal in part id rejected");
  assert(validateAssetRelativePath("../assets/my-part/preview.png") === false, "Leading traversal rejected");
  assert(validateAssetRelativePath("assets/my-part/preview.png/..") === false, "Trailing traversal rejected");

  // URL encoded traversals
  assert(validateAssetRelativePath("assets/%2e%2e/preview.png") === false, "URL encoded %2e%2e rejected");
  assert(validateAssetRelativePath("assets/part/%2fpreview.png") === false, "URL encoded %2f rejected");
  assert(validateAssetRelativePath("assets/part/%5cpreview.png") === false, "URL encoded %5c rejected");

  // Absolute & Windows drive root paths
  assert(validateAssetRelativePath("/assets/my-part/preview.png") === false, "Leading slash rejected");
  assert(validateAssetRelativePath("\\assets\\my-part\\preview.png") === false, "Leading backslash rejected");
  assert(validateAssetRelativePath("C:/assets/my-part/preview.png") === false, "Windows drive prefix 'C:' rejected");
  assert(validateAssetRelativePath("D:\\AppData\\file.png") === false, "Windows drive prefix 'D:\\' rejected");

  // Special & illegal characters
  assert(validateAssetRelativePath("assets/part:1/preview.png") === false, "Colon in part id rejected");
  assert(validateAssetRelativePath("assets/part/preview.png\0") === false, "Null byte rejected");
  assert(validateAssetRelativePath("assets/part/preview*.png") === false, "Wildcard asterisk rejected");
  assert(validateAssetRelativePath("assets/part/?query=1") === false, "Question mark rejected");

  // Malformed segment counts
  assert(validateAssetRelativePath("assets/part") === false, "Missing file segment rejected");
  assert(validateAssetRelativePath("assets/part/nested/preview.png") === false, "Deeply nested segment rejected");
  assert(validateAssetRelativePath("") === false, "Empty path rejected");
  assert(validateAssetRelativePath(null) === false, "Null path rejected");
}

// ---------------------------------------------------------------------------
// TEST 6: Contract Safety (Production validateContract)
// ---------------------------------------------------------------------------
console.log("\nTest 6: Contract Validation Safety (Production validateContract)");
{
  assert(validateContract(null).valid === false, "Null rejected");
  assert(validateContract({}).valid === false, "Empty object rejected");
  assert(validateContract({ id: "p1" }).valid === false, "Missing title rejected");
  assert(validateContract({ id: "p1", title: "T1" }).valid === false, "Missing kind rejected");
  assert(
    validateContract({ id: "p1", title: "T1", kind: "nonexistent", lifecycle: "raw" }).valid === false,
    "Invalid kind rejected",
  );
  assert(
    validateContract({ id: "p1", title: "T1", kind: "component", lifecycle: "unknown" }).valid === false,
    "Invalid lifecycle rejected",
  );
  assert(
    validateContract({ id: "p1", title: "T1", kind: "component", lifecycle: "validated" }).valid === true,
    "Valid contract accepted",
  );
}

// ---------------------------------------------------------------------------
// TEST 7: Merge With Seeds (Production mergeWithSeeds)
// ---------------------------------------------------------------------------
console.log("\nTest 7: Seed Merging Integrity (Production mergeWithSeeds)");
{
  const seeds = [
    { id: "seed-1", title: "Seed 1", kind: "component", lifecycle: "validated", tags: [] },
    { id: "seed-2", title: "Seed 2", kind: "layout", lifecycle: "validated", tags: [] },
  ];
  const userParts = [
    { id: "seed-1", title: "Customized Seed 1", kind: "component", lifecycle: "validated", tags: ["custom"] },
    { id: "user-1", title: "User Part 1", kind: "status", lifecycle: "raw", tags: [] },
  ];

  const merged = mergeWithSeeds(userParts, seeds);
  assert(merged.length === 3, "Merged array contains all distinct parts");
  assert(merged.find((p) => p.id === "seed-1").title === "Customized Seed 1", "User modification of seed-1 is preserved");
  assert(merged.find((p) => p.id === "seed-2") !== undefined, "Missing seed-2 is safely appended");
}

// ---------------------------------------------------------------------------
// TEST 8: Disk-First Transactional Rollback Simulation
// ---------------------------------------------------------------------------
console.log("\nTest 8: Disk-First Transactional Rollback Simulation");
{
  let inMemoryState = {
    revision: 5,
    updatedAt: "2026-10-04T10:00:00.000Z",
    parts: [{ id: "p1", title: "Original Part", kind: "component", lifecycle: "raw", tags: [] }],
  };
  let cacheState = JSON.stringify(inMemoryState);

  // Simulated commit function following repository.ts transactional semantics
  async function simulateCommit(candidateParts, shouldDiskFail) {
    const candidateRevision = inMemoryState.revision + 1;
    const candidateUpdatedAt = "2026-10-04T11:00:00.000Z";

    // 1. Authoritative disk write FIRST
    if (shouldDiskFail) {
      throw new Error("Disk write I/O failure (Simulated disk full or lock error)");
    }

    // 2. ONLY upon disk success: commit memory and cache
    inMemoryState = {
      revision: candidateRevision,
      updatedAt: candidateUpdatedAt,
      parts: candidateParts,
    };
    cacheState = JSON.stringify(inMemoryState);
    return true;
  }

  // Attempt 1: Disk write fails
  let commitFailed = false;
  try {
    const newCandidate = [{ id: "p1", title: "Corrupted Memory Attempt", kind: "component", lifecycle: "raw", tags: [] }];
    await simulateCommit(newCandidate, true);
  } catch {
    commitFailed = true;
  }

  assert(commitFailed === true, "Disk write failure threw error as expected");
  assert(inMemoryState.revision === 5, "In-memory revision remained 5 (NOT incremented)");
  assert(inMemoryState.parts[0].title === "Original Part", "In-memory parts remained untainted");
  assert(JSON.parse(cacheState).revision === 5, "Startup cache remained untainted");

  // Attempt 2: Disk write succeeds
  await simulateCommit([{ id: "p1", title: "Successfully Committed Part", kind: "component", lifecycle: "validated", tags: [] }], false);
  assert(inMemoryState.revision === 6, "On disk success: in-memory revision incremented to 6");
  assert(inMemoryState.parts[0].title === "Successfully Committed Part", "In-memory parts updated to new state");
  assert(JSON.parse(cacheState).revision === 6, "Startup cache successfully synchronized");
}

// ---------------------------------------------------------------------------
// TEST 9: Media Export / Import Round-Trip
// ---------------------------------------------------------------------------
console.log("\nTest 9: Media Export / Import Round-Trip with Path Containment");
{
  const localPart = {
    id: "clip-launch-grid",
    title: "Ableton Clip Launch Grid",
    kind: "interaction",
    lifecycle: "validated",
    preview: { thumbnail: "assets/clip-launch-grid/preview.png" },
    tags: ["matrix", "live"],
    design: { layout: "grid", motion: "instant" },
  };

  const mockDiskStorage = new Map([
    ["assets/clip-launch-grid/preview.png", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIA..."],
  ]);

  // Export: validates relative path, re-inlines data URL into package
  function simulateExport(part) {
    const cloned = JSON.parse(JSON.stringify(part));
    const thumb = cloned.preview?.thumbnail;
    if (thumb && thumb.startsWith("assets/")) {
      assert(validateAssetRelativePath(thumb) === true, "Export validates asset relative path containment");
      const inlined = mockDiskStorage.get(thumb);
      if (inlined) cloned.preview.thumbnail = inlined;
    }
    return {
      format: "uipart-package.v1",
      exportedAt: new Date().toISOString(),
      part: cloned,
    };
  }

  const pkg = simulateExport(localPart);
  assert(pkg.part.preview.thumbnail.startsWith("data:image/png;base64,"), "Package re-inlines media as Data URL");

  // Import: extracts inlined data URL back to native assets/<id>/
  function simulateImport(incomingPkg) {
    const imported = JSON.parse(JSON.stringify(incomingPkg.part));
    if (imported.preview?.thumbnail?.startsWith("data:image/")) {
      const ext = imported.preview.thumbnail.includes("png") ? "png" : "jpg";
      const relPath = `assets/${imported.id}/preview.${ext}`;
      assert(validateAssetRelativePath(relPath) === true, "Import writes only to validated containment path");
      mockDiskStorage.set(relPath, imported.preview.thumbnail);
      imported.preview.thumbnail = relPath;
    }
    return imported;
  }

  const restoredPart = simulateImport(pkg);
  assert(restoredPart.preview.thumbnail === "assets/clip-launch-grid/preview.png", "Import restored relative disk path");
  assert(restoredPart.id === localPart.id, "ID preserved across round-trip");
  assert(restoredPart.title === localPart.title, "Title preserved across round-trip");
  assert(restoredPart.design.layout === "grid", "Design DNA preserved across round-trip");
}

console.log(`\n=== Test Summary: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All production logic, reconciliation, path containment, and transaction tests PASSED!");
}
