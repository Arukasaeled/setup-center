/**
 * Setup Center — Setup Action Execution Runtime
 *
 * Dispatches concrete actions (Command, Copy, Download, Clone, Apply, Scaffold)
 * with reliable clipboard fallback and TransferHistory logging.
 */

import { TransferHistory } from "../transfer/history";
import { AssetDownloader } from "../transfer/downloader";
import { useApp } from "../../lib/store";
import type { StyleId } from "../../lib/styles";
import type { SetupAction } from "./types";

export interface ExecutionFeedback {
  ok: boolean;
  message: string;
  data?: unknown;
}

/**
 * Copies plain text to clipboard safely across browser and Tauri environments.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback to textarea trick
    }
  }

  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      return success;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Opens an external URL safely in Tauri or regular browser.
 */
export function openExternalUrl(url: string): void {
  if (!url) return;
  try {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch (err) {
    console.error("[SetupExecutor] Failed to open URL:", err);
  }
}

/**
 * Executes a resolved SetupAction and records telemetry in TransferHistory.
 */
export async function executeSetupAction(
  action: SetupAction,
  itemMeta?: { id: string; name: string; type?: string },
): Promise<ExecutionFeedback> {
  const targetId = itemMeta?.id || action.id;
  const targetName = itemMeta?.name || action.label;

  switch (action.type) {
    case "copy": {
      const ok = await copyToClipboard(action.payload);
      if (ok) {
        TransferHistory.record({
          type: "copy",
          title: "复制内容到剪贴板",
          targetId,
          targetName,
          status: "success",
          summary: action.successMessage || `已复制到剪贴板 (${action.payload.slice(0, 40)}...)`,
        });
        return {
          ok: true,
          message: action.successMessage || "已成功复制到剪贴板",
        };
      }
      return { ok: false, message: "剪贴板写入失败，请检查浏览器权限" };
    }

    case "command": {
      const cmd = action.payload;
      const ok = await copyToClipboard(cmd);
      if (ok) {
        TransferHistory.record({
          type: "command",
          title: "复制包管理命令",
          targetId,
          targetName,
          status: "success",
          summary: `已复制包安装命令: ${cmd}`,
          metadata: { command: cmd, pm: action.activePackageManager },
        });
        return {
          ok: true,
          message: action.successMessage || `已复制命令: ${cmd}`,
        };
      }
      return { ok: false, message: "复制命令失败" };
    }

    case "clone": {
      const cloneCmd = action.payload.startsWith("git clone")
        ? action.payload
        : `git clone ${action.payload}`;
      const ok = await copyToClipboard(cloneCmd);
      if (ok) {
        TransferHistory.record({
          type: "clone",
          title: "克隆 Git 仓库",
          targetId,
          targetName,
          status: "success",
          summary: `克隆指令已复制: ${cloneCmd}`,
          metadata: { cloneCmd },
        });
        return {
          ok: true,
          message: action.successMessage || `克隆命令已复制: ${cloneCmd}`,
        };
      }
      return { ok: false, message: "复制克隆命令失败" };
    }

    case "apply": {
      const styleId = action.payload as StyleId;
      try {
        useApp.getState().setActiveStyle(styleId);
        TransferHistory.record({
          type: "style-switch",
          title: "激活视觉语言",
          targetId,
          targetName,
          status: "success",
          summary: `已将应用全局视觉切换为 ${targetName} (${styleId})`,
        });
        return {
          ok: true,
          message: action.successMessage || `已切换视觉风格为 ${targetName}`,
        };
      } catch (err) {
        return { ok: false, message: `切换风格失败: ${String(err)}` };
      }
    }

    case "open": {
      openExternalUrl(action.payload);
      TransferHistory.record({
        type: "bookmark",
        title: "访问资源站点",
        targetId,
        targetName,
        status: "info",
        summary: `在外部浏览器中打开: ${action.payload}`,
      });
      return {
        ok: true,
        message: "正在打开外部链接...",
      };
    }

    case "download": {
      const url = action.payload;
      const filename = url.split("/").pop()?.split("?")[0] || `${targetId}.zip`;
      try {
        await AssetDownloader.startDownload(url, filename, targetName);
        return {
          ok: true,
          message: action.successMessage || `已添加至下载队列: ${filename}`,
        };
      } catch (err) {
        return { ok: false, message: `下载启动失败: ${String(err)}` };
      }
    }

    case "scaffold": {
      // Dispatches custom DOM event for ScaffoldModal
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("setup:open-scaffold", {
            detail: { templateId: action.payload, templateName: targetName },
          }),
        );
      }
      return {
        ok: true,
        message: "已调起工程模板生成向导",
      };
    }

    case "install": {
      // If package command or winget command exists, copy it
      const cmd = action.packageCommands?.winget || action.payload;
      if (cmd) {
        await copyToClipboard(cmd);
        TransferHistory.record({
          type: "install",
          title: "执行软件安装指令",
          targetId,
          targetName,
          status: "info",
          summary: `已复制软件安装指令: ${cmd}`,
        });
        return {
          ok: true,
          message: `已复制安装指令: ${cmd}`,
        };
      }
      return { ok: true, message: "已开始安装流程" };
    }

    default: {
      return { ok: false, message: "未知的 Setup 操作类型" };
    }
  }
}
