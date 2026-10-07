/**
 * Setup Center — UI Parts Library V1 Domain Contract
 *
 * Defines the formal lifecycle, evidence levels, design DNA,
 * implementation parameters, and export capabilities for visual and interaction parts.
 */

export type UIPartLifecycle = "raw" | "enriched" | "prototyped" | "validated";

export type UIPartKind =
  | "component"
  | "layout"
  | "composition"
  | "navigation"
  | "interaction"
  | "typography"
  | "status"
  | "search"
  | "card"
  | "data-viz"
  | "motion"
  | "visual-rule"
  | "other";

export type SourceType =
  | "official"
  | "product"
  | "documentation"
  | "engineering-blog"
  | "repository"
  | "archive"
  | "article"
  | "screenshot"
  | "local"
  | "other";

export interface UIPartSource {
  id: string;
  title: string;
  url?: string;
  type: SourceType;
  primary: boolean;
  notes?: string;
}

export type EvidenceLevel =
  | "observed"
  | "verified"
  | "text-only"
  | "derived"
  | "unverified"
  | "unread";

export interface UIPartEvidence {
  structure?: EvidenceLevel;
  behavior?: EvidenceLevel;
  visual?: EvidenceLevel;
  sourceCode?: EvidenceLevel;
  notes?: string[];
}

export interface UIPartDesignDNA {
  layout?: string;
  typography?: string;
  color?: string;
  shape?: string;
  density?: string;
  motion?: string;
  interaction?: string;
}

export interface UIPartDesign {
  designDNA?: UIPartDesignDNA;
  portablePrinciple?: {
    rule: string; // "When X, use Y because Z."
    zh: string;
  };
  essentialMechanisms?: string[];
  optionalCharacteristics?: string[];
  useCases?: Array<{
    scenario: string;
    fit: "high" | "medium" | "low";
    notes?: string;
  }>;
  analysis?: string;
}

export interface UIPartParameter {
  value: string | number | boolean;
  unit?: string;
  status: "verified" | "derived" | "experimental";
  notes?: string;
}

export interface UIPartImplementation {
  difficulty?: "low" | "medium" | "high";
  preferredTech?: string;
  implementationBasis?: string;
  prototypeVariants?: Array<{
    id: string;
    name: string;
    description?: string;
    previewUrl?: string;
  }>;
  parameters?: Record<string, UIPartParameter>;
}

export type ExportStatus = "available" | "partial" | "none";

export interface UIPartExports {
  humanSpec?: ExportStatus;
  agentBrief?: ExportStatus;
  html?: ExportStatus;
  css?: ExportStatus;
  react?: ExportStatus;
  svg?: ExportStatus;
  tokens?: ExportStatus;
  interactionHook?: ExportStatus;
  package?: ExportStatus;
}

export interface UIPartCodeAsset {
  id: string;
  name: string;
  filename: string;
  content: string;
  language: "typescript" | "tsx" | "css" | "json" | "markdown" | "html";
  description?: string;
}

export interface UIPartMediaAsset {
  id: string;
  name: string;
  mime: string;
  relativePath: string;
  dataUrl?: string;
  width?: number;
  height?: number;
  capturedAt?: string;
}

export interface UIPartAssets {
  codeAssets?: UIPartCodeAsset[];
  svgAssets?: Array<{ id: string; name: string; content: string }>;
  mediaAssets?: UIPartMediaAsset[];
}

export interface UIPartPreview {
  thumbnail?: string; // Relative asset path (e.g. assets/<id>/preview.png), Data URI, or SVG URI
  screenshots?: string[];
  sourceImages?: string[];
  prototypeUrl?: string;
  aspectRatio?: string;
}

export interface UIPartRelationships {
  usedByPresets?: string[];
  derivedFrom?: string[];
  relatedParts?: string[];
}

export interface UIPartRealityTest {
  rating: "ACCEPT" | "REVISE" | "REJECT";
  mechanismIndependent: boolean;
  datasetIndependent: boolean;
  worthEnteringLibrary: boolean;
  notes?: string;
}

export interface UIPart {
  id: string;
  title: string;
  lifecycle: UIPartLifecycle;
  kind: UIPartKind;
  summary?: string;
  sources: UIPartSource[];
  preview: UIPartPreview;
  tags: string[];
  notes?: string;
  design?: UIPartDesign;
  implementation?: UIPartImplementation;
  evidence?: UIPartEvidence;
  assets?: UIPartAssets;
  exports?: UIPartExports;
  relationships?: UIPartRelationships;
  realityTest?: UIPartRealityTest;
  createdAt: string;
  updatedAt: string;
}

export interface UIPartPackageManifest {
  totalAssets: number;
  inlinedMediaCount: number;
  codeAssetCount: number;
  integrity: "complete" | "partial" | "metadata-only";
  missingAssets?: string[];
}

export interface UIPartPackage {
  format: "uipart-package.v1";
  exportedAt: string;
  part: UIPart;
  manifest?: UIPartPackageManifest;
}

export interface UIPartFilterQuery {
  search?: string;
  kind?: UIPartKind | "all";
  lifecycle?: UIPartLifecycle | "all";
  tag?: string;
  onlyFavorites?: boolean;
}

export interface UIPartsStorageDocument {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  parts: UIPart[];
}

export interface UIPartsRecoveryState {
  recovered: boolean;
  source: "disk" | "cache" | "seed";
  corruptedBackup?: string;
  message?: string;
}

export interface UIPartsStorageInfo {
  mode: "tauri-disk" | "browser-fallback";
  storageDir?: string;
  indexFile?: string;
  assetsDir?: string;
  revision: number;
  schemaVersion: number;
  updatedAt: string;
}
