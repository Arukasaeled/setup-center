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
  remoteUrl: "https://raw.githubusercontent.com/arukas0623-ai/setup-center-vault/main",
  autoSyncOnLaunch: true,
};

/** Load active vault configuration */
export function loadVaultConfig(): VaultConfig {
  try {
    const raw = localStorage.getItem(VAULT_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_VAULT_CONFIG, ...parsed };
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

/** Load cached vault payload */
export function loadVaultCache(): CachedVaultData | null {
  try {
    const raw = localStorage.getItem(VAULT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedVaultData;
    if (parsed && parsed.manifest && parsed.manifest.contentVersion) {
      return parsed;
    }
  } catch (err) {
    console.warn("[VaultCache] Corrupt cache detected, purging:", err);
    clearVaultCache();
  }
  return null;
}

/** Write fresh vault snapshot to local storage */
export function saveVaultCache(data: CachedVaultData): void {
  try {
    localStorage.setItem(VAULT_CACHE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error("[VaultCache] Failed to write cache:", err);
  }
}

/** Invalidate and clear local vault cache */
export function clearVaultCache(): void {
  try {
    localStorage.removeItem(VAULT_CACHE_KEY);
  } catch {
    // ignore
  }
}

/** Get currently cached content version */
export function getCachedContentVersion(): string | null {
  const cached = loadVaultCache();
  return cached?.manifest?.contentVersion ?? null;
}
