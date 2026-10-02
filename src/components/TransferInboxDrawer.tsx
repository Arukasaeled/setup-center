import { useState, useEffect } from "react";
import { Button } from "./ui";
import { TransferInbox, type TransferInboxItem } from "../core/transfer";

export interface TransferInboxDrawerProps {
  onClose: () => void;
}

export function TransferInboxDrawer({ onClose }: TransferInboxDrawerProps) {
  const [items, setItems] = useState<TransferInboxItem[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [suggestedType, setSuggestedType] = useState<TransferInboxItem["suggestedType"]>("resource");
  const [suggestedCategory, setSuggestedCategory] = useState("tools");

  useEffect(() => {
    setItems(TransferInbox.getAll());
    return TransferInbox.subscribe((updated) => setItems(updated));
  }, []);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    TransferInbox.add({
      url: url.trim(),
      title: title.trim() || undefined,
      note: note.trim() || undefined,
      suggestedType,
      suggestedCategory,
    });

    setUrl("");
    setTitle("");
    setNote("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-[color:var(--line-strong)] bg-[color:var(--surface-raised)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[color:var(--line-subtle)] bg-[color:var(--surface-base)]">
          <div>
            <div className="text-[11px] font-black uppercase tracking-wider text-[color:var(--status-accent)]">
              TRANSFER INBOX // 候选资产收集箱
            </div>
            <h2 className="text-[17px] font-bold text-[color:var(--text-strong)] mt-0.5">
              外部链接待处理队列 ({items.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[color:var(--text-tertiary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)]"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Quick Capture Input */}
          <form onSubmit={handleAdd} className="rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-sunken)] p-4 flex flex-col gap-3">
            <div className="text-[12px] font-bold text-[color:var(--text-strong)] flex items-center gap-1.5">
              <span>+ 快速投递外部资产 / 网址</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/..."
                className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-base)] px-3 py-1.5 text-[12.5px] text-[color:var(--text-strong)] font-mono focus:border-[color:var(--status-accent)] focus:outline-none sm:col-span-2"
              />
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="项目 / 资产名称 (可选)"
                className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-base)] px-3 py-1.5 text-[12.5px] text-[color:var(--text-strong)] focus:border-[color:var(--status-accent)] focus:outline-none"
              />
              <div className="flex gap-2">
                <select
                  value={suggestedType}
                  onChange={(e) => setSuggestedType(e.target.value as TransferInboxItem["suggestedType"])}
                  className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-base)] px-2.5 py-1.5 text-[12px] text-[color:var(--text-strong)] focus:border-[color:var(--status-accent)] focus:outline-none flex-1"
                >
                  <option value="resource">资源 (Resource)</option>
                  <option value="template">模板 (Template)</option>
                  <option value="style">风格 (Style)</option>
                  <option value="pattern">组件 (Pattern)</option>
                </select>
                <input
                  type="text"
                  value={suggestedCategory}
                  onChange={(e) => setSuggestedCategory(e.target.value)}
                  placeholder="分类 (tools, frontend)"
                  className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-base)] px-2 py-1.5 text-[11.5px] text-[color:var(--text-strong)] focus:border-[color:var(--status-accent)] focus:outline-none w-28"
                />
                <button
                  type="submit"
                  className="rounded-lg px-3 py-1.5 text-[12px] font-bold bg-[color:var(--status-accent)] text-black hover:opacity-90 shrink-0"
                >
                  加入收件箱
                </button>
              </div>
            </div>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="添加推荐理由或流转备注..."
              className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-base)] px-3 py-1.5 text-[12px] text-[color:var(--text-strong)] focus:border-[color:var(--status-accent)] focus:outline-none"
            />
          </form>

          {/* Items List */}
          <div className="space-y-3">
            <div className="text-[12px] font-semibold text-[color:var(--text-secondary)]">
              待规整资产列表
            </div>
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[color:var(--line-subtle)] p-8 text-center text-[12.5px] text-[color:var(--text-quiet)]">
                收集箱目前为空。浏览网页发现好项目时，随时粘贴至上方！
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[13px] text-[color:var(--text-strong)] truncate">
                        {item.title || item.url}
                      </span>
                      <span className="rounded bg-[color:var(--surface-hover)] px-2 py-0.2 text-[10.5px] font-mono text-[color:var(--text-quiet)] border border-[color:var(--line-subtle)]">
                        {item.suggestedType}
                      </span>
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11.5px] text-[color:var(--status-accent)] font-mono hover:underline truncate block mt-0.5"
                    >
                      {item.url}
                    </a>
                    {item.note && (
                      <p className="text-[11.5px] text-[color:var(--text-tertiary)] mt-1">
                        {item.note}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => TransferInbox.updateStatus(item.id, "processed")}
                      className={`text-[11px] px-2 py-1 rounded border font-semibold ${
                        item.status === "processed"
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : "border-[color:var(--line-subtle)] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-strong)]"
                      }`}
                    >
                      {item.status === "processed" ? "已入库" : "标记完成"}
                    </button>
                    <button
                      type="button"
                      onClick={() => TransferInbox.remove(item.id)}
                      className="text-[11px] px-2 py-1 rounded text-rose-400 hover:bg-rose-500/10"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[color:var(--line-subtle)] bg-[color:var(--surface-base)]">
          <span className="text-[11.5px] text-[color:var(--text-quiet)]">
            Agent 可通过 TRANSFER.md 协议直接读取并处理此队列
          </span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
