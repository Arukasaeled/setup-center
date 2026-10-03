import type { SetupStyle } from "../types";

export const nordicFrostStyle: SetupStyle = {
  id: "nordic-frost",
  name: "北欧冷霜斯堪的纳维亚",
  version: "1.0.0",
  subtitle: "Nordic Frost / Scandinavian Pristine Space",
  description:
    "汲取自北欧自然风光、冰川湖泊与斯堪的纳维亚现代人本设计。纯净开阔的留白、柔和冷调石板蓝（Slate & Ice Blue）、温润的 8px 倒角与清透的高斯模糊光影，打造极度松弛且高专注度的开发空间。",
  inspiration: "斯德哥尔摩室内空间设计、Bang & Olufsen 经典人本硬件、挪威峡湾清冷自然晨雾",
  author: "Setup Center Design Lab",
  tags: ["北欧极简", "冰川冷霜", "清澈通透", "人本温润", "低压专注"],
  palette: {
    baseBg: "#0f172a",
    surface: "#1e293b",
    cardBorder: "#334155",
    accent: "#38bdf8",
    accentSecondary: "#94a3b8",
    text: "#f8fafc",
  },
  features: [
    "温润舒缓的 8px 圆角与微高斯模糊面板，彻底消除硬锐棱角带来的视觉疲劳",
    "北欧冰川湖蓝色作为功能激活色，清冽而不张扬",
    "宽绰的呼吸留白与极为自然的文字阶梯，长时间专注依然保持宁静心境",
    "兼顾极简主义与人本关怀，现代全栈工程师与创作者的理想庇护所",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "0 4px 20px rgba(15, 23, 42, 0.25)",
    borderRadius: "8px",
    accentHue: "#38bdf8",
  },
  designPrinciples: [
    "Pristine Negative Space — 纯净开阔的空间呼吸感",
    "Gentle Tactile Radius — 8px 柔润曲率赋予人本温度",
    "Calm Deep Slate — 深邃石板灰消弭屏幕高频刺眼亮斑",
  ],
  // Tier 4. Promoted from a Tier-2 component theme after the similarity audit:
  // sharing `sidebar|sidebar|rail|panel|solid-grid|normal|reduced` with three
  // other experiences made this a reskin regardless of how calm its palette
  // was. Scandinavian design is not "grey cards" — it is a centred reading
  // column, an absence of boxes, and hairline rules doing the dividing. That
  // is a composition claim, so it needs composition grammar: no card frames
  // (borderless-group), a ruled column (roadmap), a slim command bar instead
  // of a rail, and the detail as a modal so opening one item does not push the
  // calm column sideways.
  experience: {
    tier: "experience",
    shell: "command-centered",
    navigation: "command-bar",
    detail: "modal",
    card: "borderless-group",
    composition: "roadmap",
    density: "spacious",
    motion: "reduced",
    ornament: { rule: "hairline", corner: "rounded", decoration: "none", chrome: "none" },
    tweakable: ["panelRadius", "controlRadius", "accent", "surface", "density", "motion"],
    specimenNote: "没有盒子：条目之间靠留白与细线分开，不在灰色边框里。",
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-03",
};
