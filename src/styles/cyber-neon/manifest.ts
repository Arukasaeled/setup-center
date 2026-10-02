import type { SetupStyle } from "../types";

export const cyberNeonStyle: SetupStyle = {
  id: "cyber-neon",
  name: "赛博霓虹脉冲",
  version: "1.0.0",
  subtitle: "Cyber Neon Pulse / Synthwave HUD",
  description:
    "深邃午夜暗黑背景、极光霓虹电光青与脉冲洋红光晕。高对比 HUD 边框与暗夜荧光质感，充满次时代赛博美学张力与未来技术沉浸感。",
  inspiration: "Cyberpunk 2077 HUD、Synthwave 80s 极光与夜之城全息霓虹广告",
  author: "Setup Center Design Lab",
  tags: ["赛博朋克", "荧光脉冲", "霓虹光晕", "HUD界面", "午夜极光"],
  palette: {
    baseBg: "#080910",
    surface: "#10121f",
    cardBorder: "#2d3356",
    accent: "#00f0ff",
    accentSecondary: "#ff007f",
    text: "#e2e8f0",
  },
  features: [
    "电光青与脉冲洋红双色辉光，呈现强烈赛博空间战术感",
    "微妙的背景数字栅格（32px Grid）点缀",
    "高对比发光按钮与暗夜霓虹描边反馈",
    "专为极具个性与未来感的极客开发者打造",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "0 0 16px rgba(0, 240, 255, 0.2)",
    borderRadius: "4px",
    accentHue: "#00f0ff",
  },
  designPrinciples: [
    "High Voltage Contrast — 纯粹暗夜背景下激活激光电光色",
    "Neon Halo Bloom — 关键交互元素伴有柔和彩色荧光辉光",
    "Tactical HUD Grid — 锐利几何倒角与战术 HUD 仪表感",
  ],
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-03",
};
