# Setup Center — Project Map

```
Setup Center
│
├── src/
│   ├── core/           # 核心领域模型：环境检测、安装执行器与远程内容边界
│   │   ├── environment/ # 系统硬件侦测与学生目标能力计算
│   │   ├── installer/   # 安装方案调度、执行会话与验证结果契约
│   │   └── content/     # 远程内容清单（Remote Manifest）同步边界
│   │
│   ├── app/            # 应用级装配：Zustand 状态机、屏路由与冷启动控制
│   │
│   ├── ui/             # 跨风格共享的基础通用 UI 原语与无障碍组件
│   │
│   ├── styles/         # 视觉风格系统：统一契约、自动发现与 12 套真实风格实现
│   │   ├── types.ts     # SetupStyle 统一契约
│   │   ├── registry.ts  # 风格注册中心（Vite import.meta.glob 自动发现）
│   │   ├── default/     # 默认工业级中性风格
│   │   ├── phantom-comic/# 旗舰参考实现：P5 × 美漫彩漫高风格化视觉
│   │   └── [10+ styles]/# 瑞士排版、包豪斯、粗野主义、空间毛玻璃、终端CRT、蓝图等
│   │
│   └── content/        # 统一内容目录（软件、风格、资源、模板、技能、路径）
│       ├── types.ts     # ContentItem 契约
│       ├── registry.ts  # ContentRegistry 查询中心（多适配器统一入口）
│       └── resources/   # 10 分类高质量开发与设计资源库（80+ 真实条目）
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

### 2. Style Resolution Flow
```
User Selection / Storage
       ↓
StyleRegistry (styles/registry.ts)
       ↓
document.documentElement[data-style]
       ↓
CSS Design Tokens & Component Overrides (styles/phantom-comic/...)
```

### 3. Modular Content Flow (Local & Future Remote)
```
Local Registry / Future Remote Manifest
       ↓
ContentRegistry (content/registry.ts)
       ↓
Application Catalog & Recommendations
```
