/**
 * Setup Center — Task Execution Console Modal
 *
 * Observes running tasks via TaskManager and streaming task-event channels.
 * Strictly decoupled from task dispatching:
 * - Effect only observes and subscribes, never executing commands directly (B08)
 * - Subscription generation-guarded against StrictMode & rapid remounts
 * - Catch-up via get_task_events ensures no logs lost between start & subscribe
 * - Log ring buffer capped at 512 KiB with preserved newline & truncation flags
 * - Auto-scroll follows output only when the user is already at the bottom
 * - Independent Cancel Task button calls cancel_task without killing on unmount
 */

import { useState, useEffect, useRef } from "react";
import clsx from "clsx";
import { AccessibleDialog } from "./AccessibleDialog";
import {
  onTaskEvent,
  getTaskEvents,
  queryTask,
  cancelTask,
  revealInExplorer,
  openInEditor,
  detectEditors,
  type DetectedEditor,
  type TaskEventPayload,
} from "../lib/ipc";

export interface LogItem {
  sequence: number;
  stream: "stdout" | "stderr" | "status" | string;
  text: string;
  timestamp: string;
  truncated?: boolean;
}

export interface ExecutionConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId?: string | null;
  title?: string;
  targetPath?: string;
  onSuccess?: () => void;
  // Legacy / display properties for backwards compatibility
  command?: string;
  args?: string[];
  cwd?: string;
  legacyOutput?: string;
}

const MAX_LOG_CHARS = 512 * 1024; // 512 KiB buffer ceiling

export function ExecutionConsoleModal({
  isOpen,
  onClose,
  taskId,
  title = "任务执行控制台",
  targetPath,
  onSuccess,
  command,
  args,
  cwd,
  legacyOutput,
}: ExecutionConsoleModalProps) {
  const [status, setStatus] = useState<
    "idle" | "running" | "success" | "failed" | "cancelled" | "interrupted" | "needsAttention" | "notFound"
  >("idle");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const generationRef = useRef(0);
  const hasTriggeredSuccessRef = useRef(false);

  // Probe available editors on mount
  useEffect(() => {
    if (isOpen) {
      detectEditors()
        .then((eds) => setEditors(eds.filter((e) => e.installed)))
        .catch(() => setEditors([]));
    }
  }, [isOpen]);

  // Append log item maintaining 512 KiB capped ring buffer and deduplication
  const appendLogs = (newItems: LogItem[]) => {
    setLogs((prev) => {
      const existingSeqs = new Set(prev.map((l) => l.sequence));
      const filtered = newItems.filter((item) => !existingSeqs.has(item.sequence));
      if (filtered.length === 0) return prev;

      const merged = [...prev, ...filtered].sort((a, b) => a.sequence - b.sequence);

      // Enforce 512 KiB character ceiling
      let totalChars = merged.reduce((acc, item) => acc + item.text.length, 0);
      let startIndex = 0;
      while (totalChars > MAX_LOG_CHARS && startIndex < merged.length - 1) {
        totalChars -= merged[startIndex].text.length;
        startIndex++;
      }

      if (startIndex > 0) {
        const sliced = merged.slice(startIndex);
        if (sliced.length > 0) {
          sliced[0] = { ...sliced[0], truncated: true };
        }
        return sliced;
      }
      return merged;
    });
  };

  // Scroll tracking: only auto-scroll if user is already at the bottom
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
    isAtBottomRef.current = atBottom;
  };

  useEffect(() => {
    if (isAtBottomRef.current && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // Main Effect: strictly observes task without initiating any process execution
  useEffect(() => {
    if (!isOpen) {
      setStatus("idle");
      setLogs([]);
      setExitCode(null);
      setSubscriptionError(null);
      setElapsed(0);
      hasTriggeredSuccessRef.current = false;
      return;
    }

    hasTriggeredSuccessRef.current = false;

    if (!taskId) {
      // Legacy read-only fallback display
      if (legacyOutput) {
        setLogs([
          {
            sequence: 1,
            stream: "stdout",
            text: legacyOutput,
            timestamp: new Date().toISOString(),
          },
        ]);
        setStatus("success");
      }
      return;
    }

    const currentGen = ++generationRef.current;
    let disposed = false;
    let unlistenFn: (() => void) | null = null;
    let maxSequence = 0;

    setStatus("running");
    setSubscriptionError(null);
    setLogs([]);
    setElapsed(0);
    setIsCancelling(false);

    const timer = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    // 1. Subscribe to live task-event streaming channel
    onTaskEvent((payload: TaskEventPayload) => {
      if (disposed || generationRef.current !== currentGen) return;
      if (payload.taskId !== taskId) return;

      if (payload.sequence > maxSequence) {
        maxSequence = payload.sequence;
      }

      appendLogs([
        {
          sequence: payload.sequence,
          stream: payload.stream,
          text: payload.text,
          timestamp: payload.timestamp,
          truncated: payload.truncated,
        },
      ]);

      if (payload.status) {
        const s = payload.status.toLowerCase();
        if (s === "succeeded" || s === "success") {
          clearInterval(timer);
          setStatus("success");
          if (!hasTriggeredSuccessRef.current) {
            hasTriggeredSuccessRef.current = true;
            onSuccess?.();
          }
        } else if (s === "failed" || s === "error") {
          clearInterval(timer);
          setStatus("failed");
        } else if (s === "cancelled") {
          clearInterval(timer);
          setStatus("cancelled");
        } else if (s === "interrupted") {
          clearInterval(timer);
          setStatus("interrupted");
        } else if (s === "needsattention") {
          clearInterval(timer);
          setStatus("needsAttention");
        } else if (s === "notfound") {
          setStatus("notFound");
        }
      }

      if (payload.exitCode !== undefined && payload.exitCode !== null) {
        setExitCode(payload.exitCode);
      }
    })
      .then((unlisten) => {
        if (disposed || generationRef.current !== currentGen) {
          unlisten();
          return;
        }
        unlistenFn = unlisten;

        // 2. Fetch buffered catch-up events from sequence 0
        getTaskEvents(taskId, 0)
          .then((events) => {
            if (disposed || generationRef.current !== currentGen) return;
            if (events && events.length > 0) {
              const items: LogItem[] = events.map((ev) => ({
                sequence: ev.sequence,
                stream: ev.stream,
                text: ev.text,
                timestamp: ev.timestamp,
                truncated: ev.truncated,
              }));
              appendLogs(items);
              const highestSeq = Math.max(...events.map((e) => e.sequence));
              if (highestSeq > maxSequence) {
                maxSequence = highestSeq;
              }
            }

            // 3. Query current task terminal status
            queryTask(taskId)
              .then((view) => {
                if (disposed || generationRef.current !== currentGen) return;
                const s = view.status.toLowerCase();
                if (!["running", "queued"].includes(s)) clearInterval(timer);
                if (s === "succeeded" || s === "success") {
                  setStatus("success");
                  if (!hasTriggeredSuccessRef.current) {
                    hasTriggeredSuccessRef.current = true;
                    onSuccess?.();
                  }
                } else if (s === "failed") {
                  setStatus("failed");
                } else if (s === "cancelled") {
                  setStatus("cancelled");
                } else if (s === "interrupted") {
                  setStatus("interrupted");
                } else if (s === "needsattention") {
                  setStatus("needsAttention");
                } else if (s === "notfound") {
                  setStatus("notFound");
                }
                if (view.exitCode !== undefined && view.exitCode !== null) {
                  setExitCode(view.exitCode);
                }
              })
              .catch((error) => {
                if (disposed || generationRef.current !== currentGen) return;
                setSubscriptionError(`读取任务状态失败: ${String(error)}`);
              });
          })
          .catch((err) => {
            if (disposed || generationRef.current !== currentGen) return;
            setSubscriptionError(`读取任务前序事件失败: ${String(err)}`);
          });
      })
      .catch((err) => {
        if (disposed || generationRef.current !== currentGen) return;
        setSubscriptionError(`无法建立任务事件订阅: ${String(err)}`);
      });

    return () => {
      disposed = true;
      clearInterval(timer);
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [isOpen, taskId, legacyOutput]);

  // Independent cancellation calling cancel_task
  const handleCancelTask = async () => {
    if (!taskId || status !== "running") return;
    setIsCancelling(true);
    try {
      const ok = await cancelTask(taskId);
      if (ok) {
        setActionNotice("已请求终止任务");
      } else {
        setActionNotice("任务已结束或无法终止");
      }
    } catch (err) {
      setActionNotice(`终止任务失败: ${String(err)}`);
    } finally {
      setIsCancelling(false);
      setTimeout(() => setActionNotice(null), 3000);
    }
  };

  const handleReveal = async () => {
    const p = targetPath || cwd;
    if (!p) return;
    try {
      await revealInExplorer(p);
      setActionNotice("已在资源管理器中展示");
      setTimeout(() => setActionNotice(null), 2500);
    } catch {
      setActionNotice("无法打开资源管理器");
      setTimeout(() => setActionNotice(null), 2500);
    }
  };

  const handleOpenEditor = async (editorId: string) => {
    const p = targetPath || cwd;
    if (!p) return;
    try {
      await openInEditor(editorId, p);
      setActionNotice(`已在 ${editorId} 中打开工程`);
      setTimeout(() => setActionNotice(null), 2500);
    } catch {
      setActionNotice(`启动 ${editorId} 失败`);
      setTimeout(() => setActionNotice(null), 2500);
    }
  };

  if (!isOpen) return null;

  const fullCommandLine = command
    ? `${command} ${args ? args.join(" ")}`
    : taskId
    ? `Task: ${taskId}`
    : "任务执行";

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      titleId="execution-console-title"
      dataProtectedUi={true}
      className="z-60 p-4 sm:p-6"
      backdropClassName="bg-black/70"
      contentClassName="flex h-full w-full max-h-[85vh] max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-[#0f1217] text-zinc-100 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)]"
    >
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-[#141820] px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span
            className={clsx(
              "h-2.5 w-2.5 rounded-full",
              status === "running" && "bg-amber-400 animate-pulse",
              status === "success" && "bg-emerald-400",
              status === "failed" && "bg-rose-500",
              status === "cancelled" && "bg-zinc-500",
              status === "interrupted" && "bg-amber-500",
              status === "needsAttention" && "bg-orange-500",
              status === "notFound" && "bg-zinc-600",
            )}
          />
          <h3 id="execution-console-title" className="text-[15px] font-bold text-white">
            {title}
          </h3>
          {taskId && (
            <span className="font-mono text-[11px] text-zinc-500 truncate max-w-xs">
              [{taskId}]
            </span>
          )}
          <span className="font-mono text-[11px] text-zinc-400">耗时: {elapsed}s</span>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="关闭控制台"
          className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded-md border border-zinc-700 px-2.5 text-[12px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
        >
          ✕
        </button>
      </header>

        {/* Command or Task Header */}
        <div className="border-b border-zinc-800/90 bg-[#12151b] px-5 py-2.5 font-mono text-[12px] text-zinc-300 flex items-center justify-between gap-4">
          <div className="truncate">
            <span className="text-zinc-500 select-none">$ </span>
            <span className="text-blue-300">{fullCommandLine}</span>
          </div>
          {cwd && (
            <span className="shrink-0 text-[11px] text-zinc-500 truncate max-w-xs">
              cwd: {cwd}
            </span>
          )}
        </div>

        {/* Subscription error banner */}
        {subscriptionError && (
          <div className="bg-rose-950/70 border-b border-rose-800/80 px-5 py-2 text-[12px] text-rose-200">
            ⚠️ {subscriptionError}
          </div>
        )}

        {/* Console Body */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto bg-[#090b0e] p-4 font-mono text-[12px] leading-relaxed text-zinc-300 select-text space-y-2"
        >
          {status === "running" && (
            <div className="text-zinc-400 flex items-center justify-between gap-2 border-b border-zinc-900 pb-2">
              <div className="flex items-center gap-2">
                <span className="inline-block animate-spin">◷</span>
                <span>正在监听任务实时执行日志…</span>
              </div>
              <button
                type="button"
                onClick={handleCancelTask}
                disabled={isCancelling}
                className="rounded border border-rose-800/70 bg-rose-950/40 px-2.5 py-0.5 text-[11px] font-bold text-rose-300 hover:bg-rose-900/60 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isCancelling ? "终止中…" : "✕ 终止任务"}
              </button>
            </div>
          )}

          {logs.map((log) => {
            const isErr = log.stream === "stderr";
            return (
              <div
                key={log.sequence}
                className={clsx(
                  "whitespace-pre-wrap font-mono text-[12px]",
                  isErr ? "text-amber-300 bg-amber-950/20 p-1.5 rounded" : "text-zinc-200",
                )}
              >
                {log.truncated && (
                  <span className="text-zinc-500 text-[11px] block mb-1">
                    [...前序日志已超出 512 KiB 缓冲区截断...]
                  </span>
                )}
                <span>{log.text}</span>
              </div>
            );
          })}

          {status === "cancelled" && (
            <div className="rounded border border-rose-900/60 bg-rose-950/50 p-3 text-rose-300 font-bold text-[12px]">
              ✕ 任务已被手动终止 (Task Cancelled)
            </div>
          )}

          {status === "interrupted" && (
            <div className="rounded border border-amber-900/60 bg-amber-950/50 p-3 text-amber-300 font-bold text-[12px]">
              ⚠️ 任务被外部中断或上次运行未完成 (Task Interrupted)
            </div>
          )}

          {status === "needsAttention" && (
            <div className="rounded border border-orange-900/60 bg-orange-950/50 p-3 text-orange-300 font-bold text-[12px]">
              ⚠️ 任务暂停，需要人工介入确认 (Needs Attention)
            </div>
          )}

          {status === "notFound" && (
            <div className="rounded border border-zinc-700 bg-zinc-800/60 p-3 text-zinc-400 font-bold text-[12px]">
              ℹ️ 未找到指定任务记录 (Task Not Found)
            </div>
          )}

          {status === "success" && (
            <div className="mt-3 rounded border border-emerald-900/60 bg-emerald-950/30 p-3 text-emerald-300">
              ✓ 任务执行完成（退出码: {exitCode ?? 0}）
            </div>
          )}

          {status === "failed" && (
            <div className="rounded border border-rose-900/60 bg-rose-950/40 p-3 text-rose-300">
              <div className="font-bold text-[12.5px] mb-1">任务执行失败：</div>
              <pre className="whitespace-pre-wrap font-mono text-[11.5px]">
                退出码: {exitCode ?? -1}
              </pre>
            </div>
          )}

          <div ref={consoleEndRef} />
        </div>

        {/* Footer Actions */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-[#141820] px-5 py-3">
          <div className="flex items-center gap-2 text-[12px] text-zinc-400">
            {actionNotice && <span className="text-emerald-400 font-bold">{actionNotice}</span>}
          </div>

          <div className="flex items-center gap-2.5">
            {status === "running" && (
              <button
                type="button"
                onClick={handleCancelTask}
                disabled={isCancelling}
                aria-label="终止当前运行任务"
                className="min-h-[32px] rounded-lg border border-rose-800/80 bg-rose-950/50 px-3.5 py-1.5 text-[12px] font-bold text-rose-300 hover:bg-rose-900/60 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isCancelling ? "终止中…" : "终止任务"}
              </button>
            )}

            {status === "success" && (targetPath || cwd) && (
              <>
                <button
                  type="button"
                  onClick={handleReveal}
                  aria-label="在资源管理器中定位工程目录"
                  className="min-h-[32px] rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-[12px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
                >
                  在资源管理器中定位
                </button>

                {editors.map((ed) => (
                  <button
                    key={ed.id}
                    type="button"
                    onClick={() => handleOpenEditor(ed.id)}
                    aria-label={`在 ${ed.name} 中打开工程`}
                    className="min-h-[32px] rounded-lg border border-blue-600/40 bg-blue-900/20 px-3 py-1.5 text-[12px] font-medium text-blue-300 hover:bg-blue-800/30 transition-colors cursor-pointer"
                  >
                    在 {ed.name} 中打开
                  </button>
                ))}
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label={status === "running" ? "在后台继续运行任务并关闭视图" : "关闭控制台视图"}
              className="min-h-[32px] rounded-lg border border-zinc-700 bg-transparent px-4 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
            >
              {status === "running" ? "后台运行 (关闭视图)" : "关闭"}
            </button>
          </div>
        </footer>
    </AccessibleDialog>
  );
}
