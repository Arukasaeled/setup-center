import type { SetupStyle } from "../types";

export const naturalHistoryStyle: SetupStyle = {
  id: "natural-history",
  name: "博物图版",
  version: "1.0.0",
  subtitle: "Natural History Plate / Specimen Catalog",
  description:
    "19世纪自然史百科图谱与标本目录语言。双线版框、拉丁分类法注记、标本编号引线、学术排版与铜版画质感，如同翻开一本严谨沉静的科学博物图鉴。",
  inspiration: "林奈双名分类法图谱、布丰《自然史》铜版插图、法国狄德罗百科全书图版与植物标本馆档案（非单纯加衬线，构建图版考据系统）",
  author: "Setup Center Design Lab",
  tags: ["博物图版", "自然史", "双名法", "铜版画", "标本图谱", "学术典籍"],
  palette: {
    baseBg: "#fbf8f1",
    surface: "#f4efe4",
    cardBorder: "#d6ccba",
    accent: "#365338",
    accentSecondary: "#8a4b2d",
    text: "#1c1a17",
  },
  features: [
    "双实线雕刻版框（Double Rule Framing）与图版编号（TABULA XVIII // SYSTEMA DIGITALE）",
    "标本条目具备专属编号（Fig. 1. / Specimen 0x4A）与细引线解剖注记",
    "拉丁学术分类标签（Classis / Ordo / Familia）重构软件与资源品类",
    "亚麻亚光图版底纸、古典衬线体字阶与植物鼠尾草绿/赤陶印章点缀色",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "none",
    borderRadius: "2px",
    accentHue: "#365338",
  },
  designPrinciples: [
    "Taxonomic Discipline — 借用动植物双名法与标本卡格式，重塑技术实体的分类与记录仪式",
    "Engraving Plate Cadence — 铜版画双线外框与精细图注，赋予现代工具学术出版物的沉静感",
    "Archival Materiality — 氧化纸色、铁胆墨水字迹与植物矿物色阶，呈现沉淀的真实质地",
    "Anatomical Callout — 关键属性以解剖引线形式标注，让技术依赖如同植物器官般清晰可辨",
  ],
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
      bodyScale: 1.0,
      headingWeight: 600,
      headingTracking: "0.04em",
    },
    ornament: {
      rule: "double",
      corner: "bevel",
      decoration: "none",
      chrome: "title-menu",
    },
    tweakable: [
      "borderWidth",
      "shadow",
      "accent",
      "accentSecondary",
      "surface",
      "text",
      "density",
      "motion",
    ],
    locked: {
      panelRadius: "古典学术图版采用直角裁切与装帧，圆角与铜版装订规约冲突。",
      controlRadius: "图注印鉴与分类标签均为直角折边。",
    },
    specimenNote: "19世纪博物学图版双线装帧、标本编号引线与学术分类图谱",
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-04",
};

export default naturalHistoryStyle;
