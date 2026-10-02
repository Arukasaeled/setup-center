import { useState, useRef, useEffect } from "react";
import clsx from "clsx";
import type { PackageManager, PrerequisitesStatus, SetupAction } from "../core/setup/types";
import { executeSetupAction } from "../core/setup/executor";

export interface SetupActionButtonProps {
  action: SetupAction;
  itemMeta?: { id: string; name: string; type?: string };
  secondaryActions?: SetupAction[];
  availablePackageManagers?: PackageManager[];
  prerequisites?: PrerequisitesStatus;
  onActionSuccess?: (msg: string) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
  showPmSelector?: boolean;
}

export function SetupActionButton({
  action,
  itemMeta,
  secondaryActions = [],
  availablePackageManagers,
  prerequisites,
  onActionSuccess,
  size = "md",
  className,
  showPmSelector = true,
}: SetupActionButtonProps) {
  const [activePm, setActivePm] = useState<PackageManager>(
    action.activePackageManager || (availablePackageManagers?.[0] ?? "pnpm"),
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [dropdownOpen]);

  // Compute active payload if package manager is switched
  const currentAction: SetupAction = {
    ...action,
    activePackageManager: activePm,
    payload:
      action.packageCommands?.[activePm] ||
      action.payload,
    label:
      action.type === "command" && action.packageCommands
        ? `复制 ${activePm} 命令`
        : action.label,
  };

  const handleRun = async (actToRun: SetupAction) => {
    setIsExecuting(true);
    try {
      const result = await executeSetupAction(actToRun, itemMeta);
      if (result.ok) {
        setFeedback(result.message);
        onActionSuccess?.(result.message);
        setTimeout(() => setFeedback(null), 2200);
      } else {
        setFeedback(result.message);
        setTimeout(() => setFeedback(null), 3000);
      }
    } catch (err) {
      setFeedback("操作失败");
      setTimeout(() => setFeedback(null), 2000);
    } finally {
      setIsExecuting(false);
      setDropdownOpen(false);
    }
  };

  const sizeClasses = {
    sm: "px-2.5 py-1 text-[12px] gap-1.5",
    md: "px-4 py-2 text-[13px] gap-2 font-medium",
    lg: "px-5 py-2.5 text-[14px] gap-2.5 font-semibold",
  }[size];

  const hasMissingPrereq = prerequisites && !prerequisites.satisfied;

  return (
    <div className={clsx("inline-flex flex-col gap-1.5", className)}>
      <div className="inline-flex items-center rounded-lg border border-[color:var(--line-strong)] bg-[color:var(--surface-raised)] shadow-sm">
        {/* Main Action Button */}
        <button
          type="button"
          onClick={() => handleRun(currentAction)}
          disabled={isExecuting}
          className={clsx(
            "inline-flex items-center justify-center rounded-l-lg transition-all duration-150 active:scale-[0.98]",
            "bg-[color:var(--accent)] text-white hover:brightness-110",
            sizeClasses,
            secondaryActions.length === 0 && !availablePackageManagers?.length && "rounded-r-lg",
          )}
          title={currentAction.description || currentAction.label}
        >
          {isExecuting ? (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : feedback ? (
            <span className="flex items-center gap-1 text-[12px]">
              <span className="font-bold text-white">✓</span> {feedback}
            </span>
          ) : (
            <>
              <span className="tracking-tight">{currentAction.label}</span>
              {currentAction.type === "command" && (
                <span className="text-[10px] opacity-75 font-mono px-1 rounded bg-black/20">
                  {activePm}
                </span>
              )}
            </>
          )}
        </button>

        {/* Package Manager Quick Selector */}
        {showPmSelector && availablePackageManagers && availablePackageManagers.length > 1 && (
          <div className="flex items-center border-l border-white/20 bg-[color:var(--accent)]/90 px-1 py-1">
            {availablePackageManagers.map((pm) => (
              <button
                key={pm}
                type="button"
                onClick={() => {
                  setActivePm(pm);
                  if (action.packageCommands?.[pm]) {
                    handleRun({
                      ...action,
                      activePackageManager: pm,
                      payload: action.packageCommands[pm]!,
                      label: `复制 ${pm} 命令`,
                    });
                  }
                }}
                className={clsx(
                  "px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors",
                  activePm === pm
                    ? "bg-white text-[color:var(--accent)] font-bold shadow-xs"
                    : "text-white/80 hover:text-white hover:bg-white/10",
                )}
                title={`切换至 ${pm} 命令并直接执行`}
              >
                {pm}
              </button>
            ))}
          </div>
        )}

        {/* Secondary Actions Dropdown Trigger */}
        {secondaryActions.length > 0 && (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={clsx(
                "flex items-center justify-center rounded-r-lg border-l border-[color:var(--line-strong)] bg-[color:var(--surface-inset)] px-2.5 py-2 text-[color:var(--text-quiet)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-strong)] transition-colors",
                size === "sm" ? "h-7" : size === "lg" ? "h-10" : "h-9",
              )}
              aria-label="更多操作选项"
              aria-expanded={dropdownOpen}
            >
              <span className="text-[10px] leading-none">▼</span>
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-xl border border-[color:var(--line-strong)] bg-[color:var(--surface-base)] py-1.5 shadow-xl"
                style={{
                  boxShadow: "0 12px 30px rgba(0,0,0,0.35), 0 0 0 1px var(--line-default)",
                }}
              >
                <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-[color:var(--text-tertiary)] border-b border-[color:var(--line-subtle)] mb-1">
                  其他可用操作
                </div>
                {secondaryActions.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => handleRun(sec)}
                    className="w-full text-left px-3 py-1.5 text-[12px] text-[color:var(--text-primary)] hover:bg-[color:var(--surface-hover)] flex items-center justify-between gap-2 transition-colors"
                  >
                    <span>{sec.label}</span>
                    <span className="text-[10px] font-mono text-[color:var(--text-tertiary)]">
                      {sec.type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Prerequisite Guidance Warning */}
      {hasMissingPrereq && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-500/90 font-mono">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span>{prerequisites.warningHint || `环境依赖: ${prerequisites.missingNames.join("、")}`}</span>
        </div>
      )}
    </div>
  );
}
