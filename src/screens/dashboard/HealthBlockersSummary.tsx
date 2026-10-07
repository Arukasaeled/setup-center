/**
 * Health Blockers & Unknowns Summary Component (Issue K05).
 *
 * ## Primary Status & Score De-emphasis (Issue K05)
 *
 * Single composite health scores can easily mask critical blockers and
 * unknown probe states. This component prioritizes explicit counts of:
 * 1. Core Blockers (items missing/failed that halt development)
 * 2. Unknown States (network timeouts, unverified probes)
 * 3. Ready Items (passed verification)
 *
 * The raw composite score is relegated to a secondary reference indicator.
 */

import React from "react";
import clsx from "clsx";
import type { EnvironmentReport, CapabilityStatus } from "../../lib/types";

export interface HealthSoftwareItem {
  id: string;
  name: string;
  status: "ok" | "missing" | "unknown" | string;
}

export interface HealthBlockersSummaryProps {
  report: EnvironmentReport | null;
  software?: HealthSoftwareItem[];
  capabilities?: CapabilityStatus[];
  score: number;
  onFixBlockers?: () => void;
  className?: string;
}

export function HealthBlockersSummary({
  report,
  software,
  capabilities,
  score,
  onFixBlockers,
  className,
}: HealthBlockersSummaryProps) {
  // 1. Identify Core Blockers: essential dev software or critical configs that are missing/failed
  const blockers: Array<{ id: string; name: string; reason: string }> = [];
  const unknowns: Array<{ id: string; name: string; reason: string }> = [];
  let readyCount = 0;

  // Check essential software (Git, Python, Node, VS Code) if software list provided
  const essentialSoftwareIds = new Set(["git", "python", "node", "vscode"]);
  if (software) {
    for (const sw of software) {
      if (sw.status === "ok") {
        readyCount++;
      } else if (sw.status === "missing") {
        if (essentialSoftwareIds.has(sw.id)) {
          blockers.push({
            id: sw.id,
            name: sw.name,
            reason: "关键开发工具缺失，将阻碍项目编译或代码版本控制",
          });
        }
      } else if (sw.status === "unknown") {
        unknowns.push({
          id: sw.id,
          name: sw.name,
          reason: "探测未完成或本地环境未响应",
        });
      }
    }
  }

  // Check capabilities if provided
  if (capabilities) {
    for (const cap of capabilities) {
      if (cap.status === "available") {
        if (!software) readyCount++;
      } else if (cap.status === "unavailable") {
        if (cap.id === "git" || cap.id === "terminal" || cap.id === "editor") {
          blockers.push({
            id: cap.id,
            name: cap.name,
            reason: cap.summary || "核心基础开发能力未就绪",
          });
        }
      } else if (cap.status === "unknown") {
        if (!software) {
          unknowns.push({
            id: cap.id,
            name: cap.name,
            reason: cap.summary || "能力状态探测未知",
          });
        }
      }
    }
  }

  // Check report system probes
  if (report) {
    if (report.signals) {
      for (const sig of report.signals) {
        if (sig.severity === "blocking") {
          blockers.push({
            id: sig.key,
            name: sig.label,
            reason: sig.hint || sig.value,
          });
        } else if (sig.confidence === "unknown") {
          unknowns.push({
            id: sig.key,
            name: sig.label,
            reason: sig.hint || "信号状态未知",
          });
        }
      }
    }
    if (report.disks) {
      for (const disk of report.disks) {
        const freeGb = Math.round(disk.freeBytes / (1024 * 1024 * 1024));
        if (disk.lowSpace || freeGb < 5) {
          blockers.push({
            id: `disk-${disk.root}`,
            name: `系统盘 (${disk.root}) 空间告急`,
            reason: `可用 ${freeGb} GB（建议预留至少 10 GB）`,
          });
        }
      }
    }
  }

  const hasBlockers = blockers.length > 0;
  const hasUnknowns = unknowns.length > 0;

  return (
    <div
      data-testid="health-blockers-summary"
      className={clsx(
        "rounded-xl border p-5 transition-colors",
        hasBlockers
          ? "border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10"
          : "border-line bg-surface-raised",
        className
      )}
    >
      {/* Top Header & Status Badges */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                "inline-block h-2.5 w-2.5 rounded-full",
                hasBlockers ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
              )}
            />
            <h2 className="text-base font-semibold text-text-primary">
              {hasBlockers ? "存在核心开发环境阻断" : "开发环境核心状态正常"}
            </h2>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            以核心可用性凭证与关键缺口为准，消除复合公式分数粉饰 (Issue K05)
          </p>
        </div>

        {/* Primary Status Metric Pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <span
            className={clsx(
              "px-2.5 py-1 rounded-full border font-semibold",
              hasBlockers
                ? "border-amber-500/40 bg-amber-500/20 text-amber-700 dark:text-amber-300"
                : "border-line bg-surface text-text-muted"
            )}
          >
            {blockers.length} 项核心阻断
          </span>

          <span
            className={clsx(
              "px-2.5 py-1 rounded-full border",
              hasUnknowns
                ? "border-zinc-500/40 bg-zinc-500/20 text-zinc-700 dark:text-zinc-300"
                : "border-line bg-surface text-text-muted"
            )}
          >
            {unknowns.length} 项未确定
          </span>

          <span className="px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            {readyCount} 项就绪
          </span>

          {/* De-emphasized Score Footnote */}
          <span
            title="综合算法得分仅供粗略参考，不能代替左侧核心阻断项"
            className="px-2 py-0.5 rounded text-[11px] text-text-muted/70 bg-surface/50 border border-line/40 ml-1"
          >
            参考分: {score}
          </span>
        </div>
      </div>

      {/* Blockers & Unknowns Detailed List */}
      {hasBlockers && (
        <div className="mt-4 pt-3 border-t border-line/50 space-y-2">
          <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">
            优先修复清单（点击或执行安装）：
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {blockers.map((b) => (
              <div
                key={b.id}
                className="flex items-start justify-between gap-2 p-2.5 rounded-lg border border-amber-500/20 bg-surface/80 text-xs"
              >
                <div>
                  <span className="font-semibold text-text-primary">{b.name}</span>
                  <p className="text-[11px] text-text-muted mt-0.5">{b.reason}</p>
                </div>
              </div>
            ))}
          </div>

          {onFixBlockers && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onFixBlockers}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors shadow-sm"
              >
                一键规划修复阻断项
              </button>
            </div>
          )}
        </div>
      )}

      {/* Unknowns Notification */}
      {hasUnknowns && (
        <div className="mt-3 text-xs text-text-muted flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-400" />
          <span>
            {unknowns.map((u) => u.name).join("、")} 状态未知（可能是离线超时或未探测），建议在联网状态下重新扫描。
          </span>
        </div>
      )}
    </div>
  );
}
