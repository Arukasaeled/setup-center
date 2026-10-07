import React, { useState, useEffect, useRef } from "react";
import { AccessibleDialog } from "../AccessibleDialog";
import type { UIPartKind } from "../../core/uiparts/types";
import { UIPartRepository } from "../../core/uiparts/repository";
import {
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_MIMES,
  parseSupportedImageDataUrl,
} from "../../core/uiparts/persistenceLogic";

interface QuickCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newPartId: string) => void;
}

const KIND_OPTIONS: { value: UIPartKind; label: string }[] = [
  { value: "component", label: "Component (独立组件)" },
  { value: "layout", label: "Layout (布局网格)" },
  { value: "interaction", label: "Interaction (手势与微交互)" },
  { value: "status", label: "Status (状态指示与腰带)" },
  { value: "composition", label: "Composition (版式构图)" },
  { value: "navigation", label: "Navigation (导航与菜单)" },
  { value: "card", label: "Card (卡片结构)" },
  { value: "search", label: "Search (检索与指令)" },
  { value: "data-viz", label: "Data-Viz (数据可视化)" },
  { value: "motion", label: "Motion (动效范式)" },
  { value: "visual-rule", label: "Visual-Rule (视觉法则)" },
  { value: "typography", label: "Typography (字体排印)" },
  { value: "other", label: "Other (其他)" },
];

export function QuickCaptureModal({
  isOpen,
  onClose,
  onSuccess,
}: QuickCaptureModalProps) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<UIPartKind>("component");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [notes, setNotes] = useState("");
  const [previewDataUrl, setPreviewDataUrl] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle("");
      setKind("component");
      setSourceUrl("");
      setSourceTitle("");
      setTagsInput("");
      setNotes("");
      setPreviewDataUrl("");
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // Support pasting image directly from clipboard
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            loadFileReader(file);
            break;
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isOpen]);

  const loadFileReader = (file: File) => {
    if (!SUPPORTED_IMAGE_MIMES.includes(file.type as any)) {
      setError("不支持的图片格式。仅支持 PNG, JPEG, WebP, GIF，暂不支持 SVG 或其他格式。");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      if (typeof e.target?.result === "string") {
        const parsed = parseSupportedImageDataUrl(e.target.result);
        if (!parsed) {
          setError("无法识别的图片数据，仅支持 PNG, JPEG, WebP, GIF。");
          return;
        }
        setPreviewDataUrl(e.target.result);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadFileReader(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("零件名称 (Title) 不能为空");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const tags = tagsInput
        .split(/[,，\s]+/)
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);

      const sources = sourceUrl.trim()
        ? [
            {
              id: `src-${Date.now()}`,
              title: sourceTitle.trim() || sourceUrl.trim(),
              url: sourceUrl.trim(),
              type: "other" as const,
              primary: true,
            },
          ]
        : [];

      const newPart = await UIPartRepository.create({
        title: title.trim(),
        kind,
        lifecycle: "raw",
        summary: notes.trim().slice(0, 100),
        preview: {
          thumbnail: previewDataUrl,
          // V1: Do not duplicate thumbnail into screenshots array to prevent redundant inline Data URLs
        },
        tags,
        notes: notes.trim(),
        sources,
      });

      onSuccess(newPart.id);
      onClose();
    } catch (err: any) {
      setError(err?.message || "创建零件失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      titleId="quick-capture-title"
      contentClassName="relative w-full max-w-lg rounded-2xl border border-white/15 bg-[#0f141f] p-6 shadow-2xl text-slate-100 flex flex-col max-h-[90vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div>
          <h2 id="quick-capture-title" className="text-base font-semibold text-white">
            + 快速收集视觉零件 (Quick Capture)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            灵感即时入库 · 初始状态为 RAW，支持日后渐进式提炼与原型化
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭快速收集"
          className="min-h-[32px] min-w-[32px] flex items-center justify-center text-slate-400 hover:text-white p-1 rounded-md transition cursor-pointer"
        >
          ✕
        </button>
      </div>

      {error && (
        <div className="mt-3 p-2.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
          {error}
        </div>
      )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="quick-capture-title-input" className="block text-xs font-medium text-slate-300 mb-1">
              零件标题 <span className="text-rose-400">*</span>
            </label>
            <input
              id="quick-capture-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：Linear Safe-Triangle 或 某种滑动卡片"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          {/* Kind */}
          <div>
            <label htmlFor="quick-capture-kind-select" className="block text-xs font-medium text-slate-300 mb-1">
              零件分类 (Kind)
            </label>
            <select
              id="quick-capture-kind-select"
              value={kind}
              onChange={(e) => setKind(e.target.value as UIPartKind)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            >
              {KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[#0f141f]">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Image Drag & Drop / Paste */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              视觉材料 (PNG / JPEG / WebP / GIF，粘贴或拖拽)
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition ${
                isDragging
                  ? "border-sky-400 bg-sky-500/10"
                  : previewDataUrl
                  ? "border-white/20 bg-black/20"
                  : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={SUPPORTED_IMAGE_ACCEPT}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    loadFileReader(e.target.files[0]);
                  }
                }}
                className="hidden"
              />

              {previewDataUrl ? (
                <div className="flex flex-col items-center">
                  <img
                    src={previewDataUrl}
                    alt="Preview"
                    className="max-h-40 rounded object-contain shadow"
                  />
                  <span className="mt-2 text-xs text-sky-400 underline">
                    点击或拖入更换图片 (已支持剪贴板 Ctrl+V)
                  </span>
                </div>
              ) : (
                <div className="py-4 flex flex-col items-center justify-center gap-1.5 text-slate-400">
                  <svg
                    className="w-8 h-8 opacity-60 text-sky-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="text-xs font-medium text-slate-200">
                    拖入图片 或 点击选择文件
                  </span>
                  <span className="text-[11px] text-slate-500">
                    支持在当前窗口直接按下 <kbd className="px-1 py-0.5 rounded bg-white/10 text-slate-300">Ctrl+V</kbd> 粘贴剪贴板截图
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Source Link */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="quick-capture-source-url" className="block text-xs font-medium text-slate-300 mb-1">
                来源 URL
              </label>
              <input
                id="quick-capture-source-url"
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="quick-capture-source-title" className="block text-xs font-medium text-slate-300 mb-1">
                来源标题 / 站点
              </label>
              <input
                id="quick-capture-source-title"
                type="text"
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
                placeholder="例如：Linear Changelog"
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label htmlFor="quick-capture-tags-input" className="block text-xs font-medium text-slate-300 mb-1">
              标签 (以逗号或空格分隔)
            </label>
            <input
              id="quick-capture-tags-input"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="menu, hover, pointer, layout..."
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="quick-capture-notes-input" className="block text-xs font-medium text-slate-300 mb-1">
              速记笔记 / 启发点
            </label>
            <textarea
              id="quick-capture-notes-input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="看到的第一感受：对角线移动不关闭子菜单、视觉轻量..."
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {/* Buttons */}
          <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="取消收集并关闭窗口"
              className="min-h-[32px] px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              aria-label="保存到零件库"
              className="min-h-[32px] px-4 py-2 rounded-lg text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-md shadow-sky-500/20 transition disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? "入库中..." : "保存到零件库 (RAW)"}
            </button>
          </div>
        </form>
    </AccessibleDialog>
  );
}
