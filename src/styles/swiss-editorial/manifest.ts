import type { SetupStyle } from "../types";

export const swissEditorialStyle: SetupStyle = {
  id: "swiss-editorial",
  name: "瑞士国际主义排版",
  version: "1.0.0",
  subtitle: "Swiss Editorial / Grid Rationalism",
  description:
    "大字阶对比、严苛的模块化网格与不对称版面留白。以纯粹黑白为骨架，配以极具标志性的瑞士红，去芜存菁，以文字排印作为第一视觉驱动力。",
  inspiration: "国际主义平面设计风格（瑞士学派）、Josef Müller-Brockmann 网格体系与现代高阶独立刊物",
  author: "Setup Center Design Lab",
  tags: ["严苛网格", "大字阶", "无衬线纯粹", "瑞士红", "纯直角"],
  palette: {
    baseBg: "#0c0d0f",
    surface: "#14161a",
    cardBorder: "#272a33",
    accent: "#ff3333",
    accentSecondary: "#ffffff",
    text: "#f6f7f9",
  },
  features: [
    "完全摒弃任何圆角，纯直角 0px 极简几何轮廓",
    "超强网格标尺线条与右上角数字工序号 [01, 02...]",
    "极度克制的黑白灰大字阶，关键操作点缀高饱和瑞士红",
    "软件卡片如同画册独立展签，边缘严密对齐且具备明显结构感",
  ],
  tokens: {
    borderWidth: "1.5px",
    hardShadow: "none",
    borderRadius: "0px",
    accentHue: "#ff3333",
  },
  designPrinciples: [
    "Grid Before Decoration — 严谨栅格重于一切装饰",
    "Typography as Primary Hierarchy — 字阶视差作为首要视觉流引导",
    "Absolute Geometric Discipline — 纯粹直角与理智黑白",
    "Restrained Punctuation Color — 仅将高彩瑞士红作为功能性强调",
  ],
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
