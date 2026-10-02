/**
 * Setup Center — Content Registry Contract & Types
 *
 * Defines the unified metadata schema for all modular content types:
 * Software, Styles, Resources, Templates, Skills, and Learning paths.
 *
 * Serves as the static local foundation and future boundary for remote
 * catalog manifests.
 */

export type ContentType =
  | "software"
  | "style"
  | "resource"
  | "template"
  | "skill"
  | "learning";

export interface ContentItem<TMetadata = Record<string, unknown>> {
  id: string;
  type: ContentType;
  name: string;
  version?: string;
  description: string;
  source?: string;
  author?: string;
  license?: string;
  updatedAt?: string;
  homepage?: string;
  repository?: string;
  tags?: string[];
  metadata?: TMetadata;
}

/**
 * Manifest definition for modular content packages and future updates.
 */
export interface ContentManifest {
  manifestVersion: string;
  schemaVersion: string;
  publishedAt: string;
  items: ContentItem[];
}
