/**
 * The activation surface, shared by the dashboard's licence section and the
 * first-run activation gate.
 *
 * ## Why this is a component and not two screens
 *
 * The gate and the licence section ask the customer the same question — "is this
 * a PRO machine?" — and differ only in *what surrounds the question*. The gate
 * is that question alone, at first launch, with a way out to FREE. The section
 * adds the capability list, the purchase contacts and the honesty note, in a
 * place the customer returns to.
 *
 * Two copies of the activation logic would drift: the input's disabled rule, the
 * "clear only on success" behaviour, the error slot. Those are the details a
 * customer notices when they differ, and they are exactly the details that get
 * fixed in one copy and forgotten in the other.
 *
 * ## What it owns and what it does not
 *
 * It owns the *presentation* of activation: the input, the button, the error
 * line, the activated state. It does not own the licence logic — every action
 * here is a store action (`loadEntitlements`, `activateLicense`,
 * `deactivateLicense`), the same ones the dashboard always used. Moving this
 * component must not change how licensing works, only where it is rendered.
 *
 * `variant` selects the surroundings:
 *
 * - `"section"` — the dashboard's licence section, unchanged from before this
 *   component existed.
 * - `"gate"` — first launch: the focused activation card plus an explicit route
 *   to the FREE tier.
 *
 * The activation *card* (input, button, error, mismatch note) is identical in
 * both, which is the point.
 */

import { useEffect, useState } from "react";
import { Button, SectionLabel } from "./ui";
import { CONTACT } from "./ProGate";
import { useApp } from "../lib/store";
import { ReleaseManagerInstance } from "../core/vault/release";

/** Renders the stored ISO-8601 timestamp as a readable local date. */
export function formatActivatedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

/** The purchase contacts, shared by the licence and about sections. */
export function ContactRows() {
  return (
    <div className="flex flex-col gap-2 text-[12.5px]">
      <div className="flex items-baseline gap-2">
        <span className="text-[color:var(--text-quiet)] w-[52px] shrink-0">
          QQ
        </span>
        {/* `selectable` so it can be copied by hand — the customer has to get it
            into another app, and there is no clipboard helper in this build. */}
        <span className="selectable text-[color:var(--text-primary)] font-mono">
          {CONTACT.qq}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[color:var(--text-quiet)] w-[52px] shrink-0">
          微信
        </span>
        <span className="selectable text-[color:var(--text-primary)] font-mono">
          {CONTACT.wechat}
        </span>
      </div>
    </div>
  );
}

/** A single ✓/✕ capability line, used by the section's scope list. */
export function EntitlementRow({
  label,
  detail,
  allowed,
}: {
  label: string;
  detail: string;
  allowed: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={
          "mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full " +
          (allowed ? "bg-[color:var(--accent)]" : "bg-[color:var(--text-quiet)]")
        }
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="text-[color:var(--text-primary)] block text-[13px]">
          {label}
        </span>
        <span className="text-[color:var(--text-tertiary)] mt-0.5 block text-[12px] leading-relaxed">
          {detail}
        </span>
      </span>
    </div>
  );
}

/**
 * The activation card: input, action, error, and the activated state.
 *
 * Extracted so the gate and the section cannot disagree about how activation
 * behaves. `onActivated` lets a host react to a successful activation without
 * this component knowing what a host is — the gate uses it to leave, the section
 * ignores it.
 */
export function ActivationCard({
  onActivated,
  autoFocus = false,
}: {
  onActivated?: () => void;
  autoFocus?: boolean;
}) {
  const entitlements = useApp((s) => s.entitlements);
  const device = useApp((s) => s.licenseDevice);
  const activating = useApp((s) => s.activatingLicense);
  const error = useApp((s) => s.entitlementsError);
  const activateLicense = useApp((s) => s.activateLicense);
  const deactivateLicense = useApp((s) => s.deactivateLicense);

  const [key, setKey] = useState("");

  const isPro = entitlements?.state === "active";
  const mismatch = entitlements?.state === "device_mismatch";

  if (isPro && entitlements) {
    return (
      <div className="glass-soft rounded-[12px] p-5">
        <div
          data-testid="license-pro-state"
          className="text-[color:var(--text-primary)] text-[13.5px] font-medium"
        >
          已激活
        </div>
        <div className="mt-3 flex flex-col gap-1.5 text-[12.5px]">
          <ActivationDetailRow label="设备绑定" value="当前设备" />
          {entitlements.activatedAt && (
            <ActivationDetailRow
              label="激活时间"
              value={formatActivatedAt(entitlements.activatedAt)}
            />
          )}
          {/* An abbreviated digest, so a support conversation can tell two
              machines apart. Not the fingerprint, and not the code. */}
          {device && <ActivationDetailRow label="设备标识" value={device.shortId} />}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3.5"
          disabled={activating}
          onClick={() => void deactivateLicense()}
        >
          {activating ? "处理中…" : "取消激活"}
        </Button>
      </div>
    );
  }

  return (
    <div className="glass-soft rounded-[12px] p-5">
      {mismatch && (
        <div
          data-testid="license-mismatch"
          className="border-[color:var(--status-warn)] mb-4 border-l-2 pl-3"
        >
          <div className="text-[color:var(--text-primary)] text-[12.5px] font-medium">
            授权验证失败，该授权已绑定其他设备
          </div>
          <p className="text-[color:var(--text-tertiary)] mt-1 text-[12px] leading-relaxed">
            {entitlements?.deviceReliable
              ? `本机设备标识为 ${device?.shortId ?? "未知"}。若这是你的原设备，请联系作者处理；若你换了新电脑，需要一份新的激活码。`
              : "本机硬件信息读取不完整，可能是驱动或 WMI 限制导致误判。请联系作者处理。"}
          </p>
        </div>
      )}
      <label
        htmlFor="activation-key"
        className="text-[color:var(--text-primary)] text-[13.5px] font-medium"
      >
        输入激活码
      </label>
      <p className="text-[color:var(--text-tertiary)] mt-1 text-[12.5px] leading-relaxed">
        激活码与本机硬件绑定，重装系统后仍然有效。
      </p>
      <div className="mt-3.5 flex gap-2">
        <input
          id="activation-key"
          type="text"
          value={key}
          autoFocus={autoFocus}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits, so the gate is usable without reaching for the
            // mouse — this is the first screen a customer sees.
            if (e.key === "Enter" && !activating && key.trim().length > 0) {
              e.preventDefault();
              void (async () => {
                if (await activateLicense(key)) {
                  setKey("");
                  onActivated?.();
                }
              })();
            }
          }}
          placeholder="SC-XXXXX-XXXXX-XXXXX-XXXXX"
          aria-label="激活码"
          disabled={activating}
          className="glass-soft text-[color:var(--text-primary)] placeholder:text-[color:var(--text-quiet)] focus-ring min-w-0 flex-1 rounded-[8px] px-3 py-2 font-mono text-[13px] outline-none disabled:opacity-60"
        />
        <Button
          size="sm"
          disabled={activating || key.trim().length === 0}
          onClick={async () => {
            // Cleared only on success, so a rejected key stays on screen for the
            // customer to correct rather than vanishing.
            if (await activateLicense(key)) {
              setKey("");
              onActivated?.();
            }
          }}
        >
          {activating ? "激活中…" : "激活 PRO"}
        </Button>
      </div>
      {error && (
        <p
          data-testid="license-error"
          role="alert"
          className="text-[color:var(--status-warn)] mt-2.5 text-[12px] leading-relaxed"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** A label/value line, local to the card so it does not depend on the dashboard. */
function ActivationDetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[color:var(--text-quiet)] w-[52px] shrink-0">
        {label}
      </span>
      <span className="selectable text-[color:var(--text-primary)] font-mono">
        {value}
      </span>
    </div>
  );
}

/**
 * The persistent "升级 PRO" entry, for hosts that are not the licence section.
 *
 * ## Why this exists
 *
 * The gate is a *first-run* decision, and `App.tsx` records that it was answered
 * so it is never asked twice. The consequence was unintended: a customer who
 * chose FREE — or anyone re-opening the app months later — had no way to reach
 * activation at all, because the only other copy of `ActivationCard` lives on
 * the 版本与授权 section and nothing pointed at it. "随时可以在「版本与授权」中升级"
 * was true and undiscoverable.
 *
 * This is the entry that makes it discoverable, and it is deliberately tiny: a
 * button that reveals the *existing* card.
 *
 * ## What it does not do
 *
 * It does not own activation. It renders `ActivationCard`, which owns the input,
 * the request and the activated state — so the gate, the licence section and
 * this entry cannot disagree about how activation behaves, because there is
 * still exactly one implementation.
 *
 * `onUpgraded` lets a host react (the dashboard scrolls the newly-PRO state into
 * view); `onNavigate` lets a host that has a licence *section* offer a route to
 * it as well, without this component knowing what a section is.
 *
 * ## Three states, and the one that must stay silent
 *
 * - PRO → a quiet confirmation. Shown rather than hidden so the customer who
 *   just activated sees that it took, and so the row does not silently vanish.
 * - FREE → the badge and the entry.
 * - unknown (`entitlements === null` while the licence is still being read, or
 *   after a read error) → nothing at all. Flashing "FREE" at a paying customer
 *   mid-read is the same mistake `VersionBadge` documents avoiding; flashing an
 *   *upgrade* button at them would be worse, because it asks them to buy
 *   something they already own.
 */
export function UpgradePrompt(_props?: {
  className?: string;
  align?: "start" | "end";
  defaultOpen?: boolean;
  onUpgraded?: () => void;
  onNavigate?: () => void;
}) {
  return null;
}

/**
 * The dashboard's 版本与更新 section.
 *
 * Fully free, open-source & local-first. Shows version, integrity, and available capabilities.
 */
export function LicenseSection() {
  const status = useApp((s) => s.status);
  const loadStatus = useApp((s) => s.loadStatus);
  const [appVersion, setAppVersion] = useState(
    () => ReleaseManagerInstance.getSnapshot().app.currentVersion,
  );

  useEffect(() => {
    if (!status) void loadStatus();
    void ReleaseManagerInstance.hydrateRuntimeVersion().then((v) => {
      if (v) setAppVersion(v);
    });
    return ReleaseManagerInstance.subscribe((s) => setAppVersion(s.app.currentVersion));
  }, [status, loadStatus]);

  return (
    <div className="flex flex-col gap-8">
      <header className="rise">
        <div className="inline-flex items-center gap-2 rounded px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[color:var(--status-accent)] bg-[color:var(--surface-sunken)] mb-2">
          STATUS & RELEASE // 版本与更新
        </div>
        <h1
          data-testid="license-heading"
          className="text-[color:var(--text-strong)] text-[22px] font-bold tracking-[-0.02em]"
        >
          Setup Center {appVersion ? `· v${appVersion}` : ""}
        </h1>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed">
          免费开源 · 本地优先 · 面向开发者的 Creative & Development Bootstrap Hub。
          所有功能默认完全可用，无需激活码，不设付费门槛。
        </p>
      </header>

      {/* Feature scope list */}
      <section className="glass rose rise rounded-[12px] p-5">
        <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium mb-1">
          功能与核心能力
        </div>
        <p className="text-[color:var(--text-tertiary)] text-[12px] mb-3 leading-relaxed">
          Setup Center 致力于让「找资源」与「Setup」无缝闭环：
        </p>
        <div className="flex flex-col gap-3">
          <EntitlementRow
            label="环境检测与硬件侦测"
            detail="深度读取系统信息、扫描已装软件、硬件兼容性诊断"
            allowed
          />
          <EntitlementRow
            label="软件清单与 Winget 全网检索"
            detail="36 款精选开发软件官方源 + Winget 官方仓库数万款软件秒级搜索与安装"
            allowed
          />
          <EntitlementRow
            label="GitHub 项目探索与一键克隆"
            detail="实时检索开源热门仓库、多项目指标对比、一键 Git Clone 至本地目录"
            allowed
          />
          <EntitlementRow
            label="现代化项目脚手架 (Scaffolding)"
            detail="Next.js、Vite、FastAPI、Tauri 等模板一键交互式生成"
            allowed
          />
          <EntitlementRow
            label="自动化安装与环境初始化"
            detail="一键配置 PATH、环境变量与开发前置依赖"
            allowed
          />
          <EntitlementRow
            label="我的库与 AI 上下文导出"
            detail="个人收藏清单、历史足迹、自定义开发套件与结构化 Prompt 生成"
            allowed
          />
          <EntitlementRow
            label="20 套视觉体验系统 (Experience System V2)"
            detail="纯粹声明式版式语法，涵盖极简、复古、终端与现代美学"
            allowed
          />
        </div>
      </section>

      {/* Release and open source links */}
      <section className="rise">
        <SectionLabel>开源仓库与反馈</SectionLabel>
        <div className="glass-soft mt-3 rounded-[12px] p-5 flex flex-col gap-3 text-[12.5px]">
          <div className="flex items-center justify-between">
            <span className="text-[color:var(--text-secondary)]">项目开源仓库</span>
            <a
              href="https://github.com/Arukasaeled/setup-center"
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--status-accent)] hover:underline font-mono"
            >
              github.com/Arukasaeled/setup-center ↗
            </a>
          </div>
          <div className="flex items-center justify-between border-t border-[color:var(--line-subtle)] pt-2.5">
            <span className="text-[color:var(--text-secondary)]">远程 Setup Vault</span>
            <a
              href="https://github.com/Arukasaeled/setup-center-vault"
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--status-accent)] hover:underline font-mono"
            >
              github.com/Arukasaeled/setup-center-vault ↗
            </a>
          </div>
          <div className="flex items-center justify-between border-t border-[color:var(--line-subtle)] pt-2.5">
            <span className="text-[color:var(--text-secondary)]">开发者交流 / 问题反馈</span>
            <span className="text-[color:var(--text-primary)] font-mono">
              QQ: {CONTACT.qq} · 微信: {CONTACT.wechat}
            </span>
          </div>
        </div>
      </section>

      {/* Privacy guarantee */}
      <p className="text-[color:var(--text-quiet)] rise text-[12px] leading-relaxed">
        本工具坚持本地优先（Local-First）原则，不采集个人隐私与机器指纹，无需注册登录，所有配置数据均保存在本机。
      </p>
    </div>
  );
}
