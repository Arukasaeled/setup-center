# Setup Center Agent Guide

## Project Purpose
Setup Center 不再只是一个 Windows 开发软件安装器，而是面向开发者与初学者的 **Creative & Development Bootstrap Hub**。
不仅负责机器环境初始化（Setup Computer），更沉淀并交付构建一切所需的开发工具、视觉风格、开发资源、工程模板与技能指南（Setup Everything Needed to Build）。

## Architecture Map
- `src/core/setup/`    → Universal Setup Action 契约、环境感知解析器、执行引擎与 Starter Packs。
- `src/core/vault/`    → Setup Vault 远程内容更新、离线缓存与版本仲裁引擎。
- `src/core/transfer/` → Transfer 流转管线（Inbox、Downloader、Scaffolder、Bookmarks、History）。
- `src/core/`          → 核心业务领域能力（环境检测、安装器状态、内容分发边界），与 UI 解耦。
- `src/app/`           → 应用级组织、生命周期、全局状态机与屏流转。
- `src/ui/`            → 通用、跨风格复用的 UI 原语与基础控件（Button、TitleBar、SoftwareRow 等）。
- `src/styles/`        → Experience System：令牌契约 + 版式语法（shell/nav/detail/card/composition）+ 运行时 + 注册表（20套体验）。
- `src/content/`       → Content Registry 统一内容元数据目录（Software、Style、Resource、Template 等）。

## Dependency Direction
```
setup-center-vault (远程独立仓库)
        │ (增量 Manifest / JSON / CSS)
        ▼
core/vault/ ──> core/transfer/ ──> core/setup/ ──> content/ + styles/
styles/     ──> ui/ (提供外观覆盖与 tokens)
app/        ──> core/ + ui/ + styles/ + content/ (顶层组装与调度)
ui/         ──x styles/ (基础 UI 原语绝不硬编码依赖特定 style)
styles/     ──x core/installer/ (视觉层绝不直接侵入安装器底层逻辑)
```

## Task Routing
| 任务类型 | 首先阅读 |
| :--- | :--- |
| **通用可执行动作与环境感知（Setup Action）** | [`src/core/setup/types.ts`](src/core/setup/types.ts) |
| **全局指令调色板（Command Palette）** | [`src/components/CommandPalette.tsx`](src/components/CommandPalette.tsx) |
| **流转外部资源 / 网址入库（Transfer）** | [`TRANSFER.md`](TRANSFER.md) |
| **远程 Vault 架构与内容同步** | [`src/core/vault/types.ts`](src/core/vault/types.ts) |
| **版本控制与双通道更新门禁** | [`src/core/vault/release.ts`](src/core/vault/release.ts) |
| **统一跨品类详情弹层（DetailShell）** | [`src/components/DetailShell.tsx`](src/components/DetailShell.tsx) |
| **增加 / 修改视觉体验（Experience）** | [`src/styles/README.md`](src/styles/README.md) |
| **修改令牌覆盖层 / 体验运行时** | [`src/styles/runtime.ts`](src/styles/runtime.ts) |
| **修改版式语法（Shell / Nav / Detail / Card / Composition）** | [`src/styles/shell.css`](src/styles/shell.css) |
| **增加 / 浏览开发资源（Resource）** | [`src/content/resources/README.md`](src/content/resources/README.md) |
| **增加 / 收录新软件** | [`src/content/software/README.md`](src/content/software/README.md) |
| **修改环境检测与硬件侦测** | [`src/core/environment/README.md`](src/core/environment/README.md) |
| **修改安装调度与方案构建** | [`src/core/installer/README.md`](src/core/installer/README.md) |
| **修改通用基础 UI 组件** | [`src/ui/README.md`](src/ui/README.md) |
| **修改全局流程与页面结构** | [`src/app/README.md`](src/app/README.md) |

## Golden Rules
1. **不要为了理解局部任务读取整个仓库**：优先阅读上述路由表中对应模块的 `README.md`。
2. **Style 层绝不允许包含业务逻辑**：体验只管令牌、版式语法、轮廓、字阶与装饰；安装与检测逻辑必须留在 `core/` 或后端 Rust。
3. **内容扩展优先通过 Registry 与数据驱动**：体验通过目录契约自动发现，资源通过 `content/resources/` 数据条目注册。
4. **禁止在业务页面中散落 `if (style === "...")`**：页面只渲染语义化类与无障碍属性（如 `data-software-row`, `data-resource-card`, `role="tab"`），由版式语法与体验样式表声明式应用规则。
5. **令牌覆盖层是唯一的权威**：Style CSS 不得以 `!important #xxxxxx` / `!important 18px` 绕过用户覆盖；基础几何、基础颜色、基础阴影必须读取 `var(--...)`。
6. **版式语法只能改变呈现，不能移除入口**：任何 shell / nav / detail 语法都必须保留全部九个分区入口与无障碍可达性。
7. **严守已验证契约与诚实边界**：保持所有验证套件与构建 100% 绿色；测试覆盖验证符合已知契约规范，绝不在注释或文档中声称任何本地机制具备「数学绝对安全」或「零漏洞保证」；未完成验证的状态如实呈现为 unknown / unverified，物理落盘与非零退出码是最终状态的权威依据。
8. **纵深防御与受控限域**：所有文件路径、外部输入、模板参数替换、远程资产下载及 CSS 挂载必须执行白名单边界校验与严格限域，绝不依赖客户端单点不可逆假设。

## Common Extension Recipes
- **新增 Style / Experience（零修改已有文件）**：
  1. 在 `src/styles/<style-id>/` 创建 `manifest.ts`（实现 `SetupStyle`，并声明 `experience` 版式语法）及 `<style-id>.css`。
  2. 完成！Vite `import.meta.glob` 自动发现并引入样式与清单，无需修改 `styles.css`，无需修改 `registry.ts`，无需修改任何已有业务页面。
  3. 若 `experience` 的语法枚举已经表达出你想要的形态，则**完全不需要写 CSS**；只有在需要该体验专有的装饰时才添加样式表，并让基础几何/颜色/阴影读取 `var(--...)`。
- **新增 Resource（仅修改数据）**：
  1. 在 `src/content/resources/categories/<category>.ts` 中新增一个 `ResourceItem` 元素（支持 actionType: github / external / download）。
  2. 完成！Resource Center 自动渲染、支持分类标签检索，并由 ContentRegistry 统一纳管。
- **新增 Software**：
  1. 后端添加 `src-tauri/knowledge/software/<id>.yaml` 与官方图标 `src/assets/software/<id>.png`。
  2. 前端 `src/lib/softwareMeta.ts` 补充分类与名称映射。
