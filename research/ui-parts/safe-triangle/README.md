# Linear Safe-Triangle Submenu

> UI Part Prototype Batch 01 — Item 02
> Source inspiration: Andreas Eldh (Linear Engineering) — *Invisible Details* (2020)

---

# What it is

Safe-Triangle 是一种**针对级联二级子菜单的瞬态几何交互模式**。
在传统菜单中，当用户从父菜单项向右（或向左）展开的子菜单移动时，必须沿着直角折线（倒 L 形正交路径）行走；如果稍有斜向偏角掠过相邻的父菜单项，子菜单就会立刻关闭，造成极大的挫败感。
Safe-Triangle 在光标与子菜单靠近边缘之间动态绘制一个不可见的安全几何多边形，使光标沿**欧几里得对角线直达**时子菜单稳固保持打开。

---

# Mechanism

1. **几何三点确定 (P-A-B Triangle)**:
   - 顶点 P：当前鼠标光标的实时坐标 `(clientX, clientY)`。
   - 端点 A 与 B：子菜单靠近父菜单一侧边缘的顶部与底部角点坐标。
2. **硬件加速的 DOM 命中 (clip-path: polygon)**:
   在光标与子菜单之间渲染一个绝对定位（或 fixed）容器，赋予 `clip-path: polygon(P, A, B)` 与 `pointer-events: auto`。浏览器硬件加速处理多边形区域内的命中测试，使得光标在斜向划动期间依然视作“停留在有效菜单上下文中”。
3. **触达自动折叠**:
   当光标坐标穿过子菜单近侧边缘进入子菜单内部时，安全区域瞬时收起，子菜单内的各选项正常响应 hover 与点击。
4. **高度限制保护 (Height Capping / Directional Escape)**:
   针对过高子菜单会导致三角形底边过宽、进而封死相邻父菜单项的缺陷，本实现加入 `maxVerticalSpread` 约束（默认 90px），将 A 与 B 端点相对当前光标 Y 轴距离进行钳制，确保用户垂直意图明确时依然能自然切换到相邻菜单项。
5. **双向侧展开支持**:
   支持由右侧展开（近边为左边缘）与由左侧展开（近边为右边缘）的几何镜像。

---

# Why it works

1. **欧几里得距离优于曼哈顿距离**:
   人类手部微操移动鼠标时，天生倾向于沿直线向目标（对角线）移动，强制倒 L 形正交移动违背生理直觉。
2. **对路径宽容，对终点严格**:
   只要光标移动的朝向是奔着子菜单去的，系统就宽容其途经的空白与干扰区；一旦到达或明显偏离，安全区立刻退出。

---

# Essential

- 以光标实时位置为顶点、以子菜单近边缘为底边的**动态安全三角形多边形** [Verified]
- 安全区内指针事件保持子菜单开启不中断 [Verified]
- 正常生产环境下安全区**完全隐形不可见**（用户感受其顺畅，但看不见其存在）[Verified]
- 高度防封死约束机制（Height Capping / Directional Escape）[Derived]

---

# Optional

- 使用 DOM + `clip-path: polygon()` 实现，还是纯数学叉积点在三角形内判断 [Verified: DOM polygon 为 Linear 真实做法]
- Linear 的深色界面质感与菜单样式 [Verified 可剥离]
- 调试透视模式（Debug Overlay，用于开发调校）[Derived]

---

# Evidence

| 维度 | 等级 | 说明 |
|---|---|---|
| **Structure** | Verified | Linear 工程师原文完整阐述了父项、子菜单、动态 Safe Area 结构 |
| **Behavior** | Verified | 原文明确解释了欧氏距离对角线直达原理与光标离开判定 |
| **Visual** | Verified | 原文明确声明为完全不可见（零视觉）；调试模式的红色半透明多边形为工程辅助 |
| **Source Code**| Observed | 原文提供了核心关键代码片段（DOM 元素 + clip-path: polygon 函数计算） |

---

# How to reuse

引入 `useSafeTriangle` Hook 并绑定到子菜单容器：
```tsx
import { useRef } from "react";
import { useSafeTriangle } from "./useSafeTriangle";

export function CascadingMenu() {
  const submenuRef = useRef<HTMLDivElement>(null);
  const { style } = useSafeTriangle(submenuRef, {
    enabled: isSubmenuOpen,
    side: "right",
    maxVerticalSpread: 90, // 防遮挡
  });

  return (
    <div className="menu-container">
      <div className="parent-menu">...</div>
      {isSubmenuOpen && (
        <>
          <div ref={submenuRef} className="submenu">...</div>
          {/* 安全三角形遮罩 */}
          <div className="safe-area" style={style} />
        </>
      )}
    </div>
  );
}
```

---

# Demo variants

本原型包含两种方向与调校模式：
1. **右侧展开 (Standard Right Flyout)**：最常见上下文菜单形态。
2. **左侧展开 (Left Flyout)**：当菜单靠近屏幕右侧边界时自动向左镜像展开。
3. **高度防遮挡 (Height Cap)**：开启与关闭对比，验证 tall submenu 不会封死上下两档菜单。
4. **调试透视 (Debug Mode)**：渲染红色半透明三角多边形与 P/A/B 顶点，直观观察光标动量跟踪。

---

# Known limitations

1. **触屏设备不适用**:
   移动端触摸屏无连续 pointermove 轨迹与 hover 状态，该交互为鼠标/触摸板精准指针专享。
2. **极速跳跃甩鼠**:
   若鼠标以极大加速度在 1 帧（>16ms）内直接甩出屏幕或甩离两百像素，可能在事件触发前丢失。
