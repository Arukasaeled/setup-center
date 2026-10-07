import { useState } from "react";
import { ClipLaunchGrid } from "../../../research/ui-parts/clip-launch-grid/ClipLaunchGrid";
import { SafeTriangleMenu } from "../../../research/ui-parts/safe-triangle/SafeTriangleMenu";
import { PersistentStatusline } from "../../../research/ui-parts/persistent-statusline/PersistentStatusline";
import type { UIPart } from "../../core/uiparts/types";
import { UIPartRepository } from "../../core/uiparts/repository";

interface UIPartPrototypeViewerProps {
  part: UIPart;
}

export function UIPartPrototypeViewer({ part }: UIPartPrototypeViewerProps) {
  const [activeTab, setActiveTab] = useState<string>("prototype");
  const [selectedScreenshot, setSelectedScreenshot] = useState<number>(0);

  if (part.id === "clip-launch-grid") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("prototype")}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                activeTab === "prototype"
                  ? "bg-white/15 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              ⚡ 可交互活体原型 (Live React Prototype)
            </button>
            <button
              onClick={() => setActiveTab("screenshots")}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                activeTab === "screenshots"
                  ? "bg-white/15 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              🖼️ 真实验证截图 ({part.preview.screenshots?.length || 0})
            </button>
          </div>
        </div>

        {activeTab === "prototype" ? (
          <div className="rounded-lg border border-white/10 bg-[#090d16] p-4 overflow-x-auto">
            <ClipLaunchGrid initialDataset="agent" />
          </div>
        ) : (
          <ScreenshotGallery
            screenshots={part.preview.screenshots || []}
            selected={selectedScreenshot}
            onSelect={setSelectedScreenshot}
          />
        )}
      </div>
    );
  }

  if (part.id === "safe-triangle") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("prototype")}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                activeTab === "prototype"
                  ? "bg-white/15 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              ⚡ 级联菜单交互原型 (Live Safe Triangle)
            </button>
            <button
              onClick={() => setActiveTab("screenshots")}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                activeTab === "screenshots"
                  ? "bg-white/15 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              🖼️ 真实验证截图 ({part.preview.screenshots?.length || 0})
            </button>
          </div>
        </div>

        {activeTab === "prototype" ? (
          <div className="rounded-lg border border-white/10 bg-[#090d16] p-6 flex flex-col items-center justify-center min-h-[360px]">
            <SafeTriangleMenu />
          </div>
        ) : (
          <ScreenshotGallery
            screenshots={part.preview.screenshots || []}
            selected={selectedScreenshot}
            onSelect={setSelectedScreenshot}
          />
        )}
      </div>
    );
  }

  if (part.id === "persistent-statusline") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("prototype")}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                activeTab === "prototype"
                  ? "bg-white/15 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              ⚡ 状态腰带活体原型 (Live Status Belt)
            </button>
            <button
              onClick={() => setActiveTab("screenshots")}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                activeTab === "screenshots"
                  ? "bg-white/15 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              🖼️ 真实验证截图 ({part.preview.screenshots?.length || 0})
            </button>
          </div>
        </div>

        {activeTab === "prototype" ? (
          <div className="rounded-lg border border-white/10 bg-[#090d16] p-6 flex flex-col items-center justify-center min-h-[300px]">
            <PersistentStatusline initialDataset="agent" initialMode="expanded" />
          </div>
        ) : (
          <ScreenshotGallery
            screenshots={part.preview.screenshots || []}
            selected={selectedScreenshot}
            onSelect={setSelectedScreenshot}
          />
        )}
      </div>
    );
  }

  // Default preview for custom or raw parts
  return (
    <div className="rounded-lg border border-white/10 bg-[#090d16] p-4 flex flex-col items-center justify-center">
      {part.preview.thumbnail ? (
        <img
          src={UIPartRepository.getResolvedAssetUrl(part.preview.thumbnail)}
          alt={part.title}
          className="max-h-[360px] w-auto rounded object-contain"
        />
      ) : (
        <div className="py-16 text-center text-slate-500 text-sm">
          暂无活体原型或截图
        </div>
      )}
    </div>
  );
}

function ScreenshotGallery({
  screenshots,
  selected,
  onSelect,
}: {
  screenshots: string[];
  selected: number;
  onSelect: (idx: number) => void;
}) {
  const [failedPaths, setFailedPaths] = useState<Set<string>>(new Set());
  const [retryKey, setRetryKey] = useState<number>(0);

  if (screenshots.length === 0) {
    return <div className="text-slate-500 text-xs py-8 text-center font-mono">暂无截图记录</div>;
  }

  const current = screenshots[selected] || screenshots[0];
  const resolvedUrl = UIPartRepository.getResolvedAssetUrl(current);
  const isFailed = failedPaths.has(current);

  const handleRetry = (path: string) => {
    setFailedPaths((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    setRetryKey((k) => k + 1);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-white/10 bg-black/40 p-4 flex items-center justify-center min-h-[320px]">
        {isFailed ? (
          <div className="flex flex-col items-center justify-center text-center p-6 space-y-2">
            <span className="text-2xl">⚠️</span>
            <p className="text-xs text-slate-300 font-medium">截图文件未能成功加载</p>
            <p className="text-[11px] font-mono text-slate-500 max-w-md break-all">{current}</p>
            <button
              onClick={() => handleRetry(current)}
              className="mt-2 px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-sky-300 transition font-mono flex items-center gap-1.5"
            >
              <span>↻</span>
              <span>重新尝试加载</span>
            </button>
          </div>
        ) : (
          <img
            key={`${current}-${retryKey}`}
            src={resolvedUrl}
            alt={`Screenshot ${selected + 1}`}
            className="max-h-[400px] w-auto rounded object-contain shadow-lg"
            onError={() => {
              setFailedPaths((prev) => new Set(prev).add(current));
            }}
          />
        )}
      </div>
      {screenshots.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {screenshots.map((s, idx) => (
            <button
              key={s}
              onClick={() => onSelect(idx)}
              className={`px-3 py-1.5 rounded text-xs border transition ${
                selected === idx
                  ? "border-sky-500 bg-sky-500/10 text-sky-300"
                  : "border-white/10 bg-white/5 text-slate-400 hover:text-white"
              }`}
            >
              Shot {idx + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
