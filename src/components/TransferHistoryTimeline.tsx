import { useState, useEffect } from "react";
import { SectionLabel, Button } from "./ui";
import { TransferHistory, type TransferHistoryEntry } from "../core/transfer";

export function TransferHistoryTimeline() {
  const [entries, setEntries] = useState<TransferHistoryEntry[]>(() =>
    TransferHistory.getEntries(),
  );

  useEffect(() => {
    return TransferHistory.subscribe((list) => setEntries(list));
  }, []);

  const getActionBadge = (type: TransferHistoryEntry["type"]) => {
    switch (type) {
      case "install":
        return { label: "软件安装", icon: "↓", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" };
      case "download":
        return { label: "资产下载", icon: "⤓", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
      case "scaffold":
        return { label: "脚手架创建", icon: "◩", color: "text-purple-400 bg-purple-500/10 border-purple-500/20" };
      case "sync":
        return { label: "Vault 同步", icon: "↻", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" };
      case "style-switch":
        return { label: "风格切换", icon: "◈", color: "text-pink-400 bg-pink-500/10 border-pink-500/20" };
      case "bookmark":
        return { label: "个人收藏", icon: "★", color: "text-amber-300 bg-amber-400/10 border-amber-400/20" };
      default:
        return { label: "流转记录", icon: "•", color: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20" };
    }
  };

  return (
    <section className="rise">
      <div className="flex items-center justify-between mb-3">
        <div>
          <SectionLabel>Transfer 流转履历</SectionLabel>
          <div className="text-[12px] text-[color:var(--text-quiet)] mt-0.5">
            记录软件安装、文件下载、模板脚手架、Vault 内容同步与风格切换轨迹
          </div>
        </div>
        {entries.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => TransferHistory.clear()}>
            清空履历
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-6 text-center">
          <div className="text-[13px] font-semibold text-[color:var(--text-secondary)]">
            暂无 Transfer 流转记录
          </div>
          <p className="text-[11.5px] text-[color:var(--text-quiet)] mt-1 max-w-md mx-auto">
            当你在 Setup Center 中安装软件、下载开发资产、通过脚手架实例化工程或切换视觉风格时，系统会自动在此沉淀流转履历。
          </p>
        </div>
      ) : (
        <div className="relative border-l border-[color:var(--line-default)] ml-3 pl-5 space-y-4">
          {entries.map((item) => {
            const badge = getActionBadge(item.type);
            const timeStr = new Date(item.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            const dateStr = new Date(item.timestamp).toLocaleDateString([], {
              month: "2-digit",
              day: "2-digit",
            });

            return (
              <div key={item.id} className="relative group">
                {/* Node icon dot on rail */}
                <div className="absolute -left-[27px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--surface-base)] border border-[color:var(--line-strong)] text-[10px]">
                  {badge.icon}
                </div>

                <div className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3 hover:border-[color:var(--line-strong)] transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.2 text-[10px] font-bold border ${badge.color}`}>
                        {badge.label}
                      </span>
                      <span className="text-[13px] font-bold text-[color:var(--text-strong)]">
                        {item.title}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-[color:var(--text-quiet)]">
                      {dateStr} {timeStr}
                    </span>
                  </div>

                  <p className="text-[12px] text-[color:var(--text-secondary)] mt-1.5 leading-relaxed">
                    {item.summary}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
