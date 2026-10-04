import React, { useState, useEffect, useMemo, useRef } from "react";
import type { UIPart, UIPartKind, UIPartLifecycle } from "../../core/uiparts/types";
import { UIPartRepository } from "../../core/uiparts/repository";
import { UIPartCard } from "./UIPartCard";
import { QuickCaptureModal } from "./QuickCaptureModal";
import { UIPartDetailModal } from "./UIPartDetailModal";
import { EditPartModal } from "./EditPartModal";

export function UIPartsGallery() {
  const [parts, setParts] = useState<UIPart[]>(() => UIPartRepository.listSync());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKind, setSelectedKind] = useState<UIPartKind | "all">("all");
  const [selectedLifecycle, setSelectedLifecycle] = useState<UIPartLifecycle | "all">("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Modals state
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [selectedPart, setSelectedPart] = useState<UIPart | null>(null);
  const [editingPart, setEditingPart] = useState<UIPart | null>(null);

  const importFileInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to repository updates
  useEffect(() => {
    void UIPartRepository.init();
    const unsubscribe = UIPartRepository.subscribe(() => {
      setParts(UIPartRepository.listSync());
    });
    return unsubscribe;
  }, []);

  // Filter parts continuously
  const filteredParts = useMemo(() => {
    return UIPartRepository.listSync({
      search: searchQuery,
      kind: selectedKind,
      lifecycle: selectedLifecycle,
      tag: selectedTag || undefined,
    });
  }, [parts, searchQuery, selectedKind, selectedLifecycle, selectedTag]);

  // Extract all unique tags
  const allTags = useMemo(() => {
    const tagCount = new Map<string, number>();
    for (const p of parts) {
      for (const t of p.tags) {
        tagCount.set(t, (tagCount.get(t) || 0) + 1);
      }
    }
    return Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [parts]);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = await UIPartRepository.importPackage(parsed);
      setSelectedPart(imported);
      alert(`成功导入零件：「${imported.title}」！`);
    } catch (err: any) {
      alert(`导入失败：${err?.message || "无效的零件包格式"}`);
    } finally {
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="flex flex-col min-h-full pb-16">
      {/* Top Header & Shelf Meta */}
      <div className="px-6 py-5 border-b border-white/10 bg-[#07090f]/80 backdrop-blur-md sticky top-0 z-20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <span>UI 视觉零部件库</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/10 text-slate-300 font-normal">
                  V1 · REFERENCE SHELF
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              视觉材料 · 归档、拆解、提取与原型 · 沉淀构建一切所需的界面零件
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5">
            <input
              ref={importFileInputRef}
              type="file"
              accept=".json,.uipart.json"
              onChange={handleImportFile}
              className="hidden"
            />
            <button
              onClick={() => importFileInputRef.current?.click()}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 transition flex items-center gap-1.5 shadow-sm"
              title="导入便携零件包 (*.uipart.json)"
            >
              <span>📥</span>
              <span>导入零件包</span>
            </button>
            <button
              onClick={() => setIsCaptureOpen(true)}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-md shadow-sky-500/20 transition flex items-center gap-1.5"
            >
              <span>+</span>
              <span>收集新零件</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="mt-4 pt-3 border-t border-white/5 flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索零件名称、原理、标签..."
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 pl-8 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
            <span className="absolute left-2.5 top-2 text-slate-500 text-xs">🔍</span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1.5 text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Lifecycle Filter Pills */}
          <div className="flex items-center rounded-lg bg-black/40 border border-white/10 p-0.5 text-xs">
            {(["all", "raw", "enriched", "prototyped", "validated"] as const).map(
              (lc) => (
                <button
                  key={lc}
                  onClick={() => setSelectedLifecycle(lc)}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase transition ${
                    selectedLifecycle === lc
                      ? "bg-white/20 text-white font-semibold shadow"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {lc}
                </button>
              ),
            )}
          </div>

          {/* Kind Dropdown Filter */}
          <select
            value={selectedKind}
            onChange={(e) => setSelectedKind(e.target.value as any)}
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-slate-300 focus:border-sky-500 focus:outline-none"
          >
            <option value="all">所有分类 (All Kinds)</option>
            <option value="layout">Layout (布局矩阵)</option>
            <option value="interaction">Interaction (微交互与手势)</option>
            <option value="status">Status (状态腰带/指示器)</option>
            <option value="component">Component (独立组件)</option>
            <option value="composition">Composition (版式构图)</option>
            <option value="navigation">Navigation (导航菜单)</option>
            <option value="card">Card (卡片结构)</option>
            <option value="search">Search (指令检索)</option>
            <option value="data-viz">Data-Viz (数据可视化)</option>
            <option value="motion">Motion (动效规范)</option>
          </select>

          {/* Tag Filter Reset if active */}
          {selectedTag && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs">
              <span>#{selectedTag}</span>
              <button
                onClick={() => setSelectedTag(null)}
                className="hover:text-white font-bold"
              >
                ✕
              </button>
            </div>
          )}

          {/* Total Counter Badge */}
          <div className="ml-auto text-[11px] font-mono text-slate-500">
            {filteredParts.length} / {parts.length} PARTS
          </div>
        </div>

        {/* Popular Tags Scroller */}
        {allTags.length > 0 && !selectedTag && (
          <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 text-[11px]">
            <span className="text-slate-500 font-mono shrink-0">Tags:</span>
            {allTags.slice(0, 10).map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white font-mono text-[10px] shrink-0 border border-white/5 transition"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Continuous Dense Grid */}
      <div className="p-6">
        {filteredParts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredParts.map((part) => (
              <UIPartCard
                key={part.id}
                part={part}
                onClick={() => setSelectedPart(part)}
              />
            ))}
          </div>
        ) : (
          <div className="py-20 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-slate-500 text-xl mb-3">
              🔍
            </div>
            <h3 className="text-sm font-semibold text-slate-200">
              未找到匹配的 UI 零件
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              尝试清除筛选条件，或通过点击右上角「+ 收集新零件」将新的视觉灵感与交互原型收入库中。
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedKind("all");
                  setSelectedLifecycle("all");
                  setSelectedTag(null);
                }}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/15 text-slate-200"
              >
                清除所有筛选
              </button>
              <button
                onClick={() => setIsCaptureOpen(true)}
                className="px-3 py-1.5 rounded-lg text-xs bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold"
              >
                + 收集此灵感
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <QuickCaptureModal
        isOpen={isCaptureOpen}
        onClose={() => setIsCaptureOpen(false)}
        onSuccess={(newId) => {
          const created = UIPartRepository.listSync().find((p) => p.id === newId);
          if (created) setSelectedPart(created);
        }}
      />

      <UIPartDetailModal
        part={selectedPart}
        isOpen={Boolean(selectedPart)}
        onClose={() => setSelectedPart(null)}
        onEdit={(p) => {
          setEditingPart(p);
        }}
        onDeleted={() => {
          setSelectedPart(null);
        }}
      />

      <EditPartModal
        part={editingPart}
        isOpen={Boolean(editingPart)}
        onClose={() => setEditingPart(null)}
        onSuccess={(updated) => {
          setSelectedPart(updated);
          setEditingPart(null);
        }}
      />
    </div>
  );
}
