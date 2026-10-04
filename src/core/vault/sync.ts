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
  VaultManifest,
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
      let releaseCheckpoint: {
        releaseVersion?: string;
        commitSha?: string;
        snapshotTag?: string;
        summary?: string;
      } | null = null;
      let pin: string | null = null;
      let checkpointError: string | null = null;

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
          // A pin is a git revision. Validate format before trusting it
          const rawPin = releaseCheckpoint?.commitSha || releaseCheckpoint?.snapshotTag;
          if (typeof rawPin === "string" && /^[0-9a-f]{7,40}$|^v?[\w.-]+$/.test(rawPin.trim())) {
            pin = rawPin.trim();
          } else {
            checkpointError = `Malformed release pin: ${JSON.stringify(rawPin)}`;
            console.warn(`[VaultSync] ${checkpointError}`);
          }
        } else {
          checkpointError = `HTTP ${checkpointRes.status} fetching release checkpoint`;
        }
      } catch (e) {
        checkpointError = e instanceof Error ? e.message : String(e);
      }

      // Checkpoint failure gate: NEVER silently fallback to raw main in stable mode!
      if (!pin) {
        const reason = checkpointError || "No valid release pin found in checkpoint";
        const cachedLkg = loadVaultCache();
        if (cachedLkg) {
          console.warn(
            `[VaultSync] Release checkpoint unavailable (${reason}); preserving Last Known Good (LKG) cache v${cachedLkg.manifest.contentVersion} rather than consuming unverified raw main.`
          );
          const lkgResult: VaultSyncResult = {
            ok: true,
            updated: false,
            contentVersion: cachedLkg.manifest.contentVersion,
            fromCache: true,
            pinFallback: `Release checkpoint unavailable (${reason}); preserved Last Known Good (LKG)`,
            itemCounts: {
              styles: Object.keys(cachedLkg.styles).length,
              resources: cachedLkg.resources.length,
              templates: cachedLkg.templates.length,
              patterns: cachedLkg.patterns.length,
            },
          };
          this.notify("idle", lkgResult);
          return lkgResult;
        }

        console.warn(
          `[VaultSync] Release checkpoint unavailable (${reason}) and no LKG cache found; stable remote unavailable. Using built-in content.`
        );
        const errResult: VaultSyncResult = {
          ok: false,
          updated: false,
          contentVersion: "builtin",
          error: `Release checkpoint unavailable (${reason}) and clean install has no LKG; using built-in content`,
        };
        this.notify("idle", errResult);
        return errResult;
      }

      const targetBaseUrl = `${rawVaultOrigin.replace(/\/main\/?$/, "")}/${pin}`;
      let client = new VaultClient(targetBaseUrl);
      let remoteManifest: VaultManifest | null = null;
      let pinFallbackReason: string | null = null;

      try {
        remoteManifest = await client.fetchManifest();
      } catch (pinErr) {
        const msg = pinErr instanceof Error ? pinErr.message : String(pinErr);
        const cachedLkg = loadVaultCache();
        if (cachedLkg) {
          console.warn(
            `[VaultSync] Release pin ${targetBaseUrl} unavailable (${msg}); preserving Last Known Good (LKG) cache v${cachedLkg.manifest.contentVersion} rather than pulling unverified raw main.`,
          );
          const lkgResult: VaultSyncResult = {
            ok: true,
            updated: false,
            contentVersion: cachedLkg.manifest.contentVersion,
            fromCache: true,
            pinFallback: `Release pin unavailable (${msg}); preserved Last Known Good (LKG)`,
            itemCounts: {
              styles: Object.keys(cachedLkg.styles).length,
              resources: cachedLkg.resources.length,
              templates: cachedLkg.templates.length,
              patterns: cachedLkg.patterns.length,
            },
          };
          this.notify("idle", lkgResult);
          return lkgResult;
        }

        // Clean install without LKG: Stable Vault NEVER consumes raw main!
        console.warn(
          `[VaultSync] Release pin ${targetBaseUrl} unavailable (${msg}) and no LKG cache found; stable remote unavailable. Using built-in content.`,
        );
        const errResult: VaultSyncResult = {
          ok: false,
          updated: false,
          contentVersion: "builtin",
          error: `Release pin unavailable (${msg}) and clean install has no LKG; stable remote unavailable`,
        };
        this.notify("idle", errResult);
        return errResult;
      }

      if (!remoteManifest) throw new Error("Vault manifest unavailable");
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

      // =====================================================================
      // Candidate Snapshot Construction (Atomic Swap)
      // Fetch ALL required assets. Any failure aborts candidate creation and
      // leaves existing LKG cache 100% untouched.
      // =====================================================================

      // 1. Fetch Styles
      const stylesRecord: Record<string, VaultStyleManifest> = {};
      if (remoteManifest.collections.styles?.items) {
        for (const itemRef of remoteManifest.collections.styles.items) {
          const styleManifest = await client.fetchAssetJson<VaultStyleManifest>(itemRef.path);
          if (!styleManifest || !styleManifest.id || !styleManifest.name) {
            throw new Error(`Style asset ${itemRef.id} failed schema validation`);
          }
          if (itemRef.cssPath) {
            styleManifest.cssContent = await client.fetchAssetText(itemRef.cssPath);
          }
          stylesRecord[styleManifest.id] = styleManifest;
        }
      }

      // 2. Fetch Resources
      const resourcesList: ResourceItem[] = [];
      if (remoteManifest.collections.resources?.items) {
        for (const itemRef of remoteManifest.collections.resources.items) {
          const catItems = await client.fetchAssetJson<ResourceItem[]>(itemRef.path);
          if (!Array.isArray(catItems)) {
            throw new Error(`Resource collection ${itemRef.id} is not an array`);
          }
          resourcesList.push(...catItems);
        }
      }

      // 3. Fetch Templates
      const templatesList: VaultTemplateItem[] = [];
      if (remoteManifest.collections.templates?.items) {
        for (const itemRef of remoteManifest.collections.templates.items) {
          const tpl = await client.fetchAssetJson<VaultTemplateItem>(itemRef.path);
          if (!tpl || !tpl.id || !tpl.name) {
            throw new Error(`Template asset ${itemRef.id} failed schema validation`);
          }
          templatesList.push(tpl);
        }
      }

      // 4. Fetch Patterns
      const patternsList: VaultPatternItem[] = [];
      if (remoteManifest.collections.patterns?.items) {
        for (const itemRef of remoteManifest.collections.patterns.items) {
          const pat = await client.fetchAssetJson<VaultPatternItem>(itemRef.path);
          if (!pat || !pat.id || !pat.name) {
            throw new Error(`Pattern asset ${itemRef.id} failed schema validation`);
          }
          patternsList.push(pat);
        }
      }

      // 5. Verification checks on Candidate Snapshot
      if (
        remoteManifest.collections.styles?.items &&
        Object.keys(stylesRecord).length < remoteManifest.collections.styles.items.length
      ) {
        throw new Error(
          `Candidate incomplete: styles count mismatch (${Object.keys(stylesRecord).length}/${remoteManifest.collections.styles.items.length})`,
        );
      }
      if (
        remoteManifest.collections.templates?.items &&
        templatesList.length < remoteManifest.collections.templates.items.length
      ) {
        throw new Error(
          `Candidate incomplete: templates count mismatch (${templatesList.length}/${remoteManifest.collections.templates.items.length})`,
        );
      }
      if (
        remoteManifest.collections.patterns?.items &&
        patternsList.length < remoteManifest.collections.patterns.items.length
      ) {
        throw new Error(
          `Candidate incomplete: patterns count mismatch (${patternsList.length}/${remoteManifest.collections.patterns.items.length})`,
        );
      }

      // Candidate is complete and validated! Perform atomic swap
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
        ...(pinFallbackReason ? { pinFallback: pinFallbackReason } : {}),
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
          // Vault Style Contract V2. A published style may declare a full
          // declarative Experience profile (grammar + tweakable tokens + tier),
          // which is what lets a remote style change the shape of the product
          // rather than only its colours — without shipping any React.
          // `registerStyle` keeps the local profile when the payload has none,
          // so a legacy vault entry can never downgrade a local experience.
          ...(s.experience ? { experience: s.experience } : {}),
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
