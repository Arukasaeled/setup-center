/**
 * Setup Center — Vault Contract Validation
 *
 * Enforces JSON schemas and contract boundaries for all Vault ingest points.
 * All remote inputs (manifests, release checkpoints, styles, resources,
 * templates, patterns, skills, inbox items, and cached payloads) must pass
 * validation before being admitted into memory or disk storage.
 */

import type {
  VaultManifest,
  VaultStyleManifest,
  VaultTemplateItem,
  VaultPatternItem,
  VaultSkillItem,
  VaultResourceItem,
  VaultReleaseCheckpoint,
  VaultInboxItem,
  CachedVaultData,
} from "./types";

export interface ValidationResult<T> {
  valid: boolean;
  errors: string[];
  data?: T;
}

/**
 * Validates whether a given commit SHA is a strict 40-character hexadecimal string.
 * Mutable branches, tags, or short SHAs are rejected as immutable release pins (Issue D04).
 */
export function validateCommitSha(sha: unknown): sha is string {
  if (typeof sha !== "string") return false;
  return /^[0-9a-fA-F]{40}$/.test(sha.trim());
}

/**
 * Validates a relative vault path to ensure no directory traversal,
 * absolute drive prefixes, or illegal Windows path characters exist.
 */
export function validateRelativePath(path: unknown): path is string {
  if (typeof path !== "string" || !path.trim()) return false;
  const p = path.trim();
  // Reject traversal
  if (p.includes("..")) return false;
  // Reject leading slashes or Windows drive colons
  if (p.startsWith("/") || p.startsWith("\\") || /^[a-zA-Z]:/.test(p)) return false;
  // Reject illegal Windows characters
  if (/[*?"<>|]/.test(p)) return false;
  return true;
}

export function validateReleaseCheckpoint(input: unknown): ValidationResult<VaultReleaseCheckpoint> {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Release checkpoint must be a non-null object"] };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.releaseVersion !== "string" || !/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$/.test(obj.releaseVersion)) {
    errors.push(`Invalid releaseVersion: ${String(obj.releaseVersion)}`);
  }
  if (!validateCommitSha(obj.commitSha)) {
    errors.push(`commitSha must be a strict 40-character hex SHA, got: ${String(obj.commitSha)}`);
  }
  if (typeof obj.snapshotTag !== "string" || !/^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$/.test(obj.snapshotTag)) {
    errors.push(`Invalid snapshotTag: ${String(obj.snapshotTag)}`);
  }
  if (typeof obj.publishedAt !== "string" || !obj.publishedAt) {
    errors.push("Missing or invalid publishedAt");
  }
  if (typeof obj.summary !== "string" || !obj.summary) {
    errors.push("Missing or invalid summary");
  }
  if (!Array.isArray(obj.changes) || !obj.changes.every((c) => typeof c === "string")) {
    errors.push("changes must be an array of strings");
  }

  if (!obj.collections || typeof obj.collections !== "object" || Array.isArray(obj.collections)) {
    errors.push("Missing or invalid collections object");
  } else {
    const col = obj.collections as Record<string, unknown>;
    for (const k of ["styles", "resources", "templates", "patterns"]) {
      if (typeof col[k] !== "number" || col[k] < 0) {
        errors.push(`collections.${k} must be a non-negative number`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], data: input as VaultReleaseCheckpoint };
}

export function validateManifest(input: unknown): ValidationResult<VaultManifest> {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Manifest must be a non-null object"] };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.schemaVersion !== "string" || !obj.schemaVersion) {
    errors.push("Missing or invalid schemaVersion");
  }
  if (typeof obj.contentVersion !== "string" || !/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$/.test(obj.contentVersion)) {
    errors.push(`Invalid contentVersion: ${String(obj.contentVersion)}`);
  }
  if (typeof obj.name !== "string" || !obj.name) {
    errors.push("Missing or invalid name");
  }
  if (typeof obj.description !== "string") {
    errors.push("Missing or invalid description");
  }

  if (!obj.collections || typeof obj.collections !== "object" || Array.isArray(obj.collections)) {
    errors.push("Missing or invalid collections object");
  } else {
    const col = obj.collections as Record<string, unknown>;
    for (const key of ["styles", "resources", "templates", "patterns"]) {
      if (!col[key] || typeof col[key] !== "object") {
        errors.push(`Missing collections.${key}`);
        continue;
      }
      const c = col[key] as Record<string, unknown>;
      if (typeof c.version !== "string") errors.push(`collections.${key}.version must be a string`);
      if (typeof c.count !== "number" || c.count < 0) errors.push(`collections.${key}.count must be >= 0`);

      if (Array.isArray(c.items)) {
        for (const item of c.items as Array<Record<string, unknown>>) {
          if (!item || typeof item !== "object") {
            errors.push(`Invalid item in collections.${key}`);
            continue;
          }
          if (typeof item.id !== "string" || !item.id) errors.push(`Missing item id in collections.${key}`);
          if (typeof item.name !== "string" || !item.name) errors.push(`Missing item name in collections.${key}`);
          if (!validateRelativePath(item.path)) errors.push(`Invalid relative path in collections.${key}: ${String(item.path)}`);
          if (item.cssPath !== undefined && !validateRelativePath(item.cssPath)) {
            errors.push(`Invalid cssPath in collections.${key}: ${String(item.cssPath)}`);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], data: input as VaultManifest };
}

export function validateStyleManifest(input: unknown): ValidationResult<VaultStyleManifest> {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Style manifest must be a non-null object"] };
  }
  const obj = input as Record<string, unknown>;

  for (const k of ["id", "name", "version", "description", "cssPath"]) {
    if (typeof obj[k] !== "string" || !obj[k]) {
      errors.push(`Missing or invalid ${k}`);
    }
  }
  if (obj.cssPath && !validateRelativePath(obj.cssPath)) {
    errors.push(`Invalid cssPath: ${String(obj.cssPath)}`);
  }

  if (!obj.palette || typeof obj.palette !== "object" || Array.isArray(obj.palette)) {
    errors.push("Missing palette object");
  } else {
    const pal = obj.palette as Record<string, unknown>;
    for (const pk of ["bg", "text", "primary", "surface", "border"]) {
      if (typeof pal[pk] !== "string" || !pal[pk]) {
        errors.push(`Missing palette.${pk}`);
      }
    }
  }

  if (obj.experience !== undefined) {
    if (typeof obj.experience !== "object" || obj.experience === null || Array.isArray(obj.experience)) {
      errors.push("experience must be an object if present");
    } else {
      const exp = obj.experience as Record<string, unknown>;
      const validTiers = ["token", "component", "composition", "experience"];
      if (!validTiers.includes(String(exp.tier))) {
        errors.push(`Invalid experience.tier: ${String(exp.tier)}`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], data: input as VaultStyleManifest };
}

export function validateResourceItem(input: unknown): ValidationResult<VaultResourceItem> {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Resource item must be a non-null object"] };
  }
  const obj = input as Record<string, unknown>;

  for (const k of ["id", "name", "category", "description", "recommendedReason", "author"]) {
    if (typeof obj[k] !== "string" || !obj[k]) {
      errors.push(`Missing or invalid ${k}`);
    }
  }
  if (!Array.isArray(obj.tags)) {
    errors.push("tags must be an array of strings");
  }
  const validActionTypes = ["github", "external", "download"];
  if (!validActionTypes.includes(String(obj.actionType))) {
    errors.push(`Invalid actionType: ${String(obj.actionType)}`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], data: input as VaultResourceItem };
}

export function validateTemplateItem(input: unknown): ValidationResult<VaultTemplateItem> {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Template item must be a non-null object"] };
  }
  const obj = input as Record<string, unknown>;

  for (const k of ["id", "name", "category", "description", "author"]) {
    if (typeof obj[k] !== "string" || !obj[k]) {
      errors.push(`Missing or invalid ${k}`);
    }
  }
  if (!Array.isArray(obj.tags)) {
    errors.push("tags must be an array of strings");
  }
  if (!obj.scaffold || typeof obj.scaffold !== "object" || Array.isArray(obj.scaffold)) {
    errors.push("Missing scaffold configuration");
  } else {
    const sc = obj.scaffold as Record<string, unknown>;
    const validScaffoldTypes = ["git-clone", "command", "archive-extract"];
    if (!validScaffoldTypes.includes(String(sc.type))) {
      errors.push(`Invalid scaffold.type: ${String(sc.type)}`);
    }
    if (sc.steps !== undefined) {
      if (!Array.isArray(sc.steps)) {
        errors.push("scaffold.steps must be an array");
      } else {
        for (let i = 0; i < sc.steps.length; i++) {
          const step = sc.steps[i] as Record<string, unknown> | null;
          if (!step || typeof step !== "object") {
            errors.push(`scaffold.steps[${i}] must be an object`);
          } else {
            if (typeof step.program !== "string" || !step.program) {
              errors.push(`scaffold.steps[${i}].program must be a non-empty string`);
            }
            if (!Array.isArray(step.args) || !step.args.every((a) => typeof a === "string")) {
              errors.push(`scaffold.steps[${i}].args must be an array of strings`);
            }
          }
        }
      }
    }
    if (sc.supportedPackageManagers !== undefined && !Array.isArray(sc.supportedPackageManagers)) {
      errors.push("scaffold.supportedPackageManagers must be an array of strings");
    }
    if (sc.requiredCapabilities !== undefined && !Array.isArray(sc.requiredCapabilities)) {
      errors.push("scaffold.requiredCapabilities must be an array of strings");
    }
    if (sc.preparedOnly !== undefined && typeof sc.preparedOnly !== "boolean") {
      errors.push("scaffold.preparedOnly must be a boolean");
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], data: input as VaultTemplateItem };
}

export function validatePatternItem(input: unknown): ValidationResult<VaultPatternItem> {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Pattern item must be a non-null object"] };
  }
  const obj = input as Record<string, unknown>;

  for (const k of ["id", "name", "category", "description", "codeSnippet", "cssRules"]) {
    if (typeof obj[k] !== "string") {
      errors.push(`Missing or invalid ${k}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], data: input as VaultPatternItem };
}

export function validateSkillItem(input: unknown): ValidationResult<VaultSkillItem> {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Skill item must be a non-null object"] };
  }
  const obj = input as Record<string, unknown>;

  for (const k of ["id", "name", "description", "prompt"]) {
    if (typeof obj[k] !== "string" || !obj[k]) {
      errors.push(`Missing or invalid ${k}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], data: input as VaultSkillItem };
}

export function validateInboxItem(input: unknown): ValidationResult<VaultInboxItem> {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Inbox item must be a non-null object"] };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.id !== "string" || !obj.id) errors.push("Missing or invalid id");
  if (typeof obj.url !== "string" || !obj.url) errors.push("Missing or invalid url");
  if (typeof obj.capturedAt !== "string" || !obj.capturedAt) errors.push("Missing or invalid capturedAt");
  const validStatuses = ["pending", "processed", "rejected"];
  if (!validStatuses.includes(String(obj.status))) {
    errors.push(`Invalid status: ${String(obj.status)}`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], data: input as VaultInboxItem };
}

export function validateCachedVaultData(input: unknown): ValidationResult<CachedVaultData> {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Cache document must be a non-null object"] };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.syncedAt !== "string") {
    errors.push("Missing or invalid syncedAt in cache");
  }
  const manRes = validateManifest(obj.manifest);
  if (!manRes.valid) {
    errors.push(...manRes.errors.map((e) => `Cache manifest error: ${e}`));
  }
  if (!obj.styles || typeof obj.styles !== "object" || Array.isArray(obj.styles)) {
    errors.push("Missing styles dictionary in cache");
  }
  if (!Array.isArray(obj.resources)) {
    errors.push("resources in cache must be an array");
  }
  if (!Array.isArray(obj.templates)) {
    errors.push("templates in cache must be an array");
  }
  if (!Array.isArray(obj.patterns)) {
    errors.push("patterns in cache must be an array");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], data: input as CachedVaultData };
}
