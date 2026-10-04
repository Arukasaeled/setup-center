/**
 * Datasets for Clip Launch Grid Prototype
 *
 * Demonstrates domain portability across:
 * 1. AI Multi-Agent Task Orchestrator
 * 2. Visual Preset Dimension Mixer
 * 3. Presentation Scene Director
 */

export interface TrackDefinition {
  id: string;
  name: string;
  badge?: string;
}

export interface SceneDefinition {
  id: string;
  name: string;
  order: number;
}

export interface SlotDefinition {
  trackId: string;
  sceneId: string;
  label: string;
  hasStop?: boolean; // Default true. If false, row triggers will not halt this track
  accentColor?: string;
  description?: string;
}

export interface GridDataset {
  id: string;
  title: string;
  subtitle: string;
  tracks: TrackDefinition[];
  scenes: SceneDefinition[];
  slots: Record<string, SlotDefinition>;
}

// Helper to key slots
export function getSlotKey(trackId: string, sceneId: string): string {
  return `${trackId}::${sceneId}`;
}

// Dataset A: Agent Task Launcher
export const AGENT_TASK_DATASET: GridDataset = {
  id: "agent-task-launcher",
  title: "AI Agent Task Orchestrator",
  subtitle: "列 = 独立专业 Agent（同列任务互斥） │ 行 = 研发流水线同步阶段（整行触发批量就位）",
  tracks: [
    { id: "planner", name: "Architect", badge: "Planner" },
    { id: "coder", name: "Coder", badge: "Dev" },
    { id: "reviewer", name: "Reviewer", badge: "QA" },
    { id: "devops", name: "DevOps", badge: "Infra" },
  ],
  scenes: [
    { id: "stage-1", name: "01. Architecture & Scaffold", order: 1 },
    { id: "stage-2", name: "02. Core Implementation", order: 2 },
    { id: "stage-3", name: "03. Quality Verification", order: 3 },
    { id: "stage-4", name: "04. Release & Delivery", order: 4 },
  ],
  slots: {
    [getSlotKey("planner", "stage-1")]: {
      trackId: "planner",
      sceneId: "stage-1",
      label: "Schema Design",
      hasStop: true,
      description: "生成 OpenAPI 与领域数据类型契约",
    },
    [getSlotKey("coder", "stage-1")]: {
      trackId: "coder",
      sceneId: "stage-1",
      label: "Init Template",
      hasStop: true,
      description: "拉取脚手架并配置基础依赖",
    },
    [getSlotKey("reviewer", "stage-1")]: {
      trackId: "reviewer",
      sceneId: "stage-1",
      label: "Lint Rules",
      hasStop: true,
      description: "建立严格代码规范与 Git Hook",
    },
    // devops in stage 1 has no slot, but hasStop=false preserves background infra if running!

    [getSlotKey("planner", "stage-2")]: {
      trackId: "planner",
      sceneId: "stage-2",
      label: "API Boundary",
      hasStop: true,
      description: "实时答疑与边界审查",
    },
    [getSlotKey("coder", "stage-2")]: {
      trackId: "coder",
      sceneId: "stage-2",
      label: "Business Logic",
      hasStop: true,
      description: "实现核心业务领域与状态机",
    },
    [getSlotKey("reviewer", "stage-2")]: {
      trackId: "reviewer",
      sceneId: "stage-2",
      label: "Unit Test Gen",
      hasStop: true,
      description: "并行编写覆盖率测试用例",
    },
    [getSlotKey("devops", "stage-2")]: {
      trackId: "devops",
      sceneId: "stage-2",
      label: "Docker Env",
      hasStop: false, // hasStop=false: scene launch won't stop this long-running container
      description: "维持后台持续测试容器环境",
    },

    [getSlotKey("coder", "stage-3")]: {
      trackId: "coder",
      sceneId: "stage-3",
      label: "Refactor Patch",
      hasStop: true,
      description: "按 Code Review 建议重构热点",
    },
    [getSlotKey("reviewer", "stage-3")]: {
      trackId: "reviewer",
      sceneId: "stage-3",
      label: "E2E Integration",
      hasStop: true,
      description: "执行自动化端到端测试套件",
    },
    [getSlotKey("devops", "stage-3")]: {
      trackId: "devops",
      sceneId: "stage-3",
      label: "CI Pipeline Run",
      hasStop: true,
      description: "运行全矩阵构建并生成报告",
    },

    [getSlotKey("planner", "stage-4")]: {
      trackId: "planner",
      sceneId: "stage-4",
      label: "Changelog Gen",
      hasStop: true,
      description: "归纳版本发布日志与升级指南",
    },
    [getSlotKey("devops", "stage-4")]: {
      trackId: "devops",
      sceneId: "stage-4",
      label: "Prod Deployment",
      hasStop: true,
      description: "打包发布可执行二进制并签名",
    },
  },
};

// Dataset B: Visual Preset Launcher
export const VISUAL_PRESET_DATASET: GridDataset = {
  id: "visual-preset-launcher",
  title: "Visual System Dimension Mixer",
  subtitle: "列 = 视觉设计维度（单维度单选互斥） │ 行 = 场景预设（整行触发形成完整风格姿态）",
  tracks: [
    { id: "typography", name: "Typography", badge: "Font" },
    { id: "color", name: "Color Palette", badge: "Tokens" },
    { id: "motion", name: "Motion & Physics", badge: "Dynamics" },
    { id: "shape", name: "Geometry & Border", badge: "Surface" },
  ],
  scenes: [
    { id: "minimal", name: "01. Swiss Monospace", order: 1 },
    { id: "cyber", name: "02. Cyber Terminal", order: 2 },
    { id: "editorial", name: "03. Warm Editorial", order: 3 },
    { id: "game-hud", name: "04. Tactical HUD", order: 4 },
  ],
  slots: {
    [getSlotKey("typography", "minimal")]: {
      trackId: "typography",
      sceneId: "minimal",
      label: "Geist Mono",
      hasStop: true,
      description: "纯正瑞士等宽工程字阶",
    },
    [getSlotKey("color", "minimal")]: {
      trackId: "color",
      sceneId: "minimal",
      label: "Onyx & Charcoal",
      hasStop: true,
      description: "极度低饱和中性黑白灰",
    },
    [getSlotKey("motion", "minimal")]: {
      trackId: "motion",
      sceneId: "minimal",
      label: "Instant Cut (0ms)",
      hasStop: true,
      description: "零延迟严谨响应",
    },
    [getSlotKey("shape", "minimal")]: {
      trackId: "shape",
      sceneId: "minimal",
      label: "0px Sharp Rect",
      hasStop: true,
      description: "绝对直角与 1px 细线框",
    },

    [getSlotKey("typography", "cyber")]: {
      trackId: "typography",
      sceneId: "cyber",
      label: "Orbitron Display",
      hasStop: true,
      description: "几何科幻未来感标题",
    },
    [getSlotKey("color", "cyber")]: {
      trackId: "color",
      sceneId: "cyber",
      label: "Neon Cyan / Pink",
      hasStop: true,
      description: "高对比荧光赛博发光色板",
    },
    [getSlotKey("motion", "cyber")]: {
      trackId: "motion",
      sceneId: "cyber",
      label: "Glitch Scanline",
      hasStop: true,
      description: "微抖动频闪与电子扫描线",
    },
    [getSlotKey("shape", "cyber")]: {
      trackId: "shape",
      sceneId: "cyber",
      label: "Angled Chamfer",
      hasStop: true,
      description: "45度倒角切角硬边",
    },

    [getSlotKey("typography", "editorial")]: {
      trackId: "typography",
      sceneId: "editorial",
      label: "Newsreader Serif",
      hasStop: true,
      description: "纸本印刷衬线古典美学",
    },
    [getSlotKey("color", "editorial")]: {
      trackId: "color",
      sceneId: "editorial",
      label: "Warm Cream / Ink",
      hasStop: true,
      description: "米纸底色与暖墨深灰",
    },
    [getSlotKey("motion", "editorial")]: {
      trackId: "motion",
      sceneId: "editorial",
      label: "Gentle Fade (300ms)",
      hasStop: true,
      description: "平滑缓动渐变过渡",
    },
    [getSlotKey("shape", "editorial")]: {
      trackId: "shape",
      sceneId: "editorial",
      label: "Soft 6px Radius",
      hasStop: true,
      description: "书籍装订触感微圆角",
    },

    [getSlotKey("typography", "game-hud")]: {
      trackId: "typography",
      sceneId: "game-hud",
      label: "Condensed Gothic",
      hasStop: true,
      description: "战术全大写窄黑体",
    },
    [getSlotKey("color", "game-hud")]: {
      trackId: "color",
      sceneId: "game-hud",
      label: "Amber CRT Glow",
      hasStop: true,
      description: "军规琥珀黄高反差监视器",
    },
    [getSlotKey("motion", "game-hud")]: {
      trackId: "motion",
      sceneId: "game-hud",
      label: "Spring Pop",
      hasStop: true,
      description: "战术卡扣回弹阻尼感",
    },
    [getSlotKey("shape", "game-hud")]: {
      trackId: "shape",
      sceneId: "game-hud",
      label: "Bracket Border",
      hasStop: true,
      description: "四角括号战术瞄准框",
    },
  },
};

// Dataset C: Presentation Scene Launcher
export const PRESENTATION_DATASET: GridDataset = {
  id: "presentation-launcher",
  title: "Presentation Scene Director",
  subtitle: "列 = 舞台图层（同图层内容互斥） │ 行 = 演说幕次（整行触发转场）",
  tracks: [
    { id: "backdrop", name: "Backdrop Layer", badge: "Layer 0" },
    { id: "canvas", name: "Content Canvas", badge: "Layer 1" },
    { id: "camera", name: "Presenter Cam", badge: "Layer 2" },
    { id: "overlay", name: "Live Sandbox", badge: "Layer 3" },
  ],
  scenes: [
    { id: "act-1", name: "Scene A: Opening & Hook", order: 1 },
    { id: "act-2", name: "Scene B: Technical Deep Dive", order: 2 },
    { id: "act-3", name: "Scene C: Live Benchmark Run", order: 3 },
    { id: "act-4", name: "Scene D: Summary & Closing", order: 4 },
  ],
  slots: {
    [getSlotKey("backdrop", "act-1")]: {
      trackId: "backdrop",
      sceneId: "act-1",
      label: "Ambient Dark Gradient",
      hasStop: true,
      description: "静止低调暗夜背景",
    },
    [getSlotKey("canvas", "act-1")]: {
      trackId: "canvas",
      sceneId: "act-1",
      label: "Vision Statement Slide",
      hasStop: true,
      description: "产品愿景主标题",
    },
    [getSlotKey("camera", "act-1")]: {
      trackId: "camera",
      sceneId: "act-1",
      label: "PiP Speaker Circle",
      hasStop: true,
      description: "右下角演讲者圆形画中画",
    },

    [getSlotKey("backdrop", "act-2")]: {
      trackId: "backdrop",
      sceneId: "act-2",
      label: "Blueprint Matrix Grid",
      hasStop: false, // Keep blueprint grid through act 3
      description: "工程蓝图网格底板",
    },
    [getSlotKey("canvas", "act-2")]: {
      trackId: "canvas",
      sceneId: "act-2",
      label: "System Architecture Flow",
      hasStop: true,
      description: "核心系统拓扑架构图",
    },
    [getSlotKey("overlay", "act-2")]: {
      trackId: "overlay",
      sceneId: "act-2",
      label: "Code Specimen Callout",
      hasStop: true,
      description: "关键代码块高亮放大镜",
    },

    [getSlotKey("canvas", "act-3")]: {
      trackId: "canvas",
      sceneId: "act-3",
      label: "Benchmark Dashboard",
      hasStop: true,
      description: "即时性能比对图表",
    },
    [getSlotKey("camera", "act-3")]: {
      trackId: "camera",
      sceneId: "act-3",
      label: "Full Stage Speaker",
      hasStop: true,
      description: "切换演讲者为主视角",
    },
    [getSlotKey("overlay", "act-3")]: {
      trackId: "overlay",
      sceneId: "act-3",
      label: "Live Terminal Stream",
      hasStop: true,
      description: "真实终端命令输出监控",
    },

    [getSlotKey("backdrop", "act-4")]: {
      trackId: "backdrop",
      sceneId: "act-4",
      label: "Sunset Monochrome",
      hasStop: true,
      description: "终章暖色调背景",
    },
    [getSlotKey("canvas", "act-4")]: {
      trackId: "canvas",
      sceneId: "act-4",
      label: "Next Milestones & Links",
      hasStop: true,
      description: "总结展望与社区链接",
    },
  },
};
