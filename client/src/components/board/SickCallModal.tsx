import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Therapist } from "../../../../drizzle/schema";
import { UserMinus, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface SickCallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  therapists: Therapist[];
  day: Date;
  onSuccess?: () => void;
}

export function SickCallModal({ open, onOpenChange, therapists, day, onSuccess }: SickCallModalProps) {
  const [selectedTherapistId, setSelectedTherapistId] = useState<string>("");
  const [results, setResults] = useState<{
    reassignedCount: number;
    unassignedCount: number;
    reassignments: { sessionId: number; patientName: string; oldTherapist: string; newTherapist: string | null; time: string }[];
  } | null>(null);

  const rebalance = trpc.aiAgents.rebalanceSickCall.useMutation({
    onSuccess: (data) => {
      setResults(data);
      toast.success(`Absence processed: ${data.reassignedCount} sessions reassigned.`);
      onSuccess?.();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to rebalance absence");
    },
  });

  const handleRunRebalance = () => {
    if (!selectedTherapistId) return;
    rebalance.mutate({
      therapistId: Number(selectedTherapistId),
      date: day,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg glass-panel p-6 rounded-2xl">
        <DialogHeader className="mb-4">
          <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-slate-800">
            <div className="p-2 rounded-xl bg-rose-100 text-rose-600">
              <UserMinus className="h-5 w-5" />
            </div>
            Sick-Call & Absence Emergency Re-Balancer
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 font-medium">
            Select a staff member calling in sick or absent today. The AI Agent will automatically triage and reassign their scheduled sessions to available team members without double-booking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Select Absent Staff Member</label>
            <Select value={selectedTherapistId} onValueChange={setSelectedTherapistId}>
              <SelectTrigger className="h-10 text-sm font-semibold rounded-xl bg-white border-slate-200">
                <SelectValue placeholder="Choose therapist..." />
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

          {results ? (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
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
                  <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-100 text-xs shadow-2xs">
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-semibold text-slate-400 tabular-nums">{item.time}</span>
                      <span className="font-extrabold text-slate-700 truncate">{item.patientName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-500 font-medium shrink-0">
                      <span className="line-through text-rose-500">{item.oldTherapist}</span>
                      <ArrowRight className="h-3 w-3 text-slate-400" />
                      {item.newTherapist ? (
                        <span className="font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{item.newTherapist}</span>
                      ) : (
                        <span className="font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Needs Cover</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              disabled={!selectedTherapistId || rebalance.isPending}
              onClick={handleRunRebalance}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl"
            >
              {rebalance.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Re-balancing...
                </>
              ) : (
                "Re-balance Absence"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
