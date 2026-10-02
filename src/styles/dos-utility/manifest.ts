import type { SetupStyle } from "../types";

export const dosUtilityStyle: SetupStyle = {
  id: "dos-utility",
  name: "IBM PC DOS 经典控制台",
  version: "1.0.0",
  subtitle: "DOS Utility / Turbo Pascal & Norton Commander",
  description:
    "致敬 1980~1990 年代 IBM PC 早期 DOS 经典全屏文本实用程序。以深蓝 (Navy #0000aa) 与青色制表符为骨架，配以亮黄色高亮光标。纯粹等宽字符栅格排布，带您重回 Turbo Pascal 与 Norton Commander 的黄金算力时代。",
  inspiration: "Borland Turbo Pascal 7.0 IDE、Norton Commander 双栏文件管理器与 MS-DOS 经典制表符界面",
  author: "Setup Center Design Lab",
  tags: ["经典DOS", "TurboPascal", "制表字符", "深蓝青框", "硬核实用"],
  palette: {
    baseBg: "#000080",
    surface: "#0000a8",
    cardBorder: "#00aaaa",
    accent: "#ffff55",
    accentSecondary: "#55ffff",
    text: "#ffffff",
  },
  features: [
    "原汁原味的 DOS 字符控制台深蓝底色与高亮黄色热键标识",
    "采用等宽字符点阵排布与经典双线方框制表符视感",
    "所有按钮与选区带有经典 DOS 文本倒显 (Reverse Video) 高对比光标",
    "带给资深系统开发者极其亲切的底层 BIOS / 嵌入式工具沉浸感",
  ],
  tokens: {
    borderWidth: "2px",
    hardShadow: "3px 3px 0px #000000",
    borderRadius: "0px",
    accentHue: "#ffff55",
  },
  designPrinciples: [
    "Character-Cell Orthogonality — 严格遵循 80x25 字符单元格空间秩序",
    "Color as Hardware Attribute — 还原 CGA/EGA 16 色硬件调色板神韵",
    "Keyboard-First Velocity — 高饱和黄色标识与疾速操作流",
  ],
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-03",
};
