import { useState } from "react";
import { Button } from "./ui";
import { ProjectScaffolder, type ScaffoldResult } from "../core/transfer";

export interface ScaffoldModalProps {
  template: {
    id: string;
    name: string;
    description: string;
    command?: string;
    defaultDir?: string;
    postInstallNotice?: string;
  };
  onClose: () => void;
}

export function ScaffoldModal({ template, onClose }: ScaffoldModalProps) {
  const [projectName, setProjectName] = useState(template.defaultDir || "my-new-project");
  const [targetDir, setTargetDir] = useState("D:\\projects");
  const [packageManager, setPackageManager] = useState<"npm" | "pnpm" | "bun">("pnpm");
  const [openInCode, setOpenInCode] = useState(true);
  const [result, setResult] = useState<ScaffoldResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [executing, setExecuting] = useState(false);

  const rawCmd = template.command || `npm create tauri-app@latest {{projectName}}`;
  const previewCmd = ProjectScaffolder.composeCommand(rawCmd, {
    projectName,
    targetDir,
    packageManager,
  });

  const handleCopy = () => {
    navigator.clipboard?.writeText(previewCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleScaffold = async () => {
    setExecuting(true);
    try {
      const res = await ProjectScaffolder.scaffold(
        {
          templateId: template.id,
          templateName: template.name,
          projectName,
          targetDir,
          packageManager,
          openInCode,
        },
        rawCmd,
      );
      setResult(res);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-[color:var(--line-strong)] bg-[color:var(--surface-raised)] p-6 shadow-2xl">
        <div className="flex items-start justify-between pb-4 border-b border-[color:var(--line-subtle)]">
          <div>
            <div className="text-[11px] font-black uppercase tracking-wider text-[color:var(--status-accent)]">
              PROJECT SCAFFOLDER // 工程脚手架实例化
            </div>
            <h2 className="text-[17px] font-bold text-[color:var(--text-strong)] mt-0.5">
              基于模板创建：{template.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[color:var(--text-tertiary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)]"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {/* Project Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-semibold text-[color:var(--text-secondary)]">
              工程名称 (Project Name)
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value.trim())}
              className="rounded-lg border border-[color:var(--line-default)] bg-[color:var(--surface-sunken)] px-3 py-1.5 text-[13px] text-[color:var(--text-strong)] font-mono focus:border-[color:var(--status-accent)] focus:outline-none"
              placeholder="e.g. my-app"
            />
          </div>

          {/* Target Directory */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-semibold text-[color:var(--text-secondary)]">
              创建目标目录 (Destination Path)
            </label>
            <input
              type="text"
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              className="rounded-lg border border-[color:var(--line-default)] bg-[color:var(--surface-sunken)] px-3 py-1.5 text-[13px] text-[color:var(--text-strong)] font-mono focus:border-[color:var(--status-accent)] focus:outline-none"
              placeholder="D:\projects"
            />
          </div>

          {/* Package Manager Selection */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-semibold text-[color:var(--text-secondary)]">
              首选包管理器 (Package Manager)
            </label>
            <div className="flex gap-2">
              {(["pnpm", "npm", "bun"] as const).map((pm) => (
                <button
                  key={pm}
                  type="button"
                  onClick={() => setPackageManager(pm)}
                  className={`rounded-lg px-3 py-1 text-[12px] font-mono border transition-all ${
                    packageManager === pm
                      ? "border-[color:var(--status-accent)] bg-[color:var(--status-accent)] text-black font-bold"
                      : "border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] text-[color:var(--text-secondary)]"
                  }`}
                >
                  {pm}
                </button>
              ))}
            </div>
          </div>

          {/* Command Preview */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="font-semibold text-[color:var(--text-secondary)]">
                生成的实例化终端命令
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="text-[color:var(--status-accent)] hover:underline font-semibold"
              >
                {copied ? "已复制 ✓" : "复制命令"}
              </button>
            </div>
            <pre className="rounded-lg border border-[color:var(--line-subtle)] bg-[color:var(--surface-sunken)] p-3 text-[11.5px] font-mono text-[color:var(--text-primary)] overflow-x-auto select-all">
              {previewCmd}
            </pre>
          </div>

          {/* Open in editor checkbox */}
          <label className="flex items-center gap-2 cursor-pointer text-[12px] text-[color:var(--text-secondary)]">
            <input
              type="checkbox"
              checked={openInCode}
              onChange={(e) => setOpenInCode(e.target.checked)}
              className="rounded border-[color:var(--line-default)] text-[color:var(--status-accent)] focus:ring-0"
            />
            <span>完成后准备在 VS Code 中开启</span>
          </label>

          {/* Success / Status Message */}
          {result && (
            <div
              className={`rounded-lg p-3 text-[12px] border ${
                result.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              <div className="font-bold">{result.ok ? "✓ 已就绪记录" : "✕ 发生提示"}</div>
              <div className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{result.message}</div>
              {template.postInstallNotice && (
                <div className="mt-2 pt-2 border-t border-emerald-500/20 text-[11px] text-[color:var(--text-secondary)]">
                  <strong>后续步骤：</strong> {template.postInstallNotice}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2.5 pt-4 border-t border-[color:var(--line-subtle)]">
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button size="sm" variant="quiet" onClick={handleCopy}>
            {copied ? "已复制" : "复制命令"}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={handleScaffold}
            disabled={executing || !projectName}
          >
            {executing ? "初始化中..." : "立即实例化"}
          </Button>
        </div>
      </div>
    </div>
  );
}
