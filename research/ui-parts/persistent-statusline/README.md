# Persistent Statusline (Status Belt)

> UI Part Prototype Batch 01 — Item 03
> Source inspiration: jarrodwatts/claude-hud (MIT)

---

# What it is

Persistent Statusline 是一个**常驻于操作区底部的低侵入式状态腰带**。
它在不打扰主工作流的前提下，为长时间运行的宿主环境（如 AI 智能体上下文、构建测试管线）提供高密度、可略读的全局态势感知。
它以彩色徽章与仪表盘为视觉锚点，搭配自收敛的同构事件折叠、条件显隐活动行与基于物理绝对时间的过期指示。

---

# Mechanism

1. **锚点统领 (Anchor + Meter)**:
   首部配备高饱和度模型/环境徽章，紧随其后为百分比进度条。进度条随着负载升高在安全阈值内动态变色（绿 → 黄 → 红）。
2. **同类事件折叠计数 (Same-Event Collapsing)**:
   连续发生的同构动作（如多次文件读取、多次微服务测试）自动合并为 `Name ×N`，防止工具日志刷屏淹没关键状态。
3. **活动行自收敛显隐 (Transient Activity Rows)**:
   在展开模式下，工具调用行、子智能体执行行与待办任务行仅在存在活跃事务时才占用高度，无任务时自动收敛。
4. **绝对钟表时间过期原则 (Absolute Clock Timestamp)**:
   由于常驻状态带依靠系统事件离散触发重绘而非连续高频轮询，因此对于有时效性的资源（如缓存到期、授权到期），**严禁显示相对倒计时（如“还剩 3m 24s”）**，必须显示**绝对时钟时刻（如“expires 21:40”）**。即使 UI 渲染陈旧，钟表时间在物理现实中依然为真。
5. **双排版形态 (Compact & Expanded)**:
   支持单行紧凑模式（适合窄视口或工具栏嵌合）与多行展开模式（适合深度控制台）。

---

# Why it works

1. **避免假死与信息焦虑**:
   长时间后台任务需要明确的“生命体征”。常驻腰带通过徽章与仪表条提供了极低认知负担的存在感。
2. **离散渲染下的时间保真**:
   当宿主进程进入空闲等待时，不会为了一个倒计时动画去消耗 CPU 频繁重绘，绝对时间优雅地解决了节能与保真的冲突。

---

# Essential

- 常驻于输入或工作区边缘，保持低视觉侵入性 [Verified]
- 彩色视觉锚点（徽章 + 阈值色彩仪表条）[Verified]
- 阈值状态色转换（正常绿 → 警告黄 → 临界红）[Verified]
- 同类事件合并折叠（`Read ×4`）[Verified]
- 活动行仅在非空时渲染 [Verified]
- **绝对时钟时刻表示到期限制**，杜绝陈旧相对倒计时 [Verified 原文重点设计理由]

---

# Optional

- Claude / Anthropic 品牌徽章与专有术语（如 CLAUDE.md 规则数）[Verified 可剥离]
- 终端等宽字符 ASCII 纯文本渲染，还是现代 Web CSS 渐变 [Derived]
- Git 分支与仓库状态字段 [Verified 可剥离]
- 具体的阈值数值划分（如 70%、85%）[Derived]

---

# Evidence

| 维度 | 等级 | 说明 |
|---|---|---|
| **Structure** | Verified | 官方 README 与 CLAUDE.md 完整定义 Anchor Line、Activity Line 与各元素堆叠优先级 |
| **Behavior** | Verified | 官方明确声明仅在系统事件离散触发重绘、绝对时间防伪设计、同类事件合并原则 |
| **Visual** | Observed | 直接读取官方发布的高保真截图（深色终端 macOS 真实运行捕获） |
| **Source Code**| Unread | 未翻阅 Rust / TS 渲染实现底层，由 React 状态驱动与 Semantic CSS 纯净重构 |

---

# How to reuse

引入 `PersistentStatusline.tsx` 并传入运行数据：
```tsx
import { PersistentStatusline } from "./PersistentStatusline";

export function ConsoleFooter() {
  return (
    <PersistentStatusline
      initialDataset="agent"
      initialMode="expanded"
    />
  );
}
```

---

# Demo variants

本原型包含两种跨领域适配数据集与两种排版模式：
1. **AI Agent Session Runtime**:
   - 锚点：`[DeepSeek-V3]`
   - 仪表：Context 68% (可滑动调节至 >85% 触发红光预警)
   - 辅助：`8 rules │ 4 MCPs │ tokens: 136k / 200k`
   - 活动：`✓ Read ×4 │ ✓ Grep ×2 │ ◐ Edit: types.ts`
   - 子智能体：`◐ Research Subagent (14s)`
   - 绝对到期：`expires 21:45`
2. **Generic Build Pipeline Runtime**:
   - 锚点：`[Vite + Cargo x64]`
   - 仪表：Memory 88% (高负荷红光报警)
   - 辅助：`14 crates │ 320 modules │ arch: x86_64-pc-windows`
   - 编译：`✓ rustc ×8 │ ✓ tsc --noEmit │ ◐ cargo-tauri bundle`
   - 测试：`✓ Lib Unit Test Suite (58s): 679 tests passed`
   - 绝对到期：`expires 23:59`
3. **单行紧凑模式 (Compact)** 与 **多行展开模式 (Expanded)**。

---

# Known limitations

1. **终端字符对齐与 Web 字体度量**:
   在纯文本终端里每个字符宽度严格恒定，而在 Web 端混入比例字体或中文字符时可能需要借助 `ch` 单位或 CSS Grid 对齐。
2. **多指标并行仪表**:
   当前版本重点展示单主指标（如 Context 或 Memory），未来可支持双计量仪表条并列。
