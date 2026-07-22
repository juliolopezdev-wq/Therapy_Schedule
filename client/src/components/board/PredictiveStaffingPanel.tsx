import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { TrendingUp, Users, Calendar, AlertCircle } from "lucide-react";

interface PredictiveStaffingPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date;
}

export function PredictiveStaffingPanel({ open, onOpenChange, day }: PredictiveStaffingPanelProps) {
  const { data: forecast, isLoading } = trpc.aiAgents.getPredictiveForecast.useQuery({ date: day });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg glass-panel p-6 rounded-2xl">
        <DialogHeader className="mb-4">
          <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-slate-800">
            <div className="p-2 rounded-xl bg-sky-100 text-sky-600">
              <TrendingUp className="h-5 w-5" />
            </div>
            Predictive Staffing & Capacity Planner
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 font-medium">
            AI-driven demand forecasting for admissions, staff call-off risk, and PRN buffer recommendation for {forecast?.dayOfWeek ?? "today"}.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-8 text-sm text-slate-400">
            <div className="h-6 w-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-2" />
            Generating capacity forecast...
          </div>
        ) : forecast ? (
          <div className="space-y-4">
            {/* Forecast Grid */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Expected Missed Rate</div>
                <div className="text-lg font-black text-slate-800 mt-1 tabular-nums">
                  {(forecast.expectedMissedRate * 100).toFixed(1)}%
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Projected Evals</div>
                <div className="text-lg font-black text-slate-800 mt-1 tabular-nums">
                  ~{forecast.expectedAdmissions.toFixed(1)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-900">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-sky-600">PRN Buffer Min</div>
                <div className="text-lg font-black text-sky-700 mt-1 tabular-nums">
                  +{forecast.suggestedBufferMinutes}m
                </div>
              </div>
            </div>

            {/* Top Available Staff */}
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Staff Capacity Breakdown</div>
              <div className="space-y-1.5">
                {forecast.topAvailableTherapists.map((staff) => (
                  <div key={staff.id} className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200/70 text-xs shadow-2xs">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-slate-400" />
                      <span className="font-bold text-slate-800">{staff.name}</span>
                    </div>
                    <span className="font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md tabular-nums">
                      {staff.availableMinutes}m free
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl font-bold">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
