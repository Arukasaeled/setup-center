/**
 * The first-run activation gate.
 *
 * ## When it appears
 *
 * `App.tsx` renders this instead of the wizard when the customer has neither a
 * licence nor a recorded first-run choice. The rules, in precedence order:
 *
 * 1. A licence exists and is active → never shown. PRO wins over any flag.
 * 2. The customer has already answered (chose FREE) → never shown again.
 * 3. Neither → shown.
 *
 * ## What it is not
 *
 * It is not a paywall. FREE is a real, supported way to use Setup Center, and
 * the button that chooses it is a plain secondary button, not a greyed-out
 * "no thanks" link. There is no countdown, no scarcity, no pre-selected tier and
 * no copy that implies the FREE tier is temporary or degraded beyond what it
 * actually is.
 *
 * ## Failure modes it has to survive
 *
 * - The licence read fails (`entitlements === null` after an error). We do *not*
 *   show the gate as if the machine were unlicensed: we show the same
 *   "could not read" state the licence section shows, with a retry. Treating a
 *   read error as "not licensed" would tell a paying customer to buy again.
 * - The `localStorage` write fails. The customer still gets into the app; the
 *   gate simply reappears next launch.
 *
 * ## Layout
 *
 * Deliberately not a wizard step: no progress rail, no back button. It is a
 * decision, and the only two ways out are the two buttons.
 */

import { useEffect, useState } from "react";
import { ActivationCard, ContactRows } from "./ActivationPanel";
import { Button } from "./ui";
import { useApp } from "../lib/store";
import { writeFreeChoice } from "../lib/entry";

export function ActivationGate({ onDone }: { onDone: () => void }) {
  const entitlements = useApp((s) => s.entitlements);
  const phase = useApp((s) => s.entitlementsPhase);
  const error = useApp((s) => s.entitlementsError);
  const loadEntitlements = useApp((s) => s.loadEntitlements);

  // Whether the customer has moved past the gate, so we stop rendering the
  // decision even if the store has not changed surface yet.
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (phase === "idle") void loadEntitlements();
  }, [phase, loadEntitlements]);

  // A licence read that succeeds and says "active" gets the customer straight
  // in. This is the "已激活 PRO 用户直接进入现有主界面" rule, and it has to be an
  // effect rather than a render-time branch because it changes external state.
  const active = entitlements?.state === "active";
  useEffect(() => {
    if (active) onDone();
  }, [active, onDone]);

  const loading = phase === "loading" || phase === "idle";
  const unreadable = !loading && entitlements === null;

  const chooseFree = () => {
    if (leaving) return;
    setLeaving(true);
    // The write result is deliberately ignored: a failed write costs the
    // customer one more gate next launch, which is better than blocking entry.
    writeFreeChoice();
    onDone();
  };

  return (
    <div className="gate-root relative flex h-full items-center justify-center overflow-y-auto px-6 py-10">
      {/* A single soft light source behind the card, for depth. Static, not an
          animation: the page should feel considered, not busy. */}
      <div className="gate-halo" aria-hidden />

      <div className="relative w-full max-w-[480px]">
        <header className="rise text-center">
          <div className="text-[color:var(--text-quiet)] text-[11.5px] font-medium tracking-[0.14em] uppercase">
            Setup Center
          </div>
          <h1
            data-testid="gate-heading"
            className="text-[color:var(--text-strong)] mt-3 text-[26px] leading-tight font-semibold tracking-[-0.025em]"
          >
            解锁 Setup Center PRO
          </h1>
          <p className="text-[color:var(--text-tertiary)] mx-auto mt-2.5 max-w-[400px] text-[13px] leading-relaxed">
            专业版提供自动下载、安装与配置。免费版可以检测环境、查看软件推荐并手动安装。
          </p>
        </header>

        <section className="rise rise-1 glass mt-7 rounded-[14px] p-6">
          {loading ? (
            <div
              data-testid="gate-loading"
              className="text-[color:var(--text-tertiary)] py-6 text-center text-[13px]"
            >
              正在读取本机授权…
            </div>
          ) : unreadable ? (
            // A failed read is *not* the same as "no licence". Saying so and
            // offering a retry prevents a paying customer being asked to buy
            // again because a file could not be read.
            <div data-testid="gate-unreadable" className="text-center">
              <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
                无法读取本机授权状态
              </div>
              <p className="text-[color:var(--text-tertiary)] mt-1.5 text-[12.5px] leading-relaxed">
                {error ?? "读取授权信息时出错，可能是文件权限或杀毒软件拦截。"}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" onClick={() => void loadEntitlements()}>
                  重试
                </Button>
                <Button variant="ghost" size="sm" onClick={chooseFree} disabled={leaving}>
                  仍然使用免费版
                </Button>
              </div>
            </div>
          ) : (
            <ActivationCard autoFocus onActivated={() => onDone()} />
          )}
        </section>

        {/* FREE is a real tier, so it gets a real card rather than a bare button
            floating between two dividers. The card structure also stops the
            page reading as four stacked fragments: PRO card, FREE card, help.
            It stays visually secondary — no accent, softer surface, ghost
            button — so the eye still lands on activation first. */}
        <section className="rise rise-2 glass-soft mt-5 rounded-[14px] p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[color:var(--text-primary)] text-[13.5px] font-medium">
                使用免费版
              </div>
              <p className="text-[color:var(--text-tertiary)] mt-1 text-[12.5px] leading-relaxed">
                可长期使用，不需要激活码。环境检测、软件推荐与手动安装全部可用，
                随时可以在「版本与授权」中升级。
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              data-testid="gate-free"
              disabled={leaving}
              onClick={chooseFree}
              className="mt-0.5 shrink-0"
            >
              使用 FREE 版
            </Button>
          </div>
        </section>

        {/* What activation buys, and how to buy it. Kept on the gate because a
            customer who does not yet have a code has exactly one question left,
            and sending them into the app to find the answer would be a worse
            first impression than answering it here. */}
        <section className="rise rise-3 mt-5">
          <div className="glass-soft rounded-[14px] p-5">
            <div className="text-[color:var(--text-primary)] text-[13px] font-medium">
              还没有激活码？
            </div>
            <p className="text-[color:var(--text-tertiary)] mt-1.5 text-[12.5px] leading-relaxed">
              PRO 包含自动下载、安装与环境配置，授权与本机硬件绑定，重装系统后仍然有效。
            </p>
            <div className="mt-3.5 border-t border-[color:var(--line-subtle)] pt-3.5">
              <ContactRows />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
