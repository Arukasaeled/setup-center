# Style System

# Responsibility
负责 Setup Center 的视觉语言定义、设计令牌（Design Tokens）、组件视觉变体及高风格化装饰表现。提供统一的 Style Contract 和注册表，使应用能够无缝切换不同设计语言而绝不侵入底层业务。

# Owns
- `types.ts`: `SetupStyle` 统一契约接口与数据结构定义。
- `registry.ts`: `STYLE_REGISTRY` 注册表及激活/持久化机制。
- `default/`: 默认中性工业级极简风格（`manifest.ts`）。
- `phantom-comic/`: 旗舰参考样本（Specimen）——P5 × 美漫彩漫高风格化视觉实现（`manifest.ts`, `phantom-comic.css`）。

# Does NOT Own
- 软件检测、安装引擎、环境诊断、许可证校验等业务逻辑（属于 `core/` 与 Rust 后端）。
- 全局流程状态机（属于 `app/` / `lib/store.ts`）。

# Public Entry Points
- `src/styles/types.ts`: Style Contract 接口规范。
- `src/styles/registry.ts`: 风格注册表及检索函数。
- `src/styles/index.ts`: 模块聚合导出。

# Extension Recipe（新增一个 Style）
1. 在 `src/styles/<style-id>/` 创建新风格目录。
2. 创建 `manifest.ts`，实现 `SetupStyle` 接口并导出 manifest 对象。
3. 创建对应的样式文件（例如 `<style-id>.css`），通过 `[data-style="<style-id>"]` 作用域限定选择器。
4. **完成！零已有文件修改（Zero Edits）**：Vite 自动发现清单与 CSS，风格页将自动渲染新卡片并支持即时启用。无需修改 `styles.css`，无需修改 `registry.ts`，无需修改任何页面代码。

# Allowed Dependencies
- `src/styles/types.ts`
- 基础 CSS 变量与 Tailwind 规范

# Forbidden Dependencies
- 禁止直接引用 `core/installer/`、`lib/ipc.ts` 等业务执行实现。
- 禁止在页面中散落 `if (style === "xxx")` 进行硬编码分支判断。

# Example
参考首个完整运行样本：`src/styles/phantom-comic/`。
