import type { SetupStyle } from "../types";

export const newspaperEditorialStyle: SetupStyle = {
  id: "newspaper-editorial",
  name: "复古报刊社论",
  version: "1.0.0",
  subtitle: "Newspaper Editorial / Cultural Press",
  description:
    "米黄墨香新闻纸质感、优雅报刊衬线体大标题与双线专栏分割。将严谨的社论出版物风范融入开发中心，浓厚的人文阅读质感。",
  inspiration: "《纽约时报》、独立文化刊物、传统排印学（Typography）与历史经典印刷品",
  author: "Setup Center Design Lab",
  tags: ["报章社论", "复古纸张", "优雅衬线", "双线装订", "文化出版物"],
  palette: {
    baseBg: "#141311",
    surface: "#1c1a17",
    cardBorder: "#38332c",
    accent: "#c2410c",
    accentSecondary: "#d97706",
    text: "#f5f0e8",
  },
  features: [
    "优雅衬线标题排印（Georgia / Serif），带来沉浸式人文出版物阅读感",
    "暖墨黑与温润米黄纸质层次，极度护眼且具备浓郁油墨印刷质感",
    "专栏双横线装订边与卷号章节角标标注",
    "软件卡片如同精修的副刊专栏专稿，图文排布讲究考究",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "none",
    borderRadius: "2px",
    accentHue: "#c2410c",
  },
  designPrinciples: [
    "Serif Elegance — 衬线字体赋予工业软件浓厚的人文出版沉淀",
    "Column Architecture — 双线与专栏规则建立从容的阅读节奏",
    "Warm Paper Harmony — 温润纸张灰度最大程度降低视觉疲劳",
    "Editorial Dignity — 每一个条目都如同一篇值得驻足的精校专稿",
  ],
  // Tier 4. A masthead, rules between sections and real multi-column text. Radius
  // is locked: newsprint has no rounded corners.
  experience: {
    tier: "experience",
    shell: "editorial",
    navigation: "topbar",
    detail: "sheet",
    card: "editorial-block",
    composition: "news-columns",
    density: "compact",
    motion: "reduced",
    typography: {
      headingFamily: '"Songti SC", "Source Han Serif SC", Georgia, "Times New Roman", serif',
      headingScale: 1.1,
      headingWeight: 700,
      headingTracking: "-0.01em",
      bodyLeading: 1.7,
    },
    ornament: { rule: "double", corner: "square", decoration: "none", chrome: "full" },
    tweakable: ["accent", "text", "density", "headingScale", "bodyScale"],
    locked: {
      panelRadius: "报纸版面以直角与细线分栏，圆角会消解版面结构。",
      controlRadius: "同上：印刷版面没有圆角控件。",
    },
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
