/**
 * Setup Center — Unified Local Search Index
 *
 * Fast (<5ms) tokenized, multi-field search engine across:
 * - 386 Curated Resources
 * - 55+ Project Templates
 * - 65+ Learning Guides
 * - 20 Experience Styles
 * - Built-in Software Catalogue
 * - Developer Skills & UI Patterns
 */

import { STYLE_REGISTRY } from "../../styles";
import { RESOURCE_CATALOG } from "../../content/resources";
import type { DiscoveryItem, DiscoveryFilter } from "./types";

// Curated built-in software catalog descriptions
const BUILTIN_SOFTWARE: Array<{
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  wingetId?: string;
  officialUrl?: string;
}> = [
  {
    id: "vscode",
    name: "Visual Studio Code",
    category: "编辑器",
    description: "微软开源的现代化全功能轻量级代码编辑器，拥有庞大的插件与语言扩展生态。",
    tags: ["编辑器", "微软", "全栈", "TypeScript", "Python"],
    wingetId: "Microsoft.VisualStudioCode",
    officialUrl: "https://code.visualstudio.com",
  },
  {
    id: "git",
    name: "Git",
    category: "版本控制",
    description: "分布式版本控制系统，现代软件协同开发必备基石工具。",
    tags: ["版本控制", "Git", "开源", "终端", "协作"],
    wingetId: "Git.Git",
    officialUrl: "https://git-scm.com",
  },
  {
    id: "nodejs",
    name: "Node.js (LTS)",
    category: "运行时",
    description: "基于 Chrome V8 引擎构建的高性能 JavaScript 跨平台运行环境。",
    tags: ["JavaScript", "全栈", "后端", "npm", "运行时"],
    wingetId: "OpenJS.NodeJS.LTS",
    officialUrl: "https://nodejs.org",
  },
  {
    id: "python",
    name: "Python 3.12",
    category: "编程语言",
    description: "易学且功能强大的通用脚本与人工智能核心编程语言。",
    tags: ["Python", "AI", "数据分析", "机器学习", "脚本"],
    wingetId: "Python.Python.3.12",
    officialUrl: "https://python.org",
  },
  {
    id: "ollama",
    name: "Ollama",
    category: "AI 运行时",
    description: "本地大语言模型极速运行与部署工具，一键拉取并运行 Llama 3、DeepSeek、Qwen 模型。",
    tags: ["AI", "本地大模型", "LLM", "DeepSeek", "离线推理"],
    wingetId: "Ollama.Ollama",
    officialUrl: "https://ollama.com",
  },
  {
    id: "cursor",
    name: "Cursor",
    category: "AI 编辑器",
    description: "基于 VS Code 深度定制的下一代 AI 原生编程辅助编辑器，支持全工程感知代码生成。",
    tags: ["AI", "编辑器", "AI辅助编程", "智能补全"],
    wingetId: "Anysphere.Cursor",
    officialUrl: "https://cursor.com",
  },
  {
    id: "zed",
    name: "Zed Editor",
    category: "编辑器",
    description: "由 Rust 开发的极速、高性能且支持多人协作的下一代代码编辑器。",
    tags: ["Rust", "编辑器", "高性能", "GPU渲染", "极速"],
    wingetId: "ZedIndustries.Zed",
    officialUrl: "https://zed.dev",
  },
  {
    id: "docker",
    name: "Docker Desktop",
    category: "容器化",
    description: "企业级容器化开发运行环境，快速搭建微服务与隔离数据库依赖。",
    tags: ["容器化", "Docker", "DevOps", "虚拟化", "Linux"],
    wingetId: "Docker.DockerDesktop",
    officialUrl: "https://docker.com",
  },
  {
    id: "wsl",
    name: "WSL2 (Windows Subsystem for Linux)",
    category: "系统环境",
    description: "微软 Windows 原生 Linux 内核子系统，无缝运行 Ubuntu/Debian 与 Linux 开发链路。",
    tags: ["Linux", "系统环境", "Ubuntu", "内核", "Windows"],
    wingetId: "Microsoft.WSL",
    officialUrl: "https://learn.microsoft.com/windows/wsl",
  },
  {
    id: "cherry_studio",
    name: "Cherry Studio",
    category: "AI 客户端",
    description: "支持多模型服务商、知识库管理与多 Agent 协同的现代化桌面 AI 对话工作台。",
    tags: ["AI", "客户端", "多模型", "Prompt", "桌面工具"],
    wingetId: "CherryStudio.CherryStudio",
    officialUrl: "https://cherry-ai.com",
  },
  {
    id: "chatbox",
    name: "Chatbox",
    category: "AI 客户端",
    description: "开源桌面 AI 客户端，支持各类商业及开源大模型 API 直连与代码高亮。",
    tags: ["AI", "客户端", "开源", "API管理", "高效沟通"],
    wingetId: "Bento.Chatbox",
    officialUrl: "https://chatboxai.app",
  },
  {
    id: "kimi_cli",
    name: "Kimi CLI",
    category: "AI 工具",
    description: "月之暗面 Kimi 大模型终端命令行工具，在终端直接进行长文本问答与代码解析。",
    tags: ["AI", "命令行", "CLI", "Kimi", "长文本"],
  },
  {
    id: "cc_switch",
    name: "CC Switch",
    category: "效率工具",
    description: "多开发环境代理与源极速切换管理工具，支持一键切换 npm/pip/cargo 镜像。",
    tags: ["镜像源", "代理切换", "加速", "开发配置"],
  },
  {
    id: "doubao",
    name: "豆包电脑版",
    category: "AI 工具",
    description: "字节跳动自研大模型桌面客户端，具备全场景对话解答与办公创作辅助功能。",
    tags: ["AI", "客户端", "智能助手", "字节跳动"],
  },
  {
    id: "crush",
    name: "Charm Crush",
    category: "终端美化",
    description: "基于 Charm 理念构建的终端高颜值 UI 组件与命令行高亮工具。",
    tags: ["终端", "命令行美化", "CLI", "Charm"],
  },
  {
    id: "capcut",
    name: "剪映电脑版",
    category: "创意设计",
    description: "简单高效的智能视频剪辑创作工具，内置大量 AI 视频特效与字幕自动生成。",
    tags: ["视频剪辑", "AI字幕", "媒体创作", "轻量"],
  },
];

// Curated Skills definitions
const BUILTIN_SKILLS: Array<{
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  prompt: string;
}> = [
  {
    id: "skill:code-refactor",
    name: "重构与架构简化 (Code Refactor)",
    category: "开发技能",
    description: "指导 AI 遵循纯函数、单一职责与高内聚低耦合原则重构复杂代码逻辑。",
    tags: ["重构", "架构", "清洁代码", "Prompt", "高质量"],
    prompt: "请以资深架构师视角审查以下代码：1. 提取重复分支与样板代码；2. 强化类型定义与边界防御；3. 保持现有公开契约完全不变；4. 逐步展示修改对比并给出重构理由。",
  },
  {
    id: "skill:ui-polish",
    name: "前端界面润色规范 (Impeccable Polish)",
    category: "设计技能",
    description: "指导 AI 去除廉价感与花哨装饰，构建高信息密度、精细间距与严谨版式的前端 UI。",
    tags: ["UI润色", "设计系统", "排版", "CSS", "极简"],
    prompt: "请对该界面执行视觉品质精修：1. 移除不必要的背景装饰与浮夸投影；2. 建立明确字阶阶梯与字重层级；3. 统一边框颜色为微弱分界线 (var(--line-subtle))；4. 确保在 980x640 窗口下空间利用合理且无截断。",
  },
  {
    id: "skill:test-generation",
    name: "真实交互端到端测试生成 (Playwright Test Gen)",
    category: "测试技能",
    description: "生成基于 Playwright 的高置信度真实 DOM 交互验证用例，杜绝空虚断言。",
    tags: ["测试", "Playwright", "E2E", "高置信度", "自动化"],
    prompt: "为该功能编写自动化验证脚本：1. 模拟真实用户点击与键盘导航；2. 断言实际元素在 DOM 中可见且位置未错乱；3. 验证异常网络与离线情况下的容灾行为；4. 退出码准确反映测试通过状态。",
  },
  {
    id: "skill:git-conventional-commits",
    name: "规范化 Git 提交 (Conventional Commits)",
    category: "协作技能",
    description: "依据约定式提交规范快速生成清晰严谨的 feat/fix/refactor/docs 提交说明。",
    tags: ["Git", "版本管理", "规范", "协作"],
    prompt: "根据当前的 git diff 生成符合 Conventional Commits 规范的精炼提交信息：首行限制在 60 字符内，并在正文中清晰说明修改动机与核心影响范围。",
  },
];

// Curated UI Patterns
const BUILTIN_PATTERNS: Array<{
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  snippet: string;
}> = [
  {
    id: "pat:hard-shadow-card",
    name: "硬边缘阴影卡片 (Hard Shadow Card)",
    category: "UI 版式",
    description: "经典美漫与粗野主义硬核单色阴影卡片样式，具有极强视觉存在感。",
    tags: ["卡片", "阴影", "美漫风格", "粗野主义"],
    snippet: `box-shadow: 4px 4px 0px 0px var(--status-accent); border: 2px solid var(--text-primary);`,
  },
  {
    id: "pat:mono-table-grid",
    name: "终端密排数据矩阵 (Terminal Dense Grid)",
    category: "UI 版式",
    description: "适合工程度量、系统状态与命令输出的等宽紧凑表格布局。",
    tags: ["表格", "数据密度", "终端", "等宽字体"],
    snippet: `font-family: var(--font-mono); font-size: 11.5px; border-collapse: collapse; border: 1px solid var(--line-default);`,
  },
  {
    id: "pat:swiss-split-layout",
    name: "瑞士排版不对称留白 (Swiss Asymmetric Layout)",
    category: "UI 版式",
    description: "以大字阶、严谨基线网格与大面积克制空白为核心的现代排版模式。",
    tags: ["排版", "瑞士设计", "网格", "留白"],
    snippet: `display: grid; grid-template-columns: minmax(280px, 1fr) 2fr; gap: 3rem; align-items: start;`,
  },
];

class SearchIndexManager {
  private items: DiscoveryItem[] = [];
  private initialized = false;

  public init(): void {
    if (this.initialized) return;

    const list: DiscoveryItem[] = [];

    // 1. Builtin Software
    for (const sw of BUILTIN_SOFTWARE) {
      list.push({
        id: `sw:${sw.id}`,
        type: "software",
        title: sw.name,
        subtitle: `${sw.category} · 内置核心构建工具`,
        description: sw.description,
        category: "software",
        categoryLabel: sw.category,
        tags: ["软件", sw.category, ...sw.tags],
        origin: {
          type: "builtin",
          url: sw.officialUrl,
          packageId: sw.wingetId,
          source: sw.wingetId ? "winget" : "official",
        },
        action: sw.wingetId
          ? {
              id: `install:${sw.id}`,
              label: "一键安装",
              type: "command",
              payload: `winget install --id ${sw.wingetId}`,
            }
          : {
              id: `open:${sw.id}`,
              label: "官方网站",
              type: "open",
              payload: sw.officialUrl || "",
            },
        secondaryActions: [
          ...(sw.officialUrl
            ? [
                {
                  id: `web:${sw.id}`,
                  label: "访问官网",
                  type: "open" as const,
                  payload: sw.officialUrl,
                },
              ]
            : []),
          ...(sw.wingetId
            ? [
                {
                  id: `copy:${sw.id}`,
                  label: "复制安装命令",
                  type: "copy" as const,
                  payload: `winget install --id ${sw.wingetId}`,
                },
              ]
            : []),
        ],
        health: "ready",
        isCurated: true,
      });
    }

    // 2. Curated Resources (from ContentRegistry or RESOURCE_CATALOG)
    for (const res of RESOURCE_CATALOG) {
      const isTemplate = res.category === "templates";
      const isLearning = res.category === "learning";
      const type: DiscoveryItem["type"] = isTemplate
        ? "template"
        : isLearning
          ? "learning"
          : "resource";

      list.push({
        id: res.id,
        type,
        title: res.name,
        subtitle: `${res.author} · ${res.category}`,
        description: res.description,
        category: res.category,
        categoryLabel: isTemplate
          ? "项目模板"
          : isLearning
            ? "学习路径"
            : "开发资源",
        tags: [res.category, ...(res.tags || [])],
        origin: {
          type: "builtin",
          url: res.homepage,
          repository: res.repository,
          author: res.author,
          stars: res.stars,
          license: res.license,
        },
        action: res.repository
          ? {
              id: `clone:${res.id}`,
              label: isTemplate ? "使用模板 (Scaffold)" : "克隆仓库 (Clone)",
              type: "command",
              payload: `git clone ${res.repository}.git`,
            }
          : {
              id: `visit:${res.id}`,
              label: "访问主页",
              type: "open",
              payload: res.homepage || "",
            },
        secondaryActions: [
          ...(res.repository
            ? [
                {
                  id: `gh:${res.id}`,
                  label: "打开 GitHub",
                  type: "open" as const,
                  payload: res.repository,
                },
              ]
            : []),
          ...(res.homepage
            ? [
                {
                  id: `hp:${res.id}`,
                  label: "访问官网",
                  type: "open" as const,
                  payload: res.homepage,
                },
              ]
            : []),
        ],
        health: "active",
        isCurated: true,
        raw: res,
      });
    }

    // 3. Experience Styles
    for (const st of STYLE_REGISTRY) {
      list.push({
        id: `style:${st.id}`,
        type: "style",
        title: st.name,
        subtitle: `${st.subtitle} · v${st.version}`,
        description: st.description,
        category: "style",
        categoryLabel: "设计系统风格",
        tags: ["风格", "设计系统", ...(st.tags || [])],
        origin: {
          type: "builtin",
          author: st.author,
          license: st.license,
        },
        action: {
          id: `apply:style:${st.id}`,
          label: "应用此体验",
          type: "apply",
          payload: st.id,
        },
        secondaryActions: [
          {
            id: `preview:style:${st.id}`,
            label: "预览完整样张",
            type: "apply",
            payload: st.id,
          },
        ],
        health: "ready",
        isCurated: true,
        raw: st,
      });
    }

    // 4. Skills
    for (const sk of BUILTIN_SKILLS) {
      list.push({
        id: sk.id,
        type: "skill",
        title: sk.name,
        subtitle: `${sk.category} · AI 协同技能`,
        description: sk.description,
        category: "skill",
        categoryLabel: "开发技能",
        tags: ["技能", sk.category, ...sk.tags],
        origin: {
          type: "community",
          author: "Setup Center",
        },
        action: {
          id: `copy:skill:${sk.id}`,
          label: "复制提示词 (Prompt)",
          type: "copy",
          payload: sk.prompt,
        },
        health: "ready",
        isCurated: true,
        raw: sk,
      });
    }

    // 5. Patterns
    for (const pat of BUILTIN_PATTERNS) {
      list.push({
        id: pat.id,
        type: "pattern",
        title: pat.name,
        subtitle: `${pat.category} · 视觉代码模式`,
        description: pat.description,
        category: "pattern",
        categoryLabel: "版式模式",
        tags: ["版式", pat.category, ...pat.tags],
        origin: {
          type: "community",
          author: "Setup Center",
        },
        action: {
          id: `copy:pattern:${pat.id}`,
          label: "复制 CSS 规则",
          type: "copy",
          payload: pat.snippet,
        },
        health: "ready",
        isCurated: true,
        raw: pat,
      });
    }

    this.items = list;
    this.initialized = true;
  }

  public getAll(): DiscoveryItem[] {
    this.init();
    return this.items;
  }

  public get(id: string): DiscoveryItem | undefined {
    this.init();
    return this.items.find((item) => item.id === id);
  }

  public search(query: string, filter?: DiscoveryFilter): DiscoveryItem[] {
    this.init();
    const q = (query || "").trim().toLowerCase();

    let pool = this.items;

    // Apply type filter
    if (filter?.type && filter.type !== "all") {
      pool = pool.filter((item) => item.type === filter.type);
    }

    // Apply category filter
    if (filter?.category && filter.category !== "all") {
      pool = pool.filter((item) => item.category === filter.category);
    }

    if (!q) {
      return pool.slice(0, 30);
    }

    // Scoring algorithm
    const scored: Array<{ item: DiscoveryItem; score: number }> = [];

    for (const item of pool) {
      const titleLower = item.title.toLowerCase();
      const descLower = item.description.toLowerCase();
      const subLower = (item.subtitle || "").toLowerCase();
      const tagsString = item.tags.join(" ").toLowerCase();

      let score = 0;

      // Exact match
      if (titleLower === q) score += 100;
      else if (titleLower.startsWith(q)) score += 50;
      else if (titleLower.includes(q)) score += 30;

      // Subtitle / category match
      if (subLower.includes(q)) score += 15;
      if (item.category.toLowerCase().includes(q)) score += 10;

      // Tag match
      if (tagsString.includes(q)) score += 20;

      // Description match
      if (descLower.includes(q)) score += 10;

      // Word acronym match (e.g. "vs code" -> vscode)
      const acronym = item.title
        .split(/[\s-_]+/)
        .map((w) => w[0])
        .join("")
        .toLowerCase();
      if (acronym.startsWith(q)) score += 25;

      if (score > 0) {
        scored.push({ item, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.item);
  }
}

export const LocalSearchIndex = new SearchIndexManager();
