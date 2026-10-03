/**
 * Setup Center — GitHub Public Search Provider
 *
 * Provides unauthenticated public GitHub repository discovery with local caching
 * and friendly rate-limit handling.
 */

import type { DiscoveryItem } from "./types";

interface GitHubApiRepo {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    avatar_url?: string;
  };
  html_url: string;
  description: string | null;
  fork: boolean;
  stargazers_count: number;
  watchers_count: number;
  language: string | null;
  forks_count: number;
  archived: boolean;
  disabled: boolean;
  pushed_at: string;
  created_at: string;
  updated_at: string;
  homepage: string | null;
  license: {
    key: string;
    name: string;
    spdx_id: string;
  } | null;
  topics: string[];
}

interface GitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubApiRepo[];
}

interface CachedSearch {
  timestamp: number;
  data: GitHubSearchResponse;
}

const CACHE_STORAGE_KEY = "setup-center.github-search-cache.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function loadCache(): Record<string, CachedSearch> {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CachedSearch>): void {
  try {
    // Keep at most 50 search queries in cache to save storage
    const keys = Object.keys(cache);
    if (keys.length > 50) {
      keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp);
      for (const oldest of keys.slice(0, keys.length - 50)) {
        delete cache[oldest];
      }
    }
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

export function formatStars(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return count.toString();
}

export function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 60) return "刚刚更新";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} 小时前`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 30) return `${diffDay} 天前`;
    const diffMonth = Math.floor(diffDay / 30);
    if (diffMonth < 12) return `${diffMonth} 个月前`;
    const diffYear = Math.floor(diffDay / 365);
    return `${diffYear} 年前`;
  } catch {
    return "未知时间";
  }
}

export interface GitHubSearchResult {
  items: DiscoveryItem[];
  total: number;
  fromCache: boolean;
  rateLimited: boolean;
  rateLimitMessage?: string;
}

export async function searchGitHubRepos(
  query: string,
  options?: { perPage?: number; sort?: "stars" | "updated" | "default" },
): Promise<GitHubSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { items: [], total: 0, fromCache: false, rateLimited: false };
  }

  const perPage = options?.perPage ?? 16;
  const sort = options?.sort ?? "default";
  const cacheKey = `${trimmed.toLowerCase()}|sort:${sort}|p:${perPage}`;

  // Check cache
  const cache = loadCache();
  const cachedEntry = cache[cacheKey];
  const now = Date.now();

  if (cachedEntry && now - cachedEntry.timestamp < CACHE_TTL_MS) {
    const mapped = cachedEntry.data.items.map(mapRepoToDiscoveryItem);
    return {
      items: mapped,
      total: cachedEntry.data.total_count,
      fromCache: true,
      rateLimited: false,
    };
  }

  // Construct URL
  let sortParam = "";
  if (sort === "stars") sortParam = "&sort=stars&order=desc";
  else if (sort === "updated") sortParam = "&sort=updated&order=desc";

  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(trimmed)}${sortParam}&per_page=${perPage}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "SetupCenter-Desktop/0.2.0",
      },
    });
    clearTimeout(timer);

    if (res.status === 403 || res.status === 429) {
      // If we have stale cache, return it with notice
      if (cachedEntry) {
        return {
          items: cachedEntry.data.items.map(mapRepoToDiscoveryItem),
          total: cachedEntry.data.total_count,
          fromCache: true,
          rateLimited: true,
          rateLimitMessage: "GitHub 公共搜索请求暂达上限，已展示本地缓存结果。",
        };
      }
      return {
        items: [],
        total: 0,
        fromCache: false,
        rateLimited: true,
        rateLimitMessage: "GitHub 公共搜索频次已达限制（每分钟 10 次），请稍后再试或先查看本地收录项目。",
      };
    }

    if (!res.ok) {
      throw new Error(`GitHub API returned HTTP ${res.status}`);
    }

    const data: GitHubSearchResponse = await res.json();

    // Cache valid response
    cache[cacheKey] = {
      timestamp: now,
      data,
    };
    saveCache(cache);

    return {
      items: data.items.map(mapRepoToDiscoveryItem),
      total: data.total_count,
      fromCache: false,
      rateLimited: false,
    };
  } catch (err) {
    // If request failed (offline, timeout) but we have cache, fallback to it
    if (cachedEntry) {
      return {
        items: cachedEntry.data.items.map(mapRepoToDiscoveryItem),
        total: cachedEntry.data.total_count,
        fromCache: true,
        rateLimited: false,
      };
    }

    const msg = err instanceof Error ? err.message : String(err);
    return {
      items: [],
      total: 0,
      fromCache: false,
      rateLimited: false,
      rateLimitMessage: `GitHub 连接失败: ${msg}`,
    };
  }
}

export function mapRepoToDiscoveryItem(repo: GitHubApiRepo): DiscoveryItem {
  // Activity / Health detection
  let health: DiscoveryItem["health"] = "active";
  if (repo.archived) {
    health = "archived";
  } else {
    const pushed = new Date(repo.pushed_at).getTime();
    const now = Date.now();
    const monthsSincePush = (now - pushed) / (1000 * 60 * 60 * 24 * 30);
    if (monthsSincePush > 12) {
      health = "quiet";
    }
  }

  return {
    id: `gh:${repo.full_name}`,
    type: "repo",
    title: repo.name,
    subtitle: `${repo.owner.login} · ${repo.language || "多语言"}`,
    description: repo.description || "暂无项目描述",
    category: "github-repo",
    categoryLabel: "GitHub 项目",
    tags: [
      repo.language || "Code",
      ...(repo.license ? [repo.license.spdx_id || repo.license.name] : []),
      ...(repo.topics || []).slice(0, 5),
    ],
    origin: {
      type: "github",
      url: repo.html_url,
      repository: repo.html_url,
      author: repo.owner.login,
      stars: formatStars(repo.stargazers_count),
      license: repo.license?.spdx_id || repo.license?.name || "未知",
      language: repo.language || "多种语言",
      lastUpdated: formatRelativeTime(repo.pushed_at),
      isArchived: repo.archived,
    },
    action: {
      id: `clone:${repo.full_name}`,
      label: "克隆仓库 (Clone)",
      type: "command",
      payload: `git clone ${repo.html_url}.git`,
    },
    health,
    isCurated: false,
    raw: repo,
  };
}
