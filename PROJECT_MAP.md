# Setup Center — Project Map

```
Setup Center
│
├── src/
│   ├── core/           # 核心领域模型：环境检测、安装执行器与远程内容边界
│   │   ├── vault/       # Setup Vault 远程内容更新、版本仲裁与本地离线缓存
│   │   ├── transfer/    # Transfer 协议实现（Inbox、Downloader、Scaffolder、Bookmarks、History）
│   │   ├── environment/ # 系统硬件侦测与学生目标能力计算
│   │   └── installer/   # 安装方案调度、执行会话与验证结果契约
│   │
│   ├── app/            # 应用级装配：Zustand 状态机、屏路由与冷启动控制
│   │
│   ├── ui/             # 跨风格共享的基础通用 UI 原语与无障碍组件
│   │
│   ├── styles/         # Experience System：令牌契约 + 版式语法 + 自动发现（20 套实现）
│   │   ├── types.ts     # SetupStyle 令牌契约 + ExperienceProfile 版式语法契约
│   │   ├── runtime.ts   # 运行时：解析令牌 → 应用覆盖 → 计算变量与语法属性
│   │   ├── shell.css    # 所有版式语法的实现（shell/nav/detail/card/composition…）
│   │   ├── registry.ts  # 风格注册中心（Vite import.meta.glob 自动发现 + Vault 动态注册）
│   │   ├── default/     # 默认工业级中性风格
│   │   ├── phantom-comic/# 旗舰参考实现：海报式构图 + 硬阴影语言
│   │   └── [其余 18 套]/ # 瑞士排版、包豪斯、粗野主义、空间层级、终端CRT、蓝图、DOS、Retro Mac 等
│   │
│   └── content/        # 统一内容目录（软件、风格、资源、模板、技能、路径）
│       ├── types.ts     # ContentItem 契约
│       ├── registry.ts  # ContentRegistry 查询中心（多适配器统一入口）
│       └── resources/   # 10 分类高质量开发与设计资源库（386 条真实条目，glob 自动发现）
│
└── src-tauri/          # 跨平台宿主与高性能核心引擎（Rust）
    ├── src/             # Tauri 命令派发、本地授权加密与执行沙箱
    └── knowledge/       # 软件说明知识库与系统环境概念
```

## Major Data Flows

### 1. Detection & Evaluation Flow
```
Hardware & PATH Probes (Rust)
       ↓
MachineFacts & Inventory (core/environment)
       ↓
Zustand Store (app/state)
       ↓
UI Screens & Primitives (ui/)
       ↓
Active Style Dressing (styles/)
```

### 2. Experience Resolution & Token Override Flow
```
Style Manifest Default (styles/<id>/manifest.ts)
       ↓
Resolved Style Tokens          （manifest 默认值 + 语法派生值）
       ↓
Custom Token Overrides         （用户覆盖，按 style id 分别持久化）
       ↓
Computed Runtime Variables     （--radius-panel / --shadow-hard / --status-accent …）
       ↓
document.documentElement 上的 data-style / data-shell / data-nav /
data-detail / data-card / data-composition / data-density / data-motion
       ↓
Declarative Grammar Rules (styles/shell.css) + Per-style Stylesheets
```

用户覆盖永远优先。Style CSS 不得以 `!important #xxxxxx` / `!important 18px` 绕过这一层。

### 3. Transfer & Vault Update Flow
```
External Link / Repo / Idea
       ↓
Transfer Inbox (core/transfer/inbox.ts)
       ↓
Normalization (Agent / User) -> Setup Vault (Remote Git Repo)
       ↓
Runtime Vault Sync (core/vault/sync.ts)
       ↓
Offline Cache (localStorage) + Dynamic ContentRegistry + Dynamic Style Injection
       ↓
User Bookmarks / Direct Asset Download / Template Scaffolding
```
