# Core Subsystems

# Responsibility
包含 Setup Center 与具体 UI 风格、视图展现解耦的底层核心领域能力抽象：环境诊断（`environment/`）、安装调度（`installer/`）及内容分发边界（`content/`）。

# Owns
- 系统能力、硬件事实与环境检测核心数据结构。
- 安装方案、步骤序列、执行会话与验证结果契约。
- 远程内容分发与更新边界定义。

# Does NOT Own
- 任何 React 组件、HTML 渲染或 CSS 样式（属于 `ui/`、`styles/`、`screens/`）。

# Public Entry Points
- `src/core/environment/index.ts`
- `src/core/installer/index.ts`
- `src/core/content/index.ts`
- `src/core/index.ts`

# Allowed Dependencies
- `src/lib/types.ts`
- `src/lib/ipc.ts`

# Forbidden Dependencies
- 禁止引用 `src/styles/`、`src/components/` 或 React 视图层实现。
