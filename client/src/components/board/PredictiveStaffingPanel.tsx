import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  BarChart3,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Search,
  TrendingUp,
  UserMinus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PredictiveStaffingPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date;
}

type DisciplineFilter = "all" | "PT" | "OT" | "SLP";

export function PredictiveStaffingPanel({ open, onOpenChange, day }: PredictiveStaffingPanelProps) {
  const [search, setSearch] = useState("");
  const [discipline, setDiscipline] = useState<DisciplineFilter>("all");
  const forecastQuery = trpc.aiAgents.getPredictiveForecast.useQuery(
    { date: day },
    { enabled: open, staleTime: 0 },
  );

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setDiscipline("all");
  }, [open, day]);

  const forecast = forecastQuery.data;
  const reserveDelta = forecast ? forecast.totalAvailableMinutes - forecast.suggestedBufferMinutes : 0;
  const reserveCovered = reserveDelta >= 0;

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (forecast?.staffCapacity ?? []).filter((staff) => {
      if (discipline !== "all" && staff.therapyType !== discipline) return false;
      return !term
        || staff.name.toLowerCase().includes(term)
        || staff.therapyType.toLowerCase().includes(term)
        || staff.employmentType.replace("_", " ").includes(term)
        || staff.availabilityStatus.replace("_", " ").includes(term);
    });
  }, [discipline, forecast?.staffCapacity, search]);

  const disciplineCapacity = useMemo(() => {
    return (["PT", "OT", "SLP"] as const).map((therapyType) => {
      const staff = (forecast?.staffCapacity ?? []).filter((item) => item.therapyType === therapyType);
      return {
        therapyType,
        staffCount: staff.length,
        workingCount: staff.filter((item) => item.availabilityStatus === "working").length,
        availableMinutes: staff.reduce((total, item) => total + item.availableMinutes, 0),
        scheduledMinutes: staff.reduce((total, item) => total + item.scheduledMinutes, 0),
      };
    });
  }, [forecast?.staffCapacity]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl xl:max-w-6xl">
        <div className="shrink-0 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-5 py-5 pr-20 text-white sm:px-6">
          <DialogHeader className="text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight text-white">Staffing plan</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-blue-50">
                  Review scheduled demand, remaining capacity, and a historical coverage buffer for {format(day, "EEEE, MMMM d, yyyy")}.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {forecastQuery.isLoading || forecastQuery.isFetching && !forecast ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white text-slate-600">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
            <p className="mt-3 text-sm font-semibold">Calculating staffing capacity…</p>
          </div>
        ) : forecastQuery.isError ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-rose-700" />
            <h3 className="mt-4 text-lg font-bold text-slate-950">Staffing forecast unavailable</h3>
            <p className="mt-1 max-w-md text-sm text-slate-600">{forecastQuery.error.message || "Capacity data could not be loaded."}</p>
            <Button variant="outline" className="mt-5 h-11" onClick={() => forecastQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
          </div>
        ) : forecast ? (
          <>
            <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-200 bg-white p-4 sm:px-6 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-blue-600"/><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Scheduled demand</p></div>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-950">{forecast.scheduledDemandMinutes}<span className="ml-1 text-sm font-bold text-slate-500">min</span></p>
                <p className="text-xs text-slate-500">currently on the board</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-emerald-700"/><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Open capacity</p></div>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-emerald-700">{forecast.totalAvailableMinutes}<span className="ml-1 text-sm font-bold text-slate-500">min</span></p>
                <p className="text-xs text-slate-500">after scheduled sessions</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2"><CalendarPlus className="h-4 w-4 text-violet-700"/><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Suggested reserve</p></div>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-violet-700">{forecast.suggestedBufferMinutes}<span className="ml-1 text-sm font-bold text-slate-500">min</span></p>
                <p className="text-xs text-slate-500">historical buffer estimate</p>
              </div>
              <div className={cn("rounded-xl border p-3", reserveCovered ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50")}>
                <div className="flex items-center gap-2">{reserveCovered ? <CheckCircle2 className="h-4 w-4 text-emerald-700"/> : <AlertTriangle className="h-4 w-4 text-rose-700"/>}<p className="text-xs font-bold uppercase tracking-wide text-slate-500">After reserve</p></div>
                <p className={cn("mt-1 text-2xl font-extrabold tabular-nums", reserveCovered ? "text-emerald-700" : "text-rose-700")}>{reserveDelta > 0 ? "+" : ""}{reserveDelta}<span className="ml-1 text-sm font-bold text-slate-500">min</span></p>
                <p className="text-xs text-slate-600">{reserveCovered ? "capacity remains" : "estimated shortfall"}</p>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
              {!reserveCovered && (
                <div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-950">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
                  <p className="text-sm"><strong>Coverage reserve is short by {Math.abs(reserveDelta)} minutes.</strong> Review PRN availability and discipline-specific capacity before adding sessions.</p>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-3">
                {disciplineCapacity.map((item) => (
                  <button key={item.therapyType} type="button" onClick={() => setDiscipline(discipline === item.therapyType ? "all" : item.therapyType)} className={cn("rounded-xl border bg-white p-3 text-left transition-colors", discipline === item.therapyType ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200 hover:bg-slate-50")}>
                    <div className="flex items-center justify-between"><span className="text-sm font-extrabold text-slate-950">{item.therapyType}</span><span className="text-xs font-semibold text-slate-500">{item.workingCount} working · {item.staffCount} total</span></div>
                    <div className="mt-2 flex items-end justify-between"><span className="text-xl font-extrabold tabular-nums text-emerald-700">{item.availableMinutes}m free</span><span className="text-xs text-slate-500">{item.scheduledMinutes}m booked</span></div>
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff or discipline…" className="h-11 border-slate-300 bg-white pl-10 text-sm" />
                </div>
                <div className="flex items-center justify-between gap-3 lg:justify-end">
                  {discipline !== "all" && <Button variant="ghost" className="h-10" onClick={() => setDiscipline("all")}>Clear {discipline} filter</Button>}
                  <Button variant="outline" className="h-10 bg-white" disabled={forecastQuery.isFetching} onClick={() => forecastQuery.refetch()}><RefreshCw className={cn("mr-2 h-4 w-4", forecastQuery.isFetching && "animate-spin")}/>Refresh</Button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div><h3 className="text-sm font-bold text-slate-950">All active staff</h3><p className="text-xs text-slate-500">Working, absent, PRN, part-time, and off-shift staff are included. Only working capacity contributes to totals.</p></div>
                  {forecast.absentStaffCount > 0 && <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800"><UserMinus className="h-3.5 w-3.5"/>{forecast.absentStaffCount} absent</span>}
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  {forecast.staffCapacity.length === 0 ? (
                    <div className="flex min-h-52 flex-col items-center justify-center p-8 text-center"><Users className="h-9 w-9 text-slate-300"/><h3 className="mt-3 font-bold text-slate-950">No active staff</h3><p className="mt-1 text-sm text-slate-600">Add or restore staff members in Staff Management.</p></div>
                  ) : filteredStaff.length === 0 ? (
                    <div className="flex min-h-52 flex-col items-center justify-center p-8 text-center"><Search className="h-9 w-9 text-slate-300"/><h3 className="mt-3 font-bold text-slate-950">No matching staff</h3><p className="mt-1 text-sm text-slate-600">Try another search or discipline.</p><Button variant="outline" className="mt-4 h-10" onClick={() => { setSearch(""); setDiscipline("all"); }}>Clear filters</Button></div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredStaff.map((staff) => {
                        const utilization = staff.shiftMinutes > 0 ? Math.min(100, Math.round((staff.scheduledMinutes / staff.shiftMinutes) * 100)) : 0;
                        const isWorking = staff.availabilityStatus === "working";
                        const assignedWhileUnavailable = !isWorking && staff.scheduledMinutes > 0;
                        return (
                          <div key={staff.id} className={cn("grid gap-3 px-4 py-4 lg:grid-cols-[minmax(190px,1fr)_minmax(220px,1.5fr)_auto] lg:items-center", !isWorking && "bg-slate-50/70", assignedWhileUnavailable && "bg-rose-50/60")}>
                            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-bold text-slate-950">{staff.name}</p><span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-800">{staff.therapyType}</span>{staff.isPRN && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">PRN</span>}{staff.employmentType === "part_time" && <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800">Part-time</span>}{staff.availabilityStatus === "absent" && <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">Absent</span>}{staff.availabilityStatus === "off_shift" && <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700">Off shift</span>}</div><p className="mt-1 text-xs text-slate-500">{isWorking ? `${staff.shiftMinutes} shift minutes` : staff.availabilityStatus === "absent" ? "Recorded absent for this date" : "Not scheduled to work this date"}</p></div>
                            <div><div className="mb-1.5 flex justify-between text-xs"><span className={cn("font-semibold", assignedWhileUnavailable ? "text-rose-700" : "text-slate-600")}>{staff.scheduledMinutes}m booked{assignedWhileUnavailable ? " — reassignment needed" : ""}</span><span className="font-bold text-slate-800">{isWorking ? `${utilization}% utilized` : "No capacity"}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full", !isWorking ? "bg-slate-300" : utilization >= 90 ? "bg-rose-500" : utilization >= 75 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${isWorking ? utilization : assignedWhileUnavailable ? 100 : 0}%` }}/></div></div>
                            <div className="min-w-28 text-left lg:text-right"><p className={cn("text-lg font-extrabold tabular-nums", isWorking ? "text-emerald-700" : "text-slate-500")}>{isWorking ? `${staff.availableMinutes}m` : "—"}</p><p className="text-xs text-slate-500">{isWorking ? "remaining" : "unavailable"}</p></div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </div>

              <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <summary className="cursor-pointer font-bold text-slate-900">How this estimate is calculated</summary>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <p>The suggested reserve combines the average number of {forecast.dayOfWeek} admissions ({forecast.expectedAdmissions.toFixed(1)}) with average staffing-related missed minutes.</p>
                  <p>Historical missed-session rate: {(forecast.expectedMissedRate * 100).toFixed(1)}% across {forecast.historicalSessionCount} prior {forecast.dayOfWeek} session{forecast.historicalSessionCount === 1 ? "" : "s"}. Admission estimate: {forecast.historicalAdmissionCount} admission{forecast.historicalAdmissionCount === 1 ? "" : "s"} across {forecast.historicalWeeks} week{forecast.historicalWeeks === 1 ? "" : "s"}.</p>
                  <p>This is a planning estimate, not an automated staffing decision. Discipline fit, treatment intensity, patient needs, and staff credentials still require review.</p>
                </div>
              </details>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
              <p className="text-xs text-slate-500">Read-only forecast — no schedules or staff assignments are changed.</p>
              <Button className="h-11 bg-blue-700 px-6 hover:bg-blue-800" onClick={() => onOpenChange(false)}>Close plan</Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
