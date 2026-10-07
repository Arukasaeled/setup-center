/**
 * Setup Center — Universal Setup Action Resolver
 *
 * Implements intelligent action resolution across all content types:
 * - Decouples UI from underlying domain types
 * - Evaluates environmental prerequisites against live software inventory
 * - Resolves multi-package-manager command sheets (pnpm, npm, yarn, bun, cargo, uv)
 * - Guarantees zero dead content across the hub
 */

import type { ResourceItem } from "../../content/resources/types";
import type { SetupStyle } from "../../styles/types";
import {
  composeShadow,
  NAV_LABEL,
  resolveExperienceProfile,
  resolveTokens,
  SHELL_LABEL,
} from "../../styles/runtime";
import type { VaultPatternItem, VaultTemplateItem } from "../vault/types";
import type { CapabilityStatus, SoftwareId, SoftwareInventory } from "../../lib/types";
import { KID_SOFTWARE_MAP } from "../../lib/softwareMeta";
import type {
  PackageManager,
  PrerequisitesStatus,
  SetupAction,
  SetupCollection,
  SetupPrerequisite,
  SetupResolutionResult,
} from "./types";

const SOFTWARE_DISPLAY_NAMES: Partial<Record<SoftwareId, string>> = {
  node: "Node.js 运行环境",
  npm: "npm 包管理器",
  pnpm: "pnpm 极速包管理器",
  git: "Git 版本管理",
  python: "Python 编程环境",
  uv: "uv 极速包管理器",
  rust: "Rust 编程环境",
  vscode: "VS Code 编辑器",
  docker: "Docker 容器引擎",
  wsl: "WSL Linux 子系统",
};

/**
 * Checks environmental prerequisites against current software inventory and capabilities.
 *
 * Implements Issue E05:
 * - When environment/inventory is not loaded, returns unknown rather than unconditionally satisfied.
 * - Concurrently evaluates requiredCapabilities against live system capability signals.
 */
export function evaluatePrerequisites(
  prereq?: SetupPrerequisite,
  inventory?: SoftwareInventory | null,
  capabilities?: CapabilityStatus[] | null,
): PrerequisitesStatus {
  if (!prereq || (!prereq.requiredSoftwareIds?.length && !prereq.requiredCapabilities?.length)) {
    return {
      status: "satisfied",
      satisfied: true,
      missingSoftwareIds: [],
      missingNames: [],
    };
  }

  // Issue E05: If environment not yet loaded, treat as unknown rather than unconditionally satisfied
  if (!inventory || !Array.isArray(inventory.items)) {
    return {
      status: "unknown",
      satisfied: false,
      missingSoftwareIds: [],
      missingNames: [],
      warningHint: prereq.hint ? `${prereq.hint} (环境信息尚未加载，状态待检测)` : "环境信息尚未加载，状态待检测",
    };
  }

  const installedMap = new Set(
    inventory.items.filter((item) => item.installed).map((item) => item.id),
  );

  const missingSoftwareIds: SoftwareId[] = [];
  const missingCapabilities: string[] = [];
  const missingNames: string[] = [];
  const unknownCapabilities: string[] = [];

  for (const reqId of prereq.requiredSoftwareIds || []) {
    if (!installedMap.has(reqId)) {
      missingSoftwareIds.push(reqId);
      missingNames.push(SOFTWARE_DISPLAY_NAMES[reqId] || reqId);
    }
  }

  if (prereq.requiredCapabilities && prereq.requiredCapabilities.length > 0) {
    if (!capabilities || capabilities.length === 0) {
      for (const capId of prereq.requiredCapabilities) {
        unknownCapabilities.push(capId);
      }
    } else {
      const capMap = new Map(capabilities.map((c) => [c.id.toLowerCase(), c]));
      for (const capId of prereq.requiredCapabilities) {
        const cap = capMap.get(capId.toLowerCase());
        if (!cap) {
          if (!installedMap.has(capId as SoftwareId)) {
            missingCapabilities.push(capId);
            missingNames.push(capId);
          }
        } else if (cap.status === "unavailable") {
          missingCapabilities.push(capId);
          missingNames.push(cap.name || capId);
        } else if (cap.status === "unknown") {
          unknownCapabilities.push(capId);
        }
      }
    }
  }

  const hasMissing = missingSoftwareIds.length > 0 || missingCapabilities.length > 0;
  const hasUnknown = unknownCapabilities.length > 0;

  if (hasMissing) {
    let warningHint = prereq.hint;
    if (!warningHint) {
      warningHint = `运行此项需要先安装或配置 ${missingNames.join("、")}`;
    }
    return {
      status: "missing",
      satisfied: false,
      missingSoftwareIds,
      missingCapabilities,
      missingNames,
      unknownCapabilities,
      warningHint,
    };
  }

  if (hasUnknown) {
    return {
      status: "unknown",
      satisfied: false,
      missingSoftwareIds: [],
      missingCapabilities: [],
      missingNames: [],
      unknownCapabilities,
      warningHint: prereq.hint ? `${prereq.hint} (部分环境能力未完成检测)` : "部分环境能力未完成检测",
    };
  }

  return {
    status: "satisfied",
    satisfied: true,
    missingSoftwareIds: [],
    missingCapabilities: [],
    missingNames: [],
    unknownCapabilities: [],
  };
}

/**
 * Generates multi-package-manager commands for frontend libraries and packages.
 */
function buildNpmPackageCommands(
  pkgName: string,
  options?: { isDev?: boolean },
): Partial<Record<PackageManager, string>> {
  const devFlag = options?.isDev ? " -D" : "";
  const devFlagNpm = options?.isDev ? " --save-dev" : "";
  return {
    pnpm: `pnpm add${devFlag} ${pkgName}`,
    npm: `npm i${devFlagNpm} ${pkgName}`,
    yarn: `yarn add${devFlag} ${pkgName}`,
    bun: `bun add${devFlag} ${pkgName}`,
  };
}

/**
 * Helper to identify known npm library names from resource id or homepage/repo
 */
function extractPackageName(item: ResourceItem): string | null {
  const id = item.id.toLowerCase();
  const repo = (item.repository || "").toLowerCase();

  if (item.category === "components" || item.category === "icons" || item.category === "animation" || item.category === "fonts") {
    // Common package mappings
    if (id.includes("lucide")) return "lucide-react";
    if (id.includes("framer-motion") || id.includes("motion")) return "motion";
    if (id.includes("tailwind")) return "tailwindcss";
    if (id.includes("radix")) return "@radix-ui/themes";
    if (id.includes("shadcn")) return "npx shadcn@latest init";
    if (id.includes("magic-ui")) return "npx shadcn@latest add @magicui";
    if (id.includes("aceternity")) return "clsx tailwind-merge framer-motion";
    if (id.includes("geist")) return "geist";
    if (id.includes("fontsource")) return `@fontsource/${id.replace(/^font-/, "")}`;
    if (id.includes("tabler")) return "@tabler/icons-react";
    if (id.includes("feather")) return "feather-icons";
    if (id.includes("iconoir")) return "iconoir-react";
    if (id.includes("remixicon")) return "remixicon";
    if (id.includes("zustand")) return "zustand";
    if (id.includes("tanstack-query")) return "@tanstack/react-query";

    // If repository is github.com/user/pkg, try repo name
    const match = repo.match(/github\.com\/[^/]+\/([^/]+)/);
    if (match && match[1]) {
      return match[1].replace(/\.git$/, "");
    }
  }

  return null;
}

/**
 * Universal Action Resolver
 */
export function resolveSetupAction(
  item:
    | { type: "resource"; data: ResourceItem }
    | { type: "style"; data: SetupStyle }
    | { type: "template"; data: VaultTemplateItem }
    | { type: "pattern"; data: VaultPatternItem }
    | { type: "collection"; data: SetupCollection }
    | { type: "software"; id: SoftwareId; name?: string; installed?: boolean }
    | { type: "generic"; id: string; name: string; category?: string; url?: string; snippet?: string },
  inventory?: SoftwareInventory | null,
  preferredPm: PackageManager = "pnpm",
  capabilities?: CapabilityStatus[] | null,
): SetupResolutionResult {
  // 1. Software item
  if (item.type === "software") {
    const meta = KID_SOFTWARE_MAP[item.id];
    const name = item.name || meta?.nick || item.id;
    const isInstalled = item.installed ?? inventory?.items.some((i) => i.id === item.id && i.installed);

    const primaryAction: SetupAction = isInstalled
      ? {
          id: `software-installed-${item.id}`,
          type: "reveal",
          label: "查看详情",
          payload: item.id,
          description: "该软件已正确检测到本机构建路径",
          isPrimary: true,
        }
      : {
          id: `software-install-${item.id}`,
          type: "install",
          label: `安装 ${name}`,
          payload: item.id,
          description: meta?.metaphor || "将软件环境安装部署至本机",
          isPrimary: true,
          packageCommands: {
            winget: `winget install --id ${item.id} -e`,
            powershell: `setup-center install ${item.id}`,
          },
          activePackageManager: "winget",
        };

    const secondaryActions: SetupAction[] = [];
    if (!isInstalled) {
      secondaryActions.push({
        id: `software-copy-winget-${item.id}`,
        type: "copy",
        label: "复制 Winget 命令",
        payload: `winget install --id ${item.id} -e`,
      });
    }

    return {
      itemId: item.id,
      name,
      itemType: "software",
      primaryAction,
      secondaryActions,
      prerequisites: { satisfied: true, missingSoftwareIds: [], missingNames: [] },
      availablePackageManagers: ["winget", "powershell"],
    };
  }

  // 2. Style / Experience item
  if (item.type === "style") {
    const s = item.data;
    const profile = resolveExperienceProfile(s);
    const tokens = resolveTokens(s);

    const primaryAction: SetupAction = {
      id: `style-apply-${s.id}`,
      type: "apply",
      label: "立即应用视觉语言",
      description: `切换至 ${s.name} 的完整体验：${SHELL_LABEL[profile.shell ?? "sidebar"]} · ${NAV_LABEL[profile.navigation ?? "sidebar"]}`,
      payload: s.id,
      isPrimary: true,
      successMessage: `已切换至「${s.name}」风格`,
    };

    // Every style exposes the same three secondary affordances, because a style
    // with only "Apply" forces the user to guess that tuning even exists. The
    // 调校台 opens the playground for this style; 导出 and 另存为 produce an
    // artefact the user can keep or share. All three are resolved here rather
    // than hand-written in the gallery, so the gallery cannot drift from the
    // contract (brief §27).
    const secondaryActions: SetupAction[] = [
      {
        id: `style-preview-${s.id}`,
        type: "preview",
        label: "预览完整样张",
        description: "打开独立画板预览该体验，不改变当前全局样式",
        payload: s.id,
      },
      {
        id: `style-tune-${s.id}`,
        type: "customize",
        label: "调校此体验",
        description: "打开体验调校台，调节圆角 / 阴影 / 强调色 / 密度",
        payload: s.id,
      },
      {
        id: `style-export-${s.id}`,
        type: "export",
        label: "导出令牌",
        description: "导出该体验的令牌 JSON，可在另一台机器导入",
        payload: s.id,
      },
      {
        id: `style-fork-${s.id}`,
        type: "fork",
        label: "另存为自定义",
        description: `基于 ${s.name} 创建一份可继续修改的派生体验`,
        payload: s.id,
      },
      {
        id: `style-copy-tokens-${s.id}`,
        type: "copy",
        label: "复制 CSS 调色板变量",
        description: "提取该风格的 hex 配色、圆角、阴影与边框令牌",
        payload: [
          ":root {",
          `  --style-bg: ${s.palette.baseBg};`,
          `  --style-surface: ${tokens.surface};`,
          `  --style-border: ${s.palette.cardBorder};`,
          `  --style-accent: ${tokens.accent};`,
          `  --style-text: ${tokens.text};`,
          `  --style-radius: ${tokens.panelRadius};`,
          `  --style-radius-control: ${tokens.controlRadius};`,
          `  --style-border-w: ${tokens.borderWidth};`,
          `  --style-shadow: ${composeShadow(tokens.shadow)};`,
          "}",
        ].join("\n"),
        successMessage: "风格 CSS 令牌已复制到剪贴板",
      },
    ];

    return {
      itemId: s.id,
      name: s.name,
      category: "Style System",
      itemType: "style",
      primaryAction,
      secondaryActions,
      prerequisites: { satisfied: true, missingSoftwareIds: [], missingNames: [] },
    };
  }

  // 3. Template item
  if (item.type === "template") {
    const t = item.data;
    const requiredSoftware: SoftwareId[] = [];
    if (t.scaffold.type === "git-clone") {
      requiredSoftware.push("git");
    }
    if (t.scaffold.requiredCapabilities) {
      for (const cap of t.scaffold.requiredCapabilities) {
        if (["node", "npm", "pnpm", "git", "python", "uv", "rust", "docker", "wsl"].includes(cap)) {
          if (!requiredSoftware.includes(cap as SoftwareId)) {
            requiredSoftware.push(cap as SoftwareId);
          }
        }
      }
    }
    if (requiredSoftware.length === 0 && t.scaffold.type !== "git-clone") {
      requiredSoftware.push("node");
    }

    const prereq: SetupPrerequisite = {
      requiredSoftwareIds: requiredSoftware,
      requiredCapabilities: t.scaffold.requiredCapabilities ?? (t.requirements ? t.requirements.map((r) => r.toLowerCase()) : undefined),
      hint: t.requirements?.join("、") || "脚手架生成工程需要相应的开发语言与工具环境",
    };
    const prereqStatus = evaluatePrerequisites(prereq, inventory, capabilities);

    const primaryAction: SetupAction = {
      id: `template-scaffold-${t.id}`,
      type: "scaffold",
      label: "初始化工程模板",
      description: `创建基于 ${t.name} 的本地项目`,
      payload: t.id,
      isPrimary: true,
      prerequisites: prereq,
    };

    const secondaryActions: SetupAction[] = [];
    if (t.scaffold.command) {
      secondaryActions.push({
        id: `template-copy-cmd-${t.id}`,
        type: "copy",
        label: "复制脚手架命令",
        payload: t.scaffold.command,
        successMessage: "初始化命令已复制到剪切板",
      });
    }
    if (t.repository) {
      secondaryActions.push({
        id: `template-clone-${t.id}`,
        type: "clone",
        label: "克隆模板仓库",
        payload: `git clone ${t.repository}`,
        successMessage: "Git 克隆命令已复制到剪切板",
      });
    }
    if (t.homepage) {
      secondaryActions.push({
        id: `template-open-${t.id}`,
        type: "open",
        label: "浏览模板主页",
        payload: t.homepage,
      });
    }

    return {
      itemId: t.id,
      name: t.name,
      category: t.category,
      itemType: "template",
      primaryAction,
      secondaryActions,
      prerequisites: prereqStatus,
      availablePackageManagers: (t.scaffold.supportedPackageManagers as PackageManager[]) || undefined,
    };
  }

  // 4. Pattern item
  if (item.type === "pattern") {
    const p = item.data;
    const primaryAction: SetupAction = {
      id: `pattern-copy-code-${p.id}`,
      type: "copy",
      label: "复制组件代码 (JSX/TSX)",
      description: "将经过视觉风格调优的组件代码放入剪贴板",
      payload: p.codeSnippet,
      isPrimary: true,
      successMessage: `组件代码「${p.name}」已复制`,
    };

    const secondaryActions: SetupAction[] = [
      {
        id: `pattern-copy-css-${p.id}`,
        type: "copy",
        label: "复制样式规则 (CSS)",
        description: "提取该模式对应的专用 CSS 选择器与关键帧",
        payload: p.cssRules,
        successMessage: "CSS 规则已复制",
      },
    ];

    return {
      itemId: p.id,
      name: p.name,
      category: p.category,
      itemType: "pattern",
      primaryAction,
      secondaryActions,
      prerequisites: { satisfied: true, missingSoftwareIds: [], missingNames: [] },
    };
  }

  // 5. Resource item
  if (item.type === "resource") {
    const r = item.data;
    const pkgName = extractPackageName(r);

    // Default package commands if detected
    let packageCommands: Partial<Record<PackageManager, string>> | undefined;
    if (pkgName) {
      if (pkgName.startsWith("npx ")) {
        packageCommands = {
          pnpm: `pnpm dlx ${pkgName.replace(/^npx /, "")}`,
          npm: pkgName,
          bun: `bunx ${pkgName.replace(/^npx /, "")}`,
        };
      } else {
        packageCommands = buildNpmPackageCommands(pkgName);
      }
    }

    let primaryAction: SetupAction;
    const secondaryActions: SetupAction[] = [];
    let prereq: SetupPrerequisite | undefined;

    if (r.category === "templates" && !packageCommands) {
      // A template's primary action is instantiating it, not reading about it.
      // This used to be a hand-written "创建工程" button in the resource card,
      // which meant the detail view and the card disagreed about what the same
      // template's main action was. Resolved here, both surfaces agree.
      prereq = { requiredSoftwareIds: ["node", "git"], hint: "实例化工程模板需要 Node.js 与 Git" };
      primaryAction = {
        id: `resource-scaffold-${r.id}`,
        type: "scaffold",
        label: "创建工程",
        description: "基于该模板实例化一个本地项目目录",
        payload: r.id,
        isPrimary: true,
        prerequisites: prereq,
        successMessage: `已调起「${r.name}」工程生成向导`,
      };
    } else if (packageCommands) {
      prereq = {
        requiredSoftwareIds: ["node"],
        hint: "安装该前端模块需要 Node.js 运行时",
      };
      const activeCommand = packageCommands[preferredPm] || packageCommands.pnpm || packageCommands.npm || "";
      primaryAction = {
        id: `resource-pkg-cmd-${r.id}`,
        type: "command",
        label: `复制安装命令 (${preferredPm})`,
        description: `将 ${pkgName} 添加到当前项目依赖中`,
        payload: activeCommand,
        packageCommands,
        activePackageManager: preferredPm,
        isPrimary: true,
        prerequisites: prereq,
        successMessage: `已复制: ${activeCommand}`,
      };
    } else if (r.actionType === "download" && r.downloadUrl) {
      primaryAction = {
        id: `resource-download-${r.id}`,
        type: "download",
        label: "立即下载离线资源",
        description: "调用内置 AssetDownloader 获取归档文件",
        payload: r.downloadUrl,
        isPrimary: true,
        successMessage: `开始下载 ${r.name}`,
      };
    } else if (r.repository && (r.actionType === "github" || !r.homepage)) {
      prereq = { requiredSoftwareIds: ["git"], hint: "克隆代码仓库需要本地配置 Git" };
      primaryAction = {
        id: `resource-clone-${r.id}`,
        type: "clone",
        label: "克隆代码仓库 (Git Clone)",
        description: "复制 git clone 命令或调用本地 Git 客户端",
        payload: `git clone ${r.repository}`,
        isPrimary: true,
        prerequisites: prereq,
        successMessage: `克隆命令已复制: git clone ${r.repository}`,
      };
    } else {
      const url = r.homepage || r.repository || "";
      primaryAction = {
        id: `resource-open-${r.id}`,
        type: "open",
        label: "打开官方站点 / 主页",
        description: "在浏览器中访问资源官方文档与交互展板",
        payload: url,
        isPrimary: true,
      };
    }

    // Secondary actions backfilling
    if (r.repository && primaryAction.type !== "clone") {
      secondaryActions.push({
        id: `resource-clone-sec-${r.id}`,
        type: "clone",
        label: "克隆仓库 (Git)",
        payload: `git clone ${r.repository}`,
        successMessage: `已复制: git clone ${r.repository}`,
      });
    }
    if (r.homepage && primaryAction.type !== "open") {
      secondaryActions.push({
        id: `resource-open-sec-${r.id}`,
        type: "open",
        label: "访问主页 / 演示",
        payload: r.homepage,
      });
    }
    if (r.downloadUrl && primaryAction.type !== "download") {
      secondaryActions.push({
        id: `resource-download-sec-${r.id}`,
        type: "download",
        label: "下载离线资产包",
        payload: r.downloadUrl,
      });
    }
    secondaryActions.push({
      id: `resource-copy-url-${r.id}`,
      type: "copy",
      label: "复制资源链接",
      payload: r.homepage || r.repository || "",
      successMessage: "链接已复制到剪贴板",
    });

    const prereqStatus = evaluatePrerequisites(prereq, inventory);
    const availablePackageManagers = packageCommands ? (Object.keys(packageCommands) as PackageManager[]) : undefined;

    return {
      itemId: r.id,
      name: r.name,
      category: r.category,
      itemType: "resource",
      primaryAction,
      secondaryActions,
      prerequisites: prereqStatus,
      availablePackageManagers,
    };
  }

  // 6. Setup Collection / Starter Pack
  if (item.type === "collection") {
    const col = item.data;
    const primaryAction: SetupAction = {
      id: `collection-scaffold-${col.id}`,
      type: "scaffold",
      label: `初始化套件 (${col.items.length} 项)`,
      description: col.description,
      payload: col.id,
      isPrimary: true,
      successMessage: `已准备好「${col.title}」启动套件`,
    };
    const secondaryActions: SetupAction[] = [
      {
        id: `collection-copy-${col.id}`,
        type: "copy",
        label: "复制套件清单",
        description: "复制该 Starter Pack 包含的软件与资源清单",
        payload: col.items.map((i) => `- [${i.type}] ${i.name} (${i.id})`).join("\n"),
        successMessage: `已复制「${col.title}」清单`,
      },
    ];
    return {
      itemId: col.id,
      name: col.title,
      category: col.category,
      itemType: "collection",
      primaryAction,
      secondaryActions,
      prerequisites: { satisfied: true, missingSoftwareIds: [], missingNames: [] },
    };
  }

  // 7. Generic fallback
  const g = item;
  return {
    itemId: g.id,
    name: g.name,
    category: g.category || "General",
    itemType: "resource",
    primaryAction: {
      id: `gen-open-${g.id}`,
      type: g.snippet ? "copy" : "open",
      label: g.snippet ? "复制内容" : "访问链接",
      payload: g.snippet || g.url || "",
      isPrimary: true,
      successMessage: "操作已完成",
    },
    secondaryActions: [],
    prerequisites: { satisfied: true, missingSoftwareIds: [], missingNames: [] },
  };
}
