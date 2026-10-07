/**
 * Setup Center — Personal State Single Document Transaction Manager (Issues F09, K06)
 *
 * Unifies all user-owned state (Catalog, Dynamic Software, Custom Packs, Bookmarks,
 * Inbox, History, Recent viewed, Notes) into a single transactional storage document:
 * `setup-center.personal-state.v2`.
 *
 * Guarantees:
 * 1. Single Document Atomicity: Multi-slice updates succeed together or fail together without split-brain.
 * 2. Honest Error Surfacing: Storage quota or permission failures throw explicit errors rather than silently swallowing.
 * 3. Contract Schema Validation: Validates state integrity before committing.
 * 4. Transparent Migration: Automatically migrates all legacy v1 fragmented keys on first load and safely retires them.
 */

import type { DiscoveryItem } from "../discovery/types";
import type { DynamicSoftware } from "./catalog";
import type { CustomPack } from "./packs";
import type { TransferHistoryEntry, TransferInboxItem } from "./types";
import type { RecentItem } from "./recent";

export const PERSONAL_STATE_STORAGE_KEY = "setup-center.personal-state.v2";

export const LEGACY_STORAGE_KEYS = {
  CATALOG_ITEMS: "setup-center.personal-catalog-items.v1",
  CATALOG_SOFTWARE: "setup-center.personal-catalog-software.v1",
  CUSTOM_PACKS: "setup-center.custom-packs.v1",
  BOOKMARKS: "setup-center.bookmarks.v1",
  INBOX: "setup-center.transfer-inbox.v1",
  HISTORY: "setup-center.transfer-history.v1",
  RECENT: "setup-center.recent-viewed.v1",
  NOTES: "setup-center.item-notes.v1",
} as const;

export interface PersonalStateDocumentV2 {
  schemaVersion: "2.0";
  updatedAt: string;
  catalogItems: Record<string, DiscoveryItem>;
  dynamicSoftware: Record<string, DynamicSoftware>;
  customPacks: CustomPack[];
  bookmarks: string[];
  inbox: TransferInboxItem[];
  history: TransferHistoryEntry[];
  recent: RecentItem[];
  notes: Record<string, string>;
}

export class PersonalStatePersistenceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PersonalStatePersistenceError";
  }
}

function createEmptyPersonalState(): PersonalStateDocumentV2 {
  return {
    schemaVersion: "2.0",
    updatedAt: new Date().toISOString(),
    catalogItems: {},
    dynamicSoftware: {},
    customPacks: [
      {
        id: "pack-ai-starter",
        title: "全能 AI 编程起步包",
        description: "涵盖大模型本地推理、AI 编辑器与最常用前端框架的开箱组合。",
        items: [
          {
            id: "sw:cursor",
            name: "Cursor",
            type: "software",
            category: "AI 编辑器",
            command: "winget install --id Anysphere.Cursor",
          },
          {
            id: "sw:ollama",
            name: "Ollama",
            type: "software",
            category: "AI 运行时",
            command: "winget install --id Ollama.Ollama",
          },
          {
            id: "res:shadcn-ui",
            name: "shadcn/ui",
            type: "resource",
            category: "components",
            url: "https://ui.shadcn.com",
          },
          {
            id: "res:tauri-react-template",
            name: "Tauri + React Starter",
            type: "template",
            category: "templates",
            command: "npm create tauri-app@latest",
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    bookmarks: [],
    inbox: [],
    history: [],
    recent: [],
    notes: {},
  };
}

export function validatePersonalStateDocument(doc: unknown): doc is PersonalStateDocumentV2 {
  if (!doc || typeof doc !== "object") return false;
  const d = doc as Record<string, unknown>;
  if (d.schemaVersion !== "2.0") return false;
  if (typeof d.updatedAt !== "string") return false;
  if (!d.catalogItems || typeof d.catalogItems !== "object" || Array.isArray(d.catalogItems)) return false;
  if (!d.dynamicSoftware || typeof d.dynamicSoftware !== "object" || Array.isArray(d.dynamicSoftware)) return false;
  if (!Array.isArray(d.customPacks)) return false;
  if (!Array.isArray(d.bookmarks)) return false;
  if (!Array.isArray(d.inbox)) return false;
  if (!Array.isArray(d.history)) return false;
  if (!Array.isArray(d.recent)) return false;
  if (!d.notes || typeof d.notes !== "object" || Array.isArray(d.notes)) return false;
  return true;
}

type StateChangeListener = (doc: Readonly<PersonalStateDocumentV2>) => void;

class PersonalStateManagerService {
  private document: PersonalStateDocumentV2;
  private listeners: Set<StateChangeListener> = new Set();
  private initialized = false;
  private readOnly = false;
  private readOnlyReason: string | null = null;

  constructor() {
    this.document = this.loadAndMigrate();
    this.initialized = true;
  }

  public isReadOnly(): boolean {
    return this.readOnly;
  }

  public getReadOnlyReason(): string | null {
    return this.readOnlyReason;
  }

  public subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public get(): Readonly<PersonalStateDocumentV2> {
    return JSON.parse(JSON.stringify(this.document));
  }

  private notify(): void {
    const snapshot = Object.freeze(JSON.parse(JSON.stringify(this.document)));
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error("[PersonalState] Listener notification error:", err);
      }
    }
  }

  /**
   * Commits an atomic mutation against the personal state document.
   * If persistence fails (e.g. disk quota or storage restriction), the in-memory state
   * is rolled back and an explicit PersonalStatePersistenceError is thrown.
   */
  public update<T>(mutator: (draft: PersonalStateDocumentV2) => T): T {
    if (this.readOnly) {
      throw new PersonalStatePersistenceError(
        `个人状态处于只读保护模式 (${this.readOnlyReason || "文档损坏或数据异常"})，已拒绝写入以防止覆盖或损坏原始数据`
      );
    }

    // Deep clone prior state for rollback guarantee
    const rollbackState: PersonalStateDocumentV2 = JSON.parse(JSON.stringify(this.document));
    const draft: PersonalStateDocumentV2 = JSON.parse(JSON.stringify(this.document));

    let result: T;
    try {
      result = mutator(draft);
    } catch (err) {
      throw new PersonalStatePersistenceError("执行个人状态变更失败", err);
    }

    draft.updatedAt = new Date().toISOString();

    if (!validatePersonalStateDocument(draft)) {
      throw new PersonalStatePersistenceError("个人状态变更未能通过契约校验，已中止写入");
    }

    try {
      if (typeof localStorage !== "undefined") {
        const serialized = JSON.stringify(draft);
        localStorage.setItem(PERSONAL_STATE_STORAGE_KEY, serialized);
      }
      this.document = draft;
      this.notify();
      return result;
    } catch (storageErr) {
      // Rollback to prior valid state
      this.document = rollbackState;
      const msg = storageErr instanceof Error ? storageErr.message : String(storageErr);
      this.readOnly = true;
      this.readOnlyReason = `写入本地存储失败，原始记录已保留：${msg}`;
      this.notify();
      throw new PersonalStatePersistenceError(`个人状态写入本地存储失败 (已回滚事务): ${msg}`, storageErr);
    }
  }

  /**
   * Loads state from storage, migrating legacy fragmented keys if needed.
   */
  private loadAndMigrate(): PersonalStateDocumentV2 {
    if (typeof localStorage === "undefined") {
      return createEmptyPersonalState();
    }

    let rawV2: string | null = null;
    try {
      rawV2 = localStorage.getItem(PERSONAL_STATE_STORAGE_KEY);
    } catch (readErr) {
      this.readOnly = true;
      this.readOnlyReason = `读取本地存储失败: ${readErr instanceof Error ? readErr.message : String(readErr)}`;
      console.warn("[PersonalState] " + this.readOnlyReason);
      return createEmptyPersonalState();
    }

    // 1. Separate V2 states: Valid vs Corrupt vs Missing
    if (rawV2 !== null) {
      try {
        const parsed = JSON.parse(rawV2);
        if (validatePersonalStateDocument(parsed)) {
          // Valid V2 document
          return parsed;
        }
        // Corrupt / failed validation: DO NOT overwrite with default document, DO NOT auto-repair!
        this.readOnly = true;
        this.readOnlyReason = "个人状态 V2 文档校验失败（可能已损坏），已开启只读保护以保留原始字节，拒绝覆盖写入";
        console.warn("[PersonalState] " + this.readOnlyReason);
        return this.extractBestEffortDocument(parsed);
      } catch (parseErr) {
        // Corrupt JSON: retain original raw bytes, DO NOT overwrite!
        this.readOnly = true;
        this.readOnlyReason = `个人状态 V2 文档 JSON 解析失败，已开启只读保护以保留原始数据: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`;
        console.warn("[PersonalState] " + this.readOnlyReason);
        return createEmptyPersonalState();
      }
    }

    // 2. V2 is missing: read 8 legacy keys and migrate
    return this.migrateFromLegacy();
  }

  private extractBestEffortDocument(rawObj: unknown): PersonalStateDocumentV2 {
    const fallback = createEmptyPersonalState();
    if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) {
      return fallback;
    }
    const d = rawObj as Record<string, unknown>;
    return {
      schemaVersion: "2.0",
      updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : fallback.updatedAt,
      catalogItems:
        d.catalogItems && typeof d.catalogItems === "object" && !Array.isArray(d.catalogItems)
          ? (d.catalogItems as Record<string, DiscoveryItem>)
          : {},
      dynamicSoftware:
        d.dynamicSoftware && typeof d.dynamicSoftware === "object" && !Array.isArray(d.dynamicSoftware)
          ? (d.dynamicSoftware as Record<string, DynamicSoftware>)
          : {},
      customPacks: Array.isArray(d.customPacks) ? (d.customPacks as CustomPack[]) : fallback.customPacks,
      bookmarks: Array.isArray(d.bookmarks) ? (d.bookmarks as string[]) : [],
      inbox: Array.isArray(d.inbox) ? (d.inbox as TransferInboxItem[]) : [],
      history: Array.isArray(d.history) ? (d.history as TransferHistoryEntry[]) : [],
      recent: Array.isArray(d.recent) ? (d.recent as RecentItem[]) : [],
      notes:
        d.notes && typeof d.notes === "object" && !Array.isArray(d.notes)
          ? (d.notes as Record<string, string>)
          : {},
    };
  }

  private migrateFromLegacy(): PersonalStateDocumentV2 {
    const initial = createEmptyPersonalState();

    try {
      // 1. Catalog items
      const rawCatalog = localStorage.getItem(LEGACY_STORAGE_KEYS.CATALOG_ITEMS);
      if (rawCatalog !== null) {
        const arr = JSON.parse(rawCatalog);
        if (!Array.isArray(arr)) {
          throw new Error("旧版目录条目数据格式错误 (不是数组)");
        }
        for (const item of arr) {
          if (!item || typeof item !== "object" || typeof item.id !== "string") {
            throw new Error("旧版目录条目元素缺失有效 id");
          }
          initial.catalogItems[item.id] = item as DiscoveryItem;
        }
      }

      // 2. Catalog software
      const rawSoftware = localStorage.getItem(LEGACY_STORAGE_KEYS.CATALOG_SOFTWARE);
      if (rawSoftware !== null) {
        const arr = JSON.parse(rawSoftware);
        if (!Array.isArray(arr)) {
          throw new Error("旧版软件目录数据格式错误 (不是数组)");
        }
        for (const sw of arr) {
          if (!sw || typeof sw !== "object" || typeof sw.id !== "string") {
            throw new Error("旧版软件条目元素缺失有效 id");
          }
          initial.dynamicSoftware[sw.id] = sw as DynamicSoftware;
        }
      }

      // 3. Custom packs (distinguish [] from missing)
      const rawPacks = localStorage.getItem(LEGACY_STORAGE_KEYS.CUSTOM_PACKS);
      if (rawPacks !== null) {
        const arr = JSON.parse(rawPacks);
        if (!Array.isArray(arr)) {
          throw new Error("旧版自定义包数据格式错误 (不是数组)");
        }
        for (const p of arr) {
          if (!p || typeof p !== "object" || typeof p.id !== "string" || typeof p.title !== "string") {
            throw new Error("旧版自定义包元素格式不合规");
          }
        }
        // Valid array: preserve empty array if [], do not reinsert default pack
        initial.customPacks = arr as CustomPack[];
      }

      // 4. Bookmarks
      const rawBookmarks = localStorage.getItem(LEGACY_STORAGE_KEYS.BOOKMARKS);
      if (rawBookmarks !== null) {
        const arr = JSON.parse(rawBookmarks);
        if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) {
          throw new Error("旧版收藏条目格式错误");
        }
        initial.bookmarks = arr;
      }

      // 5. Inbox
      const rawInbox = localStorage.getItem(LEGACY_STORAGE_KEYS.INBOX);
      if (rawInbox !== null) {
        const arr = JSON.parse(rawInbox);
        if (!Array.isArray(arr)) {
          throw new Error("旧版收件箱格式错误 (不是数组)");
        }
        for (const item of arr) {
          if (!item || typeof item !== "object" || typeof item.id !== "string") {
            throw new Error("旧版收件箱条目元素格式不合规");
          }
        }
        initial.inbox = arr as TransferInboxItem[];
      }

      // 6. History
      const rawHistory = localStorage.getItem(LEGACY_STORAGE_KEYS.HISTORY);
      if (rawHistory !== null) {
        const arr = JSON.parse(rawHistory);
        if (!Array.isArray(arr)) {
          throw new Error("旧版流转历史格式错误 (不是数组)");
        }
        for (const item of arr) {
          if (!item || typeof item !== "object" || typeof item.id !== "string") {
            throw new Error("旧版流转历史条目格式不合规");
          }
        }
        initial.history = arr as TransferHistoryEntry[];
      }

      // 7. Recent
      const rawRecent = localStorage.getItem(LEGACY_STORAGE_KEYS.RECENT);
      if (rawRecent !== null) {
        const arr = JSON.parse(rawRecent);
        if (!Array.isArray(arr)) {
          throw new Error("旧版最近浏览格式错误 (不是数组)");
        }
        for (const item of arr) {
          if (!item || typeof item !== "object" || typeof item.id !== "string") {
            throw new Error("旧版最近浏览条目格式不合规");
          }
        }
        initial.recent = arr as RecentItem[];
      }

      // 8. Notes
      const rawNotes = localStorage.getItem(LEGACY_STORAGE_KEYS.NOTES);
      if (rawNotes !== null) {
        const obj = JSON.parse(rawNotes);
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
          throw new Error("旧版笔记数据格式错误 (不是对象)");
        }
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v !== "string") {
            throw new Error(`旧版笔记条目内容非字符串: ${k}`);
          }
        }
        initial.notes = obj as Record<string, string>;
      }
    } catch (migrationErr) {
      // Abort migration on structural error, preserve all legacy keys
      this.readOnly = true;
      this.readOnlyReason = `旧版数据结构异常，已中止迁移并开启只读保护，保留全部原始旧 key: ${migrationErr instanceof Error ? migrationErr.message : String(migrationErr)}`;
      console.warn("[PersonalState] " + this.readOnlyReason);
      return initial;
    }

    // Persist single V2 document once all existing records converted successfully
    // Do NOT delete legacy keys, keep them as pre-migration backup!
    try {
      localStorage.setItem(PERSONAL_STATE_STORAGE_KEY, JSON.stringify(initial));
    } catch (saveErr) {
      this.readOnly = true;
      this.readOnlyReason = `持久化已迁移的 V2 个人状态文档失败: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`;
      console.warn("[PersonalState] " + this.readOnlyReason);
      return initial;
    }

    return initial;
  }
}

export const PersonalStateManager = new PersonalStateManagerService();
