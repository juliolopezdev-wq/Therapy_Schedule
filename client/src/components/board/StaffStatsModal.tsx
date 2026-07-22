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
import {
  BarChart3,
  Calendar,
  Clock,
  UserCheck,
  UserX,
  CheckCircle2,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StaffStatsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  therapistId: number | null;
  date: Date;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatWorkDays(workDaysRaw: string | null | undefined): string {
  if (!workDaysRaw) return "Mon – Fri (Standard)";
  const days = workDaysRaw
    .split(",")
    .map((d) => parseInt(d.trim(), 10))
    .filter((n) => !isNaN(n) && n >= 0 && n <= 6)
    .sort((a, b) => a - b);

  if (days.length === 0) return "Mon – Fri (Standard)";
  if (days.length === 7) return "Every day (Sun – Sat)";
  if (
    days.length === 5 &&
    days[0] === 1 &&
    days[1] === 2 &&
    days[2] === 3 &&
    days[3] === 4 &&
    days[4] === 5
  ) {
    return "Mon – Fri";
  }
  if (days.length === 2 && days[0] === 0 && days[1] === 6) {
    return "Weekends (Sat, Sun)";
  }

  return days.map((d) => DAY_NAMES[d]).join(", ");
}

function formatTime12h(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatWorkShift(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "07:00 AM – 4:00 PM (Standard)";
  const formattedStart = start ? formatTime12h(start) : "7:00 AM";
  const formattedEnd = end ? formatTime12h(end) : "6:00 PM";
  return `${formattedStart} – ${formattedEnd}`;
}

export function StaffStatsModal({
  open,
  onOpenChange,
  therapistId,
  date,
}: StaffStatsModalProps) {
  const [activeTab, setActiveTab] = useState<"schedule" | "absences" | "details">("schedule");

  const { data: stats, isLoading } = trpc.therapists.getStats.useQuery(
    { therapistId: therapistId!, date },
    { enabled: open && therapistId !== null }
  );

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-2xl glass-panel p-6 rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="mb-2 text-left">
          {isLoading || !stats ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin text-sky-500 mb-2" />
              <span className="text-xs font-semibold">Loading staff metrics...</span>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3.5">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white font-black text-sm shadow-md border border-white/20"
                  style={{ backgroundColor: stats.therapist.color }}
                >
                  {stats.therapist.therapyType}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="text-xl font-black text-slate-900 tracking-tight">
                      {stats.therapist.name}
                    </DialogTitle>

                    {stats.today.isAbsent ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700 border border-rose-200">
                        <UserX className="h-3 w-3" /> Absent Today
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                        <UserCheck className="h-3 w-3" /> Active Today
                      </span>
                    )}
                  </div>

                  <DialogDescription className="text-xs text-slate-500 font-medium flex flex-wrap items-center gap-2 mt-1">
                    <span className="font-semibold text-slate-700">{stats.therapist.teamName ? `${stats.therapist.teamName}` : "Unassigned Team"}</span>
                    <span>•</span>
                    <span>{stats.therapist.therapyType} Discipline</span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100/90 px-2 py-0.5 rounded-md border border-slate-200/60">
                      <Calendar className="h-3 w-3 text-slate-400" /> {format(date, "MMM d, yyyy")}
                    </span>
                    {stats.therapist.isPRN && (
                      <>
                        <span>•</span>
                        <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 font-bold">PRN Staff</span>
                      </>
                    )}
                  </DialogDescription>
                </div>
              </div>

              {/* KPI Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                <div className="p-3.5 rounded-xl bg-sky-50/70 border border-sky-200/60 flex flex-col justify-between shadow-2xs hover:shadow-xs transition-all">
                  <div className="flex items-center justify-between text-sky-800 text-xs font-bold">
                    <span>Today Scheduled</span>
                    <Clock className="h-4 w-4 text-sky-500" />
                  </div>
                  <div className="mt-2.5">
                    <span className="text-2xl font-black text-slate-900 tabular-nums">{stats.today.totalMinutes}</span>
                    <span className="text-xs font-bold text-slate-500 ml-1">mins</span>
                    <p className="text-[11px] font-semibold text-slate-500 mt-0.5">{stats.today.sessionCount} sessions ({stats.today.uniquePatientsCount} pts)</p>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200/60 flex flex-col justify-between shadow-2xs hover:shadow-xs transition-all">
                  <div className="flex items-center justify-between text-indigo-800 text-xs font-bold">
                    <span>Weekly Target</span>
                    <BarChart3 className="h-4 w-4 text-indigo-500" />
                  </div>
                  <div className="mt-2.5">
                    <span className="text-2xl font-black text-slate-900 tabular-nums">{stats.week.totalMinutes}</span>
                    <span className="text-xs font-bold text-slate-500 ml-1">/ {stats.week.targetMinutes}m</span>
                    <div className="w-full h-1.5 rounded-full bg-indigo-200/60 mt-1.5 overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 rounded-full transition-all"
                        style={{ width: `${stats.week.productivityPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200/60 flex flex-col justify-between shadow-2xs hover:shadow-xs transition-all">
                  <div className="flex items-center justify-between text-emerald-800 text-xs font-bold">
                    <span>Attendance Rate</span>
                    <UserCheck className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div className="mt-2.5">
                    <span className="text-2xl font-black text-slate-900 tabular-nums">{stats.attendance.attendanceRatePct}%</span>
                    <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
                      {stats.attendance.absenceCount} call-off{stats.attendance.absenceCount !== 1 ? "s" : ""} on record
                    </p>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-100/70 border border-slate-200/60 flex flex-col justify-between shadow-2xs hover:shadow-xs transition-all">
                  <div className="flex items-center justify-between text-slate-800 text-xs font-bold">
                    <span>Completed Today</span>
                    <CheckCircle2 className="h-4 w-4 text-slate-500" />
                  </div>
                  <div className="mt-2.5">
                    <span className="text-2xl font-black text-slate-900 tabular-nums">{stats.today.completedMinutes}</span>
                    <span className="text-xs font-bold text-slate-500 ml-1">mins</span>
                    <p className="text-[11px] font-semibold text-slate-500 mt-0.5">{stats.today.completedCount} / {stats.today.sessionCount} done</p>
                  </div>
                </div>
              </div>

              {/* Tab Navigation */}
              <div className="flex items-center gap-1.5 border-b border-slate-200/80 mt-6 pb-2">
                <button
                  onClick={() => setActiveTab("schedule")}
                  className={cn(
                    "px-3.5 py-1.5 text-xs font-extrabold rounded-xl transition-all cursor-pointer",
                    activeTab === "schedule"
                      ? "bg-sky-600 text-white shadow-md shadow-sky-500/20"
                      : "bg-slate-100/80 text-slate-600 hover:bg-slate-200/60"
                  )}
                >
                  Today&apos;s Schedule ({stats.today.sessionCount})
                </button>
                <button
                  onClick={() => setActiveTab("absences")}
                  className={cn(
                    "px-3.5 py-1.5 text-xs font-extrabold rounded-xl transition-all cursor-pointer",
                    activeTab === "absences"
                      ? "bg-sky-600 text-white shadow-md shadow-sky-500/20"
                      : "bg-slate-100/80 text-slate-600 hover:bg-slate-200/60"
                  )}
                >
                  Absence History ({stats.attendance.absenceCount})
                </button>
                <button
                  onClick={() => setActiveTab("details")}
                  className={cn(
                    "px-3.5 py-1.5 text-xs font-extrabold rounded-xl transition-all cursor-pointer",
                    activeTab === "details"
                      ? "bg-sky-600 text-white shadow-md shadow-sky-500/20"
                      : "bg-slate-100/80 text-slate-600 hover:bg-slate-200/60"
                  )}
                >
                  Staff Info & Shift
                </button>
              </div>

              {/* Tab 1: Today's Schedule */}
              {activeTab === "schedule" && (
                <div className="mt-3 space-y-2 max-h-60 overflow-y-auto pr-1">
                  {stats.today.sessions.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-xs font-semibold bg-slate-50 rounded-xl border border-slate-100">
                      No sessions scheduled for this staff member today.
                    </div>
                  ) : (
                    stats.today.sessions.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-white border border-slate-200/80 text-xs shadow-2xs hover:border-slate-300 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-slate-900 min-w-[65px] tabular-nums bg-slate-100 px-2 py-1 rounded-md text-center">{s.timeLabel}</span>
                          <div>
                            <p className="font-extrabold text-slate-800 text-sm">{s.patientName}</p>
                            <p className="text-[10px] text-slate-500 font-semibold">Room {s.roomNumber} • {s.therapyType}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="font-extrabold text-slate-700 tabular-nums">{s.durationMinutes} mins</span>
                          <span
                            className={cn(
                              "px-2.5 py-0.5 rounded-full text-[10px] font-extrabold capitalize border",
                              s.status === "completed"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : s.status?.startsWith("missed")
                                ? "bg-rose-50 text-rose-700 border-rose-200"
                                : "bg-sky-50 text-sky-700 border-sky-200"
                            )}
                          >
                            {s.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 2: Absences */}
              {activeTab === "absences" && (
                <div className="mt-3 space-y-2 max-h-60 overflow-y-auto pr-1">
                  {stats.attendance.recentAbsences.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-50 rounded-xl border border-slate-100">
                      <ShieldCheck className="h-8 w-8 text-emerald-500 mb-2" />
                      <p className="text-xs font-bold text-slate-700">Clean Attendance Record</p>
                      <p className="text-[11px] text-slate-500 font-medium">No recorded absences or call-offs for this staff member.</p>
                    </div>
                  ) : (
                    stats.attendance.recentAbsences.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-rose-50/60 border border-rose-200/60 text-xs"
                      >
                        <div className="flex items-center gap-2 text-rose-800 font-extrabold">
                          <UserX className="h-4 w-4 text-rose-600" />
                          <span>{a.date}</span>
                        </div>
                        <span className="font-semibold text-rose-700 bg-white px-2 py-0.5 rounded-md border border-rose-200">
                          {a.reason || "Call-Off"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 3: Staff Details */}
              {activeTab === "details" && (
                <div className="mt-3 bg-slate-50 p-4 rounded-xl border border-slate-200/80 text-xs space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-white rounded-lg border border-slate-100 shadow-2xs">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Therapy Discipline</span>
                      <span className="font-black text-slate-800 text-base">{stats.therapist.therapyType}</span>
                    </div>
                    <div className="p-3 bg-white rounded-lg border border-slate-100 shadow-2xs">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Team Assignment</span>
                      <span className="font-black text-slate-800 text-base">{stats.therapist.teamName || "General / Unassigned"}</span>
                    </div>
                    <div className="p-3 bg-white rounded-lg border border-slate-100 shadow-2xs">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Working Shift</span>
                      <span className="font-extrabold text-slate-800 text-sm">
                        {formatWorkShift(stats.therapist.workStartTime, stats.therapist.workEndTime)}
                      </span>
                    </div>
                    <div className="p-3 bg-white rounded-lg border border-slate-100 shadow-2xs">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Scheduled Work Days</span>
                      <span className="font-extrabold text-slate-800 text-sm">
                        {formatWorkDays(stats.therapist.workDays)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="flex items-center justify-end mt-4 pt-3 border-t border-slate-100">
          <Button onClick={() => onOpenChange(false)} className="bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-extrabold px-6 shadow-sm">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
