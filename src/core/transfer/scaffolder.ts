/**
 * Setup Center — Template Project Scaffolder
 *
 * Automates project instantiation from Vault templates:
 * - Parameter substitution ({{projectName}}, etc.)
 * - Command composition (npx, cargo, uv, git)
 * - Transfer history logging
 */

import type { ScaffoldOptions, ScaffoldResult } from "./types";
import { TransferHistory } from "./history";

import type { ScaffoldStep } from "../vault/types";

export interface ResolveStepsOptions {
  projectName: string;
  targetDir?: string;
  parentDir?: string;
  packageManager?: string;
}

export function escapePowerShellLiteral(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

export function normalizeWindowsDirectory(value: string): string {
  const directory = value.trim().replace(/\//g, "\\");
  if (!directory || /[\x00-\x1f]/.test(directory)) {
    throw new Error("请填写有效的父级目录");
  }
  if (/^[a-zA-Z]:$/.test(directory)) {
    throw new Error("盘符根目录需要反斜杠，例如 D:\\");
  }
  if (/^[a-zA-Z]:\\+$/.test(directory)) return `${directory.slice(0, 2)}\\`;
  if (directory === "\\") return directory;
  return directory.replace(/\\+$/, "");
}

export function joinScaffoldTarget(parentDir: string, projectName: string): string {
  if (!projectName || projectName === "." || projectName === ".." || /[\\/\x00-\x1f]/.test(projectName)) {
    throw new Error("请填写有效的项目名称");
  }
  const parent = normalizeWindowsDirectory(parentDir);
  return `${parent}${parent.endsWith("\\") ? "" : "\\"}${projectName}`;
}

export function resolveWindowsProgram(program: string): string {
  const lower = program.toLowerCase();
  if (lower === "npm") return "npm.cmd";
  if (lower === "npx") return "npx.cmd";
  if (lower === "pnpm") return "pnpm.cmd";
  if (lower === "yarn") return "yarn.cmd";
  return program;
}

/**
 * Resolve structured steps with controlled parameter substitution without npx rewrites (S07).
 */
export function resolveScaffoldSteps(
  steps: ScaffoldStep[],
  options: ResolveStepsOptions,
): ScaffoldStep[] {
  const parent = normalizeWindowsDirectory(options.parentDir ?? options.targetDir ?? ".");
  const targetPath = joinScaffoldTarget(parent, options.projectName);

  return steps.map((s, idx) => {
    const program = s.program;
    const args = [...s.args];

    const substitutedArgs = args.map((a) =>
      a
        .replace(/\{\{projectName\}\}/g, options.projectName)
        .replace(/\{\{parentDir\}\}/g, parent)
        .replace(/\{\{targetPath\}\}/g, targetPath),
    );

    const cwd = (s.cwd || (idx === 0 ? parent : targetPath))
      .replace(/\{\{projectName\}\}/g, options.projectName)
      .replace(/\{\{parentDir\}\}/g, parent)
      .replace(/\{\{targetPath\}\}/g, targetPath);

    return {
      ...s,
      program,
      args: substitutedArgs,
      cwd,
    };
  });
}

/**
 * Generates strict Windows PowerShell 5.1+ script with proper literal quoting and error guards (S07).
 */
export function generatePowerShellScript(
  steps: ScaffoldStep[],
  parentDir: string,
): string {
  const normalizedParent = normalizeWindowsDirectory(parentDir);
  const lines: string[] = [
    "# Windows PowerShell 5.1+",
    "$ErrorActionPreference = 'Stop'",
    "",
    `Set-Location -LiteralPath ${escapePowerShellLiteral(normalizedParent)}`,
  ];

  let currentCwd = normalizedParent;

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    const targetCwd = normalizeWindowsDirectory(step.cwd || normalizedParent);
    if (targetCwd !== currentCwd) {
      lines.push(`Set-Location -LiteralPath ${escapePowerShellLiteral(targetCwd)}`);
      currentCwd = targetCwd;
    }

    const prog = resolveWindowsProgram(step.program);
    const progLiteral = escapePowerShellLiteral(prog);
    const argsLiterals = step.args.map((a) => escapePowerShellLiteral(a)).join(" ");

    if (argsLiterals.length > 0) {
      lines.push(`& ${progLiteral} ${argsLiterals}`);
    } else {
      lines.push(`& ${progLiteral}`);
    }
    lines.push(`if ($LASTEXITCODE -ne 0) { throw "命令执行失败，退出码: $LASTEXITCODE" }`);
  }

  return lines.join("\r\n");
}

export function generatePowerShellReference(command: string, parentDir: string): string {
  return [
    "# Windows PowerShell 5.1+",
    "$ErrorActionPreference = 'Stop'",
    "",
    `Set-Location -LiteralPath ${escapePowerShellLiteral(normalizeWindowsDirectory(parentDir))}`,
    "# 参考命令：此模板未提供结构化执行步骤，请根据环境核对。",
    ...command.split(/\r\n|\r|\n/).map((line) => `# ${line}`),
  ].join("\r\n");
}

class ProjectScaffolderManager {
  /**
   * Resolve structured steps with controlled parameter substitution (Issue E01, E02).
   */
  public resolveSteps(
    steps: ScaffoldStep[],
    options: { projectName: string; targetDir: string; packageManager?: string },
  ): ScaffoldStep[] {
    return resolveScaffoldSteps(steps, options);
  }

  /**
   * Compose the exact shell command to execute for a template
   */
  public composeCommand(
    commandPattern: string,
    options: { projectName: string; targetDir?: string; packageManager?: string },
  ): string {
    const parentDir = normalizeWindowsDirectory(options.targetDir ?? ".");
    const targetPath = joinScaffoldTarget(parentDir, options.projectName);
    const cmd = commandPattern
      .replace(/\{\{projectName\}\}/g, options.projectName)
      .replace(/\{\{parentDir\}\}/g, parentDir)
      .replace(/\{\{targetPath\}\}/g, targetPath);
    return cmd;
  }

  /**
   * Prepares a project scaffolding recipe and logs a "prepared" info record to TransferHistory.
   * Strictly distinguishes preparation from physical execution success (Issue E06).
   */
  public async prepareScaffold(
    options: ScaffoldOptions,
    commandTemplate?: string,
  ): Promise<ScaffoldResult> {
    let targetPath = "";
    let resolvedSteps: ScaffoldStep[] | undefined;
    let command = "";
    try {
      targetPath = joinScaffoldTarget(options.targetDir, options.projectName);
      resolvedSteps = options.steps ? this.resolveSteps(options.steps, options) : undefined;
      command = resolvedSteps && resolvedSteps.length > 0
        ? generatePowerShellScript(resolvedSteps, options.targetDir)
        : generatePowerShellReference(this.composeCommand(commandTemplate || "", {
            projectName: options.projectName,
            targetDir: options.targetDir,
            packageManager: options.packageManager,
          }), options.targetDir);
      // Record scaffold preparation into Transfer History as "info" (Issue E06)
      TransferHistory.record({
        type: "scaffold",
        title: `准备工程模板: ${options.projectName}`,
        targetId: options.templateId,
        targetName: options.templateName,
        status: "info",
        summary: `脚手架执行配方已准备就绪 (尚未直接运行)，待在工作区终端中执行：${command}`,
        metadata: {
          templateId: options.templateId,
          templateName: options.templateName,
          projectName: options.projectName,
          targetDir: options.targetDir,
          targetPath,
          commandExecuted: command,
          stepsCount: resolvedSteps?.length ?? 1,
          openInCode: options.openInCode,
          preparedOnly: true,
          outcome: "prepared",
        },
      });

      return {
        ok: true,
        outcome: "prepared",
        preparedOnly: true,
        targetPath,
        commandExecuted: command,
        steps: resolvedSteps,
        message: `脚手架命令已准备就绪！请在终端中执行以完成项目初始化：\n${command}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      TransferHistory.record({
        type: "scaffold",
        title: `工程模板准备失败: ${options.projectName}`,
        targetId: options.templateId,
        targetName: options.projectName,
        status: "error",
        summary: `准备工程「${options.projectName}」时失败: ${msg}`,
      });
      return {
        ok: false,
        outcome: "failed",
        preparedOnly: true,
        targetPath: "",
        commandExecuted: command,
        message: `脚手架准备失败: ${msg}`,
        error: msg,
      };
    }
  }

  /**
   * Scaffold method delegates to prepareScaffold to preserve semantic honesty (Issue E06).
   */
  public async scaffold(
    options: ScaffoldOptions,
    commandTemplate?: string,
  ): Promise<ScaffoldResult> {
    return this.prepareScaffold(options, commandTemplate);
  }
}

export const ProjectScaffolder = new ProjectScaffolderManager();
