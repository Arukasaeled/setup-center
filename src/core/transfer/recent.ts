/**
 * Setup Center — Recently Viewed Tracker
 *
 * Tracks user inspection across Software, Repos, Resources, and Templates
 * to provide a frictionless "pick up where you left off" experience.
 */

export interface RecentItem {
  id: string;
  title: string;
  type: string;
  category: string;
  subtitle?: string;
  visitedAt: string;
}

const RECENT_STORAGE_KEY = "setup-center.recent-viewed.v1";
const MAX_RECENT_ITEMS = 30;

type RecentListener = (items: RecentItem[]) => void;

class RecentManager {
  private items: RecentItem[] = [];
  private listeners: Set<RecentListener> = new Set();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(RECENT_STORAGE_KEY);
      if (raw) {
        this.items = JSON.parse(raw);
      }
    } catch {
      this.items = [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // ignore
    }
  }

  private notify(): void {
    const list = this.getAll();
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
    return [...this.items];
  }

  public record(item: Omit<RecentItem, "visitedAt">): void {
    const now = new Date().toISOString();
    // Remove if already exists
    this.items = this.items.filter((i) => i.id !== item.id);
    // Add to front
    this.items.unshift({
      ...item,
      visitedAt: now,
    });
    if (this.items.length > MAX_RECENT_ITEMS) {
      this.items = this.items.slice(0, MAX_RECENT_ITEMS);
    }
    this.save();
    this.notify();
  }

  public clear(): void {
    this.items = [];
    this.save();
    this.notify();
  }
}

export const RecentTracker = new RecentManager();
