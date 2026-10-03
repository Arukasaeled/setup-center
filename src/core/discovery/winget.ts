/**
 * Setup Center — Winget Search Provider
 *
 * Integrates Windows Package Manager (winget) CLI search, enabling users to find
 * and install thousands of tools even if not in the curated catalog.
 */

import {
  isTauri,
  wingetSearch,
  wingetShow,
  type WingetSearchResultItem,
  type WingetPackageDetails,
} from "../../lib/ipc";
import type { DiscoveryItem } from "./types";

export async function searchWingetPackages(query: string): Promise<DiscoveryItem[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    return [];
  }

  if (!isTauri()) {
    // In browser/mock environment, return mock preview if query matches
    return [
      {
        id: `winget:${trimmed}`,
        type: "software",
        title: trimmed,
        subtitle: `winget package · ${trimmed}`,
        description: `Windows 软件包管理器中的 ${trimmed}。点击可直接调用 winget 安装。`,
        category: "winget",
        categoryLabel: "Winget 软件源",
        tags: ["winget", "Windows 包管理器"],
        origin: {
          type: "winget",
          packageId: `${trimmed}.${trimmed}`,
          source: "winget",
        },
        action: {
          id: `install:winget:${trimmed}`,
          label: "Winget 一键安装",
          type: "command",
          payload: `winget install --id ${trimmed}.${trimmed} --accept-source-agreements --accept-package-agreements`,
        },
        health: "ready",
      },
    ];
  }

  try {
    const rawItems: WingetSearchResultItem[] = await wingetSearch(trimmed);
    return rawItems.map((item) => ({
      id: `winget:${item.id}`,
      type: "software",
      title: item.name,
      subtitle: `${item.id} · v${item.version}`,
      description: `Windows 软件包源 (${item.source || "winget"}) 提供的官方安装包。`,
      category: "winget",
      categoryLabel: "Winget 软件源",
      tags: ["winget", item.source || "winget", `v${item.version}`],
      origin: {
        type: "winget",
        packageId: item.id,
        source: item.source || "winget",
      },
      action: {
        id: `install:winget:${item.id}`,
        label: "Winget 一键安装",
        type: "command",
        payload: `winget install --id ${item.id} --accept-source-agreements --accept-package-agreements`,
      },
      secondaryActions: [
        {
          id: `copy:winget:${item.id}`,
          label: "复制安装命令",
          type: "copy",
          payload: `winget install --id ${item.id}`,
        },
      ],
      health: "ready",
      raw: item,
    }));
  } catch (err) {
    console.warn("[WingetSearch] Search failed:", err);
    return [];
  }
}

export async function fetchWingetPackageDetails(
  packageId: string,
): Promise<WingetPackageDetails | null> {
  if (!isTauri()) {
    return {
      id: packageId,
      name: packageId,
      version: "1.0.0",
      publisher: "Community",
      description: "通过 Windows 软件包管理器安装的软件。",
      homepage: `https://github.com/microsoft/winget-pkgs`,
      source: "winget",
    };
  }
  try {
    return await wingetShow(packageId);
  } catch (err) {
    console.warn("[WingetShow] Failed to get details for", packageId, err);
    return null;
  }
}
