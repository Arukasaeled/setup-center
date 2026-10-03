/**
 * Setup Center — Clone GitHub Repository Modal
 *
 * Prompts for destination directory and launches native git clone with live console feedback.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { ExecutionConsoleModal } from "./ExecutionConsoleModal";

export interface CloneRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  repoUrl: string;
  repoName?: string;
  repoTitle?: string;
}

export function CloneRepoModal({
  isOpen,
  onClose,
  repoUrl,
  repoName,
  repoTitle,
}: CloneRepoModalProps) {
  const name = repoTitle || repoName || "project";
  const defaultDirName = name.split("/").pop() || "project";
  // Default path under user home / Projects
  const [destPath, setDestPath] = useState(`C:\\Projects\\${defaultDirName}`);
  const [isExecuting, setIsExecuting] = useState(false);

  if (!isOpen) return null;

  const handleStartClone = () => {
    setIsExecuting(true);
  };

  const content = (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="clone-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      >
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Surface */}
        <div className="relative z-10 w-full max-w-lg rounded-xl border border-zinc-700 bg-[#12151b] p-6 text-zinc-100 shadow-2xl space-y-5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <h3 id="clone-modal-title" className="text-[16px] font-bold text-white">
              克隆 GitHub 仓库到本机
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
                远程仓库链接 (Git URL)
              </label>
              <input
                type="text"
                readOnly
                value={repoUrl}
                className="w-full rounded-lg border border-zinc-800 bg-[#0a0c0f] px-3.5 py-2 font-mono text-[12.5px] text-zinc-300 select-all focus:outline-hidden"
              />
            </div>

            <div>
              <label className="text-[12px] font-semibold text-zinc-300 block mb-1">
                本机目标目录 (Destination Path)
              </label>
              <input
                type="text"
                value={destPath}
                onChange={(e) => setDestPath(e.target.value)}
                placeholder="例如: D:\Projects\my-repo"
                className="w-full rounded-lg border border-zinc-700 bg-[#0a0c0f] px-3.5 py-2 font-mono text-[12.5px] text-white focus:border-blue-500 focus:outline-hidden"
              />
              <p className="text-[11px] text-zinc-400 mt-1">
                系统将在此目录下创建完整工程代码与 Git 历史。
              </p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-[#0e1116] p-3 text-[12px] text-zinc-400 font-mono">
              <span className="text-zinc-500">$ </span>
              <span className="text-blue-300">git clone {repoUrl} {destPath}</span>
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
              onClick={handleStartClone}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-[12.5px] font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer shadow-sm"
            >
              开始克隆
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
          title={`克隆仓库: ${repoName}`}
          command="git"
          args={["clone", repoUrl, destPath]}
          targetPath={destPath}
        />
      )}
    </>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
