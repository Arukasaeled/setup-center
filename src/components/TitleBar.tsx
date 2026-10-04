/**
 * Custom window titlebar.
 *
 * The window is declared `decorations: false` in `tauri.conf.json` so the app
 * reads as a single designed surface rather than an OS frame around a web page.
 * That means the drag region and the three window controls are our
 * responsibility, and they must behave like real window chrome:
 *  - dragging works anywhere on the bar except the controls
 *  - double-click on the bar toggles maximise
 *  - the close button uses the platform's neutral hover, not a red "destructive"
 *    fill, because closing a wizard is not destructive
 *
 * ## Why the drag strip is 56px and split into cells
 *
 * The first version was a 36px bar whose only draggable area was the empty space
 * to the *left* of the three buttons. Two things were wrong with that, and both
 * were reported as "窗口不能拖动":
 *
 * 1. `justify-end` put the buttons against the right edge and left a wide empty
 *    region, but the strip was thin enough that a student aiming at the window
 *    top almost always landed on the content below it, which is not draggable.
 * 2. Nothing indicated the bar *was* draggable. With no OS frame, there was no
 *    affordance at all — a user cannot discover a 36px invisible region.
 *
 * So: a taller strip, split into explicit cells. The mark/title cell and a
 * flexible spacer are both drag regions; only the buttons opt out. The whole
 * strip is still draggable, and the layout no longer depends on `justify-end`
 * leaving usable space.
 */

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/ipc";
import { useApp, type Section } from "../lib/store";
import { VersionBadge } from "./VersionBadge";
import { UpdateModal } from "./UpdateModal";
import { ReleaseManagerInstance, type ReleaseStatusSnapshot } from "../core/vault/release";

/**
 * What the centre cell of the title bar says.
 *
 * The wizard's steps name themselves; the dashboard names the *section* rather
 * than the word "dashboard", because "概览" is what the user is looking at and
 * "仪表盘" is not a word a first-year student uses.
 */
const WIZARD_TITLES: Record<string, string> = {
  welcome: "开始",
  goal: "选择方向",
  detect: "检查环境",
  software: "已装软件",
  choose: "选择方案",
  install: "安装",
  bootstrap: "配置",
  done: "完成",
};

const SECTION_TITLES: Record<Section, string> = {
  overview: "开发起步",
  goals: "目标向导",
  software: "软件清单",
  repos: "GitHub 项目",
  resources: "开发资源",
  uiparts: "UI 零部件库",
  library: "我的库",
  style: "视觉风格",
  config: "环境配置",
  history: "历史记录",
  plugins: "插件增强",
  license: "版本与更新",
  about: "关于",
};

export function TitleBar() {
  const [maximised, setMaximised] = useState(false);
  const dashboardOpen = useApp((s) => s.dashboardOpen);
  const screen = useApp((s) => s.screen);
  const section = useApp((s) => s.section);

  const pageTitle = dashboardOpen
    ? SECTION_TITLES[section]
    : (WIZARD_TITLES[screen] ?? "");

  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [releaseSnapshot, setReleaseSnapshot] = useState<ReleaseStatusSnapshot>(() =>
    ReleaseManagerInstance.getSnapshot(),
  );

  useEffect(() => {
    return ReleaseManagerInstance.subscribe((s) => setReleaseSnapshot(s));
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    win.isMaximized().then(setMaximised).catch(() => {});
    win
      .onResized(() => {
        win.isMaximized().then(setMaximised).catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => unlisten?.();
  }, []);

  if (!isTauri()) return null;

  const win = getCurrentWindow();

  return (
    <div
      className="titlebar-drag relative z-40 flex h-14 shrink-0 items-center px-2"
      onDoubleClick={() => win.toggleMaximize().catch(() => {})}
    >
      {/* Left: the app mark and name. A drag cell rather than decoration, so the
          top-left corner — where a user instinctively grabs a window —
          responds.

          The mark is drawn as a schematic rather than a brand glyph on purpose:
          this app has no logo, and inventing one would be the same mistake the
          software icons used to make. A neutral square-with-modules reads as
          "a utility that assembles things", which is what this is. */}
      <div className="flex flex-1 items-center gap-2.5 px-3 select-none">
        <div className="border-[color:var(--line-default)] bg-[color:var(--surface-inset)] flex h-6 w-6 items-center justify-center rounded-[6px] border">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            <g
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
              className="text-[color:var(--text-secondary)]"
            >
              <rect x="1.6" y="1.6" width="5.4" height="5.4" rx="1.1" />
              <rect x="9" y="1.6" width="5.4" height="5.4" rx="1.1" />
              <rect x="1.6" y="9" width="5.4" height="5.4" rx="1.1" />
              <rect x="9" y="9" width="5.4" height="5.4" rx="1.1" />
            </g>
          </svg>
        </div>
        <span className="text-[color:var(--text-secondary)] text-[12.5px] font-medium tracking-[-0.005em]">
          Setup Center
        </span>
        {/* The version state, per the brief's "顶部增加：版本状态 FREE / PRO".
            Placed beside the product name rather than in the right-hand control
            cluster: every control on that side is an action, and a tier badge is
            not something to click. */}
        <VersionBadge />
        <button
          type="button"
          onClick={() => setShowUpdateModal(true)}
          className="titlebar-nodrag flex items-center gap-1.5 rounded-full border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] px-2.5 py-0.5 text-[11px] font-sans text-[color:var(--text-quiet)] hover:border-[color:var(--line-strong)] hover:text-[color:var(--text-primary)] transition-colors ml-1 cursor-pointer"
          title="点击打开版本与更新控制台 (Version Inspector)"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              releaseSnapshot.app.status === "update-available" || releaseSnapshot.vault.status === "update-available"
                ? "bg-[color:var(--status-accent)] animate-pulse"
                : releaseSnapshot.app.status === "up-to-date" && releaseSnapshot.vault.status === "up-to-date"
                ? "bg-emerald-400"
                : releaseSnapshot.app.status === "error" || releaseSnapshot.vault.status === "error"
                ? "bg-rose-400/80"
                : "bg-[color:var(--line-strong)]"
            }`}
          />
          <span>版本查看</span>
        </button>
      </div>

      {/* Centre: the current page's title. Kept in the bar rather than repeated
          as a large heading in the content, which is where the previous build
          put a 34px hero on every screen. */}
      <div className="pointer-events-none flex shrink-0 items-center px-3 select-none">
        <span
          data-testid="titlebar-page"
          className="text-[color:var(--text-quiet)] text-[12px]"
        >
          {pageTitle}
        </span>
      </div>

      {/* Right: the theme toggle, then the window controls. `titlebar-nodrag`
          is what keeps a click on a button from being swallowed as a window
          drag.

          The theme control lives here rather than only in the dashboard sidebar
          because the brief asks for it in the title bar, and because a user who
          opens the app in the wrong theme should not have to enter the
          dashboard to fix it. The dashboard's segmented control stays: it is
          the one that shows all three states at once. */}
      <div className="titlebar-nodrag flex items-center gap-1">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("setup:open-palette"))}
          className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--surface-hover)] transition-colors text-[11px] font-mono mr-1 cursor-pointer"
          title="打开全局指令与资产检索 (Ctrl+K / ⌘K)"
        >
          <span>⌘K</span>
          <span className="hidden sm:inline text-[10px]">检索</span>
        </button>

        <ThemeToggleButton />

        <span className="bg-[color:var(--line-subtle)] mx-1 h-4 w-px" />

        <ControlButton
          label="最小化"
          onClick={() => win.minimize().catch(() => {})}
        >
          <svg viewBox="0 0 10 10" className="h-3 w-3">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </ControlButton>

        <ControlButton
          label={maximised ? "还原" : "最大化"}
          onClick={() => win.toggleMaximize().catch(() => {})}
        >
          {maximised ? (
            <svg viewBox="0 0 10 10" className="h-3 w-3" fill="none">
              <rect x="0.5" y="2.5" width="6" height="6" stroke="currentColor" strokeWidth="1.1" />
              <path d="M3 2.5V0.5h6v6H7" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" className="h-3 w-3" fill="none">
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          )}
        </ControlButton>

        <ControlButton label="关闭" onClick={() => win.close().catch(() => {})}>
          <svg viewBox="0 0 10 10" className="h-3 w-3">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </ControlButton>
      </div>

      {showUpdateModal && (
        <UpdateModal
          isOpen={true}
          onClose={() => setShowUpdateModal(false)}
        />
      )}
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--surface-hover)] flex h-8 w-10 items-center justify-center rounded-[7px] transition-colors duration-120"
    >
      {children}
    </button>
  );
}

/**
 * Cycles dark → light → system.
 *
 * A single button rather than the dashboard's three-way segmented control: the
 * title bar has room for one icon, and "system" is reachable in one or two
 * clicks from either state. The icon shows the *current* state rather than the
 * next one, because a control that changes meaning after a click is the classic
 * toggle ambiguity.
 */
function ThemeToggleButton() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);

  const order = ["dark", "light", "system"] as const;
  const label =
    theme === "dark" ? "深色" : theme === "light" ? "浅色" : "跟随系统";

  return (
    <button
      type="button"
      aria-label={`主题：${label}`}
      title={`主题：${label}（点击切换）`}
      onClick={() => {
        const next = order[(order.indexOf(theme) + 1) % order.length];
        setTheme(next);
      }}
      className="text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--surface-hover)] flex h-8 w-8 items-center justify-center rounded-[7px] transition-colors duration-120"
    >
      {theme === "light" ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
          <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.25" />
          <path
            d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M12.9 3.1l-1.4 1.4M4.5 11.5l-1.4 1.4"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      ) : theme === "dark" ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5">
          <path
            d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.9 5.9 0 1 0 6.8 6.8z"
            fill="currentColor"
          />
        </svg>
      ) : (
        // "System" is drawn as a monitor: it is the one option that defers to
        // something outside this app, and a sun/moon would miss that.
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
          <rect
            x="1.6"
            y="2.6"
            width="12.8"
            height="8.4"
            rx="1.3"
            stroke="currentColor"
            strokeWidth="1.25"
          />
          <path
            d="M5.6 13.6h4.8M8 11v2.6"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
