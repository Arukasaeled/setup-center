# Setup Center — 软件与内容许可政策 (CONTENT_LICENSING.md)

> 本文档规范 Setup Center 客户端与生态资产的授权边界、第三方资产引用规范以及经营隐私历史处置政策（Issue J07, A08）。

---

## 1. 软件核心源代码许可 (Core Application Source Code)

- **应用定位**：Setup Center 客户端（Tauri 跨平台桌面应用、Rust 核心模块与 React/TypeScript 前端界面）。
- **根许可证提案**：
  - 拟定方案 A：**MIT License**（宽松开源，最大化开发者社区自由使用与协作）。
  - 拟定方案 B：**Apache License 2.0**（提供显式专利授权与商标限制保护）。
- **当前决定状态**：**`BLOCKED_INPUT`**
  - 正式根许可证的采纳需由仓库所有者（Arukasaeled / 维护团队）进行最终法务与商业决策。在用户做出明确选择前，保留本提案文档作为授权边界说明。

---

## 2. 第三方商标与资产引用规范 (Trademarks & Third-Party Assets)

Setup Center 作为一个开发环境配置与创作启动中心（Bootstrap Hub），索引和检测了大量优秀的第三方开发工具与开源项目：

1. **软件名称与商标归属**：
   - VS Code、Windows 为微软公司（Microsoft Corporation）商标。
   - Git 为 Software Freedom Conservancy 纳管商标。
   - Python 为 Python Software Foundation 注册商标。
   - Node.js 为 OpenJS Foundation 商标。
   - Claude Desktop、Claude Code 为 Anthropic PBC 商标。
   - Docker 为 Docker, Inc. 商标。
   - 所有第三方工具的名称、Logo 与图标仅用于**指示性事实说明（Nominative Fair Use）**，不代表任何官方赞助、从属或背书关系。
2. **第三方开源软件许可证**：
   - 安装器通过 Winget、官方直链或受控脚本下载安装的第三方软件，均遵循各项目自身的开源或专有许可证协议，用户需自行遵守其对应条款。

---

## 3. 设计系统与内容资产许可 (Design Systems & Content Assets)

- **视觉风格与体验样式表 (`src/styles/`)**：
  - 声明式版式语法、CSS 变量契约与样式表遵循 **MIT License** 或 **CC-BY-4.0**，允许开发者自由提取、定制与二次分发。
- **精选资源目录元数据 (`src/content/resources/`)**：
  - 资源清单的结构化元数据（名称、描述、Stars、推荐理由等）遵循 **CC0 1.0 (Public Domain)** 或 **CC-BY-4.0**。
- **工程脚手架模板 (`src/content/templates/`)**：
  - 脚手架配方与初始化代码模板遵循 **The Unlicense** 或 **MIT-0**，确保开发者由 Setup Center 实例化的工程项目无任何许可证传染或版权负担，可直接用于商业闭源开发。
- **UI 交互模式 (`patterns/`) 与 Agent 技能 (`skills/`)**：
  - 遵循 **MIT License**。

---

## 4. 商业授权模块与经营历史处置政策 (Issue A08, J05, J06)

针对早期版本遗留的商业账本、历史激活码及设备指纹绑定记录，实施严格的隔离与清理边界：

1. **构建与分发绝对隔离 (已交付 - T15)**：
   - `build-dist.ps1` 强制执行 `-OutRoot` 外部路径校验，严禁在源码仓库目录内生成交付物；
   - 生产打包仅交付空白模板 `license_inventory.example.csv`，绝对禁止打包任何真实经营账本；
   - 明文码迁移工具强制要求外部私有路径，并在打包前执行文本模式泄露阻断扫描。
2. **公共 Git 仓库历史永久清理政策 (Issue A08 - BLOCKED_INPUT)**：
   - **风险现状**：早期提交历史中可能包含历史测试或真实机器绑定的经营记录碎片。
   - **整改操作方案**：
     由仓库管理员在本地使用 `git-filter-repo` 执行深度历史重写：
     ```bash
     # 永久抹除历史经营账本与明文文件
     git-filter-repo --path-glob 'license_inventory*.csv' --invert-paths
     git-filter-repo --path-glob 'codes_export_*.txt' --invert-paths
     ```
   - **阻塞说明**：Git 历史重写会彻底改变所有提交的 Commit SHA，并需要对远程分支执行 `git push --force`，可能对已有的克隆仓库或下游分支造成不可逆影响。因此该操作明确置为 **`BLOCKED_INPUT`**，等待仓库所有者独立授权并在指定维护窗口期执行。

---

## 5. Setup Center Vault 远程协同许可

- Setup Center Vault 仓库（`https://github.com/Arukasaeled/setup-center-vault`）作为解耦的公共内容库，其内容同步机制遵循只读、契约强校验与快照回退原则。
- 详细 Vault 内容许可见 Vault 仓库根目录下的 [`CONTENT_LICENSING.md`](../setup-center-vault/CONTENT_LICENSING.md)。
