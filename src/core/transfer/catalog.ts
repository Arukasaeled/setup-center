/**
 * Setup Center — Personal Catalog & Saved Discovery Items
 *
 * Persists full snapshots of discovered Software, Repos, Resources, and Templates.
 * Ensures dynamically discovered online items (GitHub repos, Winget packages) survive
 * restarts and remain fully inspectable and actionable in My Library and Recent.
 */

import type { DiscoveryItem } from "../discovery/types";

export interface DynamicSoftware {
  id: string; // Discovery ID e.g. "winget:Obsidian.Obsidian"
  packageId: string; // Provider Package ID e.g. "Obsidian.Obsidian"
  provider: "winget" | "github-release" | "official";
  name: string;
  publisher?: string;
  version?: string;
  description?: string;
  homepage?: string;
  license?: string;
  installerType?: string;
  installerUrl?: string;
  installerSha256?: string;
  installed?: boolean;
  installedVersion?: string;
  discoveredAt: string;
  lastVerifiedAt?: string;
}

const PERSONAL_ITEMS_STORAGE_KEY = "setup-center.personal-catalog-items.v1";
const PERSONAL_SOFTWARE_STORAGE_KEY = "setup-center.personal-catalog-software.v1";

type CatalogListener = () => void;

class PersonalCatalogManager {
  private items: Map<string, DiscoveryItem> = new Map();
  private software: Map<string, DynamicSoftware> = new Map();
  private listeners: Set<CatalogListener> = new Set();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const rawItems = localStorage.getItem(PERSONAL_ITEMS_STORAGE_KEY);
      if (rawItems) {
        const arr = JSON.parse(rawItems) as DiscoveryItem[];
        if (Array.isArray(arr)) {
          this.items = new Map(arr.map((item) => [item.id, item]));
        }
      }
    } catch {
      this.items = new Map();
    }

    try {
      const rawSw = localStorage.getItem(PERSONAL_SOFTWARE_STORAGE_KEY);
      if (rawSw) {
        const arr = JSON.parse(rawSw) as DynamicSoftware[];
        if (Array.isArray(arr)) {
          this.software = new Map(arr.map((sw) => [sw.id, sw]));
        }
      }
    } catch {
      this.software = new Map();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(
        PERSONAL_ITEMS_STORAGE_KEY,
        JSON.stringify(Array.from(this.items.values())),
      );
      localStorage.setItem(
        PERSONAL_SOFTWARE_STORAGE_KEY,
        JSON.stringify(Array.from(this.software.values())),
      );
    } catch {
      // ignore
    }
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (err) {
        console.error("[PersonalCatalog] listener error:", err);
      }
    }
  }

  public subscribe(listener: CatalogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- DiscoveryItem Snapshot Persistence ---

  public saveItem(item: DiscoveryItem): void {
    if (!item || !item.id) return;
    this.items.set(item.id, item);
    this.save();
    this.notify();
  }

  public getItem(id: string): DiscoveryItem | undefined {
    return this.items.get(id);
  }

  public getAllItems(): DiscoveryItem[] {
    return Array.from(this.items.values());
  }

  public removeItem(id: string): boolean {
    const deleted = this.items.delete(id);
    if (deleted) {
      this.save();
      this.notify();
    }
    return deleted;
  }

  // --- DynamicSoftware Persistence ---

  public saveSoftware(sw: DynamicSoftware): void {
    if (!sw || !sw.id) return;
    this.software.set(sw.id, sw);

    // Also bridge as a DiscoveryItem snapshot so Unified Search can query it
    const item: DiscoveryItem = {
      id: sw.id,
      title: sw.name,
      subtitle: sw.packageId,
      description: sw.description || `${sw.publisher || "Windows 软件源"} · ${sw.packageId}`,
      category: "software",
      categoryLabel: "动态软件",
      type: "software",
      tags: [sw.provider, "software", ...(sw.publisher ? [sw.publisher] : [])],
      installed: sw.installed,
      installedVersion: sw.installedVersion,
      origin: {
        type: sw.provider === "winget" ? "winget" : sw.provider === "github-release" ? "github" : "builtin",
        packageId: sw.packageId,
        url: sw.homepage,
      },
    };
    this.items.set(sw.id, item);

    this.save();
    this.notify();
  }

  public getSoftware(id: string): DynamicSoftware | undefined {
    return this.software.get(id);
  }

  public getAllSoftware(): DynamicSoftware[] {
    return Array.from(this.software.values());
  }

  public removeSoftware(id: string): boolean {
    const deleted = this.software.delete(id);
    this.items.delete(id);
    if (deleted) {
      this.save();
      this.notify();
    }
    return deleted;
  }
}

export const PersonalCatalog = new PersonalCatalogManager();
