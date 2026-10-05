/**
 * Setup Center — Vault Release Engine
 *
 * One update channel, and only one: the **Vault content release**. Setup Center
 * content (Style CSS, open-source development resources, scaffolding templates
 * and design patterns) is curated in the Setup Vault workspace and published as
 * a formal release checkpoint, so raw work-in-progress commits to `main` never
 * reach a customer's machine.
 *
 * ## What was removed here, and why the removal is not cosmetic
 *
 * This module used to run a *second*, independent channel: an "App Release"
 * check that polled `api.github.com` for the newest `setup-center` release and
 * compared it against the running build. That check is gone — every part of it:
 * the `AppReleaseInfo` interface, the `status.app` member, the
 * `hydrateRuntimeVersion()` call into the Tauri `app_canonical_version` command,
 * and the `fetch()` to the GitHub Releases API itself.
 *
 * It was removed rather than hidden because the installer is distributed by
 * hand (a网盘 link) and the app must not claim an authority over its own version
 * that it does not have. In practice the check produced one observable outcome
 * on a customer's machine: `检测失败 / 网络受限` — a red error about a release
 * channel the customer was told to ignore anyway. An update indicator that is
 * wrong more often than it is right is worse than no indicator, and this
 * product's whole promise is that its status readouts are true.
 *
 * So: Setup Center no longer checks its own program version, and there is no
 * longer any code here that could. The binary is replaced by the author
 * re-distributing a new installer. The Vault channel below is unaffected by that
 * decision — it is content, it is versioned separately, and it keeps working.
 */

import { getCachedContentVersion } from "./cache";

export type UpdateCheckStatus =
  | "unchecked"
  | "checking"
  | "up-to-date"
  | "update-available"
  | "error";

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
  vault: VaultReleaseInfo;
  lastCheckedAt?: string;
  isChecking: boolean;
  error?: string;
}

const STORAGE_KEY = "setup-center.release-status.v3";

/**
 * The storage key the App-Release era wrote to.
 *
 * Deleted on construction rather than ignored. Leaving it behind would leave a
 * persisted `{ app: {...} }` blob in every existing customer's `localStorage`
 * that nothing reads and nothing cleans — a stale record of a channel that no
 * longer exists, which is exactly the kind of leftover that gets re-wired into a
 * later feature by accident.
 */
const LEGACY_STORAGE_KEY = "setup-center.release-status.v2";

class ReleaseManager {
  private status: ReleaseStatusSnapshot = {
    vault: {
      currentVersion: getCachedContentVersion() || "builtin",
      status: "unchecked",
      hasUpdate: false,
    },
    isChecking: false,
  };

  private listeners: Set<(status: ReleaseStatusSnapshot) => void> = new Set();

  constructor() {
    this.purgeLegacyAppState();
    this.hydrateFromStorage();
  }

  private purgeLegacyAppState(): void {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // A storage failure must never break startup; the write path is
      // best-effort for the same reason.
    }
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
        const curVault = this.status.vault.currentVersion;
        this.status = {
          ...this.status,
          vault: {
            ...this.status.vault,
            ...parsed.vault,
            // The *installed* content version is local truth and always wins
            // over whatever was cached last session — a cache that could
            // override it would report a version the machine does not have.
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
   * Compares the installed Vault content against the published checkpoint.
   *
   * Vault-only by construction. There is deliberately no "also check the app"
   * step to add back later: the signature of this method is the guarantee.
   */
  public async checkForUpdates(): Promise<ReleaseStatusSnapshot> {
    this.status.isChecking = true;
    this.status.error = undefined;
    this.notify();

    await this.checkVaultRelease();

    this.status.isChecking = false;
    this.status.lastCheckedAt = new Date().toISOString();

    // There is now exactly one channel, so "the channel failed" is its error
    // rather than a both-of-two condition. The old wording ("无法连接至发布
    // 检测服务") is kept because it is still the accurate sentence for a failed
    // content checkpoint fetch.
    if (this.status.vault.status === "error") {
      this.status.error = "无法连接至发布检测服务，请检查网络";
    }

    this.notify();
    this.saveToStorage();
    return this.getSnapshot();
  }

  /**
   * Reads the Vault release checkpoint.
   *
   * A plain file read of a curated JSON document on the content repo — no API,
   * no token, no rate limit. See the module doc for why the App channel that
   * used to sit beside this is gone.
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
