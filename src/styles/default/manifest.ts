import type { SetupStyle } from "../types";

export const defaultStyle: SetupStyle = {
  id: "default",
  name: "现代沉稳",
  version: "1.0.0",
  subtitle: "Default Neutral",
  description:
    "克制严谨的工业级界面，低饱和度半透明磨砂，注重低干扰与沉浸式文本阅读。",
  inspiration: "Linear / Windows 11 设置 / Raycast 精致克制排版",
  author: "Setup Center Core Team",
  tags: ["低饱和", "克制微光", "中性灰度"],
  palette: {
    baseBg: "#08090b",
    surface: "#14171c",
    cardBorder: "rgba(255, 255, 255, 0.08)",
    accent: "#6ee7d0",
    text: "#e4e7eb",
  },
  features: ["细致微边框", "半透明悬浮面板", "低饱和度指示器"],
  tokens: {
    borderWidth: "1px",
    hardShadow: "0 12px 32px -12px rgba(0, 0, 0, 0.7)",
    borderRadius: "10px",
  },
  designPrinciples: [
    "Neutral Utility — 界面以中性质感退后，最大化保证可读性",
    "Restrained Lighting — 摒弃耀眼光效，采用微弱灰阶透光",
    "Linear Typographic Discipline — 严苛的字重与间距梯度",
  ],
  // Tier 2 — this is the neutral fallback, so it is declared explicitly rather
  // than inherited. It exists so `resolveExperienceProfile` never has to guess
  // what "no profile" means.
  experience: {
    tier: "component",
    shell: "sidebar",
    navigation: "sidebar",
    detail: "rail",
    card: "panel",
    composition: "solid-grid",
    density: "normal",
    motion: "normal",
    ornament: { rule: "hairline", corner: "rounded", decoration: "none", chrome: "none" },
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
