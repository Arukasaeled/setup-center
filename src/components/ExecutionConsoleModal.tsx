/**
 * Setup Center — Native Execution Console Modal
 *
 * Provides real-time visibility and transparency for native commands:
 * - winget install
 * - git clone
 * - npm/pnpm scaffold
 *
 * Includes post-execution actions: Reveal in Explorer, Open in VS Code / Cursor.
 */

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  executeNativeCommand,
  executeStreamingCommand,
  cancelNativeExecution,
  onNativeStdout,
  onNativeStderr,
  onNativeExit,
  revealInExplorer,
  openInEditor,
  detectEditors,
  isTauri,
  type DetectedEditor,
} from "../lib/ipc";
import { TransferHistory } from "../core/transfer/history";

export interface ExecutionConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  command: string;
  args: string[];
  cwd?: string;
  targetPath?: string;
  onSuccess?: () => void;
}

export function ExecutionConsoleModal({
  isOpen,
  onClose,
  title,
  command,
  args,
  cwd,
  targetPath,
  onSuccess,
}: ExecutionConsoleModalProps) {
  const [status, setStatus] = useState<"idle" | "running" | "success" | "error" | "cancelled">("idle");
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll to bottom
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [stdout, stderr, status]);

  // Probe available editors on mount
  useEffect(() => {
    if (isOpen) {
      detectEditors()
        .then((eds) => setEditors(eds.filter((e) => e.installed)))
        .catch(() => setEditors([]));
    }
  }, [isOpen]);

  // Execute streaming command when opened
  useEffect(() => {
    if (!isOpen) {
      setStatus("idle");
      setStdout("");
      setStderr("");
      setExitCode(null);
      setExecutionId(null);
      setElapsed(0);
      return;
    }

    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setExecutionId(execId);
    setStatus("running");
    setStdout("");
    setStderr("");
    setExitCode(null);
    setElapsed(0);

    const timer = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    const startTime = Date.now();
    let unlistenStdout: (() => void) | undefined;
    let unlistenStderr: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    let mounted = true;

    async function startExecution() {
      if (isTauri()) {
        unlistenStdout = await onNativeStdout((payload) => {
          if (!mounted || payload.executionId !== execId) return;
          setStdout((prev) => prev + payload.text);
        });

        unlistenStderr = await onNativeStderr((payload) => {
          if (!mounted || payload.executionId !== execId) return;
          setStderr((prev) => prev + payload.text);
        });

        unlistenExit = await onNativeExit((payload) => {
          if (!mounted || payload.executionId !== execId) return;
          clearInterval(timer);
          setExitCode(payload.exitCode);

          if (payload.success) {
            setStatus("success");
            TransferHistory.record({
              type: "install",
              title,
              targetId: `${command}-${Date.now()}`,
              targetName: `${command} ${args.join(" ")}`,
              status: "success",
              summary: `已完成执行: ${command} ${args.join(" ")} (耗时 ${Math.round((Date.now() - startTime) / 1000)}s)`,
            });
            onSuccess?.();
          } else {
            setStatus((cur) => (cur === "cancelled" ? "cancelled" : "error"));
            TransferHistory.record({
              type: "install",
              title,
              targetId: `${command}-${Date.now()}`,
              targetName: `${command} ${args.join(" ")}`,
              status: "error",
              summary: `执行异常或退出: 退出码 ${payload.exitCode ?? -1}`,
            });
          }
        });

        try {
          await executeStreamingCommand(execId, command, args, cwd);
        } catch (err: any) {
          if (!mounted) return;
          clearInterval(timer);
          setStatus("error");
          setStderr(err?.message || String(err));
        }
      } else {
        // Fallback for mock/browser
        executeNativeCommand(command, args, cwd)
          .then((res) => {
            if (!mounted) return;
            clearInterval(timer);
            setStdout(res.stdout);
            setStderr(res.stderr);
            setExitCode(res.exitCode);
            if (res.success) {
              setStatus("success");
              onSuccess?.();
            } else {
              setStatus("error");
            }
          })
          .catch((err) => {
            if (!mounted) return;
            clearInterval(timer);
            setStatus("error");
            setStderr(err instanceof Error ? err.message : String(err));
          });
      }
    }

    void startExecution();

    return () => {
      mounted = false;
      clearInterval(timer);
      unlistenStdout?.();
      unlistenStderr?.();
      unlistenExit?.();
    };
  }, [isOpen, command, JSON.stringify(args), cwd, title]);

  const handleCancelExecution = async () => {
    if (!executionId || status !== "running") return;
    setStatus("cancelled");
    try {
      await cancelNativeExecution(executionId);
      setActionNotice("已向进程发送终止信号");
      setTimeout(() => setActionNotice(null), 3000);
    } catch {
      setActionNotice("无法终止进程");
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

  const fullCommandLine = `${command} ${args.join(" ")}`;

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="execution-console-title"
      className="fixed inset-0 z-60 flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={status === "running" ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Surface */}
      <div className="relative z-10 flex h-full w-full max-h-[85vh] max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-[#0f1217] text-zinc-100 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)]">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-[#141820] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span
              className={clsx(
                "h-2.5 w-2.5 rounded-full",
                status === "running" && "bg-amber-400 animate-pulse",
                status === "success" && "bg-emerald-400",
                status === "error" && "bg-rose-500",
              )}
            />
            <h3 id="execution-console-title" className="text-[15px] font-bold text-white">
              {title}
            </h3>
            <span className="font-mono text-[11px] text-zinc-400">耗时: {elapsed}s</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={status === "running"}
            className={clsx(
              "flex h-7 items-center justify-center rounded-md border border-zinc-700 px-2.5 text-[12px] font-medium text-zinc-300 transition-colors",
              status === "running"
                ? "opacity-30 cursor-not-allowed"
                : "hover:bg-zinc-800 hover:text-white cursor-pointer",
            )}
          >
            ✕
          </button>
        </header>

        {/* Command Display */}
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

        {/* Console Body */}
        <div className="flex-1 overflow-y-auto bg-[#090b0e] p-4 font-mono text-[12px] leading-relaxed text-zinc-300 select-text space-y-2">
          {status === "running" && (
            <div className="text-zinc-400 flex items-center justify-between gap-2 border-b border-zinc-900 pb-2">
              <div className="flex items-center gap-2">
                <span className="inline-block animate-spin">◷</span>
                <span>正在调用本机环境实时执行中…</span>
              </div>
              <button
                type="button"
                onClick={handleCancelExecution}
                className="rounded border border-rose-800/70 bg-rose-950/40 px-2 py-0.5 text-[11px] font-bold text-rose-300 hover:bg-rose-900/60 transition-colors cursor-pointer"
              >
                ✕ 终止进程
              </button>
            </div>
          )}

          {stdout && (
            <pre className="whitespace-pre-wrap font-mono text-[12px] text-zinc-200">
              {stdout}
            </pre>
          )}

          {stderr && (
            <div className="rounded border border-amber-900/50 bg-amber-950/30 p-2.5 text-amber-300 font-mono text-[11.5px]">
              <pre className="whitespace-pre-wrap">{stderr}</pre>
            </div>
          )}

          {status === "cancelled" && (
            <div className="rounded border border-rose-900/60 bg-rose-950/50 p-3 text-rose-300 font-bold text-[12px]">
              ✕ 进程已被手动终止 (Process Cancelled)
            </div>
          )}

          {status === "success" && (
            <div className="mt-3 rounded border border-emerald-900/60 bg-emerald-950/30 p-3 text-emerald-300">
              ✓ 执行完成（退出码: {exitCode ?? 0}）
            </div>
          )}

          {status === "error" && !stderr && (
            <div className="rounded border border-rose-900/60 bg-rose-950/40 p-3 text-rose-300">
              <div className="font-bold text-[12.5px] mb-1">执行退出异常：</div>
              <pre className="whitespace-pre-wrap font-mono text-[11.5px]">退出码: {exitCode ?? -1}</pre>
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
                onClick={handleCancelExecution}
                className="rounded-lg border border-rose-800/80 bg-rose-950/50 px-3.5 py-1.5 text-[12px] font-bold text-rose-300 hover:bg-rose-900/60 transition-colors cursor-pointer"
              >
                终止执行
              </button>
            )}

            {status === "success" && (targetPath || cwd) && (
              <>
                <button
                  type="button"
                  onClick={handleReveal}
                  className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-[12px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
                >
                  在资源管理器中定位
                </button>

                {editors.map((ed) => (
                  <button
                    key={ed.id}
                    type="button"
                    onClick={() => handleOpenEditor(ed.id)}
                    className="rounded-lg border border-blue-600/40 bg-blue-900/20 px-3 py-1.5 text-[12px] font-medium text-blue-300 hover:bg-blue-800/30 transition-colors cursor-pointer"
                  >
                    在 {ed.name} 中打开
                  </button>
                ))}
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              disabled={status === "running"}
              className="rounded-lg border border-zinc-700 bg-transparent px-4 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
            >
              {status === "running" ? "执行中..." : "完成"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
