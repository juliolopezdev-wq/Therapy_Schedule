import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ShieldAlert, AlertTriangle, CheckCircle2, ArrowUpRight, Zap } from "lucide-react";
import { toast } from "sonner";

interface ComplianceSentinelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date;
  onFixPatient?: (patientId: number) => void;
}

export function ComplianceSentinelModal({ open, onOpenChange, day, onFixPatient }: ComplianceSentinelModalProps) {
  const { data: report, isLoading, refetch } = trpc.aiAgents.getComplianceReport.useQuery({ referenceDate: day });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg glass-panel p-6 rounded-2xl">
        <DialogHeader className="mb-4">
          <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-slate-800">
            <div className="p-2 rounded-xl bg-amber-100 text-amber-600">
              <ShieldAlert className="h-5 w-5" />
            </div>
            Real-Time Compliance & Risk Sentinel
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 font-medium">
            Monitors CMS 15-Hour Weekly thresholds, 3-Hour daily targets, and missing Exit Evaluations prior to discharge.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-8 text-sm text-slate-400">
            <div className="h-6 w-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mb-2" />
            Analyzing compliance metrics...
          </div>
        ) : report ? (
          <div className="space-y-4">
            {/* Score & Summary Banner */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-sm">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Compliance Score</div>
                <div className="text-2xl font-black text-emerald-400 tabular-nums">{report.complianceScore}%</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-slate-300">Total Risks Identified</div>
                <div className="text-sm font-black text-amber-400 tabular-nums">{report.totalRisks} ({report.criticalCount} Critical)</div>
              </div>
            </div>

            {/* Risk Items List */}
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {report.riskItems.length === 0 ? (
                <div className="flex items-center gap-2 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  <span>All active patients are 100% compliant with CMS rules and discharge evaluations!</span>
                </div>
              ) : (
                report.riskItems.map((item, idx) => (
                  <div key={idx} className="flex flex-col gap-2 p-3 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-slate-800 text-sm">{item.patientName}</span>
                        <span className="text-micro font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">RM {item.roomNumber}</span>
                      </div>
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${item.severity === "critical" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                        {item.severity}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 font-medium">{item.message}</p>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                      <span className="text-slate-400 font-medium italic">{item.actionNeeded}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-xs font-bold text-sky-700 hover:bg-sky-50 rounded-lg"
                        onClick={() => {
                          onOpenChange(false);
                          onFixPatient?.(item.patientId);
                        }}
                      >
                        Fix Now <Zap className="ml-1 h-3 w-3 text-sky-600" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl font-bold">Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
