import type { SetupStyle } from "../types";

export const retroMacStyle: SetupStyle = {
  id: "retro-mac",
  name: "复古苹果麦金塔 (System 7)",
  version: "1.0.0",
  subtitle: "Retro Mac / System 7 & Platinum OS",
  description:
    "致敬 1990 年代经典的 Apple Macintosh System 7 与 Mac OS 8 铂金设计语言。细条纹标题栏装饰（Pinstripes）、1-bit 点阵抖动纹理（Dithered Patterns）与具有轻微浮雕立体感的经典倒角控件。",
  inspiration: "Apple Macintosh System 7.5、Mac OS 8 Platinum 界面、Susan Kare 经典位图图标设计",
  author: "Setup Center Design Lab",
  tags: ["麦金塔", "System7", "铂金灰", "点阵细纹", "复古经典"],
  palette: {
    baseBg: "#2c2d30",
    surface: "#3a3c42",
    cardBorder: "#1a1b1e",
    accent: "#6677aa",
    accentSecondary: "#cccccc",
    text: "#f0f2f5",
  },
  features: [
    "经典的条纹标题栏排布，完美还原早期 Mac OS 窗口顶部把手",
    "具有 1px 细黑边框包裹与 1-bit 点阵质感的立体微浮雕按键",
    "复古 Chicago 经典字型视感，排版紧凑清晰、层级一目了然",
    "让现代开发环境拥抱个人计算机黎明时期的优雅与纯粹工业美学",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "2px 2px 0px #000000",
    borderRadius: "2px",
    accentHue: "#6677aa",
  },
  designPrinciples: [
    "Pinstripe Clarity — 细密条纹区分活动区域与拖拽句柄",
    "Tactile 1-Bit Dither — 1 位位图阴影呈现经典硬件手感",
    "Friendly Desktop Metaphor — 亲和温暖的桌面隐喻与坚实轮廓",
  ],
  // Tier 4. The claim in this manifest has always been "System 7"; a menu bar
  // and a window chrome are what make that true, so the shell is `windowed` and
  // the navigation is a `menu-bar` rather than a sidebar.
  experience: {
    tier: "experience",
    shell: "windowed",
    navigation: "menu-bar",
    detail: "window",
    card: "window",
    composition: "finder-list",
    density: "compact",
    motion: "normal",
    typography: {
      headingFamily: 'Geneva, "Chicago", "Lucida Grande", "PingFang SC", sans-serif',
      headingScale: 0.95,
      headingWeight: 700,
    },
    ornament: { rule: "double", corner: "rounded", decoration: "pinstripe", chrome: "title-menu" },
    tweakable: ["panelRadius", "controlRadius", "accent", "shadow", "density", "motion"],
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-03",
};
