/**
 * Setup Center — Vault HTTP Client
 *
 * Fetches remote manifests, collections, and assets from the Setup Center Vault.
 * Features built-in timeout, status check, and network fault tolerance.
 */

import type { VaultManifest } from "./types";

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
   * Fetch top-level vault manifest
   */
  public async fetchManifest(): Promise<VaultManifest> {
    const url = `${this.baseUrl}/manifest.json`;
    return this.fetchJson<VaultManifest>(url);
  }

  /**
   * Fetch a collection or asset by relative path
   */
  public async fetchAssetJson<T>(relativePath: string): Promise<T> {
    const cleanPath = relativePath.replace(/^\/+/, "");
    const url = `${this.baseUrl}/${cleanPath}`;
    return this.fetchJson<T>(url);
  }

  /**
   * Fetch text content (e.g. style CSS)
   */
  public async fetchAssetText(relativePath: string): Promise<string> {
    const cleanPath = relativePath.replace(/^\/+/, "");
    const url = `${this.baseUrl}/${cleanPath}`;
    return this.fetchText(url);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
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
    }
  }

  private async fetchText(url: string): Promise<string> {
    const controller = new AbortController();
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
    }
  }
}
