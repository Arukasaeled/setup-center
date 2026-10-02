import { useState, useEffect } from "react";
import clsx from "clsx";
import { Button } from "./ui";
import { getStyle } from "../styles";
import { TransferHistory } from "../core/transfer";

const TWEAKER_STORAGE_KEY = "setup-center.token-tweaker.v1";

export interface CustomTokens {
  borderRadius?: string;
  borderWidth?: string;
  shadowDepth?: string;
  accentColor?: string;
  surfaceOpacity?: number; // 50 - 100
}

export function TokenTweaker({
  activeStyleId,
  isCollapsed = false,
  onToggleCollapse,
}: {
  activeStyleId: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const currentStyleDef = getStyle(activeStyleId);

  const [tokens, setTokens] = useState<CustomTokens>(() => {
    try {
      const saved = localStorage.getItem(`${TWEAKER_STORAGE_KEY}.${activeStyleId}`);
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return {
      borderRadius: currentStyleDef?.tokens?.borderRadius || "4px",
      borderWidth: currentStyleDef?.tokens?.borderWidth || "1px",
      shadowDepth: currentStyleDef?.tokens?.hardShadow || "0px",
      accentColor: currentStyleDef?.palette.accent || "#ff2d55",
      surfaceOpacity: 100,
    };
  });

  const [copied, setCopied] = useState(false);

  // Apply tokens to document root
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    if (tokens.borderRadius) {
      root.style.setProperty("--radius-panel", tokens.borderRadius);
      root.style.setProperty("--radius-control", tokens.borderRadius);
    }
    if (tokens.borderWidth) {
      root.style.setProperty("--border-width-custom", tokens.borderWidth);
    }
    if (tokens.accentColor) {
      root.style.setProperty("--status-accent", tokens.accentColor);
    }
    if (tokens.surfaceOpacity !== undefined) {
      root.style.setProperty("--surface-opacity-custom", `${tokens.surfaceOpacity}%`);
    }

    try {
      localStorage.setItem(`${TWEAKER_STORAGE_KEY}.${activeStyleId}`, JSON.stringify(tokens));
    } catch {
      // ignore
    }
  }, [tokens, activeStyleId]);

  const handleReset = () => {
    const defaultTokens: CustomTokens = {
      borderRadius: currentStyleDef?.tokens?.borderRadius || "4px",
      borderWidth: currentStyleDef?.tokens?.borderWidth || "1px",
      shadowDepth: currentStyleDef?.tokens?.hardShadow || "0px",
      accentColor: currentStyleDef?.palette.accent || "#ff2d55",
      surfaceOpacity: 100,
    };
    setTokens(defaultTokens);
    try {
      localStorage.removeItem(`${TWEAKER_STORAGE_KEY}.${activeStyleId}`);
    } catch {
      // ignore
    }
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.style.removeProperty("--radius-panel");
      root.style.removeProperty("--radius-control");
      root.style.removeProperty("--border-width-custom");
      root.style.removeProperty("--status-accent");
      root.style.removeProperty("--surface-opacity-custom");
    }
  };

  const handleExport = () => {
    const exportData = {
      styleId: activeStyleId,
      styleName: currentStyleDef?.name,
      exportedAt: new Date().toISOString(),
      tokens: {
        borderRadius: tokens.borderRadius,
        borderWidth: tokens.borderWidth,
        shadowDepth: tokens.shadowDepth,
        accentColor: tokens.accentColor,
        surfaceOpacity: `${tokens.surfaceOpacity}%`,
      },
    };

    navigator.clipboard?.writeText(JSON.stringify(exportData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);

    TransferHistory.record({
      type: "sync",
      title: "导出设计令牌",
      targetId: activeStyleId,
      targetName: `${currentStyleDef?.name} 令牌`,
      status: "info",
      summary: `已复制「${currentStyleDef?.name}」的自定义令牌配置至剪贴板`,
    });
  };

  if (isCollapsed) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-bold text-[color:var(--text-strong)]">
            令牌微调器 (Token Tweaker)
          </span>
          <span className="rounded bg-[color:var(--surface-hover)] px-2 py-0.5 text-[10.5px] font-mono text-[color:var(--text-tertiary)] border border-[color:var(--line-subtle)]">
            {activeStyleId}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleReset}>
            重置
          </Button>
          <Button size="sm" variant="quiet" onClick={onToggleCollapse}>
            展开调节面板 ↓
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-sunken)] p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[color:var(--line-subtle)]">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-[color:var(--text-strong)]">
              设计令牌检查器 (Token Tweaker)
            </span>
            <span className="rounded bg-[color:var(--surface-hover)] px-2 py-0.5 text-[10.5px] font-mono text-[color:var(--text-tertiary)] border border-[color:var(--line-subtle)]">
              {activeStyleId}
            </span>
          </div>
          <p className="text-[11.5px] text-[color:var(--text-tertiary)] mt-0.5">
            实时微调当前设计系统的全局几何圆角、阴影位移、强调色与不透明度
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="ghost" onClick={handleReset}>
            重置默认
          </Button>
          <Button size="sm" variant="quiet" onClick={handleExport}>
            {copied ? "已复制 JSON" : "导出令牌 (JSON)"}
          </Button>
          {onToggleCollapse && (
            <Button size="sm" variant="ghost" onClick={onToggleCollapse}>
              收起 ↑
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-3.5">
        {/* Border Radius */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-[color:var(--text-secondary)]">容器圆角 (Radius)</span>
            <span className="font-mono text-[color:var(--text-quiet)]">{tokens.borderRadius}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {["0px", "2px", "4px", "8px", "12px", "16px", "24px"].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setTokens((t) => ({ ...t, borderRadius: r }))}
                className={clsx(
                  "px-2 py-0.5 text-[10.5px] font-mono rounded border transition-all",
                  tokens.borderRadius === r
                    ? "border-[color:var(--status-accent)] bg-[color:var(--status-accent)] text-black font-bold"
                    : "border-[color:var(--line-subtle)] bg-[color:var(--surface-base)] text-[color:var(--text-secondary)] hover:border-[color:var(--line-strong)]",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Border Width */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-[color:var(--text-secondary)]">边框线宽 (Border)</span>
            <span className="font-mono text-[color:var(--text-quiet)]">{tokens.borderWidth}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {["1px", "1.5px", "2px", "3px", "4px"].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setTokens((t) => ({ ...t, borderWidth: w }))}
                className={clsx(
                  "px-2 py-0.5 text-[10.5px] font-mono rounded border transition-all",
                  tokens.borderWidth === w
                    ? "border-[color:var(--status-accent)] bg-[color:var(--status-accent)] text-black font-bold"
                    : "border-[color:var(--line-subtle)] bg-[color:var(--surface-base)] text-[color:var(--text-secondary)] hover:border-[color:var(--line-strong)]",
                )}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* Shadow Depth */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-[color:var(--text-secondary)]">硬阴影 (Shadow)</span>
            <span className="font-mono text-[color:var(--text-quiet)]">{tokens.shadowDepth}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {["0px", "2px", "4px", "6px", "8px"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setTokens((t) => ({ ...t, shadowDepth: s }))}
                className={clsx(
                  "px-2 py-0.5 text-[10.5px] font-mono rounded border transition-all",
                  tokens.shadowDepth === s
                    ? "border-[color:var(--status-accent)] bg-[color:var(--status-accent)] text-black font-bold"
                    : "border-[color:var(--line-subtle)] bg-[color:var(--surface-base)] text-[color:var(--text-secondary)] hover:border-[color:var(--line-strong)]",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Accent Color */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-[color:var(--text-secondary)]">强调色 (Accent)</span>
            <span className="font-mono text-[color:var(--text-quiet)]">{tokens.accentColor}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={tokens.accentColor}
              onChange={(e) => setTokens((t) => ({ ...t, accentColor: e.target.value }))}
              className="h-6 w-8 cursor-pointer rounded border border-[color:var(--line-default)] bg-transparent p-0"
              title="拾取自定义颜色"
            />
            {["#ff2d55", "#64ffda", "#38bdf8", "#f59e0b", "#a855f7"].map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => setTokens((t) => ({ ...t, accentColor: hex }))}
                className="h-5 w-5 rounded-full border border-black/30 transition-transform hover:scale-110"
                style={{ backgroundColor: hex }}
                title={hex}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
