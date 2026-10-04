import React, { useState, useEffect, useRef } from "react";
import {
  type GridDataset,
  AGENT_TASK_DATASET,
  VISUAL_PRESET_DATASET,
  PRESENTATION_DATASET,
  getSlotKey,
} from "./datasets";
import "./clip-launch-grid.css";

export interface ClipLaunchGridProps {
  initialDataset?: "agent" | "preset" | "presentation";
  onActiveChange?: (activeSlots: Record<string, string | null>) => void;
}

export function ClipLaunchGrid({
  initialDataset = "agent",
  onActiveChange,
}: ClipLaunchGridProps) {
  // Available datasets
  const datasetMap: Record<string, GridDataset> = {
    agent: AGENT_TASK_DATASET,
    preset: VISUAL_PRESET_DATASET,
    presentation: PRESENTATION_DATASET,
  };

  const [activeDatasetKey, setActiveDatasetKey] = useState<string>(initialDataset);
  const dataset = datasetMap[activeDatasetKey] || AGENT_TASK_DATASET;

  // Active slot per track: { [trackId]: slotKey | null }
  // Essential mechanism: Mutual exclusion per column
  const [activeTracks, setActiveTracks] = useState<Record<string, string | null>>({});

  // Focused cell for keyboard roving index
  const [focusedCell, setFocusedCell] = useState<{ trackIndex: number; sceneIndex: number }>({
    trackIndex: 0,
    sceneIndex: 0,
  });

  const matrixRef = useRef<HTMLDivElement>(null);

  // Reset active tracks when dataset changes
  useEffect(() => {
    const initial: Record<string, string | null> = {};
    for (const track of dataset.tracks) {
      initial[track.id] = null;
    }
    setActiveTracks(initial);
  }, [activeDatasetKey, dataset]);

  // Notify parent of active changes
  useEffect(() => {
    onActiveChange?.(activeTracks);
  }, [activeTracks, onActiveChange]);

  /**
   * Single cell trigger:
   * Sets slot as active for this track. Since activeTracks keys by trackId,
   * same-track mutual exclusion is structurally guaranteed!
   */
  const handleSlotTrigger = (trackId: string, sceneId: string) => {
    const key = getSlotKey(trackId, sceneId);
    setActiveTracks((prev) => {
      const isCurrentlyActive = prev[trackId] === key;
      return {
        ...prev,
        [trackId]: isCurrentlyActive ? null : key, // Toggle
      };
    });
  };

  /**
   * Stop track: clears currently active slot on this track
   */
  const handleStopTrack = (trackId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setActiveTracks((prev) => ({
      ...prev,
      [trackId]: null,
    }));
  };

  /**
   * Stop all tracks
   */
  const handleStopAll = () => {
    setActiveTracks((prev) => {
      const reset: Record<string, string | null> = {};
      for (const trackId of Object.keys(prev)) {
        reset[trackId] = null;
      }
      return reset;
    });
  };

  /**
   * Row Trigger (Scene Launch):
   * Fires all slots present in that row.
   * If a track has NO slot in this row:
   *   - If current active slot has `hasStop === false`, it is preserved!
   *   - Otherwise, the track is cleared.
   */
  const handleSceneLaunch = (sceneId: string) => {
    setActiveTracks((prev) => {
      const next: Record<string, string | null> = { ...prev };
      for (const track of dataset.tracks) {
        const key = getSlotKey(track.id, sceneId);
        const slotInScene = dataset.slots[key];

        if (slotInScene) {
          next[track.id] = key;
        } else {
          // Track is not touched by this scene:
          // Check if currently playing slot has hasStop=false
          const currentKey = prev[track.id];
          const currentSlot = currentKey ? dataset.slots[currentKey] : null;
          if (currentSlot && currentSlot.hasStop === false) {
            // Preserved!
            next[track.id] = currentKey;
          } else {
            // Stopped
            next[track.id] = null;
          }
        }
      }
      return next;
    });
  };

  /**
   * Keyboard navigation support
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalTracks = dataset.tracks.length;
    const totalScenes = dataset.scenes.length;

    let { trackIndex, sceneIndex } = focusedCell;

    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        trackIndex = (trackIndex + 1) % totalTracks;
        setFocusedCell({ trackIndex, sceneIndex });
        break;
      case "ArrowLeft":
        e.preventDefault();
        trackIndex = (trackIndex - 1 + totalTracks) % totalTracks;
        setFocusedCell({ trackIndex, sceneIndex });
        break;
      case "ArrowDown":
        e.preventDefault();
        sceneIndex = (sceneIndex + 1) % totalScenes;
        setFocusedCell({ trackIndex, sceneIndex });
        break;
      case "ArrowUp":
        e.preventDefault();
        sceneIndex = (sceneIndex - 1 + totalScenes) % totalScenes;
        setFocusedCell({ trackIndex, sceneIndex });
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        {
          const track = dataset.tracks[trackIndex];
          const scene = dataset.scenes[sceneIndex];
          if (track && scene) {
            const key = getSlotKey(track.id, scene.id);
            if (dataset.slots[key]) {
              handleSlotTrigger(track.id, scene.id);
            }
          }
        }
        break;
      case "Escape":
      case "0":
        e.preventDefault();
        {
          const track = dataset.tracks[trackIndex];
          if (track) {
            handleStopTrack(track.id);
          }
        }
        break;
    }
  };

  const gridTemplateCols = `140px repeat(${dataset.tracks.length}, minmax(130px, 1fr))`;

  return (
    <div
      className="clg-container"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      ref={matrixRef}
      role="region"
      aria-label={dataset.title}
    >
      {/* Top Header */}
      <div className="clg-header">
        <div>
          <div className="clg-title">{dataset.title}</div>
          <div className="clg-subtitle">{dataset.subtitle}</div>
        </div>
        <div className="clg-dataset-tabs">
          <button
            type="button"
            className={`clg-tab-button ${activeDatasetKey === "agent" ? "active" : ""}`}
            onClick={() => setActiveDatasetKey("agent")}
          >
            Agent Task
          </button>
          <button
            type="button"
            className={`clg-tab-button ${activeDatasetKey === "preset" ? "active" : ""}`}
            onClick={() => setActiveDatasetKey("preset")}
          >
            Visual Preset
          </button>
          <button
            type="button"
            className={`clg-tab-button ${activeDatasetKey === "presentation" ? "active" : ""}`}
            onClick={() => setActiveDatasetKey("presentation")}
          >
            Presentation
          </button>
        </div>
      </div>

      {/* Grid Matrix */}
      <div className="clg-matrix" style={{ gridTemplateColumns: gridTemplateCols }}>
        {/* Column Headers */}
        <div className="clg-row-header-cell">
          <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>SCENE TRIGGER</span>
        </div>
        {dataset.tracks.map((track) => (
          <div key={track.id} className="clg-col-header-cell">
            <span className="clg-col-title">{track.name}</span>
            {track.badge && <span className="clg-col-badge">{track.badge}</span>}
          </div>
        ))}

        {/* Matrix Rows (Scenes) */}
        {dataset.scenes.map((scene, sIdx) => (
          <React.Fragment key={scene.id}>
            {/* Scene Launch Button (Row Trigger) */}
            <div className="clg-row-header-cell">
              <button
                type="button"
                className="clg-scene-btn"
                onClick={() => handleSceneLaunch(scene.id)}
                title={`触发整行场景：${scene.name}`}
              >
                <span className="clg-scene-icon">▶</span>
                <span>{scene.name}</span>
              </button>
            </div>

            {/* Slots across each track */}
            {dataset.tracks.map((track, tIdx) => {
              const key = getSlotKey(track.id, scene.id);
              const slot = dataset.slots[key];
              const isActive = activeTracks[track.id] === key;
              const isFocused = focusedCell.trackIndex === tIdx && focusedCell.sceneIndex === sIdx;

              if (!slot) {
                return (
                  <div
                    key={key}
                    className={`clg-slot-cell clg-slot-empty ${isFocused ? "focused" : ""}`}
                    onClick={() => setFocusedCell({ trackIndex: tIdx, sceneIndex: sIdx })}
                  />
                );
              }

              return (
                <div
                  key={key}
                  className={`clg-slot-cell ${isActive ? "clg-slot-active" : ""}`}
                  tabIndex={-1}
                  onClick={() => {
                    setFocusedCell({ trackIndex: tIdx, sceneIndex: sIdx });
                    handleSlotTrigger(track.id, scene.id);
                  }}
                  title={slot.description || slot.label}
                >
                  <div className="clg-slot-top-row">
                    <span className="clg-slot-label">{slot.label}</span>
                    <div className="clg-slot-controls">
                      {isActive && (
                        <button
                          type="button"
                          className="clg-stop-btn"
                          onClick={(e) => handleStopTrack(track.id, e)}
                          title="停止此通道"
                        >
                          ■
                        </button>
                      )}
                      <button type="button" className="clg-trigger-btn">
                        {isActive ? "●" : "▶"}
                      </button>
                    </div>
                  </div>
                  {slot.description && <div className="clg-slot-desc">{slot.description}</div>}
                </div>
              );
            })}
          </React.Fragment>
        ))}

        {/* Per-Track Status Bottom Row */}
        <div className="clg-row-header-cell">
          <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>STATUS</span>
        </div>
        {dataset.tracks.map((track) => {
          const activeKey = activeTracks[track.id];
          const activeSlot = activeKey ? dataset.slots[activeKey] : null;
          return (
            <div key={`status-${track.id}`} className="clg-status-cell">
              {activeSlot ? (
                <span className="clg-status-active">
                  <span className="clg-pulse-dot" />
                  <span className="clg-status-text">{activeSlot.label}</span>
                </span>
              ) : (
                <span className="clg-status-text">idle</span>
              )}
              {activeSlot && (
                <button
                  type="button"
                  className="clg-stop-btn"
                  onClick={() => handleStopTrack(track.id)}
                  title="停止"
                >
                  ■
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="clg-footer-toolbar">
        <div>
          <span>键盘导航：[↑ ↓ ← →] 移动光标 │ [Enter / Space] 触发 │ [0 / Esc] 停止通道</span>
        </div>
        <button type="button" className="clg-stop-all-btn" onClick={handleStopAll}>
          ■ 停止全部通道 (Stop All)
        </button>
      </div>
    </div>
  );
}
