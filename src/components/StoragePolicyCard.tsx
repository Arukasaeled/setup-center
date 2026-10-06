/**
 * StoragePolicyCard — Installation and storage management.
 *
 * Provides control over where software is installed and where download caches
 * reside. Clearly distinguishes between:
 *  1. Temporary downloaded packages (installers / archives in cache)
 *  2. Software target installation root (where programs actually live)
 *
 * Supports three storage modes:
 *  - system-default: Standard Windows / Winget defaults
 *  - prefer-secondary: Auto-selects secondary disk (e.g. D:\SetupCenterApps)
 *  - custom: User-specified target directory with validation & folder browser
 */

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button } from "./ui";
import { useApp } from "../lib/store";
import * as ipc from "../lib/ipc";
import type {
  DiskInfo,
  PathValidationResult,
  StorageMode,
  StoragePolicy,
} from "../lib/types";

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

export function StoragePolicyCard() {
  const environment = useApp((s) => s.environment);
  const storagePolicy = useApp((s) => s.storagePolicy);
  const loadStoragePolicy = useApp((s) => s.loadStoragePolicy);
  const updateStoragePolicy = useApp((s) => s.updateStoragePolicy);
  const cleanDownloadCache = useApp((s) => s.cleanDownloadCache);
  const catalogue = useApp((s) => s.catalogue);

  const [mode, setMode] = useState<StorageMode>(
    storagePolicy?.mode ?? "system-default",
  );
  const [customPath, setCustomPath] = useState(
    storagePolicy?.customRoot ?? "D:\\SetupCenterApps",
  );
  const [validation, setValidation] = useState<PathValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanNotice, setCleanNotice] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Sync local state when store's policy updates
  useEffect(() => {
    if (!storagePolicy) {
      void loadStoragePolicy();
    } else {
      setMode(storagePolicy.mode);
      if (storagePolicy.customRoot) {
        setCustomPath(storagePolicy.customRoot);
      }
    }
  }, [storagePolicy, loadStoragePolicy]);

  // Validate custom path when entering custom mode or editing path
  useEffect(() => {
    if (mode !== "custom" || !customPath.trim()) {
      setValidation(null);
      return;
    }

    let active = true;
    setValidating(true);
    const timer = setTimeout(async () => {
      try {
        const res = await ipc.validateStoragePath(customPath.trim());
        if (active) {
          setValidation(res);
          setValidating(false);
        }
      } catch (err) {
        if (active) {
          setValidation({
            valid: false,
            reason: err instanceof Error ? err.message : String(err),
          });
          setValidating(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [mode, customPath]);

  const handleModeChange = async (nextMode: StorageMode) => {
    setMode(nextMode);
    setSaveNotice(null);
    const newPolicy: StoragePolicy = {
      mode: nextMode,
      customRoot: nextMode === "custom" ? customPath.trim() : storagePolicy?.customRoot,
    };
    const ok = await updateStoragePolicy(newPolicy);
    if (ok) {
      setSaveNotice(
        nextMode === "system-default"
          ? "已切换为系统默认安装位置"
          : nextMode === "prefer-secondary"
            ? "已启用优先副盘安装策略"
            : "已切换为自定义安装路径",
      );
      setTimeout(() => setSaveNotice(null), 3000);
    }
  };

  const handleBrowse = async () => {
    try {
      const selected = await ipc.selectStorageFolder();
      if (selected) {
        setCustomPath(selected);
        const res = await ipc.validateStoragePath(selected);
        setValidation(res);
        if (res.valid) {
          const ok = await updateStoragePolicy({
            mode: "custom",
            customRoot: selected,
          });
          if (ok) {
            setSaveNotice(`已保存自定义目录: ${selected}`);
            setTimeout(() => setSaveNotice(null), 3000);
          }
        }
      }
    } catch (err) {
      console.warn("Folder picker error:", err);
    }
  };

  const handleSaveCustom = async () => {
    if (!validation?.valid) return;
    const ok = await updateStoragePolicy({
      mode: "custom",
      customRoot: customPath.trim(),
    });
    if (ok) {
      setSaveNotice(`已保存自定义目录: ${customPath.trim()}`);
      setTimeout(() => setSaveNotice(null), 3000);
    }
  };

  const handleCleanCache = async () => {
    setCleaning(true);
    setCleanNotice(null);
    try {
      const freed = await cleanDownloadCache();
      if (freed > 0) {
        setCleanNotice(`清理完成，已释放 ${formatBytes(freed)} 磁盘空间`);
      } else {
        setCleanNotice("临时缓存已是最新，无冗余安装包");
      }
      setTimeout(() => setCleanNotice(null), 4000);
    } catch {
      setCleanNotice("清理缓存时遇到错误");
    } finally {
      setCleaning(false);
    }
  };

  // Enumerate disks
  const disks: DiskInfo[] = environment?.disks ?? [];
  const systemDrive =
    storagePolicy?.systemDrive ??
    (disks.length > 0 ? disks[0].root.toUpperCase() : "C:\\");

  // Location capability stats
  const supportedSoftware = catalogue.filter(
    (s) => s.installLocation === "supported",
  );
  const totalInstallable = catalogue.filter((s) => s.installable).length;

  return (
    <section className="glass rise rounded-[14px] p-5 border border-[color:var(--line-subtle)]/70">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[color:var(--text-strong)] text-[16px] font-semibold tracking-[-0.01em]">
            安装与存储策略
          </h2>
          <p className="text-[color:var(--text-tertiary)] mt-0.5 text-[12.5px]">
            分别管理安装包下载临时缓存与软件实际安装目录，避免 C 盘空间臃肿。
          </p>
        </div>
        {saveNotice && (
          <span className="text-[color:var(--text-quiet)] text-[12px] bg-[color:var(--surface-active)] px-2.5 py-1 rounded-[6px]">
            {saveNotice}
          </span>
        )}
      </div>

      {/* Disks status row */}
      {disks.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {disks.map((disk) => {
            const isSystem = disk.root.toUpperCase().startsWith(systemDrive);
            return (
              <div
                key={disk.root}
                className={clsx(
                  "flex items-center gap-2 rounded-[8px] border px-3 py-1.5 text-[12px]",
                  isSystem
                    ? "border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)]"
                    : "border-[color:var(--line-default)] bg-[color:var(--surface-active)]/40",
                )}
              >
                <span className="font-mono font-semibold text-[color:var(--text-primary)]">
                  {disk.root}
                </span>
                <span className="text-[color:var(--text-quiet)]">
                  {isSystem ? "系统盘" : disk.label ? disk.label : "本地磁盘"}
                </span>
                <span className="text-[color:var(--text-secondary)] font-medium">
                  {formatBytes(disk.freeBytes)} 可用
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Strategy Mode Choices */}
      <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* System Default */}
        <label
          onClick={() => void handleModeChange("system-default")}
          className={clsx(
            "flex flex-col justify-between rounded-[10px] border p-3.5 cursor-pointer transition-colors duration-150",
            mode === "system-default"
              ? "border-[color:var(--text-strong)] bg-[color:var(--surface-inset)] shadow-sm"
              : "border-[color:var(--line-subtle)] hover:bg-[color:var(--surface-hover)]",
          )}
        >
          <div className="flex items-start gap-2.5">
            <input
              type="radio"
              name="storageMode"
              checked={mode === "system-default"}
              onChange={() => {}}
              className="mt-0.5 accent-[color:var(--accent)]"
            />
            <div>
              <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
                系统默认
              </div>
              <p className="text-[color:var(--text-quiet)] mt-1 text-[12px] leading-relaxed">
                遵循 Winget 及官方安装包默认路径（通常在 C:\Program Files 或 AppData）。与官方行为完全一致。
              </p>
            </div>
          </div>
        </label>

        {/* Prefer Secondary */}
        <label
          onClick={() => void handleModeChange("prefer-secondary")}
          className={clsx(
            "flex flex-col justify-between rounded-[10px] border p-3.5 cursor-pointer transition-colors duration-150",
            mode === "prefer-secondary"
              ? "border-[color:var(--text-strong)] bg-[color:var(--surface-inset)] shadow-sm"
              : "border-[color:var(--line-subtle)] hover:bg-[color:var(--surface-hover)]",
          )}
        >
          <div className="flex items-start gap-2.5">
            <input
              type="radio"
              name="storageMode"
              checked={mode === "prefer-secondary"}
              onChange={() => {}}
              className="mt-0.5 accent-[color:var(--accent)]"
            />
            <div>
              <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
                优先其他磁盘
              </div>
              <p className="text-[color:var(--text-quiet)] mt-1 text-[12px] leading-relaxed">
                自动寻找空间充足的副盘并建立安装目录（如{" "}
                <span className="font-mono text-[color:var(--text-secondary)]">
                  {storagePolicy?.resolvedRoot ?? "D:\\SetupCenterApps"}
                </span>
                ）。
              </p>
            </div>
          </div>
          {storagePolicy?.fallbackReason && mode === "prefer-secondary" && (
            <div className="mt-2 text-[11.5px] text-[color:var(--status-warning)]">
              提示：{storagePolicy.fallbackReason}
            </div>
          )}
        </label>

        {/* Custom */}
        <label
          onClick={() => void handleModeChange("custom")}
          className={clsx(
            "flex flex-col justify-between rounded-[10px] border p-3.5 cursor-pointer transition-colors duration-150",
            mode === "custom"
              ? "border-[color:var(--text-strong)] bg-[color:var(--surface-inset)] shadow-sm"
              : "border-[color:var(--line-subtle)] hover:bg-[color:var(--surface-hover)]",
          )}
        >
          <div className="flex items-start gap-2.5">
            <input
              type="radio"
              name="storageMode"
              checked={mode === "custom"}
              onChange={() => {}}
              className="mt-0.5 accent-[color:var(--accent)]"
            />
            <div>
              <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
                自定义位置
              </div>
              <p className="text-[color:var(--text-quiet)] mt-1 text-[12px] leading-relaxed">
                手动指定软件安装根目录。支持浏览文件夹或输入绝对路径。
              </p>
            </div>
          </div>
        </label>
      </div>

      {/* Custom Path Picker (when mode === 'custom') */}
      {mode === "custom" && (
        <div className="mt-4 rounded-[10px] border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] p-3.5">
          <label className="text-[color:var(--text-secondary)] block text-[12.5px] font-medium mb-1.5">
            自定义安装根目录
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="例如 D:\Apps 或 E:\Development\Apps"
              className="flex-1 rounded-[8px] border border-[color:var(--line-default)] bg-[color:var(--surface-base)] px-3 py-1.5 font-mono text-[13px] text-[color:var(--text-primary)] focus:outline-none focus:border-[color:var(--text-strong)]"
            />
            <Button size="sm" variant="ghost" onClick={handleBrowse}>
              浏览文件夹…
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={validating || !validation?.valid}
              onClick={handleSaveCustom}
            >
              保存
            </Button>
          </div>

          {/* Validation Status */}
          <div className="mt-2 text-[12px] flex items-center gap-1.5">
            {validating ? (
              <span className="text-[color:var(--text-quiet)]">正在校验路径…</span>
            ) : validation ? (
              validation.valid ? (
                <span className="text-[color:var(--status-ok)] flex items-center gap-1 font-medium">
                  ✓ 路径有效
                  {validation.freeSpaceBytes != null &&
                    ` · 可用空间 ${formatBytes(validation.freeSpaceBytes)}`}
                </span>
              ) : (
                <span className="text-[color:var(--status-bad)] flex items-center gap-1">
                  ✕ {validation.reason ?? "路径无效"}
                </span>
              )
            ) : null}
          </div>
        </div>
      )}

      {/* Two-part Storage Architecture Explanation */}
      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3 pt-4 border-t border-[color:var(--line-subtle)]">
        {/* Temporary Downloads Cache */}
        <div className="rounded-[10px] bg-[color:var(--surface-inset)]/60 p-3.5 border border-[color:var(--line-subtle)]/50">
          <div className="flex items-center justify-between">
            <span className="text-[color:var(--text-primary)] text-[13px] font-medium flex items-center gap-1.5">
              📁 安装包临时缓存
            </span>
            <Button
              size="sm"
              variant="quiet"
              disabled={cleaning}
              onClick={handleCleanCache}
            >
              {cleaning ? "清理中…" : "清理缓存"}
            </Button>
          </div>
          <p className="text-[color:var(--text-quiet)] mt-1.5 text-[11.5px] leading-relaxed">
            存放从官方下载的临时安装包，安装完成后可安全清理，绝不损坏已装软件。
          </p>
          <div className="mt-2 font-mono text-[11px] text-[color:var(--text-tertiary)] truncate">
            位置: {storagePolicy?.downloadRoot ?? "%LOCALAPPDATA%\\Setup Center\\downloads"}
          </div>
          {cleanNotice && (
            <div className="mt-1.5 text-[11.5px] text-[color:var(--status-ok)] font-medium">
              {cleanNotice}
            </div>
          )}
        </div>

        {/* Software Target Root */}
        <div className="rounded-[10px] bg-[color:var(--surface-inset)]/60 p-3.5 border border-[color:var(--line-subtle)]/50">
          <div className="text-[color:var(--text-primary)] text-[13px] font-medium flex items-center gap-1.5">
            💻 软件安装目标位置
          </div>
          <p className="text-[color:var(--text-quiet)] mt-1.5 text-[11.5px] leading-relaxed">
            实际生效的安装目录。
            {mode === "system-default" ? (
              "当前使用系统默认（C: 盘官方路径）。"
            ) : (
              <>
                目标根目录:{" "}
                <span className="font-mono text-[color:var(--text-primary)]">
                  {storagePolicy?.resolvedRoot ?? "系统默认"}
                </span>
              </>
            )}
          </p>
          <div className="mt-2 text-[11.5px] text-[color:var(--text-tertiary)]">
            当前库内 {supportedSoftware.length} 款软件（共 {totalInstallable} 款可装工具）支持重定向至副盘；系统组件与脚本工具遵循官方规则。
          </div>
        </div>
      </div>
    </section>
  );
}
