# Application Layer

# Responsibility
负责 Setup Center 的顶层装配、页面路由状态机、全局数据存储（Zustand Store）、冷启动逻辑与窗口生命周期。

# Owns
- `src/lib/store.ts`: 应用全局状态机（屏路由 `screen`、仪表盘标签 `section`、授权状态 `entitlements`、活动风格 `activeStyle` 等）。
- `src/App.tsx`: 根组件与事件监听挂载点。
- `src/screens/`: 10 个屏流转逻辑（Welcome、Goal、Detect、Software、Choose、Install、Bootstrap、Done、Dashboard 等）。

# Public Entry Points
- `src/app/index.ts`
- `src/lib/store.ts`
- `src/App.tsx`

# Allowed Dependencies
- `src/core/`
- `src/ui/`
- `src/styles/`
- `src/content/`
