# Experience System

# Responsibility
负责 Setup Center 的视觉语言、设计令牌（Design Tokens）、组件视觉变体、以及**版式语法**——换言之，它决定产品的整体观感与构图，而不只是配色。提供统一的 Experience Contract 与运行时，使应用能够在完全不侵入业务的前提下，切换成一整套不同的界面形态。

样式系统的定位已从「换皮（Reskin）」升级为「体验（Experience）」。一个 Style 不再只是调色板，它可以声明自己的外壳布局、导航语法、详情呈现方式、卡片形态与页面构图。

# Owns
- `types.ts`: `SetupStyle`（元数据 + 调色板 + 令牌）与 `ExperienceProfile`（版式语法）统一契约。
- `runtime.ts`: Experience Runtime。解析 style + 用户覆盖 → 计算运行时变量与语法属性；负责应用、清除、持久化、导入导出与自定义派生。
- `shell.css`: 所有版式语法的实现（shell / navigation / detail / card / composition / density / motion / typography / ornament）。
- `registry.ts`: `STYLE_REGISTRY` 注册表及激活/持久化机制，以及 Vault 动态注册入口。
- `default/`: 默认中性工业级极简风格（`manifest.ts`）。
- `phantom-comic/`: 旗舰参考样本（Specimen）——高风格化漫画海报式实现。

# Does NOT Own
- 软件检测、安装引擎、环境诊断、许可证校验等业务逻辑（属于 `core/` 与 Rust 后端）。
- 全局流程状态机（属于 `app/` / `lib/store.ts`）。
- 详情面板的**业务内容**（属于 `screens/Dashboard.tsx` 的 `DetailPane`）。样式层只决定它**如何呈现**，不决定它显示什么。

# The Experience Contract

一个 Style 声明两类信息：**令牌**（可被用户覆盖的数值）与**语法**（不可覆盖的结构选择）。

```
interface ExperienceProfile {
  tier:         "token" | "component" | "composition" | "experience"
  shell:        "sidebar" | "topbar" | "dock" | "dual-pane" | "windowed"
              | "command-centered" | "editorial" | "canvas" | "stacked"
  navigation:   "sidebar" | "topbar" | "dock" | "tab-strip"
              | "command-bar" | "menu-bar" | "keyboard-menu"
  detail:       "rail" | "modal" | "sheet" | "floating-inspector"
              | "window" | "inline" | "full-page"
  card:         "panel" | "flat-row" | "editorial-block" | "poster"
              | "terminal-line" | "window" | "tile" | "index-entry"
              | "floating-surface" | "borderless-group" | "sticker"
  composition:  "solid-grid" | "magazine-index" | "news-columns"
              | "character-list" | "finder-list" | "poster-wall"
              | "drafting-index" | "floating-panels" | "ledger" | "roadmap"
  density:      "compact" | "normal" | "spacious"
  motion:       "reduced" | "normal" | "expressive"
  typography:   { headingFamily, bodyFamily, monoFamily, headingScale,
                  bodyScale, headingWeight, headingTracking,
                  headingTransform, bodyLeading }
  ornament:     { rule, corner, decoration, chrome }
  tweaking:     TokenKey[]
  locked:       { [token]: 说明文字 }
  runtimeCapability?: "x.y.z"
}
```

## Experience Tier

| Tier | 含义 | 例子 |
|---|---|---|
| 1 `token` | 只换颜色与字体 | academic-lab |
| 2 `component` | 换控件与卡片语言 | monochrome-research |
| 3 `composition` | 改变页面结构 | swiss-dark, soft-product-minimal, cyber-neon |
| 4 `experience` | 外壳 / 导航 / 详情 / 构图全部改变 | retro-mac, dos-utility, phantom-comic |

新增风格优先做 Tier 3 / Tier 4。「又一个配色」的价值远低于「另一种界面形态」。

# Token 覆盖层级

用户覆盖永远优先。Style CSS **不得**通过硬编码 `!important #xxxxxx` / `!important 18px` 绕过这一层。

```
Style Manifest Default
      ↓
Resolved Style Tokens        （manifest 默认值 + 语法派生值）
      ↓
Custom Token Overrides       （用户覆盖，按 style id 分别存储）
      ↓
Computed Runtime Variables   （--radius-panel / --shadow-hard / --status-accent …）
```

- **Reset** 删除该 style 的覆盖条目，而不是把当前值再写回成覆盖——否则之后 manifest 更新将永远无法抵达用户。
- **切换 Style** 加载目标 style 自己的覆盖，绝不把上一个 style 的状态写进新 style 的存储。
- `tweaking` 列出该体验允许调整的令牌；`locked` 列出不允许调整的令牌**及原因**。UI 会显示「Locked by Experience」并把控件禁用，而不是提供一个点了没用的假按钮。

# 版式语法的两条铁律

1. **语法可以改变呈现方式，但不能让功能入口消失。** dock 的品牌位做了视觉隐藏但保留在无障碍树中；dual-pane 与 keyboard-menu 渲染的是同样的九个分区。
2. **语法只能改变卡片「周围」的东西，不能改变卡片自身的 `display`。** 否则卡片的标题 / 描述 / 标签 / 操作栏会被重排进语法自己的分栏里，条目将不可读。

# Public Entry Points
- `src/styles/types.ts`: 契约接口规范。
- `src/styles/registry.ts`: 风格注册表及检索函数。
- `src/styles/runtime.ts`: 运行时（解析、应用、覆盖、自定义派生）。
- `src/styles/index.ts`: 模块聚合导出。

# Extension Recipe（新增一个 Style）

1. 在 `src/styles/<style-id>/` 创建新风格目录。
2. 创建 `manifest.ts`，实现 `SetupStyle`（元数据 + 调色板 + 令牌 + `experience`）。
3. 创建对应的样式文件（例如 `<style-id>.css`）。选择器作用域为 `:root:is([data-style="<style-id>"])`，令牌请读取 `var(--...)`，不要硬编码基础几何 / 基础颜色 / 基础阴影。**如果语法枚举已经能表达你想要的形态，则不需要写任何 CSS。**
4. **完成！零已有文件修改（Zero Edits）**：Vite 自动发现清单与 CSS。

## Vault 远程发布

若新风格只使用「声明式语法 + CSS + 令牌」，Vault 可以直接发布，客户端**无需重新编译**——每个语法轴都是客户端已经实现的封闭枚举。真正需要自定义渲染器的极端风格，可以声明 `runtimeCapability`；低于该版本号的客户端会显示「需要更新应用」。

语法轴必须使用上面的枚举值。一个客户端没有实现的语法不会「优雅降级」：版本会照常发布、所有客户端都会拉到它，而风格会渲染成无样式默认外观，同时画廊却宣称相反。

# Allowed Dependencies
- `src/styles/types.ts`
- 基础 CSS 变量与 Tailwind 规范

# Forbidden Dependencies
- 禁止直接引用 `core/installer/`、`lib/ipc.ts` 等业务执行实现。
- 禁止在页面中散落 `if (style === "xxx")` 进行硬编码分支判断。页面只渲染语义类名与 `data-*` 属性，样式层通过属性选择器声明式生效。

# Example
参考完整运行样本：`src/styles/phantom-comic/`（海报式构图）与 `src/styles/dos-utility/`（字符栅格 + 编号键盘菜单）。
