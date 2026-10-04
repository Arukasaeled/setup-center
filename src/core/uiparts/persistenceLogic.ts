/**
 * Setup Center — UI Parts Persistence & Storage Domain Logic
 *
 * Pure, authoritative logic for:
 * 1. Asset path containment & normalization
 * 2. Deterministic part fingerprinting
 * 3. Import collision detection & multi-generation lineage tracking
 * 4. Authoritative storage reconciliation (Disk vs Cache vs Seeds)
 * 5. Startup cache validity inspection
 */

import type {
  UIPart,
  UIPartKind,
  UIPartLifecycle,
  UIPartsRecoveryState,
  UIPartsStorageDocument,
} from "./types";

export const VALID_KINDS: UIPartKind[] = [
  "component",
  "layout",
  "composition",
  "navigation",
  "interaction",
  "typography",
  "status",
  "search",
  "card",
  "data-viz",
  "motion",
  "visual-rule",
  "other",
];

export const VALID_LIFECYCLES: UIPartLifecycle[] = [
  "raw",
  "enriched",
  "prototyped",
  "validated",
];

/**
 * Validates that an object satisfies minimum contract safety.
 */
export function validateContract(data: any): { valid: boolean; error?: string } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "零件规范必须为 JSON 对象" };
  }
  if (!data.id || typeof data.id !== "string" || !data.id.trim()) {
    return { valid: false, error: "缺少必填字段: id (必须为非空字符串)" };
  }
  if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
    return { valid: false, error: "缺少必填字段: title (必须为非空字符串)" };
  }
  if (!data.kind || !VALID_KINDS.includes(data.kind)) {
    return {
      valid: false,
      error: `非法分类 kind: "${data.kind}"。合法值包括: ${VALID_KINDS.join(", ")}`,
    };
  }
  if (!data.lifecycle || !VALID_LIFECYCLES.includes(data.lifecycle)) {
    return {
      valid: false,
      error: `非法生命周期 lifecycle: "${data.lifecycle}"。合法值包括: ${VALID_LIFECYCLES.join(", ")}`,
    };
  }
  return { valid: true };
}

/** Merges user parts with seed parts so starter parts are never lost */
export function mergeWithSeeds(existing: UIPart[], seeds: UIPart[]): UIPart[] {
  const existingMap = new Map(existing.map((p) => [p.id, p]));
  const result: UIPart[] = [...existing];

  for (const seed of seeds) {
    if (!existingMap.has(seed.id)) {
      result.push(seed);
    }
  }
  return result;
}

/**
 * Validates that an asset relative path is strictly contained within assets/<part-id>/<file-name>.
 *
 * Rules:
 * - Must start with "assets/"
 * - Must match exactly: assets/<part-id>/<file-name>
 * - Neither <part-id> nor <file-name> may contain traversal (".."), ".", slashes, colons, null bytes,
 *   or URL-encoded traversal patterns (%2e, %2f, %5c).
 * - No absolute paths or drive prefixes.
 */
export function validateAssetRelativePath(relativePath: string): boolean {
  if (!relativePath || typeof relativePath !== "string") return false;

  const normalized = relativePath.trim().replace(/\\/g, "/");

  // Reject absolute paths, root indicators, or Windows drive prefixes
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("\\") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.includes("\0")
  ) {
    return false;
  }

  // Reject URL-encoded traversal attempts
  const lower = normalized.toLowerCase();
  if (lower.includes("%2e") || lower.includes("%2f") || lower.includes("%5c")) {
    return false;
  }

  // Must match format: assets/<part-id>/<file-name>
  const parts = normalized.split("/");
  if (parts.length !== 3 || parts[0] !== "assets") {
    return false;
  }

  const [_, partId, fileName] = parts;
  return isValidPathComponent(partId) && isValidPathComponent(fileName);
}

/** Validates that a path segment is safe without traversal or illegal chars */
export function isValidPathComponent(component: string): boolean {
  if (!component || typeof component !== "string") return false;
  const trimmed = component.trim();
  if (
    trimmed === "" ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes(":") ||
    trimmed.includes("?") ||
    trimmed.includes("*") ||
    trimmed.includes('"') ||
    trimmed.includes("<") ||
    trimmed.includes(">") ||
    trimmed.includes("|")
  ) {
    return false;
  }
  return true;
}

/** Recursively sorts all keys in an object for deterministic canonical serialization */
export function canonicalizeObject(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeObject(item));
  }
  if (typeof value === "object") {
    const sortedKeys = Object.keys(value).sort();
    const result: Record<string, any> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalizeObject(value[key]);
    }
    return result;
  }
  return value;
}

/**
 * Computes a deterministic canonical fingerprint for a UIPart.
 *
 * Rules:
 * - Excludes volatile metadata (updatedAt, createdAt).
 * - Sorts tags array immutably.
 * - Recursively sorts object keys.
 * - Serializes to deterministic canonical JSON string.
 */
export function normalizedPartFingerprint(part: UIPart): string {
  // Shallow copy and omit volatile attributes
  const { createdAt, updatedAt, ...rest } = part;

  const canonical: Record<string, any> = {
    ...rest,
    tags: Array.isArray(part.tags) ? [...part.tags].sort() : [],
  };

  // If thumbnail is a local file or temporary path, normalize to empty or standard pattern
  if (canonical.preview?.thumbnail) {
    const thumb = canonical.preview.thumbnail;
    if (thumb.startsWith("http://") || thumb.startsWith("https://") || thumb.startsWith("data:") || thumb.startsWith("<svg")) {
      canonical.preview = { ...canonical.preview, thumbnail: thumb };
    } else {
      // Relative asset path
      canonical.preview = { ...canonical.preview, thumbnail: thumb.replace(/\\/g, "/") };
    }
  }

  return JSON.stringify(canonicalizeObject(canonical));
}

export type CollisionResult =
  | { action: "ignore"; part: UIPart }
  | { action: "clone"; part: UIPart; originalId: string };

/**
 * Detects import collision when an incoming part has the same ID as an existing local part.
 *
 * - If identical (matching canonical fingerprint): returns { action: "ignore", part: existing }.
 * - If different: clones incoming part, generates collision-safe ID, appends existing ID to
 *   relationships.derivedFrom (multi-generation deduplicated), and records audit note.
 */
export function detectImportCollision(
  existing: UIPart,
  incoming: UIPart,
  timestamp: string = new Date().toISOString(),
  randomSuffix: string = Math.random().toString(36).substring(2, 6),
): CollisionResult {
  const existingFingerprint = normalizedPartFingerprint(existing);
  const incomingFingerprint = normalizedPartFingerprint(incoming);

  if (existingFingerprint === incomingFingerprint) {
    return {
      action: "ignore",
      part: existing,
    };
  }

  // Content conflict: clone incoming part with unique local ID
  const dateStamp = timestamp.replace(/[-:T]/g, "").slice(0, 15);
  const newId = `${incoming.id}~import-${dateStamp}-${randomSuffix}`;
  const originalId = incoming.id;

  const clonedPart: UIPart = JSON.parse(JSON.stringify(incoming));
  clonedPart.id = newId;
  clonedPart.title = `${incoming.title} (导入副本)`;

  // Multi-generation deduplicated lineage tracking
  const existingLineage = Array.isArray(incoming.relationships?.derivedFrom)
    ? incoming.relationships!.derivedFrom
    : [];
  const updatedLineage = Array.from(new Set([...existingLineage, originalId]));

  clonedPart.relationships = {
    ...(clonedPart.relationships || {}),
    derivedFrom: updatedLineage,
  };

  const collisionNote = `[导入冲突保护: 原 ID "${originalId}" 本地已存在且内容不同，已自动重命名为 "${newId}"]`;
  clonedPart.notes = incoming.notes ? `${incoming.notes}\n${collisionNote}` : collisionNote;
  clonedPart.updatedAt = timestamp;

  return {
    action: "clone",
    part: clonedPart,
    originalId,
  };
}

export interface CacheInspectionResult {
  state: "valid" | "missing" | "invalid";
  hydratedFrom: "cache" | "legacy-cache" | "seed";
  parts?: UIPart[];
  revision?: number;
  schemaVersion?: number;
  updatedAt?: string;
}

/**
 * Inspects startup cache in localStorage for validity without destructive side effects.
 */
export function inspectStartupCache(
  rawDoc: string | null,
  rawLegacy: string | null,
): CacheInspectionResult {
  if (rawDoc && rawDoc.trim()) {
    try {
      const parsed = JSON.parse(rawDoc);
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.parts) &&
        parsed.parts.length > 0 &&
        typeof parsed.revision === "number"
      ) {
        return {
          state: "valid",
          hydratedFrom: "cache",
          parts: parsed.parts,
          revision: parsed.revision,
          schemaVersion: parsed.schemaVersion || 1,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        };
      }
      return { state: "invalid", hydratedFrom: "seed" };
    } catch {
      return { state: "invalid", hydratedFrom: "seed" };
    }
  }

  if (rawLegacy && rawLegacy.trim()) {
    try {
      const parsed = JSON.parse(rawLegacy);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return {
          state: "valid",
          hydratedFrom: "legacy-cache",
          parts: parsed,
          revision: 1,
          schemaVersion: 1,
          updatedAt: new Date().toISOString(),
        };
      }
      return { state: "invalid", hydratedFrom: "seed" };
    } catch {
      return { state: "invalid", hydratedFrom: "seed" };
    }
  }

  return { state: "missing", hydratedFrom: "seed" };
}

export interface ReconciliationOutcome {
  action: "use-disk" | "recover-from-cache" | "recover-from-seed" | "init-empty";
  activeDoc: UIPartsStorageDocument;
  recoveryState: UIPartsRecoveryState;
  shouldWriteDisk: boolean;
  shouldWriteCache: boolean;
}

/**
 * Reconciles authoritative disk state with startup cache and fallback seeds.
 *
 * Golden Rules:
 * 1. Disk is authoritative: If disk has valid content, disk always wins over cache.
 * 2. Corrupted disk: Restores from cache ONLY IF cacheHydrationState === 'valid'.
 * 3. Corrupted disk + corrupted/missing cache: Restores from standard seeds (source: 'seed').
 * 4. Empty disk (first run): Writes seeds to disk and cache.
 */
export function reconcileStorageState(params: {
  diskDoc: UIPartsStorageDocument | null;
  cacheDoc: UIPartsStorageDocument | null;
  seedParts: UIPart[];
  isDiskCorrupted: boolean;
  cacheHydrationState: "valid" | "missing" | "invalid";
  corruptBackupPath?: string | null;
}): ReconciliationOutcome {
  const {
    diskDoc,
    cacheDoc,
    seedParts,
    isDiskCorrupted,
    cacheHydrationState,
    corruptBackupPath,
  } = params;

  // Case 1: Disk is corrupted
  if (isDiskCorrupted) {
    if (cacheHydrationState === "valid" && cacheDoc && cacheDoc.parts.length > 0) {
      return {
        action: "recover-from-cache",
        activeDoc: cacheDoc,
        recoveryState: {
          recovered: true,
          source: "cache",
          corruptedBackup: corruptBackupPath || undefined,
          message: `磁盘索引已损坏，已从本地高速缓存安全恢复（备份: ${corruptBackupPath || "已备份"}）`,
        },
        shouldWriteDisk: true,
        shouldWriteCache: true,
      };
    }

    // Cache is missing or invalid: recover from seed
    const seedDoc: UIPartsStorageDocument = {
      schemaVersion: 1,
      revision: 1,
      updatedAt: new Date().toISOString(),
      parts: seedParts,
    };
    return {
      action: "recover-from-seed",
      activeDoc: seedDoc,
      recoveryState: {
        recovered: true,
        source: "seed",
        corruptedBackup: corruptBackupPath || undefined,
        message: "磁盘索引与本地缓存均不可用，已安全恢复至参考标准零件集",
      },
      shouldWriteDisk: true,
      shouldWriteCache: true,
    };
  }

  // Case 2: Disk is valid -> DISK IS AUTHORITATIVE
  if (diskDoc && Array.isArray(diskDoc.parts) && diskDoc.parts.length > 0) {
    return {
      action: "use-disk",
      activeDoc: diskDoc,
      recoveryState: {
        recovered: false,
        source: "disk",
      },
      shouldWriteDisk: false,
      shouldWriteCache: true, // synchronize cache to authoritative disk
    };
  }

  // Case 3: Empty disk (First launch in Tauri)
  const initialParts =
    cacheHydrationState === "valid" && cacheDoc && cacheDoc.parts.length > 0
      ? cacheDoc.parts
      : seedParts;

  const initialDoc: UIPartsStorageDocument = {
    schemaVersion: 1,
    revision: cacheDoc?.revision || 1,
    updatedAt: new Date().toISOString(),
    parts: initialParts,
  };

  return {
    action: "init-empty",
    activeDoc: initialDoc,
    recoveryState: {
      recovered: false,
      source: "disk",
    },
    shouldWriteDisk: true,
    shouldWriteCache: true,
  };
}
