import type { UIPart } from "./types";

export const SEED_UI_PARTS: UIPart[] = [
  {
    "id": "clip-launch-grid",
    "title": "Clip Launch Grid",
    "lifecycle": "validated",
    "kind": "layout",
    "summary": "行列式双向触发矩阵：列建模为互斥执行通道，行建模为可批量同步触发的场景，布局与执行顺序完全解耦。",
    "sources": [
      {
        "id": "ableton-live-session-view",
        "title": "Ableton Reference Manual v12, Ch.7 Session View",
        "url": "https://www.ableton.com/en/live-manual/12/session-view/",
        "type": "official",
        "primary": true,
        "notes": "一手官方文档完整定义了 Session View 结构、列互斥性与行级 Scene 批量触发机制。"
      }
    ],
    "preview": {
      "thumbnail": "data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"225\" viewBox=\"0 0 400 225\" fill=\"%23080b12\"><rect width=\"400\" height=\"225\" rx=\"8\" fill=\"%23090d16\"/><rect x=\"20\" y=\"20\" width=\"360\" height=\"185\" rx=\"6\" fill=\"%230f172a\" stroke=\"%231e293b\" stroke-width=\"1.5\"/><g fill=\"%23334155\"><rect x=\"30\" y=\"30\" width=\"60\" height=\"14\" rx=\"3\"/><rect x=\"100\" y=\"30\" width=\"60\" height=\"14\" rx=\"3\"/><rect x=\"170\" y=\"30\" width=\"60\" height=\"14\" rx=\"3\"/><rect x=\"240\" y=\"30\" width=\"60\" height=\"14\" rx=\"3\"/><rect x=\"310\" y=\"30\" width=\"60\" height=\"14\" rx=\"3\" fill=\"%236366f1\"/></g><g><rect x=\"30\" y=\"55\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%2310b981\" fill-opacity=\"0.2\" stroke=\"%2310b981\"/><polygon points=\"38,68 45,64 45,72\" fill=\"%2310b981\"/><rect x=\"100\" y=\"55\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"170\" y=\"55\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"240\" y=\"55\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"310\" y=\"55\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%234f46e5\" fill-opacity=\"0.3\" stroke=\"%236366f1\"/></g><g><rect x=\"30\" y=\"90\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"100\" y=\"90\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%230ea5e9\" fill-opacity=\"0.25\" stroke=\"%230ea5e9\"/><rect x=\"170\" y=\"90\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"240\" y=\"90\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"310\" y=\"90\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%234f46e5\" fill-opacity=\"0.3\" stroke=\"%236366f1\"/></g><g><rect x=\"30\" y=\"125\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"100\" y=\"125\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"170\" y=\"125\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%23f59e0b\" fill-opacity=\"0.2\" stroke=\"%23f59e0b\"/><rect x=\"240\" y=\"125\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"310\" y=\"125\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%234f46e5\" fill-opacity=\"0.3\" stroke=\"%236366f1\"/></g><g><rect x=\"30\" y=\"160\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"100\" y=\"160\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"170\" y=\"160\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%231e293b\"/><rect x=\"240\" y=\"160\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%23ec4899\" fill-opacity=\"0.2\" stroke=\"%23ec4899\"/><rect x=\"310\" y=\"160\" width=\"60\" height=\"26\" rx=\"4\" fill=\"%234f46e5\" fill-opacity=\"0.3\" stroke=\"%236366f1\"/></g></svg>",
      "screenshots": [
        "research/ui-parts/screenshots/clip-grid-agent.png",
        "research/ui-parts/screenshots/clip-grid-preset.png",
        "research/ui-parts/screenshots/clip-grid-presentation.png"
      ],
      "prototypeUrl": "research/ui-parts/lab/index.html?part=clip-grid",
      "aspectRatio": "16:9"
    },
    "tags": [
      "grid",
      "matrix",
      "launcher",
      "channel-exclusive",
      "scene-trigger",
      "orchestration"
    ],
    "notes": "核心机制：列代表互斥资源通道，行代表跨通道同步触发的场景切片。完全解耦空间几何与先后执行时序。",
    "design": {
      "designDNA": {
        "layout": "Two-dimensional matrix where columns are mutually exclusive tracks and rows are synchronized scenes.",
        "typography": "Dense tabular sans-serif with monospace stage numbers and badge markers.",
        "color": "Neutral dark slate (#090d16) with active emerald accents and muted stop indicators.",
        "shape": "Dense rounded-sm rectangular slots with integrated trigger triangles and square stop controls.",
        "density": "High information density, immediate random-access grid.",
        "motion": "Instantaneous state toggle with subtle active glow pulse.",
        "interaction": "Single cell click, column mutual exclusion, row-level scene launch, roving tabindex keyboard navigation."
      },
      "portablePrinciple": {
        "rule": "When orchestrating independent parallel channels with cross-channel synchronization points, use a column-exclusive grid with row-level scene launchers because it provides random-access triggers without imposing a rigid timeline sequence.",
        "zh": "当需要协调多条独立并行的通道并在通道间定义同步触发点时，使用列互斥矩阵配合行级场景触发器，因为它既能提供任意单元格的随机访问，又无需绑定僵化的线性时间轴。"
      },
      "essentialMechanisms": [
        "列通道互斥性：同一列通道在任何时刻最多只有一个单元格处于激活播放态",
        "行级场景触发：整行发射器（Scene Launch）同时批量触发该行涉及的各通道单元格",
        "停止保护机制：支持标记 hasStop=false，使空位在整行批量触发时不打断该通道已有活动",
        "单元格自给自足：每个 Slot 具备独立触发状态与停止控制",
        "解耦布局与时序：空间网格仅表达可用选项与组合维度，不代表自上而下的线性强制播放流"
      ],
      "optionalCharacteristics": [
        "音乐专属语境（BPM 节拍、小节量化、循环音频波形）",
        "Ableton 专有色彩体系与灰色工业风宿主界面",
        "Follow Actions、MIDI 硬件映射与 Arrangement 线性走带"
      ],
      "useCases": [
        {
          "scenario": "AI Multi-Agent Task Orchestration (Agent 任务阶段矩阵)",
          "fit": "high",
          "notes": "列为各专业 Agent，行为阶段同步触发"
        },
        {
          "scenario": "Visual Preset Live Mixer (设计系统场景混音台)",
          "fit": "high",
          "notes": "列为字阶/色彩/动效/布局家族，行为预设场景"
        },
        {
          "scenario": "Interactive Presentation Director (幻灯与演示导播台)",
          "fit": "high",
          "notes": "列为背景/正文/演示者视窗/交互画板图层"
        }
      ]
    },
    "implementation": {
      "difficulty": "low",
      "preferredTech": "CSS Grid + React State + Keyboard Navigation",
      "implementationBasis": "纯 React 状态机与标准 CSS Grid 布局，脱离宿主软件与 Web Audio API。",
      "prototypeVariants": [
        {
          "id": "agent",
          "name": "AI Agent Task Orchestrator",
          "description": "Architect / Coder / Reviewer / DevOps"
        },
        {
          "id": "preset",
          "name": "Visual Preset Dimension Mixer",
          "description": "Typography / Palette / Motion / Geometry"
        },
        {
          "id": "presentation",
          "name": "Presentation Scene Director",
          "description": "Backdrop / Content / Presenter / Sandbox"
        }
      ]
    },
    "evidence": {
      "structure": "verified",
      "behavior": "verified",
      "visual": "derived",
      "sourceCode": "unread",
      "notes": [
        "官方手册完整定义了 Session View、Track、Scene、Slot、Stop Button 语义 [Verified]",
        "视觉层面采用中性高对比度原型风格，不依赖 Ableton 专有色板与音频引擎 [Derived]"
      ]
    },
    "assets": {
      "codeAssets": [
        {
          "id": "component-tsx",
          "name": "ClipLaunchGrid Component",
          "filename": "ClipLaunchGrid.tsx",
          "content": "import React, { useState, useEffect, useRef } from \"react\";\r\nimport {\r\n  type GridDataset,\r\n  AGENT_TASK_DATASET,\r\n  VISUAL_PRESET_DATASET,\r\n  PRESENTATION_DATASET,\r\n  getSlotKey,\r\n} from \"./datasets\";\r\nimport \"./clip-launch-grid.css\";\r\n\r\nexport interface ClipLaunchGridProps {\r\n  initialDataset?: \"agent\" | \"preset\" | \"presentation\";\r\n  onActiveChange?: (activeSlots: Record<string, string | null>) => void;\r\n}\r\n\r\nexport function ClipLaunchGrid({\r\n  initialDataset = \"agent\",\r\n  onActiveChange,\r\n}: ClipLaunchGridProps) {\r\n  // Available datasets\r\n  const datasetMap: Record<string, GridDataset> = {\r\n    agent: AGENT_TASK_DATASET,\r\n    preset: VISUAL_PRESET_DATASET,\r\n    presentation: PRESENTATION_DATASET,\r\n  };\r\n\r\n  const [activeDatasetKey, setActiveDatasetKey] = useState<string>(initialDataset);\r\n  const dataset = datasetMap[activeDatasetKey] || AGENT_TASK_DATASET;\r\n\r\n  // Active slot per track: { [trackId]: slotKey | null }\r\n  // Essential mechanism: Mutual exclusion per column\r\n  const [activeTracks, setActiveTracks] = useState<Record<string, string | null>>({});\r\n\r\n  // Focused cell for keyboard roving index\r\n  const [focusedCell, setFocusedCell] = useState<{ trackIndex: number; sceneIndex: number }>({\r\n    trackIndex: 0,\r\n    sceneIndex: 0,\r\n  });\r\n\r\n  const matrixRef = useRef<HTMLDivElement>(null);\r\n\r\n  // Reset active tracks when dataset changes\r\n  useEffect(() => {\r\n    const initial: Record<string, string | null> = {};\r\n    for (const track of dataset.tracks) {\r\n      initial[track.id] = null;\r\n    }\r\n    setActiveTracks(initial);\r\n  }, [activeDatasetKey, dataset]);\r\n\r\n  // Notify parent of active changes\r\n  useEffect(() => {\r\n    onActiveChange?.(activeTracks);\r\n  }, [activeTracks, onActiveChange]);\r\n\r\n  /**\r\n   * Single cell trigger:\r\n   * Sets slot as active for this track. Since activeTracks keys by trackId,\r\n   * same-track mutual exclusion is structurally guaranteed!\r\n   */\r\n  const handleSlotTrigger = (trackId: string, sceneId: string) => {\r\n    const key = getSlotKey(trackId, sceneId);\r\n    setActiveTracks((prev) => {\r\n      const isCurrentlyActive = prev[trackId] === key;\r\n      return {\r\n        ...prev,\r\n        [trackId]: isCurrentlyActive ? null : key, // Toggle\r\n      };\r\n    });\r\n  };\r\n\r\n  /**\r\n   * Stop track: clears currently active slot on this track\r\n   */\r\n  const handleStopTrack = (trackId: string, e?: React.MouseEvent) => {\r\n    e?.stopPropagation();\r\n    setActiveTracks((prev) => ({\r\n      ...prev,\r\n      [trackId]: null,\r\n    }));\r\n  };\r\n\r\n  /**\r\n   * Stop all tracks\r\n   */\r\n  const handleStopAll = () => {\r\n    setActiveTracks((prev) => {\r\n      const reset: Record<string, string | null> = {};\r\n      for (const trackId of Object.keys(prev)) {\r\n        reset[trackId] = null;\r\n      }\r\n      return reset;\r\n    });\r\n  };\r\n\r\n  /**\r\n   * Row Trigger (Scene Launch):\r\n   * Fires all slots present in that row.\r\n   * If a track has NO slot in this row:\r\n   *   - If current active slot has `hasStop === false`, it is preserved!\r\n   *   - Otherwise, the track is cleared.\r\n   */\r\n  const handleSceneLaunch = (sceneId: string) => {\r\n    setActiveTracks((prev) => {\r\n      const next: Record<string, string | null> = { ...prev };\r\n      for (const track of dataset.tracks) {\r\n        const key = getSlotKey(track.id, sceneId);\r\n        const slotInScene = dataset.slots[key];\r\n\r\n        if (slotInScene) {\r\n          next[track.id] = key;\r\n        } else {\r\n          // Track is not touched by this scene:\r\n          // Check if currently playing slot has hasStop=false\r\n          const currentKey = prev[track.id];\r\n          const currentSlot = currentKey ? dataset.slots[currentKey] : null;\r\n          if (currentSlot && currentSlot.hasStop === false) {\r\n            // Preserved!\r\n            next[track.id] = currentKey;\r\n          } else {\r\n            // Stopped\r\n            next[track.id] = null;\r\n          }\r\n        }\r\n      }\r\n      return next;\r\n    });\r\n  };\r\n\r\n  /**\r\n   * Keyboard navigation support\r\n   */\r\n  const handleKeyDown = (e: React.KeyboardEvent) => {\r\n    const totalTracks = dataset.tracks.length;\r\n    const totalScenes = dataset.scenes.length;\r\n\r\n    let { trackIndex, sceneIndex } = focusedCell;\r\n\r\n    switch (e.key) {\r\n      case \"ArrowRight\":\r\n        e.preventDefault();\r\n        trackIndex = (trackIndex + 1) % totalTracks;\r\n        setFocusedCell({ trackIndex, sceneIndex });\r\n        break;\r\n      case \"ArrowLeft\":\r\n        e.preventDefault();\r\n        trackIndex = (trackIndex - 1 + totalTracks) % totalTracks;\r\n        setFocusedCell({ trackIndex, sceneIndex });\r\n        break;\r\n      case \"ArrowDown\":\r\n        e.preventDefault();\r\n        sceneIndex = (sceneIndex + 1) % totalScenes;\r\n        setFocusedCell({ trackIndex, sceneIndex });\r\n        break;\r\n      case \"ArrowUp\":\r\n        e.preventDefault();\r\n        sceneIndex = (sceneIndex - 1 + totalScenes) % totalScenes;\r\n        setFocusedCell({ trackIndex, sceneIndex });\r\n        break;\r\n      case \"Enter\":\r\n      case \" \":\r\n        e.preventDefault();\r\n        {\r\n          const track = dataset.tracks[trackIndex];\r\n          const scene = dataset.scenes[sceneIndex];\r\n          if (track && scene) {\r\n            const key = getSlotKey(track.id, scene.id);\r\n            if (dataset.slots[key]) {\r\n              handleSlotTrigger(track.id, scene.id);\r\n            }\r\n          }\r\n        }\r\n        break;\r\n      case \"Escape\":\r\n      case \"0\":\r\n        e.preventDefault();\r\n        {\r\n          const track = dataset.tracks[trackIndex];\r\n          if (track) {\r\n            handleStopTrack(track.id);\r\n          }\r\n        }\r\n        break;\r\n    }\r\n  };\r\n\r\n  const gridTemplateCols = `140px repeat(${dataset.tracks.length}, minmax(130px, 1fr))`;\r\n\r\n  return (\r\n    <div\r\n      className=\"clg-container\"\r\n      tabIndex={0}\r\n      onKeyDown={handleKeyDown}\r\n      ref={matrixRef}\r\n      role=\"region\"\r\n      aria-label={dataset.title}\r\n    >\r\n      {/* Top Header */}\r\n      <div className=\"clg-header\">\r\n        <div>\r\n          <div className=\"clg-title\">{dataset.title}</div>\r\n          <div className=\"clg-subtitle\">{dataset.subtitle}</div>\r\n        </div>\r\n        <div className=\"clg-dataset-tabs\">\r\n          <button\r\n            type=\"button\"\r\n            className={`clg-tab-button ${activeDatasetKey === \"agent\" ? \"active\" : \"\"}`}\r\n            onClick={() => setActiveDatasetKey(\"agent\")}\r\n          >\r\n            Agent Task\r\n          </button>\r\n          <button\r\n            type=\"button\"\r\n            className={`clg-tab-button ${activeDatasetKey === \"preset\" ? \"active\" : \"\"}`}\r\n            onClick={() => setActiveDatasetKey(\"preset\")}\r\n          >\r\n            Visual Preset\r\n          </button>\r\n          <button\r\n            type=\"button\"\r\n            className={`clg-tab-button ${activeDatasetKey === \"presentation\" ? \"active\" : \"\"}`}\r\n            onClick={() => setActiveDatasetKey(\"presentation\")}\r\n          >\r\n            Presentation\r\n          </button>\r\n        </div>\r\n      </div>\r\n\r\n      {/* Grid Matrix */}\r\n      <div className=\"clg-matrix\" style={{ gridTemplateColumns: gridTemplateCols }}>\r\n        {/* Column Headers */}\r\n        <div className=\"clg-row-header-cell\">\r\n          <span style={{ fontSize: \"11px\", color: \"#64748b\", fontWeight: 600 }}>SCENE TRIGGER</span>\r\n        </div>\r\n        {dataset.tracks.map((track) => (\r\n          <div key={track.id} className=\"clg-col-header-cell\">\r\n            <span className=\"clg-col-title\">{track.name}</span>\r\n            {track.badge && <span className=\"clg-col-badge\">{track.badge}</span>}\r\n          </div>\r\n        ))}\r\n\r\n        {/* Matrix Rows (Scenes) */}\r\n        {dataset.scenes.map((scene, sIdx) => (\r\n          <React.Fragment key={scene.id}>\r\n            {/* Scene Launch Button (Row Trigger) */}\r\n            <div className=\"clg-row-header-cell\">\r\n              <button\r\n                type=\"button\"\r\n                className=\"clg-scene-btn\"\r\n                onClick={() => handleSceneLaunch(scene.id)}\r\n                title={`触发整行场景：${scene.name}`}\r\n              >\r\n                <span className=\"clg-scene-icon\">▶</span>\r\n                <span>{scene.name}</span>\r\n              </button>\r\n            </div>\r\n\r\n            {/* Slots across each track */}\r\n            {dataset.tracks.map((track, tIdx) => {\r\n              const key = getSlotKey(track.id, scene.id);\r\n              const slot = dataset.slots[key];\r\n              const isActive = activeTracks[track.id] === key;\r\n              const isFocused = focusedCell.trackIndex === tIdx && focusedCell.sceneIndex === sIdx;\r\n\r\n              if (!slot) {\r\n                return (\r\n                  <div\r\n                    key={key}\r\n                    className={`clg-slot-cell clg-slot-empty ${isFocused ? \"focused\" : \"\"}`}\r\n                    onClick={() => setFocusedCell({ trackIndex: tIdx, sceneIndex: sIdx })}\r\n                  />\r\n                );\r\n              }\r\n\r\n              return (\r\n                <div\r\n                  key={key}\r\n                  className={`clg-slot-cell ${isActive ? \"clg-slot-active\" : \"\"}`}\r\n                  tabIndex={-1}\r\n                  onClick={() => {\r\n                    setFocusedCell({ trackIndex: tIdx, sceneIndex: sIdx });\r\n                    handleSlotTrigger(track.id, scene.id);\r\n                  }}\r\n                  title={slot.description || slot.label}\r\n                >\r\n                  <div className=\"clg-slot-top-row\">\r\n                    <span className=\"clg-slot-label\">{slot.label}</span>\r\n                    <div className=\"clg-slot-controls\">\r\n                      {isActive && (\r\n                        <button\r\n                          type=\"button\"\r\n                          className=\"clg-stop-btn\"\r\n                          onClick={(e) => handleStopTrack(track.id, e)}\r\n                          title=\"停止此通道\"\r\n                        >\r\n                          ■\r\n                        </button>\r\n                      )}\r\n                      <button type=\"button\" className=\"clg-trigger-btn\">\r\n                        {isActive ? \"●\" : \"▶\"}\r\n                      </button>\r\n                    </div>\r\n                  </div>\r\n                  {slot.description && <div className=\"clg-slot-desc\">{slot.description}</div>}\r\n                </div>\r\n              );\r\n            })}\r\n          </React.Fragment>\r\n        ))}\r\n\r\n        {/* Per-Track Status Bottom Row */}\r\n        <div className=\"clg-row-header-cell\">\r\n          <span style={{ fontSize: \"11px\", color: \"#64748b\", fontWeight: 600 }}>STATUS</span>\r\n        </div>\r\n        {dataset.tracks.map((track) => {\r\n          const activeKey = activeTracks[track.id];\r\n          const activeSlot = activeKey ? dataset.slots[activeKey] : null;\r\n          return (\r\n            <div key={`status-${track.id}`} className=\"clg-status-cell\">\r\n              {activeSlot ? (\r\n                <span className=\"clg-status-active\">\r\n                  <span className=\"clg-pulse-dot\" />\r\n                  <span className=\"clg-status-text\">{activeSlot.label}</span>\r\n                </span>\r\n              ) : (\r\n                <span className=\"clg-status-text\">idle</span>\r\n              )}\r\n              {activeSlot && (\r\n                <button\r\n                  type=\"button\"\r\n                  className=\"clg-stop-btn\"\r\n                  onClick={() => handleStopTrack(track.id)}\r\n                  title=\"停止\"\r\n                >\r\n                  ■\r\n                </button>\r\n              )}\r\n            </div>\r\n          );\r\n        })}\r\n      </div>\r\n\r\n      {/* Footer Info */}\r\n      <div className=\"clg-footer-toolbar\">\r\n        <div>\r\n          <span>键盘导航：[↑ ↓ ← →] 移动光标 │ [Enter / Space] 触发 │ [0 / Esc] 停止通道</span>\r\n        </div>\r\n        <button type=\"button\" className=\"clg-stop-all-btn\" onClick={handleStopAll}>\r\n          ■ 停止全部通道 (Stop All)\r\n        </button>\r\n      </div>\r\n    </div>\r\n  );\r\n}\r\n",
          "language": "tsx",
          "description": "React component implementing column mutual exclusion and row scene triggers"
        },
        {
          "id": "styles-css",
          "name": "Grid Styles",
          "filename": "clip-launch-grid.css",
          "content": "/**\r\n * Neutral CSS for Clip Launch Grid Prototype\r\n * Pure CSS Grid layout, zero vendor/Ableton brand dependencies.\r\n */\r\n\r\n.clg-container {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 16px;\r\n  background-color: #0c0e12;\r\n  color: #e2e8f0;\r\n  padding: 20px;\r\n  border-radius: 10px;\r\n  border: 1px solid #1e2430;\r\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif;\r\n  user-select: none;\r\n  max-width: 960px;\r\n  margin: 0 auto;\r\n}\r\n\r\n.clg-header {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  border-bottom: 1px solid #1e2430;\r\n  padding-bottom: 12px;\r\n}\r\n\r\n.clg-title {\r\n  font-size: 16px;\r\n  font-weight: 700;\r\n  letter-spacing: -0.01em;\r\n  color: #f8fafc;\r\n}\r\n\r\n.clg-subtitle {\r\n  font-size: 12px;\r\n  color: #94a3b8;\r\n  margin-top: 2px;\r\n}\r\n\r\n.clg-dataset-tabs {\r\n  display: flex;\r\n  gap: 6px;\r\n}\r\n\r\n.clg-tab-button {\r\n  background: #181d28;\r\n  border: 1px solid #283347;\r\n  color: #94a3b8;\r\n  padding: 4px 10px;\r\n  font-size: 12px;\r\n  border-radius: 6px;\r\n  cursor: pointer;\r\n  transition: all 0.15s ease;\r\n}\r\n\r\n.clg-tab-button:hover {\r\n  background: #232a3b;\r\n  color: #f1f5f9;\r\n}\r\n\r\n.clg-tab-button.active {\r\n  background: #2563eb;\r\n  border-color: #3b82f6;\r\n  color: #ffffff;\r\n  font-weight: 600;\r\n}\r\n\r\n/* Grid Matrix */\r\n.clg-matrix {\r\n  display: grid;\r\n  gap: 6px;\r\n}\r\n\r\n.clg-col-header-cell {\r\n  background: #131720;\r\n  border: 1px solid #222a3a;\r\n  border-radius: 6px;\r\n  padding: 8px 10px;\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 2px;\r\n}\r\n\r\n.clg-col-title {\r\n  font-size: 13px;\r\n  font-weight: 600;\r\n  color: #f1f5f9;\r\n}\r\n\r\n.clg-col-badge {\r\n  font-size: 10px;\r\n  color: #64748b;\r\n  text-transform: uppercase;\r\n  font-family: monospace;\r\n}\r\n\r\n.clg-row-header-cell {\r\n  background: transparent;\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: flex-end;\r\n  padding-right: 4px;\r\n}\r\n\r\n/* Row scene trigger */\r\n.clg-scene-btn {\r\n  background: #182030;\r\n  border: 1px solid #283650;\r\n  color: #93c5fd;\r\n  border-radius: 6px;\r\n  padding: 6px 10px;\r\n  font-size: 11.5px;\r\n  font-weight: 600;\r\n  cursor: pointer;\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 6px;\r\n  transition: all 0.15s ease;\r\n  white-space: nowrap;\r\n}\r\n\r\n.clg-scene-btn:hover {\r\n  background: #202d44;\r\n  border-color: #3b82f6;\r\n  color: #ffffff;\r\n}\r\n\r\n.clg-scene-btn:active {\r\n  transform: scale(0.98);\r\n}\r\n\r\n.clg-scene-icon {\r\n  font-size: 10px;\r\n}\r\n\r\n/* Slot Cell */\r\n.clg-slot-cell {\r\n  min-height: 52px;\r\n  border-radius: 6px;\r\n  border: 1px solid #1c2331;\r\n  background: #10141c;\r\n  padding: 6px 8px;\r\n  display: flex;\r\n  flex-direction: column;\r\n  justify-content: space-between;\r\n  cursor: pointer;\r\n  position: relative;\r\n  transition: all 0.12s ease;\r\n}\r\n\r\n.clg-slot-cell:hover:not(.clg-slot-empty) {\r\n  border-color: #3b82f6;\r\n  background: #151a24;\r\n}\r\n\r\n.clg-slot-cell:focus-visible {\r\n  outline: 2px solid #38bdf8;\r\n  outline-offset: 1px;\r\n}\r\n\r\n.clg-slot-empty {\r\n  border: 1px dashed #1e2636;\r\n  background: #090c10;\r\n  cursor: default;\r\n  opacity: 0.4;\r\n}\r\n\r\n/* Active playing state */\r\n.clg-slot-active {\r\n  background: #13273e !important;\r\n  border-color: #0284c7 !important;\r\n  box-shadow: 0 0 10px rgba(14, 165, 233, 0.25);\r\n}\r\n\r\n.clg-slot-active .clg-slot-label {\r\n  color: #38bdf8;\r\n  font-weight: 600;\r\n}\r\n\r\n.clg-slot-top-row {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  width: 100%;\r\n}\r\n\r\n.clg-slot-label {\r\n  font-size: 12px;\r\n  color: #cbd5e1;\r\n  font-weight: 500;\r\n  white-space: nowrap;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  text-align: left;\r\n}\r\n\r\n.clg-slot-controls {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 4px;\r\n}\r\n\r\n.clg-trigger-btn {\r\n  background: transparent;\r\n  border: none;\r\n  color: #64748b;\r\n  font-size: 11px;\r\n  cursor: pointer;\r\n  padding: 2px;\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n}\r\n\r\n.clg-slot-active .clg-trigger-btn {\r\n  color: #38bdf8;\r\n}\r\n\r\n.clg-stop-btn {\r\n  background: transparent;\r\n  border: none;\r\n  color: #ef4444;\r\n  font-size: 9px;\r\n  cursor: pointer;\r\n  padding: 2px 4px;\r\n  border-radius: 3px;\r\n  line-height: 1;\r\n}\r\n\r\n.clg-stop-btn:hover {\r\n  background: rgba(239, 68, 68, 0.2);\r\n}\r\n\r\n.clg-slot-desc {\r\n  font-size: 10px;\r\n  color: #64748b;\r\n  white-space: nowrap;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  text-align: left;\r\n}\r\n\r\n/* Status Bar Row */\r\n.clg-status-cell {\r\n  background: #11151e;\r\n  border: 1px solid #1c2331;\r\n  border-radius: 6px;\r\n  padding: 6px 8px;\r\n  font-size: 11px;\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n}\r\n\r\n.clg-status-text {\r\n  color: #94a3b8;\r\n  font-size: 11px;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n\r\n.clg-status-active {\r\n  color: #38bdf8;\r\n  font-weight: 600;\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 4px;\r\n}\r\n\r\n.clg-pulse-dot {\r\n  width: 6px;\r\n  height: 6px;\r\n  border-radius: 50%;\r\n  background-color: #0ea5e9;\r\n  display: inline-block;\r\n  box-shadow: 0 0 6px #38bdf8;\r\n}\r\n\r\n.clg-footer-toolbar {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  padding-top: 10px;\r\n  border-top: 1px solid #1e2430;\r\n  font-size: 11px;\r\n  color: #64748b;\r\n}\r\n\r\n.clg-stop-all-btn {\r\n  background: #221c22;\r\n  border: 1px solid #4a2838;\r\n  color: #f87171;\r\n  padding: 4px 10px;\r\n  border-radius: 5px;\r\n  font-size: 11.5px;\r\n  font-weight: 600;\r\n  cursor: pointer;\r\n  transition: all 0.15s ease;\r\n}\r\n\r\n.clg-stop-all-btn:hover {\r\n  background: #381c28;\r\n  border-color: #ef4444;\r\n  color: #ffffff;\r\n}\r\n",
          "language": "css",
          "description": "CSS Grid rules and dark theme variables"
        },
        {
          "id": "tokens-json",
          "name": "Design Tokens",
          "filename": "tokens.json",
          "content": "{\r\n  \"clip-launch-grid\": {\r\n    \"surface\": {\r\n      \"containerBg\": \"#0c0e12\",\r\n      \"cellBg\": \"#10141c\",\r\n      \"cellBgHover\": \"#151a24\",\r\n      \"cellBgActive\": \"#13273e\",\r\n      \"headerBg\": \"#131720\",\r\n      \"borderColor\": \"#1e2430\",\r\n      \"borderActive\": \"#0284c7\"\r\n    },\r\n    \"text\": {\r\n      \"primary\": \"#f8fafc\",\r\n      \"secondary\": \"#cbd5e1\",\r\n      \"muted\": \"#64748b\",\r\n      \"active\": \"#38bdf8\"\r\n    },\r\n    \"metrics\": {\r\n      \"cellMinHeight\": \"52px\",\r\n      \"cellRadius\": \"6px\",\r\n      \"gridGap\": \"6px\",\r\n      \"sceneColWidth\": \"140px\"\r\n    }\r\n  }\r\n}\r\n",
          "language": "json",
          "description": "Extracted semantic tokens"
        },
        {
          "id": "agent-brief",
          "name": "Agent Implementation Brief",
          "filename": "agent-brief.md",
          "content": "# Agent Implementation Brief: Clip Launch Grid\r\n\r\n## Core Mental Model\r\nUse when building multi-channel or multi-stage orchestration interfaces where:\r\n1. Channels run in parallel but can each only execute ONE task/item at a time (Mutual Exclusion).\r\n2. Sets of tasks across channels form synchronized phases or scenes (Row Trigger).\r\n3. The user needs random access to individual cells without being bound to a linear stepper.\r\n\r\n## State Representation\r\n```ts\r\ninterface GridState {\r\n  // Keyed by trackId. Value is active slotId or null.\r\n  // Mutually exclusive: changing a track's value overwrites its previous active slot.\r\n  activeTracks: Record<string, string | null>;\r\n}\r\n```\r\n\r\n## Critical Invariants\r\n- When a cell is triggered: `activeTracks[trackId] = (current === cellId) ? null : cellId`.\r\n- When a row is launched: for every track, if cell exists in row -> activate it; if not -> clear track UNLESS cell has `hasStop: false`.\r\n- Grid styling must use pure CSS Grid with `grid-template-columns: var(--scene-width) repeat(var(--tracks-count), 1fr)`.\r\n",
          "language": "markdown",
          "description": "Guidance prompt for AI coding agents"
        },
        {
          "id": "concept-html",
          "name": "HTML Concept Specimen",
          "filename": "concept.html",
          "content": "<!DOCTYPE html>\r\n<html lang=\"en\">\r\n<head>\r\n  <meta charset=\"UTF-8\">\r\n  <title>Clip Launch Grid — Concept Demonstration</title>\r\n  <style>\r\n    body {\r\n      background: #08090c;\r\n      color: #e2e8f0;\r\n      font-family: system-ui, -apple-system, sans-serif;\r\n      padding: 30px;\r\n      display: flex;\r\n      justify-content: center;\r\n    }\r\n    .grid {\r\n      display: grid;\r\n      grid-template-columns: 140px repeat(4, 150px);\r\n      gap: 6px;\r\n      background: #0f131a;\r\n      padding: 16px;\r\n      border-radius: 8px;\r\n      border: 1px solid #1e2636;\r\n    }\r\n    .header { font-size: 12px; font-weight: bold; color: #94a3b8; padding: 6px; }\r\n    .scene-btn {\r\n      background: #192233;\r\n      color: #60a5fa;\r\n      border: 1px solid #28374d;\r\n      border-radius: 4px;\r\n      padding: 8px;\r\n      font-size: 11px;\r\n      font-weight: 600;\r\n      cursor: pointer;\r\n      text-align: left;\r\n    }\r\n    .scene-btn:hover { background: #222f47; color: #fff; }\r\n    .cell {\r\n      background: #131924;\r\n      border: 1px solid #1f293d;\r\n      border-radius: 4px;\r\n      padding: 8px;\r\n      font-size: 11px;\r\n      cursor: pointer;\r\n      display: flex;\r\n      justify-content: space-between;\r\n      align-items: center;\r\n      transition: all 0.1s ease;\r\n    }\r\n    .cell:hover { border-color: #3b82f6; }\r\n    .cell.active {\r\n      background: #153354;\r\n      border-color: #0284c7;\r\n      color: #38bdf8;\r\n      box-shadow: 0 0 8px rgba(14,165,233,0.3);\r\n      font-weight: bold;\r\n    }\r\n    .empty { border: 1px dashed #242c3d; background: transparent; cursor: default; }\r\n  </style>\r\n</head>\r\n<body>\r\n  <div class=\"grid\" id=\"grid\"></div>\r\n  <script>\r\n    const tracks = ['Architect', 'Coder', 'Reviewer', 'DevOps'];\r\n    const scenes = ['01. Scaffolding', '02. Development', '03. Verification', '04. Deployment'];\r\n    const slots = {\r\n      '0:0': 'Schema Design', '1:0': 'Init Template', '2:0': 'Lint Rules',\r\n      '0:1': 'API Spec',      '1:1': 'Business Logic', '2:1': 'Unit Tests', '3:1': 'Docker Env',\r\n      '1:2': 'Refactor Patch','2:2': 'E2E Testing',    '3:2': 'CI Build',\r\n      '0:3': 'Release Notes',                          '3:3': 'Production'\r\n    };\r\n    const active = {};\r\n    const root = document.getElementById('grid');\r\n\r\n    function render() {\r\n      root.innerHTML = '<div class=\"header\">SCENE</div>' +\r\n        tracks.map(t => `<div class=\"header\">${t}</div>`).join('');\r\n\r\n      scenes.forEach((s, r) => {\r\n        root.innerHTML += `<button class=\"scene-btn\" onclick=\"launchRow(${r})\">▶ ${s}</button>`;\r\n        tracks.forEach((_, c) => {\r\n          const key = `${c}:${r}`;\r\n          const label = slots[key];\r\n          if (!label) {\r\n            root.innerHTML += '<div class=\"cell empty\"></div>';\r\n          } else {\r\n            const isActive = active[c] === key;\r\n            root.innerHTML += `<div class=\"cell ${isActive ? 'active' : ''}\" onclick=\"toggleCell(${c}, '${key}')\">\r\n              <span>${label}</span>\r\n              <span>${isActive ? '●' : '▶'}</span>\r\n            </div>`;\r\n          }\r\n        });\r\n      });\r\n    }\r\n\r\n    window.toggleCell = (c, key) => {\r\n      active[c] = active[c] === key ? null : key;\r\n      render();\r\n    };\r\n\r\n    window.launchRow = (r) => {\r\n      tracks.forEach((_, c) => {\r\n        const key = `${c}:${r}`;\r\n        if (slots[key]) active[c] = key;\r\n        else active[c] = null;\r\n      });\r\n      render();\r\n    };\r\n\r\n    render();\r\n  </script>\r\n</body>\r\n</html>\r\n",
          "language": "html",
          "description": "Semantic HTML standalone mockup"
        }
      ]
    },
    "exports": {
      "humanSpec": "available",
      "agentBrief": "available",
      "html": "available",
      "css": "available",
      "react": "available",
      "tokens": "available",
      "package": "available"
    },
    "relationships": {
      "usedByPresets": [
        "swiss-monospace",
        "tactical-hud"
      ],
      "relatedParts": [
        "persistent-statusline"
      ]
    },
    "realityTest": {
      "rating": "ACCEPT",
      "mechanismIndependent": true,
      "datasetIndependent": true,
      "worthEnteringLibrary": true,
      "notes": "在智能体流水线、设计系统混音与多幕演示中均完美成立，已通过三种真实数据集验证。"
    },
    "createdAt": "2026-10-04T12:00:00.000Z",
    "updatedAt": "2026-10-04T12:45:00.000Z"
  },
  {
    "id": "safe-triangle",
    "title": "Safe-Triangle Submenu",
    "lifecycle": "validated",
    "kind": "interaction",
    "summary": "基于光标动量与几何安全区的无缝二级子菜单交互模式。在光标与子菜单近边之间建立动态三角形命中区域，允许斜向对角线直达，彻底消除倒 L 型路径痛点与误关现象。",
    "sources": [
      {
        "id": "linear-invisible-details",
        "title": "Andreas Eldh (Linear Engineering) — Invisible Details (2020)",
        "url": "https://medium.com/linear-app/invisible-details-2ca718b41a44",
        "type": "engineering-blog",
        "primary": true,
        "notes": "原作者文章详尽阐述了欧氏距离对角线直达原理与使用 clip-path: polygon 的 DOM 实现。"
      }
    ],
    "preview": {
      "thumbnail": "data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"225\" viewBox=\"0 0 400 225\" fill=\"%23080b12\"><rect width=\"400\" height=\"225\" rx=\"8\" fill=\"%23090d16\"/><rect x=\"30\" y=\"30\" width=\"130\" height=\"165\" rx=\"6\" fill=\"%230f172a\" stroke=\"%231e293b\" stroke-width=\"1.5\"/><rect x=\"35\" y=\"70\" width=\"120\" height=\"30\" rx=\"4\" fill=\"%231e293b\" stroke=\"%2338bdf8\" stroke-width=\"1\"/><circle cx=\"95\" cy=\"85\" r=\"4\" fill=\"%23ef4444\"/><rect x=\"230\" y=\"45\" width=\"140\" height=\"140\" rx=\"6\" fill=\"%230f172a\" stroke=\"%2338bdf8\" stroke-width=\"1.5\"/><polygon points=\"95,85 230,45 230,185\" fill=\"%23ef4444\" fill-opacity=\"0.15\" stroke=\"%23ef4444\" stroke-width=\"1\" stroke-dasharray=\"4,3\"/><circle cx=\"230\" cy=\"45\" r=\"3\" fill=\"%2338bdf8\"/><circle cx=\"230\" cy=\"185\" r=\"3\" fill=\"%2338bdf8\"/><text x=\"103\" y=\"82\" fill=\"%23ef4444\" font-family=\"monospace\" font-size=\"10\">P</text><text x=\"235\" y=\"42\" fill=\"%2338bdf8\" font-family=\"monospace\" font-size=\"10\">A</text><text x=\"235\" y=\"195\" fill=\"%2338bdf8\" font-family=\"monospace\" font-size=\"10\">B</text></svg>",
      "screenshots": [
        "research/ui-parts/screenshots/safe-triangle-normal.png",
        "research/ui-parts/screenshots/safe-triangle-debug.png"
      ],
      "prototypeUrl": "research/ui-parts/lab/index.html?part=safe-triangle",
      "aspectRatio": "16:9"
    },
    "tags": [
      "menu",
      "submenu",
      "safe-area",
      "pointer",
      "geometry",
      "interaction-hook",
      "invisible-details"
    ],
    "notes": "核心机制：在光标实时坐标与子菜单近边之间建立动态三角形命中区域。生产模式完全透明隐形，对斜向直达路径宽容。",
    "design": {
      "designDNA": {
        "layout": "Invisible dynamic geometry polygon rendered between cursor and lateral sub-panel.",
        "typography": "Standard menu typography with arrow indicators for cascading parent items.",
        "color": "Production: 100% invisible (opacity 0); Debug overlay: translucent crimson rgba(239, 68, 68, 0.25).",
        "shape": "Euclidean triangle defined by cursor apex P and sub-panel near edge vertices A and B.",
        "density": "Zero visual chrome in production, pure interaction feel.",
        "motion": "Real-time mousemove position tracking with instantaneous clip-path re-computation.",
        "interaction": "Forgiving along the diagonal travel path, strict on target arrival."
      },
      "portablePrinciple": {
        "rule": "When a pointer must cross intervening non-target elements to reach a lateral sub-surface, render an ephemeral safe triangle polygon between the cursor and the target's near edge because Euclidean diagonal movement is faster and more natural than Manhattan orthogonal paths.",
        "zh": "当鼠标指针必须跨越非目标干扰区域以进入侧向展开的子面板时，在光标与目标近侧边之间生成不可见的动态安全三角形多边形，因为欧几里得对角线直达路径比沿正交网格走的曼哈顿路径更短、更自然且不易误触关闭。"
      },
      "essentialMechanisms": [
        "以光标实时位置为顶点、以子菜单近边缘为底边的动态安全三角形多边形",
        "安全区内指针事件保持子菜单开启不中断",
        "正常生产环境下安全区完全隐形不可见",
        "高度溢出保护（Height Capping / Directional Escape）"
      ],
      "optionalCharacteristics": [
        "Linear 的深色圆角设计风格与按键图标",
        "通过 40 行 React Hook 封装还是独立 Web Component",
        "关闭延迟防抖计时器"
      ],
      "useCases": [
        {
          "scenario": "Nested Command Palette / Context Menu (层级右键与上下文菜单)",
          "fit": "high",
          "notes": "最经典场景，彻底解决右键菜单二级展开常被划掉的交互缺陷"
        },
        {
          "scenario": "Mega Dropdown Navigation (复合分类悬浮导航面板)",
          "fit": "high",
          "notes": "电商或大型开发者门户多级下拉导航"
        },
        {
          "scenario": "Hover Card Preview Inspector (悬浮卡片深入检视)",
          "fit": "medium",
          "notes": "光标由触发标签移入浮动详情面板"
        }
      ]
    },
    "implementation": {
      "difficulty": "medium",
      "preferredTech": "React Hook (useSafeTriangle) + Absolute Div with clip-path: polygon",
      "implementationBasis": "使用标准 DOM + clip-path: polygon() 实现命中捕获，由浏览器硬件加速处理判定。",
      "parameters": {
        "maxVerticalSpread": {
          "value": 90,
          "unit": "px",
          "status": "derived",
          "notes": "实测发现：当子菜单高度过大时，必须钳制三角形在光标 Y 轴上下的最大扩散距离，否则会遮死相邻父级菜单项。此为实验推导参数，非普适法则。"
        }
      },
      "prototypeVariants": [
        {
          "id": "normal",
          "name": "Production Normal Mode",
          "description": "完全透明隐形，自然交互"
        },
        {
          "id": "debug",
          "name": "Debug Perspective Mode",
          "description": "渲染半透明红色几何三角区与 P/A/B 顶点"
        }
      ]
    },
    "evidence": {
      "structure": "verified",
      "behavior": "verified",
      "visual": "verified",
      "sourceCode": "observed",
      "notes": [
        "Linear 官方工程师博客清晰讲解了欧几里得距离原理、clip-path: polygon 实现方式与 DOM 结构 [Verified]",
        "maxVerticalSpread: 90px 经由 Setup Center 实测，推翻了原作者无界限大三角形的隐含假设，确认为 derived implementation parameter [Derived]"
      ]
    },
    "assets": {
      "codeAssets": [
        {
          "id": "hook-ts",
          "name": "useSafeTriangle Hook",
          "filename": "useSafeTriangle.ts",
          "content": "import { useState, useEffect, useCallback, RefObject } from \"react\";\r\n\r\nexport interface SafeTriangleOptions {\r\n  enabled?: boolean;\r\n  side?: \"right\" | \"left\";\r\n  maxVerticalSpread?: number; // Caps height of the triangle base to prevent engulfing other parent items\r\n}\r\n\r\nexport interface SafeTriangleState {\r\n  clipPath: string;\r\n  style: React.CSSProperties;\r\n  debugPoints: {\r\n    p: { x: number; y: number }; // cursor\r\n    a: { x: number; y: number }; // near edge top corner (clamped)\r\n    b: { x: number; y: number }; // near edge bottom corner (clamped)\r\n  } | null;\r\n}\r\n\r\n/**\r\n * useSafeTriangle\r\n *\r\n * Implements the Linear Safe-Triangle interaction pattern:\r\n * When moving from parent menu item to a lateral submenu, calculates a dynamic\r\n * polygon between cursor P and the submenu near-edge [A, B].\r\n */\r\nexport function useSafeTriangle(\r\n  submenuRef: RefObject<HTMLElement | null>,\r\n  options: SafeTriangleOptions = {},\r\n) {\r\n  const { enabled = true, side = \"right\", maxVerticalSpread = 100 } = options;\r\n\r\n  const [triangleState, setTriangleState] = useState<SafeTriangleState>({\r\n    clipPath: \"none\",\r\n    style: { display: \"none\" },\r\n    debugPoints: null,\r\n  });\r\n\r\n  const updateTriangle = useCallback(\r\n    (e: MouseEvent) => {\r\n      if (!enabled || !submenuRef.current) {\r\n        setTriangleState({ clipPath: \"none\", style: { display: \"none\" }, debugPoints: null });\r\n        return;\r\n      }\r\n\r\n      const rect = submenuRef.current.getBoundingClientRect();\r\n      const cursorX = e.clientX;\r\n      const cursorY = e.clientY;\r\n\r\n      // Determine near-edge X coordinate\r\n      const nearX = side === \"right\" ? rect.left : rect.right;\r\n\r\n      // Height capping: clamp triangle's base spread relative to cursor Y\r\n      // so tall submenus do not block access to sibling menu items\r\n      const nearYTop = Math.max(rect.top, cursorY - maxVerticalSpread);\r\n      const nearYBottom = Math.min(rect.bottom, cursorY + maxVerticalSpread);\r\n\r\n      // Check if cursor has already entered the submenu or is on the opposite side\r\n      const hasReachedSubmenu =\r\n        side === \"right\" ? cursorX >= rect.left : cursorX <= rect.right;\r\n\r\n      if (hasReachedSubmenu) {\r\n        // Cursor reached target: collapse safe area\r\n        setTriangleState({ clipPath: \"none\", style: { display: \"none\" }, debugPoints: null });\r\n        return;\r\n      }\r\n\r\n      // Compute bounding box containing the triangle\r\n      const minX = Math.min(cursorX, nearX);\r\n      const maxX = Math.max(cursorX, nearX);\r\n      const minY = Math.min(cursorY, nearYTop);\r\n      const maxY = Math.max(cursorY, nearYBottom);\r\n\r\n      const width = Math.max(1, maxX - minX);\r\n      const height = Math.max(1, maxY - minY);\r\n\r\n      // Coordinates relative to the bounding box (in percentages or px)\r\n      const relPx = (cursorX - minX);\r\n      const relPy = (cursorY - minY);\r\n      const relAx = (nearX - minX);\r\n      const relAy = (nearYTop - minY);\r\n      const relBx = (nearX - minX);\r\n      const relBy = (nearYBottom - minY);\r\n\r\n      const clipPath = `polygon(${relPx}px ${relPy}px, ${relAx}px ${relAy}px, ${relBx}px ${relBy}px)`;\r\n\r\n      setTriangleState({\r\n        clipPath,\r\n        style: {\r\n          position: \"fixed\",\r\n          left: `${minX}px`,\r\n          top: `${minY}px`,\r\n          width: `${width}px`,\r\n          height: `${height}px`,\r\n          pointerEvents: \"auto\", // Essential: captures pointer movement\r\n          zIndex: 9999,\r\n          clipPath,\r\n        },\r\n        debugPoints: {\r\n          p: { x: cursorX, y: cursorY },\r\n          a: { x: nearX, y: nearYTop },\r\n          b: { x: nearX, y: nearYBottom },\r\n        },\r\n      });\r\n    },\r\n    [enabled, side, maxVerticalSpread, submenuRef],\r\n  );\r\n\r\n  useEffect(() => {\r\n    if (!enabled) return;\r\n\r\n    const handlePointerMove = (e: MouseEvent) => {\r\n      updateTriangle(e);\r\n    };\r\n\r\n    window.addEventListener(\"pointermove\", handlePointerMove);\r\n    return () => {\r\n      window.removeEventListener(\"pointermove\", handlePointerMove);\r\n    };\r\n  }, [enabled, updateTriangle]);\r\n\r\n  return triangleState;\r\n}\r\n",
          "language": "typescript",
          "description": "Reusable React Hook generating dynamic polygon clipping coordinates"
        },
        {
          "id": "component-tsx",
          "name": "SafeTriangleMenu Component",
          "filename": "SafeTriangleMenu.tsx",
          "content": "import React, { useState, useRef } from \"react\";\r\nimport { useSafeTriangle } from \"./useSafeTriangle\";\r\nimport \"./safe-triangle.css\";\r\n\r\ninterface MenuItem {\r\n  id: string;\r\n  label: string;\r\n  hasSubmenu?: boolean;\r\n  submenuItems?: { id: string; label: string; badge?: string }[];\r\n}\r\n\r\nconst MENU_DATA: MenuItem[] = [\r\n  { id: \"git\", label: \"Git Workflow\" },\r\n  {\r\n    id: \"engines\",\r\n    label: \"Development Engines\",\r\n    hasSubmenu: true,\r\n    submenuItems: [\r\n      { id: \"node\", label: \"Node.js 22 LTS\", badge: \"Runtime\" },\r\n      { id: \"rust\", label: \"Rust & Cargo\", badge: \"Toolchain\" },\r\n      { id: \"python\", label: \"Python 3.12 (uv)\", badge: \"Env\" },\r\n      { id: \"go\", label: \"Go 1.23\", badge: \"Compiler\" },\r\n      { id: \"docker\", label: \"Docker Desktop\", badge: \"Container\" },\r\n    ],\r\n  },\r\n  {\r\n    id: \"tools\",\r\n    label: \"Environment Shells\",\r\n    hasSubmenu: true,\r\n    submenuItems: [\r\n      { id: \"wsl\", label: \"WSL 2 Ubuntu\", badge: \"Linux\" },\r\n      { id: \"git-bash\", label: \"Git Bash\", badge: \"POSIX\" },\r\n      { id: \"pwsh\", label: \"PowerShell 7\", badge: \"Shell\" },\r\n      { id: \"wt\", label: \"Windows Terminal\", badge: \"Host\" },\r\n    ],\r\n  },\r\n  { id: \"packages\", label: \"Package Managers\" },\r\n  { id: \"settings\", label: \"Preferences & Tokens\" },\r\n];\r\n\r\nexport interface SafeTriangleMenuProps {\r\n  initialSide?: \"right\" | \"left\";\r\n  initialDebug?: boolean;\r\n  initialCapHeight?: boolean;\r\n}\r\n\r\nexport function SafeTriangleMenu({\r\n  initialSide = \"right\",\r\n  initialDebug = false,\r\n  initialCapHeight = true,\r\n}: SafeTriangleMenuProps) {\r\n  const [side, setSide] = useState<\"right\" | \"left\">(initialSide);\r\n  const [debug, setDebug] = useState<boolean>(initialDebug);\r\n  const [capHeight, setCapHeight] = useState<boolean>(initialCapHeight);\r\n  const [activeParentId, setActiveParentId] = useState<string | null>(\"engines\");\r\n  const [selectedLeaf, setSelectedLeaf] = useState<string | null>(null);\r\n\r\n  const submenuRef = useRef<HTMLDivElement>(null);\r\n\r\n  const activeParent = MENU_DATA.find((m) => m.id === activeParentId);\r\n  const hasActiveSubmenu = Boolean(activeParent?.hasSubmenu && activeParent.submenuItems);\r\n\r\n  // Hook calculates dynamic safe polygon\r\n  const { clipPath, style, debugPoints } = useSafeTriangle(submenuRef, {\r\n    enabled: hasActiveSubmenu,\r\n    side,\r\n    maxVerticalSpread: capHeight ? 90 : 400,\r\n  });\r\n\r\n  const handleParentMouseEnter = (item: MenuItem) => {\r\n    setActiveParentId(item.id);\r\n  };\r\n\r\n  const handleMenuMouseLeave = () => {\r\n    // If not in safe zone, allow closing or keep last\r\n    // In actual menu, leaving container closes submenu\r\n  };\r\n\r\n  return (\r\n    <div className=\"stm-container\">\r\n      {/* Top Controls Toolbar */}\r\n      <div className=\"stm-toolbar\">\r\n        <div className=\"stm-title-group\">\r\n          <h2>Linear Safe-Triangle Submenu Prototype</h2>\r\n          <p>\r\n            对角线几何安全区：光标斜向划入子菜单时绝不意外关闭 │ 当前方向：{side === \"right\" ? \"右侧展开\" : \"左侧展开\"}\r\n          </p>\r\n        </div>\r\n\r\n        <div className=\"stm-controls\">\r\n          <button\r\n            type=\"button\"\r\n            className={`stm-toggle-btn ${side === \"right\" ? \"active\" : \"\"}`}\r\n            onClick={() => setSide(\"right\")}\r\n          >\r\n            右侧展开 (Right)\r\n          </button>\r\n          <button\r\n            type=\"button\"\r\n            className={`stm-toggle-btn ${side === \"left\" ? \"active\" : \"\"}`}\r\n            onClick={() => setSide(\"left\")}\r\n          >\r\n            左侧展开 (Left)\r\n          </button>\r\n          <button\r\n            type=\"button\"\r\n            className={`stm-toggle-btn ${capHeight ? \"active\" : \"\"}`}\r\n            onClick={() => setCapHeight((prev) => !prev)}\r\n            title=\"限制三角形底边最大高度，避免遮挡邻近菜单项\"\r\n          >\r\n            高度防遮挡: {capHeight ? \"开启 (Cap 90px)\" : \"全高 (Uncapped)\"}\r\n          </button>\r\n          <button\r\n            type=\"button\"\r\n            className={`stm-toggle-btn ${debug ? \"debug-active\" : \"\"}`}\r\n            onClick={() => setDebug((prev) => !prev)}\r\n          >\r\n            {debug ? \"● 隐藏三角区\" : \"○ 调试模式 (透视三角区)\"}\r\n          </button>\r\n        </div>\r\n      </div>\r\n\r\n      {/* Stage Area */}\r\n      <div className=\"stm-stage\">\r\n        <div className=\"stm-menu-wrapper\" onMouseLeave={handleMenuMouseLeave}>\r\n          {/* Primary Parent Menu */}\r\n          <div className=\"stm-menu-card\">\r\n            <div className=\"stm-menu-header\">Developer Tools</div>\r\n            {MENU_DATA.map((item) => {\r\n              const isItemActive = activeParentId === item.id;\r\n              return (\r\n                <div\r\n                  key={item.id}\r\n                  className={`stm-menu-item ${isItemActive ? \"active\" : \"\"}`}\r\n                  onMouseEnter={() => handleParentMouseEnter(item)}\r\n                  onClick={() => {\r\n                    if (!item.hasSubmenu) setSelectedLeaf(item.label);\r\n                  }}\r\n                >\r\n                  <span>{item.label}</span>\r\n                  {item.hasSubmenu && (\r\n                    <span className=\"stm-menu-arrow\">\r\n                      {side === \"right\" ? \"›\" : \"‹\"}\r\n                    </span>\r\n                  )}\r\n                </div>\r\n              );\r\n            })}\r\n          </div>\r\n\r\n          {/* Submenu Floating Card */}\r\n          {hasActiveSubmenu && (\r\n            <div\r\n              ref={submenuRef}\r\n              className={`stm-submenu-card ${side === \"right\" ? \"on-right\" : \"on-left\"}`}\r\n            >\r\n              <div className=\"stm-menu-header\">{activeParent?.label}</div>\r\n              {activeParent?.submenuItems?.map((sub) => (\r\n                <div\r\n                  key={sub.id}\r\n                  className=\"stm-submenu-item\"\r\n                  onClick={() => setSelectedLeaf(`${activeParent.label} → ${sub.label}`)}\r\n                >\r\n                  <span>{sub.label}</span>\r\n                  {sub.badge && <span className=\"stm-badge\">{sub.badge}</span>}\r\n                </div>\r\n              ))}\r\n            </div>\r\n          )}\r\n\r\n          {/* Invisible Safe Triangle Overlay Element */}\r\n          {hasActiveSubmenu && (\r\n            <div\r\n              className={`stm-safe-area-overlay ${debug ? \"debug-mode\" : \"\"}`}\r\n              style={style}\r\n              aria-hidden=\"true\"\r\n            />\r\n          )}\r\n\r\n          {/* Debug Coordinate Markers */}\r\n          {debug && debugPoints && (\r\n            <>\r\n              <div\r\n                className=\"stm-debug-marker point-p\"\r\n                style={{ left: `${debugPoints.p.x}px`, top: `${debugPoints.p.y}px` }}\r\n                title=\"P: Cursor point\"\r\n              />\r\n              <div\r\n                className=\"stm-debug-marker point-a\"\r\n                style={{ left: `${debugPoints.a.x}px`, top: `${debugPoints.a.y}px` }}\r\n                title=\"A: Top near corner\"\r\n              />\r\n              <div\r\n                className=\"stm-debug-marker point-b\"\r\n                style={{ left: `${debugPoints.b.x}px`, top: `${debugPoints.b.y}px` }}\r\n                title=\"B: Bottom near corner\"\r\n              />\r\n            </>\r\n          )}\r\n        </div>\r\n      </div>\r\n\r\n      {/* Explainer Footer */}\r\n      <div className=\"stm-explainer\">\r\n        <div>\r\n          <strong>交互测试提示：</strong> 从「Development Engines」向右下方斜向移动鼠标直奔「Docker Desktop」。\r\n          在普通菜单中，光标经过下方「Environment Shells」上方时子菜单会瞬间关闭；\r\n          在启用 Safe Triangle 后，不可见的几何多边形捕捉了光标轨迹，平滑维持子菜单开放。\r\n        </div>\r\n        {selectedLeaf && (\r\n          <div style={{ marginTop: \"6px\", color: \"#38bdf8\" }}>\r\n            ✓ 当前点击触发目标：{selectedLeaf}\r\n          </div>\r\n        )}\r\n      </div>\r\n    </div>\r\n  );\r\n}\r\n",
          "language": "tsx",
          "description": "Demo cascading menu with debug perspective switch"
        },
        {
          "id": "styles-css",
          "name": "Menu Styles",
          "filename": "safe-triangle.css",
          "content": "/**\r\n * Neutral CSS for Safe-Triangle Submenu Prototype\r\n */\r\n\r\n.stm-container {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 20px;\r\n  background-color: #0c0e12;\r\n  color: #e2e8f0;\r\n  padding: 24px;\r\n  border-radius: 10px;\r\n  border: 1px solid #1e2430;\r\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\r\n  user-select: none;\r\n  max-width: 860px;\r\n  margin: 0 auto;\r\n}\r\n\r\n.stm-toolbar {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  flex-wrap: wrap;\r\n  gap: 12px;\r\n  border-bottom: 1px solid #1e2430;\r\n  padding-bottom: 14px;\r\n}\r\n\r\n.stm-title-group h2 {\r\n  font-size: 16px;\r\n  font-weight: 700;\r\n  color: #f8fafc;\r\n  margin: 0;\r\n}\r\n\r\n.stm-title-group p {\r\n  font-size: 12px;\r\n  color: #94a3b8;\r\n  margin: 2px 0 0 0;\r\n}\r\n\r\n.stm-controls {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 10px;\r\n}\r\n\r\n.stm-toggle-btn {\r\n  background: #181d28;\r\n  border: 1px solid #283347;\r\n  color: #94a3b8;\r\n  padding: 5px 12px;\r\n  font-size: 12px;\r\n  border-radius: 6px;\r\n  cursor: pointer;\r\n  transition: all 0.15s ease;\r\n}\r\n\r\n.stm-toggle-btn:hover {\r\n  background: #232a3b;\r\n  color: #f1f5f9;\r\n}\r\n\r\n.stm-toggle-btn.active {\r\n  background: #2563eb;\r\n  border-color: #3b82f6;\r\n  color: #ffffff;\r\n  font-weight: 600;\r\n}\r\n\r\n.stm-toggle-btn.debug-active {\r\n  background: #dc2626;\r\n  border-color: #ef4444;\r\n  color: #ffffff;\r\n  font-weight: 600;\r\n}\r\n\r\n/* Stage Area where Menu lives */\r\n.stm-stage {\r\n  min-height: 380px;\r\n  background: #090b0f;\r\n  border: 1px dashed #1e2533;\r\n  border-radius: 8px;\r\n  display: flex;\r\n  align-items: flex-start;\r\n  justify-content: center;\r\n  padding: 40px;\r\n  position: relative;\r\n}\r\n\r\n.stm-menu-wrapper {\r\n  position: relative;\r\n  display: inline-block;\r\n}\r\n\r\n/* Primary Menu Card */\r\n.stm-menu-card {\r\n  width: 220px;\r\n  background: #141822;\r\n  border: 1px solid #242c3d;\r\n  border-radius: 8px;\r\n  padding: 6px;\r\n  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 2px;\r\n  z-index: 50;\r\n  position: relative;\r\n}\r\n\r\n.stm-menu-header {\r\n  font-size: 10.5px;\r\n  font-weight: 700;\r\n  text-transform: uppercase;\r\n  color: #64748b;\r\n  padding: 6px 8px 4px 8px;\r\n  letter-spacing: 0.05em;\r\n}\r\n\r\n.stm-menu-item {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  padding: 8px 10px;\r\n  font-size: 13px;\r\n  color: #cbd5e1;\r\n  border-radius: 5px;\r\n  cursor: pointer;\r\n  transition: background 0.1s ease, color 0.1s ease;\r\n  position: relative;\r\n}\r\n\r\n.stm-menu-item:hover,\r\n.stm-menu-item.active {\r\n  background: #1e2536;\r\n  color: #ffffff;\r\n}\r\n\r\n.stm-menu-item.active {\r\n  font-weight: 600;\r\n}\r\n\r\n.stm-menu-arrow {\r\n  font-size: 11px;\r\n  color: #64748b;\r\n}\r\n\r\n.stm-menu-item:hover .stm-menu-arrow,\r\n.stm-menu-item.active .stm-menu-arrow {\r\n  color: #38bdf8;\r\n}\r\n\r\n/* Submenu Floating Card */\r\n.stm-submenu-card {\r\n  position: absolute;\r\n  top: 0;\r\n  width: 210px;\r\n  background: #161c28;\r\n  border: 1px solid #28354c;\r\n  border-radius: 8px;\r\n  padding: 6px;\r\n  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 2px;\r\n  z-index: 60;\r\n  animation: stmFadeIn 0.12s ease-out;\r\n}\r\n\r\n.stm-submenu-card.on-right {\r\n  left: calc(100% + 8px);\r\n}\r\n\r\n.stm-submenu-card.on-left {\r\n  right: calc(100% + 8px);\r\n}\r\n\r\n@keyframes stmFadeIn {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateY(2px);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateY(0);\r\n  }\r\n}\r\n\r\n.stm-submenu-item {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  padding: 7px 10px;\r\n  font-size: 12.5px;\r\n  color: #cbd5e1;\r\n  border-radius: 5px;\r\n  cursor: pointer;\r\n}\r\n\r\n.stm-submenu-item:hover {\r\n  background: #2563eb;\r\n  color: #ffffff;\r\n}\r\n\r\n.stm-badge {\r\n  font-size: 10px;\r\n  background: #10141d;\r\n  color: #94a3b8;\r\n  padding: 1px 6px;\r\n  border-radius: 4px;\r\n  border: 1px solid #222c3d;\r\n}\r\n\r\n/* Safe Triangle overlay */\r\n.stm-safe-area-overlay {\r\n  /* In normal mode: fully invisible */\r\n  opacity: 0;\r\n  pointer-events: auto;\r\n}\r\n\r\n.stm-safe-area-overlay.debug-mode {\r\n  opacity: 0.85;\r\n  background: rgba(239, 68, 68, 0.28);\r\n  border: 1px dashed rgba(239, 68, 68, 0.8);\r\n  box-shadow: 0 0 15px rgba(239, 68, 68, 0.3);\r\n}\r\n\r\n/* Visual debug points */\r\n.stm-debug-marker {\r\n  position: fixed;\r\n  width: 8px;\r\n  height: 8px;\r\n  border-radius: 50%;\r\n  transform: translate(-50%, -50%);\r\n  pointer-events: none;\r\n  z-index: 10000;\r\n}\r\n\r\n.stm-debug-marker.point-p {\r\n  background: #38bdf8;\r\n  box-shadow: 0 0 8px #38bdf8;\r\n}\r\n\r\n.stm-debug-marker.point-a {\r\n  background: #ef4444;\r\n  box-shadow: 0 0 8px #ef4444;\r\n}\r\n\r\n.stm-debug-marker.point-b {\r\n  background: #f59e0b;\r\n  box-shadow: 0 0 8px #f59e0b;\r\n}\r\n\r\n/* Explainer Footer */\r\n.stm-explainer {\r\n  font-size: 11.5px;\r\n  color: #94a3b8;\r\n  line-height: 1.6;\r\n  border-top: 1px solid #1e2430;\r\n  padding-top: 12px;\r\n}\r\n",
          "language": "css",
          "description": "Menu surface styles and debug triangle visualizers"
        },
        {
          "id": "tokens-json",
          "name": "Design Tokens",
          "filename": "tokens.json",
          "content": "{\r\n  \"safe-triangle\": {\r\n    \"geometry\": {\r\n      \"maxVerticalSpread\": \"90px\",\r\n      \"defaultSubmenuOffset\": \"8px\",\r\n      \"zIndex\": 9999\r\n    },\r\n    \"debug\": {\r\n      \"fill\": \"rgba(239, 68, 68, 0.28)\",\r\n      \"stroke\": \"rgba(239, 68, 68, 0.8)\",\r\n      \"markerSize\": \"8px\",\r\n      \"pointPColor\": \"#38bdf8\",\r\n      \"pointABColor\": \"#ef4444\"\r\n    }\r\n  }\r\n}\r\n",
          "language": "json",
          "description": "Extracted semantic tokens"
        },
        {
          "id": "agent-brief",
          "name": "Agent Implementation Brief",
          "filename": "agent-brief.md",
          "content": "# Agent Implementation Brief: Safe-Triangle Submenu\r\n\r\n## Core Mental Model\r\nUse when building cascading context menus, mega menus, or flyouts where diagonal mouse movement from parent to submenu causes annoying premature closure due to crossing intervening elements.\r\n\r\n## Algorithm & Architecture\r\n1. **P-A-B Points**:\r\n   - Point P: `(e.clientX, e.clientY)`\r\n   - Point A: `(nearEdgeX, Math.max(submenu.top, P.y - maxSpread))`\r\n   - Point B: `(nearEdgeX, Math.min(submenu.bottom, P.y + maxSpread))`\r\n2. **DOM Representation**:\r\n   - A single `div` element with `position: fixed`, bounding box covering `min(P, A, B)` to `max(P, A, B)`.\r\n   - `clipPath: polygon(P, A, B)` mapped relative to the bounding box.\r\n   - `pointer-events: auto` to capture cursor hovering while moving toward the submenu.\r\n3. **Height Capping**:\r\n   - `maxSpread` (e.g. 90px) prevents a tall submenu from casting a massive triangular shadow over the entire parent menu list, allowing intentional vertical navigation to adjacent items.\r\n",
          "language": "markdown",
          "description": "Guidance prompt for AI coding agents"
        },
        {
          "id": "concept-html",
          "name": "HTML Concept Specimen",
          "filename": "concept.html",
          "content": "<!DOCTYPE html>\r\n<html lang=\"en\">\r\n<head>\r\n  <meta charset=\"UTF-8\">\r\n  <title>Safe-Triangle Submenu — Concept Demonstration</title>\r\n  <style>\r\n    body {\r\n      background: #090b0f;\r\n      color: #e2e8f0;\r\n      font-family: system-ui, -apple-system, sans-serif;\r\n      padding: 40px;\r\n      display: flex;\r\n      flex-direction: column;\r\n      align-items: center;\r\n      user-select: none;\r\n    }\r\n    .controls { margin-bottom: 24px; display: flex; gap: 8px; }\r\n    button {\r\n      background: #181d28;\r\n      border: 1px solid #283347;\r\n      color: #cbd5e1;\r\n      padding: 6px 12px;\r\n      border-radius: 6px;\r\n      cursor: pointer;\r\n      font-size: 12px;\r\n    }\r\n    button.active { background: #2563eb; color: #fff; font-weight: bold; }\r\n    .menu-container { position: relative; }\r\n    .menu {\r\n      width: 200px;\r\n      background: #141822;\r\n      border: 1px solid #242c3d;\r\n      border-radius: 8px;\r\n      padding: 6px;\r\n    }\r\n    .item {\r\n      padding: 8px 10px;\r\n      border-radius: 4px;\r\n      font-size: 13px;\r\n      cursor: pointer;\r\n      display: flex;\r\n      justify-content: space-between;\r\n    }\r\n    .item:hover, .item.active { background: #1e2536; color: #fff; }\r\n    .submenu {\r\n      position: absolute;\r\n      top: 0;\r\n      left: calc(100% + 8px);\r\n      width: 180px;\r\n      background: #161c28;\r\n      border: 1px solid #28354c;\r\n      border-radius: 8px;\r\n      padding: 6px;\r\n      box-shadow: 0 10px 25px rgba(0,0,0,0.5);\r\n    }\r\n    .submenu.on-left { left: auto; right: calc(100% + 8px); }\r\n    .safe-triangle {\r\n      position: fixed;\r\n      pointer-events: auto;\r\n      z-index: 999;\r\n      background: transparent;\r\n    }\r\n    .safe-triangle.debug {\r\n      background: rgba(239, 68, 68, 0.25);\r\n      border: 1px dashed #ef4444;\r\n    }\r\n  </style>\r\n</head>\r\n<body>\r\n  <div class=\"controls\">\r\n    <button id=\"btn-side\" onclick=\"toggleSide()\">Toggle Side (Right)</button>\r\n    <button id=\"btn-debug\" onclick=\"toggleDebug()\">Debug Polygon: OFF</button>\r\n  </div>\r\n\r\n  <div class=\"menu-container\" id=\"container\">\r\n    <div class=\"menu\">\r\n      <div class=\"item\" onmouseenter=\"setSubmenu(null)\">Git Workflow</div>\r\n      <div class=\"item active\" id=\"trigger-item\" onmouseenter=\"setSubmenu('engines')\">\r\n        <span>Dev Engines</span><span>›</span>\r\n      </div>\r\n      <div class=\"item\" onmouseenter=\"setSubmenu(null)\">Environment Tools</div>\r\n      <div class=\"item\" onmouseenter=\"setSubmenu(null)\">Package Managers</div>\r\n      <div class=\"item\" onmouseenter=\"setSubmenu(null)\">Preferences</div>\r\n    </div>\r\n\r\n    <div class=\"submenu\" id=\"submenu\">\r\n      <div class=\"item\">Node.js 22 LTS</div>\r\n      <div class=\"item\">Rust & Cargo</div>\r\n      <div class=\"item\">Python 3.12 (uv)</div>\r\n      <div class=\"item\">Docker Engine</div>\r\n    </div>\r\n  </div>\r\n\r\n  <div id=\"safe-area\" class=\"safe-triangle\"></div>\r\n\r\n  <script>\r\n    let side = 'right';\r\n    let debug = false;\r\n    let activeSubmenu = 'engines';\r\n\r\n    const submenuEl = document.getElementById('submenu');\r\n    const safeAreaEl = document.getElementById('safe-area');\r\n    const btnSide = document.getElementById('btn-side');\r\n    const btnDebug = document.getElementById('btn-debug');\r\n\r\n    window.toggleSide = () => {\r\n      side = side === 'right' ? 'left' : 'right';\r\n      submenuEl.className = 'submenu ' + (side === 'left' ? 'on-left' : '');\r\n      btnSide.innerText = `Toggle Side (${side === 'right' ? 'Right' : 'Left'})`;\r\n    };\r\n\r\n    window.toggleDebug = () => {\r\n      debug = !debug;\r\n      btnDebug.innerText = `Debug Polygon: ${debug ? 'ON' : 'OFF'}`;\r\n      btnDebug.className = debug ? 'active' : '';\r\n      safeAreaEl.className = 'safe-triangle ' + (debug ? 'debug' : '');\r\n    };\r\n\r\n    window.setSubmenu = (id) => {\r\n      activeSubmenu = id;\r\n      submenuEl.style.display = id ? 'block' : 'none';\r\n      if (!id) safeAreaEl.style.display = 'none';\r\n    };\r\n\r\n    window.addEventListener('pointermove', (e) => {\r\n      if (!activeSubmenu) return;\r\n      const rect = submenuEl.getBoundingClientRect();\r\n      const nearX = side === 'right' ? rect.left : rect.right;\r\n\r\n      const cursorX = e.clientX;\r\n      const cursorY = e.clientY;\r\n\r\n      if ((side === 'right' && cursorX >= rect.left) || (side === 'left' && cursorX <= rect.right)) {\r\n        safeAreaEl.style.display = 'none';\r\n        return;\r\n      }\r\n\r\n      const spread = 90; // Height cap\r\n      const topY = Math.max(rect.top, cursorY - spread);\r\n      const bottomY = Math.min(rect.bottom, cursorY + spread);\r\n\r\n      const minX = Math.min(cursorX, nearX);\r\n      const maxX = Math.max(cursorX, nearX);\r\n      const minY = Math.min(cursorY, topY);\r\n      const maxY = Math.max(cursorY, bottomY);\r\n\r\n      safeAreaEl.style.left = minX + 'px';\r\n      safeAreaEl.style.top = minY + 'px';\r\n      safeAreaEl.style.width = (maxX - minX) + 'px';\r\n      safeAreaEl.style.height = (maxY - minY) + 'px';\r\n\r\n      const pX = cursorX - minX, pY = cursorY - minY;\r\n      const aX = nearX - minX, aY = topY - minY;\r\n      const bX = nearX - minX, bY = bottomY - minY;\r\n\r\n      safeAreaEl.style.clipPath = `polygon(${pX}px ${pY}px, ${aX}px ${aY}px, ${bX}px ${bY}px)`;\r\n      safeAreaEl.style.display = 'block';\r\n    });\r\n  </script>\r\n</body>\r\n</html>\r\n",
          "language": "html",
          "description": "Semantic HTML standalone mockup"
        }
      ]
    },
    "exports": {
      "humanSpec": "available",
      "agentBrief": "available",
      "html": "available",
      "css": "available",
      "react": "available",
      "interactionHook": "available",
      "tokens": "available",
      "package": "available"
    },
    "relationships": {
      "usedByPresets": [
        "linear-style",
        "command-palette"
      ],
      "relatedParts": []
    },
    "realityTest": {
      "rating": "ACCEPT",
      "mechanismIndependent": true,
      "datasetIndependent": true,
      "worthEnteringLibrary": true,
      "notes": "零视觉侵入，纯物理体验收益，已解决高子菜单遮盖边缘缺陷，强烈推荐收录。"
    },
    "createdAt": "2026-10-04T12:00:00.000Z",
    "updatedAt": "2026-10-04T12:45:00.000Z"
  },
  {
    "id": "persistent-statusline",
    "title": "Persistent Statusline",
    "lifecycle": "validated",
    "kind": "status",
    "summary": "常驻于操作区底部的低侵入式状态腰带：以彩色锚点+仪表盘为视觉核心，搭载自收敛的同构事件折叠、条件显隐活动行与绝对时间过期指示。",
    "sources": [
      {
        "id": "claude-hud-repo",
        "title": "jarrodwatts/claude-hud (MIT)",
        "url": "https://github.com/jarrodwatts/claude-hud",
        "type": "repository",
        "primary": true,
        "notes": "一手 README 与 CLAUDE.md 定义了锚点行、活动行、事件离散刷新与绝对到期时间设计规范。"
      }
    ],
    "preview": {
      "thumbnail": "data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"225\" viewBox=\"0 0 400 225\" fill=\"%23080b12\"><rect width=\"400\" height=\"225\" rx=\"8\" fill=\"%23090d16\"/><g transform=\"translate(20, 65)\"><rect width=\"360\" height=\"95\" rx=\"6\" fill=\"%230f172a\" stroke=\"%231e293b\" stroke-width=\"1\"/><rect x=\"12\" y=\"14\" width=\"86\" height=\"20\" rx=\"3\" fill=\"%2310b981\" fill-opacity=\"0.2\" stroke=\"%2310b981\"/><text x=\"18\" y=\"28\" fill=\"%2310b981\" font-family=\"monospace\" font-size=\"10\" font-weight=\"bold\">DeepSeek-V3</text><rect x=\"110\" y=\"16\" width=\"100\" height=\"16\" rx=\"2\" fill=\"%231e293b\"/><rect x=\"110\" y=\"16\" width=\"68\" height=\"16\" rx=\"2\" fill=\"%2310b981\"/><text x=\"130\" y=\"28\" fill=\"%23090d16\" font-family=\"monospace\" font-size=\"9\" font-weight=\"bold\">68%</text><text x=\"222\" y=\"28\" fill=\"%2364748b\" font-family=\"monospace\" font-size=\"10\">8 rules │ 4 MCPs</text><text x=\"14\" y=\"58\" fill=\"%230ea5e9\" font-family=\"monospace\" font-size=\"11\">✓ Read ×4</text><text x=\"100\" y=\"58\" fill=\"%230ea5e9\" font-family=\"monospace\" font-size=\"11\">✓ Grep ×2</text><text x=\"185\" y=\"58\" fill=\"%23f59e0b\" font-family=\"monospace\" font-size=\"11\">◐ Edit: types.ts</text><text x=\"14\" y=\"80\" fill=\"%2394a3b8\" font-family=\"monospace\" font-size=\"10\">◐ Research (14s) │ Todos: 2/3</text><rect x=\"260\" y=\"70\" width=\"88\" height=\"16\" rx=\"2\" fill=\"%231e293b\"/><text x=\"266\" y=\"82\" fill=\"%23f43f5e\" font-family=\"monospace\" font-size=\"9\" font-weight=\"bold\">expires 21:45</text></g></svg>",
      "screenshots": [
        "research/ui-parts/screenshots/statusline-agent.png",
        "research/ui-parts/screenshots/statusline-build.png",
        "research/ui-parts/screenshots/statusline-compact.png"
      ],
      "prototypeUrl": "research/ui-parts/lab/index.html?part=statusline",
      "aspectRatio": "16:9"
    },
    "tags": [
      "statusline",
      "hud",
      "status-belt",
      "telemetry",
      "meter",
      "event-collapsing",
      "absolute-expiry"
    ],
    "notes": "核心机制：低侵入状态腰带，彩色锚点+阈值仪表条，同构事件折叠，动态活动行，以及基于绝对物理钟表时刻的防伪到期指示。",
    "design": {
      "designDNA": {
        "layout": "Low-profile horizontal status belt fixed at workspace edge with semantic column grouping.",
        "typography": "Dense tabular monospace typography with subtle dim delimiters (│).",
        "color": "Threshold state colors: ok (emerald #10b981), warn (amber #f59e0b), crit (rose #ef4444).",
        "shape": "Miniature badge pill + horizontal gradient fill meter.",
        "density": "Ultra-high information density without competing with viewport content.",
        "motion": "Static between events, discrete render updates upon system notifications.",
        "interaction": "Read-only situational awareness belt; presence and absence of activity rows convey state."
      },
      "portablePrinciple": {
        "rule": "When a persistent status belt repaints discretely on system events rather than continuous frame polling, render time-sensitive limits as absolute clock timestamps rather than relative countdowns because wall-clock truth survives stale renders.",
        "zh": "当常驻状态带依靠系统事件离散触发重绘而非连续逐帧轮询时，将时效性限制渲染为绝对钟表时刻（如 expires 21:40）而非相对倒计时（如 3m 24s），因为即使界面长期停止刷新，绝对时间在现实世界中依然保真。"
      },
      "essentialMechanisms": [
        "常驻于输入或工作区边缘，保持低视觉侵入性",
        "彩色视觉锚点（徽章 + 阈值色彩仪表条）",
        "阈值状态色转换（正常绿 → 警告黄 → 临界红）",
        "同类事件智能折叠计数（如 Read ×4）",
        "活动行动态存在性（仅在存在活跃事务时才占用高度）",
        "绝对钟表到期时间原则（absolute expiry timestamp for stale/event-driven surfaces）",
        "双排版形态（Compact 单行与 Expanded 多行）"
      ],
      "optionalCharacteristics": [
        "Claude / Anthropic 品牌徽章与专有术语",
        "终端等宽字符 ASCII 纯文本渲染，还是现代 Web CSS 渐变",
        "Git 分支与仓库状态展示",
        "具体的阈值数值划分（如 70%、85%）"
      ],
      "useCases": [
        {
          "scenario": "AI Agent Session Console (智能体执行上下文监视带)",
          "fit": "high",
          "notes": "上下文占用、活动工具、子智能体与待办完成度一览无余"
        },
        {
          "scenario": "Long-running Build & Test Pipeline (构建与测试流水线监控)",
          "fit": "high",
          "notes": "资源消耗、编译模块、运行测试与产物生命周期"
        },
        {
          "scenario": "Dev Server / Tunnel Monitor",
          "fit": "medium"
        }
      ]
    },
    "implementation": {
      "difficulty": "low",
      "preferredTech": "Semantic Flex/Grid + CSS Gradient Meter + Tabular Monospace Typography",
      "implementationBasis": "纯 React 状态驱动与 Semantic CSS，无需逐帧轮询，事件驱动轻量更新。",
      "prototypeVariants": [
        {
          "id": "agent",
          "name": "AI Agent Session Runtime",
          "description": "DeepSeek-V3 / Context 68% / Read ×4 / expires 21:45"
        },
        {
          "id": "build",
          "name": "Generic Build Pipeline Runtime",
          "description": "Cargo x64 / Memory 88% Warning / rustc ×8 / expires 23:59"
        },
        {
          "id": "compact",
          "name": "Single-line Compact Mode",
          "description": "极简单行模式"
        }
      ]
    },
    "evidence": {
      "structure": "verified",
      "behavior": "verified",
      "visual": "observed",
      "sourceCode": "unread",
      "notes": [
        "官方 README 与 CLAUDE.md 完整定义 Anchor Line、Activity Line 与各元素堆叠优先级 [Verified]",
        "官方明确声明仅在系统事件离散触发重绘、绝对时间防伪设计、同类事件合并原则 [Verified]",
        "直接比对官方发布的高保真截图（深色终端 macOS 真实运行捕获）[Observed]"
      ]
    },
    "assets": {
      "codeAssets": [
        {
          "id": "component-tsx",
          "name": "PersistentStatusline Component",
          "filename": "PersistentStatusline.tsx",
          "content": "import React, { useState } from \"react\";\r\nimport {\r\n  type StatuslineDataset,\r\n  AGENT_RUNTIME_DATASET,\r\n  BUILD_RUNTIME_DATASET,\r\n} from \"./datasets\";\r\nimport \"./statusline.css\";\r\n\r\nexport interface PersistentStatuslineProps {\r\n  initialDataset?: \"agent\" | \"build\";\r\n  initialMode?: \"expanded\" | \"compact\";\r\n}\r\n\r\nexport function PersistentStatusline({\r\n  initialDataset = \"agent\",\r\n  initialMode = \"expanded\",\r\n}: PersistentStatuslineProps) {\r\n  const [activeDatasetKey, setActiveDatasetKey] = useState<\"agent\" | \"build\">(initialDataset);\r\n  const [mode, setMode] = useState<\"expanded\" | \"compact\">(initialMode);\r\n\r\n  const baseData = activeDatasetKey === \"agent\" ? AGENT_RUNTIME_DATASET : BUILD_RUNTIME_DATASET;\r\n\r\n  // Dynamic meter value state to test threshold color shifts\r\n  const [meterValue, setMeterValue] = useState<number>(baseData.meter.value);\r\n\r\n  // Sync meterValue when switching dataset\r\n  const handleDatasetChange = (key: \"agent\" | \"build\") => {\r\n    setActiveDatasetKey(key);\r\n    setMeterValue(key === \"agent\" ? AGENT_RUNTIME_DATASET.meter.value : BUILD_RUNTIME_DATASET.meter.value);\r\n  };\r\n\r\n  const warn = baseData.meter.warnThreshold ?? 70;\r\n  const crit = baseData.meter.critThreshold ?? 85;\r\n\r\n  const thresholdTier = meterValue >= crit ? \"crit\" : meterValue >= warn ? \"warn\" : \"normal\";\r\n\r\n  return (\r\n    <div className=\"psl-wrapper\">\r\n      {/* Top Testing Controls Bar */}\r\n      <div className=\"psl-controls-bar\">\r\n        <div className=\"psl-title-label\">Persistent Status Belt Prototype</div>\r\n\r\n        <div className=\"psl-dataset-buttons\">\r\n          <button\r\n            type=\"button\"\r\n            className={`psl-btn ${activeDatasetKey === \"agent\" ? \"active\" : \"\"}`}\r\n            onClick={() => handleDatasetChange(\"agent\")}\r\n          >\r\n            AI Agent Runtime\r\n          </button>\r\n          <button\r\n            type=\"button\"\r\n            className={`psl-btn ${activeDatasetKey === \"build\" ? \"active\" : \"\"}`}\r\n            onClick={() => handleDatasetChange(\"build\")}\r\n          >\r\n            Generic Build Runtime\r\n          </button>\r\n        </div>\r\n\r\n        <div className=\"psl-mode-buttons\">\r\n          <button\r\n            type=\"button\"\r\n            className={`psl-btn ${mode === \"expanded\" ? \"active\" : \"\"}`}\r\n            onClick={() => setMode(\"expanded\")}\r\n          >\r\n            展开模式 (Expanded)\r\n          </button>\r\n          <button\r\n            type=\"button\"\r\n            className={`psl-btn ${mode === \"compact\" ? \"active\" : \"\"}`}\r\n            onClick={() => setMode(\"compact\")}\r\n          >\r\n            单行紧凑 (Compact)\r\n          </button>\r\n        </div>\r\n\r\n        <div style={{ display: \"flex\", alignItems: \"center\", gap: \"8px\", fontSize: \"11px\" }}>\r\n          <span style={{ color: \"#94a3b8\" }}>调测阈值:</span>\r\n          <input\r\n            type=\"range\"\r\n            min=\"10\"\r\n            max=\"100\"\r\n            value={meterValue}\r\n            onChange={(e) => setMeterValue(Number(e.target.value))}\r\n            style={{ width: \"80px\", cursor: \"pointer\" }}\r\n            title=\"拖动测试 绿/黄/红 阈值变色\"\r\n          />\r\n          <span style={{ width: \"28px\", textAlign: \"right\" }}>{meterValue}%</span>\r\n        </div>\r\n      </div>\r\n\r\n      {/* The Actual UI Part Belt */}\r\n      <div className=\"psl-belt\" role=\"status\" aria-live=\"polite\">\r\n        {mode === \"expanded\" ? (\r\n          /* Expanded Multi-line Mode */\r\n          <>\r\n            {/* 1. Anchor Line */}\r\n            <div className=\"psl-anchor-line\">\r\n              <div className=\"psl-anchor-left\">\r\n                {/* Model Badge */}\r\n                <span className={`psl-badge ${baseData.badge.variant}`}>\r\n                  [{baseData.badge.label}]\r\n                </span>\r\n\r\n                {/* Meter Bar */}\r\n                <div className=\"psl-meter-container\">\r\n                  <span className=\"psl-meter-label\">{baseData.meter.label}</span>\r\n                  <div className=\"psl-meter-bar\">\r\n                    <div\r\n                      className={`psl-meter-fill ${thresholdTier}`}\r\n                      style={{ width: `${meterValue}%` }}\r\n                    />\r\n                  </div>\r\n                  <span className={`psl-meter-value ${thresholdTier}`}>\r\n                    {meterValue}%\r\n                  </span>\r\n                </div>\r\n\r\n                <span className=\"psl-divider\">│</span>\r\n\r\n                {/* Meta Items */}\r\n                <div className=\"psl-meta-items\">\r\n                  {baseData.meta.map((item, idx) => (\r\n                    <React.Fragment key={idx}>\r\n                      {idx > 0 && <span className=\"psl-divider\">│</span>}\r\n                      <span>{item}</span>\r\n                    </React.Fragment>\r\n                  ))}\r\n                </div>\r\n              </div>\r\n\r\n              {/* Absolute Wall-Clock Expiry */}\r\n              <div\r\n                className=\"psl-expiry-badge\"\r\n                title=\"绝对时间原则：状态带依靠系统事件离散重绘，使用钟表时刻在渲染陈旧时依然保真\"\r\n              >\r\n                expires <span className=\"psl-expiry-time\">{baseData.absoluteExpiry}</span>\r\n              </div>\r\n            </div>\r\n\r\n            {/* 2. Optional Activity Rows */}\r\n            <div className=\"psl-activity-rows\">\r\n              {/* Row: Tools (Same-Event Collapsing) */}\r\n              {baseData.tools.length > 0 && (\r\n                <div className=\"psl-row\">\r\n                  {baseData.tools.map((t, i) => (\r\n                    <React.Fragment key={t.id}>\r\n                      {i > 0 && <span className=\"psl-divider\">│</span>}\r\n                      <span>\r\n                        <span className={t.status === \"completed\" ? \"psl-icon-ok\" : \"psl-icon-spin\"}>\r\n                          {t.status === \"completed\" ? \"✓\" : \"◐\"}\r\n                        </span>{\" \"}\r\n                        {t.name}\r\n                        {t.count && t.count > 1 && (\r\n                          <span className=\"psl-collapsed-tag\"> ×{t.count}</span>\r\n                        )}\r\n                      </span>\r\n                    </React.Fragment>\r\n                  ))}\r\n                </div>\r\n              )}\r\n\r\n              {/* Row: Agents */}\r\n              {baseData.agents.length > 0 && (\r\n                <div className=\"psl-row\">\r\n                  {baseData.agents.map((ag) => (\r\n                    <span key={ag.id} style={{ display: \"inline-flex\", alignItems: \"center\", gap: \"6px\" }}>\r\n                      <span className={ag.status === \"completed\" ? \"psl-icon-ok\" : \"psl-icon-spin\"}>\r\n                        {ag.status === \"completed\" ? \"✓\" : \"◐\"}\r\n                      </span>\r\n                      <span className=\"psl-agent-name\">{ag.name}</span>\r\n                      {ag.detail && <span style={{ color: \"#94a3b8\" }}>: {ag.detail}</span>}\r\n                      {ag.elapsedMs && (\r\n                        <span className=\"psl-agent-time\">({Math.round(ag.elapsedMs / 1000)}s)</span>\r\n                      )}\r\n                    </span>\r\n                  ))}\r\n                </div>\r\n              )}\r\n\r\n              {/* Row: Todos */}\r\n              {baseData.todos && (\r\n                <div className=\"psl-row\">\r\n                  <span className=\"psl-icon-todo\">▸</span>\r\n                  <span style={{ color: \"#f8fafc\" }}>{baseData.todos.current}</span>\r\n                  <span style={{ color: \"#64748b\" }}>\r\n                    ({baseData.todos.doneCount}/{baseData.todos.totalCount})\r\n                  </span>\r\n                </div>\r\n              )}\r\n            </div>\r\n          </>\r\n        ) : (\r\n          /* Compact Single-line Mode */\r\n          <div className=\"psl-compact-line\">\r\n            <div style={{ display: \"flex\", alignItems: \"center\", gap: \"10px\", flexWrap: \"wrap\" }}>\r\n              <span className={`psl-badge ${baseData.badge.variant}`}>\r\n                [{baseData.badge.label}]\r\n              </span>\r\n\r\n              <div className=\"psl-meter-container\">\r\n                <span className=\"psl-meter-label\">{baseData.meter.label}</span>\r\n                <div className=\"psl-meter-bar\">\r\n                  <div\r\n                    className={`psl-meter-fill ${thresholdTier}`}\r\n                    style={{ width: `${meterValue}%` }}\r\n                  />\r\n                </div>\r\n                <span className={`psl-meter-value ${thresholdTier}`}>\r\n                  {meterValue}%\r\n                </span>\r\n              </div>\r\n\r\n              <span className=\"psl-divider\">│</span>\r\n\r\n              <div className=\"psl-compact-tools\">\r\n                {baseData.tools.slice(0, 2).map((t, i) => (\r\n                  <span key={t.id}>\r\n                    <span className={t.status === \"completed\" ? \"psl-icon-ok\" : \"psl-icon-spin\"}>\r\n                      {t.status === \"completed\" ? \"✓\" : \"◐\"}\r\n                    </span>{\" \"}\r\n                    {t.name}{t.count && t.count > 1 ? ` ×${t.count}` : \"\"}\r\n                  </span>\r\n                ))}\r\n              </div>\r\n            </div>\r\n\r\n            <div style={{ display: \"flex\", alignItems: \"center\", gap: \"10px\" }}>\r\n              {baseData.todos && (\r\n                <span style={{ fontSize: \"11px\", color: \"#94a3b8\" }}>\r\n                  ▸ {baseData.todos.doneCount}/{baseData.todos.totalCount}\r\n                </span>\r\n              )}\r\n              <div className=\"psl-expiry-badge\">\r\n                expires <span className=\"psl-expiry-time\">{baseData.absoluteExpiry}</span>\r\n              </div>\r\n            </div>\r\n          </div>\r\n        )}\r\n      </div>\r\n\r\n      {/* Explainer Note */}\r\n      <div style={{ fontSize: \"11px\", color: \"#64748b\", lineHeight: 1.5 }}>\r\n        💡 <strong>Portable Principle 实证：</strong> 状态带靠离散事件驱动更新，不作持续 60fps 轮询重绘。\r\n        因此右侧显示绝对钟表时间「expires {baseData.absoluteExpiry}」，而非「还有 3m 24s」。即使机器闲置或停止渲染，时钟时间依然保真。\r\n      </div>\r\n    </div>\r\n  );\r\n}\r\n",
          "language": "tsx",
          "description": "React status belt component with threshold meter and event collapsing"
        },
        {
          "id": "styles-css",
          "name": "Statusline Styles",
          "filename": "statusline.css",
          "content": "/**\r\n * Neutral CSS for Persistent Statusline Prototype\r\n * Monospace typography, low intrusion, threshold-reactive styling.\r\n */\r\n\r\n.psl-wrapper {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 16px;\r\n  background-color: #0b0d12;\r\n  color: #e2e8f0;\r\n  padding: 20px;\r\n  border-radius: 10px;\r\n  border: 1px solid #1c2230;\r\n  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace;\r\n  font-size: 12px;\r\n  user-select: none;\r\n  max-width: 920px;\r\n  margin: 0 auto;\r\n}\r\n\r\n.psl-controls-bar {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  flex-wrap: wrap;\r\n  gap: 10px;\r\n  border-bottom: 1px solid #1a202c;\r\n  padding-bottom: 12px;\r\n}\r\n\r\n.psl-title-label {\r\n  font-size: 14px;\r\n  font-weight: 700;\r\n  color: #f1f5f9;\r\n}\r\n\r\n.psl-dataset-buttons,\r\n.psl-mode-buttons {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 6px;\r\n}\r\n\r\n.psl-btn {\r\n  background: #141824;\r\n  border: 1px solid #242d40;\r\n  color: #94a3b8;\r\n  padding: 4px 10px;\r\n  font-size: 11.5px;\r\n  border-radius: 5px;\r\n  cursor: pointer;\r\n  font-family: inherit;\r\n  transition: all 0.15s ease;\r\n}\r\n\r\n.psl-btn:hover {\r\n  background: #1c2334;\r\n  color: #f8fafc;\r\n}\r\n\r\n.psl-btn.active {\r\n  background: #2563eb;\r\n  border-color: #3b82f6;\r\n  color: #ffffff;\r\n  font-weight: 600;\r\n}\r\n\r\n/* Belt Container (The actual statusline UI Part) */\r\n.psl-belt {\r\n  background: #0d1017;\r\n  border: 1px solid #202738;\r\n  border-radius: 6px;\r\n  overflow: hidden;\r\n  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4);\r\n}\r\n\r\n/* Primary Top Anchor Line */\r\n.psl-anchor-line {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  padding: 7px 12px;\r\n  border-bottom: 1px solid #181f2e;\r\n  gap: 10px;\r\n  background: #0f131c;\r\n}\r\n\r\n.psl-anchor-left {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 10px;\r\n  flex-wrap: wrap;\r\n}\r\n\r\n/* Model/Source Badge */\r\n.psl-badge {\r\n  font-weight: 700;\r\n  padding: 2px 7px;\r\n  border-radius: 4px;\r\n  font-size: 11px;\r\n  letter-spacing: -0.01em;\r\n}\r\n\r\n.psl-badge.cyan {\r\n  background: rgba(6, 182, 212, 0.15);\r\n  color: #22d3ee;\r\n  border: 1px solid rgba(6, 182, 212, 0.3);\r\n}\r\n\r\n.psl-badge.purple {\r\n  background: rgba(168, 85, 247, 0.15);\r\n  color: #c084fc;\r\n  border: 1px solid rgba(168, 85, 247, 0.3);\r\n}\r\n\r\n.psl-badge.emerald {\r\n  background: rgba(16, 185, 129, 0.15);\r\n  color: #34d399;\r\n  border: 1px solid rgba(16, 185, 129, 0.3);\r\n}\r\n\r\n.psl-badge.amber {\r\n  background: rgba(245, 158, 11, 0.15);\r\n  color: #fbbf24;\r\n  border: 1px solid rgba(245, 158, 11, 0.3);\r\n}\r\n\r\n/* Percentage Meter Bar */\r\n.psl-meter-container {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 6px;\r\n  font-size: 11.5px;\r\n}\r\n\r\n.psl-meter-label {\r\n  color: #94a3b8;\r\n}\r\n\r\n.psl-meter-bar {\r\n  width: 72px;\r\n  height: 8px;\r\n  background: #1a2233;\r\n  border-radius: 2px;\r\n  overflow: hidden;\r\n  position: relative;\r\n}\r\n\r\n.psl-meter-fill {\r\n  height: 100%;\r\n  transition: width 0.3s ease, background-color 0.3s ease;\r\n}\r\n\r\n.psl-meter-fill.normal {\r\n  background: #10b981;\r\n}\r\n\r\n.psl-meter-fill.warn {\r\n  background: #f59e0b;\r\n}\r\n\r\n.psl-meter-fill.crit {\r\n  background: #ef4444;\r\n  box-shadow: 0 0 8px #ef4444;\r\n}\r\n\r\n.psl-meter-value {\r\n  font-weight: 700;\r\n  font-size: 11px;\r\n}\r\n\r\n.psl-meter-value.normal { color: #10b981; }\r\n.psl-meter-value.warn { color: #f59e0b; }\r\n.psl-meter-value.crit { color: #ef4444; }\r\n\r\n.psl-divider {\r\n  color: #334155;\r\n  font-weight: 300;\r\n}\r\n\r\n/* Meta Group items */\r\n.psl-meta-items {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 8px;\r\n  color: #64748b;\r\n  font-size: 11px;\r\n}\r\n\r\n.psl-expiry-badge {\r\n  font-size: 10.5px;\r\n  color: #94a3b8;\r\n  background: #161b26;\r\n  border: 1px solid #222b3d;\r\n  padding: 2px 7px;\r\n  border-radius: 4px;\r\n  white-space: nowrap;\r\n}\r\n\r\n.psl-expiry-time {\r\n  color: #e2e8f0;\r\n  font-weight: 600;\r\n}\r\n\r\n/* Activity Rows (Expanded Mode) */\r\n.psl-activity-rows {\r\n  display: flex;\r\n  flex-direction: column;\r\n  padding: 4px 12px 6px 12px;\r\n  background: #090c12;\r\n  gap: 4px;\r\n}\r\n\r\n.psl-row {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 8px;\r\n  font-size: 11px;\r\n  line-height: 1.4;\r\n  color: #cbd5e1;\r\n}\r\n\r\n.psl-icon-ok { color: #10b981; }\r\n.psl-icon-spin { color: #38bdf8; }\r\n.psl-icon-todo { color: #f59e0b; }\r\n\r\n.psl-collapsed-tag {\r\n  color: #94a3b8;\r\n  background: #141a26;\r\n  border: 1px solid #20293d;\r\n  padding: 0 4px;\r\n  border-radius: 3px;\r\n  font-size: 10px;\r\n}\r\n\r\n.psl-agent-name {\r\n  color: #c084fc;\r\n  font-weight: 600;\r\n}\r\n\r\n.psl-agent-time {\r\n  color: #64748b;\r\n  font-size: 10px;\r\n}\r\n\r\n/* Compact Mode Row */\r\n.psl-compact-line {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  padding: 7px 12px;\r\n  gap: 10px;\r\n  background: #0d1017;\r\n  flex-wrap: wrap;\r\n}\r\n\r\n.psl-compact-tools {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 8px;\r\n  font-size: 11px;\r\n  color: #cbd5e1;\r\n}\r\n",
          "language": "css",
          "description": "Compact and expanded belt layout with color tokens"
        },
        {
          "id": "tokens-json",
          "name": "Design Tokens",
          "filename": "tokens.json",
          "content": "{\r\n  \"persistent-statusline\": {\r\n    \"surface\": {\r\n      \"beltBg\": \"#0d1017\",\r\n      \"anchorLineBg\": \"#0f131c\",\r\n      \"activityRowBg\": \"#090c12\",\r\n      \"borderColor\": \"#202738\"\r\n    },\r\n    \"thresholds\": {\r\n      \"normalColor\": \"#10b981\",\r\n      \"warnColor\": \"#f59e0b\",\r\n      \"critColor\": \"#ef4444\",\r\n      \"warnLevel\": 70,\r\n      \"critLevel\": 85\r\n    },\r\n    \"typography\": {\r\n      \"fontFamily\": \"ui-monospace, Menlo, Consolas, monospace\",\r\n      \"fontSize\": \"11.5px\"\r\n    }\r\n  }\r\n}\r\n",
          "language": "json",
          "description": "Extracted semantic tokens"
        },
        {
          "id": "agent-brief",
          "name": "Agent Implementation Brief",
          "filename": "agent-brief.md",
          "content": "# Agent Implementation Brief: Persistent Statusline\r\n\r\n## Core Mental Model\r\nUse when monitoring long-running processes or AI agent contexts where full modal/drawer UIs are too intrusive, but ambient situational awareness is critical.\r\n\r\n## Key Rules\r\n1. **Wall-clock Truth**:\r\n   Never render relative countdowns (\"3m remaining\") unless you guarantee high-frequency timer renders. Always render absolute wall-clock timestamps (\"expires 21:40\").\r\n2. **Event Collapsing**:\r\n   Fold repeating actions into `Action ×Count` (e.g. `Read ×4`) rather than spamming multiple lines.\r\n3. **Threshold Reactivity**:\r\n   `value < warnThreshold`: Normal accent (Green)\r\n   `value >= warnThreshold && value < critThreshold`: Warning (Yellow)\r\n   `value >= critThreshold`: Critical alert (Red)\r\n",
          "language": "markdown",
          "description": "Guidance prompt for AI coding agents"
        },
        {
          "id": "concept-html",
          "name": "HTML Concept Specimen",
          "filename": "concept.html",
          "content": "<!DOCTYPE html>\r\n<html lang=\"en\">\r\n<head>\r\n  <meta charset=\"UTF-8\">\r\n  <title>Persistent Statusline — Concept Demonstration</title>\r\n  <style>\r\n    body {\r\n      background: #08090d;\r\n      color: #e2e8f0;\r\n      font-family: ui-monospace, Consolas, monospace;\r\n      padding: 30px;\r\n      display: flex;\r\n      flex-direction: column;\r\n      align-items: center;\r\n      gap: 20px;\r\n    }\r\n    .status-belt {\r\n      width: 760px;\r\n      background: #0d1017;\r\n      border: 1px solid #202738;\r\n      border-radius: 6px;\r\n      overflow: hidden;\r\n      font-size: 11.5px;\r\n    }\r\n    .anchor {\r\n      display: flex;\r\n      justify-content: space-between;\r\n      align-items: center;\r\n      padding: 8px 12px;\r\n      background: #0f131c;\r\n      border-bottom: 1px solid #181f2e;\r\n    }\r\n    .badge {\r\n      background: rgba(6, 182, 212, 0.15);\r\n      color: #22d3ee;\r\n      border: 1px solid rgba(6, 182, 212, 0.3);\r\n      padding: 2px 6px;\r\n      border-radius: 4px;\r\n      font-weight: bold;\r\n    }\r\n    .meter {\r\n      display: inline-flex;\r\n      align-items: center;\r\n      gap: 6px;\r\n      margin-left: 10px;\r\n    }\r\n    .bar {\r\n      width: 70px;\r\n      height: 8px;\r\n      background: #1a2233;\r\n      border-radius: 2px;\r\n      overflow: hidden;\r\n    }\r\n    .fill { height: 100%; background: #10b981; }\r\n    .activity {\r\n      padding: 6px 12px;\r\n      background: #090c12;\r\n      display: flex;\r\n      flex-direction: column;\r\n      gap: 4px;\r\n      color: #94a3b8;\r\n    }\r\n    .tag {\r\n      background: #161b26;\r\n      border: 1px solid #222b3d;\r\n      padding: 1px 6px;\r\n      border-radius: 3px;\r\n      font-size: 10.5px;\r\n    }\r\n  </style>\r\n</head>\r\n<body>\r\n  <h2>Persistent Status Belt (Low-Intrusion HUD)</h2>\r\n\r\n  <div class=\"status-belt\">\r\n    <div class=\"anchor\">\r\n      <div>\r\n        <span class=\"badge\">[DeepSeek-V3]</span>\r\n        <span class=\"meter\">\r\n          <span>Context</span>\r\n          <span class=\"bar\"><span class=\"fill\" style=\"width: 68%;\"></span></span>\r\n          <span style=\"color: #10b981; font-weight: bold;\">68%</span>\r\n        </span>\r\n        <span style=\"color: #334155; margin: 0 8px;\">│</span>\r\n        <span style=\"color: #64748b;\">8 rules │ 4 MCPs │ git:(main*)</span>\r\n      </div>\r\n      <div class=\"tag\">\r\n        expires <strong style=\"color: #e2e8f0;\">21:45</strong>\r\n      </div>\r\n    </div>\r\n    <div class=\"activity\">\r\n      <div>\r\n        <span style=\"color: #10b981;\">✓</span> Read ×4 <span style=\"color: #334155;\">│</span>\r\n        <span style=\"color: #10b981;\">✓</span> Grep ×2 <span style=\"color: #334155;\">│</span>\r\n        <span style=\"color: #38bdf8;\">◐</span> Edit: types.ts\r\n      </div>\r\n      <div>\r\n        <span style=\"color: #38bdf8;\">◐</span> <strong style=\"color: #c084fc;\">Research Subagent</strong>: Scanning AST tokens (14s)\r\n      </div>\r\n      <div>\r\n        <span style=\"color: #f59e0b;\">▸</span> Current task in progress (2/3)\r\n      </div>\r\n    </div>\r\n  </div>\r\n</body>\r\n</html>\r\n",
          "language": "html",
          "description": "Semantic HTML standalone mockup"
        }
      ]
    },
    "exports": {
      "humanSpec": "available",
      "agentBrief": "available",
      "html": "available",
      "css": "available",
      "react": "available",
      "tokens": "available",
      "package": "available"
    },
    "relationships": {
      "usedByPresets": [
        "cyber-terminal",
        "tactical-hud"
      ],
      "relatedParts": [
        "clip-launch-grid"
      ]
    },
    "realityTest": {
      "rating": "ACCEPT",
      "mechanismIndependent": true,
      "datasetIndependent": true,
      "worthEnteringLibrary": true,
      "notes": "在智能体控制台与编译构建流水线两个截然不同的场景中均表现出极佳的态势感知力与节能保真性。"
    },
    "createdAt": "2026-10-04T12:00:00.000Z",
    "updatedAt": "2026-10-04T12:45:00.000Z"
  }
];
