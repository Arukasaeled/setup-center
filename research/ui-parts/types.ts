/**
 * Setup Center — Minimal UI Part Contract & Types
 *
 * Defines the standard schema for UI Parts extracted from real-world products
 * and historical design artifacts, preserving evidence grades and portable principles.
 */

export type EvidenceLevel =
  | "verified"      // Direct confirmation from primary source (official manual/docs)
  | "observed"      // Visually verified from authentic screenshot/runtime
  | "text-only"     // Structural description from primary text without visual confirmation
  | "derived"       // Extracted/synthesized abstraction by Setup Center
  | "unverified"    // Hypothesis or assumption not yet confirmed
  | "unread";       // Source exists but not analyzed in current phase

export type UIPartKind =
  | "layout"
  | "interaction"
  | "status"
  | "composition"
  | "navigation"
  | "search"
  | "card";

export interface UIPartSource {
  title: string;
  url: string;
  type:
    | "official-manual"
    | "changelog"
    | "engineering-blog"
    | "repo-readme"
    | "archive"
    | "screenshot";
}

export interface UIPartEvidence {
  structure: EvidenceLevel;
  behavior: EvidenceLevel;
  visual: EvidenceLevel;
  sourceCode: EvidenceLevel;
}

export interface UIPartUseCase {
  scenario: string;
  fit: "high" | "medium" | "low";
  notes?: string;
}

export interface UIPartContract {
  id: string;
  name: string;
  kind: UIPartKind;
  summary: string;
  source: UIPartSource;
  portablePrinciple: {
    rule: string; // "When X, use Y because Z."
    zh: string;
  };
  essentialMechanisms: string[];
  optionalCharacteristics: string[];
  useCases: UIPartUseCase[];
  implementation: {
    difficulty: "low" | "medium" | "high";
    preferredTech: string;
  };
  evidence: UIPartEvidence;
  implementationBasis: string;
  exportable: boolean;
}
