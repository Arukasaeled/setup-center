/**
 * Setup Center — Vault Sync Engine & Orchestrator
 *
 * Implements the Runtime Content Update flow:
 * 1. Immediate offline-first cache activation
 * 2. Background comparison of remote manifest contentVersion
 * 3. Atomic collection fetching, schema validation, and cache persistence
 * 4. Runtime injection into Style and Content registries without app restart
 */

import type {
  CachedVaultData,
  VaultPatternItem,
  VaultStyleManifest,
  VaultSyncResult,
  VaultSyncStatus,
  VaultTemplateItem,
} from "./types";
import {
  loadVaultCache,
  saveVaultCache,
  loadVaultConfig,
  saveVaultConfig,
} from "./cache";
import { VaultClient } from "./client";
import { registerResourcesBatch, type ResourceItem } from "../../content/resources";
import { registerStyle, type SetupStyle } from "../../styles";
import { ContentRegistry } from "../../content/registry";
import { TransferHistory } from "../transfer/history";

type SyncListener = (status: VaultSyncStatus, result?: VaultSyncResult) => void;

class VaultSyncManager {
  private status: VaultSyncStatus = "idle";
  private listeners: Set<SyncListener> = new Set();
  private lastResult?: VaultSyncResult;
  private currentTemplates: VaultTemplateItem[] = [];
  private currentPatterns: VaultPatternItem[] = [];

  constructor() {
    // Automatically hydrate from offline cache on initialization
    this.hydrateFromCache();
  }

  public getStatus(): VaultSyncStatus {
    return this.status;
  }

  public getLastResult(): VaultSyncResult | undefined {
    return this.lastResult;
  }

  public getTemplates(): VaultTemplateItem[] {
    return this.currentTemplates;
  }

  public getPatterns(): VaultPatternItem[] {
    return this.currentPatterns;
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(status: VaultSyncStatus, result?: VaultSyncResult): void {
    this.status = status;
    if (result) this.lastResult = result;
    for (const listener of this.listeners) {
      try {
        listener(status, result);
      } catch (err) {
        console.error("[VaultSync] Listener error:", err);
      }
    }
  }

  /**
   * Activate local cache immediately on app startup
   */
  public hydrateFromCache(): boolean {
    const cached = loadVaultCache();
    if (!cached) return false;

    this.applyVaultData(cached);
    this.lastResult = {
      ok: true,
      updated: false,
      contentVersion: cached.manifest.contentVersion,
      fromCache: true,
      itemCounts: {
        styles: Object.keys(cached.styles).length,
        resources: cached.resources.length,
        templates: cached.templates.length,
        patterns: cached.patterns.length,
      },
    };
    return true;
  }

  /**
   * Synchronize with remote Setup Center Vault via Immutable Release Gate
   */
  public async sync(options?: { force?: boolean; remoteUrl?: string }): Promise<VaultSyncResult> {
    const config = loadVaultConfig();
    const rawVaultOrigin = (options?.remoteUrl || config.remoteUrl).replace(/\/+$/, "");
    const checkpointUrl = `${rawVaultOrigin.replace(/\/main\/?$/, "")}/main/releases/latest.json`;

    this.notify("checking");

    try {
      let targetBaseUrl = rawVaultOrigin;
      let releaseCheckpoint: {
        releaseVersion?: string;
        commitSha?: string;
        snapshotTag?: string;
        summary?: string;
      } | null = null;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const checkpointRes = await fetch(checkpointUrl, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        clearTimeout(timer);
        if (checkpointRes.ok) {
          releaseCheckpoint = await checkpointRes.json();
          if (releaseCheckpoint?.commitSha || releaseCheckpoint?.snapshotTag) {
            const pin = releaseCheckpoint.commitSha || releaseCheckpoint.snapshotTag;
            targetBaseUrl = `${rawVaultOrigin.replace(/\/main\/?$/, "")}/${pin}`;
          }
        }
      } catch {
        // network or offline, fallback to rawVaultOrigin
      }

      const client = new VaultClient(targetBaseUrl);
      const remoteManifest = await client.fetchManifest();
      const cached = loadVaultCache();

      const targetVersion = releaseCheckpoint?.releaseVersion || remoteManifest.contentVersion;

      // Check if update is needed
      if (!options?.force && cached && (cached.manifest.contentVersion === targetVersion || cached.manifest.contentVersion === remoteManifest.contentVersion)) {
        const result: VaultSyncResult = {
          ok: true,
          updated: false,
          contentVersion: cached.manifest.contentVersion,
          fromCache: true,
          itemCounts: {
            styles: Object.keys(cached.styles).length,
            resources: cached.resources.length,
            templates: cached.templates.length,
            patterns: cached.patterns.length,
          },
        };
        this.notify("idle", result);
        return result;
      }

      this.notify("syncing");

      // Fetch Styles
      const stylesRecord: Record<string, VaultStyleManifest> = {};
      if (remoteManifest.collections.styles?.items) {
        for (const itemRef of remoteManifest.collections.styles.items) {
          try {
            const styleManifest = await client.fetchAssetJson<VaultStyleManifest>(itemRef.path);
            if (itemRef.cssPath) {
              try {
                styleManifest.cssContent = await client.fetchAssetText(itemRef.cssPath);
              } catch (cssErr) {
                console.warn(`[VaultSync] Failed to fetch CSS for ${itemRef.id}:`, cssErr);
              }
            }
            stylesRecord[styleManifest.id] = styleManifest;
          } catch (err) {
            console.warn(`[VaultSync] Failed to fetch style ${itemRef.id}:`, err);
          }
        }
      }

      // Fetch Resources
      const resourcesList: ResourceItem[] = [];
      if (remoteManifest.collections.resources?.items) {
        for (const itemRef of remoteManifest.collections.resources.items) {
          try {
            const catItems = await client.fetchAssetJson<ResourceItem[]>(itemRef.path);
            if (Array.isArray(catItems)) {
              resourcesList.push(...catItems);
            }
          } catch (err) {
            console.warn(`[VaultSync] Failed to fetch resource cat ${itemRef.id}:`, err);
          }
        }
      }

      // Fetch Templates
      const templatesList: VaultTemplateItem[] = [];
      if (remoteManifest.collections.templates?.items) {
        for (const itemRef of remoteManifest.collections.templates.items) {
          try {
            const tpl = await client.fetchAssetJson<VaultTemplateItem>(itemRef.path);
            templatesList.push(tpl);
          } catch (err) {
            console.warn(`[VaultSync] Failed to fetch template ${itemRef.id}:`, err);
          }
        }
      }

      // Fetch Patterns
      const patternsList: VaultPatternItem[] = [];
      if (remoteManifest.collections.patterns?.items) {
        for (const itemRef of remoteManifest.collections.patterns.items) {
          try {
            const pat = await client.fetchAssetJson<VaultPatternItem>(itemRef.path);
            patternsList.push(pat);
          } catch (err) {
            console.warn(`[VaultSync] Failed to fetch pattern ${itemRef.id}:`, err);
          }
        }
      }

      const freshVaultData: CachedVaultData = {
        manifest: remoteManifest,
        syncedAt: new Date().toISOString(),
        styles: stylesRecord,
        resources: resourcesList as unknown as Array<Record<string, unknown>>,
        templates: templatesList,
        patterns: patternsList,
      };

      // Persist to local cache
      saveVaultCache(freshVaultData);
      saveVaultConfig({
        lastSyncTime: freshVaultData.syncedAt,
        lastSyncVersion: remoteManifest.contentVersion,
      });

      // Apply to memory registries
      this.applyVaultData(freshVaultData);

      const successResult: VaultSyncResult = {
        ok: true,
        updated: true,
        contentVersion: remoteManifest.contentVersion,
        fromCache: false,
        itemCounts: {
          styles: Object.keys(stylesRecord).length,
          resources: resourcesList.length,
          templates: templatesList.length,
          patterns: patternsList.length,
        },
      };

      TransferHistory.record({
        type: "sync",
        title: "Setup Vault 内容库同步成功",
        targetId: `vault-${remoteManifest.contentVersion}`,
        targetName: `Vault v${remoteManifest.contentVersion}`,
        status: "success",
        summary: `已同步最新批次资产 (Styles: ${Object.keys(stylesRecord).length}, Resources: ${resourcesList.length}, Templates: ${templatesList.length})`,
      });

      this.notify("success", successResult);
      return successResult;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn("[VaultSync] Sync encountered error, preserving cache:", errorMsg);

      const fallbackCached = loadVaultCache();
      const failResult: VaultSyncResult = {
        ok: false,
        updated: false,
        contentVersion: fallbackCached?.manifest?.contentVersion ?? "builtin",
        error: errorMsg,
        fromCache: Boolean(fallbackCached),
      };

      this.notify("error", failResult);
      return failResult;
    }
  }

  /**
   * Apply vault collections into runtime memory registries and DOM
   */
  private applyVaultData(data: CachedVaultData): void {
    // 1. Resources: Register into RESOURCE_CATALOG
    if (Array.isArray(data.resources) && data.resources.length > 0) {
      registerResourcesBatch(data.resources as unknown as ResourceItem[]);
      // Also register into unified ContentRegistry
      for (const res of data.resources as unknown as ResourceItem[]) {
        ContentRegistry.register({
          id: res.id,
          type: "resource",
          name: res.name,
          version: res.version,
          description: res.description,
          source: res.repository ?? res.homepage ?? "vault",
          author: res.author,
          license: res.license,
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
    }

    // 2. Styles: Inject CSS and register into STYLE_REGISTRY
    if (data.styles) {
      for (const styleId of Object.keys(data.styles)) {
        const s = data.styles[styleId];
        if (s.cssContent) {
          this.mountDynamicStyleCss(s.id, s.cssContent);
        }
        const setupStyle: SetupStyle = {
          id: s.id,
          name: s.name,
          version: s.version,
          subtitle: s.subtitle || "",
          description: s.description || "",
          author: s.author,
          license: s.license,
          updatedAt: s.updatedAt,
          implemented: s.implemented,
          inspiration: s.inspiration || "",
          tags: s.tags ?? [],
          features: s.features ?? [],
          palette: {
            baseBg: s.palette.bg,
            surface: s.palette.surface,
            cardBorder: s.palette.border,
            accent: s.palette.primary,
            text: s.palette.text,
          },
          tokens: {
            borderWidth: s.tokens?.borderWidth,
            hardShadow: s.tokens?.shadowDepth,
            borderRadius: s.tokens?.cardRadius,
            fontHeading: s.tokens?.fontHeading,
            fontBody: s.tokens?.fontBody,
          },
          designPrinciples: s.designPrinciples ?? [],
        };
        registerStyle(setupStyle);
      }
    }

    // 3. Templates & Patterns: Keep in memory
    this.currentTemplates = data.templates ?? [];
    this.currentPatterns = data.patterns ?? [];

    for (const tpl of this.currentTemplates) {
      ContentRegistry.register({
        id: tpl.id,
        type: "template",
        name: tpl.name,
        description: tpl.description,
        source: tpl.repository ?? tpl.homepage ?? "vault",
        author: tpl.author,
        license: tpl.license,
        updatedAt: tpl.updatedAt,
        homepage: tpl.homepage,
        repository: tpl.repository,
        tags: tpl.tags,
        metadata: {
          scaffold: tpl.scaffold,
          requirements: tpl.requirements,
          featured: tpl.featured,
        },
      });
    }

    for (const pat of this.currentPatterns) {
      ContentRegistry.register({
        id: pat.id,
        type: "pattern",
        name: pat.name,
        description: pat.description,
        source: "vault",
        author: pat.author,
        updatedAt: pat.updatedAt,
        tags: pat.tags,
        metadata: {
          codeSnippet: pat.codeSnippet,
          cssRules: pat.cssRules,
          usage: pat.usage,
          targetStyles: pat.targetStyles,
        },
      });
    }
  }

  /**
   * Mount or update dynamic style CSS in DOM
   */
  private mountDynamicStyleCss(styleId: string, cssContent: string): void {
    if (typeof document === "undefined") return;
    const tagId = `vault-style-${styleId}`;
    let styleTag = document.getElementById(tagId) as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = tagId;
      styleTag.setAttribute("data-vault-style", styleId);
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = cssContent;
  }
}

export const VaultSync = new VaultSyncManager();
