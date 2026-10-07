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
import {
  VALID_KINDS,
  VALID_LIFECYCLES,
  VALID_SOURCE_TYPES,
  VALID_EVIDENCE_LEVELS,
  VALID_EXPORT_STATUS,
  validatePartContract,
  validateStorageDocument,
  validatePackageContract,
  deepClone,
} from "./validation";

export {
  VALID_KINDS,
  VALID_LIFECYCLES,
  VALID_SOURCE_TYPES,
  VALID_EVIDENCE_LEVELS,
  VALID_EXPORT_STATUS,
  validatePartContract,
  validateStorageDocument,
  validatePackageContract,
  deepClone,
};

export const SUPPORTED_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIMES)[number];

export const SUPPORTED_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export interface SupportedImageInfo {
  mime: SupportedImageMime;
  ext: "png" | "jpg" | "webp" | "gif";
}

/**
 * Validates and parses a Data URL against supported UI Part image formats.
 *
 * Formally supported:
 * - image/png  -> png
 * - image/jpeg -> jpg (also matches image/jpg)
 * - image/webp -> webp
 * - image/gif  -> gif
 *
 * Explicitly rejected:
 * - SVG (image/svg+xml or raw <svg) - not supported in V1 captured media
 * - Unknown image types (image/bmp, image/tiff, etc.)
 * - Malformed data URLs
 */
export function parseSupportedImageDataUrl(dataUrl?: string | null): SupportedImageInfo | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([a-zA-Z0-9+.-]+\/[a-zA-Z0-9+.-]+);base64,/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  switch (mime) {
    case "image/png":
      return { mime: "image/png", ext: "png" };
    case "image/jpeg":
    case "image/jpg":
      return { mime: "image/jpeg", ext: "jpg" };
    case "image/webp":
      return { mime: "image/webp", ext: "webp" };
    case "image/gif":
      return { mime: "image/gif", ext: "gif" };
    default:
      return null;
  }
}

/**
 * Validates that an object satisfies minimum contract safety.
 */
export function validateContract(data: any): { valid: boolean; error?: string } {
  return validatePartContract(data);
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
        typeof parsed.revision === "number"
      ) {
        const docValidation = validateStorageDocument(parsed);
        if (docValidation.valid) {
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
      }
      return { state: "invalid", hydratedFrom: "seed" };
    } catch {
      return { state: "invalid", hydratedFrom: "seed" };
    }
  }

  if (rawLegacy && rawLegacy.trim()) {
    try {
      const parsed = JSON.parse(rawLegacy);
      if (Array.isArray(parsed)) {
        const allValid = parsed.every((p) => validatePartContract(p).valid);
        if (allValid) {
          return {
            state: "valid",
            hydratedFrom: "legacy-cache",
            parts: parsed,
            revision: 1,
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
          };
        }
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
 * 1. Disk is authoritative: If disk has valid content (including valid empty collection parts: []),
 *    disk always wins over cache and seeds without forced resurrection.
 * 2. Corrupted disk: Restores from cache ONLY IF cacheHydrationState === 'valid'.
 * 3. Corrupted disk + corrupted/missing cache: Restores from standard seeds (source: 'seed').
 * 4. Absent disk (first run, diskDoc === null): Writes seeds (or valid startup cache) to disk and cache.
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
    if (cacheHydrationState === "valid" && cacheDoc && Array.isArray(cacheDoc.parts)) {
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

  // Case 2: Disk is present and valid -> DISK IS AUTHORITATIVE
  // F02: Explicitly distinguish valid empty collection (parts: []) from absent disk (diskDoc === null).
  // When diskDoc is non-null and parts is an array, disk is authoritative regardless of length!
  if (diskDoc !== null && Array.isArray(diskDoc.parts)) {
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

  // Case 3: Absent disk (First launch in Tauri, file does not exist on disk yet: diskDoc === null)
  const initialParts =
    cacheHydrationState === "valid" && cacheDoc && Array.isArray(cacheDoc.parts)
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
