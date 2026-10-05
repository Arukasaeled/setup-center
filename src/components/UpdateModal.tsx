import { useState, useEffect } from "react";
import { Button } from "./ui";
import { DetailShell } from "./DetailShell";
import { ReleaseManagerInstance, type ReleaseStatusSnapshot } from "../core/vault/release";
import { VaultSync } from "../core/vault";
import { loadVaultCache } from "../core/vault/cache";
import { getBuildIdentity } from "../lib/buildIdentity";

/**
 * The Vault content inspector.
 *
 * ## Why it no longer claims to inspect the app
 *
 * This panel was called the "Version Inspector" and showed two channels side by
 * side: the application binary (fetched from the GitHub Releases API) and the
 * Vault content batch. Only the second one was ever actionable. Setup Center is
 * distributed by hand — the author ships a new installer — so a program that
 * polls GitHub to announce a version of itself it cannot install is telling the
 * customer about a decision that is not the program's to make. That channel is
 * deleted end to end (`core/vault/release.ts` documents the removal), and with
 * it the `检测失败 / 网络受限` state, which was the only thing a customer ever
 * actually saw from it.
 *
 * What remains is the part that works and that a customer uses: the Vault
 * content batch, its current version, whether a newer batch exists, and the
 * button that pulls it. The rename from `版本与更新控制台` to `内容与更新中心`
 * follows the page rather than leading it.
 *
 * ## What is kept, and why "Build Truth" is not App Release
 *
 * The header strip still reports the runtime, commit and build time. That is
 * read from build-time constants and a local cache — it performs no network I/O
 * and asserts nothing about the future, so it is *disclosure* rather than an
 * update check. It stays because a support conversation needs it, and it is the
 * one place a customer can confirm which build they are running.
 */
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
  const identity = getBuildIdentity();
  const cachedLkg = loadVaultCache();

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

  return (
    <DetailShell
      isOpen={isOpen}
      onClose={onClose}
      title="内容与更新中心 (Vault Inspector)"
      subtitle="Vault 内容批次：当前版本、上游正式发布批次与同步状态"
      width="lg"
      badge={
        snapshot.vault.hasUpdate ? (
          <span className="rounded bg-[color:var(--status-accent)] px-2 py-0.5 text-[11px] font-black text-black">
            有新内容批次
          </span>
        ) : snapshot.vault.status === "up-to-date" ? (
          <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300 border border-emerald-500/30">
            已确认最新稳定批次
          </span>
        ) : snapshot.vault.status === "error" ? (
          <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[11px] font-medium text-rose-300 border border-rose-500/30">
            内容通道连接异常，沿用本地缓存
          </span>
        ) : snapshot.isChecking ? (
          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[11px] font-medium text-blue-300 border border-blue-500/30">
            正在比对上游批次…
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
              {snapshot.isChecking ? "检查中…" : "立即检查内容批次"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              完成
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-4">
        {/* Build truth. Local reads only — no network request is made here, and
            nothing in this strip compares itself against a remote release. */}
        <div className="rounded-xl border border-[color:var(--line-default)] bg-[color:var(--surface-sunken)] p-3.5 flex flex-wrap items-center justify-between gap-2.5 text-[11.5px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-[color:var(--text-strong)]">运行环境基线：</span>
            <span className="rounded bg-[color:var(--surface-raised)] px-2 py-0.5 font-mono text-[color:var(--text-primary)] border border-[color:var(--line-subtle)] font-bold">
              {identity.runtime}
            </span>
            <span className="text-[color:var(--text-quiet)] font-mono">
              commit: {identity.commitSha}
            </span>
            {identity.buildTime && (
              <span className="text-[color:var(--text-quiet)]">
                build: {new Date(identity.buildTime).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[color:var(--text-quiet)]">资产状态:</span>
            <span className="rounded bg-[color:var(--surface-raised)] px-2 py-0.5 font-mono text-[color:var(--text-secondary)] border border-[color:var(--line-subtle)] font-semibold">
              {cachedLkg ? `LKG 缓存 (v${cachedLkg.manifest.contentVersion})` : "Built-in 内置"}
            </span>
          </div>
        </div>

        {/* The channel. Content only. */}
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

        {/* The one promise about content updates, stated plainly and narrowly.
            Not "永久免费" and not "永久无限更新": the purchase is not a
            perpetual-update guarantee, and writing one here would create a term
            the product page does not back. The selling point belongs on the
            product page; the program only has to make the capability legible. */}
        <div className="rounded-xl border border-[color:var(--line-subtle)] bg-[color:var(--surface-raised)]/50 p-3.5 text-[12px] text-[color:var(--text-tertiary)] leading-relaxed">
          <div className="font-semibold text-[color:var(--text-secondary)] mb-1">
            关于更新
          </div>
          <p>
            Setup Center 贯彻“程序本体轻量，外部资产按需热分发”的架构原则。内容资源持续更新，已激活用户可持续获取新的 Vault 内容批次；软件安装包本身由作者随版本重新分发，程序不会自行检查或下载新的安装包。
          </p>
        </div>
      </div>
    </DetailShell>
  );
}
