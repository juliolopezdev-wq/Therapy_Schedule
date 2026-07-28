import { useState } from "react";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, Loader2, Sparkles, RotateCcw, Repeat, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface WeekendStaffingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referenceDate: Date;
}

const DISCIPLINE_ORDER = ["PT", "OT", "SLP"] as const;

const SOURCE_META: Record<string, { label: string; icon: typeof Repeat; className: string }> = {
  override: { label: "Manually set", icon: Pin, className: "bg-sky-50 text-sky-700 border-sky-200" },
  rotation: { label: "On rotation", icon: Repeat, className: "bg-sky-50 text-sky-700 border-sky-200" },
  fixed_schedule: { label: "Regular schedule", icon: Calendar, className: "bg-slate-100 text-slate-500 border-slate-200" },
  none: { label: "Not scheduled", icon: Calendar, className: "bg-slate-100 text-slate-400 border-slate-200" },
};

export function WeekendStaffingModal({ open, onOpenChange, referenceDate }: WeekendStaffingModalProps) {
  const [activeDayIndex, setActiveDayIndex] = useState(0);

  const utils = trpc.useUtils();
  const { data: coverage, isLoading } = trpc.weekendStaffing.getCoverage.useQuery(
    { referenceDate },
    { enabled: open },
  );

  const setOverride = trpc.weekendStaffing.setOverride.useMutation({
    onSuccess: () => utils.weekendStaffing.getCoverage.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  const autoAssign = trpc.weekendStaffing.autoAssign.useMutation({
    onSuccess: (result) => {
      utils.weekendStaffing.getCoverage.invalidate();
      if (result.confirmed.length === 0) {
        toast.info("Nothing new to confirm -- rotation-based staffing is already up to date.");
      } else {
        toast.success(`Confirmed ${result.confirmed.length} weekend shift${result.confirmed.length === 1 ? "" : "s"} based on rotation.`);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  if (!open) return null;

  const day = coverage?.[activeDayIndex];

  const grouped = day
    ? DISCIPLINE_ORDER.map((discipline) => ({
        discipline,
        entries: day.entries
          .filter((e) => e.therapyType === discipline)
          .sort((a, b) => Number(b.working) - Number(a.working) || a.name.localeCompare(b.name)),
      })).filter((g) => g.entries.length > 0)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-2xl glass-panel p-6 rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="mb-2 text-left">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <Calendar className="h-5 w-5 text-sky-600" /> Weekend Staffing
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium mt-1">
                Who's working Fri/Sat/Sun -- computed from rotation patterns, or set manually below.
              </DialogDescription>
            </div>
            <Button
              size="sm"
              className="h-8 shrink-0 bg-sky-600 text-white font-bold hover:bg-sky-700"
              disabled={autoAssign.isPending || isLoading}
              onClick={() => autoAssign.mutate({ referenceDate })}
            >
              {autoAssign.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Repeat className="mr-1.5 h-3.5 w-3.5" />
              )}
              Auto-Assign Rotation
            </Button>
          </div>
        </DialogHeader>

        {isLoading || !coverage ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-sky-500 mb-2" />
            <span className="text-xs font-semibold">Loading weekend coverage...</span>
          </div>
        ) : (
          <>
            {/* Day tabs */}
            <div className="flex items-center gap-1.5 border-b border-slate-200/80 pb-2">
              {coverage.map((d, i) => {
                const workingCount = d.entries.filter((e) => e.working).length;
                return (
                  <button
                    key={d.date}
                    onClick={() => setActiveDayIndex(i)}
                    className={cn(
                      "px-3.5 py-1.5 text-xs font-extrabold rounded-xl transition-all cursor-pointer",
                      i === activeDayIndex
                        ? "bg-sky-600 text-white shadow-md shadow-sky-500/20"
                        : "bg-slate-100/80 text-slate-600 hover:bg-slate-200/60",
                    )}
                  >
                    {d.dayLabel} ({format(new Date(d.date), "MMM d")}) -- {workingCount}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 space-y-4 max-h-[55vh] overflow-y-auto pr-1">
              {grouped.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs font-semibold bg-slate-50 rounded-xl border border-slate-100">
                  No staff on file yet.
                </div>
              ) : (
                grouped.map(({ discipline, entries }) => (
                  <div key={discipline}>
                    <p className="text-micro font-semibold uppercase tracking-widest text-slate-400 mb-1.5">
                      {discipline} ({entries.filter((e) => e.working).length} of {entries.length} working)
                    </p>
                    <ul className="space-y-1.5">
                      {entries.map((entry) => {
                        const meta = SOURCE_META[entry.source] ?? SOURCE_META.none;
                        const Icon = meta.icon;
                        const isPending =
                          setOverride.isPending &&
                          setOverride.variables?.therapistId === entry.therapistId &&
                          setOverride.variables?.date.getTime() === new Date(day!.date).getTime();
                        return (
                          <li
                            key={entry.therapistId}
                            className={cn(
                              "flex items-center justify-between gap-3 rounded-xl border p-2.5 transition-all",
                              entry.working ? "border-emerald-200/80 bg-emerald-50/40" : "border-white/40 glass-surface",
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {isPending ? (
                                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
                              ) : (
                                <Checkbox
                                  checked={entry.working}
                                  onCheckedChange={(checked) =>
                                    setOverride.mutate({ therapistId: entry.therapistId, date: new Date(day!.date), working: !!checked })
                                  }
                                />
                              )}
                              <span className="truncate text-sm font-bold text-slate-800">{entry.name}</span>
                              {entry.sessionCount > 0 && (
                                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-micro font-bold text-slate-500">
                                  {entry.sessionCount} session{entry.sessionCount === 1 ? "" : "s"}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-micro font-bold", meta.className)}>
                                <Icon className="h-2.5 w-2.5" /> {entry.rotationLabel && entry.source === "rotation" ? entry.rotationLabel : meta.label}
                              </span>
                              {entry.source === "override" && (
                                <button
                                  type="button"
                                  title="Reset to computed default"
                                  className="text-slate-300 hover:text-slate-500"
                                  onClick={() =>
                                    setOverride.mutate({ therapistId: entry.therapistId, date: new Date(day!.date), working: null })
                                  }
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <div className="flex items-center justify-end mt-4 pt-3 border-t border-slate-100">
          <Button onClick={() => onOpenChange(false)} className="bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-extrabold px-6 shadow-sm">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
