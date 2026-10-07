/**
 * Setup Center — Vault Cache Engine
 * The active envelope owns the snapshot, source and synchronization metadata.
 * User preferences remain in the separate configuration record.
 */
import type { CachedVaultData, VaultSourceDescriptor } from "./types";
import { validateCachedVaultData } from "./validation";
import { getBundledSnapshot } from "./bundledSnapshot";

const VAULT_CACHE_KEY = "setup-center.vault-cache.v1";
const VAULT_CONFIG_KEY = "setup-center.vault-config";
const VAULT_CACHE_STAGING_KEY = "setup-center.vault-cache.staging";

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

export interface VaultCacheEnvelope {
  schemaVersion: 2;
  data: CachedVaultData;
  descriptor?: VaultSourceDescriptor;
  lastSyncVersion: string;
  lastSyncTime: string;
}

function validDescriptor(value: unknown): value is VaultSourceDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = value as Record<string, unknown>;
  return typeof descriptor.origin === "string" && descriptor.origin.startsWith("https://")
    && typeof descriptor.releaseUrl === "string" && descriptor.releaseUrl.startsWith("https://")
    && typeof descriptor.manifestPath === "string" && descriptor.manifestPath.length > 0
    && typeof descriptor.trusted === "boolean"
    && (descriptor.unsupportedSource === undefined || typeof descriptor.unsupportedSource === "boolean")
    && (descriptor.unsupportedReason === undefined || typeof descriptor.unsupportedReason === "string");
}

/** Legacy compatibility and all envelope validation live at this one boundary. */
function normalizeEnvelope(parsed: unknown): VaultCacheEnvelope | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const document = parsed as Record<string, unknown>;
  const isEnvelope = document.schemaVersion === 2;
  const result = validateCachedVaultData(isEnvelope ? document.data : parsed);
  if (!result.valid || !result.data) return null;
  const data = result.data;
  if (!isEnvelope) {
    return {
      schemaVersion: 2,
      data,
      lastSyncVersion: data.manifest.contentVersion,
      lastSyncTime: data.syncedAt,
    };
  }
  if (document.lastSyncVersion !== data.manifest.contentVersion
    || document.lastSyncTime !== data.syncedAt
    || typeof document.lastSyncTime !== "string"
    || !Number.isFinite(Date.parse(document.lastSyncTime))
    || (document.descriptor !== undefined && !validDescriptor(document.descriptor))) {
    return null;
  }
  return {
    schemaVersion: 2,
    data,
    descriptor: document.descriptor as VaultSourceDescriptor | undefined,
    lastSyncVersion: data.manifest.contentVersion,
    lastSyncTime: data.syncedAt,
  };
}

export function loadVaultCacheEnvelope(): VaultCacheEnvelope | null {
  try {
    const raw = localStorage.getItem(VAULT_CACHE_KEY);
    if (!raw) return null;
    const envelope = normalizeEnvelope(JSON.parse(raw));
    if (!envelope) console.warn("[VaultCache] Invalid cache preserved; using bundled baseline");
    return envelope;
  } catch (error) {
    console.warn("[VaultCache] Cache cannot be read; raw record preserved:", error);
    return null;
  }
}

export function loadVaultCache(): CachedVaultData {
  return loadVaultCacheEnvelope()?.data ?? getBundledSnapshot();
}

function loadPreferences(): Pick<VaultConfig, "remoteUrl" | "autoSyncOnLaunch"> {
  try {
    const raw = localStorage.getItem(VAULT_CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      remoteUrl: typeof parsed?.remoteUrl === "string" && parsed.remoteUrl.trim()
        ? parsed.remoteUrl.replace("arukas0623-ai", "Arukasaeled")
        : DEFAULT_VAULT_CONFIG.remoteUrl,
      autoSyncOnLaunch: typeof parsed?.autoSyncOnLaunch === "boolean"
        ? parsed.autoSyncOnLaunch : DEFAULT_VAULT_CONFIG.autoSyncOnLaunch,
    };
  } catch {
    return { ...DEFAULT_VAULT_CONFIG };
  }
}

export function loadVaultConfig(): VaultConfig {
  const envelope = loadVaultCacheEnvelope();
  return {
    ...loadPreferences(),
    lastSyncVersion: envelope?.lastSyncVersion,
    lastSyncTime: envelope?.lastSyncTime,
  };
}

export function saveVaultConfig(config: Partial<VaultConfig>): void {
  try {
    const current = loadPreferences();
    localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({
      remoteUrl: config.remoteUrl ?? current.remoteUrl,
      autoSyncOnLaunch: config.autoSyncOnLaunch ?? current.autoSyncOnLaunch,
    }));
  } catch (error) {
    console.warn("[VaultCache] Preferences could not be saved:", error);
  }
}

export function hasDownloadedVaultCache(): boolean {
  return loadVaultCacheEnvelope() !== null;
}

/** Active setItem is the commit point; later staging cleanup is non-fatal. */
export function saveVaultCache(
  data: CachedVaultData,
  descriptor?: VaultSourceDescriptor,
  lastSyncVersion = data.manifest.contentVersion,
  lastSyncTime = data.syncedAt,
): boolean {
  try {
    const envelope = normalizeEnvelope({ schemaVersion: 2, data, descriptor, lastSyncVersion, lastSyncTime });
    if (!envelope) throw new Error("Invalid vault cache envelope");
    const serialized = JSON.stringify(envelope);
    localStorage.setItem(VAULT_CACHE_STAGING_KEY, serialized);
    const stagedRaw = localStorage.getItem(VAULT_CACHE_STAGING_KEY);
    if (stagedRaw !== serialized) throw new Error("Staging read-back verification failed");
    localStorage.setItem(VAULT_CACHE_KEY, serialized);
  } catch (error) {
    console.error("[VaultCache] Commit failed; previous active cache preserved:", error);
    try { localStorage.removeItem(VAULT_CACHE_STAGING_KEY); } catch { /* Keep the staging record. */ }
    return false;
  }
  try {
    localStorage.removeItem(VAULT_CACHE_STAGING_KEY);
  } catch (error) {
    console.warn("[VaultCache] Active snapshot committed; staging cleanup deferred:", error);
  }
  return true;
}

/** Explicit user reset only; parse failures never clear the original record. */
export function clearVaultCache(): void {
  try {
    localStorage.removeItem(VAULT_CACHE_KEY);
    localStorage.removeItem(VAULT_CACHE_STAGING_KEY);
  } catch (error) {
    console.warn("[VaultCache] Cache reset could not be completed:", error);
  }
}

export function getCachedContentVersion(): string {
  return loadVaultCache().manifest.contentVersion;
}

