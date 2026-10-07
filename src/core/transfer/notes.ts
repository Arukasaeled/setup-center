/**
 * Setup Center — Personal Notes Manager (Issues F09, K06)
 *
 * Lightweight personal annotations on Software, Repos, Resources, and Templates.
 * Backed by PersonalStateManager single document transactions (`setup-center.personal-state.v2`).
 */

import { PersonalStateManager } from "./personalState";

type NotesListener = (notes: Record<string, string>) => void;

class NotesManager {
  private listeners: Set<NotesListener> = new Set();

  constructor() {
    PersonalStateManager.subscribe((doc) => {
      this.notify(doc.notes);
    });
  }

  private notify(notes?: Record<string, string>): void {
    const data = notes || this.getAll();
    for (const l of this.listeners) {
      try {
        l(data);
      } catch (err) {
        console.error("[NotesManager] error:", err);
      }
    }
  }

  public subscribe(listener: NotesListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public get(id: string): string {
    return PersonalStateManager.get().notes[id] || "";
  }

  public set(id: string, text: string): void {
    const trimmed = text.trim();
    PersonalStateManager.update((doc) => {
      if (!trimmed) {
        delete doc.notes[id];
      } else {
        doc.notes[id] = trimmed;
      }
    });
  }

  public has(id: string): boolean {
    return Boolean(PersonalStateManager.get().notes[id]?.trim());
  }

  public getAll(): Record<string, string> {
    return { ...PersonalStateManager.get().notes };
  }
}

export const PersonalNotes = new NotesManager();
