import type { VaultStyleManifest } from "../types";

export const STYLES_PART_A: Record<string, VaultStyleManifest> = {
  blueprint: {
    id: "blueprint",
    name: "工程制图蓝图",
    version: "1.1.0",
    subtitle: "Engineering Blueprint / CAD Drawing",
    description: "深海工科蓝底、坐标标尺网格与青白细线条 CAD 制图标注。装配公差符号、十字准星与图纸装订框，洋溢着严密的技术制图之美。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "传统建筑工程蓝图、AutoCAD 技术施工图纸与航空装配图纸",
    tags: ["技术蓝图", "CAD网格", "青白细线", "十字准星", "公差标注"],
    cssPath: "blueprint.css",
    palette: {
      bg: "#061527",
      text: "#e0f2fe",
      primary: "#64ffda",
      surface: "#0b223f",
      border: "#23548f",
    },
    tokens: {
      cardRadius: "2px",
      borderWidth: "1px",
      shadowDepth: "0px",
      fontHeading: "monospace",
      fontBody: "system-ui, sans-serif",
    },
    experience: {
      tier: "experience",
      shell: "topbar",
      navigation: "command-bar",
      detail: "floating-inspector",
      card: "tile",
      composition: "drafting-index",
      density: "compact",
      motion: "reduced",
      typography: {
        headingFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
        headingScale: 1,
        bodyScale: 0.95,
        headingWeight: 600,
        headingTracking: "0.04em",
      },
      ornament: { rule: "dashed", corner: "square", decoration: "blueprint", chrome: "status" },
      tweakable: ["borderWidth", "accent", "accentSecondary", "text", "density", "motion"],
      locked: {
        panelRadius: "工程图纸没有圆角——直角是制图规范的一部分。",
        controlRadius: "同上：标注线与图框均为直角。",
      },
      specimenNote: "图纸是量出来的：所有间距都落在网格上，直角是规范而不是风格。",
    },
    designPrinciples: [
      "Technical Precision — 以工程制图标准规范界面组件的几何位置",
      "Coordinate System — 背景网格与标注赋予界面可度量性",
      "Blueprint Cyan Contrast — 深海蓝底与青白细线构筑高可读对比",
      "Drafting Annotations — 用轻量角标强化模块身份定位",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: blueprint (工程制图蓝图)
   ========================================================================== */

:root[data-style="blueprint"] {
  --surface-base: #061527;
  --surface-raised: #0b223f;
  --surface-overlay: rgba(11, 34, 63, 0.98);
  --surface-overlay-soft: rgba(14, 42, 78, 0.94);
  --surface-sunken: #040e1b;
  --surface-hover: rgba(100, 255, 218, 0.08);
  --surface-active: #64ffda;
  --surface-inset: #0e2b4f;

  --text-strong: #ffffff;
  --text-primary: #e0f2fe;
  --text-secondary: #bae6fd;
  --text-tertiary: #7dd3fc;
  --text-quiet: #38bdf8;
  --text-inverse: #061527;

  --line-subtle: #173b66;
  --line-default: #23548f;
  --line-strong: #64ffda;

  --status-ok: #64ffda;
  --status-warn: #fde047;
  --status-bad: #f87171;
  --status-accent: #64ffda;
  --status-accent-soft: rgba(100, 255, 218, 0.16);

  --font-mono: "Courier New", "Cascadia Code", Consolas, monospace;
  --radius-panel: 2px;
  --radius-control: 2px;
}

[data-style="blueprint"] :is([data-resource-card], [data-style-card], [data-software-row], input, button) {
  border-radius: 2px !important;
}

/* Blueprint subtle grid on the app field */
[data-style="blueprint"].app-field,
[data-style="blueprint"] main {
  background-image: 
    linear-gradient(rgba(100, 255, 218, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(100, 255, 218, 0.04) 1px, transparent 1px) !important;
  background-size: 24px 24px !important;
}

/* Nav */
[data-style="blueprint"] nav[aria-label="导航"] {
  border-right: 1px solid #23548f;
  background: var(--surface-base);
}

[data-style="blueprint"] nav[aria-label="导航"] button[aria-current="page"] {
  background: rgba(100, 255, 218, 0.12) !important;
  color: #64ffda !important;
  border-left: 3px solid #64ffda !important;
  font-weight: 700;
}

/* CAD Blueprint software frame card */
[data-style="blueprint"] [data-software-row] {
  border: 1px dashed #2a63a5 !important;
  background: var(--surface-raised) !important;
  box-shadow: none !important;
  position: relative;
  transition: all 120ms ease;
}

[data-style="blueprint"] [data-software-row]::after {
  content: "+";
  position: absolute;
  top: 4px;
  right: 6px;
  font-size: 11px;
  color: #38bdf8;
  font-family: monospace;
}

[data-style="blueprint"] [data-software-row]:hover {
  border: 1px solid #64ffda !important;
  background: #0e2b4f !important;
}

[data-style="blueprint"] [data-software-row][aria-pressed="true"],
[data-style="blueprint"] [data-software-row][aria-expanded="true"] {
  border: 1px solid #64ffda !important;
  box-shadow: 0 0 0 1px #64ffda, inset 0 0 10px rgba(100, 255, 218, 0.1) !important;
}

[data-style="blueprint"] [data-software-row] .software-row-icon-tray {
  border: 1px solid #23548f;
  background: var(--surface-sunken);
}

/* Blueprint Action button */
[data-style="blueprint"] button.bg-\\[color\\:var\\(--status-accent\\)\\] {
  background: #64ffda !important;
  color: #061527 !important;
  font-weight: 800;
  letter-spacing: 0.04em;
  border: 1px solid #a7f3d0;
}`,
  },

  "y2k-digital": {
    id: "y2k-digital",
    name: "千禧数码未来",
    version: "1.1.0",
    subtitle: "Y2K Digital / Frutiger Aero / Early 2000s Web",
    description: "晶莹天蓝高光、全息微彩反光、液态果冻圆角与千禧年初期的数码乐观主义界面美学。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "Windows Media Player 9/10 皮肤、早年 Winamp、Sony Vaio 界面与 Frutiger Aero",
    tags: ["Y2K", "果冻高光", "全息微彩", "数码乐观主义", "圆润水晶"],
    cssPath: "y2k-digital.css",
    palette: {
      bg: "#0b192e",
      text: "#e0f2fe",
      primary: "#38bdf8",
      surface: "#132d52",
      border: "#22d3ee",
    },
    tokens: {
      cardRadius: "16px",
      borderWidth: "1.5px",
      shadowDepth: "4px",
      fontHeading: "system-ui, sans-serif",
      fontBody: "system-ui, sans-serif",
    },
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
      tokens: {
        shadow: {
          offsetX: "0px",
          offsetY: "4px",
          blur: "12px",
          spread: "0px",
          color: "rgba(6, 182, 212, 0.25)",
        },
      },
      tweakable: ["panelRadius", "controlRadius", "accent", "accentSecondary", "density", "motion"],
      specimenNote: "大圆角果冻面 + 全息噪点；圆角本身就是这套体验的身份。",
    },
    designPrinciples: [
      "Aero Luster — 晶莹高光与液态渐变呈现科技质感",
      "Digital Optimism — 明亮天空蓝与全息彩斑传递探索生机",
      "Soft Rounded Silhouettes — 大圆角与柔和阴影消解界面的锐利感",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: y2k-digital (千禧数码 Y2K)
   ========================================================================== */

:root[data-style="y2k-digital"] {
  --surface-base: #090d18;
  --surface-raised: #131b2e;
  --surface-overlay: rgba(19, 27, 46, 0.98);
  --surface-overlay-soft: rgba(23, 34, 58, 0.94);
  --surface-sunken: #060810;
  --surface-hover: rgba(6, 182, 212, 0.1);
  --surface-active: #06b6d4;
  --surface-inset: #1a253d;

  --text-strong: #ffffff;
  --text-primary: #f0f6ff;
  --text-secondary: #c3d3ee;
  --text-tertiary: #8fa5cb;
  --text-quiet: #617397;
  --text-inverse: #090d18;

  --line-subtle: #212f4d;
  --line-default: #324773;
  --line-strong: #06b6d4;

  --status-ok: #06b6d4;
  --status-warn: #fbbf24;
  --status-bad: #f43f5e;
  --status-accent: #06b6d4;
  --status-accent-soft: rgba(6, 182, 212, 0.18);

  --radius-panel: 14px;
  --radius-control: 8px;
}

/* Nav */
[data-style="y2k-digital"] nav[aria-label="导航"] {
  border-right: 1.5px solid #2a3a5e;
  background: var(--surface-base);
}

[data-style="y2k-digital"] nav[aria-label="导航"] button[aria-current="page"] {
  background: linear-gradient(180deg, #1e2c4a 0%, #111a2e 100%) !important;
  color: #06b6d4 !important;
  border: 1.5px solid #06b6d4 !important;
  box-shadow: 0 0 10px rgba(6, 182, 212, 0.3) !important;
  font-weight: 700;
}

/* Y2K Gadget module software card */
[data-style="y2k-digital"] [data-software-row] {
  border: 1.5px solid #2d3e64 !important;
  background: linear-gradient(180deg, #162035 0%, #101828 100%) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 4px 10px rgba(0, 0, 0, 0.4) !important;
  border-radius: 12px !important;
  transition: all 140ms ease;
}

[data-style="y2k-digital"] [data-software-row]:hover {
  border-color: #06b6d4 !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 0 14px rgba(6, 182, 212, 0.35) !important;
}

[data-style="y2k-digital"] [data-software-row][aria-pressed="true"],
[data-style="y2k-digital"] [data-software-row][aria-expanded="true"] {
  border-color: #f43f5e !important;
  box-shadow: 0 0 16px rgba(244, 63, 94, 0.4) !important;
}

[data-style="y2k-digital"] [data-software-row] .software-row-icon-tray {
  border: 1px solid #384c70;
  background: #090e1a;
  border-radius: 8px !important;
}

/* Y2K Metallic/Glow Button */
[data-style="y2k-digital"] button.bg-\\[color\\:var\\(--status-accent\\)\\] {
  background: linear-gradient(180deg, #22d3ee 0%, #0891b2 100%) !important;
  color: #ffffff !important;
  font-weight: 800;
  border: 1px solid #67e8f9 !important;
  box-shadow: 0 0 12px rgba(6, 182, 212, 0.4) !important;
}`,
  },

  "newspaper-editorial": {
    id: "newspaper-editorial",
    name: "经典新闻铅印",
    version: "1.1.0",
    subtitle: "Broadsheet Newspaper / Ink Editorial",
    description: "百年大报报纸排版、报头刊头、多栏细线分栏与黑色油墨铅印质感。内容以头条层级组织，而不是以卡片组织。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "The New York Times、The Wall Street Journal 头版排版及经典活字铅印报刊",
    tags: ["经典报刊", "铅印油墨", "大号衬线", "双栏细线", "新闻头条"],
    cssPath: "newspaper-editorial.css",
    palette: {
      bg: "#f9f8f4",
      text: "#111111",
      primary: "#8b0000",
      surface: "#ffffff",
      border: "#222222",
    },
    tokens: {
      cardRadius: "0px",
      borderWidth: "1px",
      shadowDepth: "0px",
      fontHeading: "'Georgia', 'Times New Roman', serif",
      fontBody: "'Georgia', 'Times New Roman', serif",
    },
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
      specimenNote: "报头压顶、多栏正文、双线分栏——条目是版面，不是卡片。",
    },
    designPrinciples: [
      "Editorial Dignity — 报业大标题与分栏细线构建庄严内容阵列",
      "Typography as Structure — 用衬线体笔锋和字级阶梯引导视线阅读",
      "Physical Paper Quality — 新闻纸米白底色配合高对比墨黑文字",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: newspaper-editorial (复古报刊社论)
   ========================================================================== */

:root[data-style="newspaper-editorial"]:not([data-theme="light"]) {
  --surface-base: #131210;
  --surface-raised: #1c1a16;
  --surface-overlay: rgba(28, 26, 22, 0.98);
  --surface-overlay-soft: rgba(33, 30, 26, 0.94);
  --surface-sunken: #0c0b09;
  --surface-hover: rgba(194, 65, 12, 0.08);
  --surface-active: #c2410c;
  --surface-inset: #24211d;

  --text-strong: #ffffff;
  --text-primary: #f5f0e8;
  --text-secondary: #cdc5b6;
  --text-tertiary: #9c9384;
  --text-quiet: #6d665a;
  --text-inverse: #131210;

  --line-subtle: #2d2924;
  --line-default: #474139;
  --line-strong: #c2410c;

  --status-ok: #15803d;
  --status-warn: #b45309;
  --status-bad: #b91c1c;
  --status-accent: #c2410c;
  --status-accent-soft: rgba(194, 65, 12, 0.16);

  --font-serif: Georgia, "Noto Serif SC", Cambria, serif;
  --radius-panel: 3px;
  --radius-control: 2px;
}

:root[data-style="newspaper-editorial"][data-theme="light"] {
  --surface-base: #f5f1e8;
  --surface-raised: #fdfbf7;
  --surface-overlay: rgba(253, 251, 247, 0.98);
  --surface-overlay-soft: rgba(245, 241, 232, 0.94);
  --surface-sunken: #e9e3d5;
  --surface-hover: rgba(194, 65, 12, 0.06);
  --surface-active: #9a3412;
  --surface-inset: #ede7da;

  --text-strong: #1c1917;
  --text-primary: #292524;
  --text-secondary: #57534e;
  --text-tertiary: #78716c;
  --text-quiet: #a8a29e;
  --text-inverse: #ffffff;

  --line-subtle: #ded8cb;
  --line-default: #b8b09f;
  --line-strong: #9a3412;

  --status-ok: #15803d;
  --status-warn: #b45309;
  --status-bad: #b91c1c;
  --status-accent: #9a3412;
  --status-accent-soft: rgba(154, 52, 18, 0.15);

  --font-serif: Georgia, "Noto Serif SC", Cambria, serif;
  --radius-panel: 3px;
  --radius-control: 2px;
}

[data-style="newspaper-editorial"] h1,
[data-style="newspaper-editorial"] h2,
[data-style="newspaper-editorial"] h3 {
  font-family: var(--font-serif) !important;
  font-weight: 700;
  letter-spacing: -0.01em;
}

[data-style="newspaper-editorial"] nav[aria-label="导航"] {
  border-right: 1px solid var(--line-default);
  background: var(--surface-base);
}

[data-style="newspaper-editorial"] nav[aria-label="导航"] button[aria-current="page"] {
  background: var(--surface-raised) !important;
  color: var(--status-accent) !important;
  border-bottom: 2px solid var(--status-accent) !important;
  font-weight: 700;
}

[data-style="newspaper-editorial"] [data-software-row] {
  border: 1px solid var(--line-default) !important;
  border-top: 2px solid var(--line-strong) !important;
  background: var(--surface-raised) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15) !important;
  transition: all 120ms ease;
}

[data-style="newspaper-editorial"] [data-software-row]:hover {
  border-color: var(--status-accent) !important;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25) !important;
}

[data-style="newspaper-editorial"] [data-software-row] .software-row-name {
  font-family: var(--font-serif);
  font-weight: 700;
  font-size: 15px;
}

[data-style="newspaper-editorial"] [data-software-row] .software-row-icon-tray {
  border: 1px solid var(--line-default);
  background: var(--surface-sunken);
}

[data-style="newspaper-editorial"] button.bg-\\[color\\:var\\(--status-accent\\)\\] {
  background: var(--status-accent) !important;
  color: #ffffff !important;
  font-family: var(--font-serif);
  font-weight: 700;
  border: 1px solid #7c2d12;
}`,
  },

  "cyber-neon": {
    id: "cyber-neon",
    name: "赛博霓虹脉冲",
    version: "1.1.0",
    subtitle: "Cyber Neon Pulse / Synthwave HUD",
    description: "深邃午夜暗黑背景、极光霓虹电光青与脉冲洋红光晕。高对比 HUD 边框与暗夜荧光质感，充满次时代赛博美学张力与未来技术沉浸感。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "Cyberpunk 2077 HUD、Synthwave 80s 极光与夜之城全息霓虹广告",
    tags: ["赛博朋克", "荧光脉冲", "霓虹光晕", "HUD界面", "午夜极光"],
    cssPath: "cyber-neon.css",
    palette: {
      bg: "#080910",
      text: "#e2e8f0",
      primary: "#00f0ff",
      surface: "#10121f",
      border: "#2d3356",
    },
    tokens: {
      cardRadius: "4px",
      borderWidth: "1px",
      shadowDepth: "0 0 16px rgba(0, 240, 255, 0.2)",
      fontHeading: "Rajdhani, Cascadia Code, Consolas, monospace",
      fontBody: "system-ui, sans-serif",
    },
    experience: {
      tier: "composition",
      shell: "topbar",
      navigation: "command-bar",
      detail: "modal",
      card: "floating-surface",
      composition: "solid-grid",
      density: "normal",
      motion: "expressive",
      ornament: { rule: "hairline", corner: "rounded", decoration: "grid", chrome: "none" },
      tweakable: ["panelRadius", "controlRadius", "accent", "accentSecondary", "surface", "motion"],
      specimenNote: "顶部状态条 + 自发光面板浮在网格上；详情是一块占屏诊断层。",
    },
    designPrinciples: [
      "High Voltage Contrast — 纯粹暗夜背景下激活激光电光色",
      "Neon Halo Bloom — 关键交互元素伴有柔和彩色荧光辉光",
      "Tactical HUD Grid — 锐利几何倒角与战术 HUD 仪表感",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: cyber-neon (赛博霓虹脉冲)
   ========================================================================== */

:root[data-style="cyber-neon"] {
  --surface-base: #080910;
  --surface-raised: #10121f;
  --surface-overlay: rgba(16, 18, 31, 0.96);
  --surface-overlay-soft: rgba(22, 25, 44, 0.92);
  --surface-sunken: #040508;
  --surface-hover: rgba(0, 240, 255, 0.1);
  --surface-active: #00f0ff;
  --surface-inset: #141729;

  --text-strong: #ffffff;
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-tertiary: #64748b;
  --text-quiet: #475569;
  --text-inverse: #080910;

  --line-subtle: #1c2035;
  --line-default: #2d3356;
  --line-strong: #00f0ff;

  --status-ok: #00f0ff;
  --status-warn: #ffbe0b;
  --status-bad: #ff0055;
  --status-accent: #ff007f;
  --status-accent-soft: rgba(255, 0, 127, 0.15);

  --font-mono: "Rajdhani", "Cascadia Code", Consolas, monospace;
  --radius-panel: 4px;
  --radius-control: 4px;
}

[data-style="cyber-neon"] :is([data-resource-card], [data-style-card], [data-software-row], input, button) {
  border-radius: 4px;
}

[data-style="cyber-neon"].app-field,
[data-style="cyber-neon"] main {
  background-image: 
    linear-gradient(rgba(0, 240, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 0, 127, 0.03) 1px, transparent 1px) !important;
  background-size: 32px 32px !important;
}

[data-style="cyber-neon"] nav[aria-label="导航"] {
  border-right: 1px solid #2d3356;
  background: var(--surface-base);
}

[data-style="cyber-neon"] nav[aria-label="导航"] button[aria-current="page"] {
  background: rgba(0, 240, 255, 0.12) !important;
  color: #00f0ff !important;
  border-left: 3px solid #00f0ff !important;
  box-shadow: inset 0 0 12px rgba(0, 240, 255, 0.2) !important;
  font-weight: 700;
}

[data-style="cyber-neon"] [data-software-row] {
  border: 1px solid #22263d !important;
  background: #0e101c !important;
  transition: all 0.15s ease !important;
}

[data-style="cyber-neon"] [data-software-row]:hover {
  border-color: #00f0ff !important;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.25) !important;
}

[data-style="cyber-neon"] [data-resource-card] {
  border: 1px solid #252a45 !important;
  background: #111424 !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

[data-style="cyber-neon"] [data-resource-card]:hover {
  border-color: #ff007f !important;
  box-shadow: 0 0 16px rgba(255, 0, 127, 0.3) !important;
  transform: translateY(-2px) !important;
}`,
  },

  "terminal-collage": {
    id: "terminal-collage",
    name: "终端拼贴",
    version: "1.0.0",
    subtitle: "Tiling Terminal Mosaic / tmux Console",
    description: "tmux / i3 多窗格平铺字符控制台。等宽字符栅格、不等宽面板细线切分、状态栏指示器与命令行式缓冲区分区，高密度极客操作界面。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "tmux 窗格切分、i3 平铺窗口管理器与彭博终端信息架构",
    tags: ["终端拼贴", "tmux", "平铺窗格", "等宽字体", "键盘控制", "高密度"],
    cssPath: "terminal-collage.css",
    palette: {
      bg: "#0c0e12",
      surface: "#14171f",
      border: "#272e3d",
      primary: "#f59e0b",
      text: "#f1f5f9",
    },
    tokens: {
      cardRadius: "0px",
      borderWidth: "1px",
      shadowDepth: "0px",
      fontHeading: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontBody: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
    },
    experience: {
      tier: "experience",
      shell: "sidebar",
      navigation: "keyboard-menu",
      detail: "floating-inspector",
      card: "terminal-line",
      composition: "character-list",
      density: "compact",
      motion: "reduced",
      typography: {
        headingFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
        bodyFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
        monoFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
        headingScale: 1,
        bodyScale: 0.95,
        headingWeight: 700,
        headingTracking: "0.02em",
      },
      ornament: { rule: "ascii", corner: "square", decoration: "scanline", chrome: "status" },
      tweakable: ["borderWidth", "shadow", "accent", "accentSecondary", "surface", "text", "density", "motion"],
      locked: {
        panelRadius: "终端平铺窗格要求严格直角，圆角会破坏字符栅格与边框贴合。",
        controlRadius: "命令行按键与标签均为直角字符单元。",
      },
      specimenNote: "tmux 平铺多窗格与等宽控制台，字符单元排版与状态栏",
    },
    designPrinciples: [
      "Character Cell Rhythm — 字符单元为唯一度量尺度，去除多余无意义圆角与装饰留白",
      "Tiled Hierarchy — 明确的窗格编号与分区标头（[P0:NAV] / [P1:MAIN] / [P2:INSPECT]）",
      "Monospace Uniformity — 统一等宽字重，强化工程控制台的秩序感与严谨性",
      "Restrained Signals — 深色冷灰底色搭配暖琥珀与电光青信号点缀",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: terminal-collage (终端拼贴 / Tiling Terminal Mosaic)
   ========================================================================== */

:root[data-style="terminal-collage"]:not([data-theme="light"]) {
  --surface-base: #0c0e12;
  --surface-raised: #14171f;
  --surface-overlay: rgba(20, 23, 31, 0.98);
  --surface-overlay-soft: rgba(25, 29, 40, 0.94);
  --surface-sunken: #07080b;
  --surface-hover: rgba(245, 158, 11, 0.08);
  --surface-active: #f59e0b;
  --surface-inset: #181c26;

  --text-strong: #ffffff;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-tertiary: #64748b;
  --text-quiet: #475569;
  --text-inverse: #0c0e12;

  --line-subtle: #1c222e;
  --line-default: #272e3d;
  --line-strong: #f59e0b;

  --status-ok: #10b981;
  --status-warn: #f59e0b;
  --status-bad: #f43f5e;
  --status-accent: #f59e0b;
  --status-accent-soft: rgba(245, 158, 11, 0.16);

  --font-mono: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
}

[data-style="terminal-collage"] {
  font-family: var(--font-mono) !important;
}

[data-style="terminal-collage"] *,
[data-style="terminal-collage"] *::before,
[data-style="terminal-collage"] *::after {
  border-radius: 0px !important;
}

[data-style="terminal-collage"] [data-software-row] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  box-shadow: none !important;
  padding: 8px 12px !important;
  position: relative;
  font-family: var(--font-mono);
  transition: all 120ms ease;
}

[data-style="terminal-collage"] [data-software-row]:hover {
  border-color: var(--status-accent) !important;
  background: var(--surface-inset) !important;
}

[data-style="terminal-collage"] [data-software-row][aria-pressed="true"],
[data-style="terminal-collage"] [data-software-row][data-selected="true"] {
  border-color: var(--status-accent) !important;
  background: var(--surface-inset) !important;
  box-shadow: inset 3px 0 0 var(--status-accent) !important;
}

[data-style="terminal-collage"] [data-resource-card] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  box-shadow: none !important;
  padding: 14px !important;
  position: relative;
  font-family: var(--font-mono);
}

[data-style="terminal-collage"] [data-resource-card]:hover {
  border-color: var(--status-accent) !important;
  background: var(--surface-inset) !important;
}`,
  },

  "blueprint-drafting": {
    id: "blueprint-drafting",
    name: "蓝图制图",
    version: "1.0.0",
    subtitle: "Technical Blueprint Drafting / CAD Engineering",
    description: "严谨工程制图与建筑图纸语言。坐标标尺、尺寸标注引线、图纸编号、装配标题栏与公差注记，极少颜色，纯正工程图纸构件感。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "建筑施工蓝图、AutoCAD 技术装配图纸与精密机械制图标注规范",
    tags: ["技术蓝图", "工程制图", "CAD网格", "尺寸线", "标题栏", "十字准星"],
    cssPath: "blueprint-drafting.css",
    palette: {
      bg: "#061426",
      surface: "#0d2544",
      border: "#1e4475",
      primary: "#00f5d4",
      text: "#dff2fe",
    },
    tokens: {
      cardRadius: "0px",
      borderWidth: "1px",
      shadowDepth: "0px",
      fontHeading: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      fontBody: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
    },
    experience: {
      tier: "experience",
      shell: "topbar",
      navigation: "command-bar",
      detail: "sheet",
      card: "tile",
      composition: "drafting-index",
      density: "compact",
      motion: "reduced",
      typography: {
        headingFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
        bodyFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
        monoFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
        headingScale: 1,
        bodyScale: 0.95,
        headingWeight: 600,
        headingTracking: "0.04em",
      },
      ornament: { rule: "dashed", corner: "square", decoration: "blueprint", chrome: "title" },
      tweakable: ["borderWidth", "shadow", "accent", "accentSecondary", "surface", "text", "density", "motion"],
      locked: {
        panelRadius: "工程图纸与技术施工规范严格采用直角边界，直角是图纸规约的一部分。",
        controlRadius: "图纸标注符号与操作图框均为直角基元。",
      },
      specimenNote: "技术蓝图标尺、尺寸标注引线与工程标题栏构件",
    },
    designPrinciples: [
      "Engineering Annotation — 每一个界面容器都是待装配的图纸构件，携带图号与注记",
      "Dimension Hierarchy — 尺寸线与细虚线构成信息排布的骨架，拒绝普通无结构卡片",
      "Disciplined Monochrome — 深海工科蓝底搭配青白细线条与极少镉黄标注，严守制图色彩纪律",
      "Crosshair Alignment — 角落十字标与坐标格点提供毫厘不差的工科对齐美学",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: blueprint-drafting (蓝图制图 / Blueprint Drafting)
   ========================================================================== */

:root[data-style="blueprint-drafting"]:not([data-theme="light"]) {
  --surface-base: #061426;
  --surface-raised: #0b2342;
  --surface-overlay: rgba(11, 35, 66, 0.98);
  --surface-overlay-soft: rgba(14, 43, 80, 0.94);
  --surface-sunken: #030c18;
  --surface-hover: rgba(0, 245, 212, 0.08);
  --surface-active: #00f5d4;
  --surface-inset: #0e2d54;

  --text-strong: #ffffff;
  --text-primary: #dff2fe;
  --text-secondary: #90c2e7;
  --text-tertiary: #5c93c4;
  --text-quiet: #3a6994;
  --text-inverse: #061426;

  --line-subtle: #123055;
  --line-default: #1c4474;
  --line-strong: #00f5d4;

  --status-ok: #00f5d4;
  --status-warn: #facc15;
  --status-bad: #fb7185;
  --status-accent: #00f5d4;
  --status-accent-soft: rgba(0, 245, 212, 0.16);

  --font-mono: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
}

[data-style="blueprint-drafting"] *,
[data-style="blueprint-drafting"] *::before,
[data-style="blueprint-drafting"] *::after {
  border-radius: 0px !important;
}

[data-style="blueprint-drafting"] [data-software-row] {
  border: 1px dashed var(--line-default) !important;
  background: var(--surface-raised) !important;
  box-shadow: none !important;
  position: relative;
  transition: all 120ms ease;
}

[data-style="blueprint-drafting"] [data-software-row]::before {
  content: "+";
  position: absolute;
  top: 3px;
  right: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--status-accent);
  opacity: 0.6;
}

[data-style="blueprint-drafting"] [data-software-row]:hover {
  border: 1px solid var(--status-accent) !important;
  background: var(--surface-inset) !important;
}

[data-style="blueprint-drafting"] [data-resource-card] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  position: relative;
}

[data-style="blueprint-drafting"] [data-resource-card]:hover {
  border-color: var(--status-accent) !important;
  background: var(--surface-inset) !important;
}`,
  },

  "split-flap": {
    id: "split-flap",
    name: "翻牌显示板",
    version: "1.0.0",
    subtitle: "Split-Flap Board / Departure Display",
    description: "机场与火车站机械翻牌信息板。中缝分段字符单元、高对比机械色块、离合翻转动效与行列信息矩阵，赋予状态流转强烈的物理机械节奏。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "Solari di Udine 经典机械翻牌大屏、机场离港信息牌与欧洲中央车站时刻矩阵",
    tags: ["翻牌显示板", "机场大屏", "机械感", "分段字符", "翻片动效", "高对比"],
    cssPath: "split-flap.css",
    palette: {
      bg: "#111216",
      surface: "#18191e",
      border: "#2a2c35",
      primary: "#f59e0b",
      text: "#f4f5f7",
    },
    tokens: {
      cardRadius: "0px",
      borderWidth: "1px",
      shadowDepth: "4px",
      fontHeading: '"Oswald", "DIN Alternate", "Trebuchet MS", "Arial Black", sans-serif',
      fontBody: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
    },
    experience: {
      tier: "experience",
      shell: "topbar",
      navigation: "tab-strip",
      detail: "sheet",
      card: "panel",
      composition: "solid-grid",
      density: "compact",
      motion: "expressive",
      typography: {
        headingFamily: '"Oswald", "DIN Alternate", "Trebuchet MS", "Arial Black", sans-serif',
        bodyFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
        monoFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
        headingScale: 1.15,
        bodyScale: 0.95,
        headingWeight: 800,
        headingTracking: "0.06em",
        headingTransform: "uppercase",
      },
      ornament: { rule: "hairline", corner: "square", decoration: "pinstripe", chrome: "status" },
      tweakable: ["borderWidth", "shadow", "accent", "accentSecondary", "surface", "text", "density", "motion"],
      locked: {
        panelRadius: "翻牌机械单元采用物理直角模块拼接，圆角无法形成连续字符翻板矩阵。",
        controlRadius: "物理控制按键均为硬质矩形微动开关。",
      },
      specimenNote: "机械翻牌分段字符单元、中缝切线与离港时刻表矩阵",
    },
    designPrinciples: [
      "Mechanical Authenticity — 翻板中缝与侧边铰链赋予每一个信息单元真实的物理机械质感",
      "Departure Board Cadence — 严谨的行列对齐节奏，如航班信息牌般一目了然",
      "State Change as Drama — 状态流转时伴随翻板翻落的物理动画，赋予操作扎实的确定感",
      "High-Contrast Legibility — 极黑哑光底板与明亮珐琅字体，确保远距离扫视依旧极高清晰度",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: split-flap (翻牌显示板 / Split-Flap Board)
   ========================================================================== */

:root[data-style="split-flap"]:not([data-theme="light"]) {
  --surface-base: #101115;
  --surface-raised: #18191f;
  --surface-overlay: rgba(24, 25, 31, 0.98);
  --surface-overlay-soft: rgba(28, 30, 38, 0.94);
  --surface-sunken: #0b0c0e;
  --surface-hover: rgba(245, 158, 11, 0.08);
  --surface-active: #f59e0b;
  --surface-inset: #1d1e26;

  --text-strong: #ffffff;
  --text-primary: #f3f4f6;
  --text-secondary: #a1a1aa;
  --text-tertiary: #71717a;
  --text-quiet: #52525b;
  --text-inverse: #101115;

  --line-subtle: #20222a;
  --line-default: #2d303b;
  --line-strong: #f59e0b;

  --status-ok: #22c55e;
  --status-warn: #f59e0b;
  --status-bad: #ef4444;
  --status-accent: #f59e0b;
  --status-accent-soft: rgba(245, 158, 11, 0.16);

  --font-mono: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
}

[data-style="split-flap"] *,
[data-style="split-flap"] *::before,
[data-style="split-flap"] *::after {
  border-radius: 0px !important;
}

[data-style="split-flap"] [data-software-row] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4) !important;
  position: relative;
  font-family: var(--font-mono);
  transition: border-color 140ms ease;
}

[data-style="split-flap"] [data-software-row]:hover {
  border-color: var(--status-accent) !important;
}

[data-style="split-flap"] [data-resource-card] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.45) !important;
  position: relative;
}

[data-style="split-flap"] [data-resource-card]:hover {
  border-color: var(--status-accent) !important;
}`,
  },
};
