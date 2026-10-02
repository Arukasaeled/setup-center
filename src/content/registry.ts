import type { ContentItem, ContentType, ContentManifest } from "./types";
import { STYLE_REGISTRY } from "../styles";

/**
 * In-memory unified Content Registry skeleton.
 *
 * Bridges currently built-in styles, software descriptors, and future
 * modular assets into a single queryable catalog.
 */
class ContentRegistryManager {
  private items: Map<string, ContentItem> = new Map();

  constructor() {
    this.seedInitialContent();
  }

  /**
   * Seed static content from existing registered style specifications.
   */
  private seedInitialContent(): void {
    for (const style of STYLE_REGISTRY) {
      this.register({
        id: `style:${style.id}`,
        type: "style",
        name: style.name,
        version: style.version,
        description: style.description,
        source: "builtin",
        author: style.author,
        license: "MIT",
        updatedAt: "2026-10-02",
        tags: style.tags,
        metadata: {
          styleId: style.id,
          implemented: style.implemented,
        },
      });
    }
  }

  public register(item: ContentItem): void {
    this.items.set(item.id, item);
  }

  public get(id: string): ContentItem | undefined {
    return this.items.get(id);
  }

  public listByType(type: ContentType): ContentItem[] {
    return Array.from(this.items.values()).filter((item) => item.type === type);
  }

  public listAll(): ContentItem[] {
    return Array.from(this.items.values());
  }

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
