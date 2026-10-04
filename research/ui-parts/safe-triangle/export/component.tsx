import React, { useState, useRef } from "react";
import { useSafeTriangle } from "./useSafeTriangle";
import "./safe-triangle.css";

interface MenuItem {
  id: string;
  label: string;
  hasSubmenu?: boolean;
  submenuItems?: { id: string; label: string; badge?: string }[];
}

const MENU_DATA: MenuItem[] = [
  { id: "git", label: "Git Workflow" },
  {
    id: "engines",
    label: "Development Engines",
    hasSubmenu: true,
    submenuItems: [
      { id: "node", label: "Node.js 22 LTS", badge: "Runtime" },
      { id: "rust", label: "Rust & Cargo", badge: "Toolchain" },
      { id: "python", label: "Python 3.12 (uv)", badge: "Env" },
      { id: "go", label: "Go 1.23", badge: "Compiler" },
      { id: "docker", label: "Docker Desktop", badge: "Container" },
    ],
  },
  {
    id: "tools",
    label: "Environment Shells",
    hasSubmenu: true,
    submenuItems: [
      { id: "wsl", label: "WSL 2 Ubuntu", badge: "Linux" },
      { id: "git-bash", label: "Git Bash", badge: "POSIX" },
      { id: "pwsh", label: "PowerShell 7", badge: "Shell" },
      { id: "wt", label: "Windows Terminal", badge: "Host" },
    ],
  },
  { id: "packages", label: "Package Managers" },
  { id: "settings", label: "Preferences & Tokens" },
];

export interface SafeTriangleMenuProps {
  initialSide?: "right" | "left";
  initialDebug?: boolean;
  initialCapHeight?: boolean;
}

export function SafeTriangleMenu({
  initialSide = "right",
  initialDebug = false,
  initialCapHeight = true,
}: SafeTriangleMenuProps) {
  const [side, setSide] = useState<"right" | "left">(initialSide);
  const [debug, setDebug] = useState<boolean>(initialDebug);
  const [capHeight, setCapHeight] = useState<boolean>(initialCapHeight);
  const [activeParentId, setActiveParentId] = useState<string | null>("engines");
  const [selectedLeaf, setSelectedLeaf] = useState<string | null>(null);

  const submenuRef = useRef<HTMLDivElement>(null);

  const activeParent = MENU_DATA.find((m) => m.id === activeParentId);
  const hasActiveSubmenu = Boolean(activeParent?.hasSubmenu && activeParent.submenuItems);

  // Hook calculates dynamic safe polygon
  const { clipPath, style, debugPoints } = useSafeTriangle(submenuRef, {
    enabled: hasActiveSubmenu,
    side,
    maxVerticalSpread: capHeight ? 90 : 400,
  });

  const handleParentMouseEnter = (item: MenuItem) => {
    setActiveParentId(item.id);
  };

  const handleMenuMouseLeave = () => {
    // If not in safe zone, allow closing or keep last
    // In actual menu, leaving container closes submenu
  };

  return (
    <div className="stm-container">
      {/* Top Controls Toolbar */}
      <div className="stm-toolbar">
        <div className="stm-title-group">
          <h2>Linear Safe-Triangle Submenu Prototype</h2>
          <p>
            对角线几何安全区：光标斜向划入子菜单时绝不意外关闭 │ 当前方向：{side === "right" ? "右侧展开" : "左侧展开"}
          </p>
        </div>

        <div className="stm-controls">
          <button
            type="button"
            className={`stm-toggle-btn ${side === "right" ? "active" : ""}`}
            onClick={() => setSide("right")}
          >
            右侧展开 (Right)
          </button>
          <button
            type="button"
            className={`stm-toggle-btn ${side === "left" ? "active" : ""}`}
            onClick={() => setSide("left")}
          >
            左侧展开 (Left)
          </button>
          <button
            type="button"
            className={`stm-toggle-btn ${capHeight ? "active" : ""}`}
            onClick={() => setCapHeight((prev) => !prev)}
            title="限制三角形底边最大高度，避免遮挡邻近菜单项"
          >
            高度防遮挡: {capHeight ? "开启 (Cap 90px)" : "全高 (Uncapped)"}
          </button>
          <button
            type="button"
            className={`stm-toggle-btn ${debug ? "debug-active" : ""}`}
            onClick={() => setDebug((prev) => !prev)}
          >
            {debug ? "● 隐藏三角区" : "○ 调试模式 (透视三角区)"}
          </button>
        </div>
      </div>

      {/* Stage Area */}
      <div className="stm-stage">
        <div className="stm-menu-wrapper" onMouseLeave={handleMenuMouseLeave}>
          {/* Primary Parent Menu */}
          <div className="stm-menu-card">
            <div className="stm-menu-header">Developer Tools</div>
            {MENU_DATA.map((item) => {
              const isItemActive = activeParentId === item.id;
              return (
                <div
                  key={item.id}
                  className={`stm-menu-item ${isItemActive ? "active" : ""}`}
                  onMouseEnter={() => handleParentMouseEnter(item)}
                  onClick={() => {
                    if (!item.hasSubmenu) setSelectedLeaf(item.label);
                  }}
                >
                  <span>{item.label}</span>
                  {item.hasSubmenu && (
                    <span className="stm-menu-arrow">
                      {side === "right" ? "›" : "‹"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Submenu Floating Card */}
          {hasActiveSubmenu && (
            <div
              ref={submenuRef}
              className={`stm-submenu-card ${side === "right" ? "on-right" : "on-left"}`}
            >
              <div className="stm-menu-header">{activeParent?.label}</div>
              {activeParent?.submenuItems?.map((sub) => (
                <div
                  key={sub.id}
                  className="stm-submenu-item"
                  onClick={() => setSelectedLeaf(`${activeParent.label} → ${sub.label}`)}
                >
                  <span>{sub.label}</span>
                  {sub.badge && <span className="stm-badge">{sub.badge}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Invisible Safe Triangle Overlay Element */}
          {hasActiveSubmenu && (
            <div
              className={`stm-safe-area-overlay ${debug ? "debug-mode" : ""}`}
              style={style}
              aria-hidden="true"
            />
          )}

          {/* Debug Coordinate Markers */}
          {debug && debugPoints && (
            <>
              <div
                className="stm-debug-marker point-p"
                style={{ left: `${debugPoints.p.x}px`, top: `${debugPoints.p.y}px` }}
                title="P: Cursor point"
              />
              <div
                className="stm-debug-marker point-a"
                style={{ left: `${debugPoints.a.x}px`, top: `${debugPoints.a.y}px` }}
                title="A: Top near corner"
              />
              <div
                className="stm-debug-marker point-b"
                style={{ left: `${debugPoints.b.x}px`, top: `${debugPoints.b.y}px` }}
                title="B: Bottom near corner"
              />
            </>
          )}
        </div>
      </div>

      {/* Explainer Footer */}
      <div className="stm-explainer">
        <div>
          <strong>交互测试提示：</strong> 从「Development Engines」向右下方斜向移动鼠标直奔「Docker Desktop」。
          在普通菜单中，光标经过下方「Environment Shells」上方时子菜单会瞬间关闭；
          在启用 Safe Triangle 后，不可见的几何多边形捕捉了光标轨迹，平滑维持子菜单开放。
        </div>
        {selectedLeaf && (
          <div style={{ marginTop: "6px", color: "#38bdf8" }}>
            ✓ 当前点击触发目标：{selectedLeaf}
          </div>
        )}
      </div>
    </div>
  );
}
