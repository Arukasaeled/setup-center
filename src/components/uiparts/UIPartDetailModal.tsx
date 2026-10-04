import { useState } from "react";
import type { UIPart } from "../../core/uiparts/types";
import { UIPartRepository } from "../../core/uiparts/repository";
import { UIPartPrototypeViewer } from "./UIPartPrototypeViewer";
import { openExternalUrl } from "../../core/setup/executor";

interface UIPartDetailModalProps {
  part: UIPart | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (part: UIPart) => void;
  onDeleted: () => void;
}

export function UIPartDetailModal({
  part,
  isOpen,
  onClose,
  onEdit,
  onDeleted,
}: UIPartDetailModalProps) {
  const [activeCodeTab, setActiveCodeTab] = useState<number>(0);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen || !part) return null;

  const handleExportPackage = () => {
    try {
      const pkg = {
        format: "uipart-package.v1",
        exportedAt: new Date().toISOString(),
        part,
      };
      const jsonStr = JSON.stringify(pkg, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${part.id}.uipart.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
      alert("导出零件包失败");
    }
  };

  const handleCopyCode = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const handleDelete = async () => {
    if (confirm(`确定要从本地零件库删除「${part.title}」吗？`)) {
      setIsDeleting(true);
      try {
        await UIPartRepository.delete(part.id);
        onDeleted();
        onClose();
      } catch (err: any) {
        alert(err?.message || "删除失败");
      } finally {
        setIsDeleting(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-4xl max-h-[92vh] rounded-2xl border border-white/15 bg-[#0a0d14] shadow-2xl text-slate-100 flex flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0e131f]/70">
          <div className="flex items-center gap-3">
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold tracking-wider border uppercase ${
                part.lifecycle === "validated"
                  ? "bg-emerald-950/80 text-emerald-300 border-emerald-800"
                  : part.lifecycle === "prototyped"
                  ? "bg-amber-950/80 text-amber-300 border-amber-800"
                  : part.lifecycle === "enriched"
                  ? "bg-sky-950/80 text-sky-300 border-sky-800"
                  : "bg-slate-800 text-slate-300 border-slate-700"
              }`}
            >
              {part.lifecycle}
            </span>
            <span className="px-2 py-0.5 rounded text-xs font-mono uppercase bg-white/5 text-slate-400 border border-white/10">
              {part.kind}
            </span>
            <h2 className="text-lg font-bold text-white tracking-tight">
              {part.title}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPackage}
              title="导出独立便携零件包 (.uipart.json)"
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 transition flex items-center gap-1.5"
            >
              <span>📦</span>
              <span>导出包</span>
            </button>
            <button
              onClick={() => onEdit(part)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 transition flex items-center gap-1.5"
            >
              <span>✏️</span>
              <span>编辑</span>
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition"
            >
              删除
            </button>
            <button
              onClick={onClose}
              className="ml-2 p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section: Live Prototype & Preview */}
          <div>
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
              VISUAL SPECIMEN & PROTOTYPE
            </h3>
            <UIPartPrototypeViewer part={part} />
          </div>

          {/* Section: Summary & Overview */}
          {part.summary && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-1">
                SUMMARY
              </h4>
              <p className="text-sm text-slate-200 leading-relaxed font-sans">
                {part.summary}
              </p>
            </div>
          )}

          {/* Section: Portable Principle (The Core Law) */}
          {part.design?.portablePrinciple && (
            <div className="rounded-xl border border-sky-500/20 bg-sky-950/20 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sky-400 text-xs font-mono uppercase tracking-wider font-semibold">
                <span>⚡ PORTABLE PRINCIPLE (核心迁移法则)</span>
              </div>
              <p className="text-sm text-sky-100 font-mono bg-black/40 p-3 rounded-lg border border-sky-500/20">
                "{part.design.portablePrinciple.rule}"
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">
                {part.design.portablePrinciple.zh}
              </p>
            </div>
          )}

          {/* Section: Sources */}
          {part.sources && part.sources.length > 0 && (
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                PRIMARY & SECONDARY SOURCES
              </h3>
              <div className="space-y-2">
                {part.sources.map((src) => (
                  <div
                    key={src.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/[0.02]"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white">
                          {src.title}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-white/5 text-slate-400">
                          {src.type}
                        </span>
                        {src.primary && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-emerald-500/20 text-emerald-300">
                            Primary
                          </span>
                        )}
                      </div>
                      {src.notes && (
                        <p className="text-xs text-slate-400 mt-1">{src.notes}</p>
                      )}
                    </div>
                    {src.url && (
                      <button
                        onClick={() => openExternalUrl(src.url!)}
                        className="text-xs text-sky-400 hover:text-sky-300 underline font-mono flex items-center gap-1 ml-4 whitespace-nowrap"
                      >
                        <span>访问源</span>
                        <span>↗</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section: Essential Mechanisms vs Optional Characteristics */}
          {part.design &&
            (part.design.essentialMechanisms ||
              part.design.optionalCharacteristics) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {part.design.essentialMechanisms && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <h4 className="text-xs font-mono uppercase tracking-wider text-emerald-400 mb-2 flex items-center gap-1.5">
                      <span>✓</span>
                      <span>ESSENTIAL MECHANISMS (本质机制)</span>
                    </h4>
                    <ul className="space-y-1.5 text-xs text-slate-300">
                      {part.design.essentialMechanisms.map((m, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-emerald-500 font-mono font-bold">•</span>
                          <span>{m}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {part.design.optionalCharacteristics && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                      <span>○</span>
                      <span>OPTIONAL (可剥离的原产品特性)</span>
                    </h4>
                    <ul className="space-y-1.5 text-xs text-slate-400">
                      {part.design.optionalCharacteristics.map((opt, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-slate-600 font-mono font-bold">•</span>
                          <span>{opt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

          {/* Section: Design DNA */}
          {part.design?.designDNA && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
                DESIGN DNA (设计基因矩阵)
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {Object.entries(part.design.designDNA).map(([key, val]) => (
                  <div key={key} className="p-2.5 rounded bg-black/40 border border-white/5">
                    <span className="block text-[10px] font-mono uppercase text-slate-500">
                      {key}
                    </span>
                    <span className="text-slate-200 mt-0.5 block leading-relaxed">
                      {val}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section: Evidence Matrix & Experimental Parameters */}
          {part.evidence && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
              <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400">
                EVIDENCE GRADES (真实证据等级)
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Structure", val: part.evidence.structure },
                  { label: "Behavior", val: part.evidence.behavior },
                  { label: "Visual", val: part.evidence.visual },
                  { label: "Source Code", val: part.evidence.sourceCode },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="p-3 rounded-lg bg-black/30 border border-white/5 flex flex-col justify-between"
                  >
                    <span className="text-[11px] text-slate-400 font-mono">
                      {item.label}
                    </span>
                    <span
                      className={`text-xs font-mono font-bold uppercase mt-1 ${
                        item.val === "verified"
                          ? "text-emerald-400"
                          : item.val === "observed"
                          ? "text-sky-400"
                          : item.val === "derived"
                          ? "text-amber-400"
                          : "text-slate-500"
                      }`}
                    >
                      {item.val || "unverified"}
                    </span>
                  </div>
                ))}
              </div>

              {part.evidence.notes && part.evidence.notes.length > 0 && (
                <div className="mt-2 text-xs text-slate-400 space-y-1">
                  {part.evidence.notes.map((n, i) => (
                    <p key={i} className="flex items-start gap-1.5">
                      <span className="text-amber-500/80">⚠️</span>
                      <span>{n}</span>
                    </p>
                  ))}
                </div>
              )}

              {/* Implementation Parameters with Derived Notice */}
              {part.implementation?.parameters && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <h5 className="text-[11px] font-mono text-slate-400 uppercase mb-2">
                    EXPERIMENTAL IMPLEMENTATION PARAMETERS (实测推导参数)
                  </h5>
                  <div className="space-y-2">
                    {Object.entries(part.implementation.parameters).map(
                      ([key, param]) => (
                        <div
                          key={key}
                          className="p-2.5 rounded bg-black/40 border border-white/5 flex items-start justify-between text-xs"
                        >
                          <div>
                            <span className="font-mono text-sky-300 font-semibold">
                              {key}: {String(param.value)}
                              {param.unit || ""}
                            </span>
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-amber-500/20 text-amber-300">
                              {param.status}
                            </span>
                            {param.notes && (
                              <p className="text-[11px] text-slate-400 mt-1">
                                {param.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section: Code Assets & Exporters */}
          {part.assets?.codeAssets && part.assets.codeAssets.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400">
                  CODE ASSETS & EXPORTS
                </h4>
                <div className="flex gap-2">
                  {part.assets.codeAssets.map((asset, idx) => (
                    <button
                      key={asset.id}
                      onClick={() => setActiveCodeTab(idx)}
                      className={`px-3 py-1 rounded text-xs font-mono transition ${
                        activeCodeTab === idx
                          ? "bg-white/15 text-white border border-white/10"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {asset.filename}
                    </button>
                  ))}
                </div>
              </div>

              {part.assets.codeAssets[activeCodeTab] && (
                <div className="relative rounded-lg border border-white/10 bg-[#06080d] p-4 overflow-hidden">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/5 text-xs text-slate-400 font-mono">
                    <span>
                      {part.assets.codeAssets[activeCodeTab].description ||
                        part.assets.codeAssets[activeCodeTab].filename}
                    </span>
                    <button
                      onClick={() =>
                        handleCopyCode(
                          part.assets!.codeAssets![activeCodeTab].id,
                          part.assets!.codeAssets![activeCodeTab].content,
                        )
                      }
                      className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-slate-200 transition text-[11px]"
                    >
                      {copiedCodeId ===
                      part.assets!.codeAssets![activeCodeTab].id
                        ? "✓ 已复制"
                        : "复制代码"}
                    </button>
                  </div>
                  <pre className="text-xs font-mono text-slate-300 overflow-x-auto max-h-[280px] leading-relaxed">
                    <code>{part.assets.codeAssets[activeCodeTab].content}</code>
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Section: Notes & Tags */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs border-t border-white/10">
            <div className="flex items-center gap-1.5 flex-wrap">
              {part.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded bg-white/5 text-slate-300 font-mono text-[11px] border border-white/5"
                >
                  #{tag}
                </span>
              ))}
            </div>
            <div className="text-slate-500 font-mono text-[11px]">
              ID: {part.id} │ Updated: {new Date(part.updatedAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
