/**
 * Setup Center — Unified Local Search Index
 *
 * Fast (<5ms) tokenized, multi-field search engine across:
 * - Built-in Software Catalogue & Entitlements
 * - Personal Catalog Software
 * - 386 Curated Resources
 * - Project Templates & Starter Packs
 * - 20 Experience Styles
 * - Developer Skills & UI Patterns
 *
 * All items resolve honest executable SetupActions via resolveSetupAction.
 */

import { STYLE_REGISTRY } from "../../styles";
import { RESOURCE_CATALOG } from "../../content/resources";
import { KID_SOFTWARE_MAP } from "../../lib/softwareMeta";
import { SOFTWARE_IDS } from "../../lib/types";
import { resolveSetupAction } from "../setup/resolver";
import { PersonalCatalog } from "../transfer/catalog";
import { SETUP_COLLECTIONS } from "../setup/collections";
import { useApp } from "../../lib/store";
import type { DiscoveryItem, DiscoveryFilter } from "./types";

// Curated developer prompt skills
const BUILTIN_SKILLS: Array<{
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  prompt: string;
}> = [
  {
    id: "skill:code-review",
    name: "深度代码审查专家 (Senior Code Reviewer)",
    category: "AI 编程",
    description: "全面审查代码的可读性、健壮性、边界防护与潜在并发死锁隐患。",
    tags: ["代码审查", "质量保证", "重构", "安全性"],
    prompt: "请以资深架构师的视角全面审查以下代码：分析时间/空间复杂度、边缘边界条件、潜在内存泄漏或异步竞态隐患，并给出具体的重构建议代码片段：",
  },
  {
    id: "skill:test-generator",
    name: "高覆盖率单元测试编写 (Unit Test Generator)",
    category: "AI 编程",
    description: "自动编写覆盖 Happy Path、异常注入与边界极限情况的现代化单元测试用例。",
    tags: ["测试", "Vitest", "Jest", "TDD", "质量保证"],
    prompt: "请为以下模块编写全面的自动化测试用例：覆盖正常流、错误抛出、网络超时与边界空值等场景，采用标准断言库并附带测试说明。",
  },
  {
    id: "skill:git-commit-helper",
    name: "规范提交日志生成器 (Conventional Commits)",
    category: "工程规范",
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
    this.rebuild();
  }

  public rebuild(): void {
    const list: DiscoveryItem[] = [];
    const inventory = useApp.getState().inventory;
    const catalogue = useApp.getState().catalogue || [];
    const catMap = new Map(catalogue.map((c) => [c.id, c]));

    // 1. Built-in Software from canonical catalogue & KID_SOFTWARE_MAP
    for (const swId of SOFTWARE_IDS) {
      const meta = KID_SOFTWARE_MAP[swId];
      const desc = catMap.get(swId);
      const name = desc?.name || meta?.nick || swId;
      const purpose = desc?.purpose || meta?.metaphor || "";
      const categoryName =
        desc?.categoryName ||
        (meta?.category === "ai"
          ? "AI 软件"
          : meta?.category === "dev"
            ? "开发工具"
            : meta?.category === "media"
              ? "多媒体"
              : "系统环境");

      const resolved = resolveSetupAction({ type: "software", id: swId, name }, inventory);

      list.push({
        id: `sw:${swId}`,
        type: "software",
        title: name,
        subtitle: `${categoryName} · ${meta?.badge || "核心工具"}`,
        description: purpose,
        category: "software",
        categoryLabel: categoryName,
        tags: ["软件", categoryName, swId, meta?.category || "", meta?.badge || ""],
        origin: {
          type: "builtin",
        },
        action: resolved.primaryAction,
        secondaryActions: resolved.secondaryActions,
        health: "ready",
        installed: Boolean(inventory?.items?.some((i) => i.id === swId && i.installed)),
        isCurated: true,
        raw: { id: swId, meta, desc },
      });
    }

    // 2. Personal Catalog Software
    const personalItems = PersonalCatalog.getAllSoftware();
    for (const sw of personalItems) {
      list.push({
        id: sw.id,
        type: "software",
        title: sw.name,
        subtitle: `个人纳管 · ${sw.publisher || "第三方"} · v${sw.version || "latest"}`,
        description: sw.description || "个人软件库纳管资产",
        category: "software",
        categoryLabel: "个人软件",
        tags: ["个人资产", "软件", sw.provider, sw.packageId],
        origin: {
          type: "winget",
          packageId: sw.packageId,
          url: sw.homepage,
        },
        action: {
          id: `install:${sw.packageId}`,
          label: "一键安装",
          type: "command",
          payload: `winget install --id ${sw.packageId}`,
        },
        health: sw.installed ? "installed" : "active",
        installed: sw.installed,
        installedVersion: sw.installedVersion,
        isCurated: false,
        raw: sw,
      });
    }

    // 3. Experience Styles
    for (const st of STYLE_REGISTRY) {
      const resolved = resolveSetupAction({ type: "style", data: st }, inventory);
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
        action: resolved.primaryAction,
        secondaryActions: resolved.secondaryActions,
        health: "ready",
        isCurated: true,
        raw: st,
      });
    }

    // 4. Resources, Templates & Learning Guides
    for (const res of RESOURCE_CATALOG) {
      const isTemplate = res.category === "templates";
      const isLearning = res.category === "learning";
      const type: DiscoveryItem["type"] = isTemplate
        ? "template"
        : isLearning
          ? "learning"
          : "resource";
      const resolved = resolveSetupAction({ type: "resource", data: res }, inventory);

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
        action: resolved.primaryAction,
        secondaryActions: resolved.secondaryActions,
        health: "active",
        isCurated: true,
        raw: res,
      });
    }

    // 5. Starter Collections & Packs
    for (const col of SETUP_COLLECTIONS) {
      const resolved = resolveSetupAction({ type: "collection", data: col }, inventory);
      list.push({
        id: col.id,
        type: "resource",
        title: col.title,
        subtitle: `${col.subtitle} (${col.items.length} 项套件)`,
        description: col.description,
        category: col.category,
        categoryLabel: "启动套件",
        tags: ["套件", "组合包", col.category],
        origin: { type: "builtin" },
        action: resolved.primaryAction,
        secondaryActions: resolved.secondaryActions,
        health: "ready",
        isCurated: true,
        raw: col,
      });
    }

    // 6. Skills
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

    // 7. Patterns
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

  public search(query: string, filter?: DiscoveryFilter, limit: number = 30): DiscoveryItem[] {
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
      return pool.slice(0, limit);
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
    return scored.slice(0, limit).map((s) => s.item);
  }
}

export const LocalSearchIndex = new SearchIndexManager();
