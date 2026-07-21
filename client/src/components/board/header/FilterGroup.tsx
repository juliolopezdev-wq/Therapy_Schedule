import { memo, useEffect, useState } from "react";
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

function FilterChip<T extends string | number>({
  option,
  active,
  onClick,
}: {
  option: FilterOption<T> | { value: "all"; label: string };
  active: boolean;
  onClick: () => void;
}) {
  const hasColor = "color" in option && !!option.color;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={
        hasColor && active
          ? {
              backgroundColor: (option as FilterOption<T>).activeBg || (option as FilterOption<T>).color,
              color: (option as FilterOption<T>).activeFg || "#fff",
              borderColor: (option as FilterOption<T>).color,
            }
          : undefined
      }
      className={cn(
        "rounded-md px-2.5 py-1 text-[11px] font-semibold border cursor-pointer",
        "transition-colors duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1",
        active
          ? !hasColor
            ? "bg-blue-700 text-white border-blue-700 shadow-sm"
            : "shadow-sm"
          : "bg-transparent text-slate-500 border-transparent hover:bg-slate-100 hover:text-slate-800",
      )}
    >
      <div className="flex items-center gap-1.5">
        {hasColor && !active && (
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: (option as FilterOption<T>).color }} />
        )}
        {option.label}
      </div>
    </button>
  );
}

/**
 * One labeled filter (Discipline, Team, ...): a compact dropdown below `wideBreakpointClass`,
 * a full button row above it. Used to be duplicated verbatim per filter in BoardHeader (discipline
 * and team each had their own ~65-line copy of this exact structure) -- now it's one component
 * parameterized by the option list.
 */
function FilterGroupImpl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  allLabel = "All",
  dropdownWidthClass = "w-40",
}: {
  label: string;
  options: FilterOption<T>[];
  value: T | "all";
  onChange: (value: T | "all") => void;
  allLabel?: string;
  dropdownWidthClass?: string;
}) {
  const activeOption = value === "all" ? null : options.find((o) => o.value === value);
  const [compactOpen, setCompactOpen] = useState(false);

  // The compact dropdown's trigger is hidden (display:none) once the viewport reaches the
  // 2xl breakpoint, in favor of the full button row. Radix portals the menu content to
  // <body>, so it doesn't notice its trigger vanishing -- without this, growing the window
  // while the dropdown is open leaves it floating open and detached. Force-close it instead.
  useEffect(() => {
    if (!compactOpen) return;
    const mql = window.matchMedia("(min-width: 1536px)");
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) setCompactOpen(false);
    };
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [compactOpen]);

  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</span>

      {/* Compact dropdown -- used below the 2xl breakpoint, where the full button row doesn't fit. */}
      <div className="block 2xl:hidden">
        <DropdownMenu open={compactOpen} onOpenChange={setCompactOpen}>
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
              <span className={cn("flex items-center gap-2", activeOption ? undefined : "text-slate-600")} style={activeOption ? { color: activeOption.activeFg } : undefined}>
                <span
                  className="w-2 h-2 rounded-full shadow-sm"
                  style={{ backgroundColor: activeOption?.color ?? "#cbd5e1" }}
                />
                {activeOption?.label ?? allLabel}
              </span>
              <ChevronDown className={cn("h-3 w-3 text-slate-400 ml-1 transition-transform duration-150", compactOpen && "rotate-180")} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={cn(dropdownWidthClass, "rounded-xl p-1.5 shadow-xl shadow-slate-200/50 border-slate-100")}>
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

      {/* Full button row -- 2xl and up, where there's room to show every option at once. */}
      <div className="hidden 2xl:flex flex-wrap items-center gap-0.5">
        <FilterChip option={{ value: "all", label: allLabel }} active={value === "all"} onClick={() => onChange("all")} />
        {options.map((opt) => (
          <FilterChip key={opt.value} option={opt} active={value === opt.value} onClick={() => onChange(opt.value)} />
        ))}
      </div>
    </div>
  );
}

export const FilterGroup = memo(FilterGroupImpl) as typeof FilterGroupImpl;
