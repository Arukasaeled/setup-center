/**
 * Setup Center — Personal Catalog & Saved Discovery Items (Issues F09, K06)
 *
 * Persists full snapshots of discovered Software, Repos, Resources, and Templates.
 * Backed by PersonalStateManager single document transactions (`setup-center.personal-state.v2`).
 * Ensures dynamically discovered online items (GitHub repos, Winget packages) survive
 * restarts and remain fully inspectable and actionable in My Library and Recent.
 */

import type { DiscoveryItem } from "../discovery/types";
import type { AvailabilityEvidence, PackageObservation } from "../../lib/types";
import { PersonalStateManager } from "./personalState";

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
  availabilityEvidence?: AvailabilityEvidence;
  packageObservation?: PackageObservation;
  actionOutcome?: string;
}

type CatalogListener = () => void;

class PersonalCatalogManager {
  private listeners: Set<CatalogListener> = new Set();

  constructor() {
    PersonalStateManager.subscribe(() => {
      this.notify();
    });
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
    PersonalStateManager.update((doc) => {
      doc.catalogItems[item.id] = item;
    });
  }

  public getItem(id: string): DiscoveryItem | undefined {
    return PersonalStateManager.get().catalogItems[id];
  }

  public getAllItems(): DiscoveryItem[] {
    return Object.values(PersonalStateManager.get().catalogItems);
  }

  public removeItem(id: string): boolean {
    const exists = Boolean(PersonalStateManager.get().catalogItems[id]);
    if (!exists) return false;
    PersonalStateManager.update((doc) => {
      delete doc.catalogItems[id];
    });
    return true;
  }

  // --- DynamicSoftware Persistence ---

  public saveSoftware(sw: DynamicSoftware): void {
    if (!sw || !sw.id) return;

    PersonalStateManager.update((doc) => {
      doc.dynamicSoftware[sw.id] = sw;

      // Bridge as a DiscoveryItem snapshot so Unified Search can query it
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
      doc.catalogItems[sw.id] = item;
    });
  }

  public getSoftware(id: string): DynamicSoftware | undefined {
    return PersonalStateManager.get().dynamicSoftware[id];
  }

  public getAllSoftware(): DynamicSoftware[] {
    return Object.values(PersonalStateManager.get().dynamicSoftware);
  }

  public removeSoftware(id: string): boolean {
    const exists = Boolean(PersonalStateManager.get().dynamicSoftware[id]);
    if (!exists) return false;
    PersonalStateManager.update((doc) => {
      delete doc.dynamicSoftware[id];
      delete doc.catalogItems[id];
    });
    return true;
  }
}

export const PersonalCatalog = new PersonalCatalogManager();
