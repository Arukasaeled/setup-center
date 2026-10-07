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
import clsx from "clsx";
import { AccessibleDialog } from "./AccessibleDialog";
import type { DiscoveryItem } from "../core/discovery/types";
import { fetchWingetPackageDetails } from "../core/discovery/winget";
import { PersonalCatalog, type DynamicSoftware } from "../core/transfer/catalog";
import { Bookmarks } from "../core/transfer/bookmarks";
import { CustomPacks, type CustomPack } from "../core/transfer/packs";
import {
  nativeDownload,
  getDownloadsDir,
  buildDynamicInstallPlan,
  runInstall,
  cancelTask,
  isTauri,
  type WingetPackageDetails,
} from "../lib/ipc";
import type { ExecutionSession, PackageObservation } from "../lib/types";
import { openExternalUrl } from "../core/setup/executor";

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
  const [isInstalling, setIsInstalling] = useState(false);
  const [installTaskId, setInstallTaskId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
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
      setIsInstalling(false);
      setShowPackPicker(false);
      return;
    }

    setIsBookmarked(Bookmarks.isBookmarked(item.id));
    setIsSavedInCatalog(PersonalCatalog.getAllSoftware().some((software) =>
      software.provider === "winget" && software.packageId.toLowerCase() === cleanPackageId.toLowerCase()));
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
    const previous = PersonalCatalog.getAllSoftware().find((sw) =>
      sw.provider === "winget" && sw.packageId.toLowerCase() === cleanPackageId.toLowerCase());
    const sw: DynamicSoftware = {
      ...previous,
      id: previous?.id || `winget:${cleanPackageId}`,
      packageId: cleanPackageId,
      provider: "winget",
      name: details?.name || item.title,
      publisher: details?.publisher ?? previous?.publisher,
      version: details?.version || previous?.version || item.subtitle?.split("·")?.[1]?.trim(),
      description: details?.description || previous?.description || item.description,
      homepage: details?.homepage ?? previous?.homepage,
      license: details?.license ?? previous?.license,
      installerType: details?.installerType ?? previous?.installerType,
      installerUrl: details?.installerUrl ?? previous?.installerUrl,
      installerSha256: details?.installerSha256 ?? previous?.installerSha256,
      installed: previous?.installed ?? item.installed,
      discoveredAt: previous?.discoveredAt || new Date().toISOString(),
    };
    PersonalCatalog.saveSoftware(sw);
    setIsSavedInCatalog(true);
    onNotice?.(`已将「${sw.name}」永久保存至个人资产`);
  };

  const handleInstallSession = async (session: ExecutionSession) => {
    if (!item) return;
    const previous = PersonalCatalog.getAllSoftware().find((sw) =>
      sw.provider === "winget" && sw.packageId.toLowerCase() === cleanPackageId.toLowerCase());
    const candidate = session.packageObservation;
    const observation: PackageObservation = candidate?.provider === "winget"
      && candidate.packageId.toLowerCase() === cleanPackageId.toLowerCase() ? candidate : {
        provider: "winget", packageId: cleanPackageId, presence: "unknown",
        observedAt: new Date().toISOString(), detail: "本次任务未返回该软件包的可靠本机观察",
      };
    const sw: DynamicSoftware = {
      ...previous,
      id: previous?.id || `winget:${cleanPackageId}`,
      packageId: cleanPackageId, provider: "winget",
      name: details?.name || previous?.name || item.title,
      publisher: details?.publisher ?? previous?.publisher,
      version: details?.version ?? previous?.version,
      description: details?.description ?? previous?.description ?? item.description,
      homepage: details?.homepage ?? previous?.homepage,
      license: details?.license ?? previous?.license,
      installerType: details?.installerType ?? previous?.installerType,
      installerUrl: details?.installerUrl ?? previous?.installerUrl,
      installerSha256: details?.installerSha256 ?? previous?.installerSha256,
      discoveredAt: previous?.discoveredAt || new Date().toISOString(),
      packageObservation: observation,
      actionOutcome: session.taskStatus,
    };
    if (observation.presence === "present") {
      sw.installed = true;
      sw.installedVersion = observation.installedVersion?.trim() || previous?.installedVersion;
      sw.lastVerifiedAt = observation.observedAt;
    } else if (observation.presence === "absent") {
      sw.installed = false;
      sw.installedVersion = undefined;
      sw.lastVerifiedAt = observation.observedAt;
    }
    // Unknown preserves previous installed/version/verification fields, independently of action outcome.
    try {
      PersonalCatalog.saveSoftware(sw);
      setIsSavedInCatalog(true);
    } catch (error) {
      onNotice?.(`任务已结束，但个人记录未能保存：${String(error)}`);
      return;
    }
    const action = session.taskStatus === "succeeded" ? "安装动作完成"
      : session.taskStatus === "cancelled" ? "安装已取消"
      : session.taskStatus === "needsAttention" ? "安装已暂停，需要人工处理" : "安装动作未成功";
    onNotice?.(`${action}；${observation.presence === "present" ? "本机确认已安装"
      : observation.presence === "absent" ? "本机未发现该软件包" : "本次状态未确认，已保留旧记录"}`);
  };

  const handleWingetInstall = async () => {
    if (!item) return;
    setIsInstalling(true);
    try {
      onNotice?.(`正在验证软件包授权与依赖，生成可信安装计划…`);
      const plan = await buildDynamicInstallPlan(cleanPackageId);
      onNotice?.(`已生成可信安装计划，正在启动 Winget 安装…`);
      const requestId = `dynamic-install-${cleanPackageId}-${Date.now()}`;
      const session = await runInstall({ planId: plan.planId, requestId }, (payload) => setInstallTaskId(payload.taskId));
      await handleInstallSession(session);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("LicenseRequired") || msg.includes("Pro entitlement")) {
        onNotice?.("需要专业版授权：安装功能需激活 Pro 授权。请先在设置中激活。");
      } else {
        onNotice?.(`安装启动失败: ${msg}`);
      }
    } finally {
      setIsInstalling(false);
      setInstallTaskId(null);
      setIsCancelling(false);
    }
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

  const inferExtension = (url?: string, installerType?: string): string => {
    if (url) {
      try {
        const cleanUrl = url.split("?")[0].split("#")[0];
        const match = cleanUrl.match(/\.(exe|msi|msix|msixbundle|zip|appx|appxbundle|tar\.gz|tgz)$/i);
        if (match && match[1]) {
          return match[1].toLowerCase();
        }
      } catch {
        // fallback
      }
    }
    const typeMap: Record<string, string> = {
      nullsoft: "exe",
      inno: "exe",
      wix: "msi",
      burn: "exe",
      msi: "msi",
      msix: "msix",
      msixbundle: "msixbundle",
      zip: "zip",
      appx: "appx",
      portable: "zip",
      exe: "exe",
    };
    if (installerType && typeMap[installerType.toLowerCase()]) {
      return typeMap[installerType.toLowerCase()];
    }
    return "exe";
  };

  const handleDirectDownload = async () => {
    if (!details?.installerUrl) {
      onNotice?.("此软件包源未公开直接下载直链，建议使用一键 Winget 安装");
      return;
    }
    if (!isTauri()) {
      openExternalUrl(details.installerUrl);
      return;
    }

    setIsDownloading(true);
    onNotice?.("正在启动 Windows 原生流式下载…");

    try {
      const ext = inferExtension(details.installerUrl, details.installerType);
      const filename = `${cleanPackageId}_setup.${ext}`;
      let downloadsFolder = "C:\\Users\\Public\\Downloads";
      try {
        const authenticDir = await getDownloadsDir();
        if (authenticDir && authenticDir.trim()) {
          downloadsFolder = authenticDir.trim();
        }
      } catch {
        // fallback
      }
      const sep = downloadsFolder.endsWith("\\") || downloadsFolder.endsWith("/") ? "" : "\\";
      const dest = `${downloadsFolder}${sep}${filename}`;

      const result = await nativeDownload({
        url: details.installerUrl,
        destinationPath: dest,
        expectedSha256: details.installerSha256?.trim() || undefined,
      });
      if (!result.success) throw new Error("下载未完成，未保存可用的安装包");

      if (details.installerSha256 && details.installerSha256.trim()) {
        if (result.sha256Verified) {
          onNotice?.(`✓ 下载完成且 SHA256 校验通过: ${dest}`);
        } else {
          onNotice?.(`⚠ 警告: 文件已下载至 ${dest}，但 SHA256 校验不匹配，可能存在损坏或篡改`);
        }
      } else {
        onNotice?.(`✓ 安装包已下载至: ${dest}`);
      }
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

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      titleId="dynamic-software-detail-title"
      className="p-4 sm:p-6"
      contentClassName="relative z-10 flex h-full w-full max-h-[85vh] max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-[#12151b] text-zinc-100 shadow-2xl"
    >
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
            aria-label={isBookmarked ? "取消收藏" : "收藏至我的库"}
            className={clsx(
              "flex h-8 min-h-[32px] items-center gap-1 rounded-lg border px-3 text-[12px] font-bold transition-all cursor-pointer",
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
            aria-label="关闭软件详情"
            className="flex h-8 w-8 min-h-[32px] min-w-[32px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/80 text-zinc-400 hover:text-white transition-colors cursor-pointer"
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

            {/* Installed & Availability Status Banner */}
            {(() => {
              const localSaved = PersonalCatalog.getAllSoftware().find((software) =>
                software.provider === "winget" && software.packageId.toLowerCase() === cleanPackageId.toLowerCase());
              if (!localSaved) return null;
              const avail = localSaved.availabilityEvidence;
              const observation = localSaved.packageObservation;
              const outcome = localSaved.actionOutcome;
              return (
                <div className="rounded-xl border border-zinc-800 bg-[#0e1218] p-3.5 space-y-1.5 text-[12.5px]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-300">本机纳管状态</span>
                    <span
                      className={clsx(
                        "px-2 py-0.5 rounded text-[11px] font-bold",
                        (observation ? observation.presence === "present" : localSaved.installed && avail?.status === "available")
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : avail?.status === "legacyUnverified"
                          ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                          : "bg-zinc-800 text-zinc-400 border border-zinc-700",
                      )}
                    >
                      {observation
                        ? observation.presence === "present" ? "已安装 · 本机确认"
                          : observation.presence === "absent" ? "本机未发现" : "本次未确认 · 保留旧记录"
                        : localSaved.installed && avail?.status === "available"
                        ? "已安装 · 可用"
                        : avail?.status === "legacyUnverified"
                        ? "历史记录 · 待重新验证"
                        : outcome === "succeeded"
                        ? "安装动作完成 · 可用性未确认"
                        : "未就绪"}
                    </span>
                  </div>
                  {(observation?.detail || avail?.detail) && (
                    <p className="text-[12px] text-zinc-400">{observation?.detail || avail?.detail}</p>
                  )}
                  {localSaved.lastVerifiedAt && (
                    <p className="text-[11px] font-mono text-zinc-500">
                      上次验证时间: {new Date(localSaved.lastVerifiedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              );
            })()}

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
                  onClick={(e) => {
                    e.preventDefault();
                    if (details.homepage) openExternalUrl(details.homepage);
                  }}
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
                  aria-label="直接下载官方安装包"
                  className="min-h-[32px] rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-1.5 text-[12px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
                >
                  {isDownloading ? "下载中…" : "下载安装包"}
                </button>
              )}

              <button
                type="button"
                onClick={handleWingetInstall}
                disabled={isInstalling}
                aria-label="通过 Winget 一键安装软件"
                className="min-h-[32px] rounded-lg bg-blue-600 px-4 py-1.5 text-[12.5px] font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
              >
                {isInstalling ? "正在启动 Winget 安装…" : "一键 Winget 安装"}
              </button>
              {isInstalling && installTaskId && (
                <button type="button" disabled={isCancelling}
                  className="min-h-[32px] rounded-lg border border-zinc-700 px-4 py-1.5 text-[12.5px] disabled:opacity-50"
                  onClick={() => {
                    setIsCancelling(true);
                    void cancelTask(installTaskId).catch((error) => {
                      onNotice?.(`取消未完成：${String(error)}`);
                      setIsCancelling(false);
                    });
                  }}>
                  {isCancelling ? "正在取消…" : "取消安装"}
                </button>
              )}
            </div>
          </footer>
    </AccessibleDialog>
  );
}
