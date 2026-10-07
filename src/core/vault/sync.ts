/**
 * Setup Center — Vault Sync Engine & Orchestrator
 *
 * Implements the Runtime Content Update flow:
 * 1. Immediate offline-first cache activation (Issue D14: Bundled snapshot fallback)
 * 2. Background comparison of remote release checkpoint and commit pin
 * 3. Atomic collection fetching with bounded concurrency limit = 4 and schema verification (Issue D05)
 * 4. Staging verification & atomic pointer swap preserving LKG cache on failure (Issue D08)
 * 5. Generation-based single-flight locking, cancellation, and source descriptor enforcement (Issues D05, D06)
 * 6. Replace semantics per origin and clean unmounting of retracted styles (Issue D09)
 */

import type {
  CachedVaultData,
  VaultManifest,
  VaultPatternItem,
  VaultStyleManifest,
  VaultSyncResult,
  VaultSyncStatus,
  VaultTemplateItem,
  VaultSkillItem,
  VaultSourceDescriptor,
} from "./types";
import {
  loadVaultCache,
  saveVaultCache,
  loadVaultConfig,
  saveVaultConfig,
  clearVaultCache,
} from "./cache";
import { VaultClient } from "./client";
import {
  validateCommitSha,
  validateReleaseCheckpoint,
  validateStyleManifest,
  validateResourceItem,
  validateTemplateItem,
  validatePatternItem,
  validateSkillItem,
} from "./validation";
import { scopeRemoteCss } from "./cssPolicy";
import { registerResourcesBatch, type ResourceItem } from "../../content/resources";
import { registerStyle, type SetupStyle } from "../../styles";
import { unmountDynamicStyleCss } from "../../styles/registry";
import { ContentRegistry } from "../../content/registry";
import { TransferHistory } from "../transfer/history";
import type { ContentItem } from "../../content/types";

type SyncListener = (status: VaultSyncStatus, result?: VaultSyncResult) => void;

/**
 * Executes async tasks with bounded concurrency and cancellation support.
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit = 4,
  signal?: AbortSignal,
): Promise<T[]> {
  if (tasks.length === 0) return [];
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, tasks.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < tasks.length) {
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Resolves and validates source descriptor for the given remote URL (Issue D06).
 */
export function resolveSourceDescriptor(remoteUrl: string): VaultSourceDescriptor {
  const clean = remoteUrl.replace(/\/+$/, "");
  const isGithubRaw = clean.startsWith("https://raw.githubusercontent.com/");
  return {
    origin: clean,
    releaseUrl: `${clean.replace(/\/main\/?$/, "")}/main/releases/latest.json`,
    manifestPath: "manifest.json",
    trusted: isGithubRaw,
    unsupportedSource: !isGithubRaw,
    unsupportedReason: !isGithubRaw
      ? "Only raw.githubusercontent.com is allowed by desktop CSP (connect-src)"
      : undefined,
  };
}

class VaultSyncManager {
  private status: VaultSyncStatus = "idle";
  private listeners: Set<SyncListener> = new Set();
  private lastResult?: VaultSyncResult;
  private currentTemplates: VaultTemplateItem[] = [];
  private currentPatterns: VaultPatternItem[] = [];
  private currentSkills: VaultSkillItem[] = [];
  private mountedDynamicStyleIds: Set<string> = new Set();

  // Concurrency & Generation controls (Issue D05)
  private inFlightPromise: Promise<VaultSyncResult> | null = null;
  private generation = 0;
  private activeAbortController: AbortController | null = null;

  constructor() {
    // Safely hydrate from cache or bundled offline baseline immediately
    try {
      this.hydrateFromCache();
    } catch (err) {
      console.warn("[VaultSync] Safe cache hydration caught error on init:", err);
    }
  }

  /**
   * Unified startup entrypoint for application shell.
   * Hydrates offline/LKG content immediately, then triggers background sync if enabled.
   */
  public async initialize(): Promise<void> {
    this.hydrateFromCache();
    const config = loadVaultConfig();
    if (config.autoSyncOnLaunch) {
      void this.sync();
    }
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

  public getSkills(): VaultSkillItem[] {
    return this.currentSkills;
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
   * Cancels any active sync transaction and invalidates active worker callbacks.
   */
  public cancelActiveSync(reason = "Sync cancelled by user or caller"): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort(reason);
      this.activeAbortController = null;
    }
    this.generation++;
    this.inFlightPromise = null;
    if (this.status === "syncing" || this.status === "checking") {
      this.notify("idle");
    }
  }

  /**
   * Activate local cache (or bundled offline baseline) immediately.
   */
  public hydrateFromCache(): boolean {
    try {
      const cached = loadVaultCache();
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
          skills: cached.skills?.length ?? 0,
        },
      };
      return true;
    } catch (err) {
      console.warn("[VaultSync] Failed to hydrate from cache:", err);
      return false;
    }
  }

  /**
   * Synchronize with remote Setup Center Vault via single-flight transaction gate.
   */
  public async sync(options?: { force?: boolean; remoteUrl?: string }): Promise<VaultSyncResult> {
    // Single-flight deduplication: return ongoing promise if identical request is in flight
    if (this.inFlightPromise && !options?.force && !options?.remoteUrl) {
      return this.inFlightPromise;
    }

    // If options force a new run or change remoteUrl, cancel previous in-flight task
    if (this.inFlightPromise) {
      this.cancelActiveSync("New sync requested with force or url override");
    }

    const currentGen = ++this.generation;
    const controller = new AbortController();
    this.activeAbortController = controller;

    const task = this.executeSync(options, controller, currentGen);
    this.inFlightPromise = task;

    try {
      return await task;
    } finally {
      if (this.generation === currentGen) {
        this.inFlightPromise = null;
        this.activeAbortController = null;
      }
    }
  }

  private async executeSync(
    options: { force?: boolean; remoteUrl?: string } | undefined,
    controller: AbortController,
    gen: number,
  ): Promise<VaultSyncResult> {
    const config = loadVaultConfig();
    const rawVaultOrigin = (options?.remoteUrl || config.remoteUrl).replace(/\/+$/, "");
    const descriptor = resolveSourceDescriptor(rawVaultOrigin);

    // Issue D06: CSP / Source origin gate
    if (descriptor.unsupportedSource) {
      console.warn(`[VaultSync] Rejected unsupported source: ${descriptor.origin}`);
      const errResult: VaultSyncResult = {
        ok: false,
        updated: false,
        contentVersion: "unsupported",
        error: descriptor.unsupportedReason || "Unsupported Vault source host",
        origin: descriptor.origin,
        descriptor,
      };
      this.notify("idle", errResult);
      return errResult;
    }

    this.notify("checking");

    try {
      if (controller.signal.aborted || this.generation !== gen) {
        throw new DOMException("Sync aborted", "AbortError");
      }

      // 1. Fetch and validate Release Checkpoint
      let releaseCheckpoint: {
        releaseVersion?: string;
        commitSha?: string;
        snapshotTag?: string;
        summary?: string;
      } | null = null;
      let pin: string | null = null;
      let checkpointError: string | null = null;

      try {
        const cpClient = new VaultClient(rawVaultOrigin, 5000);
        releaseCheckpoint = await cpClient.fetchReleaseCheckpoint(controller.signal);
        if (releaseCheckpoint && validateCommitSha(releaseCheckpoint.commitSha)) {
          pin = releaseCheckpoint.commitSha;
        } else {
          checkpointError = `commitSha must be a strict 40-character hexadecimal Git commit SHA, got: ${String(releaseCheckpoint?.commitSha)}`;
          console.warn(`[VaultSync] ${checkpointError}`);
        }
      } catch (e) {
        if (controller.signal.aborted || this.generation !== gen) {
          throw new DOMException("Sync aborted", "AbortError");
        }
        checkpointError = e instanceof Error ? e.message : String(e);
      }

      // Checkpoint failure gate: preserve Last Known Good (LKG) cache
      if (!pin) {
        const reason = checkpointError || "No valid release pin found in checkpoint";
        const cachedLkg = loadVaultCache();
        console.warn(
          `[VaultSync] Release checkpoint unavailable (${reason}); preserving LKG cache v${cachedLkg.manifest.contentVersion}.`,
        );
        const lkgResult: VaultSyncResult = {
          ok: true,
          updated: false,
          contentVersion: cachedLkg.manifest.contentVersion,
          fromCache: true,
          pinFallback: `Release checkpoint unavailable (${reason}); preserved Last Known Good (LKG)`,
          origin: descriptor.origin,
          descriptor,
          itemCounts: {
            styles: Object.keys(cachedLkg.styles).length,
            resources: cachedLkg.resources.length,
            templates: cachedLkg.templates.length,
            patterns: cachedLkg.patterns.length,
            skills: cachedLkg.skills?.length ?? 0,
          },
        };
        this.notify("idle", lkgResult);
        return lkgResult;
      }

      if (controller.signal.aborted || this.generation !== gen) {
        throw new DOMException("Sync aborted", "AbortError");
      }

      // 2. Fetch remote pinned manifest
      const targetBaseUrl = `${rawVaultOrigin.replace(/\/main\/?$/, "")}/${pin}`;
      const client = new VaultClient(targetBaseUrl, 7000);
      let remoteManifest: VaultManifest | null = null;

      try {
        remoteManifest = await client.fetchManifest(controller.signal);
      } catch (pinErr) {
        if (controller.signal.aborted || this.generation !== gen) {
          throw new DOMException("Sync aborted", "AbortError");
        }
        const msg = pinErr instanceof Error ? pinErr.message : String(pinErr);
        const cachedLkg = loadVaultCache();
        console.warn(
          `[VaultSync] Release pin ${targetBaseUrl} unavailable (${msg}); preserving LKG cache v${cachedLkg.manifest.contentVersion}.`,
        );
        const lkgResult: VaultSyncResult = {
          ok: true,
          updated: false,
          contentVersion: cachedLkg.manifest.contentVersion,
          fromCache: true,
          pinFallback: `Release pin unavailable (${msg}); preserved Last Known Good (LKG)`,
          origin: descriptor.origin,
          descriptor,
          itemCounts: {
            styles: Object.keys(cachedLkg.styles).length,
            resources: cachedLkg.resources.length,
            templates: cachedLkg.templates.length,
            patterns: cachedLkg.patterns.length,
            skills: cachedLkg.skills?.length ?? 0,
          },
        };
        this.notify("idle", lkgResult);
        return lkgResult;
      }

      if (!remoteManifest) throw new Error("Vault manifest unavailable");
      const cached = loadVaultCache();
      const targetVersion = releaseCheckpoint?.releaseVersion || remoteManifest.contentVersion;

      // Check if update is needed
      if (
        !options?.force &&
        cached &&
        (cached.manifest.contentVersion === targetVersion ||
          cached.manifest.contentVersion === remoteManifest.contentVersion)
      ) {
        const result: VaultSyncResult = {
          ok: true,
          updated: false,
          contentVersion: cached.manifest.contentVersion,
          fromCache: true,
          origin: descriptor.origin,
          descriptor,
          itemCounts: {
            styles: Object.keys(cached.styles).length,
            resources: cached.resources.length,
            templates: cached.templates.length,
            patterns: cached.patterns.length,
            skills: cached.skills?.length ?? 0,
          },
        };
        this.notify("idle", result);
        return result;
      }

      this.notify("syncing");

      // =====================================================================
      // Candidate Snapshot Construction (Atomic Swap + Bounded Concurrency 4)
      // =====================================================================

      // 1. Fetch Styles (Concurrency limit 4)
      const stylesRecord: Record<string, VaultStyleManifest> = {};
      if (remoteManifest.collections.styles?.items) {
        const styleTasks = remoteManifest.collections.styles.items.map((itemRef) => async () => {
          const rawStyle = await client.fetchAssetJson<unknown>(itemRef.path, controller.signal);
          const styleVal = validateStyleManifest(rawStyle);
          if (!styleVal.valid || !styleVal.data) {
            throw new Error(`Style asset ${itemRef.id} failed schema: ${styleVal.errors.join("; ")}`);
          }
          const styleManifest = styleVal.data;
          if (itemRef.cssPath) {
            styleManifest.cssContent = await client.fetchAssetText(itemRef.cssPath, controller.signal);
          }
          return styleManifest;
        });
        const fetchedStyles = await runWithConcurrency(styleTasks, 4, controller.signal);
        for (const s of fetchedStyles) {
          stylesRecord[s.id] = s;
        }
      }

      // 2. Fetch Resources (Concurrency limit 4)
      const resourcesList: ResourceItem[] = [];
      if (remoteManifest.collections.resources?.items) {
        const resourceTasks = remoteManifest.collections.resources.items.map((itemRef) => async () => {
          const catItems = await client.fetchAssetJson<unknown[]>(itemRef.path, controller.signal);
          if (!Array.isArray(catItems)) {
            throw new Error(`Resource collection ${itemRef.id} is not an array`);
          }
          const validItems: ResourceItem[] = [];
          for (const rawRes of catItems) {
            const resVal = validateResourceItem(rawRes);
            if (!resVal.valid || !resVal.data) {
              throw new Error(`Resource in ${itemRef.id} failed schema: ${resVal.errors.join("; ")}`);
            }
            validItems.push(resVal.data as unknown as ResourceItem);
          }
          return validItems;
        });
        const fetchedResourceBatches = await runWithConcurrency(resourceTasks, 4, controller.signal);
        for (const batch of fetchedResourceBatches) {
          resourcesList.push(...batch);
        }
      }

      // 3. Fetch Templates (Concurrency limit 4)
      const templatesList: VaultTemplateItem[] = [];
      if (remoteManifest.collections.templates?.items) {
        const tplTasks = remoteManifest.collections.templates.items.map((itemRef) => async () => {
          const rawTpl = await client.fetchAssetJson<unknown>(itemRef.path, controller.signal);
          const tplVal = validateTemplateItem(rawTpl);
          if (!tplVal.valid || !tplVal.data) {
            throw new Error(`Template asset ${itemRef.id} failed schema: ${tplVal.errors.join("; ")}`);
          }
          return tplVal.data;
        });
        const fetchedTpls = await runWithConcurrency(tplTasks, 4, controller.signal);
        templatesList.push(...fetchedTpls);
      }

      // 4. Fetch Patterns (Concurrency limit 4)
      const patternsList: VaultPatternItem[] = [];
      if (remoteManifest.collections.patterns?.items) {
        const patTasks = remoteManifest.collections.patterns.items.map((itemRef) => async () => {
          const rawPat = await client.fetchAssetJson<unknown>(itemRef.path, controller.signal);
          const patVal = validatePatternItem(rawPat);
          if (!patVal.valid || !patVal.data) {
            throw new Error(`Pattern asset ${itemRef.id} failed schema: ${patVal.errors.join("; ")}`);
          }
          return patVal.data;
        });
        const fetchedPats = await runWithConcurrency(patTasks, 4, controller.signal);
        patternsList.push(...fetchedPats);
      }

      // 5. Fetch Skills (Concurrency limit 4)
      const skillsList: VaultSkillItem[] = [];
      if (remoteManifest.collections.skills?.items) {
        const skillTasks = remoteManifest.collections.skills.items.map((itemRef) => async () => {
          const rawSkill = await client.fetchAssetJson<unknown>(itemRef.path, controller.signal);
          const skillVal = validateSkillItem(rawSkill);
          if (!skillVal.valid || !skillVal.data) {
            throw new Error(`Skill asset ${itemRef.id} failed schema: ${skillVal.errors.join("; ")}`);
          }
          return skillVal.data;
        });
        const fetchedSkills = await runWithConcurrency(skillTasks, 4, controller.signal);
        skillsList.push(...fetchedSkills);
      }

      if (controller.signal.aborted || this.generation !== gen) {
        throw new DOMException("Sync aborted", "AbortError");
      }

      // 6. Verification checks on candidate snapshot
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
      if (
        remoteManifest.collections.skills?.items &&
        skillsList.length < remoteManifest.collections.skills.items.length
      ) {
        throw new Error(
          `Candidate incomplete: skills count mismatch (${skillsList.length}/${remoteManifest.collections.skills.items.length})`,
        );
      }

      // Candidate is complete! Perform atomic swap (Issue D08)
      const freshVaultData: CachedVaultData = {
        manifest: remoteManifest,
        syncedAt: new Date().toISOString(),
        styles: stylesRecord,
        resources: resourcesList as unknown as Array<Record<string, unknown>>,
        templates: templatesList,
        patterns: patternsList,
        skills: skillsList,
      };

      const savedOk = saveVaultCache(freshVaultData);
      if (!savedOk) {
        throw new Error("Failed to atomically commit fresh vault cache to local storage");
      }

      saveVaultConfig({
        lastSyncTime: freshVaultData.syncedAt,
        lastSyncVersion: remoteManifest.contentVersion,
      });

      // Apply to runtime memory registries with replace semantics (Issue D09)
      this.applyVaultData(freshVaultData);

      const successResult: VaultSyncResult = {
        ok: true,
        updated: true,
        contentVersion: remoteManifest.contentVersion,
        fromCache: false,
        origin: descriptor.origin,
        descriptor,
        itemCounts: {
          styles: Object.keys(stylesRecord).length,
          resources: resourcesList.length,
          templates: templatesList.length,
          patterns: patternsList.length,
          skills: skillsList.length,
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
      if (err instanceof DOMException && err.name === "AbortError") {
        console.info("[VaultSync] Sync aborted for generation", gen);
        const abortResult: VaultSyncResult = {
          ok: false,
          updated: false,
          contentVersion: "aborted",
          error: "Sync operation cancelled",
          origin: descriptor.origin,
          descriptor,
        };
        this.notify("idle", abortResult);
        return abortResult;
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn("[VaultSync] Sync encountered error, preserving previous cache:", errorMsg);

      const fallbackCached = loadVaultCache();
      const failResult: VaultSyncResult = {
        ok: false,
        updated: false,
        contentVersion: fallbackCached.manifest.contentVersion,
        error: errorMsg,
        fromCache: true,
        origin: descriptor.origin,
        descriptor,
      };

      this.notify("error", failResult);
      return failResult;
    }
  }

  /**
   * Apply vault collections into runtime memory registries and DOM with replace semantics (Issue D09)
   */
  private applyVaultData(data: CachedVaultData): void {
    const allContentItems: ContentItem[] = [];

    // 1. Resources: Register into RESOURCE_CATALOG and prepare ContentItems
    if (Array.isArray(data.resources) && data.resources.length > 0) {
      registerResourcesBatch(data.resources as unknown as ResourceItem[]);
      for (const res of data.resources as unknown as ResourceItem[]) {
        allContentItems.push({
          id: res.id,
          type: "resource",
          name: res.name,
          version: res.version,
          description: res.description,
          source: "vault",
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

    // 2. Templates & Patterns: Keep in memory and prepare ContentItems
    this.currentTemplates = data.templates ?? [];
    this.currentPatterns = data.patterns ?? [];
    this.currentSkills = data.skills ?? [];

    for (const tpl of this.currentTemplates) {
      allContentItems.push({
        id: tpl.id,
        type: "template",
        name: tpl.name,
        description: tpl.description,
        source: "vault",
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
      allContentItems.push({
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

    for (const sk of this.currentSkills) {
      allContentItems.push({
        id: sk.id,
        type: "skill",
        name: sk.name,
        description: sk.description,
        source: "vault",
        author: sk.author,
        updatedAt: sk.updatedAt,
        tags: sk.tags,
        metadata: {
          prompt: sk.prompt,
          tools: sk.tools,
        },
      });
    }

    // Atomic replace in ContentRegistry for origin "vault"
    ContentRegistry.replaceOrigin("vault", allContentItems);

    // 3. Styles: Unmount retracted styles and mount updated ones (Issue D09)
    const incomingStyles = data.styles ?? {};
    const incomingStyleIds = new Set(Object.keys(incomingStyles));

    // Unmount any previously mounted style no longer present or marked retracted (implemented: false)
    for (const mountedId of Array.from(this.mountedDynamicStyleIds)) {
      const incoming = incomingStyles[mountedId];
      if (!incoming || incoming.implemented === false) {
        unmountDynamicStyleCss(mountedId);
        this.mountedDynamicStyleIds.delete(mountedId);
      }
    }

    // Mount and register current styles
    for (const styleId of Object.keys(incomingStyles)) {
      const s = incomingStyles[styleId];
      if (s.cssContent && s.implemented !== false) {
        this.mountDynamicStyleCss(s.id, s.cssContent);
        this.mountedDynamicStyleIds.add(s.id);
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
        ...(s.experience ? { experience: s.experience } : {}),
      };
      registerStyle(setupStyle);
    }
  }

  /**
   * Mount or update dynamic style CSS in DOM.
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
    const scopedCss = scopeRemoteCss(styleId, cssContent);
    styleTag.textContent = scopedCss;
  }

  /**
   * Reset local cache and restore bundled baseline snapshot.
   */
  public clearCache(): void {
    this.cancelActiveSync("Clearing cache");
    for (const styleId of this.mountedDynamicStyleIds) {
      unmountDynamicStyleCss(styleId);
    }
    this.mountedDynamicStyleIds.clear();
    ContentRegistry.clearOrigin("vault");
    clearVaultCache();
    this.hydrateFromCache();
    this.notify("idle", this.lastResult);
  }
}

export const VaultSync = new VaultSyncManager();
