import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  Scale,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { SECTION_GG_ITEMS } from "@shared/sectionGG";
import { PatientChartModal } from "./PatientChartModal";

interface GGComplianceCenterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ITEM_LABEL: Record<string, string> = Object.fromEntries(SECTION_GG_ITEMS.map((i) => [i.code, i.label]));

const chartConfig = {
  admissionAvg: { label: "Admission avg", color: "hsl(217, 91%, 60%)" },
  dischargeAvg: { label: "Discharge avg", color: "hsl(160, 84%, 39%)" },
};

export function GGComplianceCenter({ open, onOpenChange }: GGComplianceCenterProps) {
  const [tab, setTab] = useState<"completeness" | "trends" | "consistency">("completeness");
  const [chartPatientId, setChartPatientId] = useState<{ id: number; name: string; roomNumber: string } | null>(null);

  const completenessQuery = trpc.charting.ggCompleteness.useQuery(undefined, { enabled: open, staleTime: 0 });
  const trendQuery = trpc.charting.ggTrend.useQuery(undefined, { enabled: open && tab === "trends" });
  const consistencyQuery = trpc.charting.ggScoringConsistency.useQuery(undefined, { enabled: open && tab === "consistency" });

  const flaggedItems = useMemo(
    () => (completenessQuery.data?.items ?? []).filter((item) => item.flag != null),
    [completenessQuery.data],
  );
  const criticalCount = flaggedItems.filter((item) => item.severity === "critical").length;

  const trendChartData = useMemo(
    () => (trendQuery.data ?? []).map((point) => ({
      label: `${point.month}${point.therapyType ? ` · ${point.therapyType}` : ""}`,
      admissionAvg: point.admissionAvg,
      dischargeAvg: point.dischargeAvg,
      changeAvg: point.changeAvg,
      patientCount: point.patientCount,
    })),
    [trendQuery.data],
  );
  const overallChange = useMemo(() => {
    const points = trendQuery.data ?? [];
    if (points.length === 0) return null;
    const totalWeighted = points.reduce((sum, p) => sum + p.changeAvg * p.patientCount, 0);
    const totalCount = points.reduce((sum, p) => sum + p.patientCount, 0);
    return totalCount > 0 ? Math.round((totalWeighted / totalCount) * 10) / 10 : null;
  }, [trendQuery.data]);

  const FLAG_META: Record<string, { label: string; icon: typeof ShieldAlert }> = {
    missing_admission: { label: "Admission assessment needs review", icon: ShieldAlert },
    discharge_due_soon: { label: "Discharge GG due", icon: AlertTriangle },
    missing_discharge: { label: "Discharge assessment needs review", icon: ShieldAlert },
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[90vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl xl:max-w-5xl">
          <div className="shrink-0 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-5 py-5 pr-20 text-white sm:px-6">
            <DialogHeader className="text-left">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                  <ClipboardCheck className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold tracking-tight text-white">IRF assessment tracking</DialogTitle>
                  <DialogDescription className="mt-1 text-sm text-blue-50">
                    Review completeness, signatures, and reference-score trends. This is not CMS submission or quality-measure reporting.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <p className="border-b bg-amber-50 px-5 py-3 text-xs text-amber-900">A completed record needs all reference items, a signature, and a verified assessment window. Legacy discharges without an actual discharge date remain unverified. <a className="underline" target="_blank" rel="noreferrer" href="https://www.cms.gov/medicare/quality/inpatient-rehabilitation-facility/irf-pai-and-irf-qrp-manual">CMS IRF-PAI manual</a></p>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-slate-200 bg-white px-4 pt-3 sm:px-6">
              <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
                <TabsTrigger value="completeness" className="gap-1.5"><ShieldAlert className="h-3.5 w-3.5" /> Completeness</TabsTrigger>
                <TabsTrigger value="trends" className="gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Trends</TabsTrigger>
                <TabsTrigger value="consistency" className="gap-1.5"><Scale className="h-3.5 w-3.5" /> Scoring consistency</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="completeness" className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
              {completenessQuery.isLoading ? (
                <div className="flex flex-1 items-center justify-center"><RefreshCw className="h-8 w-8 animate-spin text-blue-600" /></div>
              ) : completenessQuery.data ? (
                <>
                  <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-2">
                    <div className={cn("rounded-xl border p-3", completenessQuery.data.admissionCompletionRate >= 100 ? "border-emerald-200 bg-emerald-50" : completenessQuery.data.admissionCompletionRate >= 90 ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50")}>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Admission GG completion</p>
                      <p className={cn("mt-1 text-3xl font-extrabold tabular-nums", completenessQuery.data.admissionCompletionRate >= 100 ? "text-emerald-700" : completenessQuery.data.admissionCompletionRate >= 90 ? "text-amber-700" : "text-rose-700")}>{completenessQuery.data.admissionCompletionRate}%</p>
                      <p className="text-xs text-slate-500">of patients past their assessment window</p>
                    </div>
                    <div className={cn("rounded-xl border p-3", completenessQuery.data.dischargeCompletionRate >= 100 ? "border-emerald-200 bg-emerald-50" : completenessQuery.data.dischargeCompletionRate >= 90 ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50")}>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Discharge GG completion</p>
                      <p className={cn("mt-1 text-3xl font-extrabold tabular-nums", completenessQuery.data.dischargeCompletionRate >= 100 ? "text-emerald-700" : completenessQuery.data.dischargeCompletionRate >= 90 ? "text-amber-700" : "text-rose-700")}>{completenessQuery.data.dischargeCompletionRate}%</p>
                      <p className="text-xs text-slate-500">of discharged/discharging patients</p>
                    </div>
                  </div>

                  <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                    <p className="text-sm">CMS requires GG on a minimum share of admissions/discharges to avoid a payment-rate penalty. {criticalCount > 0 ? <strong>{criticalCount} patient{criticalCount === 1 ? "" : "s"} need{criticalCount === 1 ? "s" : ""} immediate attention.</strong> : "Nothing is overdue right now."}</p>
                  </div>

                  <ScrollArea className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
                    {flaggedItems.length === 0 ? (
                      <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100"><CheckCircle2 className="h-7 w-7 text-emerald-700" /></div>
                        <h3 className="mt-4 text-lg font-bold text-slate-950">Nothing flagged</h3>
                        <p className="mt-1 max-w-md text-sm text-slate-600">No records exceed the review thresholds shown here. Check missing items, signatures, and assessment windows before official reporting.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {flaggedItems.map((item) => {
                          const meta = FLAG_META[item.flag!] ?? { label: item.flag!, icon: ShieldAlert };
                          const Icon = meta.icon;
                          return (
                            <div key={item.patientId} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
                              <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", item.severity === "critical" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700")}><Icon className="h-5 w-5" /></div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="truncate text-sm font-bold text-slate-950">{item.patientName}</h3>
                                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">Room {item.roomNumber}</span>
                                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", item.severity === "critical" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800")}>{item.severity === "critical" ? "Critical" : "Warning"}</span>
                                </div>
                                <p className="mt-1.5 text-sm font-semibold text-slate-900">{meta.label}</p>
                                <p className="mt-1 text-xs text-slate-600">Admission: {item.admissionStatus} · Discharge: {item.dischargeStatus}</p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {item.daysSinceAdmission != null && `Day ${item.daysSinceAdmission + 1} of stay`}
                                  {item.daysUntilDischarge != null && item.daysUntilDischarge >= 0 && ` · discharge in ${item.daysUntilDischarge}d`}
                                  {item.daysUntilDischarge != null && item.daysUntilDischarge < 0 && ` · estimated discharge date passed ${Math.abs(item.daysUntilDischarge)}d ago`}
                                </p>
                              </div>
                              <Button variant="outline" className="h-11 border-blue-200 text-blue-800 hover:bg-blue-50" onClick={() => setChartPatientId({ id: item.patientId, name: item.patientName, roomNumber: item.roomNumber })}>
                                Review chart <ArrowUpRight className="ml-2 h-4 w-4" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </>
              ) : null}
            </TabsContent>

            <TabsContent value="trends" className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
              {trendQuery.isLoading ? (
                <div className="flex flex-1 items-center justify-center"><RefreshCw className="h-8 w-8 animate-spin text-blue-600" /></div>
              ) : trendChartData.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <TrendingUp className="h-10 w-10 text-slate-300" />
                  <h3 className="mt-3 font-bold text-slate-900">Not enough data yet</h3>
                  <p className="mt-1 max-w-md text-sm text-slate-600">Once patients have both an admission and discharge Section GG on file, their functional-improvement trend will show up here.</p>
                </div>
              ) : (
                <>
                  {overallChange != null && (
                    <div className={cn("rounded-xl border p-3", overallChange >= 0 ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50")}>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Internal reference-score change, admission → discharge</p>
                      <p className={cn("mt-1 text-3xl font-extrabold tabular-nums", overallChange >= 0 ? "text-emerald-700" : "text-rose-700")}>{overallChange >= 0 ? "+" : ""}{overallChange}</p>
                      <p className="text-xs text-slate-500">Internal unadjusted reference totals only. Excludes unsigned, incomplete, or non-performance-coded pairs; not the CMS discharge function score.</p>
                    </div>
                  )}
                  <div className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <ChartContainer config={chartConfig} className="h-full w-full">
                      <BarChart data={trendChartData}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="admissionAvg" fill="var(--color-admissionAvg)" radius={4} />
                        <Bar dataKey="dischargeAvg" fill="var(--color-dischargeAvg)" radius={4} />
                      </BarChart>
                    </ChartContainer>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="consistency" className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
              <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
                <Scale className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                <p className="text-sm"><strong>Calibration aid, not a verdict:</strong> a flag means a therapist's average on this item differs notably from the facility average -- worth a calibration conversation, not necessarily an error.</p>
              </div>
              {consistencyQuery.isLoading ? (
                <div className="flex flex-1 items-center justify-center"><RefreshCw className="h-8 w-8 animate-spin text-blue-600" /></div>
              ) : (consistencyQuery.data ?? []).length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-300" />
                  <h3 className="mt-3 font-bold text-slate-900">No scoring outliers</h3>
                  <p className="mt-1 max-w-md text-sm text-slate-600">No review signals at the current threshold, or insufficient signed data. This does not establish scoring accuracy.</p>
                </div>
              ) : (
                <ScrollArea className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="divide-y divide-slate-100">
                    {(consistencyQuery.data ?? []).map((flag) => (
                      <div key={`${flag.therapistId}-${flag.itemCode}`} className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900">{flag.therapistName}</p>
                          <p className="text-xs text-slate-500">{ITEM_LABEL[flag.itemCode] ?? flag.itemCode} · {flag.sampleSize} scored</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold tabular-nums text-slate-900">{flag.therapistAvg} <span className="font-normal text-slate-400">vs {flag.facilityAvg} facility</span></p>
                          <p className={cn("text-xs font-bold", flag.deviation > 0 ? "text-blue-700" : "text-amber-700")}>{flag.deviation > 0 ? "+" : ""}{flag.deviation} ({flag.deviation > 0 ? "scores higher" : "scores lower"})</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {chartPatientId && (
        <PatientChartModal
          open={chartPatientId != null}
          onOpenChange={(next) => { if (!next) setChartPatientId(null); }}
          patient={{ id: chartPatientId.id, name: chartPatientId.name, roomNumber: chartPatientId.roomNumber, accessLevel: "full" }}
          sessions={[]}
        />
      )}
    </>
  );
}
