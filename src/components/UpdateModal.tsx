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
      title="版本与更新控制台 (Release Console)"
      subtitle="Release-Gated Update: 双通道版本发布与稳定批次内容门禁"
      width="lg"
      badge={
        snapshot.app.hasUpdate || snapshot.vault.hasUpdate ? (
          <span className="rounded bg-[color:var(--status-accent)] px-2 py-0.5 text-[11px] font-black text-black">
            有可用更新
          </span>
        ) : (
          <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300 border border-emerald-500/30">
            已是最新发布批次
          </span>
        )
      }
      actions={
        <>
          <div className="text-[11.5px] text-[color:var(--text-quiet)]">
            {snapshot.lastCheckedAt
              ? `上次检查：${new Date(snapshot.lastCheckedAt).toLocaleTimeString()}`
              : "尚未手动检查"}
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
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold text-[color:var(--text-strong)]">
                  应用程序本体通道 (App Release)
                </span>
                <span className="rounded bg-[color:var(--surface-hover)] px-2 py-0.5 text-[10.5px] font-mono text-[color:var(--text-tertiary)] border border-[color:var(--line-subtle)]">
                  v{snapshot.app.currentVersion}
                </span>
              </div>
              <p className="text-[12px] text-[color:var(--text-secondary)] mt-1 leading-relaxed">
                包含 Tauri 桌面运行容器、Rust 底层环境检测、软件安装调度器与核心 UI 框架。
              </p>
            </div>

            <div className="shrink-0 text-right">
              {snapshot.app.hasUpdate ? (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-400 border border-amber-500/30">
                  新版 {snapshot.app.latestVersion}
                </span>
              ) : (
                <span className="text-[11.5px] text-emerald-400 font-medium">
                  当前已是最新
                </span>
              )}
            </div>
          </div>

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
              {snapshot.vault.hasUpdate ? (
                <span className="rounded bg-[color:var(--status-accent)] px-2 py-0.5 text-[11px] font-black text-black">
                  有新批次 {snapshot.vault.latestVersion}
                </span>
              ) : (
                <span className="text-[11.5px] text-emerald-400 font-medium">
                  内容已同步
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
