/**
 * Setup Center — Vault Cache Engine
 *
 * Provides offline-first local storage and safe fallback mechanisms.
 * If network is unavailable or remote manifest is broken, the app
 * loads smoothly from this local snapshot without crashing.
 */

import type { CachedVaultData } from "./types";

const VAULT_CACHE_KEY = "setup-center.vault-cache.v1";
const VAULT_CONFIG_KEY = "setup-center.vault-config";

export interface VaultConfig {
  remoteUrl: string;
  autoSyncOnLaunch: boolean;
  lastSyncTime?: string;
  lastSyncVersion?: string;
}

export const DEFAULT_VAULT_CONFIG: VaultConfig = {
  remoteUrl: "https://raw.githubusercontent.com/Arukasaeled/setup-center-vault/main",
  autoSyncOnLaunch: true,
};

/** Load active vault configuration with canonical URL migration */
export function loadVaultConfig(): VaultConfig {
  try {
    const raw = localStorage.getItem(VAULT_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const config: VaultConfig = { ...DEFAULT_VAULT_CONFIG, ...parsed };
      // Auto-migrate legacy repository owner to canonical Arukasaeled
      if (config.remoteUrl && config.remoteUrl.includes("arukas0623-ai")) {
        config.remoteUrl = config.remoteUrl.replace("arukas0623-ai", "Arukasaeled");
        try {
          localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify(config));
        } catch {
          // ignore quota error
        }
      }
      return config;
    }
  } catch {
    // fallback
  }
  return { ...DEFAULT_VAULT_CONFIG };
}

/** Save active vault configuration */
export function saveVaultConfig(config: Partial<VaultConfig>): void {
  try {
    const current = loadVaultConfig();
    localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({ ...current, ...config }));
  } catch {
    // ignore storage quota error
  }
}

import { validateCachedVaultData } from "./validation";
import { getBundledSnapshot } from "./bundledSnapshot";

const VAULT_CACHE_STAGING_KEY = "setup-center.vault-cache.staging";

/** Check whether a downloaded cache exists in local storage */
export function hasDownloadedVaultCache(): boolean {
  try {
    return Boolean(localStorage.getItem(VAULT_CACHE_KEY));
  } catch {
    return false;
  }
}

/** Load cached vault payload with strict schema contract validation and bundled baseline fallback */
export function loadVaultCache(): CachedVaultData {
  try {
    const raw = localStorage.getItem(VAULT_CACHE_KEY);
    if (!raw) {
      return getBundledSnapshot();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.warn("[VaultCache] Unparseable cache JSON detected, clearing and restoring bundled baseline:", parseErr);
      clearVaultCache();
      return getBundledSnapshot();
    }
    const result = validateCachedVaultData(parsed);
    if (!result.valid || !result.data) {
      console.warn("[VaultCache] Corrupt or incompatible cache document detected, clearing and restoring bundled:", result.errors.join("; "));
      clearVaultCache();
      return getBundledSnapshot();
    }
    return result.data;
  } catch (err) {
    console.warn("[VaultCache] Unexpected error loading cache, falling back safely to bundled baseline:", err);
    clearVaultCache();
    return getBundledSnapshot();
  }
}

/** Write fresh vault snapshot to local storage with staging verification and atomic swap (Issue D08) */
export function saveVaultCache(data: CachedVaultData): boolean {
  try {
    const result = validateCachedVaultData(data);
    if (!result.valid || !result.data) {
      console.error("[VaultCache] Refusing to persist invalid cache document:", result.errors.join("; "));
      return false;
    }
    const serialized = JSON.stringify(result.data);

    // Stage candidate snapshot in staging key
    localStorage.setItem(VAULT_CACHE_STAGING_KEY, serialized);

    // Read back and verify integrity before swapping active pointer
    const stagedRaw = localStorage.getItem(VAULT_CACHE_STAGING_KEY);
    if (!stagedRaw || stagedRaw !== serialized) {
      throw new Error("Staging read-back verification failed");
    }

    // Atomic swap to active cache key
    localStorage.setItem(VAULT_CACHE_KEY, stagedRaw);
    localStorage.removeItem(VAULT_CACHE_STAGING_KEY);
    return true;
  } catch (err) {
    console.error("[VaultCache] Failed atomic cache swap, preserving previous LKG cache:", err);
    try {
      localStorage.removeItem(VAULT_CACHE_STAGING_KEY);
    } catch {
      // ignore
    }
    return false;
  }
}

/** Invalidate and clear local vault cache */
export function clearVaultCache(): void {
  try {
    localStorage.removeItem(VAULT_CACHE_KEY);
    localStorage.removeItem(VAULT_CACHE_STAGING_KEY);
  } catch {
    // ignore
  }
}

/** Get currently cached content version */
export function getCachedContentVersion(): string {
  const cached = loadVaultCache();
  return cached.manifest.contentVersion;
}

