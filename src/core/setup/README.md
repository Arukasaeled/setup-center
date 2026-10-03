# Universal Setup Action Runtime (`src/core/setup/`)

## 核心理念：Nothing in Setup Center should be dead content.

在 Setup Center 中，任何卡片与条目都不再仅仅作为“只读展示”，而是必须具备一个或多个清晰的 **Setup Action**（可执行迁移动作）。

## 架构组成
- [`types.ts`](types.ts)：定义 `SetupActionType`（install / download / command / copy / open / clone / scaffold / apply / import / reveal）、`SetupAction` 协议、`PackageManager` 枚举与 `SetupCollection` 接口。
- [`resolver.ts`](resolver.ts)：`SetupActionResolver` 将任意 `ContentItem`（无论来源是内置、Vault 还是自定义条目）结合宿主机器环境（Node / Rust / Python / Git 等）动态解析为可操作的主动作（Primary Action）、次要动作与前置依赖提示。
- [`executor.ts`](executor.ts)：统一派发执行动作（剪贴板复制、外部浏览器打开、下载队列接入、脚手架创建、风格一键应用），并将每次流转操作严格记录入 `TransferHistory`。
- [`collections.ts`](collections.ts)：预设精心编排的 5 套开发者 Starter Packs（计算机大一通识套件、AI 智能体开发套件、前端与创意设计套件、Rust+TS 全栈套件、学术科研套件）。
- [`search.ts`](search.ts)：跨品类（软件、风格、资源、模板、学习、集合）多维度模糊检索与权重打分引擎，赋能全局指令调色板（Command Palette）。

## 交互原语
- [`src/components/SetupActionButton.tsx`](../../components/SetupActionButton.tsx)：统一交互按钮，支持包管理器无缝切换（pnpm / npm / yarn / bun / cargo / uv）、前置缺失依赖友好提示与操作微反馈。
- [`src/components/CommandPalette.tsx`](../../components/CommandPalette.tsx)：快捷键 `Ctrl + K` 呼出，纯键盘驱动检索与直达执行。
