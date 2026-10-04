import { useState, useEffect } from "react";
import type { UIPart, UIPartKind, UIPartLifecycle, UIPartSource } from "../../core/uiparts/types";
import { UIPartRepository } from "../../core/uiparts/repository";

interface EditPartModalProps {
  part: UIPart | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedPart: UIPart) => void;
}

const KIND_OPTIONS: { value: UIPartKind; label: string }[] = [
  { value: "component", label: "Component (组件)" },
  { value: "layout", label: "Layout (布局)" },
  { value: "interaction", label: "Interaction (微交互)" },
  { value: "status", label: "Status (状态腰带)" },
  { value: "composition", label: "Composition (版式构图)" },
  { value: "navigation", label: "Navigation (导航菜单)" },
  { value: "card", label: "Card (卡片结构)" },
  { value: "search", label: "Search (检索指令)" },
  { value: "data-viz", label: "Data-Viz (数据可视化)" },
  { value: "motion", label: "Motion (动效范式)" },
  { value: "visual-rule", label: "Visual-Rule (视觉法则)" },
  { value: "typography", label: "Typography (排印)" },
  { value: "other", label: "Other (其他)" },
];

const LIFECYCLE_OPTIONS: UIPartLifecycle[] = [
  "raw",
  "enriched",
  "prototyped",
  "validated",
];

export function EditPartModal({
  part,
  isOpen,
  onClose,
  onSuccess,
}: EditPartModalProps) {
  const [tab, setTab] = useState<"basic" | "advanced">("basic");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<UIPartKind>("component");
  const [lifecycle, setLifecycle] = useState<UIPartLifecycle>("raw");
  const [summary, setSummary] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && part) {
      setTitle(part.title);
      setKind(part.kind);
      setLifecycle(part.lifecycle);
      setSummary(part.summary || "");
      setTagsInput(part.tags.join(", "));
      setNotes(part.notes || "");
      setSourceUrl(part.sources?.[0]?.url || "");
      setJsonText(JSON.stringify(part, null, 2));
      setError(null);
      setIsSaving(false);
      setTab("basic");
    }
  }, [isOpen, part]);

  if (!isOpen || !part) return null;

  const handleSaveBasic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("零件名称不能为空");
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      const tags = tagsInput
        .split(/[,，\s]+/)
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);

      const sources: UIPartSource[] = sourceUrl.trim()
        ? [
            {
              id: part.sources?.[0]?.id || `src-${Date.now()}`,
              title: part.sources?.[0]?.title || title.trim(),
              url: sourceUrl.trim(),
              type: part.sources?.[0]?.type || "web",
              primary: true,
              notes: part.sources?.[0]?.notes,
            },
            ...(part.sources?.slice(1) || []),
          ]
        : (part.sources || []);

      const updated = await UIPartRepository.update(part.id, {
        title: title.trim(),
        kind,
        lifecycle,
        summary: summary.trim(),
        tags,
        notes: notes.trim(),
        sources,
      });

      onSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || "更新失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAdvanced = async () => {
    try {
      setIsSaving(true);
      setError(null);

      const parsed = JSON.parse(jsonText);
      if (!parsed.title) {
        throw new Error("JSON 格式错误：缺少 title 字段");
      }

      const updated = await UIPartRepository.update(part.id, parsed);
      onSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || "JSON 解析或更新失败");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-xl rounded-2xl border border-white/15 bg-[#0f141f] p-6 shadow-2xl text-slate-100 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div>
            <h2 className="text-base font-semibold text-white">编辑视觉零件</h2>
            <p className="text-xs text-slate-400 mt-0.5">ID: {part.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-black/40 p-1 border border-white/10">
              <button
                type="button"
                onClick={() => setTab("basic")}
                className={`px-3 py-1 rounded text-xs transition ${
                  tab === "basic"
                    ? "bg-white/15 text-white font-medium"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                常规编辑
              </button>
              <button
                type="button"
                onClick={() => setTab("advanced")}
                className={`px-3 py-1 rounded text-xs transition ${
                  tab === "advanced"
                    ? "bg-white/15 text-white font-medium"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                JSON 结构规格
              </button>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded ml-2"
            >
              ✕
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 p-2.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto mt-4 pr-1">
          {tab === "basic" ? (
            <form onSubmit={handleSaveBasic} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  零件标题
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    分类 (Kind)
                  </label>
                  <select
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

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    生命周期 (Lifecycle)
                  </label>
                  <select
                    value={lifecycle}
                    onChange={(e) => setLifecycle(e.target.value as UIPartLifecycle)}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none uppercase font-mono"
                  >
                    {LIFECYCLE_OPTIONS.map((lc) => (
                      <option key={lc} value={lc} className="bg-[#0f141f]">
                        {lc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  概要说明 (Summary)
                </label>
                <textarea
                  rows={2}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  来源链接 (Source URL)
                </label>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  标签 (以逗号分隔)
                </label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  速记笔记 (Notes)
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-white/10 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 transition"
                >
                  {isSaving ? "保存中..." : "保存修改"}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                直接编辑完整的 JSON 领域模型（包含设计 DNA、证据等级、代码资产等）：
              </p>
              <textarea
                rows={14}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                className="w-full font-mono text-xs rounded-lg border border-white/10 bg-black/60 p-3 text-slate-200 focus:border-sky-500 focus:outline-none leading-relaxed"
              />
              <div className="pt-2 border-t border-white/10 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveAdvanced}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 transition"
                >
                  {isSaving ? "保存中..." : "提交 JSON 规格"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
