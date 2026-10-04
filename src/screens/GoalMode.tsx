/**
 * Setup Center — Goal Mode Screen
 *
 * Deterministic goal-oriented workspaces:
 * "Find -> Understand -> Choose -> Setup"
 *
 * Maps practical developer goals (AI Agent, Fullstack Web, Rust CLI, Data Science, etc.)
 * directly to required system capabilities, starter templates, curated repos, and toolchains.
 */

import { useState, useMemo, useEffect } from "react";
import clsx from "clsx";
import { useApp } from "../lib/store";
import { Button } from "../components/ui";
import { ScaffoldModal } from "../components/ScaffoldModal";
import { CloneRepoModal } from "../components/CloneRepoModal";
import { RepoDetailModal } from "../components/RepoDetailModal";
import { Bookmarks } from "../core/transfer/bookmarks";
import { RecentTracker } from "../core/transfer/recent";
import { PersonalCatalog } from "../core/transfer/catalog";
import { fetchGitHubRepoDetails } from "../core/discovery/github";
import type { DiscoveryItem } from "../core/discovery/types";

export interface GoalTrack {
  id: string;
  name: string;
  tagline: string;
  description: string;
  capabilities: string[];
  recommendedSoftware: { id: string; name: string; desc: string; wingetId?: string }[];
  templates: { id: string; title: string; desc: string; scaffoldCommand: string }[];
  repos: { title: string; repoUrl: string; desc: string; stars?: string; tech: string }[];
  resources: { id: string; title: string; desc: string; url: string }[];
}

const GOAL_TRACKS: GoalTrack[] = [
  {
    id: "ai_application",
    name: "AI 应用与 Agent 开发",
    tagline: "构建调用大语言模型、智能体工作流与本地知识库的应用程序",
    description: "配置现代 Python 环境、包管理器与 API 开发工具，快速上手大模型提示词工程、LangChain、LlamaIndex 与 Agentic 架构。",
    capabilities: ["python-development", "ai-agent-development", "git-collaboration", "ai-cli-assistant"],
    recommendedSoftware: [
      { id: "python", name: "Python 3.12+", desc: "现代 Python 解释器与虚拟环境" },
      { id: "git", name: "Git", desc: "分布式版本控制" },
      { id: "vscode", name: "Visual Studio Code", desc: "核心代码编辑器" },
      { id: "claude-desktop", name: "Claude Desktop", desc: "Anthropic 官方桌面客户端" },
      { id: "ollama", name: "Ollama", desc: "本地离线开源大语言模型运行环境", wingetId: "Ollama.Ollama" },
    ],
    templates: [
      { id: "fastapi-agent", title: "FastAPI + LangChain Agent 模板", desc: "开箱即用的 Python AI 后端服务，集成流式响应与环境变量管理", scaffoldCommand: "uvx create-fastapi-app my-ai-service" },
      { id: "nextjs-ai-chatbot", title: "Next.js AI Chatbot", desc: "基于 Vercel AI SDK 的现代化流式对话交互界面", scaffoldCommand: "npx create-next-app@latest my-ai-chat --example \"https://github.com/vercel/ai-chatbot\"" },
    ],
    repos: [
      { title: "langchain-ai/langchain", repoUrl: "https://github.com/langchain-ai/langchain", desc: "构建上下文感知和推理型 AI 应用的顶流框架", stars: "98k", tech: "Python" },
      { title: "ollama/ollama", repoUrl: "https://github.com/ollama/ollama", desc: "在本地轻量运行 Llama 3、DeepSeek、Qwen 的优秀工具", stars: "105k", tech: "Go / C++" },
      { title: "browser-use/browser-use", repoUrl: "https://github.com/browser-use/browser-use", desc: "让 AI 智能体直接操作浏览器的开源项目", stars: "32k", tech: "Python" },
    ],
    resources: [
      { id: "ai-sdk-docs", title: "Vercel AI SDK 官方手册", desc: "构建现代化 AI 前端界面的核心开发库", url: "https://sdk.vercel.ai/docs" },
      { id: "anthropic-prompt-eng", title: "Anthropic 提示词工程指南", desc: "官方推荐的结构化 Prompt 与思维链优化技巧", url: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview" },
    ],
  },
  {
    id: "fullstack",
    name: "现代全栈与 Web 前端",
    tagline: "掌握 React 19、Next.js、TypeScript、Tailwind CSS 与云端部署",
    description: "初始化现代化前端与全栈开发环境，配置 Node.js、快速包管理器 pnpm 与代码规范工具链。",
    capabilities: ["node-development", "git-collaboration", "vscode-ai-pairing"],
    recommendedSoftware: [
      { id: "nodejs", name: "Node.js (LTS)", desc: "JavaScript 运行时与 npm" },
      { id: "git", name: "Git", desc: "分布式版本控制" },
      { id: "vscode", name: "Visual Studio Code", desc: "前端开发主力编辑器" },
      { id: "google-chrome", name: "Google Chrome", desc: "调试与开发者工具" },
    ],
    templates: [
      { id: "nextjs-shadcn", title: "Next.js 15 + Tailwind + shadcn/ui", desc: "业界标准的现代化企业级 Web 应用脚手架", scaffoldCommand: "npx create-next-app@latest my-app --typescript --tailwind --eslint" },
      { id: "vite-react-ts", title: "Vite + React 19 + TypeScript", desc: "极速秒级 HMR 的轻量级单页前端应用脚手架", scaffoldCommand: "npm create vite@latest my-react-app -- --template react-ts" },
    ],
    repos: [
      { title: "shadcn-ui/ui", repoUrl: "https://github.com/shadcn-ui/ui", desc: "优雅美观、可直接复制源码的 React 组件设计系统", stars: "82k", tech: "TypeScript" },
      { title: "tailwindlabs/tailwindcss", repoUrl: "https://github.com/tailwindlabs/tailwindcss", desc: "现代化原子级 CSS 框架", stars: "83k", tech: "CSS / Rust" },
      { title: "t3-oss/create-t3-app", repoUrl: "https://github.com/t3-oss/create-t3-app", desc: "集成 Next.js、tRPC、Tailwind 与 Prisma 的全栈标杆模板", stars: "26k", tech: "TypeScript" },
    ],
    resources: [
      { id: "nextjs-learn", title: "Next.js App Router 官方实战教程", desc: "从零构建全栈服务端渲染应用的完整指南", url: "https://nextjs.org/learn" },
      { id: "react-dev", title: "React 官方中文文档 (react.dev)", desc: "全新的 Hooks 与 Server Components 概念剖析", url: "https://zh-hans.react.dev" },
    ],
  },
  {
    id: "rust_cli",
    name: "现代化 CLI 与 Rust 系统开发",
    tagline: "用 Rust 编写极速、可靠、内存安全的命令行工具与后端服务",
    description: "配置 Rust 工具链 (rustup, rustc, cargo)、VS Code 语言服务器与现代命令行效率工具。",
    capabilities: ["git-collaboration", "vscode-ai-pairing"],
    recommendedSoftware: [
      { id: "git", name: "Git", desc: "代码版本管理" },
      { id: "vscode", name: "Visual Studio Code", desc: "编辑器（支持 rust-analyzer）" },
      { id: "rustup", name: "Rustup & Cargo", desc: "Rust 官方工具链安装程序", wingetId: "Rustlang.Rustup" },
      { id: "windows-terminal", name: "Windows Terminal", desc: "现代化多标签终端", wingetId: "Microsoft.WindowsTerminal" },
    ],
    templates: [
      { id: "cargo-cli", title: "Rust CLI 工业级模板 (clap + anyhow)", desc: "内置参数解析、彩色输出、错误处理的生产级命令行工程", scaffoldCommand: "cargo new --bin my-cli-tool" },
      { id: "axum-web", title: "Axum Web API 微服务模板", desc: "Tokio 官方出品的高性能异步 Web 后端框架骨架", scaffoldCommand: "cargo new --bin my-axum-service" },
    ],
    repos: [
      { title: "rust-lang/rustlings", repoUrl: "https://github.com/rust-lang/rustlings", desc: "通过小练习交互式学习 Rust 语法的官方经典项目", stars: "53k", tech: "Rust" },
      { title: "clap-rs/clap", repoUrl: "https://github.com/clap-rs/clap", desc: "Rust 事实标准的高性能命令行参数解析库", stars: "15k", tech: "Rust" },
      { title: "tokio-rs/axum", repoUrl: "https://github.com/tokio-rs/axum", desc: "人体工学、模块化的异步 Web 应用程序框架", stars: "20k", tech: "Rust" },
    ],
    resources: [
      { id: "rust-book", title: "The Rust Programming Language (Rust 权威指南)", desc: "官方最具权威性的所有权与类型系统经典书籍", url: "https://doc.rust-lang.org/book/" },
      { id: "rust-by-example", title: "Rust By Example 实战实例", desc: "通过丰富的示例代码快速掌握 Rust 常用模式", url: "https://doc.rust-lang.org/rust-by-example/" },
    ],
  },
  {
    id: "desktop_app",
    name: "跨平台桌面应用 (Tauri)",
    tagline: "基于 Web 技术与 Rust 后端构建极致小巧、低内存占用的桌面客户端",
    description: "体验 Setup Center 同款架构体系。结合前端现代 UI（React / Vue / Svelte）与 Rust 原生底层能力，摆脱 Electron 的臃肿体积。",
    capabilities: ["node-development", "git-collaboration"],
    recommendedSoftware: [
      { id: "nodejs", name: "Node.js (LTS)", desc: "前端构建运行时" },
      { id: "git", name: "Git", desc: "版本管理" },
      { id: "vscode", name: "Visual Studio Code", desc: "开发编辑器" },
      { id: "rustup", name: "Rustup", desc: "Rust 编译器（构建 Tauri 底层）", wingetId: "Rustlang.Rustup" },
    ],
    templates: [
      { id: "tauri-react-ts", title: "Tauri v2 + React + TypeScript 模板", desc: "开箱即用的跨平台桌面客户端工程，支持 Windows/macOS/Linux", scaffoldCommand: "npm create tauri-app@latest" },
    ],
    repos: [
      { title: "tauri-apps/tauri", repoUrl: "https://github.com/tauri-apps/tauri", desc: "构建极小尺寸、安全、跨平台桌面与移动应用框架", stars: "85k", tech: "Rust / TypeScript" },
      { title: "Arukasaeled/setup-center", repoUrl: "https://github.com/Arukasaeled/setup-center", desc: "Setup Center 桌面客户端开源源码与体验系统", stars: "Local", tech: "Rust / React" },
    ],
    resources: [
      { id: "tauri-docs", title: "Tauri v2 官方文档", desc: "窗口生命周期、IPC 通信与打包发布指南", url: "https://v2.tauri.app" },
    ],
  },
  {
    id: "algorithm_research",
    name: "算法、模型与深度学习",
    tagline: "配置 Python 数据科学栈、Jupyter 与深度学习开发环境",
    description: "为机器学习实验、算法题解与模型推理准备完整工具链，包含虚拟环境隔离、数据处理与可视化支持。",
    capabilities: ["python-development", "local-model-inference", "git-collaboration"],
    recommendedSoftware: [
      { id: "python", name: "Python 3.11/3.12", desc: "数据分析主力解释器" },
      { id: "git", name: "Git", desc: "实验代码记录与版本控制" },
      { id: "vscode", name: "Visual Studio Code", desc: "配合 Jupyter 插件交互式运行" },
    ],
    templates: [
      { id: "datascience-starter", title: "Python 数据科学环境模板", desc: "预配置 uv/venv、NumPy、Pandas、Matplotlib 与 Jupyter Lab", scaffoldCommand: "uv venv && uv pip install numpy pandas matplotlib jupyterlab" },
    ],
    repos: [
      { title: "karpathy/micrograd", repoUrl: "https://github.com/karpathy/micrograd", desc: "Andrej Karpathy 编写的微型自动求导反向传播引擎", stars: "41k", tech: "Python" },
      { title: "huggingface/transformers", repoUrl: "https://github.com/huggingface/transformers", desc: "PyTorch 和 TensorFlow 顶流深度学习模型库", stars: "135k", tech: "Python" },
    ],
    resources: [
      { id: "d2l-ai", title: "动手学深度学习 (Dive into Deep Learning)", desc: "李沐老师团队编写的交互式深度学习必读经典", url: "https://zh.d2l.ai/" },
    ],
  },
  {
    id: "coursework",
    name: "计算机课程与系统编程",
    tagline: "完成 C/C++ 语言实验、数据结构、操作系统作业与机试准备",
    description: "配置 GCC/Clang 编译器环境、调试器、Git 与标准开发工具，专注于打牢底层计算机核心素养。",
    capabilities: ["cpp-learning", "python-development", "git-collaboration"],
    recommendedSoftware: [
      { id: "git", name: "Git", desc: "作业版本回滚与备份" },
      { id: "vscode", name: "Visual Studio Code", desc: "轻量配置 C/C++ 语法高亮与调试" },
      { id: "msys2", name: "MSYS2 (MinGW-w64 GCC)", desc: "Windows 下的 GCC/G++ 编译器环境", wingetId: "MSYS2.MSYS2" },
    ],
    templates: [
      { id: "cmake-cpp", title: "现代 CMake + C++ 实验工程", desc: "标准的结构化多源文件 CMake 项目脚手架，支持单元测试", scaffoldCommand: "git clone https://github.com/cpt-template/cmake-cpp-starter.git my-course-work" },
    ],
    repos: [
      { title: "TheAlgorithms/C-Plus-Plus", repoUrl: "https://github.com/TheAlgorithms/C-Plus-Plus", desc: "全部常用算法与数据结构的现代 C++ 实现合集", stars: "33k", tech: "C++" },
    ],
    resources: [
      { id: "learn-cpp", title: "LearnCpp.com 现代 C++ 教程", desc: "公认最循序渐进、最详尽的高质量 C++ 学习参考", url: "https://www.learncpp.com/" },
      { id: "csdiy", title: "CS 自学指南 (CS DIY)", desc: "国内外顶级名校计算机课程与实验攻略整理", url: "https://csdiy.wiki" },
    ],
  },
];

export function GoalModeScreen() {
  const [selectedTrackId, setSelectedTrackId] = useState<string>("ai_application");
  const [scaffoldTemplate, setScaffoldTemplate] = useState<{ title: string; defaultName: string; initialCommand: string } | null>(null);
  const [cloneRepo, setCloneRepo] = useState<{ title: string; repoUrl: string } | null>(null);
  const [detailItem, setDetailItem] = useState<DiscoveryItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const capabilities = useApp((s) => s.capabilities);
  const inventory = useApp((s) => s.inventory);
  const selectGoal = useApp((s) => s.selectGoal);
  const goTo = useApp((s) => s.goTo);

  const currentTrack = GOAL_TRACKS.find((t) => t.id === selectedTrackId) ?? GOAL_TRACKS[0];

  // Asynchronously hydrate live stars for repos of current track
  const [liveRepoStars, setLiveRepoStars] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    for (const repo of currentTrack.repos) {
      if (liveRepoStars[repo.repoUrl]) continue;
      fetchGitHubRepoDetails(repo.repoUrl)
        .then((real) => {
          if (cancelled) return;
          if (real?.origin?.stars !== undefined && real?.origin?.stars !== null) {
            setLiveRepoStars((prev) => ({ ...prev, [repo.repoUrl]: String(real.origin!.stars) }));
          } else {
            setLiveRepoStars((prev) => ({ ...prev, [repo.repoUrl]: "未获取" }));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLiveRepoStars((prev) => ({ ...prev, [repo.repoUrl]: "未获取" }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [currentTrack]);

  // Calculate readiness of current track
  const readiness = useMemo(() => {
    if (!capabilities || capabilities.length === 0) return { ready: 0, total: currentTrack.capabilities.length, pct: 0 };
    let readyCount = 0;
    for (const capId of currentTrack.capabilities) {
      const match = capabilities.find((c) => c.id === capId);
      if (match && match.status === "available") readyCount++;
    }
    const total = currentTrack.capabilities.length;
    const pct = total > 0 ? Math.round((readyCount / total) * 100) : 100;
    return { ready: readyCount, total, pct };
  }, [capabilities, currentTrack]);

  // Check which software is installed
  const installedSoftwareIds = useMemo(() => {
    if (!inventory || !inventory.items) return new Set<string>();
    return new Set(inventory.items.filter((i) => i.installed).map((i) => i.id));
  }, [inventory]);

  const handleStartSetup = () => {
    selectGoal(currentTrack.id);
    goTo("goal");
  };

  const handleCloneRepo = (repo: { title: string; repoUrl: string }) => {
    setCloneRepo(repo);
  };

  const handleScaffold = (tmpl: { title: string; scaffoldCommand: string }) => {
    setScaffoldTemplate({
      title: tmpl.title,
      defaultName: "my-project",
      initialCommand: tmpl.scaffoldCommand,
    });
  };

  const handleInspectRepo = (repo: { title: string; repoUrl: string; desc: string; tech: string; stars?: string }) => {
    const liveStar = liveRepoStars[repo.repoUrl];
    const item: DiscoveryItem = {
      id: `repo:${repo.title}`,
      title: repo.title,
      subtitle: repo.tech,
      description: repo.desc,
      type: "repo",
      category: "repository",
      origin: {
        type: "github",
        repository: repo.repoUrl,
        url: repo.repoUrl,
        stars: liveStar && liveStar !== "未获取" ? liveStar : undefined,
      },
      tags: [repo.tech],
    };
    setDetailItem(item);
    RecentTracker.record(
      {
        id: item.id,
        title: item.title,
        type: "repo",
        category: item.category,
        subtitle: item.subtitle,
      },
      item,
    );

    // Hydrate real GitHub metadata asynchronously
    fetchGitHubRepoDetails(repo.repoUrl).then((realDetails) => {
      if (realDetails) {
        setDetailItem((current) => {
          if (!current || current.id !== item.id) return current;
          const updated: DiscoveryItem = {
            ...current,
            origin: {
              type: "github",
              ...current.origin,
              ...realDetails.origin,
              repository: repo.repoUrl,
              url: repo.repoUrl,
            },
            health: realDetails.health,
          };
          PersonalCatalog.saveItem(updated);
          return updated;
        });
      }
    });
  };

  const handleBookmark = (
    title: string,
    e: React.MouseEvent,
    repoObj?: { title: string; repoUrl: string; desc: string; tech: string; stars?: string },
  ) => {
    e.stopPropagation();
    const id = repoObj ? `repo:${title}` : `goal:${title}`;
    const liveStar = repoObj ? liveRepoStars[repoObj.repoUrl] : undefined;
    const snapshot: DiscoveryItem = {
      id,
      title,
      subtitle: repoObj?.tech || currentTrack.name,
      description: repoObj?.desc || currentTrack.description,
      type: repoObj ? "repo" : "learning",
      category: repoObj ? "repository" : "roadmap",
      origin: repoObj
        ? {
            type: "github",
            repository: repoObj.repoUrl,
            url: repoObj.repoUrl,
            stars: liveStar && liveStar !== "未获取" ? liveStar : undefined,
          }
        : undefined,
      tags: repoObj ? [repoObj.tech] : ["goal", currentTrack.id],
    };
    Bookmarks.toggle(id, title, snapshot);
    setNotice(`已更新收藏：${title}`);
    setTimeout(() => setNotice(null), 2000);
  };

  return (
    <div className="space-y-7 pb-12 animate-fade-in">
      {/* Notice Banner */}
      {notice && (
        <div className="rounded-lg border border-blue-500/40 bg-blue-900/30 px-4 py-2 text-[12.5px] font-medium text-blue-200 animate-fade-in flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-blue-300 hover:text-white">✕</button>
        </div>
      )}

      {/* Screen Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[color:var(--line-subtle)] pb-5">
        <div>
          <div className="inline-flex items-center gap-2 rounded px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[color:var(--status-accent)] bg-[color:var(--surface-sunken)] mb-2">
            GOAL BLUEPRINT // 目标指引模式
          </div>
          <h1 className="text-[22px] font-bold text-[color:var(--text-strong)] tracking-[-0.02em]">
            按目标规划：从选方向到一键装配
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--text-tertiary)] max-w-2xl leading-relaxed">
            不再面对零散工具无从下手。选择你的技术路线，自动解析本机环境缺口，并获得精选脚手架、经典项目与权威学习文档。
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button size="sm" onClick={handleStartSetup}>
            启动该方向安装引导 →
          </Button>
        </div>
      </header>

      {/* Track Selector Pills */}
      <div className="flex flex-wrap gap-2">
        {GOAL_TRACKS.map((t) => {
          const active = t.id === selectedTrackId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedTrackId(t.id)}
              className={clsx(
                "rounded-xl px-4 py-2.5 text-left transition-all border",
                active
                  ? "border-[color:var(--status-accent)] bg-[color:var(--surface-active)] shadow-sm"
                  : "border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] hover:border-[color:var(--line-default)]"
              )}
            >
              <div className={clsx("text-[13.5px] font-semibold", active ? "text-[color:var(--text-strong)]" : "text-[color:var(--text-secondary)]")}>
                {t.name}
              </div>
              <div className="mt-0.5 text-[11px] text-[color:var(--text-quiet)] truncate max-w-[200px]">
                {t.tagline}
              </div>
            </button>
          );
        })}
      </div>

      {/* Track Detail Hero Card */}
      <div className="rounded-2xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-bold text-[color:var(--text-strong)]">
              {currentTrack.name}
            </h2>
            <p className="mt-1 text-[13px] text-[color:var(--text-secondary)] leading-relaxed max-w-3xl">
              {currentTrack.description}
            </p>
          </div>
          {/* Readiness Gauge */}
          <div className="shrink-0 flex items-center gap-3 bg-[color:var(--surface-panel)] border border-[color:var(--line-subtle)] rounded-xl px-4 py-2.5">
            <div className="text-right">
              <div className="text-[11px] text-[color:var(--text-quiet)] font-medium">本机环境就绪度</div>
              <div className="text-[16px] font-bold text-[color:var(--text-strong)] tnum">
                {readiness.pct}% <span className="text-[11.5px] text-[color:var(--text-tertiary)] font-normal">({readiness.ready}/{readiness.total} 项就绪)</span>
              </div>
            </div>
            <div className={clsx(
              "h-8 w-8 rounded-full flex items-center justify-center font-bold text-[12px]",
              readiness.pct === 100
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
            )}>
              {readiness.pct === 100 ? "✓" : "!"}
            </div>
          </div>
        </div>

        {/* Capabilities Breakdown */}
        <div className="pt-2 border-t border-[color:var(--line-subtle)]">
          <div className="text-[11.5px] font-medium text-[color:var(--text-quiet)] mb-2 uppercase tracking-wider">
            对应系统能力要求与诊断状态
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {currentTrack.capabilities.map((capId) => {
              const cap = capabilities.find((c) => c.id === capId);
              const isOk = cap?.status === "available";
              return (
                <div
                  key={capId}
                  className={clsx(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] border",
                    isOk
                      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
                      : "border-amber-500/20 bg-amber-500/5 text-amber-300"
                  )}
                >
                  <span className="shrink-0 font-bold">{isOk ? "✓" : "–"}</span>
                  <span className="font-medium truncate text-[color:var(--text-secondary)]">
                    {cap?.name ?? capId}
                  </span>
                  <span className="ml-auto text-[10.5px] opacity-75 shrink-0">
                    {isOk ? "已具备" : "待配置"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Three Pillars: Software, Templates, Repos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pillar 1: Essential Software */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-[color:var(--text-strong)] flex items-center gap-1.5">
              <span>核心推荐软件与工具</span>
              <span className="text-[11px] text-[color:var(--text-quiet)] font-normal">
                ({currentTrack.recommendedSoftware.length})
              </span>
            </h3>
          </div>
          <div className="space-y-2">
            {currentTrack.recommendedSoftware.map((sw) => {
              const installed = installedSoftwareIds.has(sw.id);
              return (
                <div
                  key={sw.id}
                  className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3 flex items-start justify-between gap-3 hover:border-[color:var(--line-default)] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">
                        {sw.name}
                      </span>
                      <span
                        className={clsx(
                          "rounded px-1.5 py-0.2 text-[10px] font-medium",
                          installed
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                            : "bg-[color:var(--surface-panel)] text-[color:var(--text-quiet)] border border-[color:var(--line-subtle)]"
                        )}
                      >
                        {installed ? "已安装" : "未检测到"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-[color:var(--text-tertiary)] leading-relaxed">
                      {sw.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pillar 2: Starter Templates & Scaffolds */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-[color:var(--text-strong)] flex items-center gap-1.5">
              <span>项目脚手架与模板</span>
              <span className="text-[11px] text-[color:var(--text-quiet)] font-normal">
                ({currentTrack.templates.length})
              </span>
            </h3>
          </div>
          <div className="space-y-2">
            {currentTrack.templates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3.5 space-y-2.5 hover:border-[color:var(--line-default)] transition-colors"
              >
                <div>
                  <div className="text-[13px] font-semibold text-[color:var(--text-primary)]">
                    {tmpl.title}
                  </div>
                  <p className="mt-1 text-[11.5px] text-[color:var(--text-tertiary)] leading-relaxed">
                    {tmpl.desc}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[color:var(--line-subtle)]">
                  <span className="font-mono text-[10.5px] text-[color:var(--text-quiet)] truncate max-w-[180px]">
                    {tmpl.scaffoldCommand}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleScaffold(tmpl)}
                    className="text-[11.5px] shrink-0"
                  >
                    一键创建项目
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pillar 3: Curated Repos & Resources */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-[color:var(--text-strong)] flex items-center gap-1.5">
              <span>标杆 GitHub 仓库</span>
              <span className="text-[11px] text-[color:var(--text-quiet)] font-normal">
                ({currentTrack.repos.length})
              </span>
            </h3>
          </div>
          <div className="space-y-2">
            {currentTrack.repos.map((repo) => (
              <div
                key={repo.title}
                onClick={() => handleInspectRepo(repo)}
                className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3 space-y-2 hover:border-[color:var(--line-default)] cursor-pointer transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono text-[12.5px] font-semibold text-[color:var(--text-primary)] hover:underline truncate">
                    {repo.title}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="rounded bg-[color:var(--surface-panel)] border border-[color:var(--line-subtle)] px-1.5 py-0.5 text-[10px] font-mono text-[color:var(--text-tertiary)]">
                      ★ {liveRepoStars[repo.repoUrl] || "获取中…"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleBookmark(repo.title, e, repo)}
                      className="p-1 text-[color:var(--text-quiet)] hover:text-amber-400 transition-colors"
                      title="收藏"
                    >
                      ★
                    </button>
                  </div>
                </div>
                <p className="text-[11.5px] text-[color:var(--text-tertiary)] line-clamp-2 leading-relaxed">
                  {repo.desc}
                </p>
                <div className="flex items-center justify-between pt-1">
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-[color:var(--surface-panel)] text-[color:var(--text-secondary)]">
                    {repo.tech}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloneRepo(repo);
                    }}
                    className="text-[11px] font-medium text-[color:var(--status-accent)] hover:underline"
                  >
                    克隆到本地 →
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Reference Docs */}
          <div className="pt-2">
            <div className="text-[12px] font-semibold text-[color:var(--text-secondary)] mb-2">
              权威参考与学习文档
            </div>
            <div className="space-y-1.5">
              {currentTrack.resources.map((res) => (
                <a
                  key={res.id}
                  href={res.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] px-3 py-2 text-[12px] hover:bg-[color:var(--surface-hover)] transition-colors group"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-medium text-[color:var(--text-primary)] group-hover:text-[color:var(--status-accent)] truncate">
                      {res.title}
                    </div>
                    <div className="text-[11px] text-[color:var(--text-quiet)] truncate">
                      {res.desc}
                    </div>
                  </div>
                  <span className="text-[color:var(--text-quiet)] text-[11px] shrink-0 font-mono">
                    ↗
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {scaffoldTemplate && (
        <ScaffoldModal
          isOpen={true}
          templateTitle={scaffoldTemplate.title}
          defaultProjectName={scaffoldTemplate.defaultName}
          initialCommand={scaffoldTemplate.initialCommand}
          onClose={() => setScaffoldTemplate(null)}
        />
      )}

      {cloneRepo && (
        <CloneRepoModal
          isOpen={true}
          repoUrl={cloneRepo.repoUrl}
          repoTitle={cloneRepo.title}
          onClose={() => setCloneRepo(null)}
        />
      )}

      {detailItem && (
        <RepoDetailModal
          isOpen={true}
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onClone={() => {
            const r = { title: detailItem.title, repoUrl: detailItem.origin?.repository || "" };
            setDetailItem(null);
            setCloneRepo(r);
          }}
        />
      )}
    </div>
  );
}
