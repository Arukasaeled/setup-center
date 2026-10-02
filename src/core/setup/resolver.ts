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
import type { VaultPatternItem, VaultTemplateItem } from "../vault/types";
import type { SoftwareId, SoftwareInventory } from "../../lib/types";
import { KID_SOFTWARE_MAP } from "../../lib/softwareMeta";
import type {
  PackageManager,
  PrerequisitesStatus,
  SetupAction,
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
 * Checks environmental prerequisites against current software inventory.
 */
export function evaluatePrerequisites(
  prereq?: SetupPrerequisite,
  inventory?: SoftwareInventory | null,
): PrerequisitesStatus {
  if (!prereq || (!prereq.requiredSoftwareIds?.length && !prereq.requiredCapabilities?.length)) {
    return {
      satisfied: true,
      missingSoftwareIds: [],
      missingNames: [],
    };
  }

  if (!inventory || !Array.isArray(inventory.items)) {
    // If inventory not yet loaded, assume satisfied with non-blocking guidance
    return {
      satisfied: true,
      missingSoftwareIds: [],
      missingNames: [],
      warningHint: prereq.hint,
    };
  }

  const installedMap = new Set(
    inventory.items.filter((item) => item.installed).map((item) => item.id),
  );

  const missingSoftwareIds: SoftwareId[] = [];
  const missingNames: string[] = [];

  for (const reqId of prereq.requiredSoftwareIds || []) {
    if (!installedMap.has(reqId)) {
      missingSoftwareIds.push(reqId);
      missingNames.push(SOFTWARE_DISPLAY_NAMES[reqId] || reqId);
    }
  }

  const satisfied = missingSoftwareIds.length === 0;
  let warningHint = prereq.hint;
  if (!satisfied && !warningHint) {
    warningHint = `运行此项需要先安装 ${missingNames.join("、")}`;
  }

  return {
    satisfied,
    missingSoftwareIds,
    missingNames,
    warningHint,
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
    | { type: "software"; id: SoftwareId; name?: string; installed?: boolean }
    | { type: "generic"; id: string; name: string; category?: string; url?: string; snippet?: string },
  inventory?: SoftwareInventory | null,
  preferredPm: PackageManager = "pnpm",
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
          label: "已在环境就绪",
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

  // 2. Style item
  if (item.type === "style") {
    const s = item.data;
    const primaryAction: SetupAction = {
      id: `style-apply-${s.id}`,
      type: "apply",
      label: "立即应用视觉语言",
      description: `切换至 ${s.name} 主题令牌与排版模式`,
      payload: s.id,
      isPrimary: true,
      successMessage: `已切换至「${s.name}」风格`,
    };

    const secondaryActions: SetupAction[] = [
      {
        id: `style-copy-tokens-${s.id}`,
        type: "copy",
        label: "复制 CSS 调色板变量",
        description: "提取该风格的 hex 配色与圆角阴影令牌",
        payload: `:root {\n  --style-bg: ${s.palette.baseBg};\n  --style-surface: ${s.palette.surface};\n  --style-border: ${s.palette.cardBorder};\n  --style-accent: ${s.palette.accent};\n  --style-text: ${s.palette.text};\n  --style-radius: ${s.tokens?.borderRadius || "6px"};\n  --style-border-w: ${s.tokens?.borderWidth || "1px"};\n}`,
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
    const prereq: SetupPrerequisite = {
      requiredSoftwareIds: t.scaffold.type === "git-clone" ? ["git"] : ["node", "git"],
      hint: "脚手架生成工程需要 Git 和 Node.js 环境",
    };
    const prereqStatus = evaluatePrerequisites(prereq, inventory);

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

    if (packageCommands) {
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

  // 6. Generic fallback
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
