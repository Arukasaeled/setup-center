import type { SetupStyle } from "../types";

export const japaneseEditorialStyle: SetupStyle = {
  id: "japanese-editorial",
  name: "和风意境编辑排印",
  version: "1.0.0",
  subtitle: "Japanese Editorial / Wabi-sabi Minimalist",
  description:
    "承袭日本传统装帧与现代独立杂志排版风骨。以微暖和纸米白为底，辅以深邃松墨细线与点睛丹砂印章红。留白深远，字阶克制细腻，传达安宁沉静的技术秩序感。",
  inspiration: "日本独立设计年鉴、《BRUTUS》版面设计、无印良品艺术指导原研哉的留白哲学与江户传统间色",
  author: "Setup Center Design Lab",
  tags: ["和风意境", "极简留白", "丹砂印红", "微暖和纸", "细线装帧"],
  palette: {
    baseBg: "#161719",
    surface: "#1e2023",
    cardBorder: "#2d3036",
    accent: "#e5484d",
    accentSecondary: "#f7f6f0",
    text: "#f1f0eb",
  },
  features: [
    "微微带有宣纸纹理质感的和风素暖底色，视觉柔和不刺眼",
    "采用 2px 精准微倒角与 1px 细若游丝的墨线装帧分隔",
    "关键操作以日本传统「丹砂红」如钤印般点睛，强调仪式感",
    "注重版面透气度与行间韵律，文字阅读如品阅精装文库本",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "0 2px 8px rgba(0,0,0,0.06)",
    borderRadius: "3px",
    accentHue: "#e5484d",
  },
  designPrinciples: [
    "Ma (間) — 留白即是信息本身的延展",
    "Restrained Vermilion — 丹砂红如印章般只落于定夺之选",
    "Delicate Line Weight — 墨线如游丝，构建而不压迫",
  ],
  // Tier 4. A magazine index is mostly whitespace with a very small amount of
  // ink in the right places. Density is `spacious` and motion `reduced` because
  // an editorial page does not animate; the composition does the work.
  experience: {
    tier: "experience",
    shell: "editorial",
    navigation: "sidebar",
    detail: "full-page",
    card: "index-entry",
    composition: "magazine-index",
    density: "spacious",
    motion: "reduced",
    typography: {
      headingFamily: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", Georgia, serif',
      headingScale: 1.15,
      bodyScale: 0.95,
      headingWeight: 500,
      headingTracking: "0.02em",
      bodyLeading: 2,
    },
    ornament: { rule: "hairline", corner: "square", decoration: "none", chrome: "none" },
    tweakable: [
      "borderWidth", "accent", "accentSecondary", "surface", "text",
      "density", "headingScale", "bodyScale", "motion",
    ],
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-03",
};
