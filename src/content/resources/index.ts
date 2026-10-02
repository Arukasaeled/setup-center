import type { ResourceCategory, ResourceCategoryMeta, ResourceItem } from "./types";

export * from "./types";

// Auto-discover all category modules dynamically across ./categories/*.ts
const categoryModules = import.meta.glob<{
  [key: string]: unknown;
}>("./categories/*.ts", { eager: true });

function extractResourceItems(mod: Record<string, unknown>): ResourceItem[] {
  const items: ResourceItem[] = [];
  for (const key of Object.keys(mod)) {
    const val = mod[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (
          item &&
          typeof item === "object" &&
          "id" in item &&
          "name" in item &&
          "category" in item
        ) {
          items.push(item as ResourceItem);
        }
      }
    }
  }
  return items;
}

const discoveredResources: ResourceItem[] = [];
for (const path in categoryModules) {
  const mod = categoryModules[path];
  const items = extractResourceItems(mod);
  discoveredResources.push(...items);
}

export const BUILTIN_CATEGORIES: ResourceCategoryMeta[] = [
  {
    id: "frontend",
    name: "设计灵感与系统",
    icon: "✦",
    description: "全球顶级 Web 界面、落地页、排版与微交互画廊",
  },
  {
    id: "components",
    name: "现代组件库",
    icon: "❖",
    description: "无头原语、复制级组件与高质感设计系统控件",
  },
  {
    id: "animation",
    name: "动效与三维交互",
    icon: "◎",
    description: "物理弹簧、复杂时间轴、Three.js 3D 与平滑滚动",
  },
  {
    id: "icons",
    name: "矢量图标体系",
    icon: "◈",
    description: "像素对齐、多形态变体与品牌官方矢量 Logo 集",
  },
  {
    id: "fonts",
    name: "字体与排印工坊",
    icon: "Aa",
    description: "开发者等宽代码字体、屏幕无衬线与终端补丁",
  },
  {
    id: "tools",
    name: "开发效率工具",
    icon: "⌘",
    description: "次世代编辑器、极速检索、终端提示符与版本管理",
  },
  {
    id: "ai",
    name: "AI 智能开发",
    icon: "✧",
    description: "本地大模型、私有工作台、提示词体系与 MCP 协议",
  },
  {
    id: "templates",
    name: "工程模板与脚手架",
    icon: "◩",
    description: "端到端类型安全、轻量桌面端与全栈单体工程起步",
  },
  {
    id: "learning",
    name: "学习路径与技能树",
    icon: "⎘",
    description: "全景路线图、分布式系统架构与 MIT 工具链公开课",
  },
  {
    id: "collections",
    name: "精选开源清单",
    icon: "★",
    description: "长期维护的 Awesome 汇总、自建服务与生态索引",
  },
];

export const RESOURCE_CATEGORIES: ResourceCategoryMeta[] = [...BUILTIN_CATEGORIES];

/** The complete aggregated catalog of developer and creative resources */
export const RESOURCE_CATALOG: ResourceItem[] = [...discoveredResources];

/** Register or update a resource in the active catalog */
export function registerResource(item: ResourceItem): void {
  const existingIdx = RESOURCE_CATALOG.findIndex((r) => r.id === item.id);
  if (existingIdx >= 0) {
    RESOURCE_CATALOG[existingIdx] = item;
  } else {
    RESOURCE_CATALOG.push(item);
  }
}

/** Batch register resources (e.g. from Vault synchronization) */
export function registerResourcesBatch(items: ResourceItem[]): void {
  for (const item of items) {
    registerResource(item);
  }
}

/** Query resources by category */
export function getResourcesByCategory(category: ResourceCategory): ResourceItem[] {
  return RESOURCE_CATALOG.filter((item) => item.category === category);
}

/** Retrieve all featured standout resources */
export function getFeaturedResources(): ResourceItem[] {
  return RESOURCE_CATALOG.filter((item) => item.featured);
}

/** Retrieve resource item by ID */
export function getResourceById(id: string): ResourceItem | undefined {
  return RESOURCE_CATALOG.find((item) => item.id === id);
}

/** Search resources across name, description, tags, and recommended reason */
export function searchResources(query: string, categoryFilter?: ResourceCategory | "all"): ResourceItem[] {
  const q = query.trim().toLowerCase();
  return RESOURCE_CATALOG.filter((item) => {
    if (categoryFilter && categoryFilter !== "all" && item.category !== categoryFilter) {
      return false;
    }
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.recommendedReason.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q)) ||
      (item.author && item.author.toLowerCase().includes(q))
    );
  });
}
