import type { SetupStyle } from "../types";

export const terminalCrtStyle: SetupStyle = {
  id: "terminal-crt",
  name: "复古终端 CRT",
  version: "1.0.0",
  subtitle: "Cyber Terminal / Phosphor CRT",
  description:
    "复古黑客显像管荧光绿字符、全等宽代码排版与微弱发光扫描线。纯单色硬核纯字符界面，极度纯粹的极客情怀与命令行仪式感。",
  inspiration: "经典 VT100 / DEC 终端机、Fallout 避难所终端与早期 UNIX 工作站控制台",
  author: "Setup Center Design Lab",
  tags: ["等宽字符", "荧光绿字符", "显像管发光", "扫描线微光", "命令行仪式感"],
  palette: {
    baseBg: "#030804",
    surface: "#08140a",
    cardBorder: "#1b4d24",
    accent: "#4ade80",
    accentSecondary: "#86efac",
    text: "#86efac",
  },
  features: [
    "全局强制所有元素采用等宽字阶，标题带命令提示符 `> ` 语法",
    "文字自带微弱荧光辉光与 1px 细虚线 ASCII 结构装订线",
    "显像管暗夜深绿底色与低反差黑绿明暗关系",
    "软件卡片如同 Shell 输出的一个个服务进程，状态指示灯恒定亮起",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "0 0 10px rgba(74, 222, 128, 0.2)",
    borderRadius: "2px",
    accentHue: "#4ade80",
  },
  designPrinciples: [
    "Monospace Everything — 全局贯彻等宽字体，保证字符对齐美感",
    "Phosphor Glow — 适度字符微光营造真实阴极射线管质感",
    "CLI Prompt Grammar — 使用终端提示符引导交互视觉流",
    "Low Distraction Monotone — 单色系排除杂色干扰，直达技术核心",
  ],
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
