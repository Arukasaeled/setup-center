import type { SetupStyle } from "../types";

export const softProductMinimalStyle: SetupStyle = {
  id: "soft-product-minimal",
  name: "现代克制工坊",
  version: "1.0.0",
  subtitle: "Soft Product Minimal / Linear Discipline",
  description:
    "汲取 Linear 与 Raycast 顶级现代开发工具的克制精髓。黑曜石玄色微光、亚像素细边界与沉静冷靛蓝，极致的信息呼吸感与长期日用舒适度。",
  inspiration: "Linear、Raycast、Vercel Dashboard 与现代工匠级 Developer Tool 的纯粹克制排印",
  author: "Setup Center Design Lab",
  tags: ["极致克制", "黑曜石微光", "冷靛蓝", "亚像素边框", "工匠级排印"],
  palette: {
    baseBg: "#0a0b0e",
    surface: "#12141a",
    cardBorder: "rgba(255, 255, 255, 0.08)",
    accent: "#6366f1",
    accentSecondary: "#818cf8",
    text: "#f3f4f6",
  },
  features: [
    "极其细腻的 1px 亚像素半透明白边，消弭视觉突兀感",
    "高阶冷调靛青（#6366f1）极简点缀，专注内容本身",
    "精心调校的呼吸感行间距与扫读层次，适合长达数小时的连续开发",
    "软件卡片如同精修的现代键盘键帽，触感沉稳扎实",
  ],
  tokens: {
    borderWidth: "1px",
    hardShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.7)",
    borderRadius: "10px",
    accentHue: "#6366f1",
  },
  designPrinciples: [
    "Quiet Restraint — 克制不是单调，而是消除一切非必要视觉噪音",
    "Sub-Pixel Precision — 像素级微边界让面板层级井然有序",
    "Long-Session Comfort — 低对比柔和层次专为长期连续沉浸打造",
    "Product Discipline — 界面退居幕后，让创作与代码居于舞台中央",
  ],
  implemented: true,
  license: "MIT",
  updatedAt: "2026-10-02",
};
