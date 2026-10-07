/**
 * Setup Center — Vault HTTP Client
 *
 * Fetches remote manifests, collections, and assets from the Setup Center Vault.
 * Features built-in timeout, status check, and network fault tolerance.
 */

import type { VaultManifest, VaultReleaseCheckpoint } from "./types";
import { validateManifest, validateRelativePath, validateReleaseCheckpoint } from "./validation";

export class VaultClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number = 7000) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Fetch top-level vault manifest and validate against schema
   */
  public async fetchManifest(externalSignal?: AbortSignal): Promise<VaultManifest> {
    const url = `${this.baseUrl}/manifest.json`;
    const json = await this.fetchJson<unknown>(url, externalSignal);
    const result = validateManifest(json);
    if (!result.valid || !result.data) {
      throw new Error(`Vault manifest validation failed: ${result.errors.join("; ")}`);
    }
    return result.data;
  }

  /**
   * Fetch release checkpoint and validate against schema
   */
  public async fetchReleaseCheckpoint(externalSignal?: AbortSignal): Promise<VaultReleaseCheckpoint> {
    const url = `${this.baseUrl}/releases/latest.json`;
    const json = await this.fetchJson<unknown>(url, externalSignal);
    const result = validateReleaseCheckpoint(json);
    if (!result.valid || !result.data) {
      throw new Error(`Vault release checkpoint validation failed: ${result.errors.join("; ")}`);
    }
    return result.data;
  }

  /**
   * Fetch a collection or asset by validated relative path
   */
  public async fetchAssetJson<T>(relativePath: string, externalSignal?: AbortSignal): Promise<T> {
    if (!validateRelativePath(relativePath)) {
      throw new Error(`Invalid or unsafe vault relative path: ${relativePath}`);
    }
    const cleanPath = relativePath.replace(/^\/+/, "");
    const url = `${this.baseUrl}/${cleanPath}`;
    return this.fetchJson<T>(url, externalSignal);
  }

  /**
   * Fetch text content (e.g. style CSS) by validated relative path
   */
  public async fetchAssetText(relativePath: string, externalSignal?: AbortSignal): Promise<string> {
    if (!validateRelativePath(relativePath)) {
      throw new Error(`Invalid or unsafe vault relative path: ${relativePath}`);
    }
    const cleanPath = relativePath.replace(/^\/+/, "");
    const url = `${this.baseUrl}/${cleanPath}`;
    return this.fetchText(url, externalSignal);
  }

  private async fetchJson<T>(url: string, externalSignal?: AbortSignal): Promise<T> {
    if (externalSignal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText} (${url})`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onAbort);
      }
    }
  }

  private async fetchText(url: string, externalSignal?: AbortSignal): Promise<string> {
    if (externalSignal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "text/plain, text/css, */*",
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText} (${url})`);
      }
      return await res.text();
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onAbort);
      }
    }
  }
}
