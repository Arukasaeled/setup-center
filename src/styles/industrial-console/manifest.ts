import type { SetupStyle } from "../types";

export const industrialConsoleStyle: SetupStyle = {
  id: "industrial-console",
  name: "工业工程控制台",
  version: "1.0.0",
  subtitle: "Industrial Console / Telemetry Deck",
  description:
    "碳素工程暗灰基底、安全警示橙与精密工业标尺。紧密的信息密度、机械沉降槽轮廓与仪表测控视感，专为严谨系统级开发打造。",
  inspiration: "工业自动化控制柜（PLC）、示波器与航天遥测地面站仪表操作台",
  author: "Setup Center Design Lab",
  tags: ["工业工程", "安全橙", "沉降槽", "高密度测控", "严密刻度"],
  palette: {
    baseBg: "#101216",
    surface: "#171a21",
    cardBorder: "#2a3140",
    accent: "#f97316",
    accentSecondary: "#38bdf8",
    text: "#e5e9f0",
  },
  features: [
    "沉降凹槽（Sunken Inset）边框与机械装配倒角",
    "醒目警示安全橙色标定关键动作与状态指示",
    "高密度信息排列与等宽通道代码标头",
    "软件卡片如同工业机柜插槽，插拔卡位感强烈",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "inset 0 1px 3px rgba(0, 0, 0, 0.6)",
    borderRadius: "4px",
    accentHue: "#f97316",
  },
  designPrinciples: [
    "Zero Ambiguity — 严苛明确的工程仪表级状态定义",
    "Compact Density — 紧凑高效的信息吞吐与快速定位",
    "Industrial Utility — 杜绝虚浮动效，突出安全与机械反馈",
    "Telemetry Cadence — 结构条理如同标准化机架模块",
  ],
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
