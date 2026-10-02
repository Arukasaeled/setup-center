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

class ProjectScaffolderManager {
  /**
   * Compose the exact shell command to execute for a template
   */
  public composeCommand(
    commandPattern: string,
    options: { projectName: string; targetDir?: string; packageManager?: string },
  ): string {
    let cmd = commandPattern.replace(/\{\{projectName\}\}/g, options.projectName);
    if (options.packageManager && options.packageManager !== "npm") {
      cmd = cmd.replace(/^npm\s+create/g, `${options.packageManager} create`);
      cmd = cmd.replace(/^npx\s+/g, `${options.packageManager} dlx `);
    }
    return cmd;
  }

  /**
   * Execute or prepare scaffold instantiation
   */
  public async scaffold(
    options: ScaffoldOptions,
    commandTemplate?: string,
  ): Promise<ScaffoldResult> {
    const rawTemplate = commandTemplate || `npm create ${options.projectName}`;
    const command = this.composeCommand(rawTemplate, {
      projectName: options.projectName,
      targetDir: options.targetDir,
      packageManager: options.packageManager,
    });

    try {
      // Record scaffold attempt into Transfer History
      TransferHistory.record({
        type: "scaffold",
        title: "脚手架项目创建",
        targetId: options.templateId,
        targetName: options.projectName,
        status: "success",
        summary: `基于模版「${options.templateName}」创建新工程至 ${options.targetDir}/${options.projectName}`,
        metadata: {
          templateId: options.templateId,
          templateName: options.templateName,
          projectName: options.projectName,
          targetDir: options.targetDir,
          commandExecuted: command,
          openInCode: options.openInCode,
        },
      });

      return {
        ok: true,
        targetPath: `${options.targetDir.replace(/\/+$/, "")}/${options.projectName}`,
        commandExecuted: command,
        message: `已就绪！在终端执行命令或使用集成环境快速启动：\n${command}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      TransferHistory.record({
        type: "scaffold",
        title: "脚手架创建失败",
        targetId: options.templateId,
        targetName: options.projectName,
        status: "error",
        summary: `创建工程「${options.projectName}」时失败: ${msg}`,
      });
      return {
        ok: false,
        targetPath: "",
        commandExecuted: command,
        message: `脚手架执行失败: ${msg}`,
        error: msg,
      };
    }
  }
}

export const ProjectScaffolder = new ProjectScaffolderManager();
