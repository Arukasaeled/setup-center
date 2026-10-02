import type { SetupStyle, StyleId } from "./types";
import { defaultStyle } from "./default/manifest";
import { phantomComicStyle } from "./phantom-comic/manifest";

/** Future planned style slots */
const appleMinimalStyle: SetupStyle = {
  id: "apple-minimal",
  name: "Cupertino 极简",
  version: "0.1.0",
  subtitle: "Apple Human Interface",
  description:
    "轻盈的毛玻璃雾面质感、大圆角连续曲率与精致图标阴影，极致纯粹的留白艺术。",
  inspiration: "macOS Sonoma / iOS 空间系统极简主义",
  author: "Community Draft",
  tags: ["毛玻璃", "超大圆角", "呼吸感留白"],
  palette: {
    baseBg: "#121214",
    surface: "rgba(35, 35, 40, 0.65)",
    cardBorder: "rgba(255, 255, 255, 0.12)",
    accent: "#0071e3",
    text: "#f5f5f7",
  },
  features: ["连续平滑圆角", "多层混合模糊", "自适应轻盈微动效"],
  implemented: false,
};

const terminalCrtStyle: SetupStyle = {
  id: "terminal-crt",
  name: "赛博终端 CRT",
  version: "0.1.0",
  subtitle: "Cyber Terminal",
  description:
    "复古黑客显像管荧光绿/琥珀色字符、点阵扫描线与单色硬核纯字符排版。",
  inspiration: "经典 VT100 / Fallout 终端机 / 早期 UNIX 工作站",
  author: "Community Draft",
  tags: ["等宽字符", "扫描线微光", "单色硬核"],
  palette: {
    baseBg: "#030804",
    surface: "#08140a",
    cardBorder: "#22c55e",
    accent: "#4ade80",
    text: "#86efac",
  },
  features: ["纯等宽点阵排版", "显像管发光扫描线", "ASCII 边框装饰"],
  implemented: false,
};

const editorialStyle: SetupStyle = {
  id: "editorial",
  name: "瑞士画册排版",
  version: "0.1.0",
  subtitle: "Swiss Editorial",
  description:
    "平面设计史诗级排版，大字阶对比、严苛的网格对齐与大胆的非对称版面留白。",
  inspiration: "国际主义平面设计风格（瑞士学派）与现代艺术画册",
  author: "Community Draft",
  tags: ["大字阶", "严苛网格", "非对称排版"],
  palette: {
    baseBg: "#f8f9fa",
    surface: "#ffffff",
    cardBorder: "#111827",
    accent: "#ff3b30",
    text: "#111827",
  },
  features: ["鲜明黑白正负形", "强结构对齐栅格", "标题超大视差比"],
  implemented: false,
};

/** The active runtime style registry list */
export const STYLE_REGISTRY: SetupStyle[] = [
  phantomComicStyle,
  defaultStyle,
  appleMinimalStyle,
  terminalCrtStyle,
  editorialStyle,
];

/** Retrieve a style by its registered identifier */
export function getStyle(id: StyleId): SetupStyle | undefined {
  if (id === "p5-comic") return phantomComicStyle;
  return STYLE_REGISTRY.find((s) => s.id === id);
}

/** Register or override a style dynamically in the registry */
export function registerStyle(style: SetupStyle): void {
  const existingIdx = STYLE_REGISTRY.findIndex((s) => s.id === style.id);
  if (existingIdx >= 0) {
    STYLE_REGISTRY[existingIdx] = style;
  } else {
    STYLE_REGISTRY.push(style);
  }
}

/** Get active style definition with fallback */
export function getActiveStyleDefinition(id: StyleId): SetupStyle {
  return getStyle(id) ?? phantomComicStyle;
}

const STORAGE_KEY = "setup-center.style";

/** Load user preference from storage, safely defaulting to phantom-comic */
export function loadSavedStyle(): StyleId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as StyleId | null;
    if (saved) {
      if (saved === "p5-comic" || saved === "phantom-comic") return "phantom-comic";
      if (STYLE_REGISTRY.some((s) => s.id === saved && s.implemented)) {
        return saved;
      }
    }
  } catch {
    // fallback if local storage is restricted
  }
  return "phantom-comic";
}

/** Persist user choice */
export function saveStylePreference(id: StyleId): void {
  try {
    const normalizedId = id === "p5-comic" ? "phantom-comic" : id;
    localStorage.setItem(STORAGE_KEY, normalizedId);
  } catch {
    // ignore
  }
}
