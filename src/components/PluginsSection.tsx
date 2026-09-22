/**
 * PluginsSection — the dashboard's 插件 section.
 *
 * The catalogue is rendered as cards, one per `plugins/*.json` row, and every
 * claim on the card comes from Rust: compatibility verdicts, blocked reasons
 * and install state are computed by `plugin_views`, not re-derived here. Two
 * screens deciding "can I install this" independently is how they drift.
 *
 * Actions return a `PluginRun`, whose stages are rendered verbatim — the
 * preview and the install report from the *same* pipeline, so what the user
 * approved is what the log later shows.
 */

import { useEffect, useState } from "react";
import { pluginTargets, pluginViews, runPlugin } from "../lib/ipc";
import type {
  Confidence,
  CompatStatus,
  PluginRun,
  PluginRunMode,
  PluginTargetState,
  PluginView,
  StageOutcome,
} from "../lib/types";
import { Button, SectionLabel, StatusMark } from "./ui";
import { StatusBadge } from "./StatusBadge";

/**
 * How each compatibility verdict is drawn.
 *
 * `unverified` and `unknownVersion` map to `unknown` (the "could not tell"
 * state) rather than `fail`: upstream never promising a version is not the
 * same as upstream promising it won't work, and the section must not tell a
 * student their Claude is broken when nobody has checked.
 */
const COMPAT_BADGE: Record<
  CompatStatus,
  { confidence: Confidence; label: string }
> = {
  verified: { confidence: "ok", label: "已验证" },
  unverified: { confidence: "unknown", label: "未验证" },
  incompatible: { confidence: "fail", label: "不兼容" },
  targetMissing: { confidence: "fail", label: "目标未安装" },
  unknownVersion: { confidence: "unknown", label: "版本未知" },
};

const RISK_LABEL: Record<string, string> = { low: "低", medium: "中", high: "高" };

/** Stage status → the app's four-value glyph vocabulary. */
const STAGE_MARK: Record<StageOutcome["status"], Confidence> = {
  ok: "ok",
  warn: "unknown",
  fail: "fail",
  skipped: "skipped",
};

type Phase = "idle" | "loading" | "ready" | "error";

export function PluginsSection() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [views, setViews] = useState<PluginView[]>([]);
  const [targets, setTargets] = useState<PluginTargetState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, PluginRun>>({});
  const [allow, setAllow] = useState<Record<string, boolean>>({});

  const load = async () => {
    setPhase("loading");
    try {
      const [v, t] = await Promise.all([pluginViews(), pluginTargets()]);
      // A resolved-but-empty response is not a valid answer from a registered
      // command, and rendering it as "no plugins" would tell the user the
      // catalogue is empty when it was never read. Reject it into the error
      // branch instead of crashing on `undefined.map` later.
      if (!Array.isArray(v) || !Array.isArray(t)) {
        throw new Error("插件目录返回了空响应（命令未注册或结果被丢弃）。");
      }
      setViews(v);
      setTargets(t);
      setError(null);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  useEffect(() => {
    if (phase === "idle") void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const act = async (id: string, mode: PluginRunMode) => {
    setBusy(`${id}:${mode}`);
    try {
      const run = await runPlugin(id, mode, allow[id] ?? false);
      setRuns((prev) => ({ ...prev, [id]: run }));
      // The run may have written files or changed plugin-state.json, so the
      // views' active/blocked verdicts are stale the moment it returns.
      const [v, t] = await Promise.all([pluginViews(), pluginTargets()]);
      setViews(v);
      setTargets(t);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (phase === "loading" && !views.length) {
    return (
      <div className="flex flex-col gap-6">
        <SectionLabel>插件</SectionLabel>
        <div className="text-[color:var(--text-tertiary)] text-[13px]">
          正在检测 Claude 与插件目录…
        </div>
      </div>
    );
  }

  if (phase === "error" && !views.length) {
    return (
      <div className="flex flex-col gap-6">
        <SectionLabel>插件</SectionLabel>
        <div className="glass-soft rise rounded-[12px] p-5">
          <div className="text-[color:var(--text-primary)] mb-1.5 text-[13px] font-medium">
            无法读取插件目录
          </div>
          <p className="text-[color:var(--text-tertiary)] text-[12.5px] leading-relaxed">
            {error ?? "读取插件目录时出错。这不影响环境检测与软件安装。"}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3.5"
            onClick={() => void load()}
          >
            重试
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="rise">
        <h1
          data-testid="plugins-heading"
          className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]"
        >
          Claude 增强插件
        </h1>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed">
          中文界面、状态栏与技能增强。安装前可先预览将改动的文件，改动能一键回滚。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {targets.map((t) => (
            <StatusBadge
              key={t.target}
              confidence={t.installed ? "ok" : "fail"}
              label={
                t.installed
                  ? `${t.target === "claude-desktop" ? "Claude Desktop" : "Claude Code"} 已安装${t.version ? `（${t.version}）` : ""}`
                  : `${t.target === "claude-desktop" ? "Claude Desktop" : "Claude Code"} 未安装`
              }
              size="sm"
              data-testid={`plugin-target-${t.target}`}
            />
          ))}
        </div>
      </header>

      {error && (
        <div
          data-testid="plugins-error"
          className="glass-soft rounded-[12px] px-4 py-3 text-[12.5px] text-[color:var(--status-bad)]"
        >
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {views.map((v) => {
          const badge = COMPAT_BADGE[v.compat];
          const run = runs[v.id];
          const blockIsOnlyUnverified = v.blockedReason?.startsWith("版本未验证") ?? false;
          const canOverride =
            blockIsOnlyUnverified && (v.compat === "unverified" || v.compat === "unknownVersion");
          const installDisabled =
            !!v.blockedReason && !(canOverride && (allow[v.id] ?? false));
          const pending = busy?.startsWith(`${v.id}:`) ?? false;

          return (
            <div
              key={v.id}
              data-testid={`plugin-card-${v.id}`}
              className="glass-soft rise rounded-[12px] p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[color:var(--text-strong)] text-[15px] font-medium">
                  {v.name}
                </span>
                <span className="rounded-full border border-[color:var(--line-default)] px-2 py-[2px] text-[10.5px] text-[color:var(--text-quiet)]">
                  {v.category}
                </span>
                <span className="rounded-full border border-[color:var(--line-default)] px-2 py-[2px] text-[10.5px] text-[color:var(--text-quiet)]">
                  风险{RISK_LABEL[v.riskLevel] ?? v.riskLevel}
                </span>
                <span className="rounded-full border border-[color:var(--line-default)] px-2 py-[2px] text-[10.5px] tracking-[0.08em] text-[color:var(--text-quiet)] uppercase">
                  {v.evidence.replace(/[A-Z]/g, (c) => c).replace(/([a-z])([A-Z])/g, "$1 $2")}
                </span>
                <StatusBadge
                  confidence={badge.confidence}
                  label={badge.label}
                  size="sm"
                  data-testid={`plugin-compat-${v.id}`}
                />
                {v.active && (
                  <StatusBadge
                    confidence="ok"
                    label={`已安装${v.installedForVersion ? `（针对 ${v.installedForVersion}）` : ""}`}
                    size="sm"
                    data-testid={`plugin-active-${v.id}`}
                  />
                )}
              </div>

              <p className="text-[color:var(--text-tertiary)] mt-2 text-[12.5px] leading-relaxed">
                {v.description}
              </p>
              <p className="text-[color:var(--text-quiet)] mt-1 text-[11.5px] leading-relaxed">
                {v.compatReason}
              </p>

              {v.stale && (
                <p
                  data-testid={`plugin-stale-${v.id}`}
                  className="mt-2 text-[12px] text-[color:var(--status-warn)]"
                >
                  Claude 已更新，此插件需要重新应用（原安装于 {v.installedForVersion}）。
                </p>
              )}

              <dl className="mt-3 grid gap-1 text-[12px]">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-[color:var(--text-quiet)]">安装方式</dt>
                  <dd className="text-[color:var(--text-secondary)]">{v.installMethod}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-[color:var(--text-quiet)]">上游</dt>
                  <dd className="text-[color:var(--text-secondary)] break-all">
                    {v.source}（{v.license}）
                  </dd>
                </div>
                {v.requires.length > 0 && (
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-[color:var(--text-quiet)]">依赖</dt>
                    <dd className="text-[color:var(--text-secondary)]">
                      {v.requires.join("、")}
                    </dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-[color:var(--text-quiet)]">会改动</dt>
                  <dd className="text-[color:var(--text-secondary)]">
                    <ul className="flex flex-col gap-0.5">
                      {v.modifies.map((m) => (
                        <li key={m} className="break-all">
                          {m}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              </dl>

              {v.requiresAdmin && (
                <p className="mt-2 text-[12px] text-[color:var(--status-warn)]">
                  安装需要管理员授权（会弹 UAC）。
                </p>
              )}

              {v.layerNotes.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1" data-testid={`plugin-layers-${v.id}`}>
                  {v.layerNotes.map(([layer, usable, note]) => (
                    <li key={layer} className="flex items-start gap-2 text-[12px]">
                      <StatusMark
                        confidence={usable ? "ok" : "unknown"}
                        size="sm"
                        className="mt-[2px]"
                      />
                      <span className="text-[color:var(--text-secondary)]">
                        Layer {layer === "plugin" ? 1 : layer === "hook" ? 2 : layer === "config" ? 3 : 4}
                        {" — "}
                        {note}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {canOverride && (
                <label className="mt-3 flex items-center gap-2 text-[12px] text-[color:var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={allow[v.id] ?? false}
                    onChange={(e) =>
                      setAllow((prev) => ({ ...prev, [v.id]: e.target.checked }))
                    }
                    data-testid={`plugin-allow-unverified-${v.id}`}
                  />
                  放行未验证版本（我知道上游未对该版本做验证）
                </label>
              )}

              {v.blockedReason && !installDisabled && (
                <p className="mt-2 text-[12px] text-[color:var(--status-warn)]">
                  {v.blockedReason} —— 已手动放行。
                </p>
              )}
              {v.blockedReason && installDisabled && (
                <p
                  className="mt-2 text-[12px] text-[color:var(--text-quiet)]"
                  data-testid={`plugin-blocked-${v.id}`}
                >
                  暂不可安装：{v.blockedReason}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => void act(v.id, "dryRun")}
                  data-testid={`plugin-preview-${v.id}`}
                >
                  预览改动
                </Button>
                <Button
                  size="sm"
                  disabled={pending || installDisabled}
                  onClick={() => void act(v.id, "install")}
                  data-testid={`plugin-install-${v.id}`}
                >
                  {v.active ? "重新安装" : "安装"}
                </Button>
                {v.active && v.verifySupported && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => void act(v.id, "verify")}
                    data-testid={`plugin-verify-${v.id}`}
                  >
                    验证
                  </Button>
                )}
                {v.backup && v.rollbackSupported && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => void act(v.id, "rollback")}
                    data-testid={`plugin-rollback-${v.id}`}
                  >
                    回滚
                  </Button>
                )}
                <Button
                  variant="quiet"
                  size="sm"
                  disabled={pending || phase === "loading"}
                  onClick={() => void load()}
                  data-testid={`plugin-refresh-${v.id}`}
                >
                  重新检测
                </Button>
              </div>

              {run && (
                <div
                  className="glass mt-4 rounded-[10px] p-4"
                  data-testid={`plugin-run-${v.id}`}
                >
                  <div className="flex items-center gap-2">
                    <StatusMark
                      confidence={
                        run.status === "succeeded"
                          ? "ok"
                          : run.status === "refused"
                            ? "unknown"
                            : "fail"
                      }
                    />
                    <span className="text-[color:var(--text-primary)] text-[13px] font-medium">
                      {run.reason}
                    </span>
                  </div>
                  <ul className="mt-2.5 flex flex-col gap-1.5">
                    {run.stages.map((s) => (
                      <li
                        key={s.key}
                        className="flex items-start gap-2 text-[12px]"
                        data-testid={`plugin-stage-${s.key}`}
                      >
                        <StatusMark
                          confidence={STAGE_MARK[s.status]}
                          size="sm"
                          className="mt-[2px]"
                        />
                        <span className="text-[color:var(--text-secondary)]">
                          <span className="text-[color:var(--text-primary)]">{s.label}</span>
                          {" — "}
                          {s.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {run.modified.length === 0 ? (
                    <p
                      className="mt-2 text-[12px] text-[color:var(--text-quiet)]"
                      data-testid={`plugin-untouched-${v.id}`}
                    >
                      原 Claude 文件未受影响。
                    </p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-0.5 text-[11.5px] text-[color:var(--text-quiet)]">
                      {run.modified.map((p) => (
                        <li key={p} className="break-all">
                          {p}
                        </li>
                      ))}
                    </ul>
                  )}
                  {run.backup && (
                    <p className="mt-1 text-[11.5px] break-all text-[color:var(--text-quiet)]">
                      备份：{run.backup}
                    </p>
                  )}
                  {(run.status !== "succeeded" || run.offerRetry) && (
                    <div className="mt-2">
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => void load()}
                        data-testid={`plugin-retry-${v.id}`}
                      >
                        重新检测
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
