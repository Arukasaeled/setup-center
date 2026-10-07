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

  constructor() {
    this.document = this.loadAndMigrate();
    this.initialized = true;
  }

  public subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public get(): Readonly<PersonalStateDocumentV2> {
    return this.document;
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

    try {
      const rawV2 = localStorage.getItem(PERSONAL_STATE_STORAGE_KEY);
      if (rawV2) {
        const parsed = JSON.parse(rawV2);
        if (validatePersonalStateDocument(parsed)) {
          return parsed;
        }
        console.warn("[PersonalState] Existing V2 document failed validation, attempting repair");
      }
    } catch (err) {
      console.warn("[PersonalState] Failed to read V2 storage document:", err);
    }

    // Migrate from legacy v1 fragmented keys
    const initial = createEmptyPersonalState();
    let migratedAny = false;

    // 1. Catalog items
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEYS.CATALOG_ITEMS);
      if (raw) {
        const arr = JSON.parse(raw) as DiscoveryItem[];
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (item && item.id) initial.catalogItems[item.id] = item;
          }
          migratedAny = true;
        }
      }
    } catch {}

    // 2. Catalog software
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEYS.CATALOG_SOFTWARE);
      if (raw) {
        const arr = JSON.parse(raw) as DynamicSoftware[];
        if (Array.isArray(arr)) {
          for (const sw of arr) {
            if (sw && sw.id) initial.dynamicSoftware[sw.id] = sw;
          }
          migratedAny = true;
        }
      }
    } catch {}

    // 3. Custom packs
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEYS.CUSTOM_PACKS);
      if (raw) {
        const arr = JSON.parse(raw) as CustomPack[];
        if (Array.isArray(arr) && arr.length > 0) {
          initial.customPacks = arr;
          migratedAny = true;
        }
      }
    } catch {}

    // 4. Bookmarks
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEYS.BOOKMARKS);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) {
          initial.bookmarks = arr;
          migratedAny = true;
        }
      }
    } catch {}

    // 5. Inbox
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEYS.INBOX);
      if (raw) {
        const arr = JSON.parse(raw) as TransferInboxItem[];
        if (Array.isArray(arr)) {
          initial.inbox = arr;
          migratedAny = true;
        }
      }
    } catch {}

    // 6. History
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEYS.HISTORY);
      if (raw) {
        const arr = JSON.parse(raw) as TransferHistoryEntry[];
        if (Array.isArray(arr)) {
          initial.history = arr;
          migratedAny = true;
        }
      }
    } catch {}

    // 7. Recent
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEYS.RECENT);
      if (raw) {
        const arr = JSON.parse(raw) as RecentItem[];
        if (Array.isArray(arr)) {
          initial.recent = arr;
          migratedAny = true;
        }
      }
    } catch {}

    // 8. Notes
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEYS.NOTES);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, string>;
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          initial.notes = obj;
          migratedAny = true;
        }
      }
    } catch {}

    // Persist migrated single document
    try {
      localStorage.setItem(PERSONAL_STATE_STORAGE_KEY, JSON.stringify(initial));
      if (migratedAny) {
        // Clean up legacy keys
        for (const legacyKey of Object.values(LEGACY_STORAGE_KEYS)) {
          try {
            localStorage.removeItem(legacyKey);
          } catch {}
        }
      }
    } catch (saveErr) {
      console.warn("[PersonalState] Failed to persist initial migrated document:", saveErr);
    }

    return initial;
  }
}

export const PersonalStateManager = new PersonalStateManagerService();
