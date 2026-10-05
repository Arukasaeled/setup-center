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
import clsx from "clsx";
import { Button, SectionLabel } from "./ui";
import { CONTACT } from "./ProGate";
import { useApp } from "../lib/store";

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
 * the 版本与激活 section and nothing pointed at it. "随时可以在「版本与激活」中升级"
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
export function UpgradePrompt({
  className,
  align = "end",
  defaultOpen = false,
  onUpgraded,
  onNavigate,
}: {
  className?: string;
  /** Which edge the revealed card hugs. The wizard is centred, the bar is not. */
  align?: "start" | "end";
  defaultOpen?: boolean;
  onUpgraded?: () => void;
  /** Optional "去版本与激活页" route, for hosts that have such a section. */
  onNavigate?: () => void;
}) {
  const entitlements = useApp((s) => s.entitlements);
  const [open, setOpen] = useState(defaultOpen);

  // Still reading, or the read failed. Say nothing rather than something wrong.
  if (!entitlements) return null;

  const isPro = entitlements.state === "active";

  if (isPro) {
    return (
      <div
        data-testid="upgrade-pro-active"
        className={clsx(
          "flex items-center gap-2 text-[color:var(--text-secondary)] text-[12.5px]",
          className,
        )}
      >
        <span className="text-[color:var(--status-ok)]" aria-hidden>
          ✓
        </span>
        <span data-testid="upgrade-pro-label">PRO 已激活</span>
      </div>
    );
  }

  return (
    <div className={clsx("flex flex-col", className)}>
      <div
        className={clsx(
          "flex items-center gap-2.5",
          align === "end" ? "justify-end" : "justify-start",
        )}
      >
        <span
          data-testid="upgrade-free-label"
          className="text-[color:var(--text-quiet)] text-[12.5px]"
        >
          FREE
        </span>
        <Button
          size="sm"
          variant="ghost"
          data-testid="upgrade-entry"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "收起" : "升级 PRO"}
        </Button>
      </div>

      {/* The card in place, not in a modal. A modal would be the one interaction
          this app has spent every previous round removing, and the card is small
          enough to sit in the flow. */}
      {open && (
        <div
          data-testid="upgrade-panel"
          className="rise mt-3 w-full text-left"
        >
          <ActivationCard
            autoFocus
            onActivated={() => {
              setOpen(false);
              onUpgraded?.();
            }}
          />
          {onNavigate && (
            <button
              type="button"
              onClick={onNavigate}
              className="text-[color:var(--text-quiet)] hover:text-[color:var(--text-secondary)] mt-2.5 text-[12px] transition-colors"
            >
              查看功能范围与设备绑定 →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The dashboard's 版本与激活 section.
 *
 * Behaviour is unchanged from the version that lived inside `Dashboard.tsx`;
 * the extraction only moved it. The loading and unreadable branches stay here
 * because they are about the *section*, not the card.
 */
export function LicenseSection() {
  const entitlements = useApp((s) => s.entitlements);
  const phase = useApp((s) => s.entitlementsPhase);
  const error = useApp((s) => s.entitlementsError);
  const loadEntitlements = useApp((s) => s.loadEntitlements);

  useEffect(() => {
    if (phase === "idle") void loadEntitlements();
  }, [phase, loadEntitlements]);

  if (phase === "loading" && !entitlements) {
    return (
      <div className="flex flex-col gap-6">
        <SectionLabel>版本与激活</SectionLabel>
        <div className="text-[color:var(--text-tertiary)] text-[13px]">
          正在读取…
        </div>
      </div>
    );
  }

  if (!entitlements) {
    return (
      <div className="flex flex-col gap-6">
        <SectionLabel>版本与激活</SectionLabel>
        <div className="glass-soft rise rounded-[12px] p-5">
          <div className="text-[color:var(--text-primary)] mb-1.5 text-[13px] font-medium">
            无法读取授权状态
          </div>
          <p className="text-[color:var(--text-tertiary)] text-[12.5px] leading-relaxed">
            {error ??
              "读取本机授权信息时出错。这不影响环境检测与软件推荐功能。"}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3.5"
            onClick={() => void loadEntitlements()}
          >
            重试
          </Button>
        </div>
      </div>
    );
  }

  const isPro = entitlements.state === "active";
  const mismatch = entitlements.state === "device_mismatch";

  return (
    <div className="flex flex-col gap-8">
      <header className="rise">
        <h1
          data-testid="license-heading"
          className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]"
        >
          {isPro ? "Setup Center Professional" : "Setup Center 免费版"}
        </h1>
        <p className="text-[color:var(--text-tertiary)] mt-1 text-[13px] leading-relaxed">
          {isPro
            ? "自动安装与配置功能已解锁。"
            : mismatch
              ? "授权验证失败，该授权已绑定其他设备。"
              : // Derived from the gate rather than written as a fixed sentence.
                // A hard-coded "不包含自动安装" was the first version of this
                // line, and it was a real bug: it kept asserting that
                // installation was locked even in a build where `canInstall`
                // was true, so the screen contradicted the button below it.
                entitlements.canInstall
                ? "本构建未启用限制，全部功能可用。"
                : "可检测环境与查看软件推荐，不包含自动安装。"}
        </p>
      </header>

      {/* The capability list. Kept in capability terms rather than marketing
          ones: what the customer is buying is a specific set of actions, and
          naming them is what makes the price decidable. */}
      <section className="glass rose rise rounded-[12px] p-5">
        <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
          功能范围
        </div>
        <div className="mt-3 flex flex-col gap-2.5">
          <EntitlementRow
            label="环境检测"
            detail="读取系统信息、扫描已装软件、分析缺口"
            allowed
          />
          <EntitlementRow
            label="软件推荐"
            detail="按方向推荐要装什么、为什么需要它"
            allowed
          />
          <EntitlementRow
            label="自动安装"
            detail={
              entitlements.canInstall
                ? "已授权，可自动下载并安装"
                : "激活专业版后可用"
            }
            allowed={entitlements.canInstall}
          />
          <EntitlementRow
            label="自动配置"
            detail={
              entitlements.canConfigure
                ? "已授权，可初始化环境与配置文件"
                : "激活专业版后可用"
            }
            allowed={entitlements.canConfigure}
          />
        </div>
      </section>

      {/* Activation, or the activated state. */}
      <section className="rise">
        <SectionLabel>激活</SectionLabel>
        <div className="mt-3">
          <ActivationCard />
        </div>
      </section>

      {/* Purchase route, for the tier that cannot do the main thing. */}
      {!isPro && (
        <section className="rise">
          <SectionLabel>获取专业版</SectionLabel>
          <div className="glass-soft mt-3 rounded-[12px] p-5">
            <ContactRows />
          </div>
        </section>
      )}

      {/* Honesty about what activation does not do. There is no account and no
          server, and saying so is better than letting a customer assume an
          activation protects something it does not. */}
      <p className="text-[color:var(--quiet-text,var(--text-quiet))] rise text-[12px] leading-relaxed">
        本版本不联网校验授权，不收集账号信息，激活信息仅保存在本机，
        且无法导出或复制到其他设备。
      </p>
    </div>
  );
}
