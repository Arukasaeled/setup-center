import type { SetupStyle } from "../types";

export const monochromeResearchStyle: SetupStyle = {
  id: "monochrome-research",
  name: "黑白学术论文研讨论壇",
  version: "1.0.0",
  subtitle: "Monochrome Research / Scientific Monograph",
  description:
    "极致冷峻、毫无色彩杂质干扰的纯粹双色世界。汲取自顶级计算机科学论文、物理学专著与早期贝尔实验室技术报告。严谨的数学衬线体对比、纯黑纯白硬轮廓与清晰的数据标尺排布。",
  inspiration: "ACM/IEEE 汇刊学术排版、LaTeX 经典 Computer Modern 排版体系与贝尔实验室技术备忘录",
  author: "Setup Center Design Lab",
  tags: ["纯粹黑白", "学术严谨", "LaTeX风骨", "论文排印", "零杂色"],
  palette: {
    baseBg: "#080808",
    surface: "#121212",
    cardBorder: "#2a2a2a",
    accent: "#ffffff",
    accentSecondary: "#a0a0a0",
    text: "#f8f8f8",
  },
  features: [
    "完全剔除任何彩色色相，仅依靠黑度、字重与字阶视差建立严密层级",
    "学术论文分栏线与带有论文编号感的数据网格装饰标签",
    "按钮采用反相高对比几何框，悬停实现经典黑白颠倒翻转反馈",
    "专为长文本深入技术研读与代码审阅打造的零视觉疲劳环境",
  ],
  tokens: {
    borderWidth: "1.5px",
    hardShadow: "0 0 0 1px #000000",
    borderRadius: "0px",
    accentHue: "#ffffff",
  },
  designPrinciples: [
    "Zero Color Contamination — 零色彩污染，专注技术逻辑本质",
    "Bipolar Contrast — 黑白两极反差，如油墨压印白纸般清澈",
    "Mathematical Orthogonality — 纯正水平与垂直线构成的空间格律",
  ],
  // Tier 2. Ink on paper, single accent. The accent is the only colour knob that
  // makes sense here, so the rest is closed rather than offered and ignored.
  experience: {
    tier: "component",
    shell: "sidebar",
    navigation: "sidebar",
    detail: "rail",
    card: "index-entry",
    composition: "solid-grid",
    density: "spacious",
    motion: "reduced",
    ornament: { rule: "hairline", corner: "square", decoration: "none", chrome: "none" },
    tweakable: ["accent", "text", "density", "headingScale"],
    locked: { panelRadius: "单一墨色版式靠细线分栏，圆角会引入不属于这里的形状语言。" },
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-03",
};
