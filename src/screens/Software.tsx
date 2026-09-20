/**
 * Screen 3 — Software status.
 *
 * Answers the one question stage 2 exists for: **"这台电脑已经有什么？"**
 *
 * Design decisions worth stating:
 *
 * 1. **Not a grid of cards.** "不要大量卡片" from the brief applies most sharply
 *    here, because a list of seven programs is exactly where a card grid is the
 *    tempting default. It is a list instead, with the evidence folded away —
 *    the same pattern as the detection screen, so the app has one way of showing
 *    "we checked something and here is what we found".
 *
 * 2. **`unknown` is a first-class state and gets its own styling.** A program
 *    whose probes all failed shows a dash, not a cross. Rendering it as missing
 *    would tell the student to reinstall software they may already have, which is
 *    the single worst thing this screen could do.
 *
 * 3. **The evidence is shown, not summarised away.** Each row expands to reveal
 *    what every provider said. This is what makes a surprising result ("why does
 *    it think I don't have Git?") answerable by the student rather than
 *    mysterious — and it is the whole reason the Rust side keeps the negative
 *    findings instead of discarding them.
 */

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, SectionLabel, StatusMark } from "../components/ui";
import { SoftwareIcon } from "../components/SoftwareIcon";
import { describeSoftware } from "../lib/software";
import { useApp } from "../lib/store";
import type {
  Confidence,
  EvidenceView,
  ProbeSource,
  SoftwareDescriptor,
  SoftwareInfo,
} from "../lib/types";

export function SoftwareScreen() {
  const inventory = useApp((s) => s.inventory);
  const catalogue = useApp((s) => s.catalogue);
  const phase = useApp((s) => s.inventoryPhase);
  const error = useApp((s) => s.inventoryError);
  const scanInstalled = useApp((s) => s.scanInstalled);
  const goTo = useApp((s) => s.goTo);

  useEffect(() => {
    // Only scan when there is nothing to show. A remount after a back/forward
    // must not re-read the whole registry.
    if (!inventory && phase === "idle") void scanInstalled();
  }, [inventory, phase, scanInstalled]);

  const items = inventory?.items ?? [];
  const installed = items.filter((i) => i.installed);
  const unknown = items.filter((i) => !i.installed && i.confidence === "unknown");
  const missing = items.filter(
    (i) => !i.installed && i.confidence !== "unknown",
  );

  const scanning = phase === "scanning" || phase === "idle";

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <header className="fade shrink-0">
        <h2 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          这台电脑已经有什么
        </h2>
        <p className="text-[color:var(--text-quiet)] mt-1 text-[13px]">
          {scanning
            ? "正在读取已安装的软件…"
            : `检查了 ${items.length} 个软件，${installed.length} 个已安装${
                unknown.length > 0 ? `，${unknown.length} 个无法确认` : ""
              }`}
        </p>
      </header>

      <div className="mt-7 flex-1 overflow-y-auto pr-1">
        {scanning && <ScanningRows />}

        {phase === "error" && (
          <div className="glass-soft rise rounded-[12px] p-5">
            <div className="text-[color:var(--status-bad)] mb-1.5 text-[13px] font-medium">
              无法读取软件信息
            </div>
            <p className="text-[color:var(--text-secondary)] selectable text-[13px]">{error}</p>
            <Button
              variant="ghost"
              size="md"
              className="mt-4"
              onClick={() => void scanInstalled()}
            >
              重新检查
            </Button>
          </div>
        )}

        {!scanning && phase !== "error" && (
          <div className="flex flex-col gap-7">
            {installed.length > 0 && (
              <Group label="已安装" items={installed} catalogue={catalogue} />
            )}
            {missing.length > 0 && (
              <Group label="未安装" items={missing} catalogue={catalogue} />
            )}
            {unknown.length > 0 && (
              <Group label="无法确认" items={unknown} catalogue={catalogue} />
            )}

            {inventory && (
              <p className="text-[color:var(--text-quiet)] text-[12px]">
                检测来源：{inventory.providers.join(" · ")}
                。每个软件展开后可以看到各个来源分别说了什么。
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="fade mt-6 flex shrink-0 items-center justify-between border-t border-[color:var(--line-subtle)] pt-5">
        <Button variant="quiet" onClick={() => goTo("detect")}>
          返回
        </Button>
        <div className="flex items-center gap-3">
          <Button
            variant="quiet"
            disabled={scanning}
            onClick={() => void scanInstalled()}
          >
            重新检查
          </Button>
          <Button disabled={scanning || phase === "error"} onClick={() => goTo("choose")}>
            继续
          </Button>
        </div>
      </footer>
    </div>
  );
}

function Group({
  label,
  items,
  catalogue,
}: {
  label: string;
  items: SoftwareInfo[];
  catalogue: SoftwareDescriptor[];
}) {
  return (
    <div className="rise">
      <SectionLabel>
        {label} · {items.length}
      </SectionLabel>
      <div className="stagger flex flex-col gap-1.5">
        {items.map((item) => (
          <SoftwareRow key={item.id} item={item} catalogue={catalogue} />
        ))}
      </div>
    </div>
  );
}

function SoftwareRow({ item, catalogue }: { item: SoftwareInfo; catalogue: SoftwareDescriptor[] }) {
  const [open, setOpen] = useState(false);
  const meta = describeSoftware(item.id, catalogue);

  return (
    <div
      className={clsx(
        "border-[color:var(--line-subtle)] rounded-[10px] border transition-colors duration-150",
        item.installed
          ? "hover:border-[color:var(--line-default)] hover:bg-[color:var(--surface-hover)]"
          : "bg-[color:var(--surface-raised)]/40",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3.5 px-3.5 py-3 text-left"
      >
        <SoftwareIcon id={item.id} size={28} />

        <StatusMark confidence={item.confidence} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[color:var(--text-primary)] text-[13.5px]">{item.name}</span>
            {item.onPath && (
              <span className="text-[color:var(--text-quiet)] text-[11.5px]">命令行可用</span>
            )}
          </div>
          <div className="text-[color:var(--text-quiet)] truncate text-[12px]">
            {item.installed
              ? [item.version && `版本 ${item.version}`, item.path]
                  .filter(Boolean)
                  .join(" · ") || meta.purpose
              : item.confidence === "unknown"
                ? "检测未完成，无法判断"
                : meta.purpose}
          </div>
        </div>

        <SourceMarks sources={item.sources} />

        <svg
          viewBox="0 0 12 12"
          className={clsx(
            "text-[color:var(--text-quiet)] h-3 w-3 shrink-0 transition-transform duration-200",
            open && "rotate-90",
          )}
          fill="none"
        >
          <path
            d="M4 2.5L7.5 6L4 9.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="fade border-[color:var(--line-subtle)]/70 flex flex-col gap-2 border-t px-3.5 py-3 pl-[68px]">
          {item.evidence.map((ev, i) => (
            <EvidenceLine key={`${ev.source}-${i}`} ev={ev} />
          ))}

          {item.packageId && (
            <div className="text-[color:var(--text-quiet)] mt-0.5 text-[11.5px]">
              winget 包 id：<span className="text-[color:var(--text-tertiary)]">{item.packageId}</span>
            </div>
          )}

          {item.hints.map((hint) => (
            <div
              key={hint}
              className="text-[color:var(--text-tertiary)] border-warn/25 mt-0.5 border-l-2 pl-2.5 text-[12px] leading-relaxed"
            >
              {hint}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The per-source chips on the collapsed row.
 *
 * Exists so that "found by three independent sources" is visible without opening
 * the row — that agreement is the reason a finding is trustworthy, and it is the
 * main thing stage 2 added over a single anonymous check.
 */
function SourceMarks({ sources }: { sources: ProbeSource[] }) {
  if (sources.length === 0) return null;
  return (
    <span className="hidden shrink-0 items-center gap-1 sm:flex">
      {sources.map((source) => (
        <span
          key={source}
          title={sourceLabel(source)}
          className="border-ok/25 text-[color:var(--status-ok)]/90 rounded-[4px] border px-1.5 py-[1px] text-[10.5px]"
        >
          {sourceLabel(source)}
        </span>
      ))}
    </span>
  );
}

function sourceLabel(source: ProbeSource): string {
  switch (source) {
    case "registry":
      return "注册表";
    case "path":
      return "PATH";
    case "winget":
      return "winget";
  }
}

function EvidenceLine({ ev }: { ev: EvidenceView }) {
  const confidence: Confidence =
    ev.outcome === "present"
      ? "ok"
      : ev.outcome === "unavailable"
        ? "unknown"
        : "fail";

  return (
    <div className="flex items-start gap-2.5">
      <StatusMark confidence={confidence} />
      <span className="text-[color:var(--text-tertiary)] w-14 shrink-0 text-[12px]">
        {sourceLabel(ev.source)}
      </span>
      <span className="text-[color:var(--text-secondary)] selectable min-w-0 flex-1 truncate text-[12px]">
        {ev.outcome === "present"
          ? ev.detail ?? "已检测到"
          : ev.outcome === "unavailable"
            ? `无法检查：${ev.detail ?? "未知原因"}`
            : "未找到"}
      </span>
    </div>
  );
}

function ScanningRows() {
  return (
    <div className="flex flex-col gap-1.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="border-[color:var(--line-subtle)]/60 flex items-center gap-3 rounded-[10px] border border-dashed px-3.5 py-3"
        >
          <span className="bg-[color:var(--surface-inset)] h-7 w-7 rounded-[7px]" />
          <span className="bg-[color:var(--surface-inset)] h-3 w-24 rounded" />
          <span className="bg-[color:var(--surface-inset)] h-3 flex-1 rounded" />
        </div>
      ))}
      <p className="text-[color:var(--text-quiet)] mt-1 text-[12.5px]">
        正在通过注册表、PATH 与 winget 三个来源检查…
      </p>
    </div>
  );
}
