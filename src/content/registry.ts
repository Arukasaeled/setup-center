/**
 * Setup Center — Unified Content Registry (Single Source of Truth)
 *
 * Implements Issues D11, D13, D15, K04:
 * 1. Single source of truth for all content across Software, Styles, Resources,
 *    Templates, Patterns, Skills, and Learning guides.
 * 2. Enforces canonical ID conventions via idAliases.ts and supports alias lookup.
 * 3. Provides subscription and revision state so search index and UI react immediately.
 * 4. Records truthful metadata (unknown licenses, observed stars, verified actionTypes).
 */

import type { ContentItem, ContentType, ContentManifest } from "./types";
import { canonicalizeId, isSameContentId } from "./idAliases";
import { STYLE_REGISTRY, StyleRegistry } from "../styles";
import { RESOURCE_CATALOG } from "./resources";

type RegistryListener = (revision: number) => void;

class ContentRegistryManager {
  private items: Map<string, ContentItem> = new Map();
  private revision: number = 0;
  private listeners: Set<RegistryListener> = new Set();

  constructor() {
    this.seedInitialContent();
    try {
      StyleRegistry.subscribe(() => {
        this.syncStyles();
      });
    } catch {
      // safe fallback
    }
  }

  private syncStyles(): void {
    for (const style of StyleRegistry.getStyles()) {
      const canonicalId = canonicalizeId(style.id, "style");
      this.items.set(canonicalId, {
        id: canonicalId,
        type: "style",
        name: style.name,
        version: style.version,
        description: style.description,
        source: "style-registry",
        author: style.author,
        license: style.license || "unknown",
        lifecycle: "active",
        updatedAt: style.updatedAt,
        tags: style.tags,
        metadata: {
          styleId: style.id,
          implemented: style.implemented,
          palette: style.palette,
          inspiration: style.inspiration,
          designPrinciples: style.designPrinciples,
        },
      });
    }
    this.notify();
  }

  public getRevision(): number {
    return this.revision;
  }

  public subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public notify(): void {
    this.revision++;
    for (const listener of this.listeners) {
      try {
        listener(this.revision);
      } catch (err) {
        console.error("[ContentRegistry] Listener error:", err);
      }
    }
  }

  /**
   * Seed static content from existing registered style specifications and
   * curated resource catalogs.
   */
  private seedInitialContent(): void {
    // 1. Style Adapter -> ContentItem
    for (const style of STYLE_REGISTRY) {
      const canonicalId = canonicalizeId(style.id, "style");
      this.items.set(canonicalId, {
        id: canonicalId,
        type: "style",
        name: style.name,
        version: style.version,
        description: style.description,
        source: "builtin",
        author: style.author,
        license: style.license || "unknown",
        lifecycle: "active",
        updatedAt: style.updatedAt,
        tags: style.tags,
        metadata: {
          styleId: style.id,
          implemented: style.implemented,
          palette: style.palette,
          inspiration: style.inspiration,
          designPrinciples: style.designPrinciples,
        },
      });
    }

    // 2. Resource Adapter -> ContentItem
    for (const res of RESOURCE_CATALOG) {
      const canonicalId = canonicalizeId(res.id, "resource");
      this.items.set(canonicalId, {
        id: canonicalId,
        type: "resource",
        name: res.name,
        version: res.version,
        description: res.description,
        source: res.repository ?? res.homepage ?? "community",
        author: res.author,
        license: res.license || "unknown",
        lifecycle: "discovered",
        updatedAt: res.updatedAt,
        homepage: res.homepage,
        repository: res.repository,
        tags: res.tags,
        metadata: {
          category: res.category,
          recommendedReason: res.recommendedReason,
          actionType: res.actionType,
          downloadUrl: res.downloadUrl,
          stars: res.stars,
          featured: res.featured,
        },
      });
    }

    this.revision++;
  }

  /**
   * Register or update a content item with canonical ID normalization.
   */
  public register(item: ContentItem): void {
    const canonicalId = canonicalizeId(item.id, item.type);
    const normalizedItem: ContentItem = {
      ...item,
      id: canonicalId,
      license: item.license || "unknown",
      lifecycle: item.lifecycle || "discovered",
    };
    this.items.set(canonicalId, normalizedItem);
    this.notify();
  }

  /**
   * Batch register multiple content items with a single notification.
   */
  public registerBatch(items: ContentItem[]): void {
    for (const item of items) {
      const canonicalId = canonicalizeId(item.id, item.type);
      this.items.set(canonicalId, {
        ...item,
        id: canonicalId,
        license: item.license || "unknown",
        lifecycle: item.lifecycle || "discovered",
      });
    }
    this.notify();
  }

  /**
   * Atomic replacement of all items belonging to a specific origin/source.
   * Purges items previously attributed to `origin` and registers the fresh batch.
   * Implements Issue D09 (Replace semantics for remote Vault updates).
   */
  public replaceOrigin(origin: string, items: ContentItem[], shouldNotify = true): void {
    for (const [key, item] of Array.from(this.items.entries())) {
      if (item.source === origin) {
        this.items.delete(key);
      }
    }
    for (const item of items) {
      const canonicalId = canonicalizeId(item.id, item.type);
      this.items.set(canonicalId, {
        ...item,
        id: canonicalId,
        source: origin,
        license: item.license || "unknown",
        lifecycle: item.lifecycle || "discovered",
      });
    }
    if (shouldNotify) this.notify();
  }

  /** Restore only keys affected by a vault transaction, including overwritten built-ins. */
  public restoreItems(snapshot: Map<string, ContentItem | undefined>): void {
    for (const [id, item] of snapshot) {
      if (item) this.items.set(id, item);
      else this.items.delete(id);
    }
  }

  /**
   * Clear all items attributed to a specific origin/source.
   */
  public clearOrigin(origin: string): void {
    let modified = false;
    for (const [key, item] of Array.from(this.items.entries())) {
      if (item.source === origin) {
        this.items.delete(key);
        modified = true;
      }
    }
    if (modified) {
      this.notify();
    }
  }

  /**
   * Retrieves an item by canonical ID, alias, or slug.
   */
  public get(id: string): ContentItem | undefined {
    if (!id) return undefined;
    const direct = this.items.get(id);
    if (direct) return direct;

    const canonical = canonicalizeId(id);
    const canonicalMatch = this.items.get(canonical);
    if (canonicalMatch) return canonicalMatch;

    // Fallback: search for alias matches
    for (const item of this.items.values()) {
      if (isSameContentId(item.id, id)) {
        return item;
      }
    }
    return undefined;
  }

  /**
   * List all items of a specific ContentType.
   */
  public listByType(type: ContentType): ContentItem[] {
    return Array.from(this.items.values()).filter((item) => item.type === type);
  }

  /**
   * List all content items in the registry.
   */
  public listAll(): ContentItem[] {
    return Array.from(this.items.values());
  }

  /**
   * Export immutable manifest snapshot.
   */
  public exportManifest(): ContentManifest {
    return {
      manifestVersion: "1.0.0",
      schemaVersion: "1.0.0",
      publishedAt: new Date().toISOString(),
      items: this.listAll(),
    };
  }
}

export const ContentRegistry = new ContentRegistryManager();
