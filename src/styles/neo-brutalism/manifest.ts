import type { SetupStyle } from "../types";

export const neoBrutalismStyle: SetupStyle = {
  id: "neo-brutalism",
  name: "新粗野主义",
  version: "1.0.0",
  subtitle: "Neo Brutalism / Web Raw Impact",
  description:
    "粗犷高饱和的 Web 粗野主义。3px 重边框、6px 实心黑色几何硬阴影与活泼高对比撞色。按钮自带真实物理按压位移与钝感顿挫反馈。",
  inspiration: "现代 Neo Brutalism 网页浪潮（Gumroad、Figma Brutalist 社区设计系统）",
  author: "Setup Center Design Lab",
  tags: ["3px粗黑线", "纯黑硬投影", "高饱和撞色", "真实按压触感", "高反差"],
  palette: {
    baseBg: "#12141a",
    surface: "#1a1e28",
    cardBorder: "#000000",
    accent: "#ffea28",
    accentSecondary: "#38bdf8",
    text: "#ffffff",
  },
  features: [
    "全局所有核心容器均带 2.5px ~ 3px 纯黑外框与 6px 直角实心黑投影",
    "点击交互具备物理下沉动画（按下时向右下偏移 3px，投影相应收拢）",
    "软件卡片拥有粗黑边与黄黑强辨识度，彻底告别融入背景的无力感",
    "标签与按钮皆为高饱和纯色胶囊，如同厚重实物贴纸",
  ],
  tokens: {
    borderWidth: "3px",
    hardShadow: "6px 6px 0px #000000",
    borderRadius: "10px",
    accentHue: "#ffea28",
  },
  designPrinciples: [
    "Tactile Reality — 通过位移与硬阴影还原真实物理按键触感",
    "Bold Outlines — 粗黑实线划定最清晰的视觉认知边界",
    "High Chroma Joy — 以高饱和点缀消解工业软件的枯燥沉闷",
    "Zero Soft Blur — 完全杜绝模糊与渐变，回归纯粹硬朗",
  ],
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
