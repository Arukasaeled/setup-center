/**
 * Setup Center — Universal Setup Action Contract & Resolver Types
 *
 * Principle: "Nothing in Setup Center should be dead content."
 *
 * Every entity (Software, Style, Resource, Template, Pattern, Skill,
 * Font, Icon, CLI, AI Tool, Learning Roadmap, Starter Pack) provides
 * an actionable SetupAction to migrate assets into the user's local
 * environment or active workflow.
 */

import type { SoftwareId } from "../../lib/types";

export type SetupActionType =
  | "install"     // Native installer / Winget execution
  | "command"     // Package manager / CLI command (pnpm, npm, cargo, uv, etc.)
  | "download"    // Direct asset download via AssetDownloader
  | "clone"       // Git repository clone
  | "scaffold"    // Project generator / template initialisation
  | "apply"       // Visual style / design token activation
  | "copy"        // Snippet / CSS / Config / Prompt to clipboard
  | "open"        // Documentation / Browser URL navigation
  | "import"      // Transfer inbox / Bookmark intake
  | "reveal"      // Local folder / detail view
  // Experience actions. A Style is content like any other, so tuning one has to
  // be an action rather than a button the gallery invents on the side — that is
  // why these are members of the shared union and dispatched by the shared
  // executor, instead of living in StyleSection (brief §27).
  | "customize"   // Open the Experience Playground for a style
  | "export"      // Export a style's token set as a portable envelope
  | "fork";       // Derive a custom experience from a preset + overrides

export type PackageManager =
  | "pnpm"
  | "npm"
  | "yarn"
  | "bun"
  | "cargo"
  | "uv"
  | "pip"
  | "winget"
  | "git"
  | "powershell"
  | "bash";

export interface SetupPrerequisite {
  requiredSoftwareIds?: SoftwareId[];
  requiredCapabilities?: string[];
  hint?: string;
}

export interface SetupAction {
  id: string;
  type: SetupActionType;
  label: string;
  description?: string;
  isPrimary?: boolean;
  payload: string; // The URL, shell command, code snippet, or target identifier
  packageCommands?: Partial<Record<PackageManager, string>>;
  activePackageManager?: PackageManager;
  prerequisites?: SetupPrerequisite;
  successMessage?: string;
  icon?: string;
}

export interface PrerequisitesStatus {
  satisfied: boolean;
  missingSoftwareIds: SoftwareId[];
  missingNames: string[];
  warningHint?: string;
}

export interface SetupResolutionResult {
  itemId: string;
  name: string;
  category?: string;
  itemType: "software" | "style" | "resource" | "template" | "pattern" | "skill" | "learning" | "collection";
  primaryAction: SetupAction;
  secondaryActions: SetupAction[];
  prerequisites: PrerequisitesStatus;
  availablePackageManagers?: PackageManager[];
}

export interface SetupCollectionItem {
  id: string;
  name: string;
  type: "software" | "style" | "resource" | "template" | "pattern" | "skill";
  required?: boolean;
  notes?: string;
}

export interface SetupCollection {
  id: string;
  name: string;
  title: string;
  subtitle: string;
  description: string;
  category: "starter" | "ai" | "frontend" | "fullstack" | "academic" | "creative";
  iconName?: string;
  items: SetupCollectionItem[];
  targetAudience: string;
  estimatedSetupMinutes: number;
}
