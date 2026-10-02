/**
 * Setup Center — Curated Setup Recipes & Starter Packs
 *
 * Provides ready-to-bootstrap toolsets for specific developer archetypes,
 * with real-time environment checking and one-click execution.
 */

import type { SetupCollection } from "./types";

export const SETUP_COLLECTIONS: SetupCollection[] = [
  {
    id: "cs-freshman-pack",
    name: "CS Freshman Pack",
    title: "高校计算机专业大一通识套件",
    subtitle: "从零搭建扎实、标准、可持久使用的本地计算机科学学习与实验环境",
    description:
      "包含代码编辑器、分布式版本控制、C/C++编译构建底座、Python通用科学计算及现代化终端，告别零散踩坑。",
    category: "starter",
    targetAudience: "计算机相关专业大一学生、零基础编程自学者",
    estimatedSetupMinutes: 15,
    items: [
      { id: "vscode", name: "Visual Studio Code", type: "software", required: true, notes: "现代核心代码编辑器" },
      { id: "git", name: "Git 版本控制", type: "software", required: true, notes: "代码时光机与协作底座" },
      { id: "python", name: "Python 3 编程环境", type: "software", required: true, notes: "数据结构与脚本基础" },
      { id: "windows_terminal", name: "Windows Terminal", type: "software", required: false, notes: "高颜值现代多标签控制台" },
      { id: "msvc_build_tools", name: "C/C++ 构建套件", type: "software", required: false, notes: "大一 C 语言程序设计编译依赖" },
      { id: "res-cs-notes", name: "CS-Notes 核心知识", type: "resource", notes: "算法与计算机基础开源知识库" },
      { id: "res-git-flight-rules", name: "Git Flight Rules", type: "resource", notes: "日常 Git 问题速查操作规程" },
    ],
  },
  {
    id: "ai-builder-pack",
    name: "AI Agent & LLM Builder Pack",
    title: "AI 智能体全栈应用开发套件",
    subtitle: "面向大模型原生应用、Agent 工作流与智能交互的下一代开发装备",
    description:
      "聚合现代 AI 编辑器、高性能 Python 虚拟环境管理器、多模型统一调度平台与主流 Agent 客户端。",
    category: "ai",
    targetAudience: "大模型应用开发者、AI 全栈工程师、Prompt 工程师",
    estimatedSetupMinutes: 10,
    items: [
      { id: "cursor", name: "Cursor / Windsurf", type: "software", required: true, notes: "AI 原生预测与全库问答编辑器" },
      { id: "uv", name: "uv 极速 Python 包管理", type: "software", required: true, notes: "毫秒级创建虚拟环境并管理依赖" },
      { id: "python", name: "Python 3 运行时", type: "software", required: true, notes: "主流 LLM SDK 基础运行环境" },
      { id: "cherry_studio", name: "Cherry Studio", type: "software", required: false, notes: "多模型统一客户端" },
      { id: "lm_studio", name: "LM Studio", type: "software", required: false, notes: "本地开源模型离线加载与测试" },
      { id: "tpl-fastapi-uv", name: "Python FastAPI + uv 脚手架", type: "template", notes: "高性能 API 微服务开箱即用" },
      { id: "res-langchain", name: "LangChain & LlamaIndex", type: "resource", notes: "Agent 链路与知识库框架" },
    ],
  },
  {
    id: "frontend-creator-pack",
    name: "Frontend Designer & Creator Pack",
    title: "现代前端与创意设计工程套件",
    subtitle: "极致排版、流体动效与现代组件驱动的高水准 Web 构建环境",
    description:
      "整合 React 19、Tailwind CSS、优质矢量图标、平滑物理动效库与无障碍设计系统。",
    category: "frontend",
    targetAudience: "前端工程师、UI/UX 设计师、独立开发者",
    estimatedSetupMinutes: 8,
    items: [
      { id: "node", name: "Node.js LTS", type: "software", required: true, notes: "前端构建与工具链基础底座" },
      { id: "pnpm", name: "pnpm 高效包管理器", type: "software", required: true, notes: "节约磁盘空间并保持严格依赖解析" },
      { id: "vscode", name: "Visual Studio Code", type: "software", required: true, notes: "配备 Prettier 与 ESLint" },
      { id: "res-lucide", name: "Lucide Icons 图标库", type: "resource", notes: "清爽统一的开源矢量图标集" },
      { id: "res-framer-motion", name: "Motion 动画库", type: "resource", notes: "流畅自然的声明式手势动画引擎" },
      { id: "res-radix-ui", name: "Radix UI Primitives", type: "resource", notes: "无样式、100% 无障碍底层组件原语" },
      { id: "style-swiss-editorial", name: "Swiss Editorial 视觉系统", type: "style", notes: "国际主义网格与精密排版" },
    ],
  },
  {
    id: "fullstack-rust-ts-pack",
    name: "Fullstack Rust + TypeScript Pack",
    title: "极致性能全栈 (Rust + Tauri + TS) 套件",
    subtitle: "打造安全、高响应、原生桌面与跨平台服务端软件的硬核工具链",
    description:
      "结合内存安全与零成本抽象的 Rust 语言，与富有弹性的 TypeScript 前端生态。",
    category: "fullstack",
    targetAudience: "系统软件开发者、跨平台桌面客户端工程师",
    estimatedSetupMinutes: 20,
    items: [
      { id: "rust", name: "Rust 工具链 (rustup & cargo)", type: "software", required: true, notes: "现代高性能底层系统开发语言" },
      { id: "msvc_build_tools", name: "Visual Studio C++ 构建工具", type: "software", required: true, notes: "Rust Windows MSVC 链接器依赖" },
      { id: "node", name: "Node.js & pnpm", type: "software", required: true, notes: "驱动 Webview 前端打包" },
      { id: "git", name: "Git 版本控制", type: "software", required: true, notes: "源码版本管理与 crates 同步" },
      { id: "tpl-tauri-v2-react", name: "Tauri v2 + React 模板", type: "template", notes: "生产级原生轻量客户端脚手架" },
      { id: "tpl-rust-cli", name: "Rust CLI 工具骨架", type: "template", notes: "集成 clap、color-eyre、tokio" },
    ],
  },
  {
    id: "academic-paper-pack",
    name: "Academic Research & Lab Pack",
    title: "学术科研与论文排版实验套件",
    subtitle: "适用于文献追踪、实验绘图、可复现数据分析与高质量排版",
    description:
      "为研究生与学术科研工作者定制，专注严谨计算、优雅图标与纯粹阅读排版体验。",
    category: "academic",
    targetAudience: "高校研究生、科研人员、技术文档撰写者",
    estimatedSetupMinutes: 12,
    items: [
      { id: "python", name: "Python 科学计算环境", type: "software", required: true, notes: "NumPy, SciPy, Matplotlib 基础" },
      { id: "uv", name: "uv 虚拟环境隔离", type: "software", required: true, notes: "论文复现实验环境秒级创建与锁定" },
      { id: "git", name: "Git 实验版本记录", type: "software", required: true, notes: "实验数据与论文草稿版本快照" },
      { id: "style-academic-lab", name: "Academic Lab 视觉风格", type: "style", notes: "学术实验报告与精密数据网格风格" },
      { id: "res-arxiv-vanity", name: "ArXiv 阅读与排版工具", type: "resource", notes: "将学术论文呈现为排版舒适的网页" },
    ],
  },
];
