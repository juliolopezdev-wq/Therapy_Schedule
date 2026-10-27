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
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  Search,
  ShieldAlert,
  TimerReset,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ComplianceSentinelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date;
  onFixPatient?: (patientId: number) => void;
}

type RiskFilter = "all" | "critical" | "minutes" | "evaluation";

const RISK_TYPE_META: Record<string, { icon: typeof TimerReset; label: string }> = {
  cms_15hr_shortfall: { icon: TimerReset, label: "Weekly minutes" },
  exit_eval_missing: { icon: CalendarClock, label: "Evaluation review" },
};

export function ComplianceSentinelModal({ open, onOpenChange, day, onFixPatient }: ComplianceSentinelModalProps) {
  const [filter, setFilter] = useState<RiskFilter>("all");
  const [search, setSearch] = useState("");
  const reportQuery = trpc.aiAgents.getComplianceReport.useQuery(
    { referenceDate: day },
    { enabled: open, staleTime: 0 },
  );

  useEffect(() => {
    if (!open) return;
    setFilter("all");
    setSearch("");
  }, [open, day]);

  const report = reportQuery.data;
  const warningCount = report?.riskItems.filter((risk) => risk.severity === "warning").length ?? 0;
  const minuteRiskCount = report?.riskItems.filter((risk) => risk.riskType === "cms_15hr_shortfall").length ?? 0;
  const evaluationRiskCount = report?.riskItems.filter((risk) => risk.riskType === "exit_eval_missing").length ?? 0;

  const filteredRisks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (report?.riskItems ?? []).filter((risk) => {
      if (filter === "critical" && risk.severity !== "critical") return false;
      if (filter === "minutes" && risk.riskType !== "cms_15hr_shortfall") return false;
      if (filter === "evaluation" && risk.riskType !== "exit_eval_missing") return false;
      return !term || risk.patientName.toLowerCase().includes(term) || risk.roomNumber.toLowerCase().includes(term);
    });
  }, [filter, report?.riskItems, search]);

  const openPatient = (patientId: number) => {
    onOpenChange(false);
    onFixPatient?.(patientId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl xl:max-w-6xl">
        <div className="shrink-0 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-5 py-5 pr-20 text-white sm:px-6">
          <DialogHeader className="text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight text-white">IRF planning review</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-blue-50">
                  Review weekly-minute and discharge-evaluation flags for {format(day, "EEEE, MMMM d, yyyy")}.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {reportQuery.isLoading || reportQuery.isFetching && !report ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white text-slate-600">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
            <p className="mt-3 text-sm font-semibold">Reviewing patient schedules…</p>
          </div>
        ) : reportQuery.isError ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-rose-700" />
            <h3 className="mt-4 text-lg font-bold text-slate-950">IRF planning review unavailable</h3>
            <p className="mt-1 max-w-md text-sm text-slate-600">
              The current compliance report could not be calculated. Retry now, or review the selected date and patient admission information if the problem continues.
            </p>
            <Button variant="outline" className="mt-5 h-11" onClick={() => reportQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
          </div>
        ) : report ? (
          <>
            <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-200 bg-white p-4 sm:px-6 lg:grid-cols-4">
              <button type="button" onClick={() => setFilter("all")} className={cn("rounded-xl border p-3 text-left transition-colors", filter === "all" ? "border-blue-400 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 bg-white hover:bg-slate-50")}>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Without flags</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-blue-700">{report.complianceScore}%</p>
                <p className="text-xs text-slate-500">of active patients</p>
              </button>
              <button type="button" onClick={() => setFilter("critical")} className={cn("rounded-xl border p-3 text-left transition-colors", filter === "critical" ? "border-rose-400 bg-rose-50 ring-2 ring-rose-100" : "border-slate-200 bg-white hover:bg-slate-50")}>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Critical</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-rose-700">{report.criticalCount}</p>
                <p className="text-xs text-slate-500">needs prompt review</p>
              </button>
              <button type="button" onClick={() => setFilter("minutes")} className={cn("rounded-xl border p-3 text-left transition-colors", filter === "minutes" ? "border-amber-400 bg-amber-50 ring-2 ring-amber-100" : "border-slate-200 bg-white hover:bg-slate-50")}>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Minute risks</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-amber-700">{minuteRiskCount}</p>
                <p className="text-xs text-slate-500">weekly targets</p>
              </button>
              <button type="button" onClick={() => setFilter("evaluation")} className={cn("rounded-xl border p-3 text-left transition-colors", filter === "evaluation" ? "border-violet-400 bg-violet-50 ring-2 ring-violet-100" : "border-slate-200 bg-white hover:bg-slate-50")}>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Eval review</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-violet-700">{evaluationRiskCount}</p>
                <p className="text-xs text-slate-500">near discharge</p>
              </button>

            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient or room…" className="h-11 border-slate-300 bg-white pl-10 text-sm" />
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-slate-500 lg:justify-end">
                  <span>{report.totalRisks} total flag{report.totalRisks === 1 ? "" : "s"} · {warningCount} warning{warningCount === 1 ? "" : "s"}</span>
                  <Button variant="outline" size="sm" className="h-10 bg-white" disabled={reportQuery.isFetching} onClick={() => reportQuery.refetch()}>
                    <RefreshCw className={cn("mr-2 h-4 w-4", reportQuery.isFetching && "animate-spin")} />Refresh
                  </Button>
                </div>
              </div>

              <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                <p className="text-sm"><strong>Planning aid:</strong> Flags are calculated from schedule and patient records. Confirm documentation and payer-specific requirements before making clinical or compliance decisions.</p>
              </div>

              <ScrollArea className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
                {report.riskItems.length === 0 ? (
                  <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100"><CheckCircle2 className="h-7 w-7 text-emerald-700" /></div>
                    <h3 className="mt-4 text-lg font-bold text-slate-950">No risks flagged</h3>
                    <p className="mt-1 max-w-md text-sm text-slate-600">No weekly-minute shortfalls or near-discharge evaluation flags were found for active patients.</p>
                  </div>
                ) : filteredRisks.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
                    <Search className="h-9 w-9 text-slate-300" />
                    <h3 className="mt-3 font-bold text-slate-950">No matching flags</h3>
                    <p className="mt-1 text-sm text-slate-600">Try a different summary card or search.</p>
                    <Button variant="outline" className="mt-4 h-10" onClick={() => { setFilter("all"); setSearch(""); }}>Clear filters</Button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredRisks.map((risk) => {
                      const meta = RISK_TYPE_META[risk.riskType] ?? { icon: AlertTriangle, label: risk.riskType };
                      const RiskIcon = meta.icon;
                      return (
                        <div key={`${risk.patientId}-${risk.riskType}`} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
                          <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", risk.severity === "critical" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700")}><RiskIcon className="h-5 w-5" /></div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-bold text-slate-950">{risk.patientName}</h3>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">Room {risk.roomNumber}</span>
                              <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", risk.severity === "critical" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800")}>{risk.severity === "critical" ? "Priority" : "Warning"}</span>
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">{meta.label}</span>
                            </div>
                            <p className="mt-2 text-sm text-slate-700">{risk.message}</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">Recommended: {risk.actionNeeded}</p>
                          </div>
                          <Button variant="outline" className="h-11 border-blue-200 text-blue-800 hover:bg-blue-50" onClick={() => openPatient(risk.patientId)}>
                            Open on board <ArrowUpRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-xs text-slate-500">“Without flags” is not a certification of compliance; it reflects only the checks shown here.</p>
              <Button className="h-11 bg-blue-700 px-6 hover:bg-blue-800" onClick={() => onOpenChange(false)}>Close review</Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
