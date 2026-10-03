import type { SetupStyle } from "../types";

export const swissDarkStyle: SetupStyle = {
  id: "swiss-dark",
  name: "瑞士国际暗黑先锋",
  version: "1.0.0",
  subtitle: "Swiss Dark / International Typographic Black",
  description:
    "瑞士国际主义网格在绝对纯黑环境下的先锋演绎。纯碳黑骨架衬托极高辨识度的国际安全橙（Safety Orange #ff5500）。0px 纯直角边缘切角、大字阶排印视差与工业指示牌般的视觉传达速度。",
  inspiration: "苏黎世机场视觉导视体系、Max Bill 纯粹几何构成与现代高阶暗黑开发者工具（如 Linear / Warp）",
  author: "Setup Center Design Lab",
  tags: ["瑞士暗黑", "国际安全橙", "绝对纯直角", "大字阶", "高冲击力"],
  palette: {
    baseBg: "#050608",
    surface: "#0e1014",
    cardBorder: "#1f222a",
    accent: "#ff5500",
    accentSecondary: "#ffffff",
    text: "#ffffff",
  },
  features: [
    "绝对纯直角 0px 严苛切角，摒弃任何多余圆弧与发光弥散",
    "高对比国际安全橙作为关键操作指引，视线捕获毫秒级命中",
    "精密数据网格标尺与右上角工业流水号装饰",
    "深度适配暗光与多显示器高强度开发环境，极低散射眩光",
  ],
  tokens: {
    borderWidth: "1.5px",
    hardShadow: "none",
    borderRadius: "0px",
    accentHue: "#ff5500",
  },
  designPrinciples: [
    "Pure Orthogonal Grid — 绝对正交的二维空间坐标排布",
    "Safety Orange Punctuation — 借用工业警示橙达到最高清晰度",
    "No Ambient Clutter — 拒绝环境光晕，保持锋利边界",
  ],
  // Tier 3. The dark counterpart to the Swiss composition. The similarity audit
  // found it sharing a grammar with three unrelated experiences, so the grid is
  // now on the OTHER axis: a strip across the top (stacked shell + tab-strip
  // navigation) with a full-width ledger of flat rows beneath. International
  // Typographic Style is a grid discipline, and a single ruled column with
  // tab-strip navigation is the strictest reading of it — not a card wall.
  experience: {
    tier: "composition",
    shell: "stacked",
    navigation: "tab-strip",
    detail: "window",
    card: "sticker",
    composition: "ledger",
    density: "compact",
    motion: "reduced",
    ornament: { rule: "hairline", corner: "square", decoration: "none", chrome: "none" },
    tweakable: ["accent", "surface", "density", "headingScale", "bodyScale"],
    locked: {
      panelRadius: "国际主义版式只有直角；圆角会削弱网格的严格性。",
    },
    specimenNote: "导航压成顶部标签带，内容是一条通栏账册，不是卡片墙。",
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-03",
};
