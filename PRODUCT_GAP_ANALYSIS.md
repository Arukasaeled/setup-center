# Setup Center — Product Reality & Vision Gap Analysis

> **审计性质**：只读产品与架构现实审计（Read-Only Reality Audit）  
> **基准文档**：[`SETUP_CENTER_PRODUCT_VISION.md`](./SETUP_CENTER_PRODUCT_VISION.md)  
> **审计时间**：2026-10-04  
> **审计执行**：Antigravity Agent  
> **原则声明**：不修改代码、不修补 Bug、不新增功能、不提交 Commit、不推送 Push。仅以真实代码为准。

---

## 1. 当前产品模型（Current Product Model）

基于仓库源码真实的目录、数据流与状态机，Setup Center 目前并非一个纯粹的软件，而是一个**经历了数个迭代阶段叠加而成的混合体（Hybrid Composite）**。

### 1.1 真实源码关系拓扑

```
Setup Center Runtime
├── 顶层外壳 (App.tsx)
│   ├── TitleBar (窗口控件、版本徽标、开源链接)
│   ├── CommandPalette (全局 Ctrl+K 动作面板)
│   ├── ProgressRail (仅在 Wizard 模式下渲染的 8 步进度指示条)
│   └── 两种对立的顶层状态 (Two Surfaces):
│       ├── Wizard Surface (首次设置向导流，线性阶段)
│       │   ├── WelcomeScreen (欢迎)
│       │   ├── GoalScreen (方向选择)
│       │   ├── DetectScreen (硬件/环境探测)
│       │   ├── SoftwareScreen (已装软件清单)
│       │   ├── ChooseScreen (安装方案决策)
│       │   ├── InstallScreen (批处理安装会话)
│       │   ├── BootstrapScreen (开发环境初始化配置)
│       │   └── DoneScreen (完成结算)
│       └── Dashboard Surface (非线性主工作台，自由导航)
│           ├── DashboardNav (188px 侧边栏，支持 12 个功能分区)
│           └── Master Content / Detail Pane
│               ├── [overview] 开发起步 (系统概要、快捷动作、状态卡片)
│               ├── [goals] 目标向导 (按目标规划技术栈)
│               ├── [software] 软件清单 (本地清单 + Winget 检索)
│               ├── [repos] GitHub 项目 (GitHub 仓库检索、克隆、对比)
│               ├── [resources] 开发资源 (10 大分类、386 条静态资源条目)
│               ├── [library] 我的库 (本地收藏、最近历史、个人包)
│               ├── [style] 视觉风格 / 视觉实验室 (20-30 套体验矩阵)
│               ├── [config] 环境配置 (Git 身份、PATH、镜像代理)
│               ├── [history] 历史记录 (Transfer 动作时间线)
│               ├── [plugins] 插件增强 (Claude 提示词与工具)
│               ├── [license] 版本与更新 (版本检测、激活状态、开源协议)
│               └── [about] 关于 Setup Center
│
├── 核心业务层 (src/core/)
│   ├── environment/   → 硬件侦测 (CPU/GPU/RAM/Disk)、PATH 探测、Capability 判定 (Rust IPC)
│   ├── installer/     → 方案构建、批处理依赖树、安装执行器 (Winget/Direct)
│   ├── vault/         → Setup Vault 远端内容更新、缓存、版本仲裁 (Client + Cache + Sync)
│   ├── transfer/      → 流转协议管线 (Inbox、Downloader、Scaffolder、Bookmarks、History)
│   └── discovery/     → 本地搜索索引 (LocalSearchIndex)、Winget 搜索、GitHub API
│
├── 视觉体验系统 (src/styles/)
│   ├── registry.ts    → Vite import.meta.glob 自动发现 built-in 风格 + 内存 STYLE_REGISTRY
│   ├── runtime.ts     → 令牌解析 (resolveTokens)、覆盖层应用 (applyExperience)、CSS 变量注入
│   ├── shell.css      → 版式语法声明 (shell/nav/detail/card/composition)
│   └── [style-id]/    → 各风格独立的 manifest.ts 与 <style-id>.css
│
└── 统一内容目录 (src/content/)
    ├── registry.ts    → ContentRegistry 单例
    ├── types.ts       → ContentItem ("software" | "style" | "resource" | "template" | ...)
    └── resources/     → 10 个静态分类文件 (frontend, components, animation, fonts...)
```

### 1.2 四重身份的真实地位分析

当前 Setup Center 到底更像什么？

| 角色属性 | 真实源码占比与地位 | 判定与依据 |
| :--- | :--- | :--- |
| **Installer**<br>(安装器) | **历史底层包袱（Legacy Foundation）**<br>代码量约占全仓 40%。Rust 后端 (`src-tauri/`) 绝大部分代码服务于硬件检测、软件知识库、Winget 安装、环境变量配置。前端依然保留完整的 8 步向导 (`Wizard`) 与安装状态机。 | **仍处于骨架底层**。虽然在交互上被降级为 Dashboard 的一个分区和后备入口，但在系统调用与进程权限上仍是最重的部分。 |
| **Resource Hub**<br>(资源中心) | **静态内容骨架（Static Directory）**<br>包含了 386 条经过人工规整的高质量静态资源 (`src/content/resources/categories/*.ts`)，以及 GitHub 仓库搜索与 Winget 在线检索。 | **高度成型但偏静态**。内容丰富，支持分类和筛选，但本质上是静态导航页，缺乏双向流转与深度的项目绑定。 |
| **Design Lab**<br>(视觉实验室) | **最活跃但分叉严重的展示层（Visual Showcase）**<br>拥有 20 套完整 built-in 体验系统，以及在分支中激增的 10 套预设 / 8 套旗舰体验。具备体验画廊、标本预览、Token 调校器。 | **视觉最突出，但缺乏实体化资产**。它展示了 Setup Center 自身如何变漂亮，但无法将这些视觉设计真正打包导出为用户自身项目的完整交付物。 |
| **Workbench**<br>(创作工作台) | **残缺的概念雏形（Incomplete Prototype）**<br>`TRANSFER.md` 提出了「Discover → Collect → Normalize → Store → Distribute → Instantiate」的愿景；代码中存在 Transfer Inbox、History、ScaffoldModal。 | **严重欠缺核心工具链**。缺少 UI 零部件库（UI Parts）、缺少 Fork/Variant 版本谱系、缺少 Design Spec / Agent Spec 真实导出包。 |

**结论**：当前 Setup Center 是一个**「从 Windows 环境安装器长出来、被静态设计资源塞满、正在激进探索视觉样式系统、但尚未完成向个人创作工作台蜕变的半成品」**。

---

## 2. 愿景差距矩阵（Gap Analysis Matrix）

对照 [`SETUP_CENTER_PRODUCT_VISION.md`](./SETUP_CENTER_PRODUCT_VISION.md) 中定义的 19 项关键能力进行逐项核验：

| 标识 | 愿景主要能力 | 现状评估 | 真实代码 / 模块依据 | 差距细节与诊断 |
| :--- | :--- | :--- | :--- | :--- |
| **A** | **UI Visual Parts Library**<br>(UI 视觉零部件库) | <mark>**MISSING**</mark> | 全仓搜索 `parts` 无相关实体。<br>仅有 `ResourceItem` 与 `ContentItem`。 | 没有任何用于收集截图、网址、临时笔记、渐进式丰富（CSS/React/Tokens/原理）的零部件数据结构与页面。 |
| **B** | **Visual Presets as complete systems**<br>(完整视觉系统预设) | <mark>**PARTIAL**</mark> | `src/styles/types.ts`<br>`src/styles/runtime.ts` | 实现了版式语法枚举 (`shell`, `nav`, `detail`, `card`, `composition`) 和 CSS 样式。但缺少完整的跨产品规范说明、适用场景约束、资产绑定与可移植规格。 |
| **C** | **Setup Center Benchmark**<br>(应用本体作为标准标杆) | <mark>**READY**</mark> | `src/styles/runtime.ts` (`applyExperience`)<br>`src/screens/Dashboard.tsx` | 风格系统直接作用于 Setup Center 全局真实 DOM 节点（导航、列表、卡片、模态框、按钮），标杆即时渲染体验非常完整。 |
| **D** | **Purposeless browsing**<br>(无目的浏览设计) | <mark>**PARTIAL**</mark> | `src/screens/Dashboard.tsx` (`StyleSection`)<br>`closure_pass_design_lab` (`STYLE_PAGE_SIZE=6`) | 能够无障碍翻阅样式卡片与标本；但在 `closure_pass_design_lab` 分支中引入了每页 6 套的强分页逻辑，破坏了如同「逛展/漫步」般的连续无目的沉浸浏览流。 |
| **E** | **Visual family discovery**<br>(视觉语族检索) | <mark>**PARTIAL**</mark> | `closure_pass_design_lab:src/screens/Dashboard.tsx`<br>`main:src/screens/Dashboard.tsx` | 在 `closure_pass_design_lab` 中硬编码了 5 个语族标签；在 `main` 和 `implement_five_visual_presets` 中完全缺失。 |
| **F** | **Use-case discovery**<br>(创作场景检索) | <mark>**MISSING**</mark> | `src/styles/types.ts`<br>`src/content/types.ts` | 没有任何按工作类型（软件UI、比赛、PPT、官网、仪表盘、海报）的标签定义或检索模式。 |
| **G** | **Basic Editor**<br>(基础视觉调校器) | <mark>**READY**</mark> | `src/components/TokenTweaker.tsx`<br>(`ExperiencePlayground`) | 支持几何圆角、边框、硬阴影、色彩、密度、字阶、动效的快速实时调节，并能在标本与全应用间即时提交生效。 |
| **H** | **Advanced Editor**<br>(高级底层规格编辑器) | <mark>**MISSING**</mark> | `src/components/TokenTweaker.tsx` | 只有导入/导出纯 overrides JSON 文本框。没有针对 manifest、tokens、CSS、specification、资产的直接代码级规格编辑。 |
| **I** | **Fork / Variant model**<br>(衍生变体与谱系模型) | <mark>**PARTIAL**</mark> | `src/styles/types.ts` (`CustomExperience`)<br>`src/styles/runtime.ts` (`deriveCustomExperience`) | 仅支持单级平铺派生 (`custom:<baseStyleId>:<time>`)，存储简单的 token delta。无多级谱系 (`parentId`)、无变更记录 (`changes`)、无资产关联、无父子差异比对。 |
| **J** | **Human Design Spec export**<br>(人类可读设计规范导出) | <mark>**MISSING**</mark> | `src/components/ExperiencePreviewWorkspace.tsx` | 无法导出包含设计理念、版式语法、字阶标尺、交互准则与配色方案的独立 Markdown / HTML 规范文档。 |
| **K** | **Agent Spec export**<br>(AI 编码助手规范导出) | <mark>**PARTIAL**</mark> | `closure_pass_design_lab:src/components/ExperiencePreviewWorkspace.tsx` | 在 `closure_pass_design_lab` 中实现了复制 Agent Prompt 到剪贴板；在 `main` 和当前工作树中完全缺失；未形成结构化资产包。 |
| **L** | **Tokens export**<br>(标准化设计令牌导出) | <mark>**MISSING**</mark> | `src/components/TokenTweaker.tsx` (`buildExport`) | 仅支持内部 private 格式的 `ExperienceExport` JSON，未支持行业标准 W3C Design Tokens、Tailwind 配置片段或纯 CSS 变量集导出。 |
| **M** | **Portable package**<br>(便携式独立预设包导出) | <mark>**MISSING**</mark> | 无任何归档/打包模块 | 无法生成包含清单、CSS、规范、令牌、素材与 README 的独立 Zip / 目录归档包。 |
| **N** | **Vault as content source of truth**<br>(Vault 作为内容单一真理源) | <mark>**CLOSED (Phase A)**</mark> | `src/styles/registry.ts`<br>`src/core/vault/sync.ts` | **边界正式厘清**：明确 App 仓只保留既有 built-in 作为后备，Vault（v2026.10.04.2）作为 10 套新设计系统预设的正式 Source of Truth。消灭分支双写。 |
| **O** | **Personal / Distribution profiles**<br>(个人版 / 分发版产品画像) | <mark>**MISSING**</mark> | `src/lib/types.ts`<br>`src/screens/Dashboard.tsx` | 代码中 `Profile` 指的是环境安装画像 (`student-python` 等)，而非产品形态画像。没有 Personal 与 Distribution 的双形态开关。 |
| **P** | **One-codebase multi-profile**<br>(一码双态架构) | <mark>**MISSING**</mark> | `src/App.tsx`<br>`src/screens/Dashboard.tsx` | 无法通过编译配置或轻量环境变量在同构代码中无侵入切换工作台与分发版功能集合。 |
| **Q** | **Stable content release gate**<br>(稳定内容发布门禁) | <mark>**CLOSED (Phase A)**</mark> | `src/core/vault/sync.ts`<br>`src/core/vault/release.ts` | **硬门禁建立**：彻底剔除降级到 raw main 的隐式漏洞。严格按照「有效 checkpoint → 校验 pinned commit/tag → fetch」执行；失败时严格 fallback 至 LKG 或 Built-in，绝不拉取未经审计的 raw main。 |
| **R** | **App release**<br>(客户端本体发布机制) | <mark>**CLOSED (Phase A)**</mark> | `src/core/vault/release.ts`<br>`src/lib/buildIdentity.ts`<br>`src/modules/system_ops.rs` | **已修复**：Canonical URL 全部统一迁移至 `Arukasaeled/setup-center`；引入 `open_url` Rust IPC 修复原生外链；建立 Build Identity (v0.2.1) 与 UpdateModal 真实信息审计。 |
| **S** | **UI Parts ↔ Presets relationship**<br>(零部件与预设双向组装/拆解) | <mark>**MISSING**</mark> | 缺乏 UI Parts 实体 | 既然没有 UI Parts 实体，零部件组装为系统、系统拆解为零部件的双向流动自然完全不存在。 |

---

## 3. 现场专项审计（Deep Reality Probes）

### 3.1 Git / Build Drift（构建与分支漂移确认）

通过本地进程侦测、端口监听、Git 树比对与文件元数据，彻底查清了 **“为什么 localhost 和 EXE UI 严重不一致”** 的确切物理证据：

```
[本地运行物理态]
1. 生产 EXE:
   - 路径: D:\Setup Center\ai-student-setup.exe (PID 19888)
   - 文件时间: 2026/10/3 18:06:54
   - 对应 Git 节点: commit b92c0bf ("feat: upgrade to v0.2.0 - developer start center...") (2026-10-03 18:03:27)
   - 源码状态: 仅包含早期 20 套样式，无 6 items 分页，无 Design Lab IA，无后续任何 Commit。

2. 本地 Dev Server (localhost:1420):
   - 进程: node.exe (PID 59216)
   - 运行工作目录: C:\Users\35074\.gemini\antigravity\worktrees\ai-student-setup\closure_pass_design_lab
   - 对应 Git 节点: commit d82c0a5 ("feat(v3.0): closure pass, truthful design benchmarks, 8 flagship experiences...")
   - 源码状态:
     * 修改了 Dashboard.tsx (引入了 STYLE_PAGE_SIZE = 6 强分页)
     * 新增了 8 套旗舰体验 (cinematic-product, data-atlas, desktop-studio...)
     * 引入了 AwardAtlas (1298 行) 与 PatternLab (742 行)
     * 提供了「导出 AI Prompt」功能。

3. 当前工作树 (implement_five_visual_presets):
   - 路径: C:\Users\35074\.gemini\antigravity\worktrees\ai-student-setup\implement_five_visual_presets
   - 对应 Git 节点: commit e15b6c9 ("feat(design-lab): add second visual preset batch")
   - 源码状态:
     * 同样从 main (421f6eb) 分叉，完全独立于 closure_pass_design_lab！
     * 未包含 STYLE_PAGE_SIZE = 6 分页。
     * 未包含 AwardAtlas 与 PatternLab。
     * 新增了另外 10 套预设 (natural-history, terminal-collage, blueprint-drafting, split-flap...)。
```

**结论**：
- 用户在桌面打开的 **EXE** 停留在一个过去的构建版本（2026-10-03 18:06，`b92c0bf`）；
- 浏览器访问的 **localhost:1420** 绑定在另一个分支工作区 `closure_pass_design_lab`（包含分页与 8 套旗舰样式）；
- 本轮审计所在的工作区是第三个分支 `implement_five_visual_presets`（包含 10 套批量预设但无分页）。
- **三大环境彻底三方撕裂，互不包含。**

---

### 3.2 App / Vault 双 Source of Truth（双真理源冲突）

在 `src/styles/registry.ts` (L70-L101) 与 `src/core/vault/sync.ts` (L388-L422)：
- **Built-in 现状**：App 本地 `src/styles/` 目录中硬编码维护了 20 至 30 套完整的 TS 清单与 CSS 文件。
- **Remote 现状**：远端 `setup-center-vault` 仓库中也维护了一份同名样式（如 `blueprint`, `cyber-neon`, `y2k-digital`）。
- **截断与降级**：
  远端 Vault 的 JSON 清单结构较为古老（仅含 palette 和简单 tokens），缺少本地 `ExperienceProfile`。
  当 `VaultSync` 拉取远端数据并调用 `registerStyle(setupStyle)` 时，代码必须靠防御性补丁（`registerStyle` L96-L100）强制保留本地的 `experience`，防止远端 payload 将高阶语法特性抹成空白。
- **未来归属界定**：
  App 仓不应作为海量样式资产的手工拷贝库；样式内容（Visual Preset）必须剥离归入 Vault，App 仅通过构建期生成的 Pinned Snapshot 挂载离线预设，彻底消灭双份手工维护。

---

### 3.3 Registry Reactivity（注册表反应性静默失效）

核查 `src/styles/registry.ts` 与 `src/screens/Dashboard.tsx` (L2758-L2800)：
- `STYLE_REGISTRY` 只是一个普通的静态 TypeScript 内存数组：
  ```typescript
  export const STYLE_REGISTRY: SetupStyle[] = discoveredStyles;
  ```
- 当 `VaultSync.sync()` 或 `hydrateFromCache()` 完成并执行 `registerStyle(setupStyle)` 时，只是将对象 push / replace 进该原生数组。
- `StyleSection` 组件内部过滤列表的依赖项为：
  ```typescript
  const filteredStyles = useMemo(() => {
    return STYLE_REGISTRY.filter(...);
  }, [filter, styleBookmarks, searchQuery, customVersion]);
  ```
- **反应性断裂**：Vault 同步完成后**既没有触发任何状态机变更，也没有递增 `customVersion`**。React 组件完全感知不到原生数组的变化。画廊不会重新渲染，直到用户输入搜索词或切换 Tab 强制触发组件重算。

---

### 3.4 Remote Style Persistence（冷启动持久化回退竞争）

核查应用冷启动时序：
1. `src/lib/store.ts` (L656)：
   Zustand Store 在 JS 模块加载阶段立即初始化：
   ```typescript
   activeStyle: loadSavedStyle(),
   ```
2. `src/styles/registry.ts` (L122-L129)：
   `loadSavedStyle()` 读取 `localStorage` 中的上次选中 ID，并在当前 `STYLE_REGISTRY` 中检索：
   ```typescript
   if (STYLE_REGISTRY.some((s) => s.id === saved && s.implemented)) {
     return saved;
   }
   return "phantom-comic"; // 失败时回退默认
   ```
   此时，`STYLE_REGISTRY` 仅包含构建期由 Vite 扫描得到的 built-in 样式。
3. `src/App.tsx` (L131)：
   `VaultSync.hydrateFromCache()` 在组件挂载后的 `useEffect` 中才被异步调用。
4. **致命竞争**：如果用户选择并保存了一个**纯 Vault 远程专有样式（Vault-only Style）**，在下一次冷启动时，`loadSavedStyle()` 执行早于 Vault 缓存水合，`STYLE_REGISTRY.some()` 必然返回 `false`，应用**静默回退并强制持久化为 `"phantom-comic"`**。用户的远程样式设置在重启后必丢失。

---

### 3.5 Stable Vault Release Gate（发布门禁穿透漏洞）

核查 `src/core/vault/sync.ts` (L121-L193)：
- 预期门禁：只有当 `releases/latest.json` 给出合法 commitSha / snapshotTag 校验时，才拉取该固定版本的快照。
- 真实穿透逻辑：
  ```typescript
  try {
    const checkpointRes = await fetch(checkpointUrl, ...);
    if (checkpointRes.ok) {
      ...
      targetBaseUrl = `${rawVaultOrigin}/${pin}`;
    }
  } catch {
    // checkpoint 失败，targetBaseUrl 保持为 rawVaultOrigin (raw main)
  }

  // 随后代码执行：
  let client = new VaultClient(targetBaseUrl); // 若 targetBaseUrl 为 raw main 则直接拉取！
  ```
- **诊断**：只要发布门禁文件返回 404、网络波动或格式错误，系统**不会拒绝同步**，而是直接 Fallback 穿透至原始 `raw main` 分支进行无门禁的拉取。发布门禁未能构成硬屏障。

---

### 3.6 Canonical Repo URL（硬编码仓库用户名漂移）

代码中大量服务依然指向旧账户/组织 `arukas0623-ai`，而正式仓库位于 `Arukasaeled/setup-center`：

| 涉及文件 | 关键行号 | 当前硬编码 URL | 影响范围 |
| :--- | :--- | :--- | :--- |
| `src/core/vault/cache.ts` | L22 | `raw.githubusercontent.com/arukas0623-ai/setup-center-vault/main` | Vault 默认远端地址，导致冷启动同步 404 |
| `src/core/vault/release.ts` | L47, L177 | `api.github.com/repos/arukas0623-ai/setup-center/releases/latest` | App 检查更新服务，导致接口报错 |
| `src/core/vault/release.ts` | L226 | `raw.githubusercontent.com/arukas0623-ai/setup-center-vault/main/releases/latest.json` | 发布门禁校验地址失效 |
| `src/components/ActivationPanel.tsx` | L304, L314 | `github.com/arukas0623-ai/setup-center` & `setup-center-vault` | 用户界面开源链接 404 |
| `src/screens/Dashboard.tsx` | L1285, L1295 | 同上 | 仪表盘外链 404 |
| `src/screens/GoalMode.tsx` | L312 | `arukas0623-ai/setup-center` | 目标示例仓库 404 |
| `tools/vault-pin-verify.mjs` | L21, L41 | `arukas0623-ai/setup-center-vault` | 验证脚本拉取失效 |

---

### 3.7 localhost vs Tauri Production（运行时差异矩阵）

| 维度 | Vite Dev (Browser localhost:1420) | Tauri Dev (`cargo tauri dev`) | Tauri Production EXE (`ai-student-setup.exe`) |
| :--- | :--- | :--- | :--- |
| **源码来源** | 当前由 `closure_pass_design_lab` 分支目录驱动 | 取决于执行命令所在的工作树 | 静态固化于构建时的 Git commit（`b92c0bf`） |
| **构建产物** | 内存虚拟打包 (Vite HMR)，即时热加载 | 内存虚拟打包 + 临时 Rust Debug 二进制 | 优化编译的 Release 二进制，内嵌静态打包的 `dist/` |
| **Vault 存储** | 浏览器 `localStorage` (端口隔离于 1420) | WebView2 本地 AppData 存储池 | WebView2 独立沙箱数据目录（与浏览器完全不互通） |
| **版本仲裁** | `isTauri() === false`，版本固定为 fallback "0.2.0" | 读取 `Cargo.toml` 动态版本 | 读取嵌入二进制的正式版本号 |
| **系统能力** | Rust IPC 全部 Mock / 报错，无真实检测与安装能力 | 具备完整 Rust 原生命令调用 | 具备完整 Rust 原生命令调用与管理员提权 |

### 3.8 Phase A 闭环成果（Runtime & Build Baseline Closure）

在 Phase A 执行中，以下历史漂移与架构缺陷已完成硬闭环：
- **Git / Build Drift [CLOSED]**：主线统一回归 `main`，发布 `v0.2.1`。localhost 与 Tauri EXE 统一消费同一版本与同一 Style Registry。
- **App / Vault Source of Truth [CLOSED]**：App 仓主线不再手工同步 Vault 预设。Vault `v2026.10.04.2` 作为 14 套风格（含 10 套新发布）的唯一内容源。
- **Strict Release Gate [CLOSED]**：彻底移除降级 raw main 逻辑；严格执行 `Checkpoint -> Pinned Snapshot -> LKG -> Built-in`。
- **Registry Reactivity [CLOSED]**：引入 `StyleRegistryManager`（subscribe/notify/getVersion）并接入 Zustand，Vault 同步后画廊零延迟刷新。
- **Remote Style Startup Persistence [CLOSED]**：冷启动时在 `loadSavedStyle()` 前同步完成 Vault LKG 缓存水合，彻底杜绝断网重启回退到默认。
- **Canonical Repo URL [CLOSED]**：全面修正硬编码 URL 为 `Arukasaeled/setup-center` 与 `Arukasaeled/setup-center-vault`，兼容迁移旧用户 localStorage。
- **Build Identity & External IPC [CLOSED]**：建立轻量级 Build Identity 检视模块，实现 Rust 原生 `open_url` 命令，修复所有外部链接。

---

## 4. 架构债与产品债总结

1. **认知模型错位**：代码实现仍在围绕「如何检查电脑安装了哪些 EXE、如何跑 Winget」布局架构；而产品愿景的核心是「如何收集 UI 部件、如何沉淀并导出完整视觉系统、如何让用户开箱即用去造下一个产品」。
2. **多分支无序膨胀**：不同分支在没有合并主线的情况下，各自独立添加了 8 套旗舰体验、10 套预设风格、AwardAtlas、PatternLab 与强行分页，导致没有任何一个构建具备完整体验。
3. **内容体系未实体化**：UI Parts 停留在概念层面；Visual Preset 沦为内部皮肤（只能给自己换肤，不能打包导出给别人用）；Fork/Variant 缺乏数据模型。
4. **Vault 边界未清**：本地 App 与远端 Vault 职责交叠，既没有实现真正的「App 只管运行时」，也没有实现「内容只归 Vault」。

---

*下一步重构方案与目标模型详见配套文档：[`TARGET_PRODUCT_ARCHITECTURE.md`](./TARGET_PRODUCT_ARCHITECTURE.md)*
