/**
 * CategoryTabs — the filter strip over the software grid.
 *
 * ## What problem this solves
 *
 * The catalog ships ~24 programs across four categories. Listing them all is
 * correct but unusable: a student looking for "the AI ones" was scrolling past
 * Git, CMake, MSVC Build Tools and Java to find them. That is the audit's third
 * finding, and this is its whole fix.
 *
 * ## Why the categories come from the data
 *
 * The tabs are built from the *rendered* items' own `category` / `categoryName`,
 * not from a hard-coded list in this file. Two reasons, and the second is the
 * load-bearing one:
 *
 * 1. `DESIGN.md` forbids a second source of truth about what the catalog holds.
 * 2. "全部" must never be the only tab that is ever non-empty, and a hard-coded
 *    list silently produces exactly that the moment a category is renamed in
 *    Rust — the tab would render and select an empty group with no error.
 *
 * The count on each tab is the number of items that tab will actually show, so
 * a student can see that a category is empty without clicking it.
 *
 * ## Why not dropdowns or chips
 *
 * There are four categories plus 全部. A segmented row shows every option and
 * its size at once, which is the property that makes a filter *safe* to use:
 * the student can see where the content went rather than wondering whether it
 * vanished. `role="tablist"` and `aria-pressed` are set so this is navigable
 * by keyboard and announced correctly.
 */

import clsx from "clsx";

/** One tab: the catalog key, the name to show, and how many rows it holds. */
export interface CategoryTab {
  /** `""` is the "全部" tab; every other value is a catalog category key. */
  key: string;
  label: string;
  count: number;
}

export function CategoryTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: CategoryTab[];
  active: string;
  onSelect: (key: string) => void;
}) {
  // A single category is not a choice, it is noise. (This can legitimately
  // happen on a machine whose inventory resolved only one category's programs,
  // and rendering one tab labelled "开发工具 9" would read as broken.)
  if (tabs.length <= 1) return null;

  return (
    <div
      role="tablist"
      aria-label="按分类筛选"
      className="flex flex-wrap items-center gap-1"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key || "all"}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.key)}
            className={clsx(
              "flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5",
              "text-[12.5px] transition-colors duration-150",
              isActive
                ? "bg-[color:var(--surface-active)] text-[color:var(--text-strong)]"
                : "text-[color:var(--text-tertiary)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text-primary)]",
            )}
          >
            {tab.label}
            <span
              className={clsx(
                "tnum text-[11px]",
                isActive
                  ? "text-[color:var(--text-tertiary)]"
                  : "text-[color:var(--text-quiet)]",
              )}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
