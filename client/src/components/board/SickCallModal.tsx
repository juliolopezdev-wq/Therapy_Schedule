import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Therapist } from "../../../../drizzle/schema";
import {
  UserMinus,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  BarChart3,
  Clock,
  ChevronUp,
  ChevronDown,
  Sparkles,
  ShieldAlert,
  UserCheck,
  Layers,
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

export function SickCallModal({ open, onOpenChange, therapists, day, onSuccess, onViewStats }: SickCallModalProps) {
  const [selectedTherapistId, setSelectedTherapistId] = useState<string>("");
  const [includePRN, setIncludePRN] = useState<boolean>(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [customPriorityItems, setCustomPriorityItems] = useState<any[]>([]);

  const utils = trpc.useUtils();

  const [results, setResults] = useState<{
    reassignedCount: number;
    unassignedCount: number;
    reassignments: { sessionId: number; patientName: string; oldTherapist: string; newTherapist: string | null; time: string; isPRN?: boolean }[];
  } | null>(null);

  // Fetch priority preview for selected therapist
  const { data: previewData, isLoading: isPreviewLoading } = trpc.aiAgents.previewSickCallTriage.useQuery(
    {
      therapistId: Number(selectedTherapistId),
      date: day,
      includePRN,
    },
    {
      enabled: open && !!selectedTherapistId,
    }
  );

  useEffect(() => {
    if (previewData?.items) {
      setCustomPriorityItems(previewData.items);
    } else {
      setCustomPriorityItems([]);
    }
  }, [previewData]);

  const handleClose = () => {
    onOpenChange(false);
    setResults(null);
    setSelectedTherapistId("");
    setCountdown(null);
    setCustomPriorityItems([]);
  };

  const rebalance = trpc.aiAgents.rebalanceSickCall.useMutation({
    onSuccess: (data) => {
      setResults(data);
      utils.attendance.getAbsences.invalidate();
      utils.sessions.list.invalidate();
      utils.sessions.listForWeek.invalidate();
      utils.weeklyMinutes.summary.invalidate();
      toast.success(`Absence processed: ${data.reassignedCount} sessions reassigned via Priority Ladder.`);
      onSuccess?.();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to rebalance absence");
    },
  });

  useEffect(() => {
    if (!results) {
      setCountdown(null);
      return;
    }

    setCountdown(10);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          handleClose();
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [results]);

  const handleMoveUp = (idx: number) => {
    if (idx <= 0) return;
    setCustomPriorityItems((prev) => {
      const next = [...prev];
      const temp = next[idx - 1];
      next[idx - 1] = next[idx];
      next[idx] = temp;
      return next;
    });
  };

  const handleMoveDown = (idx: number) => {
    if (idx >= customPriorityItems.length - 1) return;
    setCustomPriorityItems((prev) => {
      const next = [...prev];
      const temp = next[idx + 1];
      next[idx + 1] = next[idx];
      next[idx] = temp;
      return next;
    });
  };

  const handleRunRebalance = () => {
    if (!selectedTherapistId) return;
    const customPriorityOrder = customPriorityItems.map((item) => item.sessionId);
    rebalance.mutate({
      therapistId: Number(selectedTherapistId),
      date: day,
      customPriorityOrder,
      includePRN,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-xl glass-panel p-6 rounded-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader className="mb-3">
          <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-slate-800">
            <div className="p-2 rounded-xl bg-rose-100 text-rose-600">
              <UserMinus className="h-5 w-5" />
            </div>
            Sick-Call & Priority Ladder Re-Balancer
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 font-medium">
            Triage staff absences using a clinical Priority Ladder. High-risk CMS compliance patients & Discharge evaluations are prioritized first, regenerating receiving staff schedules smoothly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="space-y-3 p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200/80">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Select Absent Staff Member</label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Select value={selectedTherapistId} onValueChange={setSelectedTherapistId}>
                    <SelectTrigger className="h-10 text-sm font-semibold rounded-xl bg-white border-slate-200 shadow-2xs">
                      <SelectValue placeholder="Choose absent therapist..." />
                    </SelectTrigger>
                    <SelectContent>
                      {therapists.map((t) => (
                        <SelectItem key={t.id} value={t.id.toString()}>
                          {t.name} ({t.therapyType})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedTherapistId && onViewStats && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onViewStats(Number(selectedTherapistId))}
                    className="h-10 rounded-xl px-3 font-semibold text-xs text-sky-600 border-sky-200 hover:bg-sky-50 shrink-0 flex items-center gap-1.5"
                    title="View Staff Statistics"
                  >
                    <BarChart3 className="h-4 w-4" />
                    <span>Stats</span>
                  </Button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
              <div className="flex items-center gap-2">
                <Switch checked={includePRN} onCheckedChange={setIncludePRN} id="prn-toggle" />
                <label htmlFor="prn-toggle" className="text-xs font-bold text-slate-700 cursor-pointer flex items-center gap-1">
                  <span>Include PRN / Per-Diem Staff Pool</span>
                  <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                    PRN Support
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Priority Ladder Preview Queue */}
          {selectedTherapistId && !results ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-sky-600" />
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
                    Call-Off Priority Ladder ({customPriorityItems.length} Sessions)
                  </h4>
                </div>
                <span className="text-[10px] font-semibold text-slate-400">Use arrows to adjust rank</span>
              </div>

              {/* Priority Tier Summary Pills */}
              {previewData && (
                <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                  {previewData.tier1Count > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3 text-rose-600" /> {previewData.tier1Count} Discharge/Eval
                    </span>
                  )}
                  {previewData.tier2Count > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-600" /> {previewData.tier2Count} CMS Deficit
                    </span>
                  )}
                  {previewData.tier3Count > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200">
                      {previewData.tier3Count} Standard
                    </span>
                  )}
                  {previewData.tier4Count > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      {previewData.tier4Count} Routine
                    </span>
                  )}
                </div>
              )}

              {isPreviewLoading ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400 text-xs font-semibold">
                  <RefreshCw className="h-6 w-6 animate-spin text-sky-500 mb-2" />
                  Analyzing clinical priority scores...
                </div>
              ) : customPriorityItems.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs font-semibold bg-slate-50 rounded-2xl border border-slate-100">
                  No scheduled sessions found for this staff member today.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {customPriorityItems.map((item, idx) => (
                    <div
                      key={item.sessionId}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-2xl border text-xs shadow-2xs transition-all",
                        item.tier === 1
                          ? "bg-rose-50/60 border-rose-200/80"
                          : item.tier === 2
                          ? "bg-amber-50/60 border-amber-200/80"
                          : "bg-white border-slate-200/80"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Rank & Reorder Arrows */}
                        <div className="flex flex-col items-center justify-center bg-slate-100 rounded-xl px-1.5 py-1 min-w-[32px]">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveUp(idx)}
                            className="text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                          >
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <span className="text-[10px] font-black text-slate-700 tabular-nums">#{idx + 1}</span>
                          <button
                            type="button"
                            disabled={idx === customPriorityItems.length - 1}
                            onClick={() => handleMoveDown(idx)}
                            className="text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                          >
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-slate-900 text-sm truncate">{item.patientName}</span>
                            <span className="text-micro font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                              RM {item.roomNumber}
                            </span>
                            <span
                              className={cn(
                                "text-[9px] font-black uppercase px-2 py-0.5 rounded-full border",
                                item.tier === 1
                                  ? "bg-rose-100 text-rose-800 border-rose-300"
                                  : item.tier === 2
                                  ? "bg-amber-100 text-amber-800 border-amber-300"
                                  : "bg-sky-100 text-sky-800 border-sky-300"
                              )}
                            >
                              {item.tierLabel.split(":")[0]}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                            {item.reason} ({item.durationMinutes}m)
                          </p>
                        </div>
                      </div>

                      {/* Proposed Placement */}
                      <div className="flex flex-col items-end shrink-0 ml-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Regenerated Shift</span>
                        {item.proposedTherapistName ? (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <ArrowRight className="h-3 w-3 text-slate-400" />
                            <span
                              className={cn(
                                "font-extrabold px-2 py-0.5 rounded-lg text-xs border",
                                item.proposedIsPRN
                                  ? "bg-amber-50 text-amber-800 border-amber-200"
                                  : "bg-emerald-50 text-emerald-800 border-emerald-200"
                              )}
                            >
                              {item.proposedTherapistName} ({item.proposedTimeLabel})
                            </span>
                          </div>
                        ) : (
                          <span className="font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-xs border border-amber-200 mt-0.5">
                            Unassigned
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Rebalance Completion Results */}
          {results ? (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-sky-50 border border-sky-200/80 text-sky-800 text-xs font-bold">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-sky-600 animate-pulse" />
                  <span>Absence triaged via Priority Ladder. Auto-closing in <strong>{countdown ?? 10}s</strong>...</span>
                </div>
                <button onClick={handleClose} className="text-[11px] font-extrabold text-sky-700 hover:text-sky-900 underline cursor-pointer">
                  Close now
                </button>
              </div>

              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Reassigned: <strong className="text-emerald-700">{results.reassignedCount}</strong></span>
                </div>
                {results.unassignedCount > 0 && (
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span>Unassigned: <strong className="text-amber-600">{results.unassignedCount}</strong></span>
                  </div>
                )}
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {results.reassignments.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-100 text-xs shadow-2xs">
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-semibold text-slate-400 tabular-nums">{item.time}</span>
                      <span className="font-extrabold text-slate-700 truncate">{item.patientName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-500 font-medium shrink-0">
                      <span className="line-through text-rose-500">{item.oldTherapist}</span>
                      <ArrowRight className="h-3 w-3 text-slate-400" />
                      {item.newTherapist ? (
                        <span
                          className={cn(
                            "font-bold px-2 py-0.5 rounded border",
                            item.isPRN
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : "bg-emerald-50 text-emerald-800 border-emerald-200"
                          )}
                        >
                          {item.newTherapist} {item.isPRN ? "(PRN)" : ""}
                        </span>
                      ) : (
                        <span className="font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Needs Cover</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Modal Action Footer */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
            {results ? (
              <Button onClick={handleClose} className="bg-sky-600 hover:bg-sky-700 text-white font-extrabold rounded-xl px-6">
                Close ({countdown ?? 10}s)
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={handleClose} className="rounded-xl font-bold">
                  Cancel
                </Button>
                <Button
                  disabled={!selectedTherapistId || rebalance.isPending || customPriorityItems.length === 0}
                  onClick={handleRunRebalance}
                  className="bg-sky-600 hover:bg-sky-700 text-white font-extrabold rounded-xl px-5 shadow-sm flex items-center gap-2"
                >
                  {rebalance.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Regenerating Schedules...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Regenerate & Rebalance Schedule
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
