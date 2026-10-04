import type { SetupStyle } from "../types";

export const blueprintDraftingStyle: SetupStyle = {
  id: "blueprint-drafting",
  name: "蓝图制图",
  version: "1.0.0",
  subtitle: "Technical Blueprint Drafting / CAD Engineering",
  description:
    "严谨工程制图与建筑图纸语言。坐标标尺、尺寸标注引线、图纸编号、装配标题栏与公差注记，极少颜色，纯正工程图纸构件感。",
  inspiration: "建筑施工蓝图、AutoCAD 技术装配图纸与精密机械制图标注规范（非单纯蓝底换色，重构图纸装配语法）",
  author: "Setup Center Design Lab",
  tags: ["技术蓝图", "工程制图", "CAD网格", "尺寸线", "标题栏", "十字准星"],
  palette: {
    baseBg: "#061426",
    surface: "#0d2544",
    cardBorder: "#1e4475",
    accent: "#00f5d4",
    accentSecondary: "#facc15",
    text: "#dff2fe",
  },
  features: [
    "工程图纸四边装订框与毫米/英寸坐标刻度标尺，建立可度量界面尺度",
    "各模块包含专属图纸编号、图层标记（LAYER: CORE）与装配公差注记",
    "尺寸标注线（|← 380mm →|）与十字校准准星（⊕）自然融合于交互反馈",
    "右上角标有标准工程标题栏（DWG NO / SCALE 1:1 / APPROVED）",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "none",
    borderRadius: "0px",
    accentHue: "#00f5d4",
  },
  designPrinciples: [
    "Engineering Annotation — 每一个界面容器都是待装配的图纸构件，携带图号与注记",
    "Dimension Hierarchy — 尺寸线与细虚线构成信息排布的骨架，拒绝普通无结构卡片",
    "Disciplined Monochrome — 深海工科蓝底搭配青白细线条与极少镉黄标注，严守制图色彩纪律",
    "Crosshair Alignment — 角落十字标与坐标格点提供毫厘不差的工科对齐美学",
  ],
  experience: {
    tier: "experience",
    shell: "topbar",
    navigation: "command-bar",
    detail: "sheet",
    card: "tile",
    composition: "drafting-index",
    density: "compact",
    motion: "reduced",
    typography: {
      headingFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      bodyFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
      monoFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      headingScale: 1.0,
      bodyScale: 0.95,
      headingWeight: 600,
      headingTracking: "0.04em",
    },
    ornament: {
      rule: "dashed",
      corner: "square",
      decoration: "blueprint",
      chrome: "title",
    },
    tweakable: [
      "borderWidth",
      "shadow",
      "accent",
      "accentSecondary",
      "surface",
      "text",
      "density",
      "motion",
    ],
    locked: {
      panelRadius: "工程图纸与技术施工规范严格采用直角边界，直角是图纸规约的一部分。",
      controlRadius: "图纸标注符号与操作图框均为直角基元。",
    },
    specimenNote: "技术蓝图标尺、尺寸标注引线与工程标题栏构件",
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-04",
};

export default blueprintDraftingStyle;
