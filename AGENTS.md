# Setup Center Agent Guide

## Project Purpose
Setup Center 不再只是一个 Windows 开发软件安装器，而是面向开发者与初学者的 **Creative & Development Bootstrap Hub**。
不仅负责机器环境初始化（Setup Computer），更沉淀并交付构建一切所需的开发工具、视觉风格、开发资源、工程模板与技能指南（Setup Everything Needed to Build）。

## Architecture Map
- `src/core/`      → 核心业务领域能力（环境检测、安装器状态、内容分发边界），与 UI 解耦。
- `src/app/`       → 应用级组织、生命周期、全局状态机与屏流转。
- `src/ui/`        → 通用、跨风格复用的 UI 原语与基础控件（Button、TitleBar、SoftwareRow 等）。
- `src/styles/`    → Style System 视觉语言契约、设计令牌、风格注册表及具体风格实现。
- `src/content/`   → Content Registry 统一内容元数据目录（Software、Style、Resource、Template 等）。

## Dependency Direction
```
styles/   ──> ui/ (提供外观覆盖与 tokens)
app/      ──> core/ + ui/ + styles/ + content/ (顶层组装与调度)
ui/       ──x styles/ (基础 UI 原语绝不硬编码依赖特定 style)
styles/   ──x core/installer/ (视觉层绝不直接侵入安装器底层逻辑)
```

## Task Routing
| 任务类型 | 首先阅读 |
| :--- | :--- |
| **增加 / 修改视觉风格（Style）** | [`src/styles/README.md`](file:///D:/AI-Vault/DeepSeek/ai-student-setup/src/styles/README.md) |
| **增加 / 收录新软件** | [`src/content/software/README.md`](file:///D:/AI-Vault/DeepSeek/ai-student-setup/src/content/software/README.md) |
| **修改环境检测与硬件侦测** | [`src/core/environment/README.md`](file:///D:/AI-Vault/DeepSeek/ai-student-setup/src/core/environment/README.md) |
| **修改安装调度与方案构建** | [`src/core/installer/README.md`](file:///D:/AI-Vault/DeepSeek/ai-student-setup/src/core/installer/README.md) |
| **增加资源库 / 模板** | [`src/content/resources/README.md`](file:///D:/AI-Vault/DeepSeek/ai-student-setup/src/content/resources/README.md) |
| **修改通用基础 UI 组件** | [`src/ui/README.md`](file:///D:/AI-Vault/DeepSeek/ai-student-setup/src/ui/README.md) |
| **修改全局流程与页面结构** | [`src/app/README.md`](file:///D:/AI-Vault/DeepSeek/ai-student-setup/src/app/README.md) |

## Golden Rules
1. **不要为了理解局部任务读取整个仓库**：优先阅读上述路由表中对应模块的 `README.md`。
2. **Style 层绝不允许包含业务逻辑**：风格只管配色、轮廓、字阶、几何硬阴影与装饰；安装与检测逻辑必须留在 `core/` 或后端 Rust。
3. **内容扩展优先通过 Registry**：新增风格通过 `src/styles/registry.ts`，新增内容通过 `src/content/registry.ts`。
4. **禁止在业务页面中散落 `if (style === "...")`**：页面只渲染语义化类与无障碍属性（如 `data-software-row`, `role="tab"`），由 Style CSS 声明式应用规则。
5. **严守已验证契约**：保持所有测试套件（`tools/ui-verify.mjs` 等）100% 绿色。

## Common Extension Recipes
- **新增 Style**：
  1. 在 `src/styles/<style-id>/` 创建 `manifest.ts`（实现 `SetupStyle` 接口）及 `<style-id>.css`。
  2. 在 `src/styles.css` 中引入该 CSS 文件。
  3. 在 `src/styles/registry.ts` 中注册对象。无需修改任何业务页面！
- **新增 Software**：
  1. 后端添加 `src-tauri/knowledge/software/<id>.yaml` 与官方图标 `src/assets/software/<id>.png`。
  2. 前端 `src/lib/softwareMeta.ts` 补充分类与名称映射。
- **新增 Resource**：
  1. 按照 `ContentItem`（`type: "resource"`）格式注册到 `ContentRegistry`。
