/**
 * Setup Center — Dynamic Software Detail Modal (Open World Discovery)
 *
 * Provides a dedicated inspection workspace for external & online software
 * discovered via Winget or web search:
 * - Rich metadata: Package ID, Publisher, Version, License, Homepage, Installer
 * - One-click Winget Install with live streaming console
 * - Direct native installer download
 * - Add to Custom Packs (开发套件)
 * - Bookmark & Save to Personal Catalog
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import type { DiscoveryItem } from "../core/discovery/types";
import { fetchWingetPackageDetails } from "../core/discovery/winget";
import { PersonalCatalog, type DynamicSoftware } from "../core/transfer/catalog";
import { Bookmarks } from "../core/transfer/bookmarks";
import { CustomPacks, type CustomPack } from "../core/transfer/packs";
import { nativeDownload, isTauri, type WingetPackageDetails } from "../lib/ipc";
import { ExecutionConsoleModal } from "./ExecutionConsoleModal";

export interface DynamicSoftwareDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: DiscoveryItem | null;
  onNotice?: (msg: string) => void;
}

export function DynamicSoftwareDetailModal({
  isOpen,
  onClose,
  item,
  onNotice,
}: DynamicSoftwareDetailModalProps) {
  const [details, setDetails] = useState<WingetPackageDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showPackPicker, setShowPackPicker] = useState(false);
  const [packs, setPacks] = useState<CustomPack[]>(CustomPacks.getAll());
  const [isSavedInCatalog, setIsSavedInCatalog] = useState(false);

  const cleanPackageId = item
    ? item.origin?.packageId || (item.id.startsWith("winget:") ? item.id.replace(/^winget:/, "") : item.id)
    : "";

  useEffect(() => {
    if (!isOpen || !item) {
      setDetails(null);
      setLoading(false);
      setIsConsoleOpen(false);
      setShowPackPicker(false);
      return;
    }

    setIsBookmarked(Bookmarks.isBookmarked(item.id));
    setIsSavedInCatalog(Boolean(PersonalCatalog.getSoftware(item.id)));
    setPacks(CustomPacks.getAll());

    setLoading(true);
    fetchWingetPackageDetails(cleanPackageId)
      .then((res) => {
        setDetails(res);
      })
      .catch((err) => {
        console.warn("[DynamicSoftwareDetail] Failed to load details:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, item?.id, cleanPackageId]);

  if (!isOpen || !item) return null;

  const handleToggleBookmark = () => {
    const next = Bookmarks.toggle(item.id, item.title, item);
    setIsBookmarked(next);
    onNotice?.(next ? "已加入个人收藏清单" : "已从收藏中移除");
  };

  const handleSaveToPersonalCatalog = () => {
    const sw: DynamicSoftware = {
      id: item.id.startsWith("winget:") ? item.id : `winget:${cleanPackageId}`,
      packageId: cleanPackageId,
      provider: "winget",
      name: details?.name || item.title,
      publisher: details?.publisher,
      version: details?.version || item.subtitle?.split("·")?.[1]?.trim(),
      description: details?.description || item.description,
      homepage: details?.homepage,
      license: details?.license,
      installerType: details?.installerType,
      installerUrl: details?.installerUrl,
      installerSha256: details?.installerSha256,
      installed: item.installed ?? false,
      discoveredAt: new Date().toISOString(),
    };
    PersonalCatalog.saveSoftware(sw);
    setIsSavedInCatalog(true);
    onNotice?.(`已将「${sw.name}」永久保存至个人资产`);
  };

  const handleInstallSuccess = () => {
    const sw: DynamicSoftware = {
      id: item.id.startsWith("winget:") ? item.id : `winget:${cleanPackageId}`,
      packageId: cleanPackageId,
      provider: "winget",
      name: details?.name || item.title,
      publisher: details?.publisher,
      version: details?.version,
      description: details?.description || item.description,
      homepage: details?.homepage,
      installed: true,
      installedVersion: details?.version,
      discoveredAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
    };
    PersonalCatalog.saveSoftware(sw);
    setIsSavedInCatalog(true);
    onNotice?.(`✓ 「${sw.name}」安装完成并已纳管至个人软件库`);
  };

  const handleCopyInstallCommand = async () => {
    const cmd = `winget install --id ${cleanPackageId} -e --accept-source-agreements --accept-package-agreements`;
    try {
      await navigator.clipboard.writeText(cmd);
      onNotice?.("安装命令已复制到剪贴板");
    } catch {
      onNotice?.("复制失败");
    }
  };

  const handleDirectDownload = async () => {
    if (!details?.installerUrl) {
      onNotice?.("此软件包源未公开直接下载直链，建议使用一键 Winget 安装");
      return;
    }
    if (!isTauri()) {
      window.open(details.installerUrl, "_blank");
      return;
    }

    setIsDownloading(true);
    onNotice?.("正在启动 Windows 原生流式下载…");

    try {
      const ext = details.installerType?.toLowerCase() || "exe";
      const filename = `${cleanPackageId}_setup.${ext}`;
      const dest = `C:\\Users\\Public\\Downloads\\${filename}`;
      await nativeDownload(details.installerUrl, dest);
      onNotice?.(`✓ 安装包已下载至: ${dest}`);
    } catch (err: any) {
      onNotice?.(`下载失败: ${err?.message || String(err)}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleAddToPack = (packId: string) => {
    CustomPacks.addItem(packId, {
      id: item.id,
      name: details?.name || item.title,
      type: "software",
      category: "Winget 软件",
      command: `winget install --id ${cleanPackageId}`,
      url: details?.homepage,
      note: details?.description || item.description,
    });
    setShowPackPicker(false);
    onNotice?.(`已将「${details?.name || item.title}」加入开发套件`);
  };

  const content = (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dynamic-software-detail-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      >
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Modal Window */}
        <div className="relative z-10 flex h-full w-full max-h-[85vh] max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-[#12151b] text-zinc-100 shadow-2xl">
          {/* Header */}
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-800 bg-[#141820] px-6 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="rounded bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 text-[11px] font-bold text-sky-300">
                  Winget 软件源
                </span>
                <h3
                  id="dynamic-software-detail-title"
                  className="text-[18px] font-bold text-white truncate"
                >
                  {details?.name || item.title}
                </h3>
                {details?.version && (
                  <span className="font-mono text-[11.5px] text-zinc-400">
                    v{details.version}
                  </span>
                )}
              </div>
              <p className="font-mono text-[12px] text-zinc-400 mt-1 truncate">
                Package ID: {cleanPackageId}
                {details?.publisher ? ` · ${details.publisher}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleToggleBookmark}
                className={clsx(
                  "flex h-8 items-center gap-1 rounded-lg border px-3 text-[12px] font-bold transition-all cursor-pointer",
                  isBookmarked
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                    : "border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:text-white",
                )}
                title={isBookmarked ? "取消收藏" : "收藏至我的库"}
              >
                <span>{isBookmarked ? "★" : "☆"}</span>
                <span>{isBookmarked ? "已收藏" : "收藏"}</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/80 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>
          </header>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Description & Overview */}
            <div className="space-y-2">
              <h4 className="text-[12px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
                软件简介
              </h4>
              <p className="text-[13.5px] leading-relaxed text-zinc-200">
                {details?.description || item.description || "暂无详细描述。通过 Windows 官方包管理器源获取。"}
              </p>
            </div>

            {/* Spec grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl border border-zinc-800 bg-[#0d1014] p-4 text-[12px]">
              <div>
                <span className="text-zinc-500 block font-mono text-[11px]">软件包 ID</span>
                <span className="font-mono font-medium text-zinc-200 truncate block mt-0.5">
                  {cleanPackageId}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block font-mono text-[11px]">最新版本</span>
                <span className="font-mono font-medium text-zinc-200 truncate block mt-0.5">
                  {details?.version || item.subtitle || "未知"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block font-mono text-[11px]">发布者 / Publisher</span>
                <span className="font-medium text-zinc-200 truncate block mt-0.5">
                  {details?.publisher || "社区源"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block font-mono text-[11px]">开源 / 授权协议</span>
                <span className="font-medium text-zinc-200 truncate block mt-0.5">
                  {details?.license || "遵循源声明"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block font-mono text-[11px]">安装包类型</span>
                <span className="font-mono font-medium text-zinc-200 truncate block mt-0.5">
                  {details?.installerType || "exe / msi"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block font-mono text-[11px]">源渠道</span>
                <span className="font-mono font-medium text-zinc-200 truncate block mt-0.5">
                  {details?.source || "winget"}
                </span>
              </div>
            </div>

            {/* Pack Picker Popover */}
            {showPackPicker && (
              <div className="rounded-xl border border-blue-500/40 bg-[#151c28] p-4 space-y-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-bold text-blue-200">
                    选择要加入的开发套件:
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPackPicker(false)}
                    className="text-zinc-400 hover:text-white text-[12px]"
                  >
                    ✕
                  </button>
                </div>
                {packs.length === 0 ? (
                  <p className="text-[12px] text-zinc-400">尚未创建任何开发套件，请先至「我的库」新建开发包。</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {packs.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleAddToPack(p.id)}
                        className="rounded-lg border border-zinc-700 bg-zinc-800/70 p-2.5 text-left hover:border-blue-500/50 hover:bg-zinc-800 transition-colors cursor-pointer"
                      >
                        <div className="font-bold text-[12.5px] text-white truncate">{p.title}</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5 truncate">{p.items.length} 项工具</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Live Inspection notice */}
            {loading && (
              <div className="flex items-center gap-2 text-[12px] text-zinc-400 font-mono">
                <span className="inline-block animate-spin">◷</span>
                <span>正在向 Windows Winget 知识库检索详细哈希与安装包直链…</span>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-[#141820] px-6 py-3.5">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleSaveToPersonalCatalog}
                className={clsx(
                  "rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer",
                  isSavedInCatalog
                    ? "border-emerald-600/40 bg-emerald-900/20 text-emerald-300"
                    : "border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white",
                )}
              >
                {isSavedInCatalog ? "✓ 已存入个人资产" : "+ 保存到我的软件"}
              </button>

              <button
                type="button"
                onClick={() => setShowPackPicker((prev) => !prev)}
                className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
              >
                + 加入开发套件
              </button>

              {details?.homepage && (
                <a
                  href={details.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
                >
                  官方主页 ↗
                </a>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleCopyInstallCommand}
                className="rounded-lg border border-zinc-700 bg-transparent px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              >
                复制命令
              </button>

              {details?.installerUrl && (
                <button
                  type="button"
                  onClick={handleDirectDownload}
                  disabled={isDownloading}
                  className="rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-1.5 text-[12px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
                >
                  {isDownloading ? "下载中…" : "下载安装包"}
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsConsoleOpen(true)}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-[12.5px] font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer shadow-sm"
              >
                一键 Winget 安装
              </button>
            </div>
          </footer>
        </div>
      </div>

      {isConsoleOpen && (
        <ExecutionConsoleModal
          isOpen={true}
          onClose={() => setIsConsoleOpen(false)}
          title={`Winget 安装: ${details?.name || item.title}`}
          command="winget"
          args={["install", "--id", cleanPackageId, "-e", "--accept-source-agreements", "--accept-package-agreements"]}
          onSuccess={handleInstallSuccess}
        />
      )}
    </>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
