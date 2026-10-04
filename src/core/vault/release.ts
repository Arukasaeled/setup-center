/**
 * Setup Center — Release-Gated Update Engine
 *
 * Implements two distinct update channels:
 * 1. App Release: Binary, runtime, installer, and frontend shell updates via GitHub Releases.
 * 2. Vault Release: Curated, staged content batches (Styles, Resources, Templates, Patterns)
 *    gated by formal release checkpoints rather than raw commits to main.
 */

import { appCanonicalVersion, isTauri } from "../../lib/ipc";
import { getCachedContentVersion } from "./cache";

export type UpdateCheckStatus =
  | "unchecked"
  | "checking"
  | "up-to-date"
  | "update-available"
  | "error";

export interface AppReleaseInfo {
  currentVersion: string;
  runtimeSource?: string;
  latestVersion?: string;
  releaseUrl?: string;
  publishedAt?: string;
  notes?: string;
  status: UpdateCheckStatus;
  hasUpdate: boolean;
}

export interface VaultReleaseInfo {
  currentVersion: string;
  latestVersion?: string;
  publishedAt?: string;
  summary?: string;
  changes?: string[];
  status: UpdateCheckStatus;
  hasUpdate: boolean;
}

export interface ReleaseStatusSnapshot {
  app: AppReleaseInfo;
  vault: VaultReleaseInfo;
  lastCheckedAt?: string;
  isChecking: boolean;
  error?: string;
}

const STORAGE_KEY = "setup-center.release-status.v2";

class ReleaseManager {
  private status: ReleaseStatusSnapshot = {
    app: {
      currentVersion: isTauri() ? "" : "dev-preview",
      runtimeSource: isTauri()
        ? "Tauri Desktop Runtime (待检测)"
        : "Browser Preview (无原生环境)",
      status: "unchecked",
      hasUpdate: false,
      releaseUrl: "https://github.com/Arukasaeled/setup-center/releases",
    },
    vault: {
      currentVersion: getCachedContentVersion() || "builtin",
      status: "unchecked",
      hasUpdate: false,
    },
    isChecking: false,
  };

  private listeners: Set<(status: ReleaseStatusSnapshot) => void> = new Set();

  constructor() {
    this.hydrateFromStorage();
  }

  public getSnapshot(): ReleaseStatusSnapshot {
    return { ...this.status };
  }

  public subscribe(listener: (status: ReleaseStatusSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l({ ...this.status });
      } catch (err) {
        console.error("[ReleaseManager] listener error:", err);
      }
    }
  }

  public async hydrateRuntimeVersion(): Promise<string> {
    try {
      if (isTauri()) {
        const ver = await appCanonicalVersion();
        if (ver && ver.trim()) {
          const clean = ver.trim();
          this.status.app.currentVersion = clean;
          this.status.app.runtimeSource = "Tauri 桌面运行时 (Cargo manifest)";
          if (this.status.app.latestVersion) {
            const cleanLatest = this.status.app.latestVersion.replace(/^v/, "");
            this.status.app.hasUpdate = this.compareVersions(cleanLatest, clean) > 0;
          }
          this.notify();
          this.saveToStorage();
          return clean;
        }
      }
    } catch {
      // ignore
    }
    return this.status.app.currentVersion;
  }

  private hydrateFromStorage(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const curApp = this.status.app.currentVersion;
        const curVault = this.status.vault.currentVersion;
        this.status = {
          ...this.status,
          ...parsed,
          app: {
            ...this.status.app,
            ...parsed.app,
            currentVersion: curApp,
            status: parsed.app?.status || "unchecked",
            hasUpdate: Boolean(parsed.app?.hasUpdate),
          },
          vault: {
            ...this.status.vault,
            ...parsed.vault,
            currentVersion: curVault,
            status: parsed.vault?.status || "unchecked",
            hasUpdate: Boolean(parsed.vault?.hasUpdate),
          },
          isChecking: false,
        };
      }
    } catch {
      // ignore
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.status));
    } catch {
      // ignore
    }
  }

  public setVaultCurrentVersion(version: string): void {
    this.status.vault.currentVersion = version;
    if (this.status.vault.latestVersion) {
      const hasUpdate = this.compareVersions(this.status.vault.latestVersion, version) > 0;
      this.status.vault.hasUpdate = hasUpdate;
      this.status.vault.status = hasUpdate ? "update-available" : "up-to-date";
    }
    this.notify();
    this.saveToStorage();
  }

  /**
   * Check both App and Vault updates in parallel
   */
  public async checkForUpdates(): Promise<ReleaseStatusSnapshot> {
    this.status.isChecking = true;
    this.status.error = undefined;
    this.notify();

    await Promise.allSettled([
      this.checkAppRelease(),
      this.checkVaultRelease(),
    ]);

    this.status.isChecking = false;
    this.status.lastCheckedAt = new Date().toISOString();

    if (
      this.status.app.status === "error" &&
      this.status.vault.status === "error"
    ) {
      this.status.error = "无法连接至发布检测服务，请检查网络";
    }

    this.notify();
    this.saveToStorage();
    return this.getSnapshot();
  }

  /**
   * Check GitHub Releases for the Setup Center App
   */
  public async checkAppRelease(): Promise<AppReleaseInfo> {
    const cur = this.status.app.currentVersion;
    this.status.app.status = "checking";
    this.notify();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch("https://api.github.com/repos/Arukasaeled/setup-center/releases/latest", {
        signal: controller.signal,
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const tag = (data.tag_name || "").replace(/^v/, "");
        const hasUpdate = Boolean(cur && cur !== "dev-preview" && this.compareVersions(tag, cur) > 0);
        this.status.app = {
          ...this.status.app,
          currentVersion: cur,
          latestVersion: data.tag_name || `v${tag}`,
          releaseUrl: data.html_url || "https://github.com/Arukasaeled/setup-center/releases",
          publishedAt: data.published_at,
          notes: data.body,
          status: hasUpdate ? "update-available" : "up-to-date",
          hasUpdate,
        };
      } else {
        // Fallback info if API rate limited or server error
        this.status.app = {
          ...this.status.app,
          status: "error",
          hasUpdate: false,
        };
      }
    } catch {
      this.status.app = {
        ...this.status.app,
        status: "error",
        hasUpdate: false,
      };
    }
    return this.status.app;
  }

  /**
   * Check release checkpoint in Setup Vault
   */
  public async checkVaultRelease(): Promise<VaultReleaseInfo> {
    const cur = this.status.vault.currentVersion;
    this.status.vault.status = "checking";
    this.notify();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch("https://raw.githubusercontent.com/Arukasaeled/setup-center-vault/main/releases/latest.json", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const latest = data.releaseVersion || data.contentVersion;
        const hasUpdate = Boolean(latest && this.compareVersions(latest, cur) > 0);
        this.status.vault = {
          currentVersion: cur,
          latestVersion: latest,
          publishedAt: data.publishedAt,
          summary: data.summary,
          changes: data.changes,
          status: hasUpdate ? "update-available" : "up-to-date",
          hasUpdate,
        };
      } else {
        this.status.vault = {
          ...this.status.vault,
          status: "error",
          hasUpdate: false,
        };
      }
    } catch {
      this.status.vault = {
        ...this.status.vault,
        status: "error",
        hasUpdate: false,
      };
    }
    return this.status.vault;
  }

  private compareVersions(v1: string, v2: string): number {
    const clean1 = (v1 || "").replace(/[^0-9.]/g, "");
    const clean2 = (v2 || "").replace(/[^0-9.]/g, "");
    const parts1 = clean1.split(".").map(Number);
    const parts2 = clean2.split(".").map(Number);
    const maxLen = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLen; i++) {
      const n1 = parts1[i] || 0;
      const n2 = parts2[i] || 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }
}

export const ReleaseManagerInstance = new ReleaseManager();
