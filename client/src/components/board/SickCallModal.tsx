import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { usePermissions } from "@/_core/hooks/usePermissions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import type { Therapist } from "../../../../drizzle/schema";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  Clock3,
  History,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  UserMinus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SickCallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  therapists: Therapist[];
  day: Date;
  onSuccess?: () => void;
  onViewStats?: (therapistId: number) => void;
}

interface PriorityItem {
  sessionId: number;
  patientId: number;
  patientName: string;
  roomNumber: string;
  therapyType: string;
  durationMinutes: number;
  originalTimeLabel: string;
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  reason: string;
  proposedTherapistName: string | null;
  proposedIsPRN: boolean;
  proposedTimeLabel: string;
}

interface CoverageResult {
  undoAuditId: number;
  reassignedCount: number;
  unassignedCount: number;
  reassignments: Array<{
    sessionId: number;
    patientName: string;
    oldTherapist: string;
    newTherapist: string | null;
    time: string;
    isPRN?: boolean;
  }>;
}

const tierStyles: Record<number, string> = {
  1: "border-rose-200 bg-rose-50 text-rose-800",
  2: "border-amber-200 bg-amber-50 text-amber-800",
  3: "border-blue-200 bg-blue-50 text-blue-800",
  4: "border-slate-200 bg-slate-100 text-slate-700",
};

export function SickCallModal({ open, onOpenChange, therapists, day, onSuccess, onViewStats }: SickCallModalProps) {
  const { canEdit } = usePermissions();
  const utils = trpc.useUtils();
  const [selectedTherapistId, setSelectedTherapistId] = useState("");
  const [includePRN, setIncludePRN] = useState(true);
  const [customPriorityItems, setCustomPriorityItems] = useState<PriorityItem[]>([]);
  const [confirmApply, setConfirmApply] = useState(false);
  const [results, setResults] = useState<CoverageResult | null>(null);
  const [activeView, setActiveView] = useState<"planner" | "history">("planner");
  const absencesQuery = trpc.attendance.getAbsences.useQuery({ date: day }, { enabled: open, staleTime: 0 });
  const historyQuery = trpc.attendance.callOffHistory.useQuery({ date: day }, { enabled: open, staleTime: 0 });
  const absentTherapistIds = useMemo(
    () => new Set((absencesQuery.data ?? []).map((absence) => absence.therapistId)),
    [absencesQuery.data],
  );
  const availableTherapists = useMemo(
    () => therapists.filter((therapist) => !absentTherapistIds.has(therapist.id)),
    [absentTherapistIds, therapists],
  );

  const selectedTherapist = useMemo(
    () => therapists.find((therapist) => therapist.id === Number(selectedTherapistId)),
    [selectedTherapistId, therapists],
  );

  const previewQuery = trpc.aiAgents.previewSickCallTriage.useQuery(
    { therapistId: Number(selectedTherapistId), date: day, includePRN },
    { enabled: open && !!selectedTherapistId && !results, staleTime: 0 },
  );

  useEffect(() => {
    setCustomPriorityItems((previewQuery.data?.items ?? []) as PriorityItem[]);
  }, [previewQuery.data]);

  useEffect(() => {
    if (!open) return;
    setSelectedTherapistId("");
    setIncludePRN(true);
    setCustomPriorityItems([]);
    setConfirmApply(false);
    setResults(null);
    setActiveView("planner");
  }, [open, day]);

  const refreshBoardData = () => {
    void utils.attendance.getAbsences.invalidate();
    void utils.attendance.assignmentHistory.invalidate();
    void utils.attendance.callOffHistory.invalidate();
    void utils.sessions.list.invalidate();
    void utils.sessions.listForDateRange.invalidate();
    void utils.weeklyMinutes.summary.invalidate();
    void utils.therapists.getStats.invalidate();
    void utils.therapists.getProductivity.invalidate();
    void utils.aiAgents.getComplianceReport.invalidate();
    void utils.aiAgents.getPredictiveForecast.invalidate();
    void utils.forecast.invalidate();
  };

  const rebalance = trpc.aiAgents.rebalanceSickCall.useMutation({
    onSuccess: (data) => {
      setResults(data);
      setConfirmApply(false);
      refreshBoardData();
      toast.success(`${data.reassignedCount} session${data.reassignedCount === 1 ? "" : "s"} reassigned`);
      onSuccess?.();
    },
    onError: (error) => {
      setConfirmApply(false);
      toast.error(error.message || "Could not apply sick-call coverage");
    },
  });

  const undoCallOff = trpc.attendance.undoCallOff.useMutation({
    onSuccess: (data) => {
      refreshBoardData();
      setResults(null);
      setSelectedTherapistId("");
      setCustomPriorityItems([]);
      toast.success(`Call-off undone; ${data.restoredCount} session${data.restoredCount === 1 ? "" : "s"} restored`);
      onSuccess?.();
    },
    onError: (error) => toast.error(error.message || "Could not undo the call-off"),
  });

  const totalMinutes = customPriorityItems.reduce((sum, item) => sum + item.durationMinutes, 0);
  const projectedCovered = customPriorityItems.filter((item) => item.proposedTherapistName).length;
  const projectedUnassigned = customPriorityItems.length - projectedCovered;
  const projectedPRN = customPriorityItems.filter((item) => item.proposedIsPRN).length;

  const resetSelection = (therapistId: string) => {
    setSelectedTherapistId(therapistId);
    setCustomPriorityItems([]);
    setConfirmApply(false);
    setResults(null);
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= customPriorityItems.length) return;
    setCustomPriorityItems((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const applyCoverage = () => {
    if (!selectedTherapistId) return;
    rebalance.mutate({
      therapistId: Number(selectedTherapistId),
      date: day,
      includePRN,
      customPriorityOrder: customPriorityItems.map((item) => item.sessionId),
    });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (rebalance.isPending || undoCallOff.isPending) return;
    onOpenChange(nextOpen);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex h-[90vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl xl:max-w-6xl">
          <div className="shrink-0 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-5 py-5 pr-20 text-white sm:px-6">
            <DialogHeader className="text-left">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                  <UserMinus className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold tracking-tight text-white">Manage sick-call coverage</DialogTitle>
                  <DialogDescription className="mt-1 text-sm text-blue-50">
                    Preview and prioritize coverage for {format(day, "EEEE, MMMM d, yyyy")} before changing the board.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="flex shrink-0 gap-1 border-b border-slate-200 bg-white px-4 py-2 sm:px-6" role="tablist" aria-label="Sick-call views">
            <Button
              type="button"
              variant="ghost"
              className={cn("h-9 px-3 text-sm", activeView === "planner" ? "bg-blue-50 font-bold text-blue-800" : "text-slate-600")}
              onClick={() => setActiveView("planner")}
              role="tab"
              aria-selected={activeView === "planner"}
            >
              <Sparkles className="mr-2 h-4 w-4" />Coverage planner
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={cn("h-9 px-3 text-sm", activeView === "history" ? "bg-blue-50 font-bold text-blue-800" : "text-slate-600")}
              onClick={() => setActiveView("history")}
              role="tab"
              aria-selected={activeView === "history"}
            >
              <History className="mr-2 h-4 w-4" />Change history
              {(historyQuery.data?.length ?? 0) > 0 && <span className="ml-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-black text-blue-800">{historyQuery.data?.length}</span>}
            </Button>
          </div>

          {activeView === "history" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-bold text-slate-950">Coverage changes for {format(day, "MMMM d, yyyy")}</h3>
                  <p className="mt-1 text-sm text-slate-600">Review every call-off reassignment and safely reverse changes that have not been edited since.</p>
                </div>
                <Button variant="outline" className="h-10 shrink-0" disabled={historyQuery.isFetching} onClick={() => historyQuery.refetch()}>
                  <RefreshCw className={cn("mr-2 h-4 w-4", historyQuery.isFetching && "animate-spin")} />Refresh
                </Button>
              </div>

              <ScrollArea className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
                {historyQuery.isLoading ? (
                  <div className="flex min-h-64 flex-col items-center justify-center text-slate-500"><RefreshCw className="h-7 w-7 animate-spin text-blue-600"/><p className="mt-3 text-sm">Loading change history…</p></div>
                ) : historyQuery.isError ? (
                  <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center"><AlertTriangle className="h-8 w-8 text-rose-700"/><h3 className="mt-3 font-bold text-slate-950">History unavailable</h3><p className="mt-1 text-sm text-slate-600">{historyQuery.error.message}</p></div>
                ) : (historyQuery.data?.length ?? 0) === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center"><History className="h-9 w-9 text-slate-300"/><h3 className="mt-3 font-bold text-slate-950">No call-off changes</h3><p className="mt-1 text-sm text-slate-600">Coverage actions for this date will appear here.</p></div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {historyQuery.data?.map((entry) => (
                      <article key={entry.auditId} className="p-4 sm:p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="font-bold text-slate-950">{entry.therapistName}</h4>
                              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">{entry.reason}</span>
                              {entry.undone && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700">Undone</span>}
                            </div>
                            <p className="mt-1 text-xs text-slate-500">Changed {format(new Date(entry.createdAt), "MMM d 'at' h:mm a")}{entry.actorEmail ? ` by ${entry.actorEmail}` : ""}</p>
                            <p className="mt-1 text-sm text-slate-700"><strong>{entry.reassignedCount}</strong> reassigned · <strong>{entry.unassignedCount}</strong> unassigned</p>
                          </div>
                          <Button
                            variant="outline"
                            className="h-10 shrink-0 border-rose-200 text-rose-800 hover:bg-rose-50"
                            disabled={!entry.canUndo || undoCallOff.isPending}
                            onClick={() => undoCallOff.mutate({ auditId: entry.auditId })}
                          >
                            <RotateCcw className={cn("mr-2 h-4 w-4", undoCallOff.isPending && "animate-spin")} />
                            {entry.undone ? "Already undone" : "Undo changes"}
                          </Button>
                        </div>
                        {entry.undoUnavailableReason && !entry.undone && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{entry.undoUnavailableReason}</p>}
                        {entry.changes.length > 0 && (
                          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                            {entry.changes.map((change) => (
                              <div key={change.sessionId} className="grid gap-1 border-b border-slate-100 px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{change.patientName}{change.roomNumber ? ` · Room ${change.roomNumber}` : ""}</p><p className="text-xs text-slate-500">{format(new Date(change.assignedStartTime), "h:mm a")}</p></div>
                                <p className="text-xs text-slate-600"><span className="line-through">{change.previousTherapistName}</span><ArrowRight className="mx-1.5 inline h-3.5 w-3.5 text-slate-400"/><strong className={change.assignedTherapistName === "Unassigned" ? "text-rose-700" : "text-slate-900"}>{change.assignedTherapistName}</strong></p>
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </ScrollArea>

              <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                <p className="text-xs leading-relaxed"><strong>Safe undo:</strong> Use Undo before manually changing the reassigned sessions. If the button becomes unavailable, review those sessions individually so newer schedule decisions are preserved.</p>
              </div>
            </div>
          ) : !results ? (
            <>
              <div className="grid shrink-0 gap-3 border-b border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6">
                <div>
                  <label className="text-sm font-bold text-slate-800" htmlFor="sick-call-staff">Absent staff member</label>
                  <div className="mt-2 flex gap-2">
                    <Select value={selectedTherapistId} onValueChange={resetSelection} disabled={rebalance.isPending}>
                      <SelectTrigger id="sick-call-staff" className="h-11 min-w-0 flex-1 border-slate-300 bg-white text-sm">
                        <SelectValue placeholder="Select a staff member…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTherapists.map((therapist) => (
                          <SelectItem key={therapist.id} value={String(therapist.id)}>
                            {therapist.name} · {therapist.therapyType}
                          </SelectItem>
                        ))}
                        {availableTherapists.length === 0 && <SelectItem value="no-staff" disabled>No available staff</SelectItem>}
                      </SelectContent>
                    </Select>
                    {selectedTherapist && onViewStats && (
                      <Button variant="outline" className="h-11 shrink-0 border-slate-300" onClick={() => onViewStats(selectedTherapist.id)}>
                        <BarChart3 className="mr-2 h-4 w-4" />
                        <span className="hidden sm:inline">View stats</span>
                        <span className="sm:hidden">Stats</span>
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 sm:self-end">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Include PRN staff</p>
                    <p className="text-xs text-slate-500">Use per-diem coverage when needed</p>
                  </div>
                  <Switch id="include-prn" checked={includePRN} onCheckedChange={setIncludePRN} disabled={!selectedTherapistId || rebalance.isPending} />
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
                {!selectedTherapistId ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                    <Users className="h-10 w-10 text-blue-600" />
                    <h3 className="mt-4 text-lg font-bold text-slate-950">Select the staff member who called out</h3>
                    <p className="mt-1 max-w-md text-sm text-slate-600">You’ll see every affected session, clinical priority, and proposed receiving therapist before anything changes.</p>
                  </div>
                ) : previewQuery.isLoading || previewQuery.isFetching ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600">
                    <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
                    <p className="mt-3 text-sm font-semibold">Building the coverage preview…</p>
                  </div>
                ) : previewQuery.isError ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-rose-200 bg-white p-8 text-center">
                    <AlertTriangle className="h-9 w-9 text-rose-700" />
                    <h3 className="mt-3 font-bold text-slate-950">Coverage preview unavailable</h3>
                    <p className="mt-1 text-sm text-slate-600">{previewQuery.error.message || "The schedule could not be analyzed."}</p>
                    <Button variant="outline" className="mt-4 h-10" onClick={() => previewQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
                  </div>
                ) : customPriorityItems.length === 0 ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
                    <CheckCircle2 className="h-9 w-9 text-emerald-700" />
                    <h3 className="mt-3 font-bold text-emerald-950">No scheduled sessions are affected</h3>
                    <p className="mt-1 text-sm text-emerald-800">There is nothing to reassign for this staff member on {format(day, "MMM d")}.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                      {[
                        { label: "Affected", value: customPriorityItems.length, note: `${totalMinutes} minutes`, color: "text-slate-950" },
                        { label: "Covered", value: projectedCovered, note: "in this preview", color: "text-emerald-700" },
                        { label: "Needs coverage", value: projectedUnassigned, note: "will be unassigned", color: projectedUnassigned ? "text-rose-700" : "text-emerald-700" },
                        { label: "PRN used", value: projectedPRN, note: includePRN ? "per-diem sessions" : "PRN excluded", color: "text-amber-700" },
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{stat.label}</p>
                          <p className={cn("mt-1 text-xl font-extrabold tabular-nums", stat.color)}>{stat.value}</p>
                          <p className="text-xs text-slate-500">{stat.note}</p>
                        </div>
                      ))}
                    </div>

                    {projectedUnassigned > 0 && (
                      <div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-950">
                        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
                        <p className="text-sm"><strong>{projectedUnassigned} session{projectedUnassigned === 1 ? " has" : "s have"} no coverage.</strong> Applying this plan will leave {projectedUnassigned === 1 ? "it" : "them"} unassigned for manual follow-up.</p>
                      </div>
                    )}

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-sm font-bold text-slate-950">Coverage priority</h3>
                          <p className="text-xs text-slate-500">Highest-priority patients are processed first. Use the arrow buttons to adjust the order.</p>
                        </div>
                        <p className="text-xs font-semibold text-slate-500">Preview only — no changes applied</p>
                      </div>
                      <ScrollArea className="min-h-0 flex-1">
                        <div className="divide-y divide-slate-100">
                          {customPriorityItems.map((item, index) => (
                            <div key={item.sessionId} className="grid gap-3 p-4 lg:grid-cols-[auto_minmax(0,1fr)_minmax(190px,auto)] lg:items-center">
                              <div className="flex items-center gap-1">
                                <span className="mr-1 w-7 text-center text-sm font-extrabold tabular-nums text-slate-500">{index + 1}</span>
                                <Button type="button" variant="outline" size="icon" className="h-10 w-10" disabled={index === 0 || !canEdit} onClick={() => moveItem(index, -1)} aria-label={`Move ${item.patientName} up`}><ArrowUp className="h-4 w-4" /></Button>
                                <Button type="button" variant="outline" size="icon" className="h-10 w-10" disabled={index === customPriorityItems.length - 1 || !canEdit} onClick={() => moveItem(index, 1)} aria-label={`Move ${item.patientName} down`}><ArrowDown className="h-4 w-4" /></Button>
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-bold text-slate-950">{item.patientName}</p>
                                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">Room {item.roomNumber}</span>
                                  <span className={cn("rounded-full border px-2 py-0.5 text-xs font-bold", tierStyles[item.tier])}>Tier {item.tier}</span>
                                </div>
                                <p className="mt-1 text-xs text-slate-600">{item.reason}</p>
                                <p className="mt-1 text-xs text-slate-500">{item.originalTimeLabel} · {item.durationMinutes} min · {item.therapyType}</p>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Proposed coverage</p>
                                {item.proposedTherapistName ? (
                                  <div className="mt-1 flex items-center gap-2 text-sm">
                                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                                    <span className="font-bold text-slate-900">{item.proposedTherapistName}</span>
                                    {item.proposedIsPRN && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">PRN</span>}
                                    <span className="ml-auto text-xs font-semibold text-slate-500">{item.proposedTimeLabel}</span>
                                  </div>
                                ) : (
                                  <p className="mt-1 text-sm font-bold text-rose-700">Unassigned — manual coverage needed</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  </>
                )}
              </div>

              <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>{!canEdit && <p className="text-sm text-slate-600">View-only access. Staff or admin permission is required to apply coverage.</p>}</div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" className="h-11" onClick={() => handleOpenChange(false)}>Close</Button>
                  <Button className="h-11 bg-blue-700 px-5 hover:bg-blue-800" disabled={!canEdit || !selectedTherapistId || customPriorityItems.length === 0 || previewQuery.isFetching || previewQuery.isError} onClick={() => setConfirmApply(true)}>
                    <Sparkles className="mr-2 h-4 w-4" />Review and apply coverage
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
              <div role="status" className={cn("rounded-2xl border p-5", results.unassignedCount > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50")}>
                <div className="flex gap-3">
                  {results.unassignedCount > 0 ? <AlertTriangle className="h-6 w-6 shrink-0 text-amber-700" /> : <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-700" />}
                  <div>
                    <h3 className="font-bold text-slate-950">Sick-call coverage applied for {selectedTherapist?.name}</h3>
                    <p className="mt-1 text-sm text-slate-700">The absence was recorded. {results.reassignedCount} session{results.reassignedCount === 1 ? " was" : "s were"} reassigned and {results.unassignedCount} remain unassigned.</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Reassigned</p><p className="mt-1 text-2xl font-extrabold text-emerald-700">{results.reassignedCount}</p></div>
                <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Still unassigned</p><p className={cn("mt-1 text-2xl font-extrabold", results.unassignedCount ? "text-rose-700" : "text-emerald-700")}>{results.unassignedCount}</p></div>
              </div>

              <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-bold text-slate-950">Applied changes</h3><p className="text-xs text-slate-500">These results stay visible until you close this window.</p></div>
                <ScrollArea className="min-h-0 flex-1">
                  {results.reassignments.length === 0 ? (
                    <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center"><CheckCircle2 className="h-8 w-8 text-emerald-700"/><p className="mt-3 text-sm font-bold text-slate-950">No schedule changes were needed</p></div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {results.reassignments.map((item) => (
                        <div key={item.sessionId} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center">
                          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-950">{item.patientName}</p><p className="mt-0.5 text-xs text-slate-500"><Clock3 className="mr-1 inline h-3.5 w-3.5" />{item.time}</p></div>
                          <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 line-through">{item.oldTherapist}</span><ArrowRight className="h-4 w-4 text-slate-400"/>{item.newTherapist ? <span className="font-bold text-slate-900">{item.newTherapist}{item.isPRN ? " (PRN)" : ""}</span> : <span className="font-bold text-rose-700">Unassigned</span>}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>

              {results.unassignedCount > 0 && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950"><strong>Follow-up required:</strong> Return to the board and assign the remaining uncovered sessions.</p>}

              <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-xl text-xs text-slate-500">Undo removes the absence and restores the original therapist and time for every session in this coverage action.</p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    className="h-11 border-rose-200 text-rose-800 hover:bg-rose-50"
                    disabled={undoCallOff.isPending}
                    onClick={() => undoCallOff.mutate({ auditId: results.undoAuditId })}
                  >
                    <RotateCcw className={cn("mr-2 h-4 w-4", undoCallOff.isPending && "animate-spin")} />
                    {undoCallOff.isPending ? "Restoring…" : "Undo call-off"}
                  </Button>
                  <Button className="h-11 bg-blue-700 px-6 hover:bg-blue-800" disabled={undoCallOff.isPending} onClick={() => handleOpenChange(false)}>Close</Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmApply} onOpenChange={(nextOpen) => !rebalance.isPending && setConfirmApply(nextOpen)}>
        <AlertDialogContent className="max-w-lg overflow-hidden border-slate-200 bg-white p-0">
          <div className="bg-blue-800 px-6 py-5 text-white">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-xl text-white">Apply sick-call coverage?</AlertDialogTitle>
              <AlertDialogDescription className="text-blue-100">This records {selectedTherapist?.name} as absent and updates the live schedule for {format(day, "MMM d")}.</AlertDialogDescription>
            </AlertDialogHeader>
          </div>
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Affected</p><p className="mt-1 text-xl font-extrabold text-slate-950">{customPriorityItems.length}</p></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Covered</p><p className="mt-1 text-xl font-extrabold text-emerald-700">{projectedCovered}</p></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Unassigned</p><p className={cn("mt-1 text-xl font-extrabold", projectedUnassigned ? "text-rose-700" : "text-emerald-700")}>{projectedUnassigned}</p></div>
            </div>
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"/><p className="text-sm">This action changes therapist assignments and may move session times. It does not automatically notify staff or patients.</p></div>
          </div>
          <AlertDialogFooter className="border-t border-slate-200 bg-slate-50 px-6 py-4">
            <AlertDialogCancel className="h-11" disabled={rebalance.isPending}>Keep reviewing</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-blue-700 hover:bg-blue-800" disabled={rebalance.isPending} onClick={(event) => { event.preventDefault(); applyCoverage(); }}>
              {rebalance.isPending && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
              {rebalance.isPending ? "Applying coverage…" : "Record absence and apply"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
