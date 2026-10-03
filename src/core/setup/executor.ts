/**
 * Setup Center — Setup Action Execution Runtime
 *
 * Dispatches concrete actions (Command, Copy, Download, Clone, Apply, Scaffold,
 * Reveal, Install) with reliable clipboard fallback and TransferHistory logging.
 *
 * Software items are special: their `install` / `reveal` arms drive the real
 * store flow (planner + wizard) rather than copying a command, so a card-level
 * Setup Action and the wizard's own row button end at the same place.
 */

import { TransferHistory } from "../transfer/history";
import { AssetDownloader } from "../transfer/downloader";
import { useApp } from "../../lib/store";
import type { StyleId } from "../../lib/styles";
import type { SoftwareId } from "../../lib/types";
import { getStyle } from "../../styles/registry";
import {
  buildExport,
  deriveCustomExperience,
  hasOverrides,
  loadOverrides,
  saveCustomExperience,
} from "../../styles/runtime";
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

    case "copy-command":
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

    case "native-command": {
      const cmd = action.payload;
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("setup:execute-command", {
            detail: { command: cmd, title: targetName },
          }),
        );
      }
      TransferHistory.record({
        type: "command",
        title: "调度执行原生命令",
        targetId,
        targetName,
        status: "info",
        summary: `已调度原生命令: ${cmd}`,
      });
      return {
        ok: true,
        message: action.successMessage || `正在执行原生命令: ${cmd}`,
      };
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

    case "preview": {
      // Dispatches custom DOM event to open preview workspace without applying the style
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("setup:open-preview", {
            detail: { styleId: action.payload, styleName: targetName },
          }),
        );
      }
      return {
        ok: true,
        message: action.successMessage || `已调起「${targetName}」完整体验样张预览`,
      };
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

    case "customize": {
      // The playground is a surface, not a value swap, so this dispatches an
      // event like `scaffold` does rather than reaching into a screen's state.
      // The payload is the style to tune, and the gallery listens for it.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("setup:open-playground", {
            detail: { styleId: action.payload },
          }),
        );
      }
      return { ok: true, message: "已打开体验调校台" };
    }

    case "export": {
      const styleId = action.payload as StyleId;
      const style = getStyle(styleId);
      if (!style) return { ok: false, message: "找不到该体验" };
      const overrides = loadOverrides(styleId);
      const envelope = buildExport(style, overrides);
      const ok = await copyToClipboard(JSON.stringify(envelope, null, 2));
      if (!ok) return { ok: false, message: "复制导出内容失败" };
      TransferHistory.record({
        type: "sync",
        title: "导出体验令牌",
        targetId,
        targetName,
        status: "info",
        summary: hasOverrides(styleId)
          ? `已导出「${targetName}」及其自定义覆盖`
          : `已导出「${targetName}」的原始令牌`,
      });
      return {
        ok: true,
        message: action.successMessage || `已复制「${targetName}」的令牌 JSON`,
      };
    }

    case "fork": {
      const styleId = action.payload as StyleId;
      const style = getStyle(styleId);
      if (!style) return { ok: false, message: "找不到该体验" };
      // A fork keeps only the delta. Copying the stylesheet would freeze this
      // derivation against every future fix to the preset it came from.
      const derived = deriveCustomExperience(style, loadOverrides(styleId));
      saveCustomExperience(derived);
      useApp.getState().refreshCustomExperiences();
      TransferHistory.record({
        type: "sync",
        title: "派生自定义体验",
        targetId,
        targetName,
        status: "success",
        summary: `已基于「${style.name}」创建「${derived.name}」`,
      });
      return { ok: true, message: `已创建「${derived.name}」` };
    }

    case "reveal": {
      // "reveal" has no filesystem backend: there is no Tauri command that
      // hands a path to Explorer. What it CAN honestly mean is "bring this
      // item's own detail into view", which is the dashboard's job. The
      // resolver only emits reveal for already-installed software, so that is
      // the presentation this arm drives.
      if (itemMeta?.type === "software") {
        const store = useApp.getState();
        store.openDashboard();
        store.setSection("software");
        store.selectItem(`sw:${action.payload}`);
        TransferHistory.record({
          type: "setup",
          title: "查看已就绪软件",
          targetId,
          targetName,
          status: "info",
          summary: `已在软件工作台展开 ${targetName}`,
        });
        return { ok: true, message: `已展开 ${targetName}` };
      }
      return { ok: true, message: action.payload || "已定位到该条目" };
    }

    case "install": {
      // Software items must run the REAL install flow. Every software surface
      // in the app (dashboard row, command palette) resolves through here, and
      // a copied winget string is not an install — the wizard owns plan
      // building plus the live progress surface, so route there instead. All
      // non-software callers keep the clipboard behaviour below, so cards and
      // search results elsewhere are unaffected.
      if (itemMeta?.type === "software") {
        const store = useApp.getState();
        // `SoftwareId` is a closed union of catalogue ids, but a Setup Action
        // payload only carries a string. The resolver is the only producer of
        // these actions and it sources the id from the catalogue, so the cast
        // restores the type the action already proved at construction time.
        const softwareId = action.payload as SoftwareId;

        // Without an install entitlement the wizard still owns the honest
        // explanation (ManualPanel), so land there rather than reporting a
        // failure the user cannot act on.
        if (!store.entitlements?.canInstall) {
          store.navigate({ surface: "wizard", screen: "software" });
          TransferHistory.record({
            type: "install",
            title: "查看软件安装方式",
            targetId,
            targetName,
            status: "info",
            summary: `已打开软件页查看 ${targetName} 的手动安装方式`,
          });
          return { ok: true, message: "已打开安装方式说明" };
        }

        await store.buildPlanFor([softwareId]);
        if (useApp.getState().plan) {
          store.navigate({ surface: "wizard", screen: "install" });
          TransferHistory.record({
            type: "install",
            title: "载入软件安装方案",
            targetId,
            targetName,
            status: "info",
            summary: `已载入 ${targetName} 的安装方案`,
          });
          return { ok: true, message: `已载入 ${targetName} 的安装方案` };
        }

        store.navigate({ surface: "wizard", screen: "software" });
        return { ok: false, message: "未能载入安装方案，请手动选择" };
      }

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
