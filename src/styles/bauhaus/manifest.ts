import type { SetupStyle } from "../types";

export const bauhausStyle: SetupStyle = {
  id: "bauhaus",
  name: "包豪斯几何现代",
  version: "1.0.0",
  subtitle: "Bauhaus Geometric System",
  description:
    "圆、方、三角纯粹几何形态，经典红黄蓝三原色点缀。非对称角切与厚实质感，强调形式追随功能与建筑构图美学。",
  inspiration: "魏玛包豪斯学院（Staatliches Bauhaus）、Wassily Kandinsky 几何色彩论与现代构造主义",
  author: "Setup Center Design Lab",
  tags: ["红黄蓝三原色", "非对称几何角", "粗黑外框", "形式追随功能", "建筑排版"],
  palette: {
    baseBg: "#111216",
    surface: "#191b22",
    cardBorder: "#2e3340",
    accent: "#ffbe0b",
    accentSecondary: "#1d4ed8",
    text: "#f8f9fa",
  },
  features: [
    "独特的几何对角圆角（左上与右下 14px，右上与左下直角 0px）",
    "三原色视觉分区：明黄激活态、深海蓝次级元素、纯红状态报警",
    "扎实的 2px 结构线框，清晰的板块建筑级切分",
    "软件卡片如同包豪斯现代主义工坊标签，功能信息极为醒目",
  ],
  tokens: {
    borderWidth: "2px",
    hardShadow: "4px 4px 0px #1d4ed8",
    borderRadius: "14px 0px 14px 0px",
    accentHue: "#ffbe0b",
  },
  designPrinciples: [
    "Form Follows Function — 形式必须服务于功能与结构",
    "Primary Geometry — 以圆、方、矩形作为界面基底单元",
    "Primary Color Accents — 仅使用红黄蓝三原色进行语义分级",
    "Structural Clarity — 边框和分区呈现建筑般的承重秩序感",
  ],
  // Tier 3. Geometric tile composition, deliberately notched corners so the
  // shapes read as constructed rather than rendered.
  experience: {
    tier: "composition",
    shell: "sidebar",
    navigation: "sidebar",
    detail: "rail",
    card: "tile",
    composition: "solid-grid",
    density: "normal",
    motion: "normal",
    ornament: { rule: "heavy", corner: "notch", decoration: "grid", chrome: "none" },
    tweakable: ["borderWidth", "shadow", "accent", "accentSecondary", "surface", "density", "motion"],
  },
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
