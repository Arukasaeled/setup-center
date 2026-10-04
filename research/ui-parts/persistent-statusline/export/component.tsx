import React, { useState } from "react";
import {
  type StatuslineDataset,
  AGENT_RUNTIME_DATASET,
  BUILD_RUNTIME_DATASET,
} from "./datasets";
import "./statusline.css";

export interface PersistentStatuslineProps {
  initialDataset?: "agent" | "build";
  initialMode?: "expanded" | "compact";
}

export function PersistentStatusline({
  initialDataset = "agent",
  initialMode = "expanded",
}: PersistentStatuslineProps) {
  const [activeDatasetKey, setActiveDatasetKey] = useState<"agent" | "build">(initialDataset);
  const [mode, setMode] = useState<"expanded" | "compact">(initialMode);

  const baseData = activeDatasetKey === "agent" ? AGENT_RUNTIME_DATASET : BUILD_RUNTIME_DATASET;

  // Dynamic meter value state to test threshold color shifts
  const [meterValue, setMeterValue] = useState<number>(baseData.meter.value);

  // Sync meterValue when switching dataset
  const handleDatasetChange = (key: "agent" | "build") => {
    setActiveDatasetKey(key);
    setMeterValue(key === "agent" ? AGENT_RUNTIME_DATASET.meter.value : BUILD_RUNTIME_DATASET.meter.value);
  };

  const warn = baseData.meter.warnThreshold ?? 70;
  const crit = baseData.meter.critThreshold ?? 85;

  const thresholdTier = meterValue >= crit ? "crit" : meterValue >= warn ? "warn" : "normal";

  return (
    <div className="psl-wrapper">
      {/* Top Testing Controls Bar */}
      <div className="psl-controls-bar">
        <div className="psl-title-label">Persistent Status Belt Prototype</div>

        <div className="psl-dataset-buttons">
          <button
            type="button"
            className={`psl-btn ${activeDatasetKey === "agent" ? "active" : ""}`}
            onClick={() => handleDatasetChange("agent")}
          >
            AI Agent Runtime
          </button>
          <button
            type="button"
            className={`psl-btn ${activeDatasetKey === "build" ? "active" : ""}`}
            onClick={() => handleDatasetChange("build")}
          >
            Generic Build Runtime
          </button>
        </div>

        <div className="psl-mode-buttons">
          <button
            type="button"
            className={`psl-btn ${mode === "expanded" ? "active" : ""}`}
            onClick={() => setMode("expanded")}
          >
            展开模式 (Expanded)
          </button>
          <button
            type="button"
            className={`psl-btn ${mode === "compact" ? "active" : ""}`}
            onClick={() => setMode("compact")}
          >
            单行紧凑 (Compact)
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px" }}>
          <span style={{ color: "#94a3b8" }}>调测阈值:</span>
          <input
            type="range"
            min="10"
            max="100"
            value={meterValue}
            onChange={(e) => setMeterValue(Number(e.target.value))}
            style={{ width: "80px", cursor: "pointer" }}
            title="拖动测试 绿/黄/红 阈值变色"
          />
          <span style={{ width: "28px", textAlign: "right" }}>{meterValue}%</span>
        </div>
      </div>

      {/* The Actual UI Part Belt */}
      <div className="psl-belt" role="status" aria-live="polite">
        {mode === "expanded" ? (
          /* Expanded Multi-line Mode */
          <>
            {/* 1. Anchor Line */}
            <div className="psl-anchor-line">
              <div className="psl-anchor-left">
                {/* Model Badge */}
                <span className={`psl-badge ${baseData.badge.variant}`}>
                  [{baseData.badge.label}]
                </span>

                {/* Meter Bar */}
                <div className="psl-meter-container">
                  <span className="psl-meter-label">{baseData.meter.label}</span>
                  <div className="psl-meter-bar">
                    <div
                      className={`psl-meter-fill ${thresholdTier}`}
                      style={{ width: `${meterValue}%` }}
                    />
                  </div>
                  <span className={`psl-meter-value ${thresholdTier}`}>
                    {meterValue}%
                  </span>
                </div>

                <span className="psl-divider">│</span>

                {/* Meta Items */}
                <div className="psl-meta-items">
                  {baseData.meta.map((item, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && <span className="psl-divider">│</span>}
                      <span>{item}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Absolute Wall-Clock Expiry */}
              <div
                className="psl-expiry-badge"
                title="绝对时间原则：状态带依靠系统事件离散重绘，使用钟表时刻在渲染陈旧时依然保真"
              >
                expires <span className="psl-expiry-time">{baseData.absoluteExpiry}</span>
              </div>
            </div>

            {/* 2. Optional Activity Rows */}
            <div className="psl-activity-rows">
              {/* Row: Tools (Same-Event Collapsing) */}
              {baseData.tools.length > 0 && (
                <div className="psl-row">
                  {baseData.tools.map((t, i) => (
                    <React.Fragment key={t.id}>
                      {i > 0 && <span className="psl-divider">│</span>}
                      <span>
                        <span className={t.status === "completed" ? "psl-icon-ok" : "psl-icon-spin"}>
                          {t.status === "completed" ? "✓" : "◐"}
                        </span>{" "}
                        {t.name}
                        {t.count && t.count > 1 && (
                          <span className="psl-collapsed-tag"> ×{t.count}</span>
                        )}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* Row: Agents */}
              {baseData.agents.length > 0 && (
                <div className="psl-row">
                  {baseData.agents.map((ag) => (
                    <span key={ag.id} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      <span className={ag.status === "completed" ? "psl-icon-ok" : "psl-icon-spin"}>
                        {ag.status === "completed" ? "✓" : "◐"}
                      </span>
                      <span className="psl-agent-name">{ag.name}</span>
                      {ag.detail && <span style={{ color: "#94a3b8" }}>: {ag.detail}</span>}
                      {ag.elapsedMs && (
                        <span className="psl-agent-time">({Math.round(ag.elapsedMs / 1000)}s)</span>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {/* Row: Todos */}
              {baseData.todos && (
                <div className="psl-row">
                  <span className="psl-icon-todo">▸</span>
                  <span style={{ color: "#f8fafc" }}>{baseData.todos.current}</span>
                  <span style={{ color: "#64748b" }}>
                    ({baseData.todos.doneCount}/{baseData.todos.totalCount})
                  </span>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Compact Single-line Mode */
          <div className="psl-compact-line">
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span className={`psl-badge ${baseData.badge.variant}`}>
                [{baseData.badge.label}]
              </span>

              <div className="psl-meter-container">
                <span className="psl-meter-label">{baseData.meter.label}</span>
                <div className="psl-meter-bar">
                  <div
                    className={`psl-meter-fill ${thresholdTier}`}
                    style={{ width: `${meterValue}%` }}
                  />
                </div>
                <span className={`psl-meter-value ${thresholdTier}`}>
                  {meterValue}%
                </span>
              </div>

              <span className="psl-divider">│</span>

              <div className="psl-compact-tools">
                {baseData.tools.slice(0, 2).map((t, i) => (
                  <span key={t.id}>
                    <span className={t.status === "completed" ? "psl-icon-ok" : "psl-icon-spin"}>
                      {t.status === "completed" ? "✓" : "◐"}
                    </span>{" "}
                    {t.name}{t.count && t.count > 1 ? ` ×${t.count}` : ""}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {baseData.todos && (
                <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                  ▸ {baseData.todos.doneCount}/{baseData.todos.totalCount}
                </span>
              )}
              <div className="psl-expiry-badge">
                expires <span className="psl-expiry-time">{baseData.absoluteExpiry}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Explainer Note */}
      <div style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.5 }}>
        💡 <strong>Portable Principle 实证：</strong> 状态带靠离散事件驱动更新，不作持续 60fps 轮询重绘。
        因此右侧显示绝对钟表时间「expires {baseData.absoluteExpiry}」，而非「还有 3m 24s」。即使机器闲置或停止渲染，时钟时间依然保真。
      </div>
    </div>
  );
}
