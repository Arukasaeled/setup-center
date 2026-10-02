import type { SetupStyle } from "../types";

export const blueprintStyle: SetupStyle = {
  id: "blueprint",
  name: "工程制图蓝图",
  version: "1.0.0",
  subtitle: "Engineering Blueprint / CAD Drawing",
  description:
    "深海工科蓝底、坐标标尺网格与青白细线条 CAD 制图标注。装配公差符号、十字准星与图纸装订框，洋溢着严密的技术制图之美。",
  inspiration: "传统建筑工程蓝图、AutoCAD 技术施工图纸与航空装配图纸",
  author: "Setup Center Design Lab",
  tags: ["技术蓝图", "CAD网格", "青白细线", "十字准星", "公差标注"],
  palette: {
    baseBg: "#07162c",
    surface: "#0c2344",
    cardBorder: "#1e4475",
    accent: "#64ffda",
    accentSecondary: "#93c5fd",
    text: "#e0f2fe",
  },
  features: [
    "经典工程蓝图深海蓝底，带有 24px 精细浅色网格背底纹理",
    "所有容器边框均采用 1px 点划虚线或青白工程细线（#64ffda）",
    "角落带有技术十字标 `+` 与坐标刻度注记",
    "软件卡片如同待装配的标准工程构件图框",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "none",
    borderRadius: "2px",
    accentHue: "#64ffda",
  },
  designPrinciples: [
    "Technical Precision — 以工程制图标准规范界面组件的几何位置",
    "Coordinate System — 背景网格与标注赋予界面可度量性",
    "Blueprint Cyan Contrast — 深海蓝底与青白细线构筑高可读对比",
    "Drafting Annotations — 用轻量角标强化模块身份定位",
  ],
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
