/**
 * Setup Center — UI Parts Repository
 *
 * Local-first authoritative storage and lifecycle management for visual and interaction parts.
 *
 * Architecture & Authority Rules:
 * 1. Tauri disk file (<AppLocalData>/uiparts/index.json) is the SINGLE AUTHORITATIVE PERSISTENT STATE.
 * 2. localStorage is STARTUP CACHE ONLY (for zero-latency instant rendering on cold boot).
 * 3. Disk-first commit semantics: Mutations are validated, serialized, and written to disk FIRST.
 *    Only after disk write succeeds are in-memory state and localStorage cache committed.
 *    If disk write fails, in-memory state and cache are NOT mutated (untainted rollback).
 * 4. Atomic writes (write tmp -> flush -> atomic replace) protect against partial write interruptions.
 * 5. Corrupted disk files are automatically preserved as uiparts.corrupt.<timestamp>.json,
 *    and recovered seamlessly via startup cache (if valid) or standard reference seeds.
 * 6. Media assets are strictly contained within <AppLocalData>/uiparts/assets/<part-id>/<filename>,
 *    keeping index.json lean while supporting safe containment and full export/import re-inlining.
 */

import { SEED_UI_PARTS } from "./seedData";
import type {
  UIPart,
  UIPartFilterQuery,
  UIPartKind,
  UIPartLifecycle,
  UIPartPackage,
  UIPartsRecoveryState,
  UIPartsStorageDocument,
  UIPartsStorageInfo,
} from "./types";
import {
  deleteUIPartAssets,
  getUIPartsInfo,
  loadUserUIParts,
  readUIPartAsset,
  saveUIPartAsset,
  saveUserUIParts,
} from "../../lib/ipc";
import {
  VALID_KINDS,
  VALID_LIFECYCLES,
  detectImportCollision,
  inspectStartupCache,
  mergeWithSeeds,
  reconcileStorageState,
  validateAssetRelativePath,
  validateContract,
} from "./persistenceLogic";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

export { VALID_KINDS, VALID_LIFECYCLES, validateContract };
export type { UIPartKind, UIPartLifecycle };

const CACHE_KEY = "setup-center.ui-parts.cache.v1";
const LEGACY_CACHE_KEY = "setup-center.ui-parts.v1";
const SCHEMA_VERSION = 1;

type Listener = () => void;

export class UIPartRepositoryClass {
  private parts: UIPart[] = [];
  private revision: number = 1;
  private schemaVersion: number = SCHEMA_VERSION;
  private updatedAt: string = new Date().toISOString();
  private initialized: boolean = false;
  private listeners: Set<Listener> = new Set();
  private assetUrlCache: Map<string, string> = new Map();

  private cacheHydrationState: "valid" | "missing" | "invalid" = "missing";
  private hydratedFrom: "cache" | "legacy-cache" | "seed" = "seed";

  private storageInfo: UIPartsStorageInfo = {
    mode: isTauri() ? "tauri-disk" : "browser-fallback",
    revision: 1,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };

  private recoveryState: UIPartsRecoveryState = {
    recovered: false,
    source: "disk",
  };

  constructor() {
    this.hydrateFromStartupCacheSync();
  }

  /**
   * 1. Synchronous startup hydration from cache.
   * Ensures instant paint without awaiting Tauri IPC.
   *
   * Crucial safety rule: If cache is corrupted or malformed, we DO NOT immediately
   * overwrite localStorage with seeds in constructor. This preserves the invalid state
   * so authoritative reconciliation in init() knows cache was corrupted and can choose
   * recovery source accurately.
   */
  private hydrateFromStartupCacheSync(): void {
    if (typeof localStorage === "undefined") {
      this.parts = [...SEED_UI_PARTS];
      this.cacheHydrationState = "missing";
      this.hydratedFrom = "seed";
      return;
    }

    const rawDoc = localStorage.getItem(CACHE_KEY);
    const rawLegacy = localStorage.getItem(LEGACY_CACHE_KEY);

    const inspection = inspectStartupCache(rawDoc, rawLegacy);
    this.cacheHydrationState = inspection.state;
    this.hydratedFrom = inspection.hydratedFrom;

    if (inspection.state === "valid" && inspection.parts) {
      if (inspection.hydratedFrom === "legacy-cache") {
        this.parts = this.mergeWithSeeds(inspection.parts);
        this.saveToStartupCacheOnly();
      } else {
        this.parts = inspection.parts;
        this.revision = inspection.revision || 1;
        this.schemaVersion = inspection.schemaVersion || SCHEMA_VERSION;
        this.updatedAt = inspection.updatedAt || new Date().toISOString();
      }
      return;
    }

    // Default in-memory state to starter seeds for zero-latency instant render
    this.parts = [...SEED_UI_PARTS];
  }

  /** Merges user parts with seed parts so starter parts are never lost */
  public mergeWithSeeds(existing: UIPart[]): UIPart[] {
    return mergeWithSeeds(existing, SEED_UI_PARTS);
  }

  /** Writes the current snapshot strictly to localStorage cache */
  private saveToStartupCacheOnly(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const doc: UIPartsStorageDocument = {
        schemaVersion: this.schemaVersion,
        revision: this.revision,
        updatedAt: this.updatedAt,
        parts: this.parts,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(doc));
    } catch (err) {
      console.warn("Failed to write to localStorage startup cache:", err);
    }
  }

  /**
   * 2. Authoritative Disk Reconciliation on App Launch.
   * Reads the disk index and reconciles according to authoritative disk-first rules.
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Fetch storage info in native mode
    if (isTauri()) {
      try {
        const info = await getUIPartsInfo();
        if (info) {
          this.storageInfo = {
            mode: "tauri-disk",
            storageDir: info.storage_dir,
            indexFile: info.index_file,
            assetsDir: info.assets_dir,
            revision: this.revision,
            schemaVersion: this.schemaVersion,
            updatedAt: this.updatedAt,
          };
        }
      } catch (err) {
        console.warn("Failed to get uiparts info:", err);
      }
    }

    try {
      const loadRes = await loadUserUIParts();
      if (!loadRes) {
        // Browser fallback mode
        this.storageInfo.mode = "browser-fallback";
        return;
      }

      let diskDoc: UIPartsStorageDocument | null = null;
      let isCorrupted = loadRes.is_corrupted;

      if (!isCorrupted && loadRes.content && loadRes.content.trim().length > 0) {
        try {
          const parsed = JSON.parse(loadRes.content);
          if (parsed && Array.isArray(parsed.parts)) {
            diskDoc = parsed;
          } else if (Array.isArray(parsed)) {
            diskDoc = {
              schemaVersion: 1,
              revision: 1,
              updatedAt: new Date().toISOString(),
              parts: parsed,
            };
          } else {
            isCorrupted = true;
          }
        } catch {
          isCorrupted = true;
        }
      }

      let cacheDoc: UIPartsStorageDocument | null = null;
      if (this.cacheHydrationState === "valid" && typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem(CACHE_KEY);
          if (raw) cacheDoc = JSON.parse(raw);
        } catch {
          // ignore cache parse error
        }
      }

      const outcome = reconcileStorageState({
        diskDoc,
        cacheDoc,
        seedParts: SEED_UI_PARTS,
        isDiskCorrupted: isCorrupted,
        cacheHydrationState: this.cacheHydrationState,
        corruptBackupPath: loadRes.corrupted_backup,
      });

      this.recoveryState = outcome.recoveryState;

      if (outcome.action === "use-disk") {
        const mergedParts = this.mergeWithSeeds(outcome.activeDoc.parts);
        this.parts = mergedParts;
        this.revision = outcome.activeDoc.revision;
        this.schemaVersion = outcome.activeDoc.schemaVersion;
        this.updatedAt = outcome.activeDoc.updatedAt;
        this.storageInfo.revision = this.revision;
        this.storageInfo.updatedAt = this.updatedAt;

        // Synchronize startup cache to match disk truth
        this.saveToStartupCacheOnly();
        void this.migrateLegacyDataUrls();
        this.notify();
        return;
      }

      if (outcome.shouldWriteDisk) {
        await this.commitToStorage(outcome.activeDoc.parts);
      }
    } catch (err) {
      console.warn("Failed to load user uiparts from Tauri disk:", err);
    }
  }

  /**
   * 3. Disk-First Transactional Commit Semantics:
   *
   * Writes next candidate document to authoritative disk FIRST.
   * If disk write fails:
   *   - Throws error
   *   - In-memory parts, revision, updatedAt REMAIN UNCHANGED
   *   - Startup cache is NOT overwritten
   *   - Listeners are NOT notified
   * Only upon disk write success:
   *   - Updates in-memory state
   *   - Syncs startup cache
   *   - Notifies listeners
   */
  public async commitToStorage(candidateParts: UIPart[]): Promise<boolean> {
    const candidateRevision = this.revision + 1;
    const candidateUpdatedAt = new Date().toISOString();

    const candidateDoc: UIPartsStorageDocument = {
      schemaVersion: this.schemaVersion,
      revision: candidateRevision,
      updatedAt: candidateUpdatedAt,
      parts: candidateParts,
    };

    // 1. Authoritative disk write FIRST in Tauri
    if (isTauri()) {
      const json = JSON.stringify(candidateDoc, null, 2);
      const res = await saveUserUIParts(json);
      if (!res || !res.success) {
        const err = new Error("Failed to write UI parts to disk atomically via Tauri IPC");
        console.error("[UIParts] Disk write failed. In-memory state preserved without taint:", err);
        throw err;
      }
    }

    // 2. Commit in-memory authoritative state ONLY after disk succeeds
    this.parts = candidateParts;
    this.revision = candidateRevision;
    this.updatedAt = candidateUpdatedAt;
    this.storageInfo.revision = candidateRevision;
    this.storageInfo.updatedAt = candidateUpdatedAt;

    // 3. Update fast startup cache
    this.saveToStartupCacheOnly();

    // 4. Notify reactive UI listeners
    this.notify();
    return true;
  }

  /**
   * 4. Legacy Media Migration:
   * Migrates legacy inline Data URLs to native asset files on disk.
   */
  private async migrateLegacyDataUrls(): Promise<void> {
    if (!isTauri()) return;

    let modified = false;
    const nextParts: UIPart[] = JSON.parse(JSON.stringify(this.parts));

    for (const part of nextParts) {
      if (part.preview?.thumbnail?.startsWith("data:image/")) {
        try {
          const ext = part.preview.thumbnail.includes("png") ? "png" : "jpg";
          const res = await saveUIPartAsset(part.id, `preview.${ext}`, part.preview.thumbnail);
          if (res) {
            this.assetUrlCache.set(res.relative_path, part.preview.thumbnail);
            part.preview.thumbnail = res.relative_path;
            modified = true;
          }
        } catch (err) {
          console.warn(`Failed to migrate legacy asset for part ${part.id}:`, err);
        }
      }
    }

    if (modified) {
      await this.commitToStorage(nextParts);
    }
  }

  /**
   * Validates that an object satisfies minimum contract safety.
   */
  public static validateContract(data: any): { valid: boolean; error?: string } {
    return validateContract(data);
  }

  public validateContract(data: any): { valid: boolean; error?: string } {
    return UIPartRepositoryClass.validateContract(data);
  }

  /**
   * Resolves relative asset path to a browser-renderable URL with strict path containment.
   */
  public getResolvedAssetUrl(relativePathOrUrl?: string): string {
    if (!relativePathOrUrl) return "";
    if (
      relativePathOrUrl.startsWith("data:") ||
      relativePathOrUrl.startsWith("<svg") ||
      relativePathOrUrl.startsWith("http://") ||
      relativePathOrUrl.startsWith("https://")
    ) {
      return relativePathOrUrl;
    }

    // Path containment check: Reject traversals, absolute paths, illegal chars
    if (!validateAssetRelativePath(relativePathOrUrl)) {
      console.warn("[UIParts] Blocked invalid or traversing asset path:", relativePathOrUrl);
      return "";
    }

    const cached = this.assetUrlCache.get(relativePathOrUrl);
    if (cached) return cached;

    if (isTauri() && this.storageInfo?.storageDir) {
      const cleanRel = relativePathOrUrl.replace(/^[/\\]+/, "").replace(/\\/g, "/");
      const fullPath = `${this.storageInfo.storageDir}/${cleanRel}`;
      const assetUrl = convertFileSrc(fullPath);
      this.assetUrlCache.set(relativePathOrUrl, assetUrl);
      return assetUrl;
    }

    // Trigger async read as fallback
    if (isTauri()) {
      void readUIPartAsset(relativePathOrUrl).then((dataUrl) => {
        if (dataUrl) {
          this.assetUrlCache.set(relativePathOrUrl, dataUrl);
          this.notify();
        }
      });
    }

    return relativePathOrUrl;
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

  public getRecoveryState(): UIPartsRecoveryState {
    return this.recoveryState;
  }

  public getCacheHydrationState(): {
    state: "valid" | "missing" | "invalid";
    hydratedFrom: "cache" | "legacy-cache" | "seed";
  } {
    return {
      state: this.cacheHydrationState,
      hydratedFrom: this.hydratedFrom,
    };
  }

  public getStorageInfo(): UIPartsStorageInfo {
    return this.storageInfo;
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
          p.tags.some((t) => t.toLowerCase() === tagLower(q)) ||
          p.notes?.toLowerCase().includes(q) ||
          (p.design?.portablePrinciple &&
            (p.design.portablePrinciple.zh?.toLowerCase().includes(q) ||
              p.design.portablePrinciple.rule?.toLowerCase().includes(q))),
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

  /** Create a new part */
  public async create(
    input: Partial<UIPart> & { title: string },
  ): Promise<UIPart> {
    await this.init();

    const now = new Date().toISOString();
    const slug =
      input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "custom-part";
    const id = input.id || `part-${slug}-${Date.now().toString(36)}`;

    // Process media assets: If thumbnail is Data URL, write to native assets/<part-id>/
    let thumbnail = input.preview?.thumbnail;
    if (thumbnail?.startsWith("data:image/") && isTauri()) {
      try {
        const ext = thumbnail.includes("png") ? "png" : "jpg";
        const assetRes = await saveUIPartAsset(id, `preview.${ext}`, thumbnail);
        if (assetRes) {
          this.assetUrlCache.set(assetRes.relative_path, thumbnail);
          thumbnail = assetRes.relative_path;
        }
      } catch (err) {
        console.warn(`Failed to save asset file for ${id}:`, err);
      }
    }

    const newPart: UIPart = {
      id,
      title: input.title,
      lifecycle: input.lifecycle || "raw",
      kind: input.kind || "component",
      summary: input.summary || "",
      sources: input.sources || [],
      preview: {
        ...(input.preview || {}),
        thumbnail,
      },
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

    const validation = UIPartRepositoryClass.validateContract(newPart);
    if (!validation.valid) {
      throw new Error(`创建失败: ${validation.error}`);
    }

    const nextParts = [newPart, ...this.parts];
    await this.commitToStorage(nextParts);
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

    let thumbnail = patch.preview?.thumbnail ?? current.preview?.thumbnail;
    if (thumbnail?.startsWith("data:image/") && isTauri()) {
      try {
        const ext = thumbnail.includes("png") ? "png" : "jpg";
        const assetRes = await saveUIPartAsset(id, `preview.${ext}`, thumbnail);
        if (assetRes) {
          this.assetUrlCache.set(assetRes.relative_path, thumbnail);
          thumbnail = assetRes.relative_path;
        }
      } catch (err) {
        console.warn(`Failed to update asset file for ${id}:`, err);
      }
    }

    const updated: UIPart = {
      ...current,
      ...patch,
      id: current.id, // prevent changing ID
      preview: {
        ...(current.preview || {}),
        ...(patch.preview || {}),
        thumbnail,
      },
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    const validation = UIPartRepositoryClass.validateContract(updated);
    if (!validation.valid) {
      throw new Error(`更新失败: ${validation.error}`);
    }

    const nextParts = [...this.parts];
    nextParts[index] = updated;

    await this.commitToStorage(nextParts);
    return updated;
  }

  /** Delete a part by ID */
  public async delete(id: string): Promise<boolean> {
    await this.init();

    const prevLength = this.parts.length;
    const nextParts = this.parts.filter((p) => p.id !== id);
    if (nextParts.length === prevLength) {
      return false;
    }

    // 1. Commit metadata removal to disk first
    await this.commitToStorage(nextParts);

    // 2. Remove associated asset files on disk
    if (isTauri()) {
      try {
        await deleteUIPartAssets(id);
      } catch (err) {
        console.warn(`[UIParts] Metadata deleted, but failed to clean up assets for part ${id}:`, err);
      }
    }

    return true;
  }

  /**
   * Exports part as Portable UIPart Package object with re-inlined media assets.
   */
  public async exportPackage(id: string): Promise<UIPartPackage> {
    const part = await this.get(id);
    if (!part) {
      throw new Error(`UIPart with id "${id}" not found for export.`);
    }

    // Clone part so export is independent
    const exportPart: UIPart = JSON.parse(JSON.stringify(part));

    // If thumbnail references a native disk asset, re-inline it as Data URL for true portability!
    if (exportPart.preview?.thumbnail?.startsWith("assets/") && isTauri()) {
      if (validateAssetRelativePath(exportPart.preview.thumbnail)) {
        try {
          const dataUrl = await readUIPartAsset(exportPart.preview.thumbnail);
          if (dataUrl) {
            exportPart.preview.thumbnail = dataUrl;
          }
        } catch (err) {
          console.warn(`Failed to re-inline thumbnail for export (${id}):`, err);
        }
      }
    }

    return {
      format: "uipart-package.v1",
      exportedAt: new Date().toISOString(),
      part: exportPart,
    };
  }

  /**
   * Handles collision without silent overwrites, extracts inlined assets to local storage.
   */
  public async importPackage(pkg: UIPartPackage): Promise<UIPart> {
    await this.init();

    if (!pkg || pkg.format !== "uipart-package.v1" || !pkg.part) {
      throw new Error("非法包格式: 必须包含 format: 'uipart-package.v1' 与 part 字段");
    }

    const validation = UIPartRepositoryClass.validateContract(pkg.part);
    if (!validation.valid) {
      throw new Error(`导入包校验失败: ${validation.error}`);
    }

    const incoming: UIPart = JSON.parse(JSON.stringify(pkg.part));
    let partToInsert: UIPart = incoming;

    const existing = this.parts.find((p) => p.id === incoming.id);
    if (existing) {
      const collision = detectImportCollision(existing, incoming);
      if (collision.action === "ignore") {
        console.log(`[UIParts] 导入发现完全一致的现有零件 (${incoming.id})，忽略重复导入。`);
        return collision.part;
      }
      partToInsert = collision.part;
    }

    // If thumbnail has inlined Data URL, write to local asset file in Tauri
    if (partToInsert.preview?.thumbnail?.startsWith("data:image/") && isTauri()) {
      try {
        const ext = partToInsert.preview.thumbnail.includes("png") ? "png" : "jpg";
        const assetRes = await saveUIPartAsset(partToInsert.id, `preview.${ext}`, partToInsert.preview.thumbnail);
        if (assetRes) {
          this.assetUrlCache.set(assetRes.relative_path, partToInsert.preview.thumbnail);
          partToInsert.preview.thumbnail = assetRes.relative_path;
        }
      } catch (err) {
        console.warn(`Failed to extract imported asset to disk for ${partToInsert.id}:`, err);
      }
    }

    partToInsert.updatedAt = new Date().toISOString();
    const nextParts = [partToInsert, ...this.parts];

    await this.commitToStorage(nextParts);
    return partToInsert;
  }

  /** Reset library to initial seeds (for testing or recovery) */
  public async resetToSeeds(): Promise<void> {
    await this.commitToStorage([...SEED_UI_PARTS]);
  }
}

function tagLower(q: string): string {
  return q.toLowerCase();
}

export const UIPartRepository = new UIPartRepositoryClass();
