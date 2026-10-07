/**
 * Setup Center — UI Parts Schema Contract & Validation
 *
 * Implements full schema validation for UIPart and UIPartsStorageDocument,
 * preventing corrupted or malformed parts from entering runtime memory or disk.
 */

import type {
  EvidenceLevel,
  ExportStatus,
  SourceType,
  UIPart,
  UIPartKind,
  UIPartLifecycle,
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

export const VALID_SOURCE_TYPES: SourceType[] = [
  "official",
  "product",
  "documentation",
  "engineering-blog",
  "repository",
  "archive",
  "article",
  "screenshot",
  "local",
  "other",
];

export const VALID_EVIDENCE_LEVELS: EvidenceLevel[] = [
  "observed",
  "verified",
  "text-only",
  "derived",
  "unverified",
  "unread",
];

export const VALID_EXPORT_STATUS: ExportStatus[] = [
  "available",
  "partial",
  "none",
];

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that an arbitrary object satisfies the full UIPart domain schema contract.
 */
export function validatePartContract(data: any): ValidationResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, error: "零件规范必须为 JSON 对象" };
  }

  // 1. Required core identity
  if (typeof data.id !== "string" || !data.id.trim()) {
    return { valid: false, error: "缺少必填字段: id (必须为非空字符串)" };
  }
  if (/[\0\r\n]/.test(data.id)) {
    return { valid: false, error: `id "${data.id}" 包含非法控制字符` };
  }

  // 2. Title
  if (typeof data.title !== "string" || !data.title.trim()) {
    return { valid: false, error: `零件 "${data.id}": 缺少必填字段 title (必须为非空字符串)` };
  }

  // 3. Kind
  if (!VALID_KINDS.includes(data.kind)) {
    return {
      valid: false,
      error: `零件 "${data.id}": 非法分类 kind: "${data.kind}"。合法值包括: ${VALID_KINDS.join(", ")}`,
    };
  }

  // 4. Lifecycle
  if (!VALID_LIFECYCLES.includes(data.lifecycle)) {
    return {
      valid: false,
      error: `零件 "${data.id}": 非法生命周期 lifecycle: "${data.lifecycle}"。合法值包括: ${VALID_LIFECYCLES.join(", ")}`,
    };
  }

  // 5. Summary (optional string)
  if (data.summary !== undefined && typeof data.summary !== "string") {
    return { valid: false, error: `零件 "${data.id}": summary 必须为字符串` };
  }

  // 6. Sources (array of UIPartSource)
  if (!Array.isArray(data.sources)) {
    return { valid: false, error: `零件 "${data.id}": sources 必须为数组` };
  }
  for (let i = 0; i < data.sources.length; i++) {
    const src = data.sources[i];
    if (!src || typeof src !== "object" || Array.isArray(src)) {
      return { valid: false, error: `零件 "${data.id}": sources[${i}] 必须为对象` };
    }
    if (typeof src.id !== "string" || !src.id.trim()) {
      return { valid: false, error: `零件 "${data.id}": sources[${i}].id 必须为非空字符串` };
    }
    if (typeof src.title !== "string" || !src.title.trim()) {
      return { valid: false, error: `零件 "${data.id}": sources[${i}].title 必须为非空字符串` };
    }
    if (!VALID_SOURCE_TYPES.includes(src.type)) {
      return {
        valid: false,
        error: `零件 "${data.id}": sources[${i}].type "${src.type}" 非法。合法值包括: ${VALID_SOURCE_TYPES.join(", ")}`,
      };
    }
    if (typeof src.primary !== "boolean") {
      return { valid: false, error: `零件 "${data.id}": sources[${i}].primary 必须为布尔值` };
    }
    if (src.url !== undefined && typeof src.url !== "string") {
      return { valid: false, error: `零件 "${data.id}": sources[${i}].url 必须为字符串` };
    }
    if (src.notes !== undefined && typeof src.notes !== "string") {
      return { valid: false, error: `零件 "${data.id}": sources[${i}].notes 必须为字符串` };
    }
  }

  // 7. Preview
  if (!data.preview || typeof data.preview !== "object" || Array.isArray(data.preview)) {
    return { valid: false, error: `零件 "${data.id}": preview 必须为对象` };
  }
  if (data.preview.thumbnail !== undefined && typeof data.preview.thumbnail !== "string") {
    return { valid: false, error: `零件 "${data.id}": preview.thumbnail 必须为字符串` };
  }
  if (data.preview.screenshots !== undefined) {
    if (!Array.isArray(data.preview.screenshots) || !data.preview.screenshots.every((s: any) => typeof s === "string")) {
      return { valid: false, error: `零件 "${data.id}": preview.screenshots 必须为字符串数组` };
    }
  }
  if (data.preview.sourceImages !== undefined) {
    if (!Array.isArray(data.preview.sourceImages) || !data.preview.sourceImages.every((s: any) => typeof s === "string")) {
      return { valid: false, error: `零件 "${data.id}": preview.sourceImages 必须为字符串数组` };
    }
  }
  if (data.preview.prototypeUrl !== undefined && typeof data.preview.prototypeUrl !== "string") {
    return { valid: false, error: `零件 "${data.id}": preview.prototypeUrl 必须为字符串` };
  }
  if (data.preview.aspectRatio !== undefined && typeof data.preview.aspectRatio !== "string") {
    return { valid: false, error: `零件 "${data.id}": preview.aspectRatio 必须为字符串` };
  }

  // 8. Tags (array of strings)
  if (!Array.isArray(data.tags) || !data.tags.every((t: any) => typeof t === "string")) {
    return { valid: false, error: `零件 "${data.id}": tags 必须为字符串数组` };
  }

  // 9. Notes (optional string)
  if (data.notes !== undefined && typeof data.notes !== "string") {
    return { valid: false, error: `零件 "${data.id}": notes 必须为字符串` };
  }

  // 10. Timestamps (createdAt, updatedAt)
  if (typeof data.createdAt !== "string" || !data.createdAt.trim() || isNaN(Date.parse(data.createdAt))) {
    return { valid: false, error: `零件 "${data.id}": createdAt 必须为有效 ISO 时间戳字符串` };
  }
  if (typeof data.updatedAt !== "string" || !data.updatedAt.trim() || isNaN(Date.parse(data.updatedAt))) {
    return { valid: false, error: `零件 "${data.id}": updatedAt 必须为有效 ISO 时间戳字符串` };
  }

  // 11. Optional design structure
  if (data.design !== undefined) {
    if (!data.design || typeof data.design !== "object" || Array.isArray(data.design)) {
      return { valid: false, error: `零件 "${data.id}": design 必须为对象` };
    }
    if (data.design.portablePrinciple !== undefined) {
      const p = data.design.portablePrinciple;
      if (!p || typeof p !== "object" || typeof p.rule !== "string" || typeof p.zh !== "string") {
        return { valid: false, error: `零件 "${data.id}": design.portablePrinciple 必须包含 rule 和 zh 字符串` };
      }
    }
    if (data.design.essentialMechanisms !== undefined) {
      if (!Array.isArray(data.design.essentialMechanisms) || !data.design.essentialMechanisms.every((m: any) => typeof m === "string")) {
        return { valid: false, error: `零件 "${data.id}": design.essentialMechanisms 必须为字符串数组` };
      }
    }
    if (data.design.optionalCharacteristics !== undefined) {
      if (!Array.isArray(data.design.optionalCharacteristics) || !data.design.optionalCharacteristics.every((c: any) => typeof c === "string")) {
        return { valid: false, error: `零件 "${data.id}": design.optionalCharacteristics 必须为字符串数组` };
      }
    }
  }

  // 12. Optional implementation structure
  if (data.implementation !== undefined) {
    if (!data.implementation || typeof data.implementation !== "object" || Array.isArray(data.implementation)) {
      return { valid: false, error: `零件 "${data.id}": implementation 必须为对象` };
    }
    if (data.implementation.difficulty !== undefined) {
      if (!["low", "medium", "high"].includes(data.implementation.difficulty)) {
        return { valid: false, error: `零件 "${data.id}": implementation.difficulty 必须为 "low" | "medium" | "high"` };
      }
    }
  }

  // 13. Optional evidence structure
  if (data.evidence !== undefined) {
    if (!data.evidence || typeof data.evidence !== "object" || Array.isArray(data.evidence)) {
      return { valid: false, error: `零件 "${data.id}": evidence 必须为对象` };
    }
    for (const key of ["structure", "behavior", "visual", "sourceCode"] as const) {
      if (data.evidence[key] !== undefined && !VALID_EVIDENCE_LEVELS.includes(data.evidence[key])) {
        return {
          valid: false,
          error: `零件 "${data.id}": evidence.${key} "${data.evidence[key]}" 非法。合法值包括: ${VALID_EVIDENCE_LEVELS.join(", ")}`,
        };
      }
    }
  }

  // 14. Optional assets structure
  if (data.assets !== undefined) {
    if (!data.assets || typeof data.assets !== "object" || Array.isArray(data.assets)) {
      return { valid: false, error: `零件 "${data.id}": assets 必须为对象` };
    }
    if (data.assets.codeAssets !== undefined && !Array.isArray(data.assets.codeAssets)) {
      return { valid: false, error: `零件 "${data.id}": assets.codeAssets 必须为数组` };
    }
    if (data.assets.svgAssets !== undefined && !Array.isArray(data.assets.svgAssets)) {
      return { valid: false, error: `零件 "${data.id}": assets.svgAssets 必须为数组` };
    }
    if (data.assets.mediaAssets !== undefined && !Array.isArray(data.assets.mediaAssets)) {
      return { valid: false, error: `零件 "${data.id}": assets.mediaAssets 必须为数组` };
    }
  }

  // 15. Optional relationships structure
  if (data.relationships !== undefined) {
    if (!data.relationships || typeof data.relationships !== "object" || Array.isArray(data.relationships)) {
      return { valid: false, error: `零件 "${data.id}": relationships 必须为对象` };
    }
    if (data.relationships.derivedFrom !== undefined && !Array.isArray(data.relationships.derivedFrom)) {
      return { valid: false, error: `零件 "${data.id}": relationships.derivedFrom 必须为字符串数组` };
    }
    if (data.relationships.usedByPresets !== undefined && !Array.isArray(data.relationships.usedByPresets)) {
      return { valid: false, error: `零件 "${data.id}": relationships.usedByPresets 必须为字符串数组` };
    }
  }

  // 16. Optional realityTest structure
  if (data.realityTest !== undefined) {
    if (!data.realityTest || typeof data.realityTest !== "object" || Array.isArray(data.realityTest)) {
      return { valid: false, error: `零件 "${data.id}": realityTest 必须为对象` };
    }
    if (data.realityTest.rating !== undefined && !["ACCEPT", "REVISE", "REJECT"].includes(data.realityTest.rating)) {
      return { valid: false, error: `零件 "${data.id}": realityTest.rating 必须为 "ACCEPT" | "REVISE" | "REJECT"` };
    }
  }

  return { valid: true };
}

/**
 * Validates that an arbitrary object satisfies the UIPartsStorageDocument contract.
 * Note: An empty parts array is explicitly valid!
 */
export function validateStorageDocument(doc: any): ValidationResult {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { valid: false, error: "存储文档必须为 JSON 对象" };
  }

  if (typeof doc.schemaVersion !== "number" || doc.schemaVersion < 1) {
    return { valid: false, error: "缺少有效 schemaVersion (必须为大于等于 1 的数字)" };
  }

  if (typeof doc.revision !== "number" || doc.revision < 1) {
    return { valid: false, error: "缺少有效 revision (必须为大于等于 1 的数字)" };
  }

  if (typeof doc.updatedAt !== "string" || !doc.updatedAt.trim() || isNaN(Date.parse(doc.updatedAt))) {
    return { valid: false, error: "缺少有效 updatedAt (必须为有效 ISO 时间戳字符串)" };
  }

  if (!Array.isArray(doc.parts)) {
    return { valid: false, error: "存储文档 parts 字段必须为数组" };
  }

  // Validate every part within the document
  for (let i = 0; i < doc.parts.length; i++) {
    const partResult = validatePartContract(doc.parts[i]);
    if (!partResult.valid) {
      return {
        valid: false,
        error: `存储文档第 ${i + 1} 个零件契约校验失败: ${partResult.error}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validates that an arbitrary object satisfies the UIPartPackage contract.
 */
export function validatePackageContract(pkg: any): ValidationResult {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    return { valid: false, error: "导入包必须为 JSON 对象" };
  }
  if (pkg.format !== "uipart-package.v1") {
    return {
      valid: false,
      error: `不支持的包格式: "${pkg.format}"，期望 "uipart-package.v1"`,
    };
  }
  if (typeof pkg.exportedAt !== "string" || !pkg.exportedAt.trim() || isNaN(Date.parse(pkg.exportedAt))) {
    return { valid: false, error: "缺少有效的 exportedAt ISO 时间戳" };
  }
  if (!pkg.part) {
    return { valid: false, error: "包中缺少 part 零件数据" };
  }
  const partResult = validatePartContract(pkg.part);
  if (!partResult.valid) {
    return { valid: false, error: `包内零件数据校验失败: ${partResult.error}` };
  }
  return { valid: true };
}

/**
 * Creates a defensive, deep clone of any value to guarantee immutable snapshots.
 */
export function deepClone<T>(val: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(val);
    } catch {
      // fallback
    }
  }
  return JSON.parse(JSON.stringify(val));
}
