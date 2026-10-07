/**
 * Setup Center — Experience Token Validation & Sanitization Engine
 *
 * Implements Issue G04:
 * Enforces strict whitelist, range boundaries, and safe syntax validation on
 * all imported, loaded, or tuned experience tokens.
 *
 * Guards against:
 * 1. CSS injection attacks (e.g. malicious expressions, urls, semicolons, script escapes)
 * 2. Out-of-bounds metrics (e.g. negative blur, absurdly huge radii or font scales)
 * 3. Schema drift between export format, import parser, and runtime variable binder
 */

import type { ExperienceTokens, ShadowTokens, TokenKey, TokenOverrides } from "./types";

export const ALLOWED_TOKEN_KEYS: readonly TokenKey[] = [
  "panelRadius",
  "controlRadius",
  "borderWidth",
  "shadow",
  "accent",
  "accentSecondary",
  "surface",
  "text",
  "density",
  "headingScale",
  "bodyScale",
  "motion",
] as const;

const ALLOWED_DENSITIES = new Set(["compact", "normal", "spacious"]);
const ALLOWED_MOTIONS = new Set(["reduced", "normal", "expressive"]);

const LENGTH_REGEX = /^([0-9]+(?:\.[0-9]+)?)(px|rem|em|%)$/;
const SIGNED_LENGTH_REGEX = /^(-?[0-9]+(?:\.[0-9]+)?)(px|rem|em|%)$/;

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR_REGEX = /^rgba?\(\s*[0-9]+%?\s*,\s*[0-9]+%?\s*,\s*[0-9]+%?(?:\s*,\s*(?:[0-9]+(?:\.[0-9]+)?|0?\.[0-9]+)%?)?\s*\)$/i;
const HSL_COLOR_REGEX = /^hsla?\(\s*[0-9]+(?:deg|turn|rad)?\s*,\s*[0-9]+%\s*,\s*[0-9]+%(?:\s*,\s*(?:[0-9]+(?:\.[0-9]+)?|0?\.[0-9]+)%?)?\s*\)$/i;

/**
 * Validates whether a value is a syntactically valid and injection-safe CSS color.
 */
export function isValidColor(val: unknown): boolean {
  if (typeof val !== "string") return false;
  const trimmed = val.trim();
  if (trimmed.length > 50 || trimmed.includes(";") || trimmed.includes("{") || trimmed.includes("}")) {
    return false;
  }
  if (trimmed.toLowerCase().includes("url(") || trimmed.toLowerCase().includes("expression(")) {
    return false;
  }
  return (
    HEX_COLOR_REGEX.test(trimmed) ||
    RGB_COLOR_REGEX.test(trimmed) ||
    HSL_COLOR_REGEX.test(trimmed)
  );
}

/**
 * Validates whether a value is a valid non-negative CSS length within specified pixel bounds.
 */
export function isValidLength(val: unknown, minPx = 0, maxPx = 100): boolean {
  if (typeof val !== "string") return false;
  const match = LENGTH_REGEX.exec(val.trim());
  if (!match) return false;
  const num = parseFloat(match[1]);
  const unit = match[2];
  let approxPx = num;
  if (unit === "rem" || unit === "em") approxPx = num * 16;
  else if (unit === "%") approxPx = (num / 100) * 100;
  return approxPx >= minPx && approxPx <= maxPx;
}

/**
 * Validates whether a value is a valid signed CSS length (for shadow offsets/spreads).
 */
export function isValidSignedLength(val: unknown, minPx = -100, maxPx = 100): boolean {
  if (typeof val !== "string") return false;
  const match = SIGNED_LENGTH_REGEX.exec(val.trim());
  if (!match) return false;
  const num = parseFloat(match[1]);
  const unit = match[2];
  let approxPx = num;
  if (unit === "rem" || unit === "em") approxPx = num * 16;
  return approxPx >= minPx && approxPx <= maxPx;
}

/**
 * Validates a ShadowTokens structure.
 */
export function validateShadowTokens(val: unknown): { valid: boolean; error?: string } {
  if (!val || typeof val !== "object") {
    return { valid: false, error: "Shadow must be an object" };
  }
  const s = val as Record<string, unknown>;
  if (!isValidSignedLength(s.offsetX, -60, 60)) {
    return { valid: false, error: `Invalid shadow.offsetX: ${String(s.offsetX)}` };
  }
  if (!isValidSignedLength(s.offsetY, -60, 80)) {
    return { valid: false, error: `Invalid shadow.offsetY: ${String(s.offsetY)}` };
  }
  if (!isValidLength(s.blur, 0, 120)) {
    return { valid: false, error: `Invalid shadow.blur: ${String(s.blur)}` };
  }
  if (!isValidSignedLength(s.spread, -60, 60)) {
    return { valid: false, error: `Invalid shadow.spread: ${String(s.spread)}` };
  }
  if (!isValidColor(s.color)) {
    return { valid: false, error: `Invalid shadow.color: ${String(s.color)}` };
  }
  if (s.inset !== undefined && typeof s.inset !== "boolean") {
    return { valid: false, error: "shadow.inset must be boolean if present" };
  }
  return { valid: true };
}

/**
 * Validates a single token property by key.
 */
export function validateSingleToken(key: string, value: unknown): { valid: boolean; error?: string } {
  switch (key) {
    case "panelRadius":
      return isValidLength(value, 0, 48)
        ? { valid: true }
        : { valid: false, error: "panelRadius must be between 0px and 48px" };
    case "controlRadius":
      return isValidLength(value, 0, 32)
        ? { valid: true }
        : { valid: false, error: "controlRadius must be between 0px and 32px" };
    case "borderWidth":
      return isValidLength(value, 0, 8)
        ? { valid: true }
        : { valid: false, error: "borderWidth must be between 0px and 8px" };
    case "shadow":
      return validateShadowTokens(value);
    case "accent":
    case "accentSecondary":
    case "surface":
    case "text":
      return isValidColor(value)
        ? { valid: true }
        : { valid: false, error: `${key} must be a valid CSS color (#hex, rgb, hsl)` };
    case "density":
      return typeof value === "string" && ALLOWED_DENSITIES.has(value)
        ? { valid: true }
        : { valid: false, error: "density must be one of 'compact', 'normal', 'spacious'" };
    case "motion":
      return typeof value === "string" && ALLOWED_MOTIONS.has(value)
        ? { valid: true }
        : { valid: false, error: "motion must be one of 'reduced', 'normal', 'expressive'" };
    case "headingScale":
      return typeof value === "number" && Number.isFinite(value) && value >= 0.7 && value <= 2.2
        ? { valid: true }
        : { valid: false, error: "headingScale must be a number between 0.7 and 2.2" };
    case "bodyScale":
      return typeof value === "number" && Number.isFinite(value) && value >= 0.7 && value <= 1.6
        ? { valid: true }
        : { valid: false, error: "bodyScale must be a number between 0.7 and 1.6" };
    default:
      return { valid: false, error: `Unknown token key: ${key}` };
  }
}

/**
 * Comprehensive contract validation for an arbitrary token overrides bag.
 */
export function validateTokenOverrides(
  input: unknown,
): { valid: boolean; data?: TokenOverrides; errors: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["TokenOverrides must be an object"] };
  }

  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  const sanitized: Partial<ExperienceTokens> = {};

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOKEN_KEYS.includes(key as TokenKey)) {
      errors.push(`Disallowed or unknown token property: '${key}'`);
      continue;
    }
    const val = raw[key];
    if (val === undefined || val === null) continue;
    const res = validateSingleToken(key, val);
    if (!res.valid) {
      errors.push(res.error || `Validation failed for token '${key}'`);
    } else {
      (sanitized as Record<string, unknown>)[key] = val;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: sanitized as TokenOverrides, errors: [] };
}

/**
 * Strips unknown or invalid tokens, returning only verified safe overrides.
 */
export function sanitizeTokenOverrides(input: unknown): TokenOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const raw = input as Record<string, unknown>;
  const sanitized: Partial<ExperienceTokens> = {};

  for (const key of ALLOWED_TOKEN_KEYS) {
    const val = raw[key];
    if (val !== undefined && val !== null) {
      const res = validateSingleToken(key, val);
      if (res.valid) {
        (sanitized as Record<string, unknown>)[key] = val;
      }
    }
  }

  return sanitized as TokenOverrides;
}
