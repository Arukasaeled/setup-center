/**
 * Screen 2 — Environment detection.
 *
 * Shows the six checks as a live list, then the scored result. Two decisions
 * worth noting:
 *
 * 1. The check list is *not* a fake animation. Each row reflects a real
 *    `Signal` from Rust, including "无法确认" rows — because a student whose
 *    network probe failed needs to know that, not to be shown a green tick.
 *
 * 2. Blocking problems are hoisted to the top with their `hint` text, and the
 *    continue button changes label. Blocking is advisory, not a hard gate: the
 *    install may still succeed (winget falls back to vendor installers), so we
 *    let the user proceed but stop pretending everything is fine.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, SectionLabel, ScoreReadout, StatusMark } from "../components/ui";
import { BackButton } from "../components/BackButton";
import { useApp } from "../lib/store";
import type { Signal } from "../lib/types";

export function DetectScreen() {
  const detect = useApp((s) => s.detect);
  const environment = useApp((s) => s.environment);
  const runDetection = useApp((s) => s.runDetection);
  const goTo = useApp((s) => s.goTo);

  const blindCount = useMemo(
    () => environment?.signals.filter((s) => s.confidence === "unknown").length ?? 0,
    [environment],
  );
  const problems = useMemo(
    () =>
      environment?.signals.filter(
        (s) => s.confidence === "fail" || s.confidence === "unknown",
      ) ?? [],
    [environment],
  );

  const running = detect.kind === "running" || detect.kind === "idle";
  const failed = detect.kind === "error";

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <header className="fade shrink-0">
        <h2 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          系统检测
        </h2>
        <p className="text-[color:var(--text-quiet)] mt-1 text-[13px]">
          {running ? "正在检查系统环境与已装软件" : "检测完成"}
        </p>
      </header>

      <div className="mt-7 flex-1 overflow-y-auto pr-1">
        {running && <RunningProbeList completed={detect.kind === "running" ? detect.completed : []} current={detect.kind === "running" ? detect.current : "准备中…"} />}

        {failed && (
          <div className="glass-soft rise rounded-[12px] p-5">
            <div className="text-[color:var(--status-bad)] mb-1.5 text-[13px] font-medium">检测失败</div>
            <p className="text-[color:var(--text-secondary)] selectable text-[13px]">{detect.message}</p>
            <Button
              variant="ghost"
              size="md"
              className="mt-4"
              onClick={() => void runDetection()}
            >
              重新检测
            </Button>
          </div>
        )}

        {environment && !running && (
          <div className="flex flex-col gap-7">
            <div className="stagger flex flex-col gap-2.5">
              {environment.signals.map((signal) => (
                <SignalRow key={signal.key} signal={signal} />
              ))}
            </div>

            <div className="rise" style={{ animationDelay: "300ms" }}>
              <SectionLabel>环境评分</SectionLabel>
              <div className="glass rounded-[14px] px-5 py-4">
                <ScoreReadout
                  score={environment.score}
                  max={environment.scoreMax}
                />
              </div>
            </div>

            {problems.length > 0 && (
              <div className="rise" style={{ animationDelay: "360ms" }}>
                <SectionLabel>需要注意</SectionLabel>
                <div className="flex flex-col gap-2">
                  {problems.map((signal) => (
                    <div
                      key={signal.key}
                      className="border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/60 flex gap-3 rounded-[10px] border px-3.5 py-3"
                    >
                      <StatusMark confidence={signal.confidence} />
                      <div className="min-w-0">
                        <div className="text-[color:var(--text-primary)] text-[13px] font-medium">
                          {signal.label}
                        </div>
                        <div className="text-[color:var(--text-tertiary)] mt-0.5 text-[12.5px] leading-relaxed">
                          {signal.hint ?? signal.value}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {blindCount > 0 && (
              <p className="text-[color:var(--text-quiet)] text-[12.5px]">
                有 {blindCount} 项检测无法确认结果。这类项目不计为失败，安装时程序会自动改用备选方案。
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="fade mt-6 flex shrink-0 items-center justify-between border-t border-[color:var(--line-subtle)] pt-5">
        <BackButton />
        <div className="flex items-center gap-3">
          {environment && (
            <Button variant="quiet" onClick={() => void runDetection()}>
              重新检测
            </Button>
          )}
          <Button disabled={running || failed} onClick={() => goTo("software")}>
            {problems.length > 0 ? "仍然继续" : "继续"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

/** Live probe list, shown only while the real detection call is in flight. */
function RunningProbeList({
  completed,
  current,
}: {
  completed: string[];
  current: string;
}) {
  // A visible second-by-second clock.
  //
  // Two defects met on this screen. First, the probe ran *synchronously on the
  // main thread*, so the webview could not repaint and the window could not be
  // dragged — the UI was genuinely frozen, and no amount of spinner markup
  // would have shown through. That is fixed in `commands.rs` by moving the work
  // off the main thread.
  //
  // Second, once frames do paint, the spinner alone still does not answer the
  // question a student actually has while staring at it: "is this stuck?" A
  // ticking clock does, and it is honest — it reports elapsed time, not
  // progress. The bar below deliberately stays indeterminate for the same
  // reason: this work has no measurable percentage, so none is shown.
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-2.5">
      {completed.map((label) => (
        <div
          key={label}
          className="fade border-[color:var(--line-subtle)] flex items-center gap-3 rounded-[10px] border px-4 py-3"
        >
          <StatusMark confidence="ok" />
          <span className="text-[color:var(--text-secondary)] text-[13.5px]">{label}</span>
        </div>
      ))}
      <div className="border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/50 relative overflow-hidden rounded-[10px] border px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="border-accent/30 border-t-accent h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px]" />
          <span className="text-[color:var(--text-primary)] flex-1 text-[13.5px]">{current}</span>
          <span className="text-[color:var(--text-quiet)] tnum shrink-0 text-[12px]">
            已用时 {seconds} 秒
          </span>
        </div>
        {/* Indeterminate sweep: this work has no measurable percentage, so the
            bar must not imply one. */}
        <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <div className="sweep-active from-accent/0 via-accent/60 to-accent/0 h-full w-1/3 bg-gradient-to-r" />
        </div>
      </div>

      {/* Reassurance, because a first-run student has no idea how long this
          should take and a bare spinner invites them to force-quit the app. */}
      {seconds >= 6 && (
        <p className="text-[color:var(--text-quiet)] px-1 text-[12.5px]">
          正在读取注册表和 PATH，第一次检测通常需要十几秒。窗口可以正常拖动，不会卡死。
        </p>
      )}

      {Array.from({ length: Math.max(0, 3 - completed.length) }, (_, i) => (
        <div
          key={i}
          className="border-[color:var(--line-subtle)]/60 rounded-[10px] border border-dashed px-4 py-3"
        >
          <span className="text-[color:var(--text-quiet)] text-[13.5px]">待检测</span>
        </div>
      ))}
    </div>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(signal.hint);

  return (
    <div
      className={
        "group border-[color:var(--line-subtle)] flex flex-col rounded-[10px] border px-4 py-3 transition-colors duration-150 " +
        (signal.confidence === "ok"
          ? "hover:border-[color:var(--line-default)] hover:bg-[color:var(--surface-hover)]"
          : "bg-[color:var(--surface-raised)]/40")
      }
    >
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 text-left disabled:cursor-default"
      >
        <StatusMark confidence={signal.confidence} />
        <span className="text-[color:var(--text-primary)] flex-1 text-[13.5px]">{signal.label}</span>
        <span className="text-[color:var(--text-tertiary)] tnum max-w-[58%] truncate text-right text-[13px]">
          {signal.value}
        </span>
        {hasDetail && (
          <svg
            viewBox="0 0 12 12"
            className={
              "text-[color:var(--text-quiet)] h-3 w-3 shrink-0 transition-transform duration-200 " +
              (open ? "rotate-90" : "")
            }
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
        )}
      </button>

      {open && hasDetail && (
        <p className="fade text-[color:var(--text-tertiary)] mt-2 pl-7 text-[12.5px] leading-relaxed">
          {signal.hint}
        </p>
      )}
    </div>
  );
}

/** Keeps the "running" state from flashing for a single frame on mount. */
export function useMinimumDuration(active: boolean, ms = 400) {
  const [held, setHeld] = useState(active);
  useEffect(() => {
    if (active) {
      setHeld(true);
      return;
    }
    const t = window.setTimeout(() => setHeld(false), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return held;
}
