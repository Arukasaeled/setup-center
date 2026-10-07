/**
 * Setup Center — Clone GitHub Repository Modal
 *
 * Prompts for destination directory and launches native git clone with live console feedback.
 * Implements Issue H01 (semantic tokens) and H05 (AccessibleDialog + accessibility names).
 */

import { useState } from "react";
import { AccessibleDialog } from "./AccessibleDialog";
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

  return (
    <>
      <AccessibleDialog
        isOpen={isOpen}
        onClose={onClose}
        titleId="clone-modal-title"
        dataProtectedUi={true}
        maxWidth="max-w-lg"
        panelClassName="relative w-full max-w-lg rounded-2xl border border-[color:var(--line-strong)] bg-[color:var(--surface-base)] p-6 text-[color:var(--text-primary)] shadow-2xl space-y-5"
      >
        <div className="flex items-center justify-between border-b border-[color:var(--line-subtle)] pb-3">
          <h3 id="clone-modal-title" className="text-[16px] font-bold text-[color:var(--text-strong)]">
            克隆 GitHub 仓库到本机
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭克隆窗口"
            className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-inset)] text-[color:var(--text-quiet)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors cursor-pointer"
          >
            <span className="text-[13px] leading-none">✕</span>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="clone-git-url-input" className="text-[12.5px] font-semibold text-[color:var(--text-secondary)] block mb-1">
              远程仓库链接 (Git URL)
            </label>
            <input
              id="clone-git-url-input"
              type="text"
              readOnly
              value={repoUrl}
              className="w-full rounded-lg border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] px-3.5 py-2 font-mono text-[12.5px] text-[color:var(--text-secondary)] select-all focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="clone-dest-path-input" className="text-[12.5px] font-semibold text-[color:var(--text-secondary)] block mb-1">
              本机目标目录 (Destination Path)
            </label>
            <input
              id="clone-dest-path-input"
              type="text"
              value={destPath}
              onChange={(e) => setDestPath(e.target.value)}
              placeholder="例如: D:\Projects\my-repo"
              className="w-full rounded-lg border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] px-3.5 py-2 font-mono text-[12.5px] text-[color:var(--text-primary)] focus:border-[color:var(--status-accent)] focus:outline-none transition-colors"
            />
            <p className="text-[11.5px] text-[color:var(--text-quiet)] mt-1">
              系统将在此目录下创建完整工程代码与 Git 历史。
            </p>
          </div>

          <div className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3 text-[12px] text-[color:var(--text-tertiary)] font-mono">
            <span className="text-[color:var(--text-quiet)]">$ </span>
            <span className="text-[color:var(--status-accent)]">git clone {repoUrl} {destPath}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[32px] items-center rounded-lg border border-[color:var(--line-default)] bg-transparent px-4 py-1.5 text-[12.5px] font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleStartClone}
            className="flex min-h-[32px] items-center rounded-lg bg-[color:var(--status-accent)] px-4 py-1.5 text-[12.5px] font-bold text-black hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
          >
            开始克隆
          </button>
        </div>
      </AccessibleDialog>

      {isExecuting && (
        <ExecutionConsoleModal
          isOpen={true}
          onClose={() => {
            setIsExecuting(false);
            onClose();
          }}
          title={`克隆仓库: ${repoName || name}`}
          command="git"
          args={["clone", repoUrl, destPath]}
          targetPath={destPath}
        />
      )}
    </>
  );
}
