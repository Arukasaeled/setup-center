/**
 * Screen 5 — Done, and the report.
 *
 * The brief asks for a completion screen and a report. They are the same screen
 * because they answer the same question ("what do I have now?"), with the report
 * folded away until asked for.
 *
 * Honesty rules applied here:
 *  - a program that is installed but not on PATH is NOT shown with a green tick;
 *    it gets its own state and its own advice
 *  - "环境检测 100%" is only shown when every check genuinely passed
 *  - the "not attempted" list is rendered, not hidden in the file on disk
 */

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, ScoreReadout, SectionLabel, StatusMark } from "../components/ui";
import { BackButton } from "../components/BackButton";
import { selectedProfile, useApp } from "../lib/store";
import type { CheckResult, PackageVerification } from "../lib/types";

export function DoneScreen() {
  const profile = useApp(selectedProfile);
  const environment = useApp((s) => s.environment);
  const verification = useApp((s) => s.verification);
  const configActions = useApp((s) => s.configActions);
  const reportText = useApp((s) => s.reportText);
  const reportPath = useApp((s) => s.reportPath);
  const preparing = useApp((s) => s.preparing);
  const prepareFinish = useApp((s) => s.prepareFinish);
  const downloadReport = useApp((s) => s.downloadReport);
  const runDetection = useApp((s) => s.runDetection);
  const goTo = useApp((s) => s.goTo);

  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    // Idempotent on the store side, but guarding here avoids a second round of
    // IPC when the screen remounts after a back/forward.
    if (!verification && !preparing) void prepareFinish();
  }, [verification, preparing, prepareFinish]);

  const passed = verification?.packages.filter((p) => p.passed) ?? [];
  const incomplete = verification?.packages.filter((p) => !p.passed) ?? [];
  const allOk = verification?.overallOk ?? false;

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <header className="fade shrink-0">
        <h2 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          {allOk && passed.length > 0
            ? "配置已经完成"
            : "环境检查结果"}
        </h2>
        <p className="text-[color:var(--text-quiet)] mt-1 text-[13px]">
          {profile ? `${profile.name} · ` : ""}
          {preparing ? "正在核对安装结果…" : "以下是本次的完整结果"}
        </p>
      </header>

      <div className="mt-7 flex-1 overflow-y-auto pr-1">
        {preparing && !verification && <PreparingBlock />}

        {verification && (
          <div className="flex flex-col gap-7">
            <div className="stagger flex flex-col gap-1.5">
              {verification.packages.map((pkg) => (
                <PackageRow key={pkg.id} pkg={pkg} />
              ))}
            </div>

            {incomplete.length > 0 && (
              <div className="rise">
                <SectionLabel>需要处理</SectionLabel>
                <div className="flex flex-col gap-2">
                  {incomplete.flatMap((pkg) =>
                    [pkg.present, pkg.onPath, pkg.version]
                      // Only surface checks that actually carry advice, and
                      // label the row with the failing check's own label. The
                      // previous version hard-coded nothing but the package
                      // name, which produced "VS Code · 已安装" above the text
                      // "VS Code 未安装" — a self-contradiction.
                      .filter((c) => c.hint && c.confidence !== "ok")
                      .map((check) => (
                        <div
                          key={check.key}
                          className="border-[color:var(--line-default)] bg-[color:var(--surface-raised)]/60 flex gap-3 rounded-[10px] border px-3.5 py-3"
                        >
                          <StatusMark confidence={check.confidence} />
                          <div className="min-w-0">
                            <div className="text-[color:var(--text-primary)] text-[13px] font-medium">
                              {pkg.name} · {check.label}
                            </div>
                            <div className="text-[color:var(--text-tertiary)] mt-0.5 text-[12.5px] leading-relaxed">
                              {check.hint}
                            </div>
                          </div>
                        </div>
                      )),
                  )}
                </div>
              </div>
            )}

            {environment && (
              <div className="rise" style={{ animationDelay: "120ms" }}>
                <SectionLabel>环境检测</SectionLabel>
                <div className="glass rounded-[14px] px-5 py-4">
                  <ScoreReadout
                    score={environment.score}
                    max={environment.scoreMax}
                  />
                </div>
              </div>
            )}

            {configActions.length > 0 && (
              <div className="rise" style={{ animationDelay: "180ms" }}>
                <SectionLabel>中文配置</SectionLabel>
                <div className="flex flex-col gap-1">
                  {configActions.map((action) => (
                    <div
                      key={action.id}
                      className="border-[color:var(--line-subtle)]/70 flex items-center gap-3 rounded-[10px] border px-3.5 py-2.5"
                    >
                      <span className="text-[color:var(--text-primary)] w-24 shrink-0 text-[13px]">
                        {action.target}
                      </span>
                      <span className="text-[color:var(--text-tertiary)] flex-1 text-[12.5px]">
                        {action.description}
                      </span>
                      <span className="text-[color:var(--text-quiet)] shrink-0 text-[11.5px]">
                        第三阶段执行
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rise" style={{ animationDelay: "220ms" }}>
              <button
                onClick={() => setShowReport((v) => !v)}
                className="text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] text-[12.5px] transition-colors duration-150"
              >
                {showReport ? "收起报告" : "查看完整报告"}
              </button>

              {showReport && reportText && (
                <pre className="fade glass-soft selectable text-[color:var(--text-secondary)] mt-3 max-h-[240px] overflow-auto rounded-[12px] p-4 font-mono text-[11.5px] leading-relaxed whitespace-pre">
                  {reportText}
                </pre>
              )}

              {reportPath && (
                <p className="text-[color:var(--text-quiet)] selectable mt-2 text-[12px]">
                  已保存到 {reportPath}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <footer className="fade mt-6 flex shrink-0 items-center justify-between border-t border-[color:var(--line-subtle)] pt-5">
        <BackButton />
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            disabled={!reportText}
            onClick={() => void downloadReport()}
          >
            保存报告
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              // Re-run detection and start over. Without this the user is stuck
              // on a report screen with no way back to the beginning.
              void runDetection();
              goTo("detect");
            }}
          >
            重新开始
          </Button>
          <Button
            disabled={!passed.length}
            onClick={() => {
              useApp.setState({
                notice: "「打开概览」：请返回概览页查看这台电脑的完整状态。",
              });
            }}
          >
            返回概览
          </Button>
        </div>
      </footer>
    </div>
  );
}

function PackageRow({ pkg }: { pkg: PackageVerification }) {
  const [open, setOpen] = useState(false);
  const checks: CheckResult[] = [pkg.present, pkg.onPath, pkg.version];

  return (
    <div
      className={clsx(
        "border-[color:var(--line-subtle)] rounded-[10px] border transition-colors duration-150",
        pkg.passed ? "hover:border-[color:var(--line-default)] hover:bg-[color:var(--surface-hover)]" : "bg-[color:var(--surface-raised)]/40",
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <StatusMark confidence={pkg.passed ? "ok" : "fail"} />
        <span className="text-[color:var(--text-primary)] flex-1 text-[13.5px]">{pkg.name}</span>
        <span
          className={clsx(
            "text-[12px]",
            pkg.passed ? "text-[color:var(--status-ok)]" : "text-[color:var(--status-warn)]",
          )}
        >
          {pkg.passed ? "正常" : "需检查"}
        </span>
        <svg
          viewBox="0 0 12 12"
          className={clsx(
            "text-[color:var(--text-quiet)] h-3 w-3 transition-transform duration-200",
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
        <div className="fade border-[color:var(--line-subtle)]/70 flex flex-col gap-1.5 border-t px-3.5 py-3 pl-9">
          {checks.map((check) => (
            <div key={check.key} className="flex items-center gap-2.5">
              <StatusMark confidence={check.confidence} />
              <span className="text-[color:var(--text-tertiary)] w-24 shrink-0 text-[12.5px]">
                {check.label}
              </span>
              <span className="text-[color:var(--text-secondary)] tnum selectable truncate text-[12.5px]">
                {check.observed ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PreparingBlock() {
  return (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="border-[color:var(--line-subtle)]/60 flex items-center gap-3 rounded-[10px] border border-dashed px-3.5 py-3"
        >
          <span className="bg-[color:var(--surface-inset)] h-4 w-4 rounded-full" />
          <span className="bg-[color:var(--surface-inset)] h-3 w-28 rounded" />
        </div>
      ))}
      <p className="text-[color:var(--text-quiet)] mt-1 text-[12.5px]">正在核对安装结果…</p>
    </div>
  );
}
