/**
 * Setup Center — Project Scaffolding Modal
 *
 * Prompts for project name, parent directory, and package manager,
 * then triggers native CLI scaffolding with live console output.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { ExecutionConsoleModal } from "./ExecutionConsoleModal";

export interface ScaffoldModalProps {
  isOpen?: boolean;
  onClose: () => void;
  template?: {
    id: string;
    name: string;
    description: string;
    command?: string;
    defaultDir?: string;
    postInstallNotice?: string;
  };
  templateName?: string;
  templateTitle?: string;
  defaultProjectName?: string;
  defaultCommand?: string;
  initialCommand?: string;
}

export function ScaffoldModal({
  isOpen = true,
  onClose,
  template,
  templateName,
  templateTitle,
  defaultProjectName,
  defaultCommand,
  initialCommand,
}: ScaffoldModalProps) {
  const effectiveTitle = templateTitle || templateName || template?.name || "新项目模板";
  const cmd = initialCommand || defaultCommand || template?.command || "";
  const [projectName, setProjectName] = useState(defaultProjectName || template?.defaultDir || "my-new-app");
  const [parentDir, setParentDir] = useState("C:\\Projects");
  const [pm, setPm] = useState<"pnpm" | "npm" | "yarn">("pnpm");
  const [isExecuting, setIsExecuting] = useState(false);

  if (!isOpen) return null;

  // Resolve scaffold command and args
  const resolvedArgs: string[] = [];
  let program = "npm";

  if (cmd && cmd.startsWith("git clone")) {
    program = "git";
    const parts = cmd.split(" ");
    resolvedArgs.push("clone", parts[2] || "", `${parentDir}\\${projectName}`);
  } else if (cmd) {
    const parts = cmd.split(" ");
    program = parts[0];
    resolvedArgs.push(...parts.slice(1).map((p) => (p.includes("my-") ? projectName : p)));
  } else {
    // Default modern vite/tauri scaffold pattern
    program = pm;
    resolvedArgs.push("create", "vite@latest", projectName, "--", "--template", "react-ts");
  }

  const targetPath = `${parentDir}\\${projectName}`;

  const content = (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scaffold-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      >
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        <div className="relative z-10 w-full max-w-lg rounded-xl border border-zinc-700 bg-[#12151b] p-6 text-zinc-100 shadow-2xl space-y-5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <h3 id="scaffold-modal-title" className="text-[16px] font-bold text-white">
              初始化工程模板 · {effectiveTitle}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[12px] font-semibold text-zinc-300 block mb-1">
                工程名称 (Project Name)
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                placeholder="例如: my-ai-app"
                className="w-full rounded-lg border border-zinc-700 bg-[#0a0c0f] px-3.5 py-2 font-mono text-[12.5px] text-white focus:border-blue-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="text-[12px] font-semibold text-zinc-300 block mb-1">
                父级目录 (Workspace Root)
              </label>
              <input
                type="text"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                placeholder="例如: D:\Projects"
                className="w-full rounded-lg border border-zinc-700 bg-[#0a0c0f] px-3.5 py-2 font-mono text-[12.5px] text-white focus:border-blue-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="text-[12px] font-semibold text-zinc-300 block mb-1.5">
                首选包管理器 (Package Manager)
              </label>
              <div className="flex gap-3">
                {(["pnpm", "npm", "yarn"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPm(p)}
                    className={`rounded-lg border px-4 py-1.5 font-mono text-[12px] font-bold transition-all cursor-pointer ${
                      pm === p
                        ? "border-blue-500 bg-blue-600/20 text-blue-300"
                        : "border-zinc-800 bg-[#0a0c0f] text-zinc-400 hover:border-zinc-700"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-[#0e1116] p-3 text-[12px] text-zinc-400 font-mono">
              <span className="text-zinc-500">$ </span>
              <span className="text-blue-300">
                {program} {resolvedArgs.join(" ")}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-700 bg-transparent px-4 py-1.5 text-[12.5px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => setIsExecuting(true)}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-[12.5px] font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer shadow-sm"
            >
              开始生成工程
            </button>
          </div>
        </div>
      </div>

      {isExecuting && (
        <ExecutionConsoleModal
          isOpen={true}
          onClose={() => {
            setIsExecuting(false);
            onClose();
          }}
          title={`初始化工程: ${projectName}`}
          command={program}
          args={resolvedArgs}
          cwd={parentDir}
          targetPath={targetPath}
        />
      )}
    </>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
