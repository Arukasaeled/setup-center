import type { SetupStyle } from "../types";

export const spatialGlassStyle: SetupStyle = {
  id: "spatial-glass",
  name: "空间微光毛玻璃",
  version: "1.0.0",
  subtitle: "Spatial Glass / Optical Refraction",
  description:
    "深邃天体黑夜、高饱和多层混合毛玻璃与精致细腻的 1px 晶体折射高光。融合 VisionOS 空间层次感与超大连续圆角曲率，通透而宁静。",
  inspiration: "Apple VisionOS、macOS Sonoma 空间物理界面与次世代硬件控制面板",
  author: "Setup Center Design Lab",
  tags: ["空间多维", "高饱和模糊", "晶体折射高光", "天青微光", "超大平滑圆角"],
  palette: {
    baseBg: "#070a12",
    surface: "rgba(18, 24, 38, 0.65)",
    cardBorder: "rgba(255, 255, 255, 0.12)",
    accent: "#38bdf8",
    accentSecondary: "#818cf8",
    text: "#f0f6fc",
  },
  features: [
    "每个卡片采用 32px 高度饱和磨砂毛玻璃与 1px 顶部微光晶体折射内阴影",
    "超大连续平滑圆角（16px ~ 20px），温润如鹅卵石与精密光学镜片",
    "悬停时产生柔和的光晕聚集与发光边界扩散",
    "软件卡片如同浮动于深邃星空中的独立全息操作板",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "0 20px 50px -15px rgba(0, 0, 0, 0.8)",
    borderRadius: "18px",
    accentHue: "#38bdf8",
  },
  designPrinciples: [
    "Optical Refraction — 顶部 1px 高光赋予材质真实物理折射感",
    "Depth Hierarchy — 多重半透明模糊层级构建真实景深",
    "Smooth Continuous Curvature — 超大平滑曲率带来柔和未来感",
    "Restrained Luminance — 仅在悬停与焦点时注入天青色冷光",
  ],
  // Tier 4. Depth, not fog: content sits on a canvas, navigation floats above it
  // as a dock, and the inspector is a separate plane. Border width is locked
  // because a stroked edge flattens the layers this experience is built from.
  experience: {
    tier: "experience",
    shell: "canvas",
    navigation: "dock",
    detail: "floating-inspector",
    card: "floating-surface",
    composition: "floating-panels",
    density: "spacious",
    motion: "expressive",
    ornament: { rule: "none", corner: "rounded", decoration: "noise", chrome: "none" },
    tweakable: [
      "panelRadius", "controlRadius", "shadow", "accent", "accentSecondary",
      "surface", "density", "motion",
    ],
    locked: {
      borderWidth: "玻璃面板靠阴影与色阶分层，描边会把它压回同一个平面。",
    },
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
