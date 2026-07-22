import { CalendarClock, Sunset, BicepsFlexed } from "lucide-react";
import { cn } from "@/lib/utils";
import { TIME_SLOTS } from "@/lib/board";

const SLOT_WIDTH = 72;

export function TimeHeaderRow() {
  return (
    <div className="flex border-b border-slate-200/80 bg-white/95 backdrop-blur-md shadow-[0_4px_15px_-3px_rgba(0,0,0,0.06)] sticky top-0 z-35 transition-colors">
      <div className="sticky left-0 z-40 flex w-72 shrink-0 items-center border-r border-slate-200/60 bg-slate-100 px-4 py-2 shadow-[2px_0_10px_-3px_rgba(0,0,0,0.02)]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Patient / Room
        </span>
      </div>
      <div
        className="sticky z-40 flex w-11 shrink-0 flex-col items-center justify-center gap-0.5 border-r border-slate-200/60 bg-slate-100 py-2 shadow-[6px_0_15px_-4px_rgba(0,0,0,0.08)]"
        style={{ left: 288 }}
      >
        <CalendarClock className="h-3 w-3 text-slate-400" strokeWidth={2.5} />
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
          EOW
        </span>
      </div>
      {TIME_SLOTS.map((slot) => {
        const isHour = slot.minute === 0;

        if (slot.hour === 12 && slot.minute === 30) {
          return null;
        }

        if (slot.hour === 12 && slot.minute === 0) {
          return (
            <div
              key={slot.index}
              className="shrink-0 py-2.5 text-center border-r border-slate-200 bg-slate-200/40 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,0.03)_4px,rgba(0,0,0,0.03)_8px)]"
              style={{ flex: `0 0 ${SLOT_WIDTH * 2}px`, width: SLOT_WIDTH * 2, minWidth: SLOT_WIDTH * 2 }}
            >
              <span className="text-[10px] font-bold text-slate-600 tracking-widest">
                LUNCH
              </span>
            </div>
          );
        }

        const isLastSlot = slot.index === TIME_SLOTS.length - 1;

        return (
          <div
            key={slot.index}
            className={cn(
              "shrink-0 py-1.5 text-center border-r transition-colors flex flex-col items-center justify-center gap-0.5",
              !isHour ? "border-slate-200" : "border-slate-100/50",
            )}
            style={{ flex: `0 0 ${SLOT_WIDTH}px`, width: SLOT_WIDTH, minWidth: SLOT_WIDTH }}
          >
            <span
              className={cn(
                "text-[10px] tabular-nums tracking-tight leading-none",
                isHour ? "font-bold text-slate-700" : "font-medium text-slate-400",
              )}
            >
              {isHour ? slot.shortLabel.replace(":00", "") : slot.label}
            </span>
            {isLastSlot && (
              <span className="flex items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 py-[1px] text-[8px] font-extrabold uppercase leading-none tracking-wide text-white shadow-sm shadow-amber-500/40">
                <Sunset className="h-2.5 w-2.5" strokeWidth={2.5} />
                6 PM
              </span>
            )}
          </div>
        );
      })}
      
      {/* Daily Total Column */}
      <div
        className="sticky right-0 z-30 flex w-14 shrink-0 flex-col items-center justify-center border-l border-slate-200/60 bg-slate-100/90 backdrop-blur py-2 shadow-[-6px_0_15px_-4px_rgba(0,0,0,0.08)]"
      >
        <BicepsFlexed className="h-3.5 w-3.5 text-rose-500 mb-0.5 drop-shadow-sm" strokeWidth={2.5} />
        <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
          Total
        </span>
      </div>
    </div>
  );
}
