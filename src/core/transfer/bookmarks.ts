/**
 * Setup Center — Personal Bookmarks (Issues F09, K06)
 *
 * Persists user favorites across resources, styles, templates, and patterns.
 * Backed by PersonalStateManager single document transactions (`setup-center.personal-state.v2`).
 */

import { TransferHistory } from "./history";
import { PersonalCatalog } from "./catalog";
import type { DiscoveryItem } from "../discovery/types";
import { PersonalStateManager } from "./personalState";

type BookmarkListener = (bookmarks: string[]) => void;

class BookmarkManager {
  private listeners: Set<BookmarkListener> = new Set();

  constructor() {
    PersonalStateManager.subscribe((doc) => {
      this.notify(doc.bookmarks);
    });
  }

  private notify(bookmarks?: string[]): void {
    const list = bookmarks || this.getAll();
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
    return [...PersonalStateManager.get().bookmarks];
  }

  public isBookmarked(id: string): boolean {
    return PersonalStateManager.get().bookmarks.includes(id);
  }

  public toggle(id: string, name?: string, snapshot?: DiscoveryItem): boolean {
    let nowBookmarked = false;

    PersonalStateManager.update((doc) => {
      const idx = doc.bookmarks.indexOf(id);
      if (idx >= 0) {
        doc.bookmarks.splice(idx, 1);
        nowBookmarked = false;
      } else {
        doc.bookmarks.push(id);
        nowBookmarked = true;

        if (snapshot && snapshot.id) {
          doc.catalogItems[snapshot.id] = snapshot;
        }
      }
    });

    if (nowBookmarked) {
      TransferHistory.record({
        type: "bookmark",
        title: "收藏资产",
        targetId: id,
        targetName: name ?? id,
        status: "info",
        summary: `已将「${name ?? id}」加入个人收藏清单`,
      });
    }

    return nowBookmarked;
  }
}

export const Bookmarks = new BookmarkManager();
