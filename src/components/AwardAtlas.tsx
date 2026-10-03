import { useState, useMemo } from "react";
import clsx from "clsx";

export interface AwardCase {
  id: string;
  name: string;
  creator: string;
  tag: string;
  category: "dev-tools" | "hardware" | "editorial" | "spatial" | "audio" | "canvas";
  year: string;
  // Truthful Award & Reference fields:
  verified: boolean;
  awardSource: "Awwwards" | "Webby" | "FWA" | "Design Benchmark";
  awardYear: string;
  awardCategory: string;
  awardLevel: string;
  officialAwardUrl: string;
  originalSiteUrl: string;
  philosophy: string;
  designDNA: string[];
  visualMechanics: {
    palette: string[];
    radius: string;
    typography: string;
    motion: string;
    contrast: string;
    uniqueHook: string;
  };
  agentPrompt: string;
}

const AWARD_CASES: AwardCase[] = [
  {
    id: "linear",
    name: "Linear",
    creator: "Linear Orbit Inc.",
    tag: "键盘优先 · 曜石暗色 · 微边框光学质感",
    category: "dev-tools",
    year: "2020–至今",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "2020",
    awardCategory: "Developer Tools / Velocity Tracking",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://linear.app",
    philosophy: "极致追求「零等待」与「肌肉记忆」。界面不是一件观赏物，而是一套顺畅无阻的思考延伸器具。",
    designDNA: [
      "Keyboard-First: 99% 的核心路径可通过全局单键或修饰键流转",
      "Obsidian Depths: 基于 #0d0f12 的超深曜石层级，微弱渐变区分空间",
      "Hairline Specular: 1px 细线边框带有微量内发光 (0.5px rgba(255,255,255,0.08))",
      "Monotonic Rhythm: 数字与状态采用等宽数字 (tabular-nums) 精确垂直对齐",
    ],
    visualMechanics: {
      palette: ["#08090a", "#121417", "#5e6ad2", "#8b949e", "#f7f8f8"],
      radius: "6px (界面) / 4px (小徽标)",
      typography: "Inter / -apple-system, 400/500, letter-spacing -0.015em",
      motion: "Cubic-bezier(0.16, 1, 0.3, 1), 120ms~180ms 极速响应",
      contrast: "超高对比度，正文与背景对比达 14:1",
      uniqueHook: "微妙的角度渐变边缘、状态标签小圆球与 ⌘K 指令台",
    },
    agentPrompt: `你现在是一名世界顶级 UI/UX 设计师。请基于「Linear」的设计美学为应用构建前端样式：
- 基调：键盘优先、高密度专业工具、低认知负荷暗黑曜石风格。
- 配色：背景 #08090a，面板 #121417，强调色 #5e6ad2（紫蓝霓光），正文 #f7f8f8，次要 #8b949e。
- 轮廓：全局 6px 微圆角，1px 发丝边框带 0.5px 极弱高光。
- 交互：零等待感，所有列表项提供快捷键提示，鼠标悬停采用平滑深灰过渡。`,
  },
  {
    id: "stripe-press",
    name: "Stripe Press",
    creator: "Stripe Design Team",
    tag: "古典出版物 · 实体触感 · 典雅衬线装帧",
    category: "editorial",
    year: "2018–至今",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "2018",
    awardCategory: "Digital Publishing & Editorial Layout",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://press.stripe.com",
    philosophy: "让数字屏幕呈现纸质精装书籍的厚重与尊贵，让知识承载实体印刷术的经典尊严。",
    designDNA: [
      "Physicality: 模拟真实书脊、封底压凹印痕与布面精装纹理",
      "Grand Serif: 典雅衬线字体排版，大字阶标题散发古典文学气质",
      "Warm Parchment: 温暖象牙白与深红/墨蓝的贵族书籍配色",
      "Bookplate Detailing: 章节编号、藏书票样式角标与细微烫金描边",
    ],
    visualMechanics: {
      palette: ["#0f141c", "#1c2331", "#e3a857", "#f4efe6", "#c8372d"],
      radius: "2px~4px (模拟硬质书角精装裁切)",
      typography: "Newsreader / Garamond / Playfair Display + Inter",
      motion: "280ms 舒缓平滑阻尼，模拟翻页与布料起伏",
      contrast: "古典暖色调对比，富有阅读沉浸感",
      uniqueHook: "三维立体精装书封阴影、烫金压印渐变与书籍装订线",
    },
    agentPrompt: `你现在是一名世界顶级平面出版与 Web 设计大师。请基于「Stripe Press」的设计美学为应用构建前端样式：
- 基调：古典精装书籍装帧、实体纸张质感、典雅学术出版风格。
- 配色：深色背景 #0f141c，书脊质感 #1c2331，烫金强调 #e3a857，纸面柔光 #f4efe6，印章绯红 #c8372d。
- 字体：标题采用高质量古典衬线字体（如 Newsreader/Playfair），字距宽松，具有文学庄重感。
- 轮廓：4px 微硬角，多层次长漫反射书籍投影 (0 20px 40px rgba(0,0,0,0.5))。`,
  },
  {
    id: "te-op1",
    name: "Teenage Engineering OP-1",
    creator: "Teenage Engineering",
    tag: "实体旋钮 · 四色编码 · 纯真工业复古未来",
    category: "hardware",
    year: "2011–至今",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "2011",
    awardCategory: "Industrial Hardware & Synthesizer Design",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://teenage.engineering/products/op-1",
    philosophy: "反对伪科技的无聊平板化。让电子硬件像玩具一样令人渴望触摸、转动并发出奇妙声音。",
    designDNA: [
      "Four-Color Encoders: 蓝、绿、白、橙四色功能物理旋钮图腾",
      "Chiclet Keyboard: 极度平整的单色薄片按钮矩阵与精密网格",
      "OLED Playfulness: 矢量磁带机、小人跳跃等生动像素/矢量动画仪表",
      "CNC Aluminum Slate: 阳极氧化冷白灰铝制一体化基座",
    ],
    visualMechanics: {
      palette: ["#e3e3e3", "#2b2b2b", "#00a0e9", "#009944", "#f39800"],
      radius: "20px (整体机器圆角) / 2px (旋钮指示与内凹槽)",
      typography: "Druk / Akzidenz-Grotesk / 粗犷等宽无衬线",
      motion: "机械步进 Snap 顿挫感，旋钮转动带有离散齿轮刻度反馈",
      contrast: "亮白铝合金机身与浓墨黑按键、明亮彩钮形成玩具般对比",
      uniqueHook: "磁带机拟物滚动界面、四色彩色圆环指示器与严谨工业标尺",
    },
    agentPrompt: `请基于「Teenage Engineering OP-1」的设计哲学构建前端组件与视觉规范：
- 基调：触觉极佳的工业合成器、极简铝制机身、俏皮玩具感硬件界面。
- 标志性色彩：亮铝灰底色 #e5e5e5，深炭黑 #1e1e1e，四色旋钮标志：青蓝 #00a0e9、草绿 #009944、象牙白 #ffffff、鲜橙 #f39800。
- 控件：圆形旋转刻度指示旋钮、离散拨动开关、带有物理沉降感的小圆片轻触按钮。
- 动效：步进式刻度吸附，旋钮转动伴随角度数字变化与音效反馈。`,
  },
  {
    id: "vercel-geist",
    name: "Vercel Geist",
    creator: "Vercel Design Group",
    tag: "单色工程师理性 · 三角几何图腾 · 极端网格秩序",
    category: "dev-tools",
    year: "2019–至今",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "2023",
    awardCategory: "Typography & High-Density Design System",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://vercel.com/font",
    philosophy: "移除一切非必要的情绪干扰。代码与部署就是最严谨的数学规律，白纸黑字即是权威。",
    designDNA: [
      "Pure Monochrome: 极纯粹的黑 (#000000) 与白 (#ffffff)，无色温偏移",
      "Prismatic Triangle: 标志性纯几何三角符号与严丝合缝的 8px 基准网格",
      "High Density Telemetry: 密集的微型状态标签、Git 提交哈希与部署阶段流",
      "Razor Precision: 1px 细线等比分割，卡片之间无阴影仅依靠边框间隙",
    ],
    visualMechanics: {
      palette: ["#000000", "#111111", "#333333", "#888888", "#ffffff"],
      radius: "6px (卡片) / 4px (按钮与标签)",
      typography: "Geist Sans & Geist Mono, 紧凑字间距与严格等宽对齐",
      motion: "0.15s ease-out，极简淡入，禁止弹跳与漂浮",
      contrast: "21:1 绝对极端对比",
      uniqueHook: "黑色深渊背景、纯白细线描边、等宽数字微型信息流",
    },
    agentPrompt: `请按照「Vercel Geist」的设计规范为本界面编写 CSS 与排版规则：
- 基调：极致黑白极客美学、高冷工程严谨、数据密集型开发者控制台。
- 调色板：主背景纯黑 #000000，卡片表面 #0a0a0a，边框 #222222，正文纯白 #ededed，次要 #888888。
- 字体：统一使用 Geist Sans 与 Geist Mono，数字必须 tabular-nums。
- 结构：以紧密网格包裹微型指标、微型提交哈希与终端命令行。`,
  },
  {
    id: "raycast",
    name: "Raycast",
    creator: "Raycast Community",
    tag: "微光半透悬浮 · 快捷键和弦 · 零延迟瞬发",
    category: "dev-tools",
    year: "2020–至今",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "2020",
    awardCategory: "Desktop Command Center & Fast Launcher",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://www.raycast.com",
    philosophy: "界面应当像闪电一样快速降临、完成使命、随后消失无踪。它是数字工匠的瑞士军刀。",
    designDNA: [
      "Floating Pill Capsule: 居中浮空的圆角胶囊指令框，深色玻璃拟态",
      "Hotkey Chords: 每一个操作都标注直观的键盘符号 (如 ↵, ⌥↵, ⌘K)",
      "Vibrant Category Badges: 荧光青、紫罗兰、暖红的微型分类胶囊",
      "Instantaneous Filter: 打字输入瞬间零延迟重组列表项",
    ],
    visualMechanics: {
      palette: ["#141416", "#1c1c1f", "#ff6363", "#00d1b2", "#f5f5f7"],
      radius: "10px~12px (悬浮主窗口) / 5px (结果项)",
      typography: "-apple-system / SF Pro Display, 400/600",
      motion: "弹性迅速弹出 (spring 0.2s damping 25)",
      contrast: "深色背景上的高亮霓虹徽标，清晰视觉锚点",
      uniqueHook: "底部固定操作提示栏（Enter 选择 / ⌘K 动作面板）与悬浮深色磨砂玻璃",
    },
    agentPrompt: `请基于「Raycast」启动器与指令台的视觉交互风格重构本功能：
- 基调：悬浮半透明启动器、快捷键驱动、高效且视觉精致的现代化 macOS 质感。
- 窗口：居中悬浮卡片，带深邃黑色投影与微妙 1px 亮灰描边 (rgba(255,255,255,0.1))。
- 列表：左侧图标 + 主标题 + 右侧分类胶囊与键盘快捷键和弦指示。
- 底栏：固定一排当前可用快捷键提示（如 '↵ 打开', '⌘K 操作'）。`,
  },
  {
    id: "notion",
    name: "Notion",
    creator: "Notion Labs",
    tag: "白纸折痕 · 乐高积木块 · 亲和知识工坊",
    category: "editorial",
    year: "2018–至今",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "2018",
    awardCategory: "Modular Knowledge Workspace",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://www.notion.so",
    philosophy: "把复杂的软件还原成一张空白的纸。让每个人都能像搭积木一样自由组织信息与思维。",
    designDNA: [
      "Modular Blocks: 每一个段落、卡片、代码块都是可拖拽重排的独立乐高积木",
      "Paper Warmth: 略带温润米色的纸质基底，极低视觉压迫感",
      "Serif/Sans Harmony: 标题衬线与正文无衬线自由切换，兼具文学与工具感",
      "Iconic Header Art: 大幅封面插画、Emoji 图标与极简面包屑导航",
    ],
    visualMechanics: {
      palette: ["#ffffff", "#f7f6f3", "#37352f", "#787774", "#e8e7e4"],
      radius: "3px~4px (克制微圆角)",
      typography: "Lyon-Text (衬线) / Inter (无衬线) / IA-Writer Mono",
      motion: "极简 100ms 渐变，避免分散阅读注意力的剧烈动效",
      contrast: "柔和暖灰色阶，对比度适中，适合长久注视",
      uniqueHook: "左侧悬浮六点拖拽手柄、折叠三角形与无边框页面容器",
    },
    agentPrompt: `请采用「Notion」的知识工坊与模块化纸质风格设计此界面：
- 基调：温和的白纸质感、模块化 Block 组织方式、亲和且无压力的创作环境。
- 色彩：纸张底色 #f7f6f3，正文炭黑 #37352f，次级淡灰 #787774，分割线 #e8e7e4。
- 交互：可折叠的小箭头、卡片左侧悬浮拖动手柄、干净的悬停轻微灰色背景底纹。`,
  },
  {
    id: "ableton",
    name: "Ableton Live",
    creator: "Ableton AG",
    tag: "冷峻工业机架 · 调音台矩阵 · 纯粹生产力工具",
    category: "audio",
    year: "2001–至今",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "2001",
    awardCategory: "Digital Audio Workstation & Instrument Panel",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://www.ableton.com/en/live/",
    philosophy: "专为现场演出与高压录音棚设计。零装饰、零拟物阴影、每一个像素都承载声音参数。",
    designDNA: [
      "Modular Rack System: 底部一字排开的模块化音频处理机架与仪表",
      "Clip Matrix Grid: 直观的方形音频片段发射矩阵，带状态进度条",
      "Tactile Flat Dials: 极简纯平面旋转数值电位器与分贝柱状电平表",
      "High Visibility Themes: 极强环境适应能力的单色皮肤调色板（从录音棚暗夜到阳光直射模式）",
    ],
    visualMechanics: {
      palette: ["#2e2e2e", "#3a3a3a", "#ff9800", "#ffcf33", "#00d2c4"],
      radius: "0px~2px (机械直角，零多余圆角空间浪费)",
      typography: "Ableton Sans / DIN / 工业工程粗黑字",
      motion: "60fps 精确无延迟实时电平反馈，无任何装饰性缓动",
      contrast: "沉闷工业底色搭配超高饱和度信号灯（橙/绿/青）",
      uniqueHook: "步进式滑块、微型电平刻度标线与矩阵式触发网格",
    },
    agentPrompt: `请基于专业音频工作站「Ableton Live」构建工业仪器级 UI 界面：
- 基调：冷峻高效、高密度工业控制台、零废话的硬核专业工具。
- 色调：机架冷深灰 #242424，旋钮与插槽 #323232，参数信号橙 #ff9800，高亮青 #00d2c4。
- 构图：底部机架插槽模式，带有垂直滑动杆、旋转电位计旋钮与精准数值读数。
- 边框：0px~2px 直角硬边，紧密无缝排列。`,
  },
  {
    id: "arc-browser",
    name: "Arc Browser",
    creator: "The Browser Company",
    tag: "柔彩渐变空间 · 动态半透侧栏 · 灵动交互分屏",
    category: "canvas",
    year: "2022–至今",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "2022",
    awardCategory: "Spatial Tabs & Ambient Browser",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://arc.net",
    philosophy: "重新思考互联网的大门。浏览器不应是冷冰冰的窗口外壳，而应是充满色彩与个性化的个人数字工作室。",
    designDNA: [
      "Sidebar Command Desk: 彻底移除顶部传统标签栏，改为可折叠沉浸式侧栏",
      "Vibrant Space Palettes: 带有噪点质感的个性化双色渐变与透明度控制",
      "Split View Orchestration: 无缝并排平铺 2~4 个视窗，边框自适应当前空间色",
      "Playful Micro-Interactions: 悬停胶囊微动、Pin 钉选卡片与悬浮画中画",
    ],
    visualMechanics: {
      palette: ["#1c1a24", "#2d283e", "#8b5cf6", "#ec4899", "#fbcfe8"],
      radius: "12px~16px (柔和现代大圆角)",
      typography: "-apple-system / Inter, 胖圆而友善的现代无衬线",
      motion: "弹性贝塞尔曲线 (cubic-bezier(0.34, 1.56, 0.64, 1))，生动富有生命力",
      contrast: "高饱和度渐变与半透明毛玻璃互相交融",
      uniqueHook: "自适应空间主题色彩滚轮、侧栏收起后的呼吸感与浮岛卡片",
    },
    agentPrompt: `请基于「Arc Browser」的现代前卫设计语言设计本界面：
- 基调：新时代创意工作区、柔和彩色渐变、大圆角与半透明浮动面板。
- 配色：主基调为微醺暗紫深色 #1c1a24，辅以粉紫渐变 #8b5cf6 -> #ec4899，半透磨砂玻璃质感。
- 构图：左侧纵向一体化功能侧栏 + 右侧浮动内容主视窗，周围留有 12px 呼吸间隙。
- 轮廓：14px 圆角，外框带柔和漫射环境微光投影。`,
  },
  {
    id: "apple-visionos",
    name: "Apple VisionOS",
    creator: "Apple Human Interface",
    tag: "空间计算玻璃 · 动态高光折射 · 真实三维景深",
    category: "spatial",
    year: "2023–至今",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "2023",
    awardCategory: "Spatial Computing System Interface",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://developer.apple.com/visionos/",
    philosophy: "界面不再存在于物理屏幕内部，而是悬浮于物理真实世界之中。光线从真实环境穿透进来并形成倒影。",
    designDNA: [
      "Dynamic Glassmorphism: 能够根据背景真实世界明暗动态自适应的半透明毛玻璃材质",
      "Specular Rim Lights: 随观察视角移动的表面边缘微光与细腻折射条纹",
      "Spatial Depth & Elevation: 依托真实阴影与 Z 轴层级，浮窗在三维空间中拥有实体体积感",
      "Ornament Navigation: 悬浮于窗口外侧的独立控制把手与浮动底座",
    ],
    visualMechanics: {
      palette: ["rgba(255,255,255,0.12)", "rgba(0,0,0,0.4)", "#ffffff", "#0a84ff", "#30d158"],
      radius: "24px~32px (极平滑的连续超椭圆圆角)",
      typography: "SF Pro Display, 粗细对比分明，高亮白色正文",
      motion: "流体物理弹簧，视线注视（Hover）时有轻微隆起高光",
      contrast: "依靠玻璃表面模糊与反光制造层级，而非硬边界",
      uniqueHook: "连续超椭圆圆角、镜面高光外描边、悬浮于面板下方的浮动胶囊底座",
    },
    agentPrompt: `请基于「Apple VisionOS」的空间计算玻璃质感实现本组件：
- 基调：极致剔透的空间毛玻璃、柔和环境光折射、次世代三维悬浮质感。
- 材质：背景采用 backdrop-filter: blur(40px) saturate(180%)，表面带 1px 细微镜面渐变高光边框。
- 几何：24px 连续曲线超大圆角，窗口下方悬浮一根药丸状独立控制把手。
- 悬停：鼠标移上时，模拟眼球注视效果，卡片表面产生微量漫反射镜面光斑。`,
  },
  {
    id: "braun-rams",
    name: "Braun / Dieter Rams",
    creator: "Dieter Rams (Braun)",
    tag: "少即是多 · 实体凸起按键 · 极简数学严谨",
    category: "hardware",
    year: "1958–1987",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "1960",
    awardCategory: "Functional Minimalist Industrial Design",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://www.braun.com",
    philosophy: "Weniger, aber besser（少，但更好）。好设计是创新的、实用的、唯美的、不招摇的、诚实的、历久弥新的。",
    designDNA: [
      "Tactile Convex Buttons: ET66 计算器上圆滚饱满、触感极佳的微凸圆形双色按键",
      "Matte Plastic Textures: 温润细腻的消光米白与石墨黑工程塑料外壳",
      "Punctuation Color: 全局克制单色中，仅保留一颗醒目的黄色/橙色等号按键与红色开关",
      "Mathematical Grids: 严密推导的等比网格与工整扬声器发声孔微孔点阵",
    ],
    visualMechanics: {
      palette: ["#d6d4ce", "#282828", "#e47820", "#3a5f82", "#181818"],
      radius: "9999px (按键纯圆) / 8px (外壳四角)",
      typography: "Akzidenz-Grotesk / Helvetica / DIN 1451",
      motion: "机械微动开关下陷 1px，伴随清脆物理回弹",
      contrast: "经典的暖灰塑料质感与纯黑圆点按键形成不朽对比",
      uniqueHook: "经典 ET66 双色圆形凹凸键盘布局、微孔扬声器阵列、一抹亮橙色操作键",
    },
    agentPrompt: `请基于迪特·拉姆斯（Dieter Rams）为 Braun 确立的工业设计准则设计此组件：
- 核心信条：少，但更好（Weniger, aber besser）。诚实、克制、历久弥新。
- 材质：暖灰塑料 #d6d4ce，哑光深炭黑 #282828，主动作醒目亮橙 #e47820。
- 按键：圆形微凸按钮，带微妙的物理投影 (box-shadow: 0 2px 4px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.4))。
- 排版：Akzidenz-Grotesk 或 Helvetica，极为严谨的数学比例栅格。`,
  },
  {
    id: "github-next",
    name: "GitHub Next",
    creator: "GitHub Office of the CTO",
    tag: "代码智能先锋 · 赛博全息遥测 · 未来开发者实验",
    category: "dev-tools",
    year: "2021–至今",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "2021",
    awardCategory: "Future Developer Tools Exploration",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://githubnext.com",
    philosophy: "探索十年后的软件工程形态。AI 与代码的交互不再是打字机，而是交互式思维可视化与全息共舞。",
    designDNA: [
      "Holographic Telemetry: 赛博暗夜中游离的青蓝/紫光霓虹数据粒子与流动连接线",
      "Live Code Morphing: 代码行级智能建议以全息荧光块与差异波纹形态生长",
      "Radar & Grid Wireframes: 带有坐标刻度的半透明网格与航天遥测仪表感",
      "Gradient Ambient Glow: 卡片后方悬浮着流动的球形色散光晕",
    ],
    visualMechanics: {
      palette: ["#050811", "#0e1526", "#00f0ff", "#a855f7", "#ec4899"],
      radius: "8px~10px",
      typography: "Mona Sans / Hubot Sans / JetBrains Mono",
      motion: "连续流动的光晕位移 (Infinite ambient shift 8s ease)",
      contrast: "极深海蓝夜色与刺眼赛博全息荧光（Cyan/Violet）",
      uniqueHook: "流动光斑背景、全息代码行级浮标、渐变细线流动边框",
    },
    agentPrompt: `请基于「GitHub Next」未来开发者先锋实验室的视觉调性编写前端风格：
- 基调：次世代 AI 编程体验、赛博全息暗夜、流动数据流与代码智能共舞。
- 调色板：深渊暗海蓝 #050811，面板底色 #0e1526，全息霓虹青 #00f0ff，灵感紫 #a855f7。
- 效果：卡片边框采用渐变流光 (border-image / conic-gradient)，背后衬托缓慢呼吸的模糊柔光斑。
- 字体：采用 GitHub Mona Sans 与 JetBrains Mono 等宽代码字体。`,
  },
  {
    id: "figma",
    name: "Figma",
    creator: "Figma Inc.",
    tag: "无限多人画布 · 矢量标尺精准 · 实时协作光标",
    category: "canvas",
    year: "2016–至今",
    verified: false,
    awardSource: "Design Benchmark",
    awardYear: "2016",
    awardCategory: "Collaborative Web Vector Graphics",
    awardLevel: "Design Reference / 行业设计标杆",
    officialAwardUrl: "",
    originalSiteUrl: "https://www.figma.com",
    philosophy: "设计即协作。通过 WebGL 与高精度矢量引擎，把整个团队召集在同一张无边无际的创作画布上。",
    designDNA: [
      "Infinite Grid Canvas: 带有网格与多级缩放比例尺的沉浸式无边画布",
      "Multiplayer Cursors: 每一个协作者拥有独立明亮的彩色光标与浮动名字标签",
      "Precision Vector Inspector: 紧凑三栏布局，右侧极度精密的几何/图层属性控制面板",
      "Layer Tree Scaffolding: 嵌套层级清晰、带图标状态指示的左侧组件导航树",
    ],
    visualMechanics: {
      palette: ["#1e1e1e", "#2c2c2c", "#0d99ff", "#0fa958", "#ff7262"],
      radius: "2px (微型控制项) / 6px (弹窗与工具栏)",
      typography: "Inter / -apple-system, 11px~12px 超紧密专业工具字体",
      motion: "60fps 多人平滑光标插值跟随，工具栏展开带微回弹",
      contrast: "中性深灰底色搭配鲜艳的协作成员识别色",
      uniqueHook: "悬浮在画布底部的药丸工具岛、彩色的协作者鼠标光标、右上角头像堆叠环",
    },
    agentPrompt: `请基于专业设计工具「Figma」的工作台与画布界面设计此功能组件：
- 基调：无限缩放矢量画布、实时多人协作光标、高密度属性检查器。
- 配色：界面中性深灰 #1e1e1e，次表面 #2c2c2c，选中强调蓝 #0d99ff，协作者彩色光标。
- 构图：顶部悬浮快捷工具岛（药丸形态），左侧图层树，右侧精密排版/布局参数调节面板。
- 精度：11px 紧凑排版，数值输入框支持双击直接键入。`,
  },
];

/** Geometric SVG Archetype Sketch for each Award case */
function CaseArchetypeSketch({ id }: { id: string }) {
  switch (id) {
    case "linear":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          <rect width="320" height="180" rx="8" fill="#08090a" />
          {/* Subtle gradient hairline card */}
          <rect x="18" y="18" width="284" height="144" rx="6" fill="#121417" stroke="#23272f" strokeWidth="1" />
          {/* Top header bar */}
          <line x1="18" y1="52" x2="302" y2="52" stroke="#1d2127" strokeWidth="1" />
          <circle cx="34" cy="35" r="4" fill="#5e6ad2" />
          <rect x="46" y="32" width="60" height="6" rx="3" fill="#363b44" />
          {/* Command pill */}
          <rect x="238" y="27" width="50" height="16" rx="4" fill="#1c2026" stroke="#2b313b" strokeWidth="0.8" />
          <text x="263" y="38" fill="#8b949e" fontSize="8" fontFamily="monospace" textAnchor="middle">⌘K</text>
          {/* Issue row 1 */}
          <rect x="28" y="66" width="264" height="24" rx="4" fill="#181b20" />
          <circle cx="40" cy="78" r="3" fill="#f59e0b" />
          <rect x="52" y="75" width="80" height="6" rx="2" fill="#d1d5db" />
          <rect x="230" y="74" width="48" height="8" rx="2" fill="#5e6ad2" opacity="0.3" />
          {/* Issue row 2 */}
          <rect x="28" y="96" width="264" height="24" rx="4" fill="#14161a" />
          <circle cx="40" cy="108" r="3" fill="#10b981" />
          <rect x="52" y="105" width="110" height="6" rx="2" fill="#6b7280" />
          <rect x="246" y="104" width="32" height="8" rx="2" fill="#2d333b" />
          {/* Issue row 3 */}
          <rect x="28" y="126" width="264" height="24" rx="4" fill="#14161a" />
          <circle cx="40" cy="138" r="3" fill="#6366f1" />
          <rect x="52" y="135" width="95" height="6" rx="2" fill="#4b5563" />
          <rect x="236" y="134" width="42" height="8" rx="2" fill="#2d333b" />
        </svg>
      );

    case "stripe-press":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          <rect width="320" height="180" rx="8" fill="#0b0e14" />
          {/* Book Spine & Cover */}
          <g transform="translate(60, 20)">
            {/* Book Drop Shadow */}
            <rect x="8" y="8" width="190" height="130" rx="3" fill="#000" opacity="0.6" filter="blur(6px)" />
            {/* Book Leather Texture */}
            <rect width="190" height="130" rx="3" fill="#1a2332" stroke="#2c3a52" strokeWidth="1.5" />
            {/* Spine indent */}
            <line x1="22" y1="0" x2="22" y2="130" stroke="#0f151f" strokeWidth="2" />
            <line x1="24" y1="0" x2="24" y2="130" stroke="#2e3c54" strokeWidth="1" />
            {/* Gold foil deboss title */}
            <rect x="42" y="28" width="120" height="6" rx="1" fill="#e3a857" opacity="0.9" />
            <rect x="42" y="40" width="85" height="4" rx="1" fill="#e3a857" opacity="0.6" />
            {/* Book Illustration Plate */}
            <rect x="42" y="58" width="120" height="48" rx="2" fill="#121822" stroke="#e3a857" strokeWidth="0.8" opacity="0.8" />
            <circle cx="102" cy="82" r="16" stroke="#e3a857" strokeWidth="1" strokeDasharray="2 2" />
            <line x1="86" y1="82" x2="118" y2="82" stroke="#e3a857" strokeWidth="0.8" />
            <line x1="102" y1="66" x2="102" y2="98" stroke="#e3a857" strokeWidth="0.8" />
            {/* Red Silk Ribbon */}
            <path d="M150 0 L150 70 L156 64 L162 70 L162 0 Z" fill="#c8372d" />
          </g>
        </svg>
      );

    case "te-op1":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          {/* Aluminum Slate Chassis */}
          <rect width="320" height="180" rx="12" fill="#141414" />
          <rect x="16" y="16" width="288" height="148" rx="10" fill="#dedede" stroke="#b0b0b0" strokeWidth="1.5" />
          {/* Tiny OLED Screen */}
          <rect x="32" y="30" width="84" height="48" rx="3" fill="#181818" stroke="#404040" strokeWidth="1" />
          {/* Tape reels on OLED */}
          <circle cx="56" cy="54" r="12" stroke="#ffffff" strokeWidth="1.5" />
          <circle cx="92" cy="54" r="12" stroke="#ffffff" strokeWidth="1.5" />
          <line x1="56" y1="66" x2="92" y2="66" stroke="#ffffff" strokeWidth="1" />
          {/* 4 Iconic Color Encoders */}
          {/* 1. Blue */}
          <circle cx="150" cy="54" r="15" fill="#f0f0f0" stroke="#b8b8b8" strokeWidth="1" />
          <circle cx="150" cy="54" r="10" fill="#00a0e9" />
          <line x1="150" y1="44" x2="150" y2="54" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
          {/* 2. Green */}
          <circle cx="190" cy="54" r="15" fill="#f0f0f0" stroke="#b8b8b8" strokeWidth="1" />
          <circle cx="190" cy="54" r="10" fill="#009944" />
          <line x1="190" y1="44" x2="190" y2="54" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" transform="rotate(45 190 54)" />
          {/* 3. White */}
          <circle cx="230" cy="54" r="15" fill="#f0f0f0" stroke="#b8b8b8" strokeWidth="1" />
          <circle cx="230" cy="54" r="10" fill="#ffffff" stroke="#999" strokeWidth="0.5" />
          <line x1="230" y1="44" x2="230" y2="54" stroke="#222222" strokeWidth="2" strokeLinecap="round" transform="rotate(-30 230 54)" />
          {/* 4. Orange */}
          <circle cx="270" cy="54" r="15" fill="#f0f0f0" stroke="#b8b8b8" strokeWidth="1" />
          <circle cx="270" cy="54" r="10" fill="#f39800" />
          <line x1="270" y1="44" x2="270" y2="54" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" transform="rotate(90 270 54)" />
          {/* Chiclet Keypad Matrix */}
          <g transform="translate(32, 94)">
            {Array.from({ length: 14 }).map((_, i) => (
              <rect
                key={i}
                x={i * 18.5}
                y={0}
                width="14"
                height="22"
                rx="2"
                fill="#ffffff"
                stroke="#c4c4c4"
                strokeWidth="0.8"
              />
            ))}
            {/* Piano sharps */}
            {[1, 2, 4, 5, 6, 8, 9, 11, 12].map((k) => (
              <rect
                key={`sharp-${k}`}
                x={k * 18.5 - 6}
                y={0}
                width="11"
                height="13"
                rx="1.5"
                fill="#2b2b2b"
              />
            ))}
            {/* Transport play button */}
            <circle cx="260" cy="40" r="8" fill="#e82b2b" />
          </g>
        </svg>
      );

    case "vercel-geist":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          <rect width="320" height="180" rx="8" fill="#000000" />
          {/* Sharp Grid Frame */}
          <rect x="20" y="20" width="280" height="140" fill="#050505" stroke="#222222" strokeWidth="1" />
          {/* Geometric Triangle */}
          <polygon points="160,36 178,68 142,68" fill="#ffffff" />
          {/* Telemetry rows */}
          <line x1="20" y1="84" x2="300" y2="84" stroke="#1c1c1c" strokeWidth="1" />
          <rect x="36" y="98" width="50" height="8" rx="2" fill="#ffffff" />
          <rect x="94" y="100" width="30" height="5" rx="1" fill="#444444" />
          <rect x="236" y="98" width="46" height="8" rx="2" fill="#111111" stroke="#333333" strokeWidth="1" />
          {/* Monospace Commit Stream */}
          <line x1="20" y1="120" x2="300" y2="120" stroke="#1c1c1c" strokeWidth="1" />
          <circle cx="42" cy="138" r="3" fill="#0070f3" />
          <text x="54" y="141" fill="#888888" fontSize="8" fontFamily="monospace">7f93a1c</text>
          <text x="110" y="141" fill="#ffffff" fontSize="8" fontFamily="monospace">deploy to production</text>
          <text x="250" y="141" fill="#0070f3" fontSize="8" fontFamily="monospace">Ready</text>
        </svg>
      );

    case "raycast":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          <rect width="320" height="180" rx="8" fill="#0c0d10" />
          {/* Floating Pill Spotlight Modal */}
          <g transform="translate(30, 30)">
            <rect
              width="260"
              height="120"
              rx="12"
              fill="#18181b"
              stroke="#2e2e33"
              strokeWidth="1"
              filter="drop-shadow(0 15px 25px rgba(0,0,0,0.8))"
            />
            {/* Search Input Bar */}
            <circle cx="24" cy="22" r="5" stroke="#a1a1aa" strokeWidth="1.5" />
            <line x1="28" y1="26" x2="33" y2="31" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" />
            <text x="42" y="26" fill="#f4f4f5" fontSize="11" fontFamily="sans-serif">Search apps, commands...</text>
            <line x1="0" y1="44" x2="260" y2="44" stroke="#27272a" strokeWidth="1" />
            {/* Active item */}
            <rect x="8" y="52" width="244" height="24" rx="6" fill="#27272a" />
            <rect x="18" y="59" width="10" height="10" rx="2" fill="#ff6363" />
            <text x="36" y="68" fill="#ffffff" fontSize="9.5" fontWeight="bold">Create Linear Issue</text>
            <rect x="200" y="57" width="44" height="14" rx="3" fill="#18181b" stroke="#3f3f46" strokeWidth="0.8" />
            <text x="222" y="67" fill="#a1a1aa" fontSize="8" fontFamily="monospace" textAnchor="middle">↵ Enter</text>
            {/* Inactive item */}
            <rect x="18" y="86" width="10" height="10" rx="2" fill="#00d1b2" />
            <text x="36" y="94" fill="#a1a1aa" fontSize="9">Switch Sound Output</text>
            {/* Footer hotkeys */}
            <line x1="0" y1="104" x2="260" y2="104" stroke="#27272a" strokeWidth="0.8" />
            <text x="14" y="114" fill="#71717a" fontSize="7.5" fontFamily="monospace">Raycast v1.82 · ⌘K Actions</text>
          </g>
        </svg>
      );

    case "notion":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          <rect width="320" height="180" rx="8" fill="#f7f6f3" />
          {/* Notion Document Container */}
          <rect x="36" y="16" width="248" height="148" rx="4" fill="#ffffff" stroke="#e3e2de" strokeWidth="1" />
          {/* Cover Art Banner */}
          <rect x="36" y="16" width="248" height="34" fill="#e9e7e2" />
          <circle cx="60" cy="50" r="12" fill="#ffffff" stroke="#e3e2de" strokeWidth="1" />
          <text x="60" y="54" fill="#37352f" fontSize="12" textAnchor="middle">✦</text>
          {/* Page Title */}
          <rect x="80" y="46" width="100" height="8" rx="2" fill="#37352f" />
          {/* Notion Blocks */}
          <g transform="translate(56, 74)">
            {/* Drag Handle 6-dots */}
            <circle cx="-10" cy="4" r="1" fill="#b0afa8" />
            <circle cx="-10" cy="8" r="1" fill="#b0afa8" />
            <circle cx="-7" cy="4" r="1" fill="#b0afa8" />
            <circle cx="-7" cy="8" r="1" fill="#b0afa8" />
            {/* Heading block */}
            <rect x="0" y="0" width="140" height="7" rx="1.5" fill="#37352f" />
            <rect x="0" y="14" width="180" height="4" rx="1" fill="#787774" />
            <rect x="0" y="24" width="160" height="4" rx="1" fill="#787774" />
            {/* Callout box */}
            <rect x="0" y="38" width="206" height="26" rx="3" fill="#f1f1ef" stroke="#e3e2de" strokeWidth="0.8" />
            <text x="12" y="54" fill="#e3a857" fontSize="10">💡</text>
            <rect x="28" y="47" width="120" height="4" rx="1" fill="#787774" />
            <rect x="28" y="54" width="80" height="4" rx="1" fill="#a4a29c" />
          </g>
        </svg>
      );

    case "ableton":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          <rect width="320" height="180" rx="8" fill="#1e1e1e" />
          {/* Matrix Rack Area */}
          <rect x="16" y="16" width="130" height="148" fill="#2b2b2b" stroke="#3d3d3d" strokeWidth="1" />
          {/* Clips */}
          <g transform="translate(24, 26)">
            {Array.from({ length: 4 }).map((_, r) => (
              <g key={r} transform={`translate(0, ${r * 32})`}>
                <rect width="52" height="24" fill={r === 1 ? "#ff9800" : "#383838"} rx="1" />
                <polygon points="10,12 16,8 16,16" fill={r === 1 ? "#000" : "#888"} />
                <rect x="60" width="52" height="24" fill={r === 2 ? "#00d2c4" : "#383838"} rx="1" />
                <polygon points="70,12 76,8 76,16" fill={r === 2 ? "#000" : "#888"} />
              </g>
            ))}
          </g>
          {/* Device Rack Area */}
          <rect x="156" y="16" width="148" height="148" fill="#242424" stroke="#3d3d3d" strokeWidth="1" />
          <rect x="156" y="16" width="148" height="18" fill="#383838" />
          <text x="164" y="29" fill="#e0e0e0" fontSize="8" fontFamily="sans-serif" fontWeight="bold">WAVETABLE SYNTH</text>
          {/* Dials / Rotary Pots */}
          <g transform="translate(170, 54)">
            <circle cx="16" cy="16" r="14" fill="#303030" stroke="#ff9800" strokeWidth="2" strokeDasharray="60 30" />
            <circle cx="16" cy="16" r="4" fill="#181818" />
            <text x="16" y="40" fill="#a0a0a0" fontSize="7" textAnchor="middle">FREQ</text>

            <circle cx="64" cy="16" r="14" fill="#303030" stroke="#00d2c4" strokeWidth="2" strokeDasharray="45 45" />
            <circle cx="64" cy="16" r="4" fill="#181818" />
            <text x="64" y="40" fill="#a0a0a0" fontSize="7" textAnchor="middle">RESO</text>

            <circle cx="112" cy="16" r="14" fill="#303030" stroke="#e0e0e0" strokeWidth="2" strokeDasharray="75 15" />
            <circle cx="112" cy="16" r="4" fill="#181818" />
            <text x="112" y="40" fill="#a0a0a0" fontSize="7" textAnchor="middle">GAIN</text>
          </g>
          {/* LED VUmeter */}
          <g transform="translate(170, 114)">
            <rect width="120" height="8" rx="1" fill="#181818" />
            <rect width="85" height="8" rx="1" fill="#4caf50" />
            <rect x="85" width="20" height="8" fill="#ffeb3b" />
            <rect x="105" width="5" height="8" fill="#f44336" />
          </g>
        </svg>
      );

    case "arc-browser":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          <rect width="320" height="180" rx="8" fill="#13111c" />
          {/* Frosted Purple Gradient Background wash */}
          <rect x="16" y="16" width="288" height="148" rx="14" fill="#1c182b" stroke="#332a4d" strokeWidth="1" />
          {/* Left Vertical Pill Sidebar */}
          <rect x="22" y="22" width="76" height="136" rx="10" fill="#241e38" />
          {/* Window traffic lights */}
          <circle cx="34" cy="34" r="3" fill="#ff5f56" />
          <circle cx="42" cy="34" r="3" fill="#ffbd2e" />
          <circle cx="50" cy="34" r="3" fill="#27c93f" />
          {/* Pinned tabs pill */}
          <rect x="28" y="46" width="64" height="16" rx="5" fill="#8b5cf6" opacity="0.4" />
          <rect x="28" y="66" width="64" height="16" rx="5" fill="#312a4a" />
          <rect x="28" y="86" width="64" height="16" rx="5" fill="#312a4a" />
          {/* Right Main Web View Island */}
          <rect x="106" y="22" width="192" height="136" rx="10" fill="#ffffff" />
          {/* Split view split line */}
          <line x1="202" y1="22" x2="202" y2="158" stroke="#e5e7eb" strokeWidth="1.5" />
          <rect x="118" y="36" width="60" height="6" rx="2" fill="#9ca3af" />
          <rect x="118" y="48" width="40" height="4" rx="1" fill="#d1d5db" />
          <rect x="214" y="36" width="55" height="6" rx="2" fill="#9ca3af" />
          <rect x="214" y="48" width="65" height="4" rx="1" fill="#d1d5db" />
        </svg>
      );

    case "apple-visionos":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          <rect width="320" height="180" rx="8" fill="#000000" />
          {/* Simulated Real World Pass-Through Room */}
          <radialGradient id="roomGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2c3e50" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.9" />
          </radialGradient>
          <rect width="320" height="180" fill="url(#roomGlow)" />
          {/* Spatial Glass Panel */}
          <g transform="translate(40, 24)">
            {/* Deep Ambient Soft Shadow */}
            <rect x="10" y="10" width="220" height="110" rx="24" fill="#000" opacity="0.7" filter="blur(8px)" />
            {/* Dynamic Glass Surface */}
            <rect
              width="240"
              height="120"
              rx="24"
              fill="rgba(255, 255, 255, 0.12)"
              stroke="rgba(255, 255, 255, 0.35)"
              strokeWidth="1.2"
            />
            {/* Specular Rim Light Gradient */}
            <path
              d="M 24 0 L 216 0 C 230 0 240 10 240 24 L 240 40"
              stroke="rgba(255, 255, 255, 0.7)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            {/* App Content */}
            <rect x="28" y="28" width="40" height="40" rx="12" fill="#0a84ff" />
            <rect x="80" y="34" width="90" height="8" rx="4" fill="#ffffff" />
            <rect x="80" y="48" width="60" height="6" rx="3" fill="rgba(255,255,255,0.6)" />
            {/* Floating Window Handle Bar below panel */}
            <rect x="80" y="130" width="80" height="6" rx="3" fill="rgba(255,255,255,0.6)" />
          </g>
        </svg>
      );

    case "braun-rams":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          <rect width="320" height="180" rx="8" fill="#1a1a1a" />
          {/* ET66 Calculator Chassis */}
          <rect x="80" y="12" width="160" height="156" rx="8" fill="#d6d4ce" stroke="#b8b5ac" strokeWidth="1.5" />
          {/* LCD Bezel & Display */}
          <rect x="94" y="24" width="132" height="28" rx="3" fill="#1c241c" stroke="#3b423b" strokeWidth="1" />
          <text x="218" y="43" fill="#9db59d" fontSize="13" fontFamily="monospace" textAnchor="end">1977.06</text>
          {/* Circular Convex Button Grid */}
          <g transform="translate(94, 62)">
            {/* Row 1 */}
            <circle cx="14" cy="14" r="10" fill="#6a3028" />
            <circle cx="44" cy="14" r="10" fill="#333333" />
            <circle cx="74" cy="14" r="10" fill="#333333" />
            <circle cx="104" cy="14" r="10" fill="#333333" />
            <circle cx="126" cy="14" r="6" fill="#888888" />

            {/* Row 2 */}
            <circle cx="14" cy="40" r="10" fill="#222222" />
            <circle cx="44" cy="40" r="10" fill="#222222" />
            <circle cx="74" cy="40" r="10" fill="#222222" />
            <circle cx="104" cy="40" r="10" fill="#333333" />

            {/* Row 3 */}
            <circle cx="14" cy="66" r="10" fill="#222222" />
            <circle cx="44" cy="66" r="10" fill="#222222" />
            <circle cx="74" cy="66" r="10" fill="#222222" />
            <circle cx="104" cy="66" r="10" fill="#333333" />

            {/* Row 4 - Orange Equal Key */}
            <circle cx="14" cy="92" r="10" fill="#222222" />
            <circle cx="44" cy="92" r="10" fill="#222222" />
            <circle cx="74" cy="92" r="10" fill="#222222" />
            <circle cx="104" cy="92" r="10" fill="#e47820" />
          </g>
        </svg>
      );

    case "github-next":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          <rect width="320" height="180" rx="8" fill="#04060c" />
          {/* Cyan/Violet Ambient Nebula */}
          <circle cx="240" cy="60" r="60" fill="#a855f7" opacity="0.15" filter="blur(30px)" />
          <circle cx="80" cy="120" r="50" fill="#00f0ff" opacity="0.15" filter="blur(30px)" />
          {/* Radar grid coordinates */}
          <line x1="20" y1="40" x2="300" y2="40" stroke="#12182b" strokeWidth="0.8" />
          <line x1="20" y1="90" x2="300" y2="90" stroke="#12182b" strokeWidth="0.8" />
          <line x1="20" y1="140" x2="300" y2="140" stroke="#12182b" strokeWidth="0.8" />
          {/* Holographic Card */}
          <rect x="36" y="24" width="248" height="132" rx="8" fill="#090f1d" stroke="#00f0ff" strokeWidth="1" strokeOpacity="0.4" />
          {/* Corner brackets */}
          <path d="M 36 36 L 36 24 L 48 24" stroke="#00f0ff" strokeWidth="2" />
          <path d="M 284 36 L 284 24 L 272 24" stroke="#00f0ff" strokeWidth="2" />
          <path d="M 36 144 L 36 156 L 48 156" stroke="#00f0ff" strokeWidth="2" />
          <path d="M 284 144 L 284 156 L 272 156" stroke="#00f0ff" strokeWidth="2" />
          {/* Code Stream with AI Neon Suggestion */}
          <text x="54" y="48" fill="#64748b" fontSize="8" fontFamily="monospace">const pipeline = new Telemetry();</text>
          <text x="54" y="64" fill="#f8fafc" fontSize="8" fontFamily="monospace">pipeline.observe(events);</text>
          {/* Neon Hologram Ghost Morph */}
          <rect x="50" y="74" width="210" height="24" rx="4" fill="#a855f7" fillOpacity="0.15" stroke="#a855f7" strokeWidth="0.8" />
          <text x="54" y="89" fill="#00f0ff" fontSize="8" fontFamily="monospace">+ // AI: Autowire vector memory cache</text>
          <circle cx="248" cy="86" r="3" fill="#00f0ff" />
        </svg>
      );

    case "figma":
      return (
        <svg viewBox="0 0 320 180" className="w-full h-full" fill="none">
          <rect width="320" height="180" rx="8" fill="#1e1e1e" />
          {/* Infinite Canvas Dots */}
          <g fill="#333333">
            {Array.from({ length: 8 }).flatMap((_, x) =>
              Array.from({ length: 5 }).map((__, y) => (
                <circle key={`${x}-${y}`} cx={30 + x * 38} cy={20 + y * 34} r="1" />
              ))
            )}
          </g>
          {/* Selected Frame on Canvas */}
          <rect x="70" y="30" width="130" height="90" fill="#2c2c2c" stroke="#0d99ff" strokeWidth="1.5" />
          {/* Selection Handles */}
          <rect x="67" y="27" width="6" height="6" fill="#ffffff" stroke="#0d99ff" strokeWidth="1" />
          <rect x="197" y="27" width="6" height="6" fill="#ffffff" stroke="#0d99ff" strokeWidth="1" />
          <rect x="67" y="117" width="6" height="6" fill="#ffffff" stroke="#0d99ff" strokeWidth="1" />
          <rect x="197" y="117" width="6" height="6" fill="#ffffff" stroke="#0d99ff" strokeWidth="1" />
          {/* User Multiplayer Cursors */}
          {/* Cursor 1: Dylan (Blue) */}
          <g transform="translate(130, 60)">
            <polygon points="0,0 4,14 7,10 12,12 13,9 8,8 13,5" fill="#0d99ff" />
            <rect x="12" y="12" width="36" height="13" rx="3" fill="#0d99ff" />
            <text x="30" y="21" fill="#fff" fontSize="7" textAnchor="middle" fontWeight="bold">Dylan</text>
          </g>
          {/* Cursor 2: Emma (Pink) */}
          <g transform="translate(180, 100)">
            <polygon points="0,0 4,14 7,10 12,12 13,9 8,8 13,5" fill="#ff7262" />
            <rect x="12" y="12" width="34" height="13" rx="3" fill="#ff7262" />
            <text x="29" y="21" fill="#fff" fontSize="7" textAnchor="middle" fontWeight="bold">Emma</text>
          </g>
          {/* Right Inspector Sidebar */}
          <rect x="236" y="0" width="84" height="180" fill="#222222" stroke="#333333" strokeWidth="1" />
          <rect x="246" y="16" width="64" height="6" rx="2" fill="#555555" />
          <rect x="246" y="32" width="30" height="16" rx="2" fill="#2c2c2c" stroke="#383838" strokeWidth="1" />
          <text x="261" y="43" fill="#888" fontSize="7" textAnchor="middle">W 360</text>
          <rect x="280" y="32" width="30" height="16" rx="2" fill="#2c2c2c" stroke="#383838" strokeWidth="1" />
          <text x="295" y="43" fill="#888" fontSize="7" textAnchor="middle">H 800</text>
          {/* Floating Bottom Pill Toolbar */}
          <rect x="100" y="148" width="100" height="20" rx="6" fill="#2c2c2c" stroke="#3a3a3a" strokeWidth="1" />
          <circle cx="116" cy="158" r="4" fill="#0d99ff" />
          <rect x="128" y="155" width="6" height="6" fill="#888888" />
          <text x="150" y="161" fill="#888888" fontSize="9">T</text>
        </svg>
      );

    default:
      return null;
  }
}

const STORAGE_NOTES_KEY = "setup-center:award-atlas-notes";

export function AwardAtlas({ onNotice }: { onNotice?: (msg: string) => void }) {
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  // Persistent Design Notes
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    if (typeof localStorage === "undefined") return {};
    try {
      const saved = localStorage.getItem(STORAGE_NOTES_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const handleUpdateNote = (caseId: string, text: string) => {
    const next = { ...notes, [caseId]: text };
    setNotes(next);
    try {
      localStorage.setItem(STORAGE_NOTES_KEY, JSON.stringify(next));
    } catch {}
  };

  const filteredCases = useMemo(() => {
    return AWARD_CASES.filter((c) => {
      if (filterCategory !== "all" && c.category !== filterCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.creator.toLowerCase().includes(q) ||
          c.tag.toLowerCase().includes(q) ||
          c.philosophy.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [filterCategory, searchQuery]);

  const selectedCase = useMemo(() => {
    return AWARD_CASES.find((c) => c.id === selectedCaseId) ?? null;
  }, [selectedCaseId]);

  const handleCopyPrompt = (c: AwardCase) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(c.agentPrompt).then(() => {
        setCopiedPromptId(c.id);
        onNotice?.(`已复制「${c.name}」的 AI 设计师 Prompt！`);
        setTimeout(() => setCopiedPromptId(null), 2500);
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Intro Header */}
      <div className="rounded-xl border border-zinc-800/80 bg-gradient-to-r from-zinc-900/90 via-zinc-900/40 to-zinc-950 p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded px-2 py-0.5 text-[11px] font-mono font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
              AWARD ATLAS // 12 大世界级设计标杆
            </div>
            <h2 className="text-[20px] font-bold text-white mt-2 tracking-tight">
              设计 DNA 灵感图谱与 AI Prompt 导出
            </h2>
            <p className="text-[13px] text-zinc-400 mt-1 max-w-2xl leading-relaxed">
              汇聚 Linear、Stripe、Teenage Engineering、Geist、Raycast 等 12 款在数字与硬件设计领域树立行业标准的经典产品。
              拆解其核心哲学、几何原型与视觉机制，一键生成 AI 设计师 Prompt，随时沉淀个人设计手记。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-zinc-400">
              已收录 <strong className="text-white">{AWARD_CASES.length}</strong> 部标杆案例
            </span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
          {[
            { id: "all", label: "全部领域" },
            { id: "dev-tools", label: "开发者工具" },
            { id: "hardware", label: "实体硬件/合成器" },
            { id: "editorial", label: "古典排版/出版" },
            { id: "spatial", label: "空间计算" },
            { id: "audio", label: "工业音频" },
            { id: "canvas", label: "画布与创作" },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setFilterCategory(cat.id)}
              className={clsx(
                "rounded-lg px-3 py-1.5 font-medium transition-all cursor-pointer border",
                filterCategory === cat.id
                  ? "bg-amber-500 text-black border-amber-400 font-bold shadow-sm"
                  : "bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:text-white hover:border-zinc-700",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="relative max-w-xs w-full">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索案例名、理念、标签..."
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-1.5 text-[12.5px] text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Cases Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredCases.map((c) => {
          const userNote = notes[c.id];
          return (
            <div
              key={c.id}
              onClick={() => setSelectedCaseId(c.id)}
              className="group relative flex flex-col justify-between rounded-xl border border-zinc-800/90 bg-[#12141a]/80 p-4 transition-all duration-200 hover:border-amber-500/50 hover:bg-[#151821] hover:shadow-[0_10px_30px_rgba(0,0,0,0.5)] cursor-pointer select-none"
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-[16px] font-bold text-white group-hover:text-amber-400 transition-colors">
                        {c.name}
                      </h3>
                      <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10.5px] font-mono text-zinc-400 border border-zinc-700/60">
                        {c.year}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-zinc-400 mt-0.5 font-medium">
                      {c.creator}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="rounded bg-zinc-800/80 px-1.5 py-0.2 text-[10px] font-mono text-zinc-400 border border-zinc-700/60">
                        {c.awardCategory.split("/")[0]?.trim()}
                      </span>
                      <span className="rounded bg-zinc-800/40 px-1.5 py-0.2 text-[10px] font-mono text-zinc-400 border border-zinc-700/50">
                        行业设计标杆
                      </span>
                    </div>
                  </div>
                </div>

                {/* Subtitle tag */}
                <div className="mt-2 text-[12px] text-amber-400/90 font-mono line-clamp-1">
                  {c.tag}
                </div>

                {/* SVG Visual Archetype Sketch */}
                <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-950 aspect-[16/9] shadow-inner group-hover:border-zinc-700 transition-colors">
                  <CaseArchetypeSketch id={c.id} />
                </div>

                {/* Core Philosophy */}
                <p className="mt-3 text-[12.5px] text-zinc-300 leading-relaxed line-clamp-2">
                  {c.philosophy}
                </p>

                {/* DNA Badges */}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {c.designDNA.slice(0, 2).map((dna, idx) => (
                    <span
                      key={idx}
                      className="rounded bg-zinc-900 px-2 py-0.5 text-[10.5px] text-zinc-400 border border-zinc-800 truncate max-w-full"
                    >
                      {dna.split(":")[0]}
                    </span>
                  ))}
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyPrompt(c);
                  }}
                  className="rounded-lg bg-zinc-800/90 hover:bg-amber-500 hover:text-black px-2.5 py-1 text-[11.5px] font-medium text-zinc-300 transition-colors cursor-pointer border border-zinc-700/60"
                >
                  {copiedPromptId === c.id ? "✓ 已复制 Prompt" : "复制 AI Prompt"}
                </button>

                <div className="flex items-center gap-1.5 text-[11.5px] text-zinc-400">
                  {userNote ? (
                    <span className="text-amber-400 font-medium">✎ 有手记</span>
                  ) : (
                    <span>详情与解析 →</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Case Detail Modal */}
      {selectedCase && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
        >
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setSelectedCaseId(null)}
          />

          <div className="relative z-10 flex h-full max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-[#12141a] text-zinc-100 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-6 py-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[18px] font-bold text-white">
                    {selectedCase.name}
                  </h3>
                  <span className="rounded bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] font-mono text-amber-400">
                    {selectedCase.year}
                  </span>
                  <span className="rounded bg-zinc-800 border border-zinc-700/60 px-2 py-0.5 text-[10.5px] font-mono text-zinc-300">
                    {selectedCase.awardLevel}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-zinc-400 mt-1 flex-wrap">
                  <span>{selectedCase.creator}</span>
                  <span>·</span>
                  <span>{selectedCase.tag}</span>
                  <span>·</span>
                  <a
                    href={selectedCase.originalSiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-400 hover:underline flex items-center gap-0.5 font-medium"
                  >
                    <span>访问产品官网</span>
                    <span>↗</span>
                  </a>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyPrompt(selectedCase)}
                  className="rounded-lg bg-amber-500 text-black font-bold px-3 py-1.5 text-[12px] hover:bg-amber-400 transition-colors cursor-pointer shadow-sm"
                >
                  {copiedPromptId === selectedCase.id ? "✓ 已复制 Prompt" : "⌗ 复制 AI 设计师 Prompt"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCaseId(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Sketch stage */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 aspect-[16/9] max-h-[260px] mx-auto flex items-center justify-center">
                <CaseArchetypeSketch id={selectedCase.id} />
              </div>

              {/* Philosophy */}
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4">
                <h4 className="text-[12px] font-mono uppercase tracking-wider text-amber-400 font-bold mb-1.5">
                  核心设计信条 // PHILOSOPHY
                </h4>
                <p className="text-[13.5px] text-zinc-200 leading-relaxed">
                  {selectedCase.philosophy}
                </p>
              </div>

              {/* Design DNA */}
              <div>
                <h4 className="text-[13px] font-bold text-white mb-2">
                  设计 DNA 架构分解
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {selectedCase.designDNA.map((dna, idx) => {
                    const [title, desc] = dna.split(":");
                    return (
                      <div
                        key={idx}
                        className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-[12.5px]"
                      >
                        <strong className="text-white block font-mono text-[12px] mb-1">
                          {title}
                        </strong>
                        <span className="text-zinc-400 leading-relaxed">
                          {desc}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Visual Mechanics */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
                <h4 className="text-[13px] font-bold text-white">
                  关键视觉机制与规范参数 (Visual Mechanics)
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px]">
                  <div>
                    <span className="text-zinc-500 block text-[11px]">经典调色板</span>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {selectedCase.visualMechanics.palette.map((hex, i) => (
                        <span
                          key={i}
                          className="h-5 w-5 rounded border border-white/20 shadow-sm"
                          style={{ backgroundColor: hex }}
                          title={hex}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[11px]">几何圆角</span>
                    <span className="text-zinc-300 font-mono mt-1 block">
                      {selectedCase.visualMechanics.radius}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[11px]">动效阻尼</span>
                    <span className="text-zinc-300 font-mono mt-1 block truncate">
                      {selectedCase.visualMechanics.motion}
                    </span>
                  </div>
                  <div className="col-span-2 sm:col-span-3 pt-2 border-t border-zinc-800/80">
                    <span className="text-zinc-500 block text-[11px]">标志性视觉钩子</span>
                    <span className="text-zinc-300 mt-1 block leading-relaxed">
                      {selectedCase.visualMechanics.uniqueHook}
                    </span>
                  </div>
                </div>
              </div>

              {/* Design Notes (Local Persistence) */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[13px] font-bold text-white flex items-center gap-2">
                    <span>我的设计手记与灵感提炼</span>
                    <span className="text-[10.5px] font-normal text-zinc-400">(自动保存于本地)</span>
                  </h4>
                  {notes[selectedCase.id] && (
                    <span className="text-[11px] text-emerald-400 font-mono">✓ 已持久化</span>
                  )}
                </div>
                <textarea
                  value={notes[selectedCase.id] ?? ""}
                  onChange={(e) => handleUpdateNote(selectedCase.id, e.target.value)}
                  placeholder={`写下关于「${selectedCase.name}」的美学启示、适合应用在你哪个项目、或有哪些值得借鉴的交互细节...`}
                  rows={3}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-[12.5px] text-zinc-200 placeholder-zinc-500 focus:border-amber-500 focus:outline-none transition-colors"
                />
              </div>

              {/* AI Agent Prompt Box */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="text-[12.5px] font-mono text-zinc-400">
                    导出的 AI 设计师 Prompt:
                  </h4>
                  <button
                    type="button"
                    onClick={() => handleCopyPrompt(selectedCase)}
                    className="text-[11px] text-amber-400 hover:underline cursor-pointer"
                  >
                    复制完整文本 ↗
                  </button>
                </div>
                <pre className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-400 whitespace-pre-wrap leading-relaxed max-h-[140px] overflow-y-auto">
                  {selectedCase.agentPrompt}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
