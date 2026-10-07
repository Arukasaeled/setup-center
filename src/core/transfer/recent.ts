/**
 * Setup Center — Recently Viewed Tracker (Issues F09, K06)
 *
 * Tracks user inspection across Software, Repos, Resources, and Templates
 * to provide a frictionless "pick up where you left off" experience.
 * Backed by PersonalStateManager single document transactions (`setup-center.personal-state.v2`).
 */

import type { DiscoveryItem } from "../discovery/types";
import { PersonalStateManager } from "./personalState";

export interface RecentItem {
  id: string;
  title: string;
  type: string;
  category: string;
  subtitle?: string;
  visitedAt: string;
}

const MAX_RECENT_ITEMS = 30;

type RecentListener = (items: RecentItem[]) => void;

class RecentManager {
  private listeners: Set<RecentListener> = new Set();

  constructor() {
    PersonalStateManager.subscribe((doc) => {
      this.notify(doc.recent);
    });
  }

  private notify(items?: RecentItem[]): void {
    const list = items || this.getAll();
    for (const l of this.listeners) {
      try {
        l(list);
      } catch (err) {
        console.error("[RecentManager] error:", err);
      }
    }
  }

  public subscribe(listener: RecentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getAll(): RecentItem[] {
    return [...PersonalStateManager.get().recent];
  }

  public record(item: Omit<RecentItem, "visitedAt">, snapshot?: DiscoveryItem): void {
    const now = new Date().toISOString();
    const fullRecent: RecentItem = {
      ...item,
      visitedAt: now,
    };

    PersonalStateManager.update((doc) => {
      doc.recent = doc.recent.filter((i) => i.id !== item.id);
      doc.recent.unshift(fullRecent);
      if (doc.recent.length > MAX_RECENT_ITEMS) {
        doc.recent = doc.recent.slice(0, MAX_RECENT_ITEMS);
      }
      if (snapshot && snapshot.id) {
        doc.catalogItems[snapshot.id] = snapshot;
      }
    });
  }

  public clear(): void {
    PersonalStateManager.update((doc) => {
      doc.recent = [];
    });
  }
}

export const RecentTracker = new RecentManager();
