/**
 * Setup Center — UI Parts Repository
 *
 * Local-first authoritative storage and lifecycle management for visual and interaction parts.
 *
 * Architecture & Authority Rules:
 * 1. Tauri disk file (<AppLocalData>/uiparts/index.json) is the SINGLE AUTHORITATIVE PERSISTENT STATE.
 * 2. localStorage is STARTUP CACHE ONLY (for zero-latency instant rendering on cold boot).
 * 3. Atomic writes (write tmp -> flush -> replace) protect against partial write interruptions.
 * 4. Corrupted disk files are automatically preserved as uiparts.corrupt.<timestamp>.json,
 *    and recovered seamlessly via startup cache or reference seeds without white-screens.
 * 5. Media assets are stored as separate files under <AppLocalData>/uiparts/assets/<part-id>/,
 *    keeping index.json lean and performant while supporting full export/import re-inlining.
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
  getUIPartsInfo,
  loadUserUIParts,
  readUIPartAsset,
  saveUIPartAsset,
  saveUserUIParts,
} from "../../lib/ipc";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

const CACHE_KEY = "setup-center.ui-parts.cache.v1";
const LEGACY_CACHE_KEY = "setup-center.ui-parts.v1";
const SCHEMA_VERSION = 1;

const VALID_KINDS: UIPartKind[] = [
  "component",
  "layout",
  "composition",
  "navigation",
  "interaction",
  "typography",
  "status",
  "search",
  "card",
  "data-viz",
  "motion",
  "visual-rule",
  "other",
];

const VALID_LIFECYCLES: UIPartLifecycle[] = [
  "raw",
  "enriched",
  "prototyped",
  "validated",
];

type Listener = () => void;

class UIPartRepositoryClass {
  private parts: UIPart[] = [];
  private revision: number = 1;
  private schemaVersion: number = SCHEMA_VERSION;
  private updatedAt: string = new Date().toISOString();
  private initialized: boolean = false;
  private listeners: Set<Listener> = new Set();
  private assetUrlCache: Map<string, string> = new Map();

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
   */
  private hydrateFromStartupCacheSync(): void {
    if (typeof localStorage === "undefined") {
      this.parts = [...SEED_UI_PARTS];
      return;
    }

    try {
      // Try modern document cache first
      const rawDoc = localStorage.getItem(CACHE_KEY);
      if (rawDoc) {
        const parsed = JSON.parse(rawDoc);
        if (parsed && Array.isArray(parsed.parts) && parsed.parts.length > 0) {
          this.parts = parsed.parts;
          this.revision = typeof parsed.revision === "number" ? parsed.revision : 1;
          this.schemaVersion = parsed.schemaVersion || SCHEMA_VERSION;
          this.updatedAt = parsed.updatedAt || new Date().toISOString();
          return;
        }
      }

      // Try legacy array cache
      const rawLegacy = localStorage.getItem(LEGACY_CACHE_KEY);
      if (rawLegacy) {
        const parsedLegacy = JSON.parse(rawLegacy);
        if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
          this.parts = this.mergeWithSeeds(parsedLegacy);
          this.saveToStartupCacheOnly();
          return;
        }
      }
    } catch {
      // ignore JSON parse error on cold boot
    }

    // Default to seeds
    this.parts = [...SEED_UI_PARTS];
    this.saveToStartupCacheOnly();
  }

  /** Merges user parts with seed parts so starter parts are never lost */
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
   * Reads the disk index and reconciles according to authoritative rules.
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

      // Case A: Disk was corrupted!
      if (loadRes.is_corrupted) {
        console.warn(
          `[UIParts] Disk index was corrupted! Preserved backup at: ${loadRes.corrupted_backup}`,
        );

        // Check if startup cache was valid
        if (this.parts.length > 0) {
          this.recoveryState = {
            recovered: true,
            source: "cache",
            corruptedBackup: loadRes.corrupted_backup || undefined,
            message: `磁盘索引已损坏，已从本地高速缓存安全恢复（备份路径: ${loadRes.corrupted_backup || "已备份"}）`,
          };
        } else {
          this.parts = [...SEED_UI_PARTS];
          this.recoveryState = {
            recovered: true,
            source: "seed",
            corruptedBackup: loadRes.corrupted_backup || undefined,
            message: `磁盘索引与缓存均损坏，已安全恢复至参考标准零件集`,
          };
        }

        // Heal disk with the recovered snapshot
        await this.persistToDiskAndCache();
        this.notify();
        return;
      }

      // Case B: Disk has valid content -> DISK IS THE AUTHORITATIVE TRUTH!
      if (loadRes.content && loadRes.content.trim().length > 0) {
        try {
          const parsed = JSON.parse(loadRes.content);
          let diskParts: UIPart[] = [];
          let diskRevision = 1;

          if (parsed && Array.isArray(parsed.parts)) {
            // Modern document format
            diskParts = parsed.parts;
            diskRevision = typeof parsed.revision === "number" ? parsed.revision : 1;
            this.schemaVersion = parsed.schemaVersion || SCHEMA_VERSION;
            this.updatedAt = parsed.updatedAt || new Date().toISOString();
          } else if (Array.isArray(parsed)) {
            // Legacy bare array format
            diskParts = parsed;
            diskRevision = 1;
          }

          if (diskParts.length > 0) {
            this.parts = this.mergeWithSeeds(diskParts);
            this.revision = diskRevision;

            // Update startup cache with authoritative disk state
            this.saveToStartupCacheOnly();

            // Lazy migrate any legacy inline Data URLs in background
            void this.migrateLegacyDataUrls();

            this.notify();
            return;
          }
        } catch (parseErr) {
          console.warn("Failed to parse disk content despite check:", parseErr);
        }
      }

      // Case C: Disk is empty (First run in Tauri) -> write initial seeds
      if (this.parts.length === 0) {
        this.parts = [...SEED_UI_PARTS];
      }
      await this.persistToDiskAndCache();
      this.notify();
    } catch (err) {
      console.warn("Failed to load user uiparts from Tauri disk:", err);
    }
  }

  /**
   * Saves authoritative state to disk (atomic write via Tauri) and startup cache.
   */
  private async persistToDiskAndCache(): Promise<boolean> {
    this.revision += 1;
    this.updatedAt = new Date().toISOString();

    const doc: UIPartsStorageDocument = {
      schemaVersion: this.schemaVersion,
      revision: this.revision,
      updatedAt: this.updatedAt,
      parts: this.parts,
    };

    // Update startup cache
    this.saveToStartupCacheOnly();

    // Write to authoritative disk
    if (isTauri()) {
      try {
        const json = JSON.stringify(doc, null, 2);
        const res = await saveUserUIParts(json);
        if (res && res.success) {
          this.storageInfo.revision = this.revision;
          this.storageInfo.updatedAt = this.updatedAt;
          return true;
        }
      } catch (err) {
        console.error("Failed to write uiparts to disk atomically:", err);
        return false;
      }
    }
    return true;
  }

  /**
   * 4. Legacy Media Migration:
   * Migrates legacy inline Data URLs to native asset files on disk.
   */
  private async migrateLegacyDataUrls(): Promise<void> {
    if (!isTauri()) return;

    let modified = false;
    for (const part of this.parts) {
      if (part.preview?.thumbnail?.startsWith("data:image/")) {
        try {
          const ext = part.preview.thumbnail.includes("png") ? "png" : "jpg";
          const res = await saveUIPartAsset(part.id, `preview.${ext}`, part.preview.thumbnail);
          if (res) {
            // Cache data url for instant view
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
      await this.persistToDiskAndCache();
      this.notify();
    }
  }

  /**
   * Validates that an object satisfies minimum contract safety.
   */
  public static validateContract(data: any): { valid: boolean; error?: string } {
    if (!data || typeof data !== "object") {
      return { valid: false, error: "零件规范必须为 JSON 对象" };
    }
    if (!data.id || typeof data.id !== "string" || !data.id.trim()) {
      return { valid: false, error: "缺少必填字段: id (必须为非空字符串)" };
    }
    if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
      return { valid: false, error: "缺少必填字段: title (必须为非空字符串)" };
    }
    if (!data.kind || !VALID_KINDS.includes(data.kind)) {
      return {
        valid: false,
        error: `非法分类 kind: "${data.kind}"。合法值包括: ${VALID_KINDS.join(", ")}`,
      };
    }
    if (!data.lifecycle || !VALID_LIFECYCLES.includes(data.lifecycle)) {
      return {
        valid: false,
        error: `非法生命周期 lifecycle: "${data.lifecycle}"。合法值包括: ${VALID_LIFECYCLES.join(", ")}`,
      };
    }
    return { valid: true };
  }

  public validateContract(data: any): { valid: boolean; error?: string } {
    return UIPartRepositoryClass.validateContract(data);
  }

  /** Resolves relative asset path to a browser-renderable URL */
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
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
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

  /** Create a new part (defaults to lifecycle: "raw") */
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

    // Insert at beginning
    this.parts.unshift(newPart);
    await this.persistToDiskAndCache();
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

    // If thumbnail is updated with Data URL in native mode, write to asset storage
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

    // Safety contract check
    const validation = UIPartRepositoryClass.validateContract(updated);
    if (!validation.valid) {
      throw new Error(`更新失败: ${validation.error}`);
    }

    this.parts[index] = updated;
    await this.persistToDiskAndCache();
    this.notify();
    return updated;
  }

  /** Delete a part by ID */
  public async delete(id: string): Promise<boolean> {
    await this.init();

    const prevLength = this.parts.length;
    this.parts = this.parts.filter((p) => p.id !== id);
    if (this.parts.length !== prevLength) {
      await this.persistToDiskAndCache();
      this.notify();
      return true;
    }
    return false;
  }

  /**
   * 10. Package Round Trip:
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
      try {
        const dataUrl = await readUIPartAsset(exportPart.preview.thumbnail);
        if (dataUrl) {
          exportPart.preview.thumbnail = dataUrl;
        }
      } catch (err) {
        console.warn(`Failed to re-inline thumbnail for export (${id}):`, err);
      }
    }

    return {
      format: "uipart-package.v1",
      exportedAt: new Date().toISOString(),
      part: exportPart,
    };
  }

  /**
   * 5. Import Collision & Asset Extraction:
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
    const existingIndex = this.parts.findIndex((p) => p.id === incoming.id);

    if (existingIndex >= 0) {
      const existing = this.parts[existingIndex];

      // Check if identical content
      const isIdentical =
        existing.title === incoming.title &&
        existing.kind === incoming.kind &&
        existing.lifecycle === incoming.lifecycle &&
        existing.summary === incoming.summary &&
        JSON.stringify(existing.design) === JSON.stringify(incoming.design) &&
        JSON.stringify(existing.assets) === JSON.stringify(incoming.assets) &&
        JSON.stringify(existing.tags.sort()) === JSON.stringify(incoming.tags.sort());

      if (isIdentical) {
        console.log(`[UIParts] 导入发现完全一致的现有零件 (${incoming.id})，忽略重复导入。`);
        return existing;
      }

      // Different content -> Collision! Generate unique new local ID and preserve lineage
      const dateStamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
      const rand = Math.random().toString(36).substring(2, 6);
      const newId = `${incoming.id}~import-${dateStamp}-${rand}`;
      const originalId = incoming.id;

      incoming.id = newId;
      incoming.title = `${incoming.title} (导入副本)`;
      incoming.relationships = {
        ...(incoming.relationships || {}),
        derivedFrom: [originalId],
      };
      incoming.notes = (incoming.notes ? incoming.notes + "\n" : "") +
        `[导入冲突保护: 原 ID "${originalId}" 本地已存在且内容不同，已自动重命名为 "${newId}"]`;
    }

    // If incoming thumbnail has inlined Data URL, write to local asset file in Tauri
    if (incoming.preview?.thumbnail?.startsWith("data:image/") && isTauri()) {
      try {
        const ext = incoming.preview.thumbnail.includes("png") ? "png" : "jpg";
        const assetRes = await saveUIPartAsset(incoming.id, `preview.${ext}`, incoming.preview.thumbnail);
        if (assetRes) {
          this.assetUrlCache.set(assetRes.relative_path, incoming.preview.thumbnail);
          incoming.preview.thumbnail = assetRes.relative_path;
        }
      } catch (err) {
        console.warn(`Failed to extract imported asset to disk for ${incoming.id}:`, err);
      }
    }

    incoming.updatedAt = new Date().toISOString();
    this.parts.unshift(incoming);

    await this.persistToDiskAndCache();
    this.notify();
    return incoming;
  }

  /** Reset library to initial seeds (for testing or recovery) */
  public async resetToSeeds(): Promise<void> {
    this.parts = [...SEED_UI_PARTS];
    await this.persistToDiskAndCache();
    this.notify();
  }
}

export const UIPartRepository = new UIPartRepositoryClass();
