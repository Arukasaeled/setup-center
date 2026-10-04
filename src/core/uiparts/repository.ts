/**
 * Setup Center — UI Parts Repository
 *
 * Local-first storage and lifecycle management for visual and interaction parts.
 * Persists to Tauri AppData workspace (%USERPROFILE%/AppData/Local/Setup Center/uiparts.json)
 * with robust browser localStorage and in-memory fallbacks.
 */

import { SEED_UI_PARTS } from "./seedData";
import type {
  UIPart,
  UIPartFilterQuery,
  UIPartPackage,
} from "./types";
import { loadUserUIParts, saveUserUIParts } from "../../lib/ipc";

const STORAGE_KEY = "setup-center.ui-parts.v1";

type Listener = () => void;

class UIPartRepositoryClass {
  private parts: UIPart[] = [];
  private initialized: boolean = false;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.hydrateFromLocalStorageSync();
  }

  /** Synchronous hydration from localStorage so UI never flashes empty */
  private hydrateFromLocalStorageSync(): void {
    if (typeof localStorage === "undefined") {
      this.parts = [...SEED_UI_PARTS];
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.parts = this.mergeWithSeeds(parsed);
          return;
        }
      }
    } catch {
      // ignore JSON parse error
    }
    this.parts = [...SEED_UI_PARTS];
    this.persistSync();
  }

  /** Merges user parts with seed parts to ensure seed parts are always available while preserving custom parts */
  private mergeWithSeeds(existing: UIPart[]): UIPart[] {
    const existingMap = new Map(existing.map((p) => [p.id, p]));
    const result: UIPart[] = [...existing];

    for (const seed of SEED_UI_PARTS) {
      if (!existingMap.has(seed.id)) {
        result.push(seed);
      }
    }
    return result;
  }

  /** Subscribe to repository changes */
  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error("Error in UIPartRepository listener:", err);
      }
    }
  }

  /** Async initialization from Tauri file storage if available */
  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const tauriRaw = await loadUserUIParts();
      if (tauriRaw && tauriRaw.trim().length > 0) {
        const parsed = JSON.parse(tauriRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.parts = this.mergeWithSeeds(parsed);
          this.persistSync();
          this.notify();
          return;
        }
      }
    } catch (err) {
      console.warn("Failed to read user uiparts from Tauri, falling back to local storage:", err);
    }

    // If Tauri was empty but we had local parts, save them to Tauri
    if (this.parts.length > 0) {
      void saveUserUIParts(JSON.stringify(this.parts, null, 2));
    }
  }

  /** Synchronous persistence to localStorage and async Tauri background write */
  private persistSync(): void {
    const json = JSON.stringify(this.parts);
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, json);
      } catch (err) {
        console.warn("localStorage quota exceeded for UIParts:", err);
      }
    }
    void saveUserUIParts(JSON.stringify(this.parts, null, 2));
  }

  /** List parts synchronously from memory */
  public listSync(query?: UIPartFilterQuery): UIPart[] {
    let result = [...this.parts];

    if (!query) return result;

    if (query.kind && query.kind !== "all") {
      result = result.filter((p) => p.kind === query.kind);
    }

    if (query.lifecycle && query.lifecycle !== "all") {
      result = result.filter((p) => p.lifecycle === query.lifecycle);
    }

    if (query.tag && query.tag.trim()) {
      const tagLower = query.tag.trim().toLowerCase();
      result = result.filter((p) => p.tags.some((t) => t.toLowerCase() === tagLower));
    }

    if (query.search && query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.summary?.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          p.notes?.toLowerCase().includes(q),
      );
    }

    return result;
  }

  /** Async list parts */
  public async list(query?: UIPartFilterQuery): Promise<UIPart[]> {
    await this.init();
    return this.listSync(query);
  }

  /** Get part by ID */
  public async get(id: string): Promise<UIPart | null> {
    await this.init();
    return this.parts.find((p) => p.id === id) || null;
  }

  /** Create a new part (defaults to lifecycle: "raw") */
  public async create(
    input: Partial<UIPart> & { title: string },
  ): Promise<UIPart> {
    await this.init();

    const now = new Date().toISOString();
    const slug = input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "custom-part";
    const id = input.id || `part-${slug}-${Date.now().toString(36)}`;

    const newPart: UIPart = {
      id,
      title: input.title,
      lifecycle: input.lifecycle || "raw",
      kind: input.kind || "component",
      summary: input.summary || "",
      sources: input.sources || [],
      preview: input.preview || {},
      tags: input.tags || [],
      notes: input.notes || "",
      design: input.design,
      implementation: input.implementation,
      evidence: input.evidence,
      assets: input.assets,
      exports: input.exports || { package: "available" },
      relationships: input.relationships,
      realityTest: input.realityTest,
      createdAt: now,
      updatedAt: now,
    };

    // Insert at beginning so newest appears first in gallery
    this.parts.unshift(newPart);
    this.persistSync();
    this.notify();
    return newPart;
  }

  /** Update an existing part */
  public async update(id: string, patch: Partial<UIPart>): Promise<UIPart> {
    await this.init();

    const index = this.parts.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new Error(`UIPart with id "${id}" not found.`);
    }

    const current = this.parts[index];
    const updated: UIPart = {
      ...current,
      ...patch,
      id: current.id, // prevent changing ID
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.parts[index] = updated;
    this.persistSync();
    this.notify();
    return updated;
  }

  /** Delete a part by ID */
  public async delete(id: string): Promise<boolean> {
    await this.init();

    const prevLength = this.parts.length;
    this.parts = this.parts.filter((p) => p.id !== id);
    if (this.parts.length !== prevLength) {
      this.persistSync();
      this.notify();
      return true;
    }
    return false;
  }

  /** Export part as Portable UIPart Package object */
  public async exportPackage(id: string): Promise<UIPartPackage> {
    const part = await this.get(id);
    if (!part) {
      throw new Error(`UIPart with id "${id}" not found for export.`);
    }

    return {
      format: "uipart-package.v1",
      exportedAt: new Date().toISOString(),
      part,
    };
  }

  /** Import a Portable UIPart Package object */
  public async importPackage(pkg: UIPartPackage): Promise<UIPart> {
    await this.init();

    if (!pkg || pkg.format !== "uipart-package.v1" || !pkg.part || !pkg.part.title) {
      throw new Error("Invalid UIPart package format.");
    }

    const incoming = pkg.part;
    const existingIndex = this.parts.findIndex((p) => p.id === incoming.id);

    if (existingIndex >= 0) {
      this.parts[existingIndex] = {
        ...incoming,
        updatedAt: new Date().toISOString(),
      };
    } else {
      this.parts.unshift(incoming);
    }

    this.persistSync();
    this.notify();
    return incoming;
  }

  /** Reset library to initial seeds (for testing or recovery) */
  public async resetToSeeds(): Promise<void> {
    this.parts = [...SEED_UI_PARTS];
    this.persistSync();
    this.notify();
  }
}

export const UIPartRepository = new UIPartRepositoryClass();
