/**
 * ExperiencePlayground — the Token Inspector.
 *
 * ## What replaced what, and why
 *
 * The old `TokenTweaker` wrote four variables to `<html>` on every keystroke:
 * `--radius-panel`, `--radius-control`, `--border-width-custom`,
 * `--status-accent` and `--surface-opacity-custom`. Three of those five were
 * read by nothing, one was read but always lost to a stylesheet `!important`,
 * and the shadow control was never written at all. So the panel could look like
 * it was working — the chips highlighted, the value persisted — while the UI
 * stayed identical. It also held its state in `useState`, which meant switching
 * style kept the *previous* style's values in memory and then wrote them into
 * the new style's storage slot.
 *
 * Three structural changes fix that class of bug rather than the instance:
 *
 * 1. **Overrides live in the store, keyed by experience id.** Switching
 *    experience reloads the incoming experience's own overrides in the same
 *    state update, so the stale-value window does not exist.
 * 2. **The runtime owns the variable table.** `applyExperience` writes it with
 *    inline `!important`, which outranks every per-style `!important` rule. The
 *    playground never writes CSS itself.
 * 3. **The specimen is painted from the same table.** Radius/shadow/accent
 *    changes are visible *here* first; the app only changes when the user says
 *    so. That is what makes tuning safe — previously the only way to see a
 *    change was to mutate the entire app and hope.
 *
 * ## Editing model: draft vs committed
 *
 * The controls edit a **draft**. "应用到应用" commits the draft to the store,
 * which is what paints the app. "重置" discards the draft *and* deletes the
 * stored override, so the experience's manifest values become live again —
 * rather than writing today's resolved numbers back down as if the user had
 * chosen them, which would make a later Vault update to the preset invisible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Button } from "./ui";
import { ExperienceSpecimen } from "./ExperienceSpecimen";
import { useApp } from "../lib/store";
import { STYLE_REGISTRY, getStyle } from "../styles/registry";
import {
  DENSITY_LABEL,
  MOTION_LABEL,
  TIER_LABEL,
  buildExport,
  clearOverrides,
  deriveCustomExperience,
  hasOverrides,
  loadCustomExperiences,
  lockReason,
  parseImport,
  resolveExperienceProfile,
  resolveTokens,
  saveCustomExperience,
  tweakableKeys,
} from "../styles/runtime";
import type { TokenKey, TokenOverrides } from "../styles/types";
import { TransferHistory } from "../core/transfer";

const RADIUS_PRESETS = ["0px", "2px", "4px", "8px", "12px", "16px", "24px"];
const BORDER_PRESETS = ["1px", "1.5px", "2px", "3px", "4px"];
const ACCENT_SWATCHES = ["#ff2d55", "#64ffda", "#38bdf8", "#f59e0b", "#a855f7", "#84cc16"];
const SHADOW_PRESETS: { id: string; label: string; value: TokenOverrides["shadow"] }[] = [
  { id: "none", label: "无", value: { offsetX: "0px", offsetY: "0px", blur: "0px", spread: "0px", color: "transparent" } },
  { id: "soft", label: "柔和", value: { offsetX: "0px", offsetY: "18px", blur: "48px", spread: "-18px", color: "rgba(0,0,0,0.75)" } },
  { id: "hard", label: "硬偏移", value: { offsetX: "6px", offsetY: "6px", blur: "0px", spread: "0px", color: "#000000" } },
];

interface SectionDef {
  key: TokenKey[];
  title: string;
  hint: string;
}

const SECTIONS: SectionDef[] = [
  { key: ["panelRadius", "controlRadius", "borderWidth"], title: "Geometry", hint: "面板圆角 / 控件圆角 / 描边宽度" },
  { key: ["shadow"], title: "Shadow", hint: "硬阴影偏移与强度" },
  { key: ["accent", "accentSecondary", "surface"], title: "Color", hint: "主强调色 / 次强调色 / 表面色" },
  { key: ["density"], title: "Density", hint: "信息密度" },
  { key: ["headingScale", "bodyScale"], title: "Typography", hint: "字号层级" },
  { key: ["motion"], title: "Motion", hint: "动效语言" },
];

function Chip({
  active,
  onClick,
  children,
  disabled,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "rounded-[6px] border px-2 py-[3px] font-mono text-[10.5px] transition-colors",
        disabled && "cursor-not-allowed opacity-30",
        !disabled && !active && "border-[color:var(--line-subtle)] text-[color:var(--text-tertiary)] hover:border-[color:var(--line-strong)] hover:text-[color:var(--text-primary)]",
        active && "border-[color:var(--status-accent)] text-[color:var(--text-inverse)]",
      )}
      style={active ? { background: "var(--status-accent)" } : undefined}
    >
      {children}
    </button>
  );
}

function Row({
  label,
  locked,
  reason,
  children,
}: {
  label: string;
  locked?: boolean;
  reason?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-[5px]">
      <span className="flex items-center gap-1.5 text-[11.5px] text-[color:var(--text-secondary)]">
        {label}
        {locked && (
          <span
            title={reason ?? undefined}
            className="rounded-[4px] border border-[color:var(--line-subtle)] px-1 font-mono text-[9px] text-[color:var(--text-quiet)]"
          >
            锁定
          </span>
        )}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-1.5">{children}</div>
    </div>
  );
}

export function ExperiencePlayground({ styleId }: { styleId?: string }) {
  const activeStyle = useApp((s) => s.activeStyle);
  const committed = useApp((s) => s.styleOverrides);
  const setStyleOverrides = useApp((s) => s.setStyleOverrides);
  const resetStyleOverrides = useApp((s) => s.resetStyleOverrides);
  const refreshCustomExperiences = useApp((s) => s.refreshCustomExperiences);

  const targetId = styleId ?? activeStyle;
  const style = getStyle(targetId) ?? STYLE_REGISTRY[0];
  const profile = useMemo(() => resolveExperienceProfile(style), [style]);
  const tweakable = useMemo(() => tweakableKeys(style), [style]);

  const [draft, setDraft] = useState<TokenOverrides>({});
  const [message, setMessage] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const messageTimer = useRef<number | null>(null);

  const flash = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current !== null) window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(null), 2600);
  }, []);

  // The draft resets whenever the *target* experience changes, and adopts that
  // experience's committed overrides. Keyed on the id (not the style object) so
  // a Vault refresh that rebuilds the manifest does not throw away a draft the
  // user is mid-way through.
  const previousId = useRef(targetId);
  useEffect(() => {
    if (previousId.current !== targetId) {
      previousId.current = targetId;
      setDraft(committed);
    }
  }, [targetId, committed]);

  // First mount, and any external commit (Apply from elsewhere, Reset), sync in.
  useEffect(() => {
    setDraft((d) => (Object.keys(d).length === 0 ? committed : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftTokens = useMemo(() => resolveTokens(style, draft), [style, draft]);
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(committed),
    [draft, committed],
  );

  const patch = (next: TokenOverrides) => setDraft((d) => ({ ...d, ...next }));

  const locked = (key: TokenKey) => lockReason(style, key);
  const can = (key: TokenKey) => tweakable.includes(key);

  const handleApply = () => {
    setStyleOverrides(draft);
    flash(`已应用到应用 · ${style.name}`);
    TransferHistory.record({
      type: "style-switch",
      title: "应用体验令牌",
      targetId: style.id,
      targetName: style.name,
      status: "success",
      summary: `已应用适配令牌：${Object.keys(draft).join(", ") || "无覆盖"}`,
    });
  };

  const handleReset = () => {
    // Discards the draft *and* forgets the stored override, so the manifest's own
    // values resolve again. Deleting rather than re-writing the current numbers
    // is the point: a later preset update must still reach this user.
    setDraft({});
    if (targetId === activeStyle) resetStyleOverrides();
    else clearOverrides(targetId);
    flash(`已恢复「${style.name}」的原始令牌`);
  };

  const handleSaveAsCustom = () => {
    if (Object.keys(draft).length === 0) {
      flash("没有覆盖内容可保存；请先调整令牌");
      return;
    }
    const entry = deriveCustomExperience(style, draft);
    saveCustomExperience(entry);
    refreshCustomExperiences();
    flash(`已创建派生体验「${entry.name}」`);
    TransferHistory.record({
      type: "style-switch",
      title: "派生体验",
      targetId: entry.id,
      targetName: entry.name,
      status: "success",
      summary: `基于「${style.name}」，仅保存令牌差值`,
    });
  };

  const handleExport = async () => {
    const payload = buildExport(style, draft);
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      flash("令牌 JSON 已复制到剪贴板");
    } catch {
      setImportText(text);
      setImportOpen(true);
      flash("剪贴板不可用，已放入下方文本框供手动复制");
      return;
    }
    TransferHistory.record({
      type: "sync",
      title: "导出设计令牌",
      targetId: style.id,
      targetName: `${style.name} 令牌`,
      status: "info",
      summary: "已复制 v2 令牌 JSON（可导入到其他客户端）",
    });
  };

  const handleImport = () => {
    const result = parseImport(importText);
    if (!result.ok) {
      // Refuses rather than guesses. A v1 blob stored a bare `shadowDepth`
      // against manifests whose shadow was a full box-shadow; mapping that
      // silently onto the new shadow model would reproduce exactly the bug this
      // round exists to remove.
      flash(result.error);
      return;
    }
    setDraft(result.overrides);
    setImportOpen(false);
    setImportText("");
    flash("已载入令牌覆盖，点击「应用到应用」生效");
  };

  const overridden = useMemo(() => hasOverrides(targetId), [targetId, draft]);
  const customCount = useMemo(() => loadCustomExperiences().length, [draft]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Specimen ------------------------------------------------------------ */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10.5px] tracking-[0.14em] text-[color:var(--text-quiet)]">
            SPECIMEN
          </span>
          <span className="text-[12px] text-[color:var(--text-secondary)]">{style.name}</span>
          <span className="rounded-[5px] border border-[color:var(--line-subtle)] px-1.5 py-[1px] font-mono text-[10px] text-[color:var(--text-tertiary)]">
            {TIER_LABEL[profile.tier] ?? profile.tier}
          </span>
          {overridden && (
            <span className="rounded-[5px] border border-[color:var(--status-accent)] px-1.5 py-[1px] font-mono text-[10px] text-[color:var(--status-accent)]">
              已修改
            </span>
          )}
          {dirty && (
            <span className="font-mono text-[10px] text-[color:var(--status-warn)]">草稿未应用</span>
          )}
        </div>

        <ExperienceSpecimen
          style={style}
          overrides={draft}
          className="h-[320px] w-full rounded-[var(--radius-panel)] border border-[color:var(--line-default)]"
        />

        <p className="text-[11.5px] leading-relaxed text-[color:var(--text-quiet)]">
          左侧是用当前草稿令牌实时渲染的体验样张，右侧调整只影响样张。确认后点「应用到应用」才会
          改动整个界面，避免调参时全局界面剧烈抖动。
        </p>
      </div>

      {/* Controls ------------------------------------------------------------ */}
      <div className="space-y-3">
        <div className="rounded-[var(--radius-panel)] border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] p-3">
          {SECTIONS.map((section) => (
            <div key={section.title} className="border-b border-[color:var(--line-subtle)] py-2 last:border-b-0">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="font-mono text-[10.5px] tracking-[0.12em] text-[color:var(--text-strong)]">
                  {section.title.toUpperCase()}
                </span>
                <span className="text-[10px] text-[color:var(--text-quiet)]">{section.hint}</span>
              </div>

              {section.title === "Geometry" && (
                <>
                  <Row label="面板圆角" locked={!can("panelRadius")} reason={locked("panelRadius")}>
                    {RADIUS_PRESETS.map((r) => (
                      <Chip
                        key={r}
                        disabled={!can("panelRadius")}
                        active={draftTokens.panelRadius === r && draft.panelRadius !== undefined}
                        onClick={() => patch({ panelRadius: r })}
                      >
                        {r}
                      </Chip>
                    ))}
                  </Row>
                  <Row label="控件圆角" locked={!can("controlRadius")} reason={locked("controlRadius")}>
                    {RADIUS_PRESETS.map((r) => (
                      <Chip
                        key={r}
                        disabled={!can("controlRadius")}
                        active={draftTokens.controlRadius === r && draft.controlRadius !== undefined}
                        onClick={() => patch({ controlRadius: r })}
                      >
                        {r}
                      </Chip>
                    ))}
                  </Row>
                  <Row label="描边宽度" locked={!can("borderWidth")} reason={locked("borderWidth")}>
                    {BORDER_PRESETS.map((w) => (
                      <Chip
                        key={w}
                        disabled={!can("borderWidth")}
                        active={draftTokens.borderWidth === w && draft.borderWidth !== undefined}
                        onClick={() => patch({ borderWidth: w })}
                      >
                        {w}
                      </Chip>
                    ))}
                  </Row>
                </>
              )}

              {section.title === "Shadow" && (
                <>
                  <Row label="阴影预设" locked={!can("shadow")} reason={locked("shadow")}>
                    {SHADOW_PRESETS.map((p) => (
                      <Chip
                        key={p.id}
                        disabled={!can("shadow")}
                        active={draft.shadow !== undefined && draftTokens.shadow.offsetY === p.value!.offsetY && draftTokens.shadow.blur === p.value!.blur}
                        onClick={() => patch({ shadow: p.value })}
                      >
                        {p.label}
                      </Chip>
                    ))}
                  </Row>
                  <Row label="硬阴影偏移" locked={!can("shadow")} reason={locked("shadow")}>
                    {["0px", "2px", "4px", "6px", "8px"].map((d) => (
                      <Chip
                        key={d}
                        disabled={!can("shadow")}
                        active={draft.shadow?.offsetX === d && draft.shadow?.offsetY === d}
                        onClick={() =>
                          patch({
                            shadow: {
                              offsetX: d,
                              offsetY: d,
                              blur: "0px",
                              spread: "0px",
                              color: draftTokens.shadow.color === "transparent" ? "#000000" : draftTokens.shadow.color,
                            },
                          })
                        }
                      >
                        {d}
                      </Chip>
                    ))}
                  </Row>
                </>
              )}

              {section.title === "Color" && (
                <>
                  <Row label="主强调色" locked={!can("accent")} reason={locked("accent")}>
                    <input
                      type="color"
                      disabled={!can("accent")}
                      value={draftTokens.accent}
                      onChange={(e) => patch({ accent: e.target.value })}
                      className="h-6 w-8 cursor-pointer rounded-[5px] border border-[color:var(--line-subtle)] bg-transparent"
                    />
                    {ACCENT_SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={!can("accent")}
                        onClick={() => patch({ accent: c })}
                        title={c}
                        className={clsx(
                          "h-5 w-5 rounded-[4px] border",
                          draftTokens.accent === c ? "border-[color:var(--text-strong)]" : "border-[color:var(--line-subtle)]",
                          !can("accent") && "cursor-not-allowed opacity-30",
                        )}
                        style={{ background: c }}
                      />
                    ))}
                  </Row>
                  <Row label="次强调色" locked={!can("accentSecondary")} reason={locked("accentSecondary")}>
                    <input
                      type="color"
                      disabled={!can("accentSecondary")}
                      value={draftTokens.accentSecondary}
                      onChange={(e) => patch({ accentSecondary: e.target.value })}
                      className="h-6 w-8 cursor-pointer rounded-[5px] border border-[color:var(--line-subtle)] bg-transparent"
                    />
                    <span className="font-mono text-[10px] text-[color:var(--text-quiet)]">
                      {draftTokens.accentSecondary}
                    </span>
                  </Row>
                  <Row label="表面色" locked={!can("surface")} reason={locked("surface")}>
                    <input
                      type="color"
                      disabled={!can("surface")}
                      value={draftTokens.surface}
                      onChange={(e) => patch({ surface: e.target.value })}
                      className="h-6 w-8 cursor-pointer rounded-[5px] border border-[color:var(--line-subtle)] bg-transparent"
                    />
                    <span className="font-mono text-[10px] text-[color:var(--text-quiet)]">
                      {draftTokens.surface}
                    </span>
                  </Row>
                </>
              )}

              {section.title === "Density" && (
                <Row label="信息密度" locked={!can("density")} reason={locked("density")}>
                  {(["compact", "normal", "spacious"] as const).map((d) => (
                    <Chip
                      key={d}
                      disabled={!can("density")}
                      active={draftTokens.density === d && draft.density !== undefined}
                      onClick={() => patch({ density: d })}
                    >
                      {DENSITY_LABEL[d]}
                    </Chip>
                  ))}
                </Row>
              )}

              {section.title === "Typography" && (
                <>
                  <Row label="标题字号" locked={!can("headingScale")} reason={locked("headingScale")}>
                    {[0.9, 1, 1.1, 1.2].map((s) => (
                      <Chip
                        key={s}
                        disabled={!can("headingScale")}
                        active={draft.headingScale === s}
                        onClick={() => patch({ headingScale: s })}
                      >
                        {s}×
                      </Chip>
                    ))}
                  </Row>
                  <Row label="正文字号" locked={!can("bodyScale")} reason={locked("bodyScale")}>
                    {[0.9, 1, 1.1].map((s) => (
                      <Chip
                        key={s}
                        disabled={!can("bodyScale")}
                        active={draft.bodyScale === s}
                        onClick={() => patch({ bodyScale: s })}
                      >
                        {s}×
                      </Chip>
                    ))}
                  </Row>
                </>
              )}

              {section.title === "Motion" && (
                <Row label="动效语言" locked={!can("motion")} reason={locked("motion")}>
                  {(["reduced", "normal", "expressive"] as const).map((m) => (
                    <Chip
                      key={m}
                      disabled={!can("motion")}
                      active={draftTokens.motion === m && draft.motion !== undefined}
                      onClick={() => patch({ motion: m })}
                    >
                      {MOTION_LABEL[m]}
                    </Chip>
                  ))}
                </Row>
              )}
            </div>
          ))}

          {tweakable.length < SECTIONS.flatMap((s) => s.key).length && (
            <p className=" pt-2 text-[10.5px] leading-relaxed text-[color:var(--text-quiet)]">
              未开放的令牌由该体验锁定：改动它会破坏其核心识别度，因此不提供无效按钮。
              {profile.locked &&
                Object.entries(profile.locked).map(([k, v]) => (
                  <span key={k} className="mt-1 block">
                    · <span className="font-mono">{k}</span> — {v}
                  </span>
                ))}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleApply} disabled={!dirty}>
            应用到应用
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset}>
            重置
          </Button>
          <Button size="sm" variant="ghost" onClick={handleSaveAsCustom}>
            保存为自定义
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void handleExport()}>
            导出
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setImportOpen((v) => !v)}>
            导入
          </Button>
        </div>

        {customCount > 0 && (
          <p className="text-[11px] text-[color:var(--text-quiet)]">
            已保存 {customCount} 个派生体验，出现在风格画廊中，可像预设一样应用与删除。
          </p>
        )}

        {importOpen && (
          <div className="space-y-2 rounded-[var(--radius-panel)] border border-[color:var(--line-default)] bg-[color:var(--surface-raised)] p-3">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="粘贴导出的令牌 JSON…"
              rows={5}
              className="w-full resize-y rounded-[var(--radius-control)] border border-[color:var(--line-default)] bg-[color:var(--surface-inset)] p-2 font-mono text-[11px] text-[color:var(--text-primary)]"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleImport} disabled={!importText.trim()}>
                载入覆盖
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(importText).catch(() => undefined)} disabled={!importText.trim()}>
                复制
              </Button>
            </div>
          </div>
        )}

        {message && (
          <p className="rounded-[var(--radius-control)] border border-[color:var(--status-accent)] px-2.5 py-1.5 text-[11.5px] text-[color:var(--status-accent)]">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The collapsed disclosure the Style page mounts.
 *
 * Kept as a thin wrapper rather than folding the playground into the page: the
 * playground is also the specimen surface for a *non-active* experience, which
 * the gallery's detail view uses for Preview-before-Apply.
 */
export function TokenTweaker({ activeStyleId }: { activeStyleId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius-panel)] border border-[color:var(--line-default)] bg-[color:var(--surface-inset)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[10.5px] tracking-[0.14em] text-[color:var(--text-quiet)]">
            EXPERIENCE PLAYGROUND
          </span>
          <span className="text-[13px] text-[color:var(--text-primary)]">体验调校台</span>
        </span>
        <span className="font-mono text-[11px] text-[color:var(--text-tertiary)]">
          {open ? "收起 −" : "展开 +"}
        </span>
      </button>
      {open && (
        <div className="border-t border-[color:var(--line-subtle)] p-3.5">
          <ExperiencePlayground styleId={activeStyleId} />
        </div>
      )}
    </div>
  );
}
