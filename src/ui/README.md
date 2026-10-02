# UI System & Primitives

# Responsibility
负责存放通用、可在所有主题与风格间共享的基础 UI 控件与视图原语（Button、Notice、TitleBar、BackButton、SoftwareIcon、SoftwareRow 等）。

# Owns
- 基础组件结构、无障碍属性（A11y、ARIA）与交互事件绑定。
- 组件的基础插槽与响应式栅格结构。

# Does NOT Own
- 具体的风格特定配色方案与硬边投影（由 `styles/<style-id>/` 覆盖定制）。
- 全局业务流程（属于 `app/`）。

# Public Entry Points
- `src/ui/index.ts`
- `src/components/ui/Button.tsx`
- `src/components/SoftwareRow.tsx`

# Allowed Dependencies
- `clsx`
- `src/styles/` 设计令牌 CSS 变量
