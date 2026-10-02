# Software Content Domain

# Responsibility
负责定义与管理开发软件目录元数据及其分类属性（如前端、AI、运行时、工具链等）。

# Owns
- 软件项元数据规范与映射关系。
- 软件的官方图标映射、分类标签以及自选属性。

# Does NOT Own
- 软件底层 Winget / Powershell 安装执行器（属于 Rust 后端 `src-tauri/src/modules/executor.rs`）。
- 机器硬件检测（属于 `core/environment`）。

# Public Entry Points
- `src/lib/softwareMeta.ts`: 软件分类、元数据映射与自选状态助手。
- `src/assets/software/`: 软件官方矢量与像素图标资产目录。

# Extension Recipe（新增一个收录软件）
1. 在 Rust 后端 `src-tauri/knowledge/software/<id>.yaml` 添加软件解释知识文件。
2. 在 `src/assets/software/<id>.png` 放置官方高质量图标。
3. 在 `src/lib/softwareMeta.ts` 补充该软件的分类归属与友好呈现名称。
4. 重新构建或热重载，自选库与检测页将自动感知识别。
