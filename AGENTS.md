# Setup Center Agent Guide

## Project Purpose
Setup Center 不再只是一个 Windows 开发软件安装器，而是面向开发者与初学者的 **Creative & Development Bootstrap Hub**。
不仅负责机器环境初始化（Setup Computer），更沉淀并交付构建一切所需的开发工具、视觉风格、开发资源、工程模板与技能指南（Setup Everything Needed to Build）。

## Architecture Map
- `src/core/vault/`    → Setup Vault 远程内容更新、离线缓存与版本仲裁引擎。
- `src/core/transfer/` → Transfer 流转管线（Inbox、Downloader、Scaffolder、Bookmarks、History）。
- `src/core/`          → 核心业务领域能力（环境检测、安装器状态、内容分发边界），与 UI 解耦。
- `src/app/`           → 应用级组织、生命周期、全局状态机与屏流转。
- `src/ui/`            → 通用、跨风格复用的 UI 原语与基础控件（Button、TitleBar、SoftwareRow 等）。
- `src/styles/`        → Style System 视觉语言契约、设计令牌、风格注册表及具体风格实现。
- `src/content/`       → Content Registry 统一内容元数据目录（Software、Style、Resource、Template 等）。

## Dependency Direction
```
setup-center-vault (远程独立仓库)
        │ (增量 Manifest / JSON / CSS)
        ▼
core/vault/ ──> core/transfer/ ──> content/ + styles/
styles/     ──> ui/ (提供外观覆盖与 tokens)
app/        ──> core/ + ui/ + styles/ + content/ (顶层组装与调度)
ui/         ──x styles/ (基础 UI 原语绝不硬编码依赖特定 style)
styles/     ──x core/installer/ (视觉层绝不直接侵入安装器底层逻辑)
```

## Task Routing
| 任务类型 | 首先阅读 |
| :--- | :--- |
| **流转外部资源 / 网址入库（Transfer）** | [`TRANSFER.md`](TRANSFER.md) |
| **远程 Vault 架构与内容同步** | [`src/core/vault/types.ts`](src/core/vault/types.ts) |
| **版本控制与双通道更新门禁** | [`src/core/vault/release.ts`](src/core/vault/release.ts) |
| **统一跨品类详情弹层（DetailShell）** | [`src/components/DetailShell.tsx`](src/components/DetailShell.tsx) |
| **增加 / 修改视觉风格（Style）** | [`src/styles/README.md`](src/styles/README.md) |
| **增加 / 浏览开发资源（Resource）** | [`src/content/resources/README.md`](src/content/resources/README.md) |
| **增加 / 收录新软件** | [`src/content/software/README.md`](src/content/software/README.md) |
| **修改环境检测与硬件侦测** | [`src/core/environment/README.md`](src/core/environment/README.md) |
| **修改安装调度与方案构建** | [`src/core/installer/README.md`](src/core/installer/README.md) |
| **修改通用基础 UI 组件** | [`src/ui/README.md`](src/ui/README.md) |
| **修改全局流程与页面结构** | [`src/app/README.md`](src/app/README.md) |

## Golden Rules
1. **不要为了理解局部任务读取整个仓库**：优先阅读上述路由表中对应模块的 `README.md`。
2. **Style 层绝不允许包含业务逻辑**：风格只管配色、轮廓、字阶、几何硬阴影与装饰；安装与检测逻辑必须留在 `core/` 或后端 Rust。
3. **内容扩展优先通过 Registry 与数据驱动**：风格通过目录契约自动发现，资源通过 `content/resources/` 数据条目注册。
4. **禁止在业务页面中散落 `if (style === "...")`**：页面只渲染语义化类与无障碍属性（如 `data-software-row`, `data-resource-card`, `role="tab"`），由 Style CSS 声明式应用规则。
5. **严守已验证契约**：保持所有验证套件与构建 100% 绿色。

## Common Extension Recipes
- **新增 Style（零修改已有文件）**：
  1. 在 `src/styles/<style-id>/` 创建 `manifest.ts`（实现 `SetupStyle` 接口）及 `<style-id>.css`。
  2. 完成！Vite `import.meta.glob` 自动发现并引入样式与清单，无需修改 `styles.css`，无需修改 `registry.ts`，无需修改任何已有业务页面。
- **新增 Resource（仅修改数据）**：
  1. 在 `src/content/resources/categories/<category>.ts` 中新增一个 `ResourceItem` 元素（支持 actionType: github / external / download）。
  2. 完成！Resource Center 自动渲染、支持分类标签检索，并由 ContentRegistry 统一纳管。
- **新增 Software**：
  1. 后端添加 `src-tauri/knowledge/software/<id>.yaml` 与官方图标 `src/assets/software/<id>.png`。
  2. 前端 `src/lib/softwareMeta.ts` 补充分类与名称映射。
