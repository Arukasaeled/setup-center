/**
 * Setup Center — Transfer Inbox
 *
 * Captures raw external URLs, design inspirations, and candidate tools
 * into a staging queue before normalization into the Vault or App.
 */

import type { TransferInboxItem } from "./types";

const INBOX_STORAGE_KEY = "setup-center.transfer-inbox.v1";

type InboxListener = (items: TransferInboxItem[]) => void;

class TransferInboxManager {
  private items: TransferInboxItem[] = [];
  private listeners: Set<InboxListener> = new Set();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(INBOX_STORAGE_KEY);
      if (raw) {
        this.items = JSON.parse(raw);
      } else {
        // Seed initial items
        this.items = [
          {
            id: `inbox-${Date.now()}-1`,
            url: "https://github.com/astral-sh/rye",
            title: "Rye Python Manager",
            note: "Astral 团队早期的 Python 管理试验场，可与 uv 对比归档",
            suggestedType: "resource",
            suggestedCategory: "tools",
            capturedAt: new Date().toISOString(),
            status: "pending",
          },
          {
            id: `inbox-${Date.now()}-2`,
            url: "https://motion.dev",
            title: "Motion (Framer Motion)",
            note: "React 顶级物理动画库，需收录至动效分类",
            suggestedType: "resource",
            suggestedCategory: "animation",
            capturedAt: new Date().toISOString(),
            status: "pending",
          },
        ];
        this.save();
      }
    } catch {
      this.items = [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(INBOX_STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // ignore
    }
  }

  private notify(): void {
    const current = this.getAll();
    for (const listener of this.listeners) {
      try {
        listener(current);
      } catch (err) {
        console.error("[TransferInbox] Listener error:", err);
      }
    }
  }

  public subscribe(listener: InboxListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getAll(): TransferInboxItem[] {
    return [...this.items];
  }

  public add(item: Omit<TransferInboxItem, "id" | "capturedAt" | "status">): TransferInboxItem {
    const newItem: TransferInboxItem = {
      ...item,
      id: `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      capturedAt: new Date().toISOString(),
      status: "pending",
    };
    this.items.unshift(newItem);
    this.save();
    this.notify();
    return newItem;
  }

  public updateStatus(id: string, status: "pending" | "processed" | "rejected"): void {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.status = status;
      this.save();
      this.notify();
    }
  }

  public remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
    this.notify();
  }
}

export const TransferInbox = new TransferInboxManager();
