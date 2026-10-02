# Setup Center

> **Creative & Development Bootstrap Hub**
> 
> 面向开发者与初学者的一站式开发环境配置与创作启动中心。

Setup Center 不再只是传统的 Windows 软件安装器。在现代开发中，“Setup” 不仅意味着 **Setup Computer**（装好系统环境与依赖），更意味着 **Setup Everything Needed to Build** —— 沉淀并交付从开发工具链、视觉风格、工程模板、离线资源到技能指南的全部要素。

---

## 1. 核心系统架构

项目采用分层清晰的模块边界，彻底解耦视觉风格与底层业务引擎：

```
Setup Center
├── src/core/       # 核心业务领域：环境检测、安装执行器与远程内容边界（与 UI 解耦）
├── src/app/        # 应用编排：全局状态机（Zustand）、屏路由与冷启动控制
├── src/ui/         # 跨风格共享的基础通用 UI 原语与无障碍组件（A11y）
├── src/styles/     # 视觉风格系统（Style System）：统一契约、风格注册表与多风格实现
└── src/content/    # 统一内容目录（Content Registry）：软件、风格、资源、模板等元数据
```

### Style System（风格试验场）
- **统一 Style Contract**：定义了 `SetupStyle` 规范（Manifest、Tokens、Palette、A11y）。
- **统一 Style Registry**：所有设计语言通过 `src/styles/registry.ts` 注册，风格切换即时全局生效。
- **首套高风格化旗舰实现：`phantom-comic`（P5 × 美漫彩漫）**：
  - 灵感来源：Persona 5 视觉语言（平面切割感、角度徽章、动态海报节奏）+ 美漫/波普艺术（粗粝轮廓、0-blur 几何硬投影、电光黄/青蓝撞色）。
  - 纯设计语言与布局实验，不包含或重新分发任何官方版权素材。
  - 软件卡片具备独立分镜格实体感，大幅提升视觉焦点与辨识度。
- **预设风格草案槽位**：`apple-minimal`（Cupertino 极简）、`terminal-crt`（赛博终端）、`editorial`（瑞士画册）。

### Content Registry（内容目录骨架）
为未来的多模态内容生态奠定统一元数据规范（`ContentItem`, `ContentType`, `ContentManifest`）：
- **Software**：常用开发软件与环境运行时的识别与自选安装。
- **Style**：前端视觉交互主题。
- **Resource**：离线模型权重、镜像源与依赖包索引。
- **Template**：工程项目脚手架与基础代码模板。
- **Skill**：面向 AI Agent 与开发者的技能工作流指南。
- **Learning**：从零到一的实战成长路径。

---

## 2. 核心功能与能力

- **真实环境探测**：Windows 真实版本识别、管理员权限判定、磁盘真实可用空间计算、核心网络联通探测。
- **三来源软件清点**：注册表（4路 Uninstall 键）、系统 PATH、winget 本地清点三方独立印证与冲突解决。
- **自选软件安装**：摆脱旧版方案绑定，支持用户自主勾选单个或多个工具直接构建纯净安装计划并执行。
- **断点续装与留档**：安装与初始化进度实时持久化，支持异常中断后一键恢复，不重复安装已就绪项。
- **离线安全授权**：硬件指纹本地哈希绑定，不收集账号，不上传隐私，支持单机授权离线激活。

---

## 3. 构建与本地运行

### 前置要求
- Node.js 18+
- Rust 1.75+ (MSVC 工具链)
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
- **请首先阅读根目录 [`AGENTS.md`](file:///D:/AI-Vault/DeepSeek/ai-student-setup/AGENTS.md)**，获取精准的任务路由与扩展食谱。
- **请参考架构地图 [`PROJECT_MAP.md`](file:///D:/AI-Vault/DeepSeek/ai-student-setup/PROJECT_MAP.md)**，在几十秒内建立模块心智模型。
- **新增风格**请参阅 [`src/styles/README.md`](file:///D:/AI-Vault/DeepSeek/ai-student-setup/src/styles/README.md)，并参考首个参考样本 [`src/styles/phantom-comic/`](file:///D:/AI-Vault/DeepSeek/ai-student-setup/src/styles/phantom-comic/)。
