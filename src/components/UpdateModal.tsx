import { useState, useEffect } from "react";
import { Button } from "./ui";
import { DetailShell } from "./DetailShell";
import { ReleaseManagerInstance, type ReleaseStatusSnapshot } from "../core/vault/release";
import { VaultSync } from "../core/vault";

export function UpdateModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<ReleaseStatusSnapshot>(() =>
    ReleaseManagerInstance.getSnapshot(),
  );
  const [isSyncingVault, setIsSyncingVault] = useState(false);

  useEffect(() => {
    void ReleaseManagerInstance.hydrateRuntimeVersion();
    return ReleaseManagerInstance.subscribe((s) => setSnapshot(s));
  }, []);

  const handleCheck = async () => {
    await ReleaseManagerInstance.checkForUpdates();
  };

  const handleSyncVault = async () => {
    setIsSyncingVault(true);
    try {
      const res = await VaultSync.sync({ force: true });
      if (res.contentVersion) {
        ReleaseManagerInstance.setVaultCurrentVersion(res.contentVersion);
      }
    } finally {
      setIsSyncingVault(false);
    }
  };

  const openUrl = (url?: string) => {
    if (!url) return;
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // ignore
    }
  };

  return (
    <DetailShell
      isOpen={isOpen}
      onClose={onClose}
      title="版本与更新控制台 (Version Inspector)"
      subtitle="Runtime Truth & Release Gate: 读取真实运行版本、比对上游正式发布与 Vault 稳定批次"
      width="lg"
      badge={
        snapshot.app.hasUpdate || snapshot.vault.hasUpdate ? (
          <span className="rounded bg-[color:var(--status-accent)] px-2 py-0.5 text-[11px] font-black text-black">
            有可用更新
          </span>
        ) : snapshot.app.status === "up-to-date" && snapshot.vault.status === "up-to-date" ? (
          <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300 border border-emerald-500/30">
            已确认最新稳定版本
          </span>
        ) : snapshot.app.status === "error" || snapshot.vault.status === "error" ? (
          <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[11px] font-medium text-rose-300 border border-rose-500/30">
            发布通道连接异常，沿用本地缓存
          </span>
        ) : snapshot.isChecking ? (
          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[11px] font-medium text-blue-300 border border-blue-500/30">
            正在比对上游发布…
          </span>
        ) : (
          <span className="rounded bg-[color:var(--surface-hover)] px-2 py-0.5 text-[11px] text-[color:var(--text-quiet)] border border-[color:var(--line-subtle)]">
            未检查更新
          </span>
        )
      }
      actions={
        <>
          <div className="text-[11.5px] text-[color:var(--text-quiet)]">
            {snapshot.lastCheckedAt
              ? `上次检查：${new Date(snapshot.lastCheckedAt).toLocaleTimeString()}`
              : "尚未手动检查 (未检查 ≠ 已最新)"}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="quiet"
              disabled={snapshot.isChecking}
              onClick={handleCheck}
            >
              {snapshot.isChecking ? "检查中…" : "立即检查全量更新"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              完成
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-4">
        {/* Channel 1: App Release */}
        <div className="rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-sunken)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-bold text-[color:var(--text-strong)]">
                  应用程序本体 (App Release)
                </span>
                <span className="rounded bg-[color:var(--surface-hover)] px-2 py-0.5 text-[11px] font-mono text-[color:var(--text-primary)] border border-[color:var(--line-subtle)] font-bold">
                  当前运行：{snapshot.app.currentVersion ? (snapshot.app.currentVersion.startsWith("v") || snapshot.app.currentVersion.includes("-") ? snapshot.app.currentVersion : `v${snapshot.app.currentVersion}`) : "正在获取…"}
                </span>
                {snapshot.app.runtimeSource && (
                  <span className="text-[11px] text-[color:var(--text-quiet)]">
                    ({snapshot.app.runtimeSource})
                  </span>
                )}
              </div>
              <p className="text-[12px] text-[color:var(--text-secondary)] mt-1.5 leading-relaxed">
                包含 Tauri 桌面运行容器、Rust 底层环境检测、Native 执行控制台与起步中心核心交互。
              </p>
            </div>

            <div className="shrink-0 text-right">
              {snapshot.app.status === "update-available" ? (
                <span className="rounded bg-amber-500/15 px-2.5 py-0.5 text-[11.5px] font-bold text-amber-400 border border-amber-500/30">
                  发现新版本 {snapshot.app.latestVersion}
                </span>
              ) : snapshot.app.status === "up-to-date" ? (
                <span className="text-[12px] text-emerald-400 font-medium">
                  ✓ 当前运行版本已是最新
                </span>
              ) : snapshot.app.status === "checking" ? (
                <span className="text-[12px] text-blue-400 font-medium">
                  检查中…
                </span>
              ) : snapshot.app.status === "error" ? (
                <span className="text-[12px] text-rose-400 font-medium">
                  检测失败 / 网络受限
                </span>
              ) : (
                <span className="text-[12px] text-[color:var(--text-quiet)]">
                  未检查 (点击按钮检测)
                </span>
              )}
            </div>
          </div>

          {snapshot.app.notes && (
            <div className="mt-3 rounded-lg bg-[color:var(--surface-inset)] px-3 py-2 text-[12px] text-[color:var(--text-tertiary)] border border-[color:var(--line-subtle)]">
              <div className="font-semibold text-[color:var(--text-secondary)] mb-1">
                上游发布说明 ({snapshot.app.latestVersion})：
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap">{snapshot.app.notes}</p>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-[color:var(--line-subtle)] flex items-center justify-between">
            <span className="text-[11.5px] text-[color:var(--text-quiet)]">
              发布通道：GitHub Releases / Official Bundles
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="text-[11.5px] px-2.5 py-0.5"
              onClick={() => openUrl(snapshot.app.releaseUrl)}
            >
              查看 GitHub Releases ↗
            </Button>
          </div>
        </div>

        {/* Channel 2: Vault Content Release */}
        <div className="rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-sunken)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold text-[color:var(--text-strong)]">
                  Vault 内容资产通道 (Vault Release)
                </span>
                <span className="rounded bg-[color:var(--surface-hover)] px-2 py-0.5 text-[10.5px] font-mono text-[color:var(--text-tertiary)] border border-[color:var(--line-subtle)]">
                  {snapshot.vault.currentVersion}
                </span>
              </div>
              <p className="text-[12px] text-[color:var(--text-secondary)] mt-1 leading-relaxed">
                包含设计系统 Style CSS、开源开发资源、项目脚手架模板与设计范式。采用发布批次门禁，避免未规整的工作草案干扰使用。
              </p>
            </div>

            <div className="shrink-0 text-right">
              {snapshot.vault.status === "update-available" ? (
                <span className="rounded bg-[color:var(--status-accent)] px-2 py-0.5 text-[11px] font-black text-black">
                  有新批次 {snapshot.vault.latestVersion}
                </span>
              ) : snapshot.vault.status === "up-to-date" ? (
                <span className="text-[11.5px] text-emerald-400 font-medium">
                  ✓ 内容已确认最新
                </span>
              ) : snapshot.vault.status === "checking" ? (
                <span className="text-[11.5px] text-blue-400 font-medium">
                  检查中…
                </span>
              ) : snapshot.vault.status === "error" ? (
                <span className="text-[11.5px] text-rose-400 font-medium">
                  检测失败 / 网络受限
                </span>
              ) : (
                <span className="text-[11.5px] text-[color:var(--text-quiet)]">
                  未检查 (点击按钮检测)
                </span>
              )}
            </div>
          </div>

          {snapshot.vault.summary && (
            <div className="mt-3 rounded-lg bg-[color:var(--surface-inset)] px-3 py-2 text-[12px] text-[color:var(--text-tertiary)] border border-[color:var(--line-subtle)]">
              <span className="font-semibold text-[color:var(--text-secondary)]">批次说明：</span>
              <span>{snapshot.vault.summary}</span>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-[color:var(--line-subtle)] flex items-center justify-between">
            <span className="text-[11.5px] text-[color:var(--text-quiet)]">
              发布通道：setup-center-vault (Release Gated)
            </span>
            <Button
              size="sm"
              variant={snapshot.vault.hasUpdate ? "primary" : "quiet"}
              disabled={isSyncingVault}
              onClick={handleSyncVault}
              className="text-[11.5px] px-2.5 py-0.5 font-bold"
            >
              {isSyncingVault ? "同步中…" : "立即同步 Vault 批次"}
            </Button>
          </div>
        </div>

        {/* Release Principles Explainer */}
        <div className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/50 p-3.5 text-[12px] text-[color:var(--text-tertiary)] leading-relaxed">
          <div className="font-semibold text-[color:var(--text-secondary)] mb-1">
            关于 Release-Gated 机制说明
          </div>
          Setup Center 贯彻“程序本体轻量，外部资产按需热分发”的架构原则。日常资产收录在 Vault 工作区沉淀，经过完整测试与规整后生成正式 Release，方会向客户端提示更新。
        </div>
      </div>
    </DetailShell>
  );
}
