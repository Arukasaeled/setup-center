/**
 * Setup Center — Custom Pack Builder & Honest Agent Context Exporter (Issues F09, K06)
 *
 * Lets users group Software, Repos, Resources, and Templates into bespoke
 * starter toolkits (e.g., "My AI Toolkit", "Freshman Setup Pack").
 * Backed by PersonalStateManager single document transactions (`setup-center.personal-state.v2`).
 *
 * Honest Reuse Guarantee (K06):
 * Rather than pure narrative descriptions that cannot be reassembled, packs export
 * structured executable steps and reproducible bootstrap scripts. Universal auto-assembly
 * is honestly scoped and deferred per spec, avoiding unfulfilled promises.
 */

import { PersonalStateManager } from "./personalState";

export interface PackItemRef {
  id: string;
  name: string;
  type: string;
  category?: string;
  url?: string;
  command?: string;
  note?: string;
}

export interface CustomPack {
  id: string;
  title: string;
  description: string;
  items: PackItemRef[];
  createdAt: string;
  updatedAt: string;
}

export interface PackExecutableStep {
  id: string;
  title: string;
  kind: "software" | "template" | "resource" | "command";
  command?: string;
  url?: string;
  description?: string;
}

export interface CustomPackManifest {
  packId: string;
  title: string;
  description: string;
  schemaVersion: "2.0";
  createdAt: string;
  exportedAt: string;
  totalItems: number;
  softwareItemsCount: number;
  templateItemsCount: number;
  resourceItemsCount: number;
  executableCommandsCount: number;
  deferredUniversalAssembler: boolean;
  assemblerScopeNote: string;
}

export interface CustomPackExportPackage {
  schemaVersion: "2.0";
  exportedAt: string;
  manifest: CustomPackManifest;
  pack: CustomPack;
  executableSteps: PackExecutableStep[];
}

type PacksListener = (packs: CustomPack[]) => void;

class CustomPacksManager {
  private listeners: Set<PacksListener> = new Set();

  constructor() {
    PersonalStateManager.subscribe((doc) => {
      this.notify(doc.customPacks);
    });
  }

  private notify(data?: CustomPack[]): void {
    const list = data || this.getAll();
    for (const l of this.listeners) {
      try {
        l(list);
      } catch (err) {
        console.error("[CustomPacksManager] error:", err);
      }
    }
  }

  public subscribe(listener: PacksListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getAll(): CustomPack[] {
    return [...PersonalStateManager.get().customPacks];
  }

  public get(id: string): CustomPack | undefined {
    return PersonalStateManager.get().customPacks.find((p) => p.id === id);
  }

  public create(title: string, description: string): CustomPack {
    const newPack: CustomPack = {
      id: `pack-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim() || "未命名开发包",
      description: description.trim(),
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    PersonalStateManager.update((doc) => {
      doc.customPacks.unshift(newPack);
    });

    return newPack;
  }

  public addItem(packId: string, item: PackItemRef): void {
    PersonalStateManager.update((doc) => {
      const pack = doc.customPacks.find((p) => p.id === packId);
      if (!pack) return;
      if (pack.items.some((i) => i.id === item.id)) return;
      pack.items.push(item);
      pack.updatedAt = new Date().toISOString();
    });
  }

  public removeItem(packId: string, itemId: string): void {
    PersonalStateManager.update((doc) => {
      const pack = doc.customPacks.find((p) => p.id === packId);
      if (!pack) return;
      pack.items = pack.items.filter((i) => i.id !== itemId);
      pack.updatedAt = new Date().toISOString();
    });
  }

  public deletePack(packId: string): void {
    PersonalStateManager.update((doc) => {
      doc.customPacks = doc.customPacks.filter((p) => p.id !== packId);
    });
  }

  // --- Honest Actionable Reuse & Package Exports (K06) ---

  /**
   * Builds executable steps from pack items for verifiable setup.
   */
  public buildExecutableSteps(pack: CustomPack): PackExecutableStep[] {
    const steps: PackExecutableStep[] = [];
    for (const item of pack.items) {
      if (item.command) {
        steps.push({
          id: `step-${item.id}`,
          title: `安装 / 配置 ${item.name}`,
          kind: item.type === "software" ? "software" : item.type === "template" ? "template" : "command",
          command: item.command,
          description: item.note || (item.category ? `分类: ${item.category}` : undefined),
        });
      } else if (item.url) {
        steps.push({
          id: `step-${item.id}`,
          title: `访问 / 引入资源 ${item.name}`,
          kind: "resource",
          url: item.url,
          description: item.note || (item.category ? `分类: ${item.category}` : undefined),
        });
      }
    }
    return steps;
  }

  /**
   * Generates a complete, verifiable export package with manifest and executable steps.
   */
  public exportExecutablePackage(pack: CustomPack): CustomPackExportPackage {
    const executableSteps = this.buildExecutableSteps(pack);
    const softwareCount = pack.items.filter((i) => i.type === "software").length;
    const templateCount = pack.items.filter((i) => i.type === "template").length;
    const resourceCount = pack.items.filter((i) => i.type === "resource").length;
    const commandCount = pack.items.filter((i) => Boolean(i.command)).length;

    const manifest: CustomPackManifest = {
      packId: pack.id,
      title: pack.title,
      description: pack.description,
      schemaVersion: "2.0",
      createdAt: pack.createdAt,
      exportedAt: new Date().toISOString(),
      totalItems: pack.items.length,
      softwareItemsCount: softwareCount,
      templateItemsCount: templateCount,
      resourceItemsCount: resourceCount,
      executableCommandsCount: commandCount,
      deferredUniversalAssembler: true,
      assemblerScopeNote:
        "通用全自动跨栈代码组装器明确延期（DEFERRED_BY_SPEC）；本套件交付结构化执行步骤与环境指令，支持单项核实与有序执行。",
    };

    return {
      schemaVersion: "2.0",
      exportedAt: new Date().toISOString(),
      manifest,
      pack,
      executableSteps,
    };
  }

  /**
   * Generates a concrete, executable shell script for automated machine bootstrap.
   */
  public exportActionableScript(pack: CustomPack, shell: "powershell" | "bash" = "powershell"): string {
    const steps = this.buildExecutableSteps(pack);

    if (shell === "powershell") {
      const lines: string[] = [
        `# ========================================================`,
        `# Setup Center 开箱套件环境初始化脚本: ${pack.title}`,
        `# 导出时间: ${new Date().toISOString()}`,
        `# 说明: 通用全自动跨栈组装器延期；本脚本提供结构化配方执行`,
        `# ========================================================`,
        `$ErrorActionPreference = "Stop"`,
        `Write-Host "[Setup Center] 开始配置套件: ${pack.title}" -ForegroundColor Cyan`,
        "",
      ];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        lines.push(`Write-Host "[${i + 1}/${steps.length}] ${step.title}..." -ForegroundColor Yellow`);
        if (step.command) {
          lines.push(`try {`);
          lines.push(`    ${step.command}`);
          lines.push(`    Write-Host "  -> 成功" -ForegroundColor Green`);
          lines.push(`} catch {`);
          lines.push(`    Write-Warning "  -> 步骤执行失败: $_"`);
          lines.push(`}`);
        } else if (step.url) {
          lines.push(`Write-Host "  -> 外部资源依赖: ${step.url}" -ForegroundColor Gray`);
        }
        lines.push("");
      }

      lines.push(`Write-Host "[Setup Center] 套件配置完成！" -ForegroundColor Cyan`);
      return lines.join("\r\n");
    }

    // Bash script
    const lines: string[] = [
      `#!/usr/bin/env bash`,
      `# Setup Center Kit Bootstrap: ${pack.title}`,
      `# Exported: ${new Date().toISOString()}`,
      `set -e`,
      `echo "==> [Setup Center] Configuring Pack: ${pack.title}"`,
      "",
    ];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      lines.push(`echo "==> [${i + 1}/${steps.length}] ${step.title}"`);
      if (step.command) {
        lines.push(`${step.command} || echo "Warning: step failed"`);
      } else if (step.url) {
        lines.push(`echo "  Resource reference: ${step.url}"`);
      }
      lines.push("");
    }

    lines.push(`echo "==> [Setup Center] Bootstrap finished."`);
    return lines.join("\n");
  }

  /**
   * Imports an actionable kit package and saves it to PersonalStateManager.
   */
  public importExecutablePackage(jsonStr: string): CustomPack {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error("无效的 JSON 格式");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("套件包结构无效");
    }

    const pkg = parsed as Record<string, unknown>;
    const pack = (pkg.pack || pkg) as CustomPack;

    if (!pack.id || !pack.title || !Array.isArray(pack.items)) {
      throw new Error("套件数据缺失必要字段 (id, title, items)");
    }

    // Assign new unique ID to avoid collision
    const importedPack: CustomPack = {
      id: `pack-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: `${pack.title} (导入)`,
      description: pack.description || "",
      items: Array.isArray(pack.items) ? pack.items : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    PersonalStateManager.update((doc) => {
      doc.customPacks.unshift(importedPack);
    });

    return importedPack;
  }

  /**
   * Generates a compact, high-signal Markdown snippet optimized for AI Agents.
   */
  public exportForAgent(pack: CustomPack): string {
    const lines: string[] = [
      `# 开发套件上下文: ${pack.title}`,
      pack.description ? `> ${pack.description}` : "",
      "",
      `共收录 ${pack.items.length} 项核心开发资产：`,
      "",
    ];

    for (const item of pack.items) {
      lines.push(`- **${item.name}** [${item.type}]`);
      if (item.category) lines.push(`  - 分类: ${item.category}`);
      if (item.url) lines.push(`  - 链接: ${item.url}`);
      if (item.command) lines.push(`  - 安装/初始化指令: \`${item.command}\``);
      if (item.note) lines.push(`  - 备注: ${item.note}`);
    }

    lines.push(
      "",
      "---",
      "请根据以上技术栈与开发工具上下文，协助我规划接下来的开发任务与工程搭建。",
    );

    return lines.filter((l) => l !== "").join("\n");
  }

  /**
   * Generates standard Markdown documentation for the pack.
   */
  public exportMarkdown(pack: CustomPack): string {
    const lines: string[] = [
      `# ${pack.title}`,
      "",
      pack.description ? `${pack.description}\n` : "",
      "| 名称 | 类型 | 详情 / 仓库 | 命令 | 备注 |",
      "|---|---|---|---|---|",
    ];

    for (const item of pack.items) {
      const urlText = item.url ? `[访问](${item.url})` : "-";
      const cmdText = item.command ? `\`${item.command}\`` : "-";
      lines.push(
        `| ${item.name} | ${item.type} | ${urlText} | ${cmdText} | ${item.note || "-"} |`,
      );
    }

    lines.push(
      "",
      `*由 Setup Center 于 ${new Date().toLocaleDateString("zh-CN")} 导出*`,
    );

    return lines.join("\n");
  }

  public exportJson(pack: CustomPack): string {
    return JSON.stringify(this.exportExecutablePackage(pack), null, 2);
  }
}

export const CustomPacks = new CustomPacksManager();
