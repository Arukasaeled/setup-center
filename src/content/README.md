# Content Registry

# Responsibility
负责 Setup Center 的统一内容对象元数据定义与分发骨架。未来承载：Software（软件）、Style（视觉风格）、Resource（开发资源）、Template（项目模板）、Skill（技能指南）、Learning（学习路径）六大内容体系。

# Owns
- `types.ts`: `ContentItem`、`ContentType`、`ContentManifest` 接口定义。
- `registry.ts`: `ContentRegistry` 统一元数据注册中心与查询单例。
- 各内容领域目录（`software/`、`resources/`、`templates/`）。

# Does NOT Own
- 具体的软件安装/执行过程（属于 `core/installer` 与 Rust 引擎）。
- 具体的 CSS 样式渲染（属于 `styles/`）。
- 远程云端下载与同步协议实现（当前阶段只搭骨架，不做云端服务）。

# Public Entry Points
- `src/content/types.ts`: 内容项统一规范。
- `src/content/registry.ts`: `ContentRegistry` 管理器单例。
- `src/content/index.ts`: 模块聚合导出。

# Extension Recipe（新增一个 Content 条目）
1. 准备条目元数据，构造符合 `ContentItem` 格式的对象（包含 `id`, `type`, `name`, `version`, `description`, `source`, `author`, `license`, `updatedAt`）。
2. 调用 `ContentRegistry.register(item)` 注册到目录。
3. 可通过 `ContentRegistry.listByType(type)` 或 `ContentRegistry.get(id)` 随时检索。

# Allowed Dependencies
- `src/content/types.ts`
- `src/styles/`（仅读取风格元数据用于注册表初始化）

# Forbidden Dependencies
- 禁止强耦合在线网络请求库或云端特定 SDK。
