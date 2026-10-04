import type { UIPart, UIPartLifecycle } from "../../core/uiparts/types";

interface UIPartCardProps {
  part: UIPart;
  onClick: () => void;
}

const LIFECYCLE_BADGE_STYLE: Record<
  UIPartLifecycle,
  { label: string; bg: string; text: string; border: string }
> = {
  raw: {
    label: "RAW",
    bg: "bg-slate-800/80",
    text: "text-slate-300",
    border: "border-slate-700",
  },
  enriched: {
    label: "ENRICHED",
    bg: "bg-sky-950/60",
    text: "text-sky-300",
    border: "border-sky-800/60",
  },
  prototyped: {
    label: "PROTOTYPED",
    bg: "bg-amber-950/60",
    text: "text-amber-300",
    border: "border-amber-800/60",
  },
  validated: {
    label: "VALIDATED",
    bg: "bg-emerald-950/60",
    text: "text-emerald-300",
    border: "border-emerald-800/60",
  },
};

export function UIPartCard({ part, onClick }: UIPartCardProps) {
  const lifecycleBadge = LIFECYCLE_BADGE_STYLE[part.lifecycle] || LIFECYCLE_BADGE_STYLE.raw;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="group relative flex flex-col rounded-xl border border-white/10 bg-[#0d1117] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:shadow-xl hover:shadow-black/40 cursor-pointer overflow-hidden text-left focus:outline-none focus:ring-2 focus:ring-sky-500/50"
    >
      {/* Thumbnail Aspect Box */}
      <div className="relative aspect-[16/10] w-full bg-[#07090e] border-b border-white/5 overflow-hidden flex items-center justify-center p-2">
        {part.preview?.thumbnail ? (
          <img
            src={part.preview.thumbnail}
            alt={part.title}
            className="h-full w-full object-contain rounded transition duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-600 gap-1">
            <svg
              className="w-8 h-8 opacity-40"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
              <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.5" />
              <path d="M21 15l-5-5L5 21" strokeWidth="1.5" />
            </svg>
            <span className="text-[11px] font-mono">No Preview</span>
          </div>
        )}

        {/* Top Badges Overlay */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider border shadow-sm ${lifecycleBadge.bg} ${lifecycleBadge.text} ${lifecycleBadge.border}`}
          >
            {lifecycleBadge.label}
          </span>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-black/60 backdrop-blur-md text-slate-300 border border-white/10">
            {part.kind}
          </span>
        </div>
      </div>

      {/* Card Content Body */}
      <div className="flex flex-col flex-1 p-3.5 gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 group-hover:text-white transition line-clamp-1">
            {part.title}
          </h3>
          {part.summary ? (
            <p className="mt-1 text-xs text-slate-400 line-clamp-2 leading-relaxed">
              {part.summary}
            </p>
          ) : part.notes ? (
            <p className="mt-1 text-xs text-slate-500 line-clamp-2 leading-relaxed">
              {part.notes}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-600 italic">尚未填写说明 (RAW)</p>
          )}
        </div>

        {/* Footer Meta & Tags */}
        <div className="mt-auto pt-2 flex items-center justify-between border-t border-white/5 text-[11px]">
          <div className="flex items-center gap-1.5 flex-wrap overflow-hidden">
            {part.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded bg-white/5 text-slate-400 text-[10px] font-mono border border-white/5"
              >
                #{tag}
              </span>
            ))}
            {part.tags.length > 3 && (
              <span className="text-slate-600 text-[10px] font-mono">
                +{part.tags.length - 3}
              </span>
            )}
          </div>

          {part.sources && part.sources.length > 0 && (
            <span
              className="text-[10px] text-slate-500 font-mono truncate max-w-[100px]"
              title={part.sources[0]?.title}
            >
              {part.sources[0]?.type}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
