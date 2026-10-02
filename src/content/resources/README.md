# Resources Content Domain

# Responsibility
负责未来开发资源项的元数据定义（如离线镜像源、模型权重索引、开发工具包链接等）。

# Owns
- 资源条目元数据定义（名称、类型、用途、下载源）。

# Does NOT Own
- 具体的网络下载任务调度器。

# Extension Recipe
按 `ContentItem`（`type: "resource"`）格式注册到 `ContentRegistry`。
