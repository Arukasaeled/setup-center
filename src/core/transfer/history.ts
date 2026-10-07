/**
 * Setup Center — Unified Transfer History (Issues F09, K06)
 *
 * Records all concrete transfer events:
 * - Software installations
 * - Asset & tool downloads
 * - Template project scaffolds
 * - Vault content synchronizations
 * - Design system style activations
 *
 * Backed by PersonalStateManager single document transactions (`setup-center.personal-state.v2`).
 */

import type { TransferHistoryEntry } from "./types";
import { PersonalStateManager } from "./personalState";

const MAX_HISTORY_ENTRIES = 200;

type HistoryListener = (history: TransferHistoryEntry[]) => void;

class TransferHistoryManager {
  private listeners: Set<HistoryListener> = new Set();

  constructor() {
    PersonalStateManager.subscribe((doc) => {
      this.notify(doc.history);
    });
  }

  private notify(history?: TransferHistoryEntry[]): void {
    const list = history || this.getEntries();
    for (const listener of this.listeners) {
      try {
        listener(list);
      } catch (err) {
        console.error("[TransferHistory] Listener error:", err);
      }
    }
  }

  public subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getEntries(): TransferHistoryEntry[] {
    return [...PersonalStateManager.get().history];
  }

  public record(entry: Omit<TransferHistoryEntry, "id" | "timestamp">): TransferHistoryEntry {
    const fullEntry: TransferHistoryEntry = {
      ...entry,
      id: `tf:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    };

    PersonalStateManager.update((doc) => {
      doc.history.unshift(fullEntry);
      if (doc.history.length > MAX_HISTORY_ENTRIES) {
        doc.history = doc.history.slice(0, MAX_HISTORY_ENTRIES);
      }
    });

    return fullEntry;
  }

  public clear(): void {
    PersonalStateManager.update((doc) => {
      doc.history = [];
    });
  }
}

export const TransferHistory = new TransferHistoryManager();
