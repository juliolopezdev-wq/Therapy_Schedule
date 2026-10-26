import { memo, useState, useEffect } from "react";
import { 
  Flag,
  LogOut,
  AlertTriangle,
  CalendarDays,
  BookOpen,
  CalendarClock,
  Activity,
  Droplets,
  Ban,
  Filter,
  Lock,
  Users,
  User,
  Home,
  HeartHandshake,
  Hospital,
  Clock
} from "lucide-react";
import { FLAG_META, FLAG_TYPES, type FlagType } from "@/lib/board";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const FLAG_ICONS: Record<FlagType, React.ElementType> = {
  DC: LogOut,
  "Name Alert": AlertTriangle,
  Weekend: CalendarDays,
  "In-Service": BookOpen,
  Appointment: CalendarClock,
  "Stroke Program": Activity,
  Shower: Droplets,
  "Medical Hold": Ban,
  Dialysis: Filter,
  "Block Time": Lock,
  "Group Appropriate": Users,
  "Male Therapist Only": User,
  "Female Therapist Only": User,
  "Home Eval": Home,
  "Family Training": HeartHandshake,
  LOA: Hospital,
  "15/7": Clock,
};

function formatFlagDate(value: Date | string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function FlagBadgeImpl({
  flag,
  iconOnly = false,
  effectiveDate,
}: {
  flag: FlagType;
  iconOnly?: boolean;
  effectiveDate?: Date | string;
}) {
  const meta = FLAG_META[flag];
  const Icon = FLAG_ICONS[flag];
  const isDischargeNotice = flag === "DC" && effectiveDate;
  const title = isDischargeNotice
    ? `Planned discharge: ${new Date(effectiveDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
    : meta.description;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-sm border border-black/[0.05] shadow-[0_1px_1px_rgba(0,0,0,0.02)] whitespace-nowrap",
        iconOnly ? "h-4 w-4" : "px-1.5 py-0.5 text-[9px] font-extrabold leading-none uppercase tracking-wide gap-1",
        flag === "Home Eval" && "animate-pulse ring-2 ring-amber-500 ring-offset-1"
      )}
      style={{ backgroundColor: meta.bg, color: meta.fg }}
      title={title}
    >
      <Icon className={cn(iconOnly ? "h-3 w-3" : "h-2.5 w-2.5")} strokeWidth={iconOnly ? 2.5 : 3} />
      {!iconOnly && (
        <span>{meta.label}{isDischargeNotice ? ` · ${formatFlagDate(effectiveDate)}` : ""}</span>
      )}
    </span>
  );
}

// Rendered several times per patient row (one per active flag) -- memoize since `flag`/`iconOnly`
// are primitives that are cheap and reliable to shallow-compare.
export const FlagBadge = memo(FlagBadgeImpl);

interface FlagToggleProps {
  activeFlags: FlagType[];
  onToggle: (flag: FlagType, active: boolean) => Promise<void> | void;
  disabled?: boolean;
}

function FlagToggleImpl({ activeFlags, onToggle, disabled = false }: FlagToggleProps) {
  const [optimisticFlags, setOptimisticFlags] = useState<FlagType[]>(activeFlags);
  const [pendingFlags, setPendingFlags] = useState<Set<FlagType>>(() => new Set());

  // Sync optimistic state when server state updates
  useEffect(() => {
    setOptimisticFlags(activeFlags);
  }, [activeFlags]);

  const handleToggle = async (flag: FlagType, active: boolean) => {
    if (disabled || pendingFlags.has(flag)) return;
    const wasActive = optimisticFlags.includes(flag);

    // Update UI immediately
    setOptimisticFlags((prev) =>
      active ? Array.from(new Set([...prev, flag])) : prev.filter((f) => f !== flag)
    );
    setPendingFlags((prev) => new Set(prev).add(flag));

    try {
      await onToggle(flag, active);
    } catch {
      // The mutation's onError handler reports the reason. Restore the last confirmed state so
      // the checkbox never claims a clinical flag was saved when the server rejected it.
      setOptimisticFlags((prev) =>
        wasActive ? Array.from(new Set([...prev, flag])) : prev.filter((f) => f !== flag),
      );
    } finally {
      setPendingFlags((prev) => {
        const next = new Set(prev);
        next.delete(flag);
        return next;
      });
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border shadow-sm transition-all active:scale-95",
            optimisticFlags.length > 0
              ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50",
          )}
          aria-label="Manage status flags"
          title="Manage clinical flags"
        >
          <Flag className="h-3.5 w-3.5" />
          {optimisticFlags.length > 0 && (
            <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-sky-600 px-0.5 text-[8px] font-bold leading-none text-white shadow-sm">
              {optimisticFlags.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(18rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-slate-200 bg-white p-0 shadow-xl"
        align="end"
        side="bottom"
        sideOffset={8}
        collisionPadding={8}
      >
        <div className="border-b border-slate-100 bg-slate-50/80 px-3 py-2.5">
          <p className="text-xs font-bold text-slate-800">Clinical flags</p>
          <p className="mt-0.5 text-[10px] text-slate-500">Flags remain visible until they are removed.</p>
        </div>
        <ScrollArea className="h-[min(300px,calc(100vh-10rem))]">
          <div className="space-y-1 p-2">
            {FLAG_TYPES.map((flag) => {
              const isActive = optimisticFlags.includes(flag);
              return (
                <label
                  key={flag}
                  className={cn(
                    "group flex cursor-pointer items-center rounded-lg border px-2.5 py-2 transition-colors",
                    isActive ? "border-sky-200 bg-sky-50/70" : "border-transparent hover:bg-slate-50",
                    (disabled || pendingFlags.has(flag)) && "cursor-not-allowed opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isActive}
                      disabled={disabled || pendingFlags.has(flag)}
                      onCheckedChange={(checked) => handleToggle(flag, Boolean(checked))}
                      className="transition-transform duration-200 data-[state=checked]:scale-110"
                    />
                    <FlagBadge flag={flag} />
                  </div>
                </label>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// Rendered once per patient row -- memoize so it doesn't re-render (and re-mount its Popover)
// just because some other patient's row changed.
export const FlagToggle = memo(FlagToggleImpl);
