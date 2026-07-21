import { memo, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Tailwind's static scanner needs literal class names, not `bg-${color}-50` string interpolation
// -- this is the one place the amber (at-risk) / rose (conflicts) palettes are defined, instead
// of each badge hand-rolling its own copy of the same "count > 0 -> popover, else -> static pill"
// structure with a different color swapped in.
const VARIANTS = {
  amber: {
    trigger: "text-amber-700 bg-gradient-to-br from-amber-50 to-amber-100 hover:from-amber-100 hover:to-amber-200 border-amber-200/50",
    countBubble: "bg-amber-500",
    pulse: "",
  },
  rose: {
    trigger: "text-rose-700 bg-gradient-to-br from-rose-50 to-rose-100 hover:from-rose-100 hover:to-rose-200 border-rose-200/50",
    countBubble: "bg-rose-500",
    pulse: "animate-pulse",
  },
} as const;

/**
 * A header status pill: shows a static green "all clear" badge when `count` is 0, or a colored
 * badge that opens a popover with the details when it's not. Used by both the At Risk and
 * Conflicts indicators, which previously duplicated this exact structure end to end with only
 * the color and popover content differing.
 */
function StatusBadgeImpl({
  count,
  variant,
  label,
  zeroLabel,
  popoverWidthClass = "w-80",
  popoverAlign = "end",
  children,
}: {
  count: number;
  variant: keyof typeof VARIANTS;
  label: string;
  zeroLabel: string;
  popoverWidthClass?: string;
  popoverAlign?: "start" | "center" | "end";
  children: ReactNode;
}) {
  if (count === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 shadow-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
        {zeroLabel}
      </div>
    );
  }

  const v = VARIANTS[variant];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`${label}: ${count}. Open details.`}
          className={cn(
            "group flex items-center gap-1.5 text-[11px] font-bold tracking-wide px-3 py-1.5 rounded-full shadow-sm border transition-all hover:shadow-md",
            v.trigger,
            v.pulse,
          )}
        >
          <span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-white shadow-inner", v.countBubble)}>
            <span className="text-[10px] font-black">{count}</span>
          </span>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn(popoverWidthClass, "p-0")} align={popoverAlign} sideOffset={8}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export const StatusBadge = memo(StatusBadgeImpl);
