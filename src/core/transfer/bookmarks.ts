/**
 * Setup Center — Personal Bookmarks
 *
 * Persists user favorites across resources, styles, templates, and patterns.
 */

import { TransferHistory } from "./history";
import { PersonalCatalog } from "./catalog";
import type { DiscoveryItem } from "../discovery/types";

const BOOKMARKS_STORAGE_KEY = "setup-center.bookmarks.v1";

type BookmarkListener = (bookmarks: string[]) => void;

class BookmarkManager {
  private bookmarks: Set<string> = new Set();
  private listeners: Set<BookmarkListener> = new Set();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          this.bookmarks = new Set(arr);
        }
      }
    } catch {
      this.bookmarks = new Set();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(Array.from(this.bookmarks)));
    } catch {
      // ignore
    }
  }

  private notify(): void {
    const list = this.getAll();
    for (const listener of this.listeners) {
      try {
        listener(list);
      } catch (err) {
        console.error("[Bookmarks] Listener error:", err);
      }
    }
  }

  public subscribe(listener: BookmarkListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getAll(): string[] {
    return Array.from(this.bookmarks);
  }

  public isBookmarked(id: string): boolean {
    return this.bookmarks.has(id);
  }

  public toggle(id: string, name?: string, snapshot?: DiscoveryItem): boolean {
    let nowBookmarked = false;
    if (this.bookmarks.has(id)) {
      this.bookmarks.delete(id);
      nowBookmarked = false;
    } else {
      this.bookmarks.add(id);
      nowBookmarked = true;

      if (snapshot) {
        PersonalCatalog.saveItem(snapshot);
      }

      TransferHistory.record({
        type: "bookmark",
        title: "收藏资产",
        targetId: id,
        targetName: name ?? id,
        status: "info",
        summary: `已将「${name ?? id}」加入个人收藏清单`,
      });
    }
    this.save();
    this.notify();
    return nowBookmarked;
  }
}

export const Bookmarks = new BookmarkManager();
