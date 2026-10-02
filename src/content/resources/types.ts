/**
 * Setup Center — Resource Catalog Types
 *
 * Defines the contract for curated external developer and design assets:
 * Inspiration, Components, Animations, Icons, Fonts, Tools, AI, Templates,
 * Learning paths, and Awesome collections.
 */

export type ResourceCategory =
  | "frontend"
  | "components"
  | "animation"
  | "icons"
  | "fonts"
  | "tools"
  | "ai"
  | "templates"
  | "learning"
  | "collections";

export type ResourceActionType = "github" | "external" | "download";

export interface ResourceCategoryMeta {
  id: ResourceCategory;
  name: string;
  icon: string;
  description: string;
}

export interface ResourceItem {
  id: string;
  name: string;
  category: ResourceCategory;
  description: string;
  recommendedReason: string;
  author: string;
  tags: string[];
  actionType: ResourceActionType;
  repository?: string;
  homepage?: string;
  downloadUrl?: string;
  stars?: string;
  license?: string;
  version?: string;
  updatedAt?: string;
  featured?: boolean;
}
