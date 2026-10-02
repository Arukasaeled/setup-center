/**
 * Setup Center — Unified Transfer History
 *
 * Records all concrete transfer events:
 * - Software installations
 * - Asset & tool downloads
 * - Template project scaffolds
 * - Vault content synchronizations
 * - Design system style activations
 */

import type { TransferHistoryEntry } from "./types";

const HISTORY_STORAGE_KEY = "setup-center.transfer-history.v1";
const MAX_HISTORY_ENTRIES = 200;

type HistoryListener = (history: TransferHistoryEntry[]) => void;

class TransferHistoryManager {
  private entries: TransferHistoryEntry[] = [];
  private listeners: Set<HistoryListener> = new Set();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) {
        this.entries = JSON.parse(raw);
      }
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(this.entries.slice(0, MAX_HISTORY_ENTRIES)));
    } catch {
      // quota or local storage restriction
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.getEntries());
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
    return [...this.entries];
  }

  public record(entry: Omit<TransferHistoryEntry, "id" | "timestamp">): TransferHistoryEntry {
    const fullEntry: TransferHistoryEntry = {
      ...entry,
      id: `tf:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    this.entries.unshift(fullEntry);
    this.save();
    this.notify();
    return fullEntry;
  }

  public clear(): void {
    this.entries = [];
    this.save();
    this.notify();
  }
}

export const TransferHistory = new TransferHistoryManager();
