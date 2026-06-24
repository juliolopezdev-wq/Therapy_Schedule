import { Flag } from "lucide-react";
import { FLAG_META, FLAG_TYPES, type FlagType } from "@/lib/board";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

export function FlagBadge({ flag }: { flag: FlagType }) {
  const meta = FLAG_META[flag];
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-extrabold leading-none uppercase tracking-wide border border-black/[0.05] shadow-[0_1px_1px_rgba(0,0,0,0.02)] whitespace-nowrap"
      style={{ backgroundColor: meta.bg, color: meta.fg }}
      title={meta.description}
    >
      {meta.label}
    </span>
  );
}

interface FlagToggleProps {
  activeFlags: FlagType[];
  onToggle: (flag: FlagType, active: boolean) => void;
}

export function FlagToggle({ activeFlags, onToggle }: FlagToggleProps) {
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
      <PopoverContent className="w-auto min-w-[14rem] p-2.5 border border-slate-200 shadow-lg bg-white rounded-lg" align="end">
        <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Clinical Status Flags</p>
        <div className="space-y-1">
          {FLAG_TYPES.map((flag) => {
            const isActive = activeFlags.includes(flag);
            const meta = FLAG_META[flag];
            return (
              <label
                key={flag}
                className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-slate-50"
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={isActive}
                    onCheckedChange={(checked) => onToggle(flag, Boolean(checked))}
                  />
                  <span
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-extrabold border border-black/[0.04] whitespace-nowrap"
                    style={{ backgroundColor: meta.bg, color: meta.fg }}
                  >
                    {meta.label}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap ml-4">
                  {flag === "Name Alert" ? "Alert" : flag === "Stroke Program" ? "Stroke" : flag}
                </span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
