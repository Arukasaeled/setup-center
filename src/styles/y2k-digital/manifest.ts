import type { SetupStyle } from "../types";

export const y2kDigitalStyle: SetupStyle = {
  id: "y2k-digital",
  name: "千禧数码 Y2K",
  version: "1.0.0",
  subtitle: "Y2K Digital / Cyber Hardware",
  description:
    "1998～2004 年代早期数码硬件、Winamp 与 MP3 播放器未来主义质感。银蓝反光倒角、高亮电光粉与霓虹青色撞色，兼具怀旧数字美学与趣味。",
  inspiration: "千禧年早期便携数码播放器、Winamp 经典皮肤与太空时代未来主义网页",
  author: "Setup Center Design Lab",
  tags: ["Y2K千禧", "数码播放器", "电光粉青", "金属高光倒角", "数码未来"],
  palette: {
    baseBg: "#0a0e1a",
    surface: "#141c2e",
    cardBorder: "#2a3a5e",
    accent: "#06b6d4",
    accentSecondary: "#f43f5e",
    text: "#f0f6ff",
  },
  features: [
    "斜角高光立体边缘（Beveled Highlight）与金属拉丝微光感",
    "电光青蓝与高亮霓虹粉色交替点缀，还原千禧数码硬件液晶屏氛围",
    "紧凑的数码胶囊按钮与微发光交互提示",
    "软件卡片如同精雕细琢的数码卡带或外置模块",
  ],
  tokens: {
    borderWidth: "1.5px",
    hardShadow: "0 4px 12px rgba(6, 182, 212, 0.25)",
    borderRadius: "14px",
    accentHue: "#06b6d4",
  },
  designPrinciples: [
    "Cyber Tactility — 模拟千禧硬件外壳的立体高光反光质感",
    "Electric Dual Tone — 霓虹青与电光粉呈现早期数码液晶屏活力",
    "Compact Module Feel — 紧凑模块化排布带来便携播放器掌控感",
    "Optimistic Futurism — 传递新世纪初对计算机与网络的无尽向往",
  ],
  // Tier 2. A component theme: the card language and gloss carry it, the shell
  // does not move yet.
  experience: {
    tier: "component",
    shell: "sidebar",
    navigation: "sidebar",
    detail: "rail",
    card: "floating-surface",
    composition: "solid-grid",
    density: "normal",
    motion: "expressive",
    ornament: { rule: "hairline", corner: "rounded", decoration: "noise", chrome: "none" },
    tweakable: ["panelRadius", "controlRadius", "accent", "accentSecondary", "density", "motion"],
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
