import type { SetupStyle } from "../types";

export const academicLabStyle: SetupStyle = {
  id: "academic-lab",
  name: "科学实验室仪器报告",
  version: "1.0.0",
  subtitle: "Academic Lab / Precision Instrument & Telemetry",
  description:
    "面向高级科学计算、数据可视化与高精度实验仪器监控设计。清澈深邃的实验室天青蓝（Cyan/Sky Blue）搭配极性石板灰，辅以精密的标尺网格、传感器读数卡片与数据微标。",
  inspiration: "欧洲核子研究组织（CERN）控制仪表、现代示波器分析界面与美国国家实验室观测终端",
  author: "Setup Center Design Lab",
  tags: ["科学实验", "天青蓝", "示波仪器", "精密标尺", "高信噪比"],
  palette: {
    baseBg: "#0c131a",
    surface: "#131d27",
    cardBorder: "#213243",
    accent: "#0ea5e9",
    accentSecondary: "#38bdf8",
    text: "#f0f8ff",
  },
  features: [
    "专业级实验室冷色调基底，提供最适合数据密集的超高信噪比",
    "圆角微小（4px），边缘带有 1px 细致冷光刻度边框",
    "所有遥测数据、状态与版本号均配备等宽精密数字排布",
    "强化计算任务的严谨感与客观性，极适合 AI 训练与数据分析流",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "0 2px 10px rgba(14, 165, 233, 0.08)",
    borderRadius: "4px",
    accentHue: "#0ea5e9",
  },
  designPrinciples: [
    "High Signal-to-Noise Ratio — 极高信息密度下的低认知负荷",
    "Instrument Calibration — 如同物理仪表经过精准校准的对齐系统",
    "Cool Analytical Temperament — 冷静、克制、忠于事实呈现",
  ],
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-03",
};
