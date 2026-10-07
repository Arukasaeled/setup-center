/**
 * Setup Center — Transfer Inbox (Issues F09, K06)
 *
 * Captures raw external URLs, design inspirations, and candidate tools
 * into a staging queue before normalization into the Vault or App.
 * Backed by PersonalStateManager single document transactions (`setup-center.personal-state.v2`).
 */

import type { TransferInboxItem } from "./types";
import { PersonalStateManager } from "./personalState";

type InboxListener = (items: TransferInboxItem[]) => void;

class TransferInboxManager {
  private listeners: Set<InboxListener> = new Set();

  constructor() {
    PersonalStateManager.subscribe((doc) => {
      this.notify(doc.inbox);
    });
  }

  private notify(items?: TransferInboxItem[]): void {
    const current = items || this.getAll();
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
    return [...PersonalStateManager.get().inbox];
  }

  public add(item: Omit<TransferInboxItem, "id" | "capturedAt" | "status">): TransferInboxItem {
    const newItem: TransferInboxItem = {
      ...item,
      id: `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      capturedAt: new Date().toISOString(),
      status: "pending",
    };

    PersonalStateManager.update((doc) => {
      doc.inbox.unshift(newItem);
    });

    return newItem;
  }

  public updateStatus(id: string, status: "pending" | "processed" | "rejected"): void {
    PersonalStateManager.update((doc) => {
      const item = doc.inbox.find((i) => i.id === id);
      if (item) {
        item.status = status;
      }
    });
  }

  public remove(id: string): void {
    PersonalStateManager.update((doc) => {
      doc.inbox = doc.inbox.filter((i) => i.id !== id);
    });
  }
}

export const TransferInbox = new TransferInboxManager();
