# Clip Launch Grid

> UI Part Prototype Batch 01 — Item 01
> Source inspiration: Ableton Live 12 Reference Manual (Session View)

---

# What it is

Clip Launch Grid 是一个**行列式双向触发矩阵**。
它将界面的“列”建模为独立、互斥的执行通道（Tracks），将界面的“行”建模为可以跨通道批量同步触发的场景（Scenes）。
与传统自上而下的线性流水线或时间轴播放器不同，它的网格布局仅表达可用选项与组合维度，提供零约束的**随机访问与组合触发**。

---

# Mechanism

1. **通道内互斥 (Column Mutual Exclusion)**:
   每一列在任意时刻最多只有一个 Slot 处于激活（Active / Playing）状态。点击同列的新 Slot 会自动替换原有活动项，无需先手动暂停旧项。
2. **场景批量发射 (Row-Level Scene Launch)**:
   每一行首部配备独立的行发射器。点击整行发射器会同时触发该行所涵盖的所有通道单元格。
3. **停止保护 (hasStop Flag)**:
   当某一列在当前行没有配置 Slot 时，若当前正在运行的 Slot 声明了 `hasStop: false`，则整行触发时不会强制清空该通道，保持后台长程任务继续执行。
4. **单格自给自足 (Autonomous Cell Trigger)**:
   每个单元格具备独立的触发器与停止按钮，可在全局任意时刻被单独击发。
5. **通道状态反馈 (Per-Track Status)**:
   网格底部常驻显示各通道当前的实时运行标签与停止开关。

---

# Why it works

传统软件常将并行能力表达为“多个独立的 Tab”或“自上而下的瀑布流”，导致用户难以一眼感知系统的**组合状态**。
Clip Launch Grid 将“同构互斥（列）”与“同步协同（行）”正交化：
- 横向一眼看清当前系统各维度的组合切片；
- 纵向一眼看清每个维度在不同阶段的可选方案；
- 一键即可在不同的全局姿态（Presets / Stages / Scenes）之间瞬间切换，同时保留对单一维度的微调能力。

---

# Essential

- 行 × 列矩阵结构，**列互斥**（每列最多激活一个单元格）[Verified]
- 每个单元格具备**独立触发**控件 [Verified]
- 整行批量触发器（Scene Launch）[Verified]
- 空间布局与执行时序**彻底解耦**（随时随机访问，非线性强制）[Verified]
- 通道独立状态区（显示当前活跃项与停止控制）[Verified]

---

# Optional

- 音乐制作专属语境（BPM 节拍、小节量化、循环音频波形）[Verified 可剥离]
- 三角形与方形的具体图标字符风格 [Derived]
- Ableton 灰色工业调色板 [Verified 可剥离]
- Follow Actions 自动跳转规则、MIDI 控制器物理映射 [Verified 可剥离]

---

# Evidence

| 维度 | 等级 | 说明 |
|---|---|---|
| **Structure** | Verified | Ableton Reference Manual v12 第7章全文直接确认 Tracks、Scenes、Slots、Stop Buttons 结构 |
| **Behavior** | Verified | 官方手册明确规定列内互斥播放、整行 Scene 批量触发、移除 Stop 按钮实现保持播放 |
| **Visual** | Derived | 官方手册未附可提取高保真标线图，原型采用中性高反差深灰工业风纯 CSS Grid |
| **Source Code**| Unread | 未阅读 Ableton 封闭专有宿主源码，行为由纯 React 状态机与 CSS Grid 重构 |

---

# How to reuse

1. 安装/引入 `ClipLaunchGrid.tsx` 与 `clip-launch-grid.css`。
2. 构造符合 `GridDataset` 契约的数据源（定义 `tracks`、`scenes`、`slots`）。
3. 挂载组件并通过 `onActiveChange` 回调捕获用户当前选择的组合态：
```tsx
import { ClipLaunchGrid } from "./ClipLaunchGrid";

export function MyOrchestrator() {
  return (
    <ClipLaunchGrid
      initialDataset="agent"
      onActiveChange={(activeSlots) => {
        console.log("Current active combination:", activeSlots);
      }}
    />
  );
}
```

---

# Demo variants

本原型内建了 3 组完全不同领域的验证数据集，证明该机制具备极高通用性：
1. **Agent Task Orchestrator (智能体研发流水线)**:
   - 列：Architect, Coder, Reviewer, DevOps
   - 行：01. Architecture, 02. Core Dev, 03. QA Verification, 04. Release
   - 特色：DevOps 在第 2 阶段的 Docker 容器具备 `hasStop: false`，在触发第 3 阶段时继续平滑运行。
2. **Visual System Dimension Mixer (设计系统混音台)**:
   - 列：Typography, Color Palette, Motion, Geometry
   - 行：Swiss Monospace, Cyber Terminal, Warm Editorial, Tactical HUD
   - 特色：支持自由将瑞士等宽字体与战术 HUD 瞄准框临时混搭。
3. **Presentation Scene Director (演说舞台导播台)**:
   - 列：Backdrop, Content Canvas, Presenter Cam, Live Sandbox
   - 行：Scene A: Opening, Scene B: Tech Deep Dive, Scene C: Live Benchmark, Scene D: Summary

---

# Known limitations

1. **移动端小屏断点适配**:
   当前为高密度桌面矩阵排版。在极窄视口下需要支持水平横向滚动轨道（Horizontal Scroll Rail）。
2. **多选批量触发**:
   当前实现支持“单格点击”与“整行触发”，尚未实装按住 Shift/Ctrl 进行任意跨行列不规则多选批量触发（Rubberband selection）。
