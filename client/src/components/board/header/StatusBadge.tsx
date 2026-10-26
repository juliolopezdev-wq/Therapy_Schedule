import { memo, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Tailwind's static scanner needs literal class names, not `bg-${color}-50` string interpolation
// -- this is the one place the amber (at-risk) / rose (conflicts) palettes are defined, instead
// of each badge hand-rolling its own copy of the same "count > 0 -> popover, else -> static pill"
// structure with a different color swapped in.
const VARIANTS = {
  amber: {
    trigger: "text-amber-900 bg-amber-100 hover:bg-amber-200 border-amber-300",
    countBubble: "bg-amber-500",
    pulse: "",
  },
  rose: {
    trigger: "text-rose-900 bg-rose-100 hover:bg-rose-200 border-rose-300",
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
  onClick,
  children,
}: {
  count: number;
  variant: keyof typeof VARIANTS;
  label: string;
  zeroLabel: string;
  popoverWidthClass?: string;
  popoverAlign?: "start" | "center" | "end";
  onClick?: () => void;
  children?: ReactNode;
}) {
  if (count === 0) {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold tracking-wide text-emerald-800">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
        {zeroLabel}
      </div>
    );
  }

  const v = VARIANTS[variant];
  const trigger = (
    <button
      aria-label={`${label}: ${count}. Open details.`}
      onClick={onClick}
      className={cn(
        "group flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-xs font-bold tracking-wide transition-colors",
        v.trigger,
        v.pulse,
      )}
    >
      <span
        className={cn(
          "inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-black leading-none tabular-nums text-white shadow-inner",
          v.countBubble,
        )}
      >
        <span>{count}</span>
      </span>
      {label}
    </button>
  );

  if (onClick) return trigger;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className={cn(popoverWidthClass, "p-0")} align={popoverAlign} sideOffset={8}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export const StatusBadge = memo(StatusBadgeImpl);
