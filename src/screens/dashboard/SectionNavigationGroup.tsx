/**
 * Grouped Navigation & Dual-Profile Deferral Component (Issue K03).
 *
 * ## Primary Task Distinction (Issue K03)
 *
 * Clearly separates "Setup Computer" (machine environment bootstrap)
 * from "Creative Workbench" (templates, UI parts, styles, and resources).
 *
 * ## Dual-Profile Feature Deferral
 *
 * Explicitly displays deferral notice for multiple workspace profiles
 * (DEFERRED_BY_SPEC).
 */

import React from "react";
import clsx from "clsx";
import type { Section } from "../../lib/store";

export interface NavigationItem {
  id: Section;
  label: string;
  badge?: string | number;
  description?: string;
}

export interface SectionNavigationGroupProps {
  activeSection: Section;
  onSelectSection: (section: Section) => void;
  className?: string;
}

export function SectionNavigationGroup({
  activeSection,
  onSelectSection,
  className,
}: SectionNavigationGroupProps) {
  const setupComputerItems: NavigationItem[] = [
    { id: "overview", label: "环境概览", description: "事实检测与健康就绪" },
    { id: "software", label: "软件清点", description: "自选安装与可用凭证" },
    { id: "config", label: "开发配置", description: "PATH、Git 与开发环境" },
    { id: "history", label: "安装履历", description: "步骤记录与断点可恢复" },
  ];

  const creativeWorkbenchItems: NavigationItem[] = [
    { id: "goals", label: "目标向导", description: "按技术路线定制开发环境" },
    { id: "repos", label: "GitHub 项目", description: "开源优质仓库、对比与克隆" },
    { id: "resources", label: "精选资源", description: "开源工具与设计资产" },
    { id: "uiparts", label: "UI 零部件", description: "可复用交互代码零件" },
    { id: "library", label: "我的库", description: "个人收藏、最近与自定义包" },
    { id: "style", label: "视觉系统", description: "设计令牌与体验版式" },
  ];

  return (
    <nav
      data-testid="section-navigation-group"
      className={clsx("flex flex-col gap-5 text-sm", className)}
      aria-label="主要导航分区"
    >
      {/* Group 1: 基础环境配置 (Setup Computer) */}
      <div>
        <div className="px-3 mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-text-muted">
          <span>基础环境配置</span>
          <span className="text-[10px] font-mono opacity-70">Setup Computer</span>
        </div>
        <div className="flex flex-col gap-1">
          {setupComputerItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={clsx(
                  "flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors",
                  isActive
                    ? "bg-accent/15 text-accent font-medium shadow-sm"
                    : "text-text-primary hover:bg-surface-raised"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <span>{item.label}</span>
                {item.badge && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-surface border border-line text-text-muted">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Group 2: 创作与工程资产 (Creative Workbench) */}
      <div>
        <div className="px-3 mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-text-muted">
          <span>创作与工程资产</span>
          <span className="text-[10px] font-mono opacity-70">Workbench</span>
        </div>
        <div className="flex flex-col gap-1">
          {creativeWorkbenchItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={clsx(
                  "flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors",
                  isActive
                    ? "bg-accent/15 text-accent font-medium shadow-sm"
                    : "text-text-primary hover:bg-surface-raised"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <span>{item.label}</span>
                {item.badge && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-surface border border-line text-text-muted">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dual-Profile Deferral Notice (Issue K03) */}
      <div className="mt-auto pt-3 px-3 border-t border-line/40 text-[11px] text-text-muted/80 leading-relaxed">
        <span className="font-semibold text-text-muted">双 Profile 隔离：</span>
        <span>当前按规范明确延期 (DEFERRED_BY_SPEC)，由单文档个人状态统一纳管。</span>
      </div>
    </nav>
  );
}
