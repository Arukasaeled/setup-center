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

class ProjectScaffolderManager {
  /**
   * Resolve structured steps with controlled parameter substitution (Issue E01, E02).
   */
  public resolveSteps(
    steps: ScaffoldStep[],
    options: { projectName: string; targetDir: string; packageManager?: string },
  ): ScaffoldStep[] {
    const targetPath = `${options.targetDir.replace(/[/\\]+$/, "")}/${options.projectName}`;
    return steps.map((s, idx) => {
      let program = s.program;
      let args = [...s.args];
      if (options.packageManager && options.packageManager !== "npm") {
        if (program === "npm" && args[0] === "create") {
          program = options.packageManager;
        } else if (program === "npx") {
          program = options.packageManager;
          args = ["dlx", ...args];
        }
      }
      const substitutedArgs = args.map((a) =>
        a
          .replace(/\{\{projectName\}\}/g, options.projectName)
          .replace(/\{\{parentDir\}\}/g, options.targetDir)
          .replace(/\{\{targetPath\}\}/g, targetPath),
      );
      const cwd = (s.cwd || (idx === 0 ? options.targetDir : targetPath))
        .replace(/\{\{projectName\}\}/g, options.projectName)
        .replace(/\{\{parentDir\}\}/g, options.targetDir)
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
   * Compose the exact shell command to execute for a template
   */
  public composeCommand(
    commandPattern: string,
    options: { projectName: string; targetDir?: string; packageManager?: string },
  ): string {
    const parentDir = options.targetDir || ".";
    const targetPath = `${parentDir.replace(/[/\\]+$/, "")}/${options.projectName}`;
    let cmd = commandPattern
      .replace(/\{\{projectName\}\}/g, options.projectName)
      .replace(/\{\{parentDir\}\}/g, parentDir)
      .replace(/\{\{targetPath\}\}/g, targetPath);
    if (options.packageManager && options.packageManager !== "npm") {
      cmd = cmd.replace(/^npm\s+create/g, `${options.packageManager} create`);
      cmd = cmd.replace(/^npx\s+/g, `${options.packageManager} dlx `);
    }
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
    const rawTemplate = commandTemplate || `npm create ${options.projectName}`;
    const command = this.composeCommand(rawTemplate, {
      projectName: options.projectName,
      targetDir: options.targetDir,
      packageManager: options.packageManager,
    });
    const resolvedSteps = options.steps ? this.resolveSteps(options.steps, options) : undefined;
    const targetPath = `${options.targetDir.replace(/[/\\]+$/, "")}/${options.projectName}`;

    try {
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
