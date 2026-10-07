# Setup Center

> **Creative & Development Bootstrap Hub**
> 
> 面向开发者与初学者的一站式开发环境配置与创作启动中心。

Setup Center 不再只是传统的 Windows 软件安装器。在现代开发中，“Setup” 不仅意味着 **Setup Computer**（装好系统环境与依赖），更意味着 **Setup Everything Needed to Build** —— 沉淀并交付从开发工具链、视觉风格、工程模板、离线资源到技能指南的全部要素。

---

## 1. 核心系统架构与 Transfer 理念

Setup Center 将应用运行时与内容解耦，核心围绕 **Transfer（流转）** 理念构建：
**Discover → Transfer → Normalize → Store → Distribute → Instantiate**

```
Setup Center (App)                  Setup Center Vault (Remote Content)
├── src/core/vault/      <───────── https://github.com/Arukasaeled/setup-center-vault
│   └── 运行时增量更新与离线缓存       ├── schemas/   (JSON Schema 契约)
├── src/core/transfer/              ├── styles/    (视觉风格与 CSS)
│   ├── 收集箱 (Inbox)               ├── resources/ (精选开发资源)
│   ├── 资产下载器 (Downloader)        ├── templates/ (工程脚手架)
│   ├── 脚手架实例化 (Scaffolder)     ├── patterns/  (可复用 UI 交互模式)
│   └── 个人收藏 (Bookmarks)         ├── skills/    (Agent 迁移技能)
├── src/styles/                     └── inbox/     (待规整队列)
│   ├── 14 套内置视觉风格（Vault 纳管 20 套风格，支持即时动态同步）
│   └── 设计令牌微调器 (Token Tweaker)
└── src/content/resources/
    └── 10 大分类 172+ 开源精选资产 (glob 自动发现与统一纳管)
```

### Transfer Protocol（流转协议）
- **外部一键捕获**：支持通过 UI 收集箱或 Agent 指令：“`Transfer this into Setup: <URL>`” 自动抓取并规整入库。详见 [`TRANSFER.md`](TRANSFER.md)。
- **零编译热扩充 (Zero-Rebuild)**：Vault 远端内容更新后，客户端无需重新打包发布，启动时或点击「同步 Vault」自动增量热挂载。
- **离线优先 (Offline-First)**：即使断网，本地快照依然无缝驱动完整界面（内置 14 套风格、172 项资源、28 项模板、34 项模式、21 项技能离线基线）。
- **设计令牌微调器 (Token Tweaker)**：在风格试验场内实时调节圆角、边框、硬阴影与强调色，并支持导出配置 JSON。

---

## 2. 核心功能与能力

- **真实环境探测**：Windows 真实版本识别、管理员权限判定、磁盘真实可用空间计算、核心网络联通探测。
- **三来源软件清点**：注册表（4路 Uninstall 键）、系统 PATH、winget 本地清点三方独立印证与冲突解决。
- **自选软件安装**：摆脱旧版方案绑定，支持用户自主勾选单个或多个工具直接构建纯净安装计划并执行。
- **断点续装与留档**：安装与初始化进度实时持久化，支持异常中断后一键恢复，不重复安装已就绪项。
- **离线设备授权与状态诊断**：基于设备特征的多维证据比对（DeviceEvidenceV2），支持单部件硬件变更容错与设备损坏状态显式诊断；本地单机离线激活，不收集隐私账号，不依赖外部在线鉴权服务。（注意：本地客户端运行环境下，客户端代码与证书属于纵深防御防篡改层，不提供数学绝对不可逆的单向密码学防逆向保证）。

---

## 3. 构建与本地运行

### 前置要求
- Node.js 20.19+ / 22.12+ (LTS)
- Rust 1.77+ (MSVC 工具链，对齐 `src-tauri/Cargo.toml` 声明的 `rust-version = "1.77"`)
- Windows 10/11 64位环境 (WebView2 运行时)

### 常用命令
```powershell
# 安装依赖
npm install

# 启动本地开发服务（Vite + 热重载）
npm run dev

# 启动桌面端开发应用（Tauri Dev）
npm run tauri:dev

# 前端类型检查与生产打包
npm run build

# 自动化测试套件
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 后端测试
node tools/ui-verify.mjs                         # 前端 121 项 UI 断言
node tools/self-select-verify.mjs                # 自选安装路径验证
node tools/gate-rules-verify.mjs                 # 授权门禁规则验证
node tools/nav-verify.mjs                        # 页面导航回退栈验证

# 生成最终分发安装包与开发端工具箱
pwsh -File .\build-dist.ps1
```

---

## 4. Agent 协作与扩展指南

本项目专为多 Agent 协作设计。如果您是一个初次接触本项目的 AI Agent：
- **请首先阅读根目录 [`AGENTS.md`](AGENTS.md)**，获取精准的任务路由与扩展食谱。
- **请参考架构地图 [`PROJECT_MAP.md`](PROJECT_MAP.md)**，在几十秒内建立模块心智模型。
- **新增风格**请参阅 [`src/styles/README.md`](src/styles/README.md)，并参考首个参考样本 [`src/styles/phantom-comic/`](src/styles/phantom-comic/)。
