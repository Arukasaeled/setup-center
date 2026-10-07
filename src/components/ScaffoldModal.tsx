/**
 * Setup Center — Project Scaffolding Modal
 *
 * Implements issues E01, E02, E03, E04, E05, E07:
 * - Structured execution steps replacing naive whitespace splitting
 * - Typed parameter substitution ({{projectName}}, {{parentDir}}, {{targetPath}})
 * - Strict alignment between project name and displayed target folder
 * - Package manager selection bound to template-supported options
 * - Environmental prerequisites & capabilities checking (unknown when unloaded)
 * - Structured multi-step sequence presentation with individual cwd
 */

import { useState, useMemo } from "react";
import { AccessibleDialog } from "./AccessibleDialog";
import { TransferHistory } from "../core/transfer/history";
import { useApp } from "../lib/store";
import type { ScaffoldStep } from "../core/vault/types";
import {
  resolveScaffoldSteps,
  generatePowerShellScript,
  generatePowerShellReference,
  normalizeWindowsDirectory,
  joinScaffoldTarget,
} from "../core/transfer/scaffolder";

export interface ScaffoldTemplateDefinition {
  id: string;
  name: string;
  description: string;
  command?: string;
  defaultDir?: string;
  postInstallNotice?: string;
  steps?: ScaffoldStep[];
  supportedPackageManagers?: string[];
  defaultPackageManager?: string;
  requiredCapabilities?: string[];
  requirements?: string[];
  preparedOnly?: boolean;
}

export interface ScaffoldModalProps {
  isOpen?: boolean;
  onClose: () => void;
  template?: ScaffoldTemplateDefinition;
  templateName?: string;
  templateTitle?: string;
  defaultProjectName?: string;
  defaultCommand?: string;
  initialCommand?: string;
}

export function ScaffoldModal({
  isOpen = true,
  onClose,
  template,
  templateName,
  templateTitle,
  defaultProjectName,
  defaultCommand,
  initialCommand,
}: ScaffoldModalProps) {
  const effectiveTitle = templateTitle || templateName || template?.name || "新项目模板";
  const cmd = initialCommand || defaultCommand || template?.command || "";

  // Environment and capability signals from store (Issue E05)
  const inventory = useApp((s) => s.inventory);
  const capabilities = useApp((s) => s.capabilities);
  const capabilitiesPhase = useApp((s) => s.capabilitiesPhase);

  // Initial project name
  const [projectName, setProjectName] = useState(
    defaultProjectName || template?.defaultDir || "my-new-app",
  );
  const [parentDir, setParentDir] = useState("C:\\Projects");

  // The current template contract contains one recipe, not one recipe per manager.
  const supportedPms = useMemo(() => {
    const programs = template?.steps?.length
      ? template.steps.map((step) => step.program.toLowerCase().replace(/\.cmd$/, ""))
      : [(cmd.trim().split(/\s+/)[0] || "").toLowerCase()];
    return [...new Set(programs.map((program) => program === "npx" ? "npm" : program)
      .filter((program) => ["npm", "pnpm", "yarn"].includes(program)))];
  }, [template?.steps, cmd]);
  const pm = supportedPms.join(" + ");
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Sanitize project name: disallow path traversal, spaces, and separators
  const sanitizedProjectName = projectName.trim().replace(/[^a-zA-Z0-9_.-]/g, "") || "my-app";
  let normalizedParent = "";
  let pathError: string | null = null;
  try {
    normalizedParent = normalizeWindowsDirectory(parentDir);
    joinScaffoldTarget(normalizedParent, sanitizedProjectName);
  } catch (error) {
    pathError = error instanceof Error ? error.message : String(error);
  }
  // Issue E03: Strict match between displayed target path and command parameters
  const targetPath = pathError ? "" : joinScaffoldTarget(normalizedParent, sanitizedProjectName);

  // Evaluate requirements and capabilities (Issue E05)
  const envEvaluation = useMemo(() => {
    const requiredCaps = template?.requiredCapabilities || [];
    const requiredReqs = template?.requirements || [];

    if (requiredCaps.length === 0 && requiredReqs.length === 0) {
      return { status: "satisfied" as const, missing: [], unknown: false };
    }

    // If environment has not finished detection yet, report unknown
    if (!inventory || !Array.isArray(inventory.items) || capabilitiesPhase !== "done") {
      return {
        status: "unknown" as const,
        missing: [],
        unknown: true,
        hint: "本机软件与环境检测尚未完成，当前前置条件满足度未知",
      };
    }

    const installedSet = new Set(
      inventory.items.filter((i) => i.installed).map((i) => i.id.toLowerCase()),
    );
    const capMap = new Map((capabilities || []).map((c) => [c.id.toLowerCase(), c]));

    const missingItems: string[] = [];
    let hasUnknownCap = false;

    // Check requiredCapabilities
    for (const cap of requiredCaps) {
      const c = capMap.get(cap.toLowerCase());
      if (c) {
        if (c.status === "unavailable") {
          missingItems.push(c.name || cap);
        } else if (c.status === "unknown") {
          hasUnknownCap = true;
        }
      } else if (!installedSet.has(cap.toLowerCase())) {
        missingItems.push(cap);
      }
    }

    // Check string requirements (simple keyword match against software IDs)
    for (const req of requiredReqs) {
      const lower = req.toLowerCase();
      if (lower.includes("node") && !installedSet.has("node")) {
        if (!missingItems.includes("Node.js")) missingItems.push("Node.js");
      }
      if (lower.includes("rust") && !installedSet.has("rust")) {
        if (!missingItems.includes("Rust")) missingItems.push("Rust");
      }
      if (lower.includes("python") && !installedSet.has("python")) {
        if (!missingItems.includes("Python")) missingItems.push("Python");
      }
      if (lower.includes("uv") && !installedSet.has("uv")) {
        if (!missingItems.includes("uv")) missingItems.push("uv");
      }
      if (lower.includes("docker") && !installedSet.has("docker")) {
        if (!missingItems.includes("Docker")) missingItems.push("Docker");
      }
      if (lower.includes("pnpm") && !installedSet.has("pnpm")) {
        if (!missingItems.includes("pnpm")) missingItems.push("pnpm");
      }
    }

    if (missingItems.length > 0) {
      return { status: "missing" as const, missing: missingItems, unknown: false };
    }
    if (hasUnknownCap) {
      return { status: "unknown" as const, missing: [], unknown: true, hint: "部分依赖项状态未知" };
    }
    return { status: "satisfied" as const, missing: [], unknown: false };
  }, [template, inventory, capabilities, capabilitiesPhase]);

  // Resolve structured steps (Issue E01, E02, S07)
  const resolvedSteps: ScaffoldStep[] = useMemo(() => {
    if (!pathError && template?.steps && template.steps.length > 0) {
      return resolveScaffoldSteps(template.steps, {
        projectName: sanitizedProjectName,
        parentDir: normalizedParent,
        packageManager: pm,
      });
    }
    // S07: Legacy 纯 command 字符串只作原文参考，不按空格转换成可执行 steps；不能默默用默认 Vite 配方替代它。
    return [];
  }, [template?.steps, sanitizedProjectName, normalizedParent, pm, pathError]);

  // Compose full PowerShell 5.1+ script for copy and display (S07)
  const commandPreview = useMemo(() => {
    try {
      if (pathError) return { script: `# ${pathError}`, error: pathError };
      if (resolvedSteps.length > 0) {
        return { script: generatePowerShellScript(resolvedSteps, normalizedParent), error: null };
      }
      if (cmd) {
        const formattedCmd = cmd
          .replace(/\{\{projectName\}\}/g, sanitizedProjectName)
          .replace(/\{\{parentDir\}\}/g, normalizedParent)
          .replace(/\{\{targetPath\}\}/g, targetPath);
        return { script: generatePowerShellReference(formattedCmd, normalizedParent), error: null };
      }
      return { script: generatePowerShellReference("", normalizedParent), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { script: `# 无法生成脚手架命令：${message}`, error: message };
    }
  }, [resolvedSteps, normalizedParent, cmd, sanitizedProjectName, targetPath, pathError]);
  const fullCommandScript = commandPreview.script;

  const handleCopyCommand = async () => {
    if (commandPreview.error) {
      setNotice(commandPreview.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(fullCommandScript);
      setCopied(true);
      setNotice("脚手架命令已成功复制到剪贴板，请在所选工作区终端中执行");
      TransferHistory.record({
        type: "command",
        title: `准备工程模板: ${sanitizedProjectName}`,
        targetId: template?.id || "scaffold-template",
        targetName: effectiveTitle,
        status: "info",
        summary: `脚手架准备就绪 (未直接执行): ${sanitizedProjectName} -> ${targetPath}`,
        metadata: {
          templateId: template?.id,
          command: fullCommandScript,
          targetPath,
          preparedOnly: true,
          stepsCount: resolvedSteps.length,
          selectedPm: pm,
        },
      });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setNotice("复制失败，请手动选择命令复制");
    }
  };

  if (!isOpen) return null;

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      titleId="scaffold-modal-title"
      contentClassName="w-full max-w-2xl rounded-xl border border-[var(--line-subtle,#27272a)] bg-[var(--surface-overlay,#12151b)] p-6 text-[var(--text-primary,#f4f4f5)] shadow-2xl space-y-5"
    >
      <div className="flex items-center justify-between border-b border-[var(--line-subtle,#27272a)] pb-3">
        <h3 id="scaffold-modal-title" className="text-[16px] font-bold text-[var(--text-primary,#ffffff)]">
          初始化工程模板 · {effectiveTitle}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭脚手架面板"
          className="min-h-[32px] min-w-[32px] flex items-center justify-center text-[var(--text-tertiary,#a1a1aa)] hover:text-[var(--text-primary,#ffffff)] transition-colors cursor-pointer rounded-md"
        >
          ✕
        </button>
      </div>

      <div className="space-y-4">
        {/* Prepared Only security notice */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-300">
          <span className="font-bold">⚠️ 受控准备模式 (Prepared Only)：</span>
          <span>
            根据安全隔离策略，Setup Center 输出结构化脚手架执行配方。请复制命令并在您受信任的终端中运行。
          </span>
        </div>

        {/* Environmental prerequisite check banner (Issue E05) */}
        {envEvaluation.status === "missing" && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-300">
            <span className="font-bold">⚠️ 缺少前置依赖：</span>
            <span>
              {" "}当前系统缺少运行此模板所需的环境：<strong>{envEvaluation.missing.join("、")}</strong>。建议在起步中心先完成环境安装。
            </span>
          </div>
        )}
        {envEvaluation.status === "unknown" && (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-[12px] text-blue-300">
            <span className="font-bold">ℹ️ 环境状态未知：</span>
            <span> {envEvaluation.hint || "系统环境检测尚未完全就绪，请在执行前确认已安装相关工具链。"}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="scaffold-project-name" className="text-[12px] font-semibold text-[var(--text-secondary,#d4d4d8)] block mb-1">
              工程名称 (Project Name)
            </label>
            <input
              id="scaffold-project-name"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value.replace(/[^a-zA-Z0-9_.-]/g, ""))}
              placeholder="例如: my-ai-app"
              className="w-full rounded-lg border border-[var(--line-subtle,#3f3f46)] bg-[var(--surface-ground,#0a0c0f)] px-3.5 py-2 font-mono text-[12.5px] text-[var(--text-primary,#ffffff)] focus:border-blue-500 focus:outline-hidden"
            />
          </div>

          <div>
            <label htmlFor="scaffold-parent-dir" className="text-[12px] font-semibold text-[var(--text-secondary,#d4d4d8)] block mb-1">
              父级目录 (Workspace Root)
            </label>
            <input
              id="scaffold-parent-dir"
              type="text"
              value={parentDir}
              onChange={(e) => setParentDir(e.target.value)}
              placeholder="例如: D:\Projects"
              className="w-full rounded-lg border border-[var(--line-subtle,#3f3f46)] bg-[var(--surface-ground,#0a0c0f)] px-3.5 py-2 font-mono text-[12.5px] text-[var(--text-primary,#ffffff)] focus:border-blue-500 focus:outline-hidden"
            />
          </div>
        </div>

        {/* Target directory strictly matching project name (Issue E03) */}
        <div className="rounded-md border border-[var(--line-subtle,#27272a)] bg-[var(--surface-panel,#18181b)]/50 px-3 py-2 text-[11.5px] text-[var(--text-secondary,#a1a1aa)] font-mono flex items-center justify-between">
          <span>完整目标路径:</span>
          <span className="text-emerald-400 font-bold truncate max-w-[400px]">{pathError || targetPath}</span>
        </div>

        {/* Package manager selection (Issue E04) */}
        {supportedPms.length > 0 ? (
          <div>
            <span className="text-[12px] font-semibold text-[var(--text-secondary,#d4d4d8)] block mb-1.5">
              此配方使用的包管理器
            </span>
            <div className="flex gap-2">
              {supportedPms.map((p) => (
                <span
                  key={p}
                  className="min-h-[32px] rounded-lg border border-blue-500 bg-blue-600/20 text-blue-300 px-3.5 py-1 font-mono text-[12px] font-bold"
                >
                  {p}
                </span>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary,#71717a)]">按模板原有步骤复制；其他包管理器尚未提供独立配方。</p>
          </div>
        ) : (
          <div className="text-[11.5px] text-[var(--text-tertiary,#71717a)]">
            ℹ️ 本工程使用自身独立工具链（Cargo、uv 或专用 CLI），无需通用前端包管理器。
          </div>
        )}

        {/* Structured steps overview (Issue E02) */}
        {resolvedSteps.length > 0 ? (
          <div>
            <span className="text-[12px] font-semibold text-[var(--text-secondary,#d4d4d8)] block mb-1.5">
              执行步骤清单 ({resolvedSteps.length} 步)
            </span>
            <div className="space-y-1.5">
              {resolvedSteps.map((s, idx) => (
                <div
                  key={s.id || idx}
                  className="flex items-center justify-between rounded-md border border-[var(--line-subtle,#27272a)] bg-[var(--surface-panel,#0e1116)] px-3 py-1.5 text-[11px] font-mono text-[var(--text-secondary,#a1a1aa)]"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-blue-400 font-bold">#{idx + 1}</span>
                    <span className="text-[var(--text-primary,#ffffff)] font-semibold">{s.program}</span>
                    <span className="truncate text-[var(--text-tertiary,#71717a)]">{s.args.join(" ")}</span>
                  </div>
                  {s.cwd && (
                    <span className="text-[10px] text-[var(--text-tertiary,#52525b)] shrink-0 ml-2">
                      cwd: {s.cwd.split(/[/\\]/).pop()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-[var(--line-subtle,#27272a)] bg-[var(--surface-panel,#0e1116)] p-3 text-[11.5px] text-[var(--text-tertiary,#71717a)]">
            ℹ️ 该模板未定义结构化独立步骤。已保留原始参考命令供终端核对。
          </div>
        )}

        {/* Command preview box */}
        <div className="rounded-lg border border-[var(--line-subtle,#27272a)] bg-[var(--surface-ground,#0e1116)] p-3 text-[12px] font-mono">
          <div className="text-[11px] text-[var(--text-tertiary,#71717a)] mb-1">终端就绪指令:</div>
          <pre className="text-blue-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
            {fullCommandScript}
          </pre>
        </div>

        {notice && (
          <div className="text-[12px] text-emerald-400 font-mono">
            {notice}
          </div>
        )}

        {template?.postInstallNotice && (
          <div className="text-[11.5px] text-[var(--text-tertiary,#a1a1aa)] bg-[var(--surface-panel,#18181b)]/40 p-2.5 rounded-lg border border-[var(--line-subtle,#27272a)]">
            💡 {template.postInstallNotice}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭面板"
          className="min-h-[32px] rounded-lg border border-[var(--line-subtle,#3f3f46)] bg-transparent px-4 py-1.5 text-[12.5px] font-medium text-[var(--text-secondary,#d4d4d8)] hover:bg-[var(--surface-panel,#27272a)] hover:text-[var(--text-primary,#ffffff)] transition-colors cursor-pointer"
        >
          关闭
        </button>
        <button
          type="button"
          onClick={handleCopyCommand}
          aria-label="复制脚手架命令并准备工程模板"
          className="min-h-[32px] rounded-lg bg-blue-600 px-4 py-1.5 text-[12.5px] font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer shadow-sm"
        >
          {copied ? "✓ 命令已复制到剪贴板" : "复制脚手架命令 / 准备工程模板"}
        </button>
      </div>
    </AccessibleDialog>
  );
}
