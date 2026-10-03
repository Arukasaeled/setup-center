/**
 * Setup Center — Release-Gated Update Engine
 *
 * Implements two distinct update channels:
 * 1. App Release: Binary, runtime, installer, and frontend shell updates via GitHub Releases.
 * 2. Vault Release: Curated, staged content batches (Styles, Resources, Templates, Patterns)
 *    gated by formal release checkpoints rather than raw commits to main.
 */

export interface AppReleaseInfo {
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  publishedAt?: string;
  notes?: string;
  hasUpdate: boolean;
}

export interface VaultReleaseInfo {
  currentVersion: string;
  latestVersion?: string;
  publishedAt?: string;
  summary?: string;
  changes?: string[];
  hasUpdate: boolean;
}

export interface ReleaseStatusSnapshot {
  app: AppReleaseInfo;
  vault: VaultReleaseInfo;
  lastCheckedAt?: string;
  isChecking: boolean;
  error?: string;
}

const STORAGE_KEY = "setup-center.release-status.v1";
const CURRENT_APP_VERSION = "0.2.0";

class ReleaseManager {
  private status: ReleaseStatusSnapshot = {
    app: {
      currentVersion: CURRENT_APP_VERSION,
      hasUpdate: false,
      releaseUrl: "https://github.com/arukas0623-ai/setup-center/releases",
    },
    vault: {
      currentVersion: "2026.10.03.1",
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

  private hydrateFromStorage(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.status = {
          ...this.status,
          ...parsed,
          app: {
            ...this.status.app,
            currentVersion: CURRENT_APP_VERSION,
            latestVersion: parsed.app?.latestVersion,
            hasUpdate: parsed.app?.latestVersion && parsed.app.latestVersion !== `v${CURRENT_APP_VERSION}` && parsed.app.latestVersion !== CURRENT_APP_VERSION,
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
      this.status.vault.hasUpdate = this.compareVersions(this.status.vault.latestVersion, version) > 0;
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

    const [appRes, vaultRes] = await Promise.allSettled([
      this.checkAppRelease(),
      this.checkVaultRelease(),
    ]);

    this.status.isChecking = false;
    this.status.lastCheckedAt = new Date().toISOString();

    if (appRes.status === "rejected" && vaultRes.status === "rejected") {
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
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch("https://api.github.com/repos/arukas0623-ai/setup-center/releases/latest", {
        signal: controller.signal,
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const tag = (data.tag_name || "").replace(/^v/, "");
        const hasUpdate = this.compareVersions(tag, CURRENT_APP_VERSION) > 0;
        this.status.app = {
          currentVersion: CURRENT_APP_VERSION,
          latestVersion: data.tag_name || `v${tag}`,
          releaseUrl: data.html_url || "https://github.com/arukas0623-ai/setup-center/releases",
          publishedAt: data.published_at,
          notes: data.body,
          hasUpdate,
        };
      } else {
        // Fallback info if API rate limited
        this.status.app = {
          currentVersion: CURRENT_APP_VERSION,
          latestVersion: `v${CURRENT_APP_VERSION}`,
          hasUpdate: false,
          releaseUrl: "https://github.com/arukas0623-ai/setup-center/releases",
        };
      }
    } catch {
      // Safe fallback
      this.status.app = {
        currentVersion: CURRENT_APP_VERSION,
        latestVersion: `v${CURRENT_APP_VERSION}`,
        hasUpdate: false,
        releaseUrl: "https://github.com/arukas0623-ai/setup-center/releases",
      };
    }
    return this.status.app;
  }

  /**
   * Check release checkpoint in Setup Vault
   */
  public async checkVaultRelease(): Promise<VaultReleaseInfo> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch("https://raw.githubusercontent.com/arukas0623-ai/setup-center-vault/main/releases/latest.json", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const latest = data.releaseVersion || data.contentVersion;
        const hasUpdate = this.compareVersions(latest, this.status.vault.currentVersion) > 0;
        this.status.vault = {
          currentVersion: this.status.vault.currentVersion,
          latestVersion: latest,
          publishedAt: data.publishedAt,
          summary: data.summary,
          changes: data.changes,
          hasUpdate,
        };
      } else {
        // Fallback to manifest contentVersion
        this.status.vault = {
          currentVersion: this.status.vault.currentVersion,
          latestVersion: this.status.vault.currentVersion,
          hasUpdate: false,
          summary: "当前内容已是最新稳定批次",
        };
      }
    } catch {
      // Fallback
      this.status.vault = {
        currentVersion: this.status.vault.currentVersion,
        latestVersion: this.status.vault.currentVersion,
        hasUpdate: false,
        summary: "当前内容已是最新稳定批次",
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
