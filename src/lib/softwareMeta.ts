/**
 * Software presentation metadata tailored for students & beginners.
 *
 * Clean, professional, and accessible. No cheap emojis.
 */

import type { SoftwareId } from "./types";

export type SoftwareCategoryKey = "all" | "ai" | "dev" | "media" | "sys";

export interface SoftwareCategory {
  key: SoftwareCategoryKey;
  label: string;
  description: string;
}

export const SOFTWARE_CATEGORIES: SoftwareCategory[] = [
  {
    key: "all",
    label: "全部软件",
    description: "查看所有检测到的 AI 应用、编程工具与系统环境",
  },
  {
    key: "ai",
    label: "AI 伙伴",
    description: "大模型桌面助手、对话客户端与智能问答工具",
  },
  {
    key: "dev",
    label: "编程开发",
    description: "代码编写、版本管理、语法高亮与现代代码编辑器",
  },
  {
    key: "media",
    label: "影音创作",
    description: "AI 绘图、视频剪辑、智能字幕与创意生成工具",
  },
  {
    key: "sys",
    label: "基础环境",
    description: "脚本运行引擎、现代终端与底层依赖套件",
  },
];

export interface KidSoftwareMeta {
  nick: string;
  metaphor: string;
  category: "ai" | "dev" | "media" | "sys";
  badge: "必备" | "推荐" | "可选" | "仅检测";
}

export const KID_SOFTWARE_MAP: Record<SoftwareId, KidSoftwareMeta> = {
  vscode: {
    nick: "智能代码画板",
    metaphor: "主流通用的现代代码编辑器，写错代码会自动高亮并提示修正",
    category: "dev",
    badge: "必备",
  },
  git: {
    nick: "代码时光机",
    metaphor: "像游戏存档一样保存每次代码修改，不怕改错随时能够撤销还原",
    category: "dev",
    badge: "必备",
  },
  python: {
    nick: "经典编程积木",
    metaphor: "语法清晰直观的现代编程语言，学习人工智能与数据处理的基础",
    category: "dev",
    badge: "必备",
  },
  node: {
    nick: "JS 运行底座",
    metaphor: "脱离浏览器运行 JavaScript 的引擎，许多流行命令行工具均依赖它",
    category: "sys",
    badge: "推荐",
  },
  claude_desktop: {
    nick: "Claude 桌面端",
    metaphor: "擅长长文阅读、逻辑推理与学术解答的桌面智能助理",
    category: "ai",
    badge: "推荐",
  },
  claude_code: {
    nick: "终端编程助手",
    metaphor: "直接运行在终端中的全自动编程智能体，按自然语言指令辅助编码",
    category: "ai",
    badge: "推荐",
  },
  codex: {
    nick: "Codex 命令行",
    metaphor: "来自 OpenAI 的轻量代码生成与命令行辅助工具",
    category: "ai",
    badge: "可选",
  },
  docker: {
    nick: "容器集装箱",
    metaphor: "将整套软件依赖打包成独立容器，在不同电脑上均能保持一致运行",
    category: "sys",
    badge: "可选",
  },
  cursor: {
    nick: "AI 原生编辑器",
    metaphor: "深度融合大模型的现代编辑器，按下 Tab 键即可预测并补全下一段代码",
    category: "dev",
    badge: "推荐",
  },
  wsl: {
    nick: "Linux 子系统",
    metaphor: "无需重装电脑，直接在 Windows 中体验原生且完整的 Linux 开发环境",
    category: "sys",
    badge: "推荐",
  },
  msvc_build_tools: {
    nick: "C/C++ 编译套件",
    metaphor: "底层代码与部分高性能 AI 拓展包编译时必须调用的微软构建工具",
    category: "sys",
    badge: "可选",
  },
  cmake: {
    nick: "工程构建工具",
    metaphor: "跨平台项目管理与自动化构建工具，组织大型工程的核心标准",
    category: "sys",
    badge: "可选",
  },
  npm: {
    nick: "Node 包管理器",
    metaphor: "全球规模庞大的代码资源超市，便捷下载各种开发者共享的开源模块",
    category: "sys",
    badge: "推荐",
  },
  pnpm: {
    nick: "高效包管家",
    metaphor: "安装极速且节约磁盘空间的现代包管理器，避免相同模块重复占用空间",
    category: "sys",
    badge: "推荐",
  },
  uv: {
    nick: "Python 极速管理",
    metaphor: "基于 Rust 编写的高性能管理工具，安装 Python 扩展包速度提升数十倍",
    category: "sys",
    badge: "推荐",
  },
  rust: {
    nick: "现代系统语言",
    metaphor: "兼具高性能与极致内存安全的新一代硬核编程语言",
    category: "dev",
    badge: "可选",
  },
  java: {
    nick: "跨平台老牌语言",
    metaphor: "经典且稳定的通用面向对象编程语言，拥有极其庞大的生态",
    category: "dev",
    badge: "可选",
  },
  gemini: {
    nick: "Gemini 终端版",
    metaphor: "谷歌官方大模型命令行助手，可在控制台中随时发起多模态问答",
    category: "ai",
    badge: "可选",
  },
  opencode: {
    nick: "开源编程助手",
    metaphor: "自由灵活的终端智能辅助工具，可自由绑定多种主流大模型接口",
    category: "ai",
    badge: "可选",
  },
  continue: {
    nick: "编辑器副驾驶",
    metaphor: "运行在 VS Code 内的开源 AI 编程辅助插件，在侧边栏随时答疑解惑",
    category: "dev",
    badge: "推荐",
  },
  jetbrains: {
    nick: "专业开发套件",
    metaphor: "深得专业工程师青睐的高级集成开发环境集合，功能强大严谨",
    category: "dev",
    badge: "可选",
  },
  chatgpt_desktop: {
    nick: "ChatGPT 桌面端",
    metaphor: "主流通用的桌面对话应用，涵盖百科查询、写作构思与思维辅助",
    category: "ai",
    badge: "推荐",
  },
  windsurf: {
    nick: "智能协同编辑器",
    metaphor: "主打流畅协作体验的下一代 AI 编程编辑器，理解全库上下文",
    category: "dev",
    badge: "推荐",
  },
  lm_studio: {
    nick: "本地大模型工作台",
    metaphor: "可在本机离线下载并运行开源模型，断网也能安心进行私密对话",
    category: "ai",
    badge: "推荐",
  },
  windows_terminal: {
    nick: "现代终端控制台",
    metaphor: "微软官方现代多标签命令行窗口，排版优雅，支持灵活定制外观",
    category: "sys",
    badge: "推荐",
  },
  qwen_code: {
    nick: "通义千问编程助手",
    metaphor: "阿里巴巴开源的命令行编程智能体，对中文语义与国内开发场景理解透彻",
    category: "ai",
    badge: "推荐",
  },
  kimi_cli: {
    nick: "Kimi 终端助手",
    metaphor: "月之暗面大模型命令行工具，擅长长文本分析与大体量代码库阅读",
    category: "ai",
    badge: "推荐",
  },
  cc_switch: {
    nick: "CLI 快速切换台",
    metaphor: "在多款命令行 AI 助手之间无缝切换配置环境的实用小工具",
    category: "dev",
    badge: "可选",
  },
  crush: {
    nick: "Crush 终端助手",
    metaphor: "交互界面精致流畅的现代终端 AI 交互辅助工具",
    category: "ai",
    badge: "可选",
  },
  doubao: {
    nick: "豆包桌面助手",
    metaphor: "字节跳动出品的智能伙伴，界面亲和，知识问答与日常辅导响应迅速",
    category: "ai",
    badge: "推荐",
  },
  cherry_studio: {
    nick: "全能多模型客户端",
    metaphor: "广受赞誉的多模型聚合客户端，可同时连接 DeepSeek、OpenAI 与本地模型",
    category: "ai",
    badge: "推荐",
  },
  chatbox: {
    nick: "轻量多模型对话盒",
    metaphor: "轻快整洁的跨平台对话客户端，配置简明，支持多种 API 接口",
    category: "ai",
    badge: "推荐",
  },
  jianying_pro: {
    nick: "剪映专业版",
    metaphor: "上手容易且功能强大的视频剪辑神器，内置丰富的字幕识别与特效素材",
    category: "media",
    badge: "推荐",
  },
  capcut: {
    nick: "CapCut 国际版",
    metaphor: "风靡海外市场的视频创作工具，内置丰富的国际流行创意预设",
    category: "media",
    badge: "可选",
  },
  comfyui: {
    nick: "本地节点绘图台",
    metaphor: "通过模块化节点搭建 AI 生图流水线，精准可控的本地创意设计工具",
    category: "media",
    badge: "推荐",
  },
  gemini_desktop: {
    nick: "Gemini 官方桌面端",
    metaphor: "谷歌打造的官方智能桌面客户端，融合图像、音频与代码的多模态分析",
    category: "ai",
    badge: "推荐",
  },
};

export function getKidSoftwareMeta(id: SoftwareId): KidSoftwareMeta {
  return (
    KID_SOFTWARE_MAP[id] ?? {
      nick: "实用工具",
      metaphor: "助力学习与探索的高效软件环境",
      category: "sys",
      badge: "推荐",
    }
  );
}
