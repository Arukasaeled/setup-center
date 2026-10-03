/**
 * Setup Center — Vault & Runtime Update Contract
 *
 * Types defining communication, caching, and state synchronization
 * with the external Setup Center Vault.
 */

export interface VaultItemRef {
  id: string;
  name: string;
  path: string;
  cssPath?: string;
  checksum?: string;
  updatedAt?: string;
}

export interface VaultCollectionMeta<TItem = VaultItemRef> {
  version: string;
  count: number;
  categories?: string[];
  items?: TItem[];
}

export interface VaultManifest {
  schemaVersion: string;
  contentVersion: string;
  name: string;
  description: string;
  updatedAt: string;
  maintainer?: string;
  repository?: string;
  collections: {
    styles: VaultCollectionMeta;
    resources: VaultCollectionMeta;
    templates: VaultCollectionMeta;
    patterns: VaultCollectionMeta;
    skills?: VaultCollectionMeta;
    inbox?: VaultCollectionMeta;
  };
}

export interface VaultStyleManifest {
  id: string;
  name: string;
  version: string;
  subtitle?: string;
  description: string;
  author: string;
  license?: string;
  updatedAt?: string;
  implemented: boolean;
  inspiration?: string;
  tags?: string[];
  features?: string[];
  cssPath: string;
  cssContent?: string;
  palette: {
    bg: string;
    text: string;
    primary: string;
    surface: string;
    border: string;
  };
  tokens?: {
    cardRadius?: string;
    borderWidth?: string;
    shadowDepth?: string;
    fontHeading?: string;
    fontBody?: string;
  };
  /**
   * Vault Style Contract V2 — optional declarative Experience profile.
   *
   * A published style that supplies only palette + tokens is a Tier-1/Tier-2
   * reskin. This field is what lets a Vault release ship a Tier-3/Tier-4
   * experience — shell, navigation, detail, card and composition grammar — with
   * no client rebuild, because every grammar token is a closed enum the runtime
   * already renders. Omitted by older vault entries, which is why the field is
   * optional and why `registerStyle` keeps any locally declared profile.
   */
  experience?: import("../../styles/types").ExperienceProfile;
  designPrinciples?: string[];
}

export interface VaultTemplateItem {
  id: string;
  name: string;
  category: string;
  description: string;
  author: string;
  license?: string;
  tags: string[];
  homepage?: string;
  repository?: string;
  scaffold: {
    type: "git-clone" | "command" | "archive-extract";
    command?: string;
    gitUrl?: string;
    archiveUrl?: string;
    defaultDir?: string;
    postInstallNotice?: string;
  };
  requirements?: string[];
  featured?: boolean;
  updatedAt?: string;
}

export interface VaultPatternItem {
  id: string;
  name: string;
  category: string;
  description: string;
  author: string;
  tags: string[];
  codeSnippet: string;
  cssRules: string;
  usage?: string;
  targetStyles?: string[];
  updatedAt?: string;
}

export interface VaultInboxItem {
  id: string;
  url: string;
  title?: string;
  note?: string;
  suggestedType?: "resource" | "template" | "style" | "pattern" | "skill" | "unknown";
  suggestedCategory?: string;
  capturedAt: string;
  status: "pending" | "processed" | "rejected";
}

export type VaultSyncStatus = "idle" | "checking" | "syncing" | "success" | "error";

export interface VaultSyncResult {
  ok: boolean;
  updated: boolean;
  contentVersion: string;
  error?: string;
  fromCache?: boolean;
  /**
   * Set when the release checkpoint's pinned revision could not be fetched and
   * the sync succeeded against the un-pinned origin instead. The sync is still
   * a success — but the build is no longer reproducible, and the user should be
   * able to see that rather than it being a console.warn nobody reads.
   */
  pinFallback?: string;
  itemCounts?: {
    styles: number;
    resources: number;
    templates: number;
    patterns: number;
  };
}

export interface CachedVaultData {
  manifest: VaultManifest;
  syncedAt: string;
  styles: Record<string, VaultStyleManifest>;
  resources: Array<Record<string, unknown>>;
  templates: VaultTemplateItem[];
  patterns: VaultPatternItem[];
}
