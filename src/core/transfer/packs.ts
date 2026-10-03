/**
 * Setup Center — Custom Pack Builder & Agent Context Exporter
 *
 * Lets users group Software, Repos, Resources, and Templates into bespoke
 * starter toolkits (e.g., "My AI Toolkit", "Freshman Setup Pack") and export
 * them as Markdown, JSON, or compact AI Agent context.
 */

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

const PACKS_STORAGE_KEY = "setup-center.custom-packs.v1";

type PacksListener = (packs: CustomPack[]) => void;

class CustomPacksManager {
  private packs: CustomPack[] = [];
  private listeners: Set<PacksListener> = new Set();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(PACKS_STORAGE_KEY);
      if (raw) {
        this.packs = JSON.parse(raw);
      } else {
        // Seed an initial starter pack
        this.packs = [
          {
            id: "pack-ai-starter",
            title: "全能 AI 编程起步包",
            description: "涵盖大模型本地推理、AI 编辑器与最常用前端框架的开箱组合。",
            items: [
              {
                id: "sw:cursor",
                name: "Cursor",
                type: "software",
                category: "AI 编辑器",
                command: "winget install --id Anysphere.Cursor",
              },
              {
                id: "sw:ollama",
                name: "Ollama",
                type: "software",
                category: "AI 运行时",
                command: "winget install --id Ollama.Ollama",
              },
              {
                id: "res:shadcn-ui",
                name: "shadcn/ui",
                type: "resource",
                category: "components",
                url: "https://ui.shadcn.com",
              },
              {
                id: "res:tauri-react-template",
                name: "Tauri + React Starter",
                type: "template",
                category: "templates",
                command: "npm create tauri-app@latest",
              },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
        this.save();
      }
    } catch {
      this.packs = [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(PACKS_STORAGE_KEY, JSON.stringify(this.packs));
    } catch {
      // ignore
    }
  }

  private notify(): void {
    const data = [...this.packs];
    for (const l of this.listeners) {
      try {
        l(data);
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
    return [...this.packs];
  }

  public get(id: string): CustomPack | undefined {
    return this.packs.find((p) => p.id === id);
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
    this.packs.unshift(newPack);
    this.save();
    this.notify();
    return newPack;
  }

  public addItem(packId: string, item: PackItemRef): void {
    const pack = this.get(packId);
    if (!pack) return;
    if (pack.items.some((i) => i.id === item.id)) return;
    pack.items.push(item);
    pack.updatedAt = new Date().toISOString();
    this.save();
    this.notify();
  }

  public removeItem(packId: string, itemId: string): void {
    const pack = this.get(packId);
    if (!pack) return;
    pack.items = pack.items.filter((i) => i.id !== itemId);
    pack.updatedAt = new Date().toISOString();
    this.save();
    this.notify();
  }

  public deletePack(packId: string): void {
    this.packs = this.packs.filter((p) => p.id !== packId);
    this.save();
    this.notify();
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
    return JSON.stringify(pack, null, 2);
  }
}

export const CustomPacks = new CustomPacksManager();
