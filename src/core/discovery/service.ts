/**
 * Setup Center — Unified Discovery Service
 *
 * Coordinates instant local catalog search with optional online GitHub and
 * Winget searches, returning unified results for the Start Center and Search UI.
 */

import { LocalSearchIndex } from "./searchIndex";
import { searchGitHubRepos } from "./github";
import { searchWingetPackages } from "./winget";
import type { DiscoveryFilter, DiscoveryItem, DiscoverySearchResult } from "./types";

export class DiscoveryService {
  /**
   * Performs instant local multi-field search across software, styles, resources, templates, and patterns.
   */
  public static searchLocal(
    query: string,
    filter?: DiscoveryFilter,
    limit: number = 30,
  ): DiscoveryItem[] {
    return LocalSearchIndex.search(query, filter, limit);
  }

  /**
   * Performs unified search across local, GitHub, and Winget.
   * Local items are returned immediately or aggregated with online results.
   */
  public static async search(
    query: string,
    filter?: DiscoveryFilter,
  ): Promise<DiscoverySearchResult> {
    const startTime = performance.now();
    const trimmed = (query || "").trim();

    // 1. Instant local search
    const localItems = LocalSearchIndex.search(trimmed, filter);

    let onlineItems: DiscoveryItem[] = [];
    let wingetItems: DiscoveryItem[] = [];
    let fromCache = false;
    let rateLimited = false;
    let rateLimitMessage: string | undefined;

    // 2. Conditionally search GitHub or Winget if requested and query length >= 2
    if (trimmed.length >= 2) {
      const promises: Array<Promise<void>> = [];

      // Online GitHub search if enabled
      if (filter?.searchOnline) {
        promises.push(
          searchGitHubRepos(trimmed, { perPage: 12 }).then((res) => {
            onlineItems = res.items;
            if (res.fromCache) fromCache = true;
            if (res.rateLimited) {
              rateLimited = true;
              rateLimitMessage = res.rateLimitMessage;
            }
          }),
        );
      }

      // Online Winget search if enabled
      if (filter?.searchWinget) {
        promises.push(
          searchWingetPackages(trimmed).then((res) => {
            wingetItems = res;
          }),
        );
      }

      if (promises.length > 0) {
        await Promise.allSettled(promises);
      }
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      query: trimmed,
      localItems,
      onlineItems,
      wingetItems,
      total: localItems.length + onlineItems.length + wingetItems.length,
      fromCache,
      rateLimited,
      rateLimitMessage,
      durationMs,
    };
  }
}
