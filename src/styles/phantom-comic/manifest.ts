import type { SetupStyle } from "../types";

/**
 * Phantom Comic — First reference implementation of the SetupStyle contract.
 *
 * Inspiration:
 * - Persona 5 visual language (high contrast, angled badge cuts, dynamic poster rhythm)
 * - American comics & pop art (bold 2px outlines, 0-blur hard geometric shadows)
 * - Modern editorial poster hierarchy
 *
 * Note: Purely algorithmic and layout design language. Does not contain or redistribute
 * any official characters, logos, or copyrighted graphical assets.
 */
export const phantomComicStyle: SetupStyle = {
  id: "phantom-comic",
  name: "P5 × 美漫彩漫",
  version: "1.0.0",
  subtitle: "Comic Impact / Persona 5 Language",
  description:
    "高对比、黑白灰强基底、几何斜切与硬边立体阴影。搭配电光黄与高亮青色点缀，漫画分镜般的视觉张力与海报节奏。",
  inspiration: "女神异闻录 5（P5）平面切割感 + 美式波普漫画海报分镜（纯设计语言，无版权素材）",
  author: "Setup Center Design Lab",
  tags: ["高对比", "强轮廓", "漫画切割", "电光撞色", "硬投影"],
  palette: {
    baseBg: "#0b0d11",
    surface: "#131620",
    cardBorder: "#ffffff",
    accent: "#ffe600",
    accentSecondary: "#00f0ff",
    text: "#f5f6f8",
  },
  features: [
    "每个软件卡片拥有粗硬边轮廓与 4px 漫画立体硬投影",
    "关键标题带几何斜切强调色块与大字重海报排版",
    "强对比状态药丸，已安装与未安装一目了然",
    "操作按钮具备按压触觉反馈与顿挫感",
  ],
  tokens: {
    borderWidth: "2px",
    hardShadow: "4px 4px 0px #000000",
    borderRadius: "8px",
    accentHue: "#ffe600",
  },
  designPrinciples: [
    "Hard Silhouette — 粗硬轮廓打破界面与背景的模糊边界",
    "Offset Geometry — 几何斜切与阴影偏移营造动感张力",
    "High Contrast Drama — 极黑基底与纯亮撞色营造强烈戏剧感",
    "Comic Panel Cadence — 将每个独立模块视为一格引人瞩目的分镜",
  ],
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
