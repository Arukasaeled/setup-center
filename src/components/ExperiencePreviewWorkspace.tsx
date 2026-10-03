import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import type { SetupStyle } from "../styles/types";
import {
  resolveExperienceProfile,
  TIER_LABEL,
  TIER_SHORT,
  SHELL_LABEL,
  NAV_LABEL,
  DETAIL_LABEL,
  CARD_LABEL,
  COMPOSITION_LABEL,
  DENSITY_LABEL,
  MOTION_LABEL,
  resolveTokens,
  computeRuntimeVars,
  composeShadow,
  isRenderable,
} from "../styles/runtime";
import { resolveSetupAction } from "../core/setup/resolver";
import { executeSetupAction } from "../core/setup/executor";
import { SetupActionButton } from "./SetupActionButton";
import { ExperienceSpecimen } from "./ExperienceSpecimen";
import { useApp } from "../lib/store";

export interface ExperiencePreviewWorkspaceProps {
  isOpen: boolean;
  style: SetupStyle;
  active: boolean;
  starred: boolean;
  onToggleStar: () => void;
  onClose: () => void;
  onNotice: (msg: string) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

type WorkspaceTab = "preview" | "grammar" | "tokens" | "principles";
type PreviewMode = "specimen" | "software" | "resources";
type PreviewZoom = "fit" | "75" | "100";

const GRAMMAR_DOCS: Record<string, { label: string; desc: string }> = {
  tier: {
    label: "体验等级",
    desc: "声明该视觉语言的介入深度：T1色彩微调、T2基础几何覆盖、T3完整版面布局重组、T4全浸入拟物与风格化重塑。",
  },
  shell: {
    label: "外壳语法",
    desc: "定义应用的主框架形态：常规边栏、水平顶栏、全屏居中指令台、画板构图、多窗口模式或双栏布局。",
  },
  navigation: {
    label: "导航语法",
    desc: "定义导航条目交互形式：独立侧栏菜单、标签条、悬浮底座 Dock、经典下拉菜单栏或极简快捷指令条。",
  },
  detail: {
    label: "详情呈现",
    desc: "决定软件与资源的深层详情展开方式：右侧固定抽屉 (rail)、居中拟物浮窗 (window)、滑出抽屉 (sheet)、内嵌展开或整页接管。",
  },
  card: {
    label: "卡片语言",
    desc: "决定信息卡片的质感与轮廓：柔和边框、紧凑网格、实体凸起浮雕、拟物边框、无边框群组或倾斜贴纸。",
  },
  composition: {
    label: "版面构成",
    desc: "决定主要内容流的网格节奏：严谨等宽网格、杂志跨栏排版、新闻多栏、海报画墙或垂直阶梯瀑布流。",
  },
  density: {
    label: "信息密度",
    desc: "控制字距、行高、控件内边距与间隙：紧凑专业、舒适标准或宽阔展示。",
  },
  motion: {
    label: "动效节奏",
    desc: "统领全应用的过渡曲线与动画时长：沉静低调、自然流畅或夸张表现力。",
  },
};

/**
 * ExperiencePreviewWorkspace — Dedicated neutral overlay workspace for inspecting
 * full-scale visual experiences without inheriting destructive active-style styles.
 *
 * Implements:
 * - Direct portal to document.body (escapes all ancestor containing blocks & overflow)
 * - Viewport scroll lock and exact scroll position restoration upon dismissal
 * - Neutral tool chrome: dark, quiet, distraction-free
 * - Fixed Sticky Header & Sticky Footer Action Bar
 * - Hero Preview Stage with zoom controls (Fit, 75%, 100%) and mode switching
 * - 4 Structured Tabs (Preview, Grammar, Tokens, Principles) replacing vertical pileup
 * - Keyboard navigation (Esc to close, ArrowLeft/ArrowRight to switch)
 * - Focus preservation and management
 */
export function ExperiencePreviewWorkspace({
  isOpen,
  style,
  active,
  starred,
  onToggleStar,
  onClose,
  onNotice,
  triggerRef,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
}: ExperiencePreviewWorkspaceProps) {
  const inventory = useApp((s) => s.inventory);
  const [tab, setTab] = useState<WorkspaceTab>("preview");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("specimen");
  const [zoom, setZoom] = useState<PreviewZoom>("100");
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  const initialScrollTopRef = useRef<number>(0);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const profile = useMemo(() => resolveExperienceProfile(style), [style]);
  const tokens = useMemo(() => resolveTokens(style), [style]);
  const vars = useMemo(() => computeRuntimeVars(tokens, profile), [tokens, profile]);
  const live = isRenderable(style);

  const resolved = useMemo(
    () => resolveSetupAction({ type: "style", data: style }, inventory),
    [style, inventory],
  );

  // Preserve & restore background scroll and focus
  useEffect(() => {
    if (!isOpen) return;

    // Record focused element
    previousFocusRef.current = triggerRef?.current ?? (document.activeElement as HTMLElement | null);

    // Record background scroll position
    const pageContainer = document.querySelector<HTMLElement>("section[data-page]");
    if (pageContainer) {
      initialScrollTopRef.current = pageContainer.scrollTop;
    }

    // Keydown listener
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" && onPrev && hasPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" && onNext && hasNext) {
        e.preventDefault();
        onNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);

      // Restore scroll position
      const savedTop = initialScrollTopRef.current;
      if (pageContainer && typeof savedTop === "number") {
        pageContainer.scrollTop = savedTop;
      }

      // Restore focus without jumping scroll
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === "function") {
        prev.focus({ preventScroll: true });
        if (pageContainer && pageContainer.scrollTop !== savedTop) {
          pageContainer.scrollTop = savedTop;
        }
      }
    };
  }, [isOpen, onClose, onPrev, onNext, hasPrev, hasNext, triggerRef]);

  // Copy hex color helper
  const handleCopyHex = (label: string, hex: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(hex).then(() => {
        setCopiedHex(hex);
        onNotice(`已复制 ${label}: ${hex}`);
        setTimeout(() => setCopiedHex((curr) => (curr === hex ? null : curr)), 2000);
      });
    }
  };

  // Tune action shortcut
  const handleTune = () => {
    void executeSetupAction({
      id: `style-tune-${style.id}`,
      type: "customize",
      label: "调校此体验",
      payload: style.id,
    });
    onClose();
  };

  if (!isOpen) return null;

  const grammarItems: Array<{ key: string; name: string; val: string; raw: string }> = [
    { key: "tier", name: "体验等级", val: TIER_LABEL[profile.tier], raw: TIER_SHORT[profile.tier] },
    { key: "shell", name: "外壳语法", val: SHELL_LABEL[profile.shell ?? "sidebar"], raw: profile.shell ?? "sidebar" },
    { key: "navigation", name: "导航语法", val: NAV_LABEL[profile.navigation ?? "sidebar"], raw: profile.navigation ?? "sidebar" },
    { key: "detail", name: "详情呈现", val: DETAIL_LABEL[profile.detail ?? "rail"], raw: profile.detail ?? "rail" },
    { key: "card", name: "卡片语言", val: CARD_LABEL[profile.card ?? "panel"], raw: profile.card ?? "panel" },
    { key: "composition", name: "版面构成", val: COMPOSITION_LABEL[profile.composition ?? "solid-grid"], raw: profile.composition ?? "solid-grid" },
    { key: "density", name: "信息密度", val: DENSITY_LABEL[profile.density ?? "normal"], raw: profile.density ?? "normal" },
    { key: "motion", name: "动效节奏", val: MOTION_LABEL[profile.motion ?? "normal"], raw: profile.motion ?? "normal" },
  ];

  const swatches: Array<[string, string]> = [
    ["基底背景 (baseBg)", style.palette.baseBg],
    ["面板表面 (surface)", style.palette.surface],
    ["主要强调 (accent)", style.palette.accent],
    ...(style.palette.accentSecondary
      ? ([["次级强调 (secondary)", style.palette.accentSecondary]] as Array<[string, string]>)
      : []),
    ["主要正文 (text)", style.palette.text],
    ["边界描边 (cardBorder)", style.palette.cardBorder],
  ];

  // Font size computed from zoom
  const specimenFontSize =
    zoom === "100" ? "20px" : zoom === "75" ? "15px" : "clamp(14px, 1.45vw, 18px)";

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`体验完整预览工作区 — ${style.name}`}
      data-experience-workspace="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 lg:p-6"
    >
      {/* Backdrop — neutral dark wash covering Dashboard & nav completely */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Neutral Workspace Container */}
      <div
        ref={workspaceRef}
        className="relative z-10 flex h-full w-full max-h-[96vh] max-w-[1440px] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-[#111419] text-zinc-100 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.08)]"
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        {/* ==================================================================
            1. FIXED / STICKY HEADER
            ================================================================== */}
        <header className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-800/90 bg-[#14181f]/95 px-5 py-3.5 backdrop-blur-md">
          {/* Left: Style Identity */}
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-bold tracking-tight text-white truncate">
                {style.name}
              </h2>
              <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[11px] font-bold text-zinc-300 border border-zinc-700">
                {TIER_SHORT[profile.tier]} · {TIER_LABEL[profile.tier]}
              </span>
              {active ? (
                <span className="rounded bg-blue-600/30 px-2 py-0.5 text-[11px] font-semibold text-blue-400 border border-blue-500/40">
                  全局已启用
                </span>
              ) : live ? (
                <span className="rounded bg-emerald-600/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/30">
                  可立即使用
                </span>
              ) : (
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                  需要更新应用
                </span>
              )}
            </div>

            <div className="hidden sm:block text-[12px] font-mono text-zinc-400 truncate max-w-xs xl:max-w-md">
              {style.subtitle} · v{style.version} · 由 {style.author} 维护
            </div>
          </div>

          {/* Middle: Tab Switcher in Header */}
          <nav
            aria-label="工作区视图切换"
            className="flex items-center rounded-lg bg-zinc-900/90 p-1 border border-zinc-800"
          >
            {[
              { id: "preview", label: "体验样张", icon: "👁" },
              { id: "grammar", label: "体验语法", icon: "📐" },
              { id: "tokens", label: "色彩与令牌", icon: "🎨" },
              { id: "principles", label: "规范与原则", icon: "📖" },
            ].map((t) => {
              const selected = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id as WorkspaceTab)}
                  className={clsx(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all cursor-pointer",
                    selected
                      ? "bg-zinc-700 text-white shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60",
                  )}
                >
                  <span className="text-[12px] opacity-80">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right: Pagination & Close Button */}
          <div className="flex items-center gap-1.5">
            {onPrev && (
              <button
                type="button"
                onClick={onPrev}
                disabled={!hasPrev}
                title="上一套体验 (←)"
                aria-label="上一套体验"
                className={clsx(
                  "flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/80 text-zinc-300 transition-colors",
                  hasPrev
                    ? "hover:bg-zinc-700 hover:text-white cursor-pointer"
                    : "opacity-30 cursor-not-allowed",
                )}
              >
                ‹
              </button>
            )}
            {onNext && (
              <button
                type="button"
                onClick={onNext}
                disabled={!hasNext}
                title="下一套体验 (→)"
                aria-label="下一套体验"
                className={clsx(
                  "flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/80 text-zinc-300 transition-colors",
                  hasNext
                    ? "hover:bg-zinc-700 hover:text-white cursor-pointer"
                    : "opacity-30 cursor-not-allowed",
                )}
              >
                ›
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="退出工作区 (Esc)"
              aria-label="关闭完整预览工作区"
              className="flex h-8 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2.5 text-[12px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer ml-1"
            >
              <span>✕</span>
              <kbd className="hidden sm:inline font-mono text-[10px] text-zinc-400">Esc</kbd>
            </button>
          </div>
        </header>

        {/* ==================================================================
            2. SCROLLABLE BODY (Only one scrollable container)
            ================================================================== */}
        <div className="flex-1 overflow-y-auto overscroll-contain bg-[#0c0e12] p-4 sm:p-6 space-y-6">
          {/* TAB 1: 体验样张 (PREVIEW HERO STAGE) */}
          {tab === "preview" && (
            <div className="space-y-4">
              {/* Stage Top Bar: Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-zinc-300">
                    舞台模式：
                  </span>
                  <div className="flex rounded-md bg-zinc-950 p-0.5 border border-zinc-800">
                    {[
                      { id: "specimen", label: "体验样张 (综合模拟)" },
                      { id: "software", label: "实际页面 · 软件列表" },
                      { id: "resources", label: "实际页面 · 开发资源" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPreviewMode(m.id as PreviewMode)}
                        className={clsx(
                          "rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors cursor-pointer",
                          previewMode === m.id
                            ? "bg-zinc-800 text-white"
                            : "text-zinc-400 hover:text-zinc-200",
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-zinc-300">
                    尺寸比例：
                  </span>
                  <div className="flex rounded-md bg-zinc-950 p-0.5 border border-zinc-800">
                    {[
                      { id: "fit", label: "自适应 (Fit)" },
                      { id: "75", label: "75%" },
                      { id: "100", label: "100% 原始尺寸" },
                    ].map((z) => (
                      <button
                        key={z.id}
                        type="button"
                        onClick={() => setZoom(z.id as PreviewZoom)}
                        className={clsx(
                          "rounded px-2.5 py-1 text-[11.5px] font-mono transition-colors cursor-pointer",
                          zoom === z.id
                            ? "bg-zinc-800 text-white"
                            : "text-zinc-400 hover:text-zinc-200",
                        )}
                      >
                        {z.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Stage Frame (Artboard Window Canvas) */}
              <div
                data-specimen-stage="true"
                data-style={style.id}
                className="overflow-hidden rounded-xl border border-zinc-800 bg-[#090b0e] shadow-2xl transition-all"
                style={{
                  boxShadow:
                    "0 20px 50px -10px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.05)",
                }}
              >
                {/* Mock Window Title Bar */}
                <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/90 px-4 py-2.5 text-zinc-400 select-none">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-zinc-700/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-zinc-700/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-zinc-700/80" />
                    <span className="ml-2 font-mono text-[11.5px] text-zinc-400">
                      Setup Center — {style.name} (仿真运行视口)
                    </span>
                  </div>
                  <div className="font-mono text-[10.5px] text-zinc-400">
                    外壳: {profile.shell ?? "sidebar"} · 导航: {profile.navigation ?? "sidebar"}
                  </div>
                </div>

                {/* Stage Viewport */}
                <div
                  className="min-h-[460px] overflow-auto p-4 sm:p-6"
                  style={{
                    fontSize: specimenFontSize,
                    // Pass target style variables directly to the stage scope
                    ...(vars as unknown as React.CSSProperties),
                  }}
                >
                  {previewMode === "specimen" && (
                    <ExperienceSpecimen style={style} scale="full" className="rounded-lg shadow-lg" />
                  )}

                  {previewMode === "software" && (
                    <SoftwarePageMock style={style} vars={vars} profile={profile} />
                  )}

                  {previewMode === "resources" && (
                    <ResourcePageMock style={style} vars={vars} profile={profile} />
                  )}
                </div>
              </div>

              {/* Under-Stage Quick Summary */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-zinc-300 leading-relaxed">
                    {style.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {style.tags.map((t: string) => (
                      <span
                        key={t}
                        className="rounded bg-zinc-800/80 px-2 py-0.5 font-mono text-[10.5px] text-zinc-400 border border-zinc-700/60"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-right">
                  <span className="rounded bg-zinc-800 px-2.5 py-1 text-[11px] font-mono text-zinc-300">
                    {CARD_LABEL[profile.card ?? "panel"]}
                  </span>
                  <span className="rounded bg-zinc-800 px-2.5 py-1 text-[11px] font-mono text-zinc-300">
                    {COMPOSITION_LABEL[profile.composition ?? "solid-grid"]}
                  </span>
                  <span className="rounded bg-zinc-800 px-2.5 py-1 text-[11px] font-mono text-zinc-300">
                    {MOTION_LABEL[profile.motion ?? "normal"]}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 体验语法 (GRAMMAR INSPECTOR) */}
          {tab === "grammar" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                <h3 className="text-[14px] font-bold text-white mb-1">
                  体验系统八维语法架构 (Experience Grammar)
                </h3>
                <p className="text-[12px] text-zinc-400 leading-relaxed">
                  Setup Center 采用严格的版式语法契约驱动界面渲染。视觉体验不仅改变色值，还定义组件几何轮廓、版面构图与动画节奏。
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {grammarItems.map((item) => {
                  const doc = GRAMMAR_DOCS[item.key];
                  return (
                    <div
                      key={item.key}
                      className="rounded-lg border border-zinc-800/90 bg-zinc-900/40 p-4 hover:border-zinc-700 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                            {doc?.label ?? item.name} ({item.key})
                          </div>
                          <div className="text-[14.5px] font-bold text-white mt-1">
                            {item.val}
                          </div>
                        </div>
                        <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-400 border border-zinc-700/60">
                          {item.raw}
                        </span>
                      </div>
                      <p className="mt-2.5 text-[12px] text-zinc-400 leading-relaxed border-t border-zinc-800/60 pt-2.5">
                        {doc?.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: 色彩与令牌 (TOKENS & PALETTE) */}
          {tab === "tokens" && (
            <div className="space-y-6">
              {/* Color Palette Swatches */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-bold uppercase tracking-wider text-zinc-300">
                    语义色彩调色板 (Color Palette)
                  </h3>
                  <span className="text-[11px] text-zinc-400">点击颜色块或 HEX 代码即可快速复制</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {swatches.map(([label, hex]) => (
                    <div
                      key={label}
                      onClick={() => handleCopyHex(label, hex)}
                      className="group flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="h-9 w-9 shrink-0 rounded-md border border-white/10 shadow-sm"
                          style={{ backgroundColor: hex }}
                        />
                        <div className="min-w-0">
                          <div className="text-[11px] text-zinc-400 truncate">{label}</div>
                          <div className="text-[13px] font-mono font-bold text-white truncate">
                            {hex}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-[11px] font-mono text-zinc-400 group-hover:text-blue-400 transition-colors shrink-0"
                      >
                        {copiedHex === hex ? "✓ 已复制" : "复制"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Geometry & Layout Tokens */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
                <h3 className="text-[13px] font-bold uppercase tracking-wider text-zinc-300">
                  几何与版面度量令牌 (Geometry & Metrics)
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3.5">
                    <div className="text-[11px] text-zinc-400">面板圆角 (panelRadius)</div>
                    <div className="text-[14px] font-mono font-bold text-white mt-1">
                      {tokens.panelRadius}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3.5">
                    <div className="text-[11px] text-zinc-400">控件圆角 (controlRadius)</div>
                    <div className="text-[14px] font-mono font-bold text-white mt-1">
                      {tokens.controlRadius}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3.5">
                    <div className="text-[11px] text-zinc-400">描边粗细 (borderWidth)</div>
                    <div className="text-[14px] font-mono font-bold text-white mt-1">
                      {tokens.borderWidth}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3.5">
                    <div className="text-[11px] text-zinc-400">排版缩放 (headingScale)</div>
                    <div className="text-[14px] font-mono font-bold text-white mt-1">
                      {vars["--type-heading-scale"] ?? "1.0"}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3.5">
                  <div className="text-[11px] text-zinc-400 mb-1">硬阴影合成值 (--shadow-hard)</div>
                  <code className="text-[11.5px] font-mono text-zinc-300 break-all">
                    {composeShadow(tokens.shadow)}
                  </code>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: 规范与原则 (PRINCIPLES & DESIGN SPECS) */}
          {tab === "principles" && (
            <div className="space-y-5">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 space-y-2">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-zinc-400">
                  设计语言概述
                </h3>
                <p className="text-[13.5px] text-zinc-200 leading-relaxed">
                  {style.description}
                </p>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 space-y-2">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-zinc-400">
                  设计语言灵感来源
                </h3>
                <p className="text-[13px] text-zinc-300 leading-relaxed">
                  {style.inspiration}
                </p>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-zinc-400">
                  关键视觉特征 (Key Features)
                </h3>
                <ul className="space-y-2 text-[13px] text-zinc-300">
                  {style.features.map((feat: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="text-blue-400 shrink-0 mt-0.5 font-bold">●</span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {style.designPrinciples && style.designPrinciples.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
                  <h3 className="text-[12px] font-bold uppercase tracking-wider text-zinc-400">
                    设计规范与原则参考 (Design Principles)
                  </h3>
                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-4">
                    <ul className="space-y-2.5 text-[12.5px] text-zinc-300 font-mono">
                      {style.designPrinciples.map((dp: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <span className="text-amber-400 shrink-0 mt-0.5">◈</span>
                          <span>{dp}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ==================================================================
            3. FIXED / STICKY FOOTER ACTION BAR
            ================================================================== */}
        <footer className="sticky bottom-0 z-20 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-800/90 bg-[#14181f]/95 px-6 py-3.5 backdrop-blur-md">
          {/* Left: Star & Playground Tune */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onToggleStar}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3.5 py-1.5 text-[12.5px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
            >
              <span>{starred ? "★" : "☆"}</span>
              <span>{starred ? "已收藏" : "加入收藏"}</span>
            </button>

            <button
              type="button"
              onClick={handleTune}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3.5 py-1.5 text-[12.5px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
            >
              <span>🛠</span>
              <span>调校此体验</span>
            </button>
          </div>

          {/* Right: Close & SetupActionButton */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-700 bg-transparent px-4 py-1.5 text-[12.5px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
            >
              关闭
            </button>

            <SetupActionButton
              action={resolved.primaryAction}
              secondaryActions={resolved.secondaryActions}
              itemMeta={{ id: style.id, name: style.name, type: "style" }}
              size="sm"
              showPmSelector={false}
              disabled={!live}
              onActionSuccess={(msg) => {
                onNotice(msg);
                onClose();
              }}
            />
          </div>
        </footer>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}

/** Realistic Software Section Mock rendered under target style tokens */
function SoftwarePageMock({
  style,
  vars,
  profile,
}: {
  style: SetupStyle;
  vars: Record<string, string>;
  profile: ReturnType<typeof resolveExperienceProfile>;
}) {
  const surface = vars["--surface-raised"];
  const accent = vars["--status-accent"];
  const radiusPanel = vars["--radius-panel"];
  const radiusControl = vars["--radius-control"];
  const borderWidth = vars["--border-width"];

  const mockSoftware = [
    { id: "vscode", name: "Visual Studio Code", cat: "编辑器", desc: "主流轻量级代码编辑器", installed: true, ver: "v1.96.2" },
    { id: "ollama", name: "Ollama", cat: "AI 运行时", desc: "本地大语言模型快速运行与服务化工具", installed: false, ver: "v0.5.7" },
    { id: "zed", name: "Zed Editor", cat: "编辑器", desc: "Rust 开发的高性能现代代码编辑器", installed: false, ver: "v0.170.1" },
    { id: "docker", name: "Docker Desktop", cat: "容器化", desc: "企业级容器虚拟化开发平台", installed: true, ver: "v4.37.0" },
  ];

  return (
    <div
      className="flex flex-col gap-4 p-5 rounded-xl border"
      style={{
        background: "var(--surface-inset, #0e1115)",
        borderColor: "var(--line-default, rgba(255,255,255,0.12))",
        borderRadius: radiusPanel,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--line-subtle)" }}>
        <div>
          <h4 className="text-[18px] font-bold" style={{ color: "var(--text-strong)" }}>
            开发软件仓库 · {style.name}
          </h4>
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            外壳: {profile.shell ?? "sidebar"} · 共检测到 4 款核心构建工具 · 2 款已安装就绪
          </p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-1.5 border"
          style={{
            background: surface,
            borderRadius: radiusControl,
            borderWidth,
            borderColor: accent,
          }}
        >
          <span className="text-[12px] opacity-70">🔍</span>
          <span className="text-[12px]" style={{ color: "var(--text-quiet)" }}>搜索软件名或命令行…</span>
        </div>
      </div>

      {/* Software List */}
      <div className="flex flex-col gap-2.5">
        {mockSoftware.map((sw) => (
          <div
            key={sw.id}
            className="flex items-center justify-between p-3.5 border transition-all"
            style={{
              background: surface,
              borderRadius: radiusPanel,
              borderWidth,
              borderColor: "var(--line-subtle)",
              boxShadow: "var(--shadow-hard)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center font-bold text-[14px] border"
                style={{
                  background: "var(--surface-sunken, #080a0d)",
                  borderRadius: radiusControl,
                  borderColor: "var(--line-subtle)",
                  color: accent,
                }}
              >
                {sw.name[0]}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[14px]" style={{ color: "var(--text-primary)" }}>
                    {sw.name}
                  </span>
                  <span
                    className="text-[10.5px] px-1.5 py-0.2 font-mono border"
                    style={{
                      borderRadius: radiusControl,
                      background: "var(--surface-sunken)",
                      borderColor: "var(--line-subtle)",
                      color: "var(--text-quiet)",
                    }}
                  >
                    {sw.cat}
                  </span>
                  <span className="text-[11px] font-mono" style={{ color: "var(--text-quiet)" }}>
                    {sw.ver}
                  </span>
                </div>
                <p className="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  {sw.desc}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {sw.installed ? (
                <span
                  className="px-2.5 py-1 text-[11.5px] font-bold border"
                  style={{
                    borderRadius: radiusControl,
                    background: "rgba(16, 185, 129, 0.15)",
                    borderColor: "rgba(16, 185, 129, 0.3)",
                    color: "var(--status-ok, #10b981)",
                  }}
                >
                  ✓ 已就绪
                </span>
              ) : (
                <button
                  type="button"
                  className="px-3 py-1 text-[12px] font-bold border transition-transform"
                  style={{
                    borderRadius: radiusControl,
                    background: accent,
                    color: "var(--surface-base, #101317)",
                    borderWidth,
                    borderColor: accent,
                  }}
                >
                  一键安装
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Realistic Resource Section Mock rendered under target style tokens */
function ResourcePageMock({
  style,
  vars,
  profile,
}: {
  style: SetupStyle;
  vars: Record<string, string>;
  profile: ReturnType<typeof resolveExperienceProfile>;
}) {
  const surface = vars["--surface-raised"];
  const accent = vars["--status-accent"];
  const radiusPanel = vars["--radius-panel"];
  const radiusControl = vars["--radius-control"];
  const borderWidth = vars["--border-width"];

  const mockResources = [
    { title: "shadcn/ui", cat: "UI 组件库", desc: "可定制、无障碍的 React 组件原语", tag: "Tailwind" },
    { title: "Hugging Face", cat: "模型社区", desc: "开源机器学习模型、数据集与演示空间", tag: "AI / ML" },
    { title: "Bun Runtime", cat: "运行环境", desc: "超快速的全功能 JavaScript 运行时与包管理器", tag: "Tooling" },
    { title: "Raycast Store", cat: "效率插件", desc: "可扩展的开发者极速启动器与脚本库", tag: "Workflow" },
  ];

  return (
    <div
      className="flex flex-col gap-4 p-5 rounded-xl border"
      style={{
        background: "var(--surface-inset, #0e1115)",
        borderColor: "var(--line-default, rgba(255,255,255,0.12))",
        borderRadius: radiusPanel,
      }}
    >
      <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--line-subtle)" }}>
        <div>
          <h4 className="text-[18px] font-bold" style={{ color: "var(--text-strong)" }}>
            开发资源索引 · {style.name}
          </h4>
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            呈现构图: {COMPOSITION_LABEL[profile.composition ?? "solid-grid"]} · 卡片: {CARD_LABEL[profile.card ?? "panel"]}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {mockResources.map((res, i) => (
          <div
            key={i}
            className="flex flex-col justify-between p-4 border"
            style={{
              background: surface,
              borderRadius: radiusPanel,
              borderWidth,
              borderColor: "var(--line-subtle)",
              boxShadow: "var(--shadow-hard)",
            }}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="font-bold text-[14.5px]" style={{ color: "var(--text-primary)" }}>
                  {res.title}
                </span>
                <span
                  className="text-[10px] px-2 py-0.5 font-mono border"
                  style={{
                    borderRadius: radiusControl,
                    background: "var(--surface-sunken)",
                    borderColor: "var(--line-subtle)",
                    color: "var(--text-quiet)",
                  }}
                >
                  {res.tag}
                </span>
              </div>
              <p className="text-[12px] mt-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {res.desc}
              </p>
            </div>
            <div className="flex items-center justify-between mt-4 pt-2.5 border-t" style={{ borderColor: "var(--line-subtle)" }}>
              <span className="text-[11px] font-mono" style={{ color: "var(--text-quiet)" }}>
                {res.cat}
              </span>
              <span className="text-[11.5px] font-bold" style={{ color: accent }}>
                查看详情 →
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
