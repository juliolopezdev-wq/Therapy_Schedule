import { useEffect, useMemo, useState } from "react";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  UserCheck,
  UserMinus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { Therapist } from "../../../../drizzle/schema";
import type { SessionTileData } from "./SessionTile";

type AttendanceFilter = "all" | "present" | "absent";

interface DailyAttendanceProps {
  day: Date;
  therapists: Therapist[];
  sessions: SessionTileData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewStats?: (therapistId: number) => void;
}

interface CallOffTarget {
  therapistId: number;
  name: string;
  sessionCount: number;
  minutes: number;
}

interface AttendanceResult {
  kind: "absent" | "present";
  name: string;
  reassigned?: number;
  unassigned?: number;
  details?: string[];
  undoAuditId?: number;
}

export function DailyAttendance({ day, therapists, sessions, open, onOpenChange, onViewStats }: DailyAttendanceProps) {
  const { canEdit, isAdmin, therapistId: currentTherapistId } = usePermissions();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AttendanceFilter>("all");
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const [absenceReason, setAbsenceReason] = useState("Call-Off");
  const [confirmCallOff, setConfirmCallOff] = useState<CallOffTarget | null>(null);
  const [confirmPresent, setConfirmPresent] = useState<{ therapistId: number; name: string } | null>(null);
  const [lastResult, setLastResult] = useState<AttendanceResult | null>(null);

  const absencesQuery = trpc.attendance.getAbsences.useQuery({ date: day }, { enabled: open, staleTime: 0 });
  const absences = absencesQuery.data ?? [];
  const absentIds = useMemo(() => {
    const activeIds = new Set(therapists.map((therapist) => therapist.id));
    return new Set(absences.filter((absence) => activeIds.has(absence.therapistId)).map((absence) => absence.therapistId));
  }, [absences, therapists]);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setStatusFilter("all");
    setDisciplineFilter("all");
    setConfirmCallOff(null);
    setConfirmPresent(null);
    setLastResult(null);
  }, [open, day]);

  const refreshAttendance = () => {
    void utils.attendance.getAbsences.invalidate();
    void utils.attendance.assignmentHistory.invalidate();
    void utils.sessions.list.invalidate();
    void utils.sessions.listForDateRange.invalidate();
    void utils.weeklyMinutes.summary.invalidate();
    void utils.therapists.getStats.invalidate();
    void utils.therapists.getProductivity.invalidate();
    void utils.aiAgents.getComplianceReport.invalidate();
    void utils.aiAgents.getPredictiveForecast.invalidate();
    void utils.forecast.invalidate();
  };

  const callOffMutation = trpc.attendance.callOff.useMutation({
    onSuccess: (data, variables) => {
      refreshAttendance();
      const therapist = therapists.find((item) => item.id === variables.therapistId);
      const details = Object.entries(data.reassignedTo ?? {}).map(([id, count]) => {
        const receiving = therapists.find((item) => item.id === Number(id));
        return `${count} session${count === 1 ? "" : "s"} to ${receiving?.name ?? "another therapist"}`;
      });
      setLastResult({
        kind: "absent",
        name: therapist?.name ?? "Staff member",
        reassigned: data.reAssignedCount,
        unassigned: data.unassignedCount,
        details: [...details, ...(data.suggestions ?? [])],
        undoAuditId: data.undoAuditId,
      });
      setConfirmCallOff(null);
      toast.success(`${therapist?.name ?? "Staff member"} marked absent`);
    },
    onError: (error) => toast.error(error.message || "Could not process the call-off"),
  });

  const cancelCallOffMutation = trpc.attendance.cancelCallOff.useMutation({
    onSuccess: (_data, variables) => {
      refreshAttendance();
      const therapist = therapists.find((item) => item.id === variables.therapistId);
      setLastResult({ kind: "present", name: therapist?.name ?? "Staff member" });
      setConfirmPresent(null);
      toast.success(`${therapist?.name ?? "Staff member"} marked present`);
    },
    onError: (error) => toast.error(error.message || "Could not update attendance"),
  });

  const undoCallOffMutation = trpc.attendance.undoCallOff.useMutation({
    onSuccess: (data) => {
      refreshAttendance();
      setLastResult(null);
      toast.success(`Call-off undone; ${data.restoredCount} session${data.restoredCount === 1 ? "" : "s"} restored`);
    },
    onError: (error) => toast.error(error.message || "Could not undo the call-off"),
  });

  const filteredTherapists = useMemo(() => {
    const term = search.trim().toLowerCase();
    return therapists
      .filter((therapist) => {
        const absent = absentIds.has(therapist.id);
        if (statusFilter === "present" && absent) return false;
        if (statusFilter === "absent" && !absent) return false;
        if (disciplineFilter !== "all" && therapist.therapyType !== disciplineFilter) return false;
        return !term || therapist.name.toLowerCase().includes(term) || therapist.therapyType.toLowerCase().includes(term);
      })
      .sort((a, b) => {
        const absentDifference = Number(absentIds.has(b.id)) - Number(absentIds.has(a.id));
        return absentDifference || a.name.localeCompare(b.name);
      });
  }, [absentIds, disciplineFilter, search, statusFilter, therapists]);

  const presentCount = therapists.length - absentIds.size;
  const absentSessionCount = sessions.filter((session) => session.therapistId != null && absentIds.has(session.therapistId)).length;
  const mutationPending = callOffMutation.isPending || cancelCallOffMutation.isPending || undoCallOffMutation.isPending;

  const openCallOffConfirmation = (therapist: Therapist) => {
    const affected = sessions.filter((session) => session.therapistId === therapist.id);
    setAbsenceReason("Call-Off");
    setLastResult(null);
    setConfirmCallOff({
      therapistId: therapist.id,
      name: therapist.name,
      sessionCount: affected.length,
      minutes: affected.reduce((total, session) => total + session.durationMinutes, 0),
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => !mutationPending && onOpenChange(nextOpen)}>
        <DialogContent className="flex h-[90vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl xl:max-w-5xl">
          <div className="shrink-0 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-6 py-5 pr-20 text-white">
            <DialogHeader className="text-left">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25"><UserCheck className="h-5 w-5" /></div>
                <div><DialogTitle className="text-xl font-bold tracking-tight text-white">Staff attendance</DialogTitle><DialogDescription className="mt-1 text-sm text-blue-50">Manage attendance and call-off coverage for {format(day, "EEEE, MMMM d, yyyy")}.</DialogDescription></div>
              </div>
            </DialogHeader>
          </div>

          <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-slate-200 bg-white p-4 sm:gap-3 sm:px-6">
            {[
              { label: "Staff", value: therapists.length, icon: Users, color: "text-blue-600" },
              { label: "Present", value: presentCount, icon: ShieldCheck, color: "text-emerald-700" },
              { label: "Absent", value: absentIds.size, icon: UserMinus, color: "text-rose-700" },
            ].map(({ label, value, icon: Icon, color }) => <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center gap-2"><Icon className={`h-4 w-4 ${color}`}/><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span></div><p className="mt-1 text-xl font-extrabold tabular-nums text-slate-950">{absencesQuery.isLoading ? "—" : value}</p></div>)}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
            <div className="flex flex-col gap-2 lg:flex-row">
              <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff or discipline…" className="h-11 border-slate-300 bg-white pl-10 text-sm"/></div>
              <Select value={statusFilter} onValueChange={(value: AttendanceFilter) => setStatusFilter(value)}><SelectTrigger className="h-11 w-full border-slate-300 bg-white lg:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="present">Present</SelectItem><SelectItem value="absent">Absent</SelectItem></SelectContent></Select>
              <Select value={disciplineFilter} onValueChange={setDisciplineFilter}><SelectTrigger className="h-11 w-full border-slate-300 bg-white lg:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All disciplines</SelectItem><SelectItem value="PT">PT</SelectItem><SelectItem value="OT">OT</SelectItem><SelectItem value="SLP">SLP</SelectItem></SelectContent></Select>
            </div>

            {absentSessionCount > 0 && <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700"/><p className="text-sm"><strong>{absentSessionCount} session{absentSessionCount === 1 ? " is" : "s are"} still assigned to absent staff.</strong> Review coverage before finalizing the schedule.</p></div>}

            {lastResult && (
              <div role="status" className={`rounded-xl border p-4 ${lastResult.kind === "absent" && (lastResult.unassigned ?? 0) > 0 ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0"/>
                    <div>
                      <p className="text-sm font-bold">{lastResult.kind === "absent" ? `${lastResult.name} marked absent` : `${lastResult.name} marked present`}</p>
                      <p className="mt-0.5 text-sm opacity-80">{lastResult.kind === "absent" ? `${lastResult.reassigned ?? 0} sessions reassigned; ${lastResult.unassigned ?? 0} remain unassigned.` : "The absence record was removed. Earlier schedule reassignments were not reversed."}</p>
                      {lastResult.details && lastResult.details.length > 0 && <ul className="mt-2 space-y-1 text-sm">{lastResult.details.map((detail, index) => <li key={index}>• {detail}</li>)}</ul>}
                    </div>
                  </div>
                  {lastResult.kind === "absent" && lastResult.undoAuditId && (
                    <Button
                      variant="outline"
                      className="h-10 shrink-0 border-rose-200 bg-white text-rose-800 hover:bg-rose-50"
                      disabled={undoCallOffMutation.isPending}
                      onClick={() => undoCallOffMutation.mutate({ auditId: lastResult.undoAuditId! })}
                    >
                      <RotateCcw className={`mr-2 h-4 w-4 ${undoCallOffMutation.isPending ? "animate-spin" : ""}`} />
                      {undoCallOffMutation.isPending ? "Restoring…" : "Undo call-off"}
                    </Button>
                  )}
                </div>
              </div>
            )}

            <ScrollArea className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
              {absencesQuery.isLoading ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-slate-500"><RefreshCw className="h-7 w-7 animate-spin text-blue-600"/><p className="text-sm">Loading attendance…</p></div>
              : absencesQuery.isError ? <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center"><AlertTriangle className="h-8 w-8 text-rose-700"/><h3 className="mt-3 font-bold text-slate-950">Attendance unavailable</h3><p className="mt-1 text-sm text-slate-600">The attendance record could not be loaded.</p><Button variant="outline" className="mt-4 h-10" onClick={() => absencesQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Retry</Button></div>
              : filteredTherapists.length === 0 ? <div className="flex min-h-52 flex-col items-center justify-center p-6 text-center"><Search className="h-8 w-8 text-slate-300"/><h3 className="mt-3 font-bold text-slate-950">No matching staff</h3><p className="mt-1 text-sm text-slate-600">Try another search or attendance filter.</p></div>
              : <div className="divide-y divide-slate-100">{filteredTherapists.map((therapist) => {
                const absent = absentIds.has(therapist.id);
                const therapistSessions = sessions.filter((session) => session.therapistId === therapist.id);
                const minutes = therapistSessions.reduce((total, session) => total + session.durationMinutes, 0);
                const absence = absences.find((item) => item.therapistId === therapist.id);
                const pendingThisTherapist = mutationPending && (confirmCallOff?.therapistId === therapist.id || confirmPresent?.therapistId === therapist.id);
                const canChangeTherapist = canEdit;
                return <div key={therapist.id} className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center ${absent ? "bg-rose-50/50" : ""}`}><div className="flex min-w-0 flex-1 items-center gap-3"><span className="h-3 w-3 shrink-0 rounded-full ring-4 ring-slate-100" style={{ backgroundColor: therapist.color.startsWith("#") ? therapist.color : `hsl(${therapist.color}, 80%, 45%)` }}/><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-bold text-slate-950">{therapist.name}</p><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${absent ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}>{absent ? "Absent" : "Present"}</span></div><p className="mt-0.5 text-xs text-slate-500">{therapist.therapyType} · {therapistSessions.length} session{therapistSessions.length === 1 ? "" : "s"} · {minutes} minutes{absence?.reason ? ` · ${absence.reason}` : ""}</p></div></div><div className="flex items-center justify-end gap-2 pl-6 sm:pl-0">{canEdit && onViewStats && <Button variant="outline" size="icon" className="h-10 w-10" title={`View ${therapist.name}'s statistics`} onClick={() => onViewStats(therapist.id)}><BarChart3 className="h-4 w-4"/></Button>}<Button variant={absent ? "outline" : "default"} className={`h-10 min-w-32 ${absent ? "border-emerald-200 text-emerald-800 hover:bg-emerald-50" : "bg-rose-700 hover:bg-rose-800"}`} disabled={!canChangeTherapist || mutationPending} onClick={() => absent ? setConfirmPresent({therapistId:therapist.id,name:therapist.name}) : openCallOffConfirmation(therapist)}>{pendingThisTherapist ? <RefreshCw className="mr-2 h-4 w-4 animate-spin"/> : absent ? <UserCheck className="mr-2 h-4 w-4"/> : <UserMinus className="mr-2 h-4 w-4"/>}{absent ? "Mark present" : "Mark absent"}</Button></div></div>;
              })}</div>}
            </ScrollArea>

            {!canEdit && <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">You have view-only access. Staff or admin permission is required to change attendance.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmCallOff} onOpenChange={(nextOpen) => !nextOpen && !callOffMutation.isPending && setConfirmCallOff(null)}>
        <AlertDialogContent className="max-w-lg border-slate-200 bg-white p-0 overflow-hidden">
          <div className="bg-rose-700 px-6 py-5 text-white"><AlertDialogHeader><AlertDialogTitle className="text-xl text-white">Mark {confirmCallOff?.name} absent?</AlertDialogTitle><AlertDialogDescription className="text-rose-100">This starts automatic same-discipline coverage for {format(day, "MMM d")}.</AlertDialogDescription></AlertDialogHeader></div>
          <div className="space-y-4 p-6"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Affected sessions</p><p className="mt-1 text-xl font-extrabold text-slate-950">{confirmCallOff?.sessionCount ?? 0}</p></div><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Scheduled minutes</p><p className="mt-1 text-xl font-extrabold text-slate-950">{confirmCallOff?.minutes ?? 0}</p></div></div><div><label className="text-sm font-bold text-slate-800">Reason</label><Select value={absenceReason} onValueChange={setAbsenceReason}><SelectTrigger className="mt-2 h-11 border-slate-300"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="Call-Off">Call-off</SelectItem><SelectItem value="Illness">Illness</SelectItem><SelectItem value="Emergency">Emergency</SelectItem><SelectItem value="Approved leave">Approved leave</SelectItem></SelectContent></Select></div><div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"/><p className="text-sm">Available therapists of the same discipline will receive sessions when possible. Remaining sessions will become unassigned gaps.</p></div></div>
          <AlertDialogFooter className="border-t border-slate-200 bg-slate-50 px-6 py-4"><AlertDialogCancel className="h-11" disabled={callOffMutation.isPending}>Cancel</AlertDialogCancel><AlertDialogAction className="h-11 bg-rose-700 hover:bg-rose-800" disabled={callOffMutation.isPending} onClick={(event) => { event.preventDefault(); if (confirmCallOff) callOffMutation.mutate({therapistId:confirmCallOff.therapistId,date:day,reason:absenceReason}); }}>{callOffMutation.isPending && <RefreshCw className="mr-2 h-4 w-4 animate-spin"/>}Mark absent and reassign</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmPresent} onOpenChange={(nextOpen) => !nextOpen && !cancelCallOffMutation.isPending && setConfirmPresent(null)}>
        <AlertDialogContent className="border-slate-200 bg-white"><AlertDialogHeader><AlertDialogTitle>Mark {confirmPresent?.name} present?</AlertDialogTitle><AlertDialogDescription>This removes the absence record. Sessions already reassigned to other staff will stay where they are and will not automatically return.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-11" disabled={cancelCallOffMutation.isPending}>Cancel</AlertDialogCancel><AlertDialogAction className="h-11 bg-emerald-700 hover:bg-emerald-800" disabled={cancelCallOffMutation.isPending} onClick={(event) => { event.preventDefault(); if (confirmPresent) cancelCallOffMutation.mutate({therapistId:confirmPresent.therapistId,date:day}); }}>{cancelCallOffMutation.isPending && <RefreshCw className="mr-2 h-4 w-4 animate-spin"/>}Mark present</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </>
  );
}
