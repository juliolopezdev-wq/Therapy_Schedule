import { memo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption<T extends string | number> {
  value: T;
  label: string;
  /** Dot/accent color for this option (omit for a neutral gray dot, used by "All"). */
  color?: string;
  /** Background tint applied to the button when this option is active (defaults to blue-700 fill). */
  activeBg?: string;
  /** Text color applied to the button/dot label when this option is active. */
  activeFg?: string;
}

/**
 * One labeled filter (Discipline, Team, ...): always rendered as a compact dropdown.
 */
function FilterGroupImpl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  allLabel = "All",
  dropdownWidthClass = "w-40",
  onOpenChange,
}: {
  label: string;
  options: FilterOption<T>[];
  value: T | "all";
  onChange: (value: T | "all") => void;
  allLabel?: string;
  dropdownWidthClass?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const activeOption = value === "all" ? null : options.find((o) => o.value === value);
  const [compactOpen, setCompactOpen] = useState(false);

  const handleOpenChange = (open: boolean) => {
    setCompactOpen(open);
    onOpenChange?.(open);
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</span>

      <DropdownMenu open={compactOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Filter by ${label.toLowerCase()}: ${activeOption?.label ?? allLabel}`}
            aria-haspopup="menu"
            aria-expanded={compactOpen}
            className={cn(
              "flex items-center gap-2 h-8 rounded-full px-3 text-xs font-semibold bg-white border border-slate-200 shadow-sm",
              "transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1",
            )}
          >
            <span
              className={cn("flex items-center gap-2", activeOption ? undefined : "text-slate-600")}
              style={activeOption ? { color: activeOption.activeFg } : undefined}
            >
              <span
                className="w-2 h-2 rounded-full shadow-sm"
                style={{ backgroundColor: activeOption?.color ?? "#cbd5e1" }}
              />
              {activeOption?.label ?? allLabel}
            </span>
            <ChevronDown
              className={cn(
                "h-3 w-3 text-slate-400 ml-1 transition-transform duration-150",
                compactOpen && "rotate-180",
              )}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className={cn(
            dropdownWidthClass,
            "rounded-xl p-1.5 shadow-xl shadow-slate-200/50 border-slate-100 glass-panel z-50",
          )}
        >
          <DropdownMenuItem
            onClick={() => onChange("all")}
            aria-selected={value === "all"}
            className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer mb-1",
              value === "all" ? "bg-slate-100 text-slate-800" : "text-slate-600",
            )}
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-300" />
              {allLabel}
            </div>
            {value === "all" && <Check className="h-3.5 w-3.5 text-slate-500" />}
          </DropdownMenuItem>
          {options.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => onChange(opt.value)}
              aria-selected={value === opt.value}
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer",
                value === opt.value && "bg-slate-50",
              )}
              style={{ color: value === opt.value ? opt.activeFg : undefined }}
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: opt.color }} />
                {opt.label}
              </div>
              {value === opt.value && <Check className="h-3.5 w-3.5" style={{ color: opt.activeFg }} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export const FilterGroup = memo(FilterGroupImpl) as typeof FilterGroupImpl;

