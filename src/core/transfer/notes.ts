/**
 * Setup Center — Personal Notes Manager
 *
 * Lightweight personal annotations on Software, Repos, Resources, and Templates.
 */

const NOTES_STORAGE_KEY = "setup-center.item-notes.v1";

type NotesListener = (notes: Record<string, string>) => void;

class NotesManager {
  private notes: Record<string, string> = {};
  private listeners: Set<NotesListener> = new Set();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY);
      if (raw) {
        this.notes = JSON.parse(raw);
      }
    } catch {
      this.notes = {};
    }
  }

  private save(): void {
    try {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(this.notes));
    } catch {
      // ignore
    }
  }

  private notify(): void {
    const data = { ...this.notes };
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
    return this.notes[id] || "";
  }

  public set(id: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      delete this.notes[id];
    } else {
      this.notes[id] = trimmed;
    }
    this.save();
    this.notify();
  }

  public has(id: string): boolean {
    return Boolean(this.notes[id]?.trim());
  }

  public getAll(): Record<string, string> {
    return { ...this.notes };
  }
}

export const PersonalNotes = new NotesManager();
