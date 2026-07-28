import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Therapist } from "../../../../drizzle/schema";
import {
  Clock,
  Calendar,
  Check,
  Sparkles,
  Copy,
  UserCheck,
  UserX,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface DayAvailability {
  active: boolean;
  start: string; // "HH:MM", e.g. "07:00"
  end: string;   // "HH:MM", e.g. "15:30"
}

export type WeeklyAvailability = Record<number, DayAvailability>;

export const DAY_LIST = [
  { index: 0, short: "Sun", full: "Sunday" },
  { index: 1, short: "Mon", full: "Monday" },
  { index: 2, short: "Tue", full: "Tuesday" },
  { index: 3, short: "Wed", full: "Wednesday" },
  { index: 4, short: "Thu", full: "Thursday" },
  { index: 5, short: "Fri", full: "Friday" },
  { index: 6, short: "Sat", full: "Saturday" },
];

const DEFAULT_START = "07:00";
const DEFAULT_END = "18:00";

const SHIFT_PRESETS = [
  { label: "7:00 AM – 3:30 PM", start: "07:00", end: "15:30" },
  { label: "8:00 AM – 4:30 PM", start: "08:00", end: "16:30" },
  { label: "9:00 AM – 5:30 PM", start: "09:00", end: "17:30" },
  { label: "7:00 AM – 6:00 PM", start: "07:00", end: "18:00" },
];

export function formatTime12h(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export function buildDefaultSchedule(therapist?: Therapist | null): WeeklyAvailability {
  const schedule: WeeklyAvailability = {};

  if (therapist?.workHours) {
    try {
      const parsed = JSON.parse(therapist.workHours);
      for (let i = 0; i <= 6; i++) {
        if (parsed[String(i)]) {
          schedule[i] = {
            active: !!parsed[String(i)].active,
            start: parsed[String(i)].start || DEFAULT_START,
            end: parsed[String(i)].end || DEFAULT_END,
          };
        } else {
          schedule[i] = { active: false, start: DEFAULT_START, end: DEFAULT_END };
        }
      }
      return schedule;
    } catch (e) {
      // fallback
    }
  }

  const activeDays = therapist?.workDays
    ? therapist.workDays.split(",").map(Number)
    : [1, 2, 3, 4, 5]; // Mon-Fri default

  const start = therapist?.workStartTime || DEFAULT_START;
  const end = therapist?.workEndTime || DEFAULT_END;

  for (let i = 0; i <= 6; i++) {
    schedule[i] = {
      active: activeDays.includes(i),
      start: start,
      end: end,
    };
  }

  return schedule;
}

interface StaffAvailabilityModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  therapist: Therapist | null;
  initialDayIndex?: number;
  onSuccess?: () => void;
}

export function StaffAvailabilityModal({
  open,
  onOpenChange,
  therapist,
  initialDayIndex = 1, // Mon default
  onSuccess,
}: StaffAvailabilityModalProps) {
  const [selectedDay, setSelectedDay] = useState<number>(initialDayIndex);
  const [schedule, setSchedule] = useState<WeeklyAvailability>(() => buildDefaultSchedule(therapist));

  const utils = trpc.useUtils();

  useEffect(() => {
    if (therapist && open) {
      setSchedule(buildDefaultSchedule(therapist));
      setSelectedDay(initialDayIndex);
    }
  }, [therapist, open, initialDayIndex]);

  const updateTherapist = trpc.therapists.update.useMutation({
    onSuccess: () => {
      utils.therapists.list.invalidate();
      utils.sessions.list.invalidate();
      toast.success(`Updated availability schedule for ${therapist?.name}`);
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update availability");
    },
  });

  if (!open || !therapist) return null;

  const currentDayConfig = schedule[selectedDay] || { active: false, start: DEFAULT_START, end: DEFAULT_END };
  const selectedDayInfo = DAY_LIST.find((d) => d.index === selectedDay)!;

  const handleToggleDay = (dayIdx: number, active: boolean) => {
    setSchedule((prev) => ({
      ...prev,
      [dayIdx]: {
        ...prev[dayIdx],
        active,
      },
    }));
  };

  const handleUpdateTimes = (dayIdx: number, start: string, end: string) => {
    setSchedule((prev) => ({
      ...prev,
      [dayIdx]: {
        ...prev[dayIdx],
        start,
        end,
      },
    }));
  };

  const handleApplyPresetToSelected = (presetStart: string, presetEnd: string) => {
    setSchedule((prev) => ({
      ...prev,
      [selectedDay]: {
        active: true,
        start: presetStart,
        end: presetEnd,
      },
    }));
  };

  const handleApplyToAllActive = () => {
    const { start, end } = currentDayConfig;
    setSchedule((prev) => {
      const next = { ...prev };
      for (let i = 0; i <= 6; i++) {
        if (next[i].active) {
          next[i] = { ...next[i], start, end };
        }
      }
      return next;
    });
    toast.info(`Applied ${formatTime12h(currentDayConfig.start)} – ${formatTime12h(currentDayConfig.end)} shift to all working days`);
  };

  const handlePresetMonFri = (presetStart: string, presetEnd: string) => {
    setSchedule((prev) => {
      const next = { ...prev };
      for (let i = 0; i <= 6; i++) {
        const isWeekday = i >= 1 && i <= 5;
        next[i] = {
          active: isWeekday,
          start: presetStart,
          end: presetEnd,
        };
      }
      return next;
    });
    toast.info(`Set Mon–Fri schedule to ${formatTime12h(presetStart)} – ${formatTime12h(presetEnd)}`);
  };

  const handleResetUnrestricted = () => {
    setSchedule((prev) => {
      const next = { ...prev };
      for (let i = 0; i <= 6; i++) {
        next[i] = { active: true, start: DEFAULT_START, end: DEFAULT_END };
      }
      return next;
    });
    toast.info("Reset schedule to available every day (7:00 AM – 6:00 PM)");
  };

  const handleSave = () => {
    const activeDayIndices = Object.entries(schedule)
      .filter(([_, cfg]) => cfg.active)
      .map(([idx]) => Number(idx));

    // Find min start and max end among active days for legacy compatibility
    let minStart = DEFAULT_START;
    let maxEnd = DEFAULT_END;

    if (activeDayIndices.length > 0) {
      const activeConfigs = activeDayIndices.map((idx) => schedule[idx]);
      minStart = activeConfigs.reduce((min, c) => (c.start < min ? c.start : min), activeConfigs[0].start);
      maxEnd = activeConfigs.reduce((max, c) => (c.end > max ? c.end : max), activeConfigs[0].end);
    }

    const workHoursJson = JSON.stringify(schedule);

    updateTherapist.mutate({
      id: therapist.id,
      workDays: activeDayIndices,
      workStartTime: activeDayIndices.length > 0 ? minStart : null,
      workEndTime: activeDayIndices.length > 0 ? maxEnd : null,
      workHours: workHoursJson,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-xl glass-panel p-6 rounded-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader className="mb-4 text-left">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white font-black text-sm shadow-md border border-white/20"
              style={{ backgroundColor: therapist.color || "#0ea5e9" }}
            >
              {therapist.therapyType}
            </div>
            <div>
              <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
                {therapist.name}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium flex items-center gap-2 mt-0.5">
                <Clock className="h-3.5 w-3.5 text-sky-500" />
                <span>Configure Available Shift Hours & Days</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5">
          {/* Day Selector Header Bar */}
          <div>
            <Label className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-2 block">
              Click a Day to Modify Shift Times
            </Label>
            <div className="grid grid-cols-7 gap-1.5">
              {DAY_LIST.map((day) => {
                const dayConfig = schedule[day.index];
                const isSelected = selectedDay === day.index;
                return (
                  <button
                    key={day.index}
                    type="button"
                    onClick={() => setSelectedDay(day.index)}
                    className={cn(
                      "flex flex-col items-center justify-between p-2 rounded-xl border text-center transition-all cursor-pointer select-none",
                      isSelected
                        ? "bg-sky-600 text-white border-sky-600 shadow-md shadow-sky-500/25 scale-[1.02]"
                        : dayConfig.active
                        ? "bg-sky-50/70 border-sky-200/80 text-slate-800 hover:bg-sky-100/60"
                        : "bg-slate-100/60 border-slate-200/60 text-slate-400 hover:bg-slate-100"
                    )}
                  >
                    <span className={cn("text-xs font-black", isSelected ? "text-white" : "text-slate-700")}>
                      {day.short}
                    </span>
                    <span
                      className={cn(
                        "text-[9px] font-extrabold px-1.5 py-0.5 rounded-full mt-1.5",
                        isSelected
                          ? "bg-white/20 text-white"
                          : dayConfig.active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200/80 text-slate-500"
                      )}
                    >
                      {dayConfig.active ? "On" : "Off"}
                    </span>
                    <span className={cn("text-[9px] font-semibold mt-1 tabular-nums", isSelected ? "text-sky-100" : "text-slate-500")}>
                      {dayConfig.active ? `${formatTime12h(dayConfig.start).split(' ')[0]}` : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Day Detail Card */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-sky-100 text-sky-700 font-bold text-xs">
                  {selectedDayInfo.short}
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-800">{selectedDayInfo.full} Availability</h4>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {currentDayConfig.active
                      ? `Working ${formatTime12h(currentDayConfig.start)} – ${formatTime12h(currentDayConfig.end)}`
                      : "Off / Not Scheduled"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={currentDayConfig.active}
                  onCheckedChange={(checked) => handleToggleDay(selectedDay, checked)}
                />
                <span className="text-xs font-extrabold text-slate-700">
                  {currentDayConfig.active ? "Available" : "Off"}
                </span>
              </div>
            </div>

            {currentDayConfig.active ? (
              <div className="space-y-4">
                {/* Time Picker Controls */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-slate-600 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-sky-500" /> Start Time
                    </Label>
                    <Input
                      type="time"
                      value={currentDayConfig.start}
                      onChange={(e) => handleUpdateTimes(selectedDay, e.target.value, currentDayConfig.end)}
                      className="h-10 rounded-xl font-bold text-sm bg-slate-50/80 border-slate-200"
                    />
                    <span className="text-[11px] font-semibold text-slate-400 block text-right">
                      {formatTime12h(currentDayConfig.start)}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-slate-600 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-sky-500" /> End Time
                    </Label>
                    <Input
                      type="time"
                      value={currentDayConfig.end}
                      onChange={(e) => handleUpdateTimes(selectedDay, currentDayConfig.start, e.target.value)}
                      className="h-10 rounded-xl font-bold text-sm bg-slate-50/80 border-slate-200"
                    />
                    <span className="text-[11px] font-semibold text-slate-400 block text-right">
                      {formatTime12h(currentDayConfig.end)}
                    </span>
                  </div>
                </div>

                {/* Shift Quick Presets */}
                <div>
                  <Label className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Quick Shift Presets for {selectedDayInfo.short}
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    {SHIFT_PRESETS.map((p) => {
                      const isPresetActive = currentDayConfig.start === p.start && currentDayConfig.end === p.end;
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => handleApplyPresetToSelected(p.start, p.end)}
                          className={cn(
                            "px-3 py-2 rounded-xl text-xs font-bold border transition-all text-left flex items-center justify-between cursor-pointer",
                            isPresetActive
                              ? "bg-sky-50 text-sky-700 border-sky-300 shadow-2xs"
                              : "bg-slate-50/80 text-slate-700 border-slate-200 hover:bg-slate-100"
                          )}
                        >
                          <span>{p.label}</span>
                          {isPresetActive && <Check className="h-3.5 w-3.5 text-sky-600 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Action shortcut to duplicate shift */}
                <div className="pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleApplyToAllActive}
                    className="w-full h-8 text-xs font-bold rounded-xl text-sky-700 border-sky-200 hover:bg-sky-50 flex items-center justify-center gap-1.5"
                  >
                    <Copy className="h-3.5 w-3.5 text-sky-500" />
                    <span>Apply {formatTime12h(currentDayConfig.start)} – {formatTime12h(currentDayConfig.end)} to All Working Days</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
                <UserX className="h-6 w-6 text-slate-400 mb-1.5" />
                <p className="text-xs font-bold text-slate-700">{selectedDayInfo.full} is marked as Day Off</p>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">Toggle switch above to enable working hours on this day.</p>
              </div>
            )}
          </div>

          {/* Quick Schedule Templates Bar */}
          <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
              Quick Schedule Templates
            </span>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePresetMonFri("08:00", "16:30")}
                className="h-7 text-[11px] font-bold rounded-lg text-slate-700 bg-white hover:bg-sky-50 hover:text-sky-700 hover:border-sky-200"
              >
                Mon–Fri 8am–4:30pm
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePresetMonFri("07:00", "15:30")}
                className="h-7 text-[11px] font-bold rounded-lg text-slate-700 bg-white hover:bg-sky-50 hover:text-sky-700 hover:border-sky-200"
              >
                Mon–Fri 7am–3:30pm
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetUnrestricted}
                className="h-7 text-[11px] font-bold rounded-lg text-slate-700 bg-white hover:bg-slate-100"
              >
                <RotateCcw className="h-3 w-3 mr-1 text-slate-400" />
                Unrestricted / All Days
              </Button>
            </div>
          </div>
        </div>

        {/* Modal Action Footer */}
        <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl text-slate-600 font-bold"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={updateTherapist.isPending}
            onClick={handleSave}
            className="bg-sky-600 hover:bg-sky-700 text-white font-extrabold rounded-xl px-6 shadow-sm"
          >
            {updateTherapist.isPending ? "Saving..." : "Save Availability"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
