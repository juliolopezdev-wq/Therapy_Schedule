import { useState, useEffect } from "react";
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
  HeartHandshake
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
};

export function FlagBadge({ flag, iconOnly = false }: { flag: FlagType; iconOnly?: boolean }) {
  const meta = FLAG_META[flag];
  const Icon = FLAG_ICONS[flag];
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded border border-black/[0.05] shadow-[0_1px_1px_rgba(0,0,0,0.02)] whitespace-nowrap",
        iconOnly ? "h-4 w-4" : "px-1.5 py-0.5 text-[9px] font-extrabold leading-none uppercase tracking-wide gap-1",
        flag === "Home Eval" && "animate-pulse ring-2 ring-amber-500 ring-offset-1"
      )}
      style={{ backgroundColor: meta.bg, color: meta.fg }}
      title={meta.description}
    >
      <Icon className={cn(iconOnly ? "h-3 w-3" : "h-2.5 w-2.5")} strokeWidth={iconOnly ? 2.5 : 3} />
      {!iconOnly && meta.label}
    </span>
  );
}

interface FlagToggleProps {
  activeFlags: FlagType[];
  onToggle: (flag: FlagType, active: boolean) => void;
}

export function FlagToggle({ activeFlags, onToggle }: FlagToggleProps) {
  const [optimisticFlags, setOptimisticFlags] = useState<FlagType[]>(activeFlags);

  // Sync optimistic state when server state updates
  useEffect(() => {
    setOptimisticFlags(activeFlags);
  }, [activeFlags]);

  const handleToggle = (flag: FlagType, active: boolean) => {
    // Update UI immediately
    setOptimisticFlags((prev) => 
      active ? [...prev, flag] : prev.filter((f) => f !== flag)
    );
    // Fire the server mutation
    onToggle(flag, active);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:scale-95"
          aria-label="Manage status flags"
        >
          <Flag className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-[15rem] p-2.5 border border-slate-200 shadow-lg bg-white rounded-lg" align="end">
        <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Clinical Status Flags</p>
        <ScrollArea className="h-[260px] pr-3 -mr-1">
          <div className="space-y-1 pb-1">
            {FLAG_TYPES.map((flag) => {
              const isActive = optimisticFlags.includes(flag);
              return (
                <label
                  key={flag}
                  className="group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 transition-all duration-200 hover:bg-slate-50 active:scale-[0.98]"
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isActive}
                      onCheckedChange={(checked) => handleToggle(flag, Boolean(checked))}
                      className="transition-transform duration-200 data-[state=checked]:scale-110"
                    />
                    <FlagBadge flag={flag} />
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap ml-4 transition-colors duration-200 group-hover:text-slate-600">
                    {flag === "Name Alert" ? "Alert" : flag === "Stroke Program" ? "Stroke" : flag}
                  </span>
                </label>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
