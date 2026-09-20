/**
 * Screen 3 — Choose a profile.
 *
 * The brief's "不要大量卡片" rule is the constraint that shapes this screen. Three
 * large cards in a row is the obvious design and the wrong one: it turns a
 * single decision into a comparison task.
 *
 * Instead this is a *list* — one row per profile, with the selected row opening
 * to reveal what it installs. Three benefits:
 *  - the default state is calm (three lines of text, no boxes)
 *  - details appear only where attention already is
 *  - adding a fourth profile later does not reflow the layout
 */

import { useEffect } from "react";
import clsx from "clsx";
import { Button, Hint, SectionLabel } from "../components/ui";
import { useApp } from "../lib/store";
import { describeSoftware } from "../lib/software";
import type { Profile, SoftwareDescriptor } from "../lib/types";

export function ChooseScreen() {
  const profiles = useApp((s) => s.profiles);
  const catalogue = useApp((s) => s.catalogue);
  const profilesLoading = useApp((s) => s.profilesLoading);
  const profilesError = useApp((s) => s.profilesError);
  const selectedProfileId = useApp((s) => s.selectedProfileId);
  const selectProfile = useApp((s) => s.selectProfile);
  const buildPlan = useApp((s) => s.buildPlan);
  const goTo = useApp((s) => s.goTo);
  const loadProfiles = useApp((s) => s.loadProfiles);
  const planLoading = useApp((s) => s.planLoading);

  useEffect(() => {
    if (profiles.length === 0 && !profilesLoading && !profilesError) {
      void loadProfiles();
    }
  }, [profiles.length, profilesLoading, profilesError, loadProfiles]);

  const next = async () => {
    await buildPlan();
    // Only advance when a plan was actually produced; otherwise the install
    // screen would render with nothing to show.
    if (useApp.getState().plan) goTo("install");
  };

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <header className="fade shrink-0">
        <h2 className="text-[color:var(--text-strong)] text-[21px] font-semibold tracking-[-0.02em]">
          选择你的使用场景
        </h2>
        <p className="text-[color:var(--text-quiet)] mt-1 text-[13px]">
          不确定选哪个就选第一个，之后随时可以再来装
        </p>
      </header>

      <div className="mt-7 -mr-1 flex-1 overflow-y-auto pr-1">
        {profilesLoading && <LoadingRows />}

        {profilesError && (
          <div className="glass-soft rounded-[12px] p-5">
            <div className="text-[color:var(--status-bad)] mb-1.5 text-[13px] font-medium">
              无法读取安装方案
            </div>
            <p className="text-[color:var(--text-secondary)] selectable text-[13px]">{profilesError}</p>
            <Button variant="ghost" className="mt-4" onClick={() => void loadProfiles()}>
              重试
            </Button>
          </div>
        )}

        {!profilesLoading && !profilesError && (
          <div className="stagger flex flex-col">
            {profiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                selected={profile.id === selectedProfileId}
                onSelect={() => selectProfile(profile.id)}
                catalogue={catalogue}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="fade mt-6 flex shrink-0 items-center justify-between border-t border-[color:var(--line-subtle)] pt-5">
        <Button variant="quiet" onClick={() => goTo("software")}>
          返回
        </Button>
        <Button
          disabled={!selectedProfileId || planLoading}
          onClick={() => void next()}
        >
          {planLoading ? "正在准备…" : "下一步"}
        </Button>
      </footer>
    </div>
  );
}

function ProfileRow({
  profile,
  selected,
  onSelect,
  catalogue,
}: {
  profile: Profile;
  selected: boolean;
  onSelect: () => void;
  catalogue: SoftwareDescriptor[];
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        "group relative w-full border-b border-[color:var(--line-subtle)] px-1 py-4 text-left",
        "transition-colors duration-150",
        "last:border-b-0",
      )}
    >
      {selected && (
        // The selection bar. A single accent rule reads as "this one" without
        // the visual weight of a filled card.
        <span className="bg-[color:var(--status-accent)] absolute top-3.5 bottom-3.5 -left-3 w-[2px] rounded-full" />
      )}

      <div className="flex items-start gap-4">
        {/* Radio mark: a real radio, because this is a single-choice list. */}
        <span
          className={clsx(
            "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
            selected
              ? "border-[color:var(--status-accent)] bg-[color:var(--status-accent)]"
              : "border-[color:var(--line-strong)] group-hover:border-[color:var(--text-quiet)]",
          )}
        >
          {selected && <span className="bg-[color:var(--surface-raised)] h-1.5 w-1.5 rounded-full" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <span
              className={clsx(
                "text-[15px] font-medium tracking-[-0.01em] transition-colors duration-150",
                selected ? "text-[color:var(--text-strong)]" : "text-[color:var(--text-primary)]",
              )}
            >
              {profile.name}
            </span>
            <span className="text-[color:var(--text-quiet)] text-[12.5px]">
              {profile.tagline}
            </span>
          </div>

          <div className="text-[color:var(--text-quiet)] mt-1 text-[12.5px]">{profile.audience}</div>

          {selected && (
            <div className="fade mt-3.5">
              <p className="text-[color:var(--text-tertiary)] text-[12.5px] leading-relaxed">
                {profile.rationale}
              </p>

              <div className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <SectionLabel>将安装</SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.software.map((id) => (
                      <span
                        key={id}
                        className="border-[color:var(--line-default)] bg-[color:var(--surface-inset)] text-[color:var(--text-primary)] rounded-[6px] border px-2 py-[3px] text-[12px]"
                      >
                        {describeSoftware(id, catalogue).name}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <SectionLabel>将配置</SectionLabel>
                  <div className="text-[color:var(--text-secondary)] flex flex-col gap-1 text-[12.5px]">
                    {profile.configure.map((item) => (
                      <span key={item}>{describeConfig(item)}</span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="text-[color:var(--text-quiet)] mt-3 flex items-center gap-4 text-[12px]">
                <span className="tnum">
                  约 {profile.estimatedMinutes} 分钟
                </span>
                <span className="tnum">
                  约 {formatMb(profile.estimatedDownloadMb)} 下载
                </span>
                <span>{profile.requiresAdmin ? "需要管理员权限" : "免管理员权限"}</span>
              </div>

              {profile.future.mcp.length > 0 && (
                <Hint>
                  后续版本还将支持 MCP 服务器（
                  {profile.future.mcp.join("、")}），V0.1 暂不安装。
                </Hint>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function describeConfig(key: string): string {
  const map: Record<string, string> = {
    vscode: "VS Code 界面切换为简体中文",
    claude: "Claude 中文偏好设置",
    codex: "Codex 中文回复偏好",
    "git.baseline": "Git 基础配置（默认分支 main）",
  };
  return map[key] ?? key;
}

function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

function LoadingRows() {
  return (
    <div className="flex flex-col">
      {[0, 1, 2].map((i) => (
        <div key={i} className="border-b border-[color:var(--line-subtle)] px-1 py-5 last:border-b-0">
          <div className="flex items-start gap-4">
            <div className="bg-[color:var(--surface-inset)] mt-[3px] h-4 w-4 rounded-full" />
            <div className="flex-1">
              <div className="bg-[color:var(--surface-inset)] h-3.5 w-28 rounded" />
              <div className="bg-[color:var(--surface-inset)] mt-2.5 h-3 w-52 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
