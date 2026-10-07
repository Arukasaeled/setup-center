import type { VaultStyleManifest } from "../types";

export const STYLES_PART_B: Record<string, VaultStyleManifest> = {
  "natural-history": {
    id: "natural-history",
    name: "博物图版",
    version: "1.0.0",
    subtitle: "Natural History Plate / Specimen Catalog",
    description: "19世纪自然史百科图谱与标本目录语言。双线版框、拉丁分类法注记、标本编号引线、学术排版与铜版画质感，如同翻开一本严谨沉静的科学博物图鉴。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "林奈双名分类法图谱、布丰《自然史》铜版插图、法国狄德罗百科全书图版与植物标本馆档案",
    tags: ["博物图版", "自然史", "双名法", "铜版画", "标本图谱", "学术典籍"],
    cssPath: "natural-history.css",
    palette: {
      bg: "#fbf8f1",
      surface: "#f4efe4",
      border: "#d6ccba",
      primary: "#365338",
      text: "#1c1a17",
    },
    tokens: {
      cardRadius: "2px",
      borderWidth: "1px",
      shadowDepth: "0px",
      fontHeading: '"Cinzel", "Baskerville", "Georgia", "Times New Roman", serif',
      fontBody: '"Georgia", "Garamond", "Times New Roman", serif',
    },
    experience: {
      tier: "experience",
      shell: "editorial",
      navigation: "menu-bar",
      detail: "rail",
      card: "index-entry",
      composition: "magazine-index",
      density: "spacious",
      motion: "reduced",
      typography: {
        headingFamily: '"Cinzel", "Baskerville", "Georgia", "Times New Roman", serif',
        bodyFamily: '"Georgia", "Garamond", "Times New Roman", serif',
        monoFamily: '"Courier New", "Consolas", monospace',
        headingScale: 1.15,
        bodyScale: 1,
        headingWeight: 600,
        headingTracking: "0.04em",
      },
      ornament: { rule: "double", corner: "bevel", decoration: "none", chrome: "title-menu" },
      tweakable: ["borderWidth", "shadow", "accent", "accentSecondary", "surface", "text", "density", "motion"],
      locked: {
        panelRadius: "古典学术图版采用直角裁切与装帧，圆角与铜版装订规约冲突。",
        controlRadius: "图注印鉴与分类标签均为直角折边。",
      },
      specimenNote: "19世纪博物学图版双线装帧、标本编号引线与学术分类图谱",
    },
    designPrinciples: [
      "Taxonomic Discipline — 借用动植物双名法与标本卡格式，重塑技术实体的分类与记录仪式",
      "Engraving Plate Cadence — 铜版画双线外框与精细图注，赋予现代工具学术出版物的沉静感",
      "Archival Materiality — 氧化纸色、铁胆墨水字迹与植物矿物色阶，呈现沉淀的真实质地",
      "Anatomical Callout — 关键属性以解剖引线形式标注，让技术依赖如同植物器官般清晰可辨",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: natural-history (博物图版 / Natural History Plate)
   ========================================================================== */

:root[data-style="natural-history"] {
  --surface-base: #fbf8f1;
  --surface-raised: #f4eee2;
  --surface-overlay: rgba(244, 238, 226, 0.98);
  --surface-overlay-soft: rgba(251, 248, 241, 0.95);
  --surface-sunken: #ede4d3;
  --surface-hover: rgba(54, 83, 56, 0.08);
  --surface-active: #365338;
  --surface-inset: #e8decb;

  --text-strong: #141311;
  --text-primary: #24221e;
  --text-secondary: #4f4c45;
  --text-tertiary: #757168;
  --text-quiet: #9c978c;
  --text-inverse: #fbf8f1;

  --line-subtle: #e6ddce;
  --line-default: #cfc4b0;
  --line-strong: #365338;

  --status-ok: #365338;
  --status-warn: #8a4b2d;
  --status-bad: #a33b28;
  --status-accent: #365338;
  --status-accent-soft: rgba(54, 83, 56, 0.16);

  --font-serif: "Cinzel", "Baskerville", "Georgia", "Times New Roman", serif;
  --font-sans: "Georgia", "Garamond", "Times New Roman", serif;
}

[data-style="natural-history"] {
  font-family: var(--font-sans) !important;
}

[data-style="natural-history"] *,
[data-style="natural-history"] *::before,
[data-style="natural-history"] *::after {
  border-radius: var(--radius-panel, 2px) !important;
}

[data-style="natural-history"] [data-software-row] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08) !important;
  transition: all 120ms ease;
}

[data-style="natural-history"] [data-software-row]:hover {
  border-color: var(--status-accent) !important;
}

[data-style="natural-history"] [data-resource-card] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08) !important;
}

[data-style="natural-history"] [data-resource-card]:hover {
  border-color: var(--status-accent) !important;
}`,
  },

  scrapbook: {
    id: "scrapbook",
    name: "手账拼贴",
    version: "1.0.0",
    subtitle: "Scrapbook Collage / Creative Notebook",
    description: "手工艺术手账与拼贴笔记本语言。和纸胶带、牛皮纸便签、微倾角纸片层级、手写批注与点阵本底纹，保持清晰秩序的同时洋溢着真实创作与收纳的温度。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "手账拼贴（Scrapbooking）、Midori 旅人笔记本与混合媒介手作拼贴整理法",
    tags: ["手账拼贴", "和纸胶带", "牛皮纸", "手写批注", "笔记本", "创作收纳"],
    cssPath: "scrapbook.css",
    palette: {
      bg: "#fcf9f2",
      surface: "#f5eee1",
      border: "#ded4c3",
      primary: "#df7356",
      text: "#2c2a29",
    },
    tokens: {
      cardRadius: "12px",
      borderWidth: "1px",
      shadowDepth: "4px",
      fontHeading: '"Caveat", "Segoe Print", "Comic Sans MS", "Bradley Hand", cursive, sans-serif',
      fontBody: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    experience: {
      tier: "experience",
      shell: "stacked",
      navigation: "tab-strip",
      detail: "sheet",
      card: "sticker",
      composition: "floating-panels",
      density: "spacious",
      motion: "normal",
      typography: {
        headingFamily: '"Caveat", "Segoe Print", "Comic Sans MS", "Bradley Hand", cursive, sans-serif',
        bodyFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        monoFamily: '"JetBrains Mono", Consolas, monospace',
        headingScale: 1.2,
        bodyScale: 1,
        headingWeight: 700,
        headingTracking: "0.01em",
      },
      ornament: { rule: "none", corner: "rounded", decoration: "grid", chrome: "none" },
      tweakable: ["panelRadius", "controlRadius", "borderWidth", "shadow", "accent", "accentSecondary", "surface", "text", "density", "motion"],
      specimenNote: "和纸胶带固定、牛皮纸便签层级与微倾角手账拼贴",
    },
    designPrinciples: [
      "Warm Materiality — 牛皮纸、和纸胶带与铅笔字迹唤醒亲切的实体手作体验",
      "Controlled Collage — 极轻微的有机倾斜与错落层级，严守文字可读性与网格秩序",
      "Personal Annotation — 荧光划线、星号贴纸与随笔图章，让配置过程如手账记录般愉悦",
      "Subtle Textures — 点阵笔记本底纹为不规则模块提供看不见却感得到的对齐基线",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: scrapbook (手账拼贴 / Scrapbook Collage)
   ========================================================================== */

:root[data-style="scrapbook"] {
  --surface-base: #fcf9f2;
  --surface-raised: #f5eee1;
  --surface-overlay: rgba(245, 238, 225, 0.98);
  --surface-overlay-soft: rgba(252, 249, 242, 0.95);
  --surface-sunken: #ede3d1;
  --surface-hover: rgba(223, 115, 86, 0.08);
  --surface-active: #df7356;
  --surface-inset: #e8ded0;

  --text-strong: #1e1d1b;
  --text-primary: #2c2a29;
  --text-secondary: #57524e;
  --text-tertiary: #7c756f;
  --text-quiet: #a39c94;
  --text-inverse: #fcf9f2;

  --line-subtle: #eae2d3;
  --line-default: #ded4c3;
  --line-strong: #df7356;

  --status-ok: #588157;
  --status-warn: #e09f3e;
  --status-bad: #c1121f;
  --status-accent: #df7356;
  --status-accent-soft: rgba(223, 115, 86, 0.16);

  --font-hand: "Caveat", "Segoe Print", "Comic Sans MS", "Bradley Hand", cursive, sans-serif;
}

[data-style="scrapbook"] [data-software-row] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  border-radius: 12px !important;
  box-shadow: 1px 2px 6px rgba(0, 0, 0, 0.06) !important;
  position: relative;
  transition: all 140ms ease;
}

[data-style="scrapbook"] [data-software-row]:hover {
  border-color: var(--status-accent) !important;
}

[data-style="scrapbook"] [data-resource-card] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  border-radius: 12px !important;
  box-shadow: 1px 3px 8px rgba(0, 0, 0, 0.08) !important;
}

[data-style="scrapbook"] [data-resource-card]:hover {
  border-color: var(--status-accent) !important;
}`,
  },

  "tree-rings": {
    id: "tree-rings",
    name: "年轮切片",
    version: "1.0.0",
    subtitle: "Dendrochronology Growth Archive",
    description: "树木年轮截面与档案时间层。同心弧线重复母题、生长层刻度、木刻式编号与柔和自然暖纸色，记录系统长期演化与历史积淀。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "树木年轮年代学（Dendrochronology）、历史档案时间分层、同心生长环与木刻版画档案",
    tags: ["年轮切片", "自然时间", "同心弧线", "生长层", "历史档案", "木刻标本"],
    cssPath: "tree-rings.css",
    palette: {
      bg: "#141210",
      surface: "#1c1915",
      border: "#383126",
      primary: "#d4a373",
      text: "#f3ece2",
    },
    tokens: {
      cardRadius: "6px",
      borderWidth: "1px",
      shadowDepth: "0px",
      fontHeading: '"Palatino Linotype", "Book Antiqua", Georgia, serif',
      fontBody: "system-ui, -apple-system, sans-serif",
    },
    experience: {
      tier: "experience",
      shell: "sidebar",
      navigation: "sidebar",
      detail: "sheet",
      card: "panel",
      composition: "magazine-index",
      density: "normal",
      motion: "reduced",
      typography: {
        headingFamily: '"Palatino Linotype", "Book Antiqua", Georgia, serif',
        bodyFamily: "system-ui, -apple-system, sans-serif",
        monoFamily: '"Cascadia Mono", Consolas, monospace',
        headingScale: 1.05,
        bodyScale: 1,
        headingWeight: 600,
        headingTracking: "0.01em",
      },
      ornament: { rule: "hairline", corner: "rounded", decoration: "none", chrome: "status" },
      tweakable: ["panelRadius", "borderWidth", "shadow", "accent", "accentSecondary", "surface", "text", "density", "motion"],
      specimenNote: "同心年轮弧线背景，生长层标号与自然暖纸色档案排版",
    },
    designPrinciples: [
      "Temporal Stratum — 每一层都是时间的生长记录，越靠核心越早期，历史与变更沉淀为同心层",
      "Concentric Motif — 同心弧线作为空间韵律，避免呆板正圆，采用局部的宏大同心切片",
      "Organic Precision — 自然柔和纸本暖调结合木刻工整标度，既有岁月厚重感又保持工程严谨",
      "Non-Disruptive Geometry — 卡片保持可用规整矩形，通过边缘年轮刻度与标号强化生命周期隐喻",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: tree-rings (年轮切片 / Dendrochronology Growth Archive)
   ========================================================================== */

:root[data-style="tree-rings"]:not([data-theme="light"]) {
  --surface-base: #141210;
  --surface-raised: #1c1915;
  --surface-overlay: rgba(28, 25, 21, 0.98);
  --surface-overlay-soft: rgba(36, 32, 27, 0.94);
  --surface-sunken: #0c0b09;
  --surface-hover: rgba(212, 163, 115, 0.08);
  --surface-active: #d4a373;
  --surface-inset: #231f1a;

  --text-strong: #fffdf9;
  --text-primary: #f3ece2;
  --text-secondary: #c2b6a6;
  --text-tertiary: #8f8373;
  --text-quiet: #6b6154;
  --text-inverse: #141210;

  --line-subtle: #29241d;
  --line-default: #383126;
  --line-strong: #d4a373;

  --status-ok: #84a98c;
  --status-warn: #e09f3e;
  --status-bad: #9e2a2b;
  --status-accent: #d4a373;
  --status-accent-soft: rgba(212, 163, 115, 0.14);

  --font-serif: "Palatino Linotype", "Book Antiqua", Georgia, serif;
  --font-sans: system-ui, -apple-system, sans-serif;
  --font-mono: "Cascadia Mono", Consolas, monospace;
}

[data-style="tree-rings"] [data-software-row] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  border-radius: 6px !important;
  transition: all 120ms ease;
}

[data-style="tree-rings"] [data-software-row]:hover {
  border-color: var(--status-accent) !important;
}

[data-style="tree-rings"] [data-resource-card] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  border-radius: 6px !important;
}

[data-style="tree-rings"] [data-resource-card]:hover {
  border-color: var(--status-accent) !important;
}`,
  },

  "timeline-spine": {
    id: "timeline-spine",
    name: "竖向时间脊",
    version: "1.0.0",
    subtitle: "Chronological Axial Backbone",
    description: "纵向时间主轴与系统编年史脊柱。贯穿主轴线、节点刻度分支、阶段状态锚点与展开式检视节点，以生命周期与时序韵律统领全局界面。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "编年史时间主轴、系统生命周期刻度、轴线节点与分支管线拓扑",
    tags: ["时间脊", "轴线节点", "刻度主轴", "生命周期", "编年史", "时序分支"],
    cssPath: "timeline-spine.css",
    palette: {
      bg: "#0b1019",
      surface: "#121a27",
      border: "#202c3f",
      primary: "#38bdf8",
      text: "#f1f5f9",
    },
    tokens: {
      cardRadius: "4px",
      borderWidth: "1px",
      shadowDepth: "0px",
      fontHeading: "system-ui, -apple-system, sans-serif",
      fontBody: "system-ui, -apple-system, sans-serif",
    },
    experience: {
      tier: "experience",
      shell: "sidebar",
      navigation: "sidebar",
      detail: "sheet",
      card: "flat-row",
      composition: "roadmap",
      density: "normal",
      motion: "normal",
      typography: {
        headingFamily: "system-ui, -apple-system, sans-serif",
        bodyFamily: "system-ui, -apple-system, sans-serif",
        monoFamily: '"JetBrains Mono", Consolas, monospace',
        headingScale: 1.05,
        bodyScale: 1,
        headingWeight: 600,
        headingTracking: "0.01em",
      },
      ornament: { rule: "dashed", corner: "square", decoration: "none", chrome: "status" },
      tweakable: ["panelRadius", "borderWidth", "shadow", "accent", "accentSecondary", "surface", "text", "density", "motion"],
      specimenNote: "贯穿主轴线，刻度节点与分支连线编年史系统",
    },
    designPrinciples: [
      "Axial Continuity — 页面具备清晰的纵向脊梁，从系统初始化到运行时形成明确的时间与逻辑主干",
      "Nodal Hierarchy — 强节点代表活跃与就绪状态，弱刻度代表历史记录与背景通道",
      "Branch Connection — 卡片与列表通过水平连接符接入主轴，保持网格可用性同时建立从属关系",
      "Restrained Signals — 墨蓝底色结合电光青冷色发光主轴，塑造高技术感的现代工程编年史氛围",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: timeline-spine (竖向时间脊 / Chronological Axial Backbone)
   ========================================================================== */

:root[data-style="timeline-spine"]:not([data-theme="light"]) {
  --surface-base: #0b1019;
  --surface-raised: #121a27;
  --surface-overlay: rgba(18, 26, 39, 0.98);
  --surface-overlay-soft: rgba(22, 32, 48, 0.94);
  --surface-sunken: #070a10;
  --surface-hover: rgba(56, 189, 248, 0.08);
  --surface-active: #38bdf8;
  --surface-inset: #162030;

  --text-strong: #ffffff;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-tertiary: #64748b;
  --text-quiet: #475569;
  --text-inverse: #0b1019;

  --line-subtle: #172233;
  --line-default: #202c3f;
  --line-strong: #38bdf8;

  --status-ok: #34d399;
  --status-warn: #fbbf24;
  --status-bad: #f87171;
  --status-accent: #38bdf8;
  --status-accent-soft: rgba(56, 189, 248, 0.16);

  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", Consolas, monospace;
}

[data-style="timeline-spine"] [data-software-row] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  border-radius: 4px !important;
  transition: all 120ms ease;
}

[data-style="timeline-spine"] [data-software-row]:hover {
  border-color: var(--status-accent) !important;
}

[data-style="timeline-spine"] [data-resource-card] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  border-radius: 4px !important;
}

[data-style="timeline-spine"] [data-resource-card]:hover {
  border-color: var(--status-accent) !important;
}`,
  },

  "musical-staff": {
    id: "musical-staff",
    name: "乐谱谱表",
    version: "1.0.0",
    subtitle: "Score Staff & Rhythm Cadence",
    description: "五线谱表通道与乐章节奏编排。水平贯穿谱表标线、小节线段落分区、声部音符指示与节拍间距，以严谨工整的乐谱编辑语言组织多维系统信息。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "音乐总谱记谱法（Score Notation）、管弦乐多声部编排、小节线与节拍律动",
    tags: ["乐谱谱表", "五线谱", "小节线", "声部编排", "节拍律动", "总谱标注"],
    cssPath: "musical-staff.css",
    palette: {
      bg: "#101114",
      surface: "#181a22",
      border: "#2a2d3b",
      primary: "#eab308",
      text: "#f8fafc",
    },
    tokens: {
      cardRadius: "2px",
      borderWidth: "1px",
      shadowDepth: "0px",
      fontHeading: '"Baskerville", "Georgia", "Times New Roman", serif',
      fontBody: "system-ui, -apple-system, sans-serif",
    },
    experience: {
      tier: "experience",
      shell: "sidebar",
      navigation: "sidebar",
      detail: "modal",
      card: "editorial-block",
      composition: "ledger",
      density: "compact",
      motion: "reduced",
      typography: {
        headingFamily: '"Baskerville", "Georgia", "Times New Roman", serif',
        bodyFamily: "system-ui, -apple-system, sans-serif",
        monoFamily: '"JetBrains Mono", Consolas, monospace',
        headingScale: 1.05,
        bodyScale: 0.95,
        headingWeight: 600,
        headingTracking: "0.02em",
      },
      ornament: { rule: "double", corner: "square", decoration: "pinstripe", chrome: "status" },
      tweakable: ["borderWidth", "shadow", "accent", "accentSecondary", "surface", "text", "density", "motion"],
      specimenNote: "五线谱表标线，双小节线分割与符头节奏排版",
    },
    designPrinciples: [
      "Polyphonic Registers — 将不同类别的内容视为管弦乐的不同声部，各按其位",
      "Measure Cadence — 严格的节拍间距与小节线分割，让密集的数据展示具备清晰的呼吸与律动感",
      "Elliptical Notehead — 去除泛滥的几何圆形，采用微带倾角的符头形态作为状态与标记符号",
      "Typographic Harmony — 现代古典衬线标题与精炼等宽节拍标注协同，庄重典雅且易于阅读",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: musical-staff (乐谱谱表 / Score Staff & Rhythm Cadence)
   ========================================================================== */

:root[data-style="musical-staff"]:not([data-theme="light"]) {
  --surface-base: #101114;
  --surface-raised: #181a22;
  --surface-overlay: rgba(24, 26, 34, 0.98);
  --surface-overlay-soft: rgba(30, 33, 44, 0.94);
  --surface-sunken: #0a0a0d;
  --surface-hover: rgba(234, 179, 8, 0.08);
  --surface-active: #eab308;
  --surface-inset: #1f222d;

  --text-strong: #ffffff;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-tertiary: #64748b;
  --text-quiet: #475569;
  --text-inverse: #101114;

  --line-subtle: #1e212b;
  --line-default: #2a2d3b;
  --line-strong: #eab308;

  --status-ok: #10b981;
  --status-warn: #eab308;
  --status-bad: #f43f5e;
  --status-accent: #eab308;
  --status-accent-soft: rgba(234, 179, 8, 0.16);

  --font-serif: "Baskerville", "Georgia", "Times New Roman", serif;
  --font-sans: system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", Consolas, monospace;
}

[data-style="musical-staff"] [data-software-row] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  border-radius: 2px !important;
  transition: all 120ms ease;
}

[data-style="musical-staff"] [data-software-row]:hover {
  border-color: var(--status-accent) !important;
}

[data-style="musical-staff"] [data-resource-card] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  border-radius: 2px !important;
}

[data-style="musical-staff"] [data-resource-card]:hover {
  border-color: var(--status-accent) !important;
}`,
  },

  "exhibition-plan": {
    id: "exhibition-plan",
    name: "展览平面图",
    version: "1.0.0",
    subtitle: "Architectural Gallery Wayfinding",
    description: "现代艺术馆展厅平面与导视系统。展厅分区编号（ROOM / GALLERY）、建筑导视流线、空间色块标牌与展品墙签，将软件与配置探索转化为沉浸式展厅漫步。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "当代美术馆平面导向图、建筑寻路导视、展品说明牌与展厅空间拓扑",
    tags: ["展览平面图", "展厅编号", "导视系统", "寻路标牌", "空间分区", "展品墙签"],
    cssPath: "exhibition-plan.css",
    palette: {
      bg: "#121417",
      surface: "#1c2027",
      border: "#2f3642",
      primary: "#f97316",
      text: "#f8fafc",
    },
    tokens: {
      cardRadius: "0px",
      borderWidth: "1px",
      shadowDepth: "0px",
      fontHeading: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      fontBody: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    },
    experience: {
      tier: "experience",
      shell: "topbar",
      navigation: "tab-strip",
      detail: "sheet",
      card: "index-entry",
      composition: "magazine-index",
      density: "normal",
      motion: "normal",
      typography: {
        headingFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
        bodyFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
        monoFamily: '"JetBrains Mono", Consolas, monospace',
        headingScale: 1.15,
        bodyScale: 1,
        headingWeight: 800,
        headingTracking: "0.04em",
        headingTransform: "uppercase",
      },
      ornament: { rule: "heavy", corner: "square", decoration: "none", chrome: "title" },
      tweakable: ["borderWidth", "shadow", "accent", "accentSecondary", "surface", "text", "density", "motion"],
      locked: {
        panelRadius: "现代画廊平面与展品基座遵循建筑直角几何。",
        controlRadius: "导视标牌与楼层指引采用标准矩形色块。",
      },
      specimenNote: "展厅导视指南，空间展区编号与展品说明标牌系统",
    },
    designPrinciples: [
      "Wayfinding Legibility — 寻路导视首重清晰识别，粗壮等线标题与高反差色块指示空间拓扑",
      "Gallery Partitioning — 区域以展厅空间组织，避免生硬的单调列表堆叠",
      "Exhibition Wall Labels — 卡片与详情采用博物馆展品标牌排版，明确标示作者、版本、年份与流派",
      "Architectural Planar Edge — 直角硬朗墙线与空间分区边界，体现现代主义建筑秩序与开阔感",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: exhibition-plan (展览平面图 / Architectural Gallery Wayfinding)
   ========================================================================== */

:root[data-style="exhibition-plan"]:not([data-theme="light"]) {
  --surface-base: #121417;
  --surface-raised: #1c2027;
  --surface-overlay: rgba(28, 32, 39, 0.98);
  --surface-overlay-soft: rgba(35, 40, 49, 0.94);
  --surface-sunken: #0b0d0f;
  --surface-hover: rgba(249, 115, 22, 0.08);
  --surface-active: #f97316;
  --surface-inset: #232832;

  --text-strong: #ffffff;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-tertiary: #64748b;
  --text-quiet: #475569;
  --text-inverse: #121417;

  --line-subtle: #222730;
  --line-default: #2f3642;
  --line-strong: #f97316;

  --status-ok: #10b981;
  --status-warn: #f97316;
  --status-bad: #ef4444;
  --status-accent: #f97316;
  --status-accent-soft: rgba(249, 115, 22, 0.16);

  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", Consolas, monospace;
}

[data-style="exhibition-plan"] *,
[data-style="exhibition-plan"] *::before,
[data-style="exhibition-plan"] *::after {
  border-radius: 0px !important;
}

[data-style="exhibition-plan"] [data-software-row] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  transition: all 120ms ease;
}

[data-style="exhibition-plan"] [data-software-row]:hover {
  border-color: var(--status-accent) !important;
}

[data-style="exhibition-plan"] [data-resource-card] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
}

[data-style="exhibition-plan"] [data-resource-card]:hover {
  border-color: var(--status-accent) !important;
}`,
  },

  "patch-bay": {
    id: "patch-bay",
    name: "跳线面板",
    version: "1.0.0",
    subtitle: "Modular Audio Rack & Signal Routing",
    description: "机架跳线面板与模块通道路由。拉丝金属机架、1/4 英寸插孔接口（Port/Jack）、通道条（Channel Strip）、信号电平指示灯与路由状态标签，呈现工业硬件级可靠度。",
    author: "Setup Center Design Lab",
    license: "MIT",
    updatedAt: "2026-10-04",
    implemented: true,
    inspiration: "专业音频跳线架、19 英寸机架设备通道条、硬件信号电平表与硬件接口矩阵",
    tags: ["跳线面板", "音频机架", "通道路由", "硬件接口", "信号指示", "工业质感"],
    cssPath: "patch-bay.css",
    palette: {
      bg: "#131518",
      surface: "#1b1e24",
      border: "#2d333d",
      primary: "#22c55e",
      text: "#f1f5f9",
    },
    tokens: {
      cardRadius: "3px",
      borderWidth: "1px",
      shadowDepth: "0px",
      fontHeading: '"JetBrains Mono", Consolas, monospace',
      fontBody: "system-ui, -apple-system, sans-serif",
    },
    experience: {
      tier: "experience",
      shell: "sidebar",
      navigation: "sidebar",
      detail: "floating-inspector",
      card: "panel",
      composition: "solid-grid",
      density: "compact",
      motion: "reduced",
      typography: {
        headingFamily: '"JetBrains Mono", Consolas, monospace',
        bodyFamily: "system-ui, -apple-system, sans-serif",
        monoFamily: '"JetBrains Mono", Consolas, monospace',
        headingScale: 1,
        bodyScale: 0.95,
        headingWeight: 700,
        headingTracking: "0.02em",
      },
      ornament: { rule: "hairline", corner: "bevel", decoration: "none", chrome: "full" },
      tweakable: ["borderWidth", "shadow", "accent", "accentSecondary", "surface", "text", "density", "motion"],
      locked: {
        panelRadius: "工业机架与铝合金面板遵循微倒角加工规范。",
        controlRadius: "跳线插孔与通道开关具有严谨硬件规格尺寸。",
      },
      specimenNote: "19寸机架跳线插孔，通道条矩阵与信号指示灯",
    },
    designPrinciples: [
      "Industrial Rack Reliability — 稳固严谨的机架结构与通道编号，带来硬件工作站般的沉稳触感",
      "Tactile Port Signals — 以同心插孔与状态 LED 灯取代泛滥的图标，功能状态一目了然",
      "Channel Strip Cohesion — 每一行与卡片均是独立路由通道，具备输入/输出标识与信道增益刻度",
      "Minimalist Wiring Metaphor — 聚焦物理面板接口与跳线状态编码，避免杂乱连线干扰核心点击操作",
    ],
    cssContent: `/* ==========================================================================
   STYLE SPECIMEN: patch-bay (跳线面板 / Modular Audio Rack & Signal Routing)
   ========================================================================== */

:root[data-style="patch-bay"]:not([data-theme="light"]) {
  --surface-base: #131518;
  --surface-raised: #1b1e24;
  --surface-overlay: rgba(27, 30, 36, 0.98);
  --surface-overlay-soft: rgba(33, 37, 45, 0.94);
  --surface-sunken: #0c0e10;
  --surface-hover: rgba(34, 197, 94, 0.08);
  --surface-active: #22c55e;
  --surface-inset: #21252d;

  --text-strong: #ffffff;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-tertiary: #64748b;
  --text-quiet: #475569;
  --text-inverse: #0f172a;

  --line-subtle: #20242b;
  --line-default: #2d333d;
  --line-strong: #22c55e;

  --status-ok: #22c55e;
  --status-warn: #f59e0b;
  --status-bad: #ef4444;
  --status-accent: #22c55e;
  --status-accent-soft: rgba(34, 197, 94, 0.16);

  --font-mono: "JetBrains Mono", Consolas, monospace;
  --font-sans: system-ui, -apple-system, sans-serif;
}

[data-style="patch-bay"] [data-software-row] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  border-radius: 3px !important;
  transition: all 120ms ease;
}

[data-style="patch-bay"] [data-software-row]:hover {
  border-color: var(--status-accent) !important;
}

[data-style="patch-bay"] [data-resource-card] {
  border: 1px solid var(--line-default) !important;
  background: var(--surface-raised) !important;
  border-radius: 3px !important;
}

[data-style="patch-bay"] [data-resource-card]:hover {
  border-color: var(--status-accent) !important;
}`,
  },
};
