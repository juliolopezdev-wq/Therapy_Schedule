import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { toast } from "sonner";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Therapist } from "../../../../drizzle/schema";
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  CheckCircle2,
  Clock3,
  Copy,
  RefreshCw,
  Search,
  Target,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductivityHubModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  therapists: Therapist[];
  date: Date;
  initialTherapistId?: number | null;
  initialViewMode?: "admin" | "staff";
}

type ViewMode = "admin" | "staff";
type StatusFilter = "all" | "exceeding" | "near_target" | "under_target";
type SortOption = "rate" | "variance" | "name";
type ProductivityItem = inferRouterOutputs<AppRouter>["therapists"]["getProductivity"]["leaderboard"][number];

const statusLabel = {
  exceeding: "At or above target",
  near_target: "Near target",
  under_target: "Below target",
} as const;

export function ProductivityHubModal({
  open,
  onOpenChange,
  therapists,
  date,
  initialTherapistId = null,
  initialViewMode = "admin",
}: ProductivityHubModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [selectedStaffId, setSelectedStaffId] = useState(initialTherapistId ? String(initialTherapistId) : "");
  const [search, setSearch] = useState("");
  const [discipline, setDiscipline] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortOption>("rate");
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [shiftHours, setShiftHours] = useState(8);

  const productivityQuery = trpc.therapists.getProductivity.useQuery(
    { date },
    { enabled: open, staleTime: 0 },
  );
  const productivity = productivityQuery.data;
  const leaderboard = productivity?.leaderboard ?? [];

  useEffect(() => {
    if (!open) return;
    setViewMode(initialViewMode);
    setSelectedStaffId(initialTherapistId ? String(initialTherapistId) : "");
    setSearch("");
    setDiscipline("all");
    setStatus("all");
    setSort("rate");
    setCalculatorOpen(false);
  }, [date, initialTherapistId, initialViewMode, open]);

  useEffect(() => {
    if (open && !selectedStaffId && leaderboard[0]) setSelectedStaffId(String(leaderboard[0].therapistId));
  }, [leaderboard, open, selectedStaffId]);

  const filteredLeaderboard = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leaderboard
      .filter((item) => {
        if (discipline !== "all" && item.therapyType !== discipline) return false;
        if (status !== "all" && item.status !== status) return false;
        return !term || item.therapistName.toLowerCase().includes(term) || item.teamName?.toLowerCase().includes(term);
      })
      .sort((a, b) => {
        if (sort === "name") return a.therapistName.localeCompare(b.therapistName);
        if (sort === "variance") return b.billableVarianceMinutes - a.billableVarianceMinutes;
        return b.productivityRate - a.productivityRate;
      });
  }, [discipline, leaderboard, search, sort, status]);

  const selectedItem = leaderboard.find((item) => item.therapistId === Number(selectedStaffId));
  const selectedTherapist = therapists.find((therapist) => therapist.id === Number(selectedStaffId));
  const isFinal = productivity?.reportingState === "final";
  const isFuture = productivity?.reportingState === "future";

  const grossMinutes = shiftHours * 60;
  const mealMinutes = grossMinutes >= 360 ? 30 : 0;
  const availableMinutes = Math.max(0, grossMinutes - mealMinutes);
  const targetMinutes = Math.round(availableMinutes * 0.81);

  const copySummary = async () => {
    if (!productivity) return;
    const timing = productivity.reportingState === "final" ? "Final" : productivity.reportingState === "future" ? "Future date" : "In progress";
    const text = [
      `Productivity summary — ${format(date, "MMMM d, yyyy")} (${timing})`,
      `Completed productivity: ${productivity.departmentAverageProductivityRate}%`,
      `Projected productivity: ${productivity.departmentProjectedProductivityRate}%`,
      `Completed billable hours: ${productivity.departmentCapturedBillableHours}`,
      `Planned billable hours: ${productivity.departmentPlannedBillableHours}`,
      `Target billable hours: ${productivity.departmentTargetBillableHours}`,
      `Working staff: ${productivity.totalTherapistsCount}; absent: ${productivity.absentTherapistsCount}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Productivity summary copied");
    } catch {
      toast.error("Could not copy the summary");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl xl:max-w-6xl">
        <div className="shrink-0 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-5 py-5 pr-20 text-white sm:px-6">
          <DialogHeader className="text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25"><TrendingUp className="h-5 w-5" /></div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight text-white">Productivity</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-blue-50">Review completed and planned billable minutes for {format(date, "EEEE, MMMM d, yyyy")}.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {productivityQuery.isLoading || productivityQuery.isFetching && !productivity ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white text-slate-600"><RefreshCw className="h-8 w-8 animate-spin text-blue-600"/><p className="mt-3 text-sm font-semibold">Calculating productivity…</p></div>
        ) : productivityQuery.isError ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white p-8 text-center"><AlertTriangle className="h-10 w-10 text-rose-700"/><h3 className="mt-4 text-lg font-bold text-slate-950">Productivity unavailable</h3><p className="mt-1 max-w-md text-sm text-slate-600">{productivityQuery.error.message || "Productivity data could not be loaded."}</p><Button variant="outline" className="mt-5 h-11" onClick={() => productivityQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Retry</Button></div>
        ) : productivity ? (
          <>
            <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1">
                <button type="button" onClick={() => setViewMode("admin")} className={cn("flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-bold", viewMode === "admin" ? "bg-white text-blue-800 shadow-sm" : "text-slate-600")}><BarChart3 className="h-4 w-4"/>Department</button>
                <button type="button" onClick={() => setViewMode("staff")} className={cn("flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-bold", viewMode === "staff" ? "bg-white text-blue-800 shadow-sm" : "text-slate-600")}><UserRound className="h-4 w-4"/>Staff detail</button>
              </div>
              <div className="flex gap-2"><Button variant="outline" className="h-10" disabled={productivityQuery.isFetching} onClick={() => productivityQuery.refetch()}><RefreshCw className={cn("mr-2 h-4 w-4", productivityQuery.isFetching && "animate-spin")}/>Refresh</Button><Button variant="outline" className="h-10" onClick={copySummary}><Copy className="mr-2 h-4 w-4"/>Copy summary</Button></div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
              <div className={cn("flex gap-3 rounded-xl border p-3", isFuture ? "border-blue-200 bg-blue-50 text-blue-950" : isFinal ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950")}>
                {isFinal ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0"/> : <Clock3 className="mt-0.5 h-5 w-5 shrink-0"/>}
                <p className="text-sm"><strong>{isFuture ? "Future-date plan:" : isFinal ? "Final daily result:" : "Day in progress:"}</strong> {isFuture ? "Completed productivity is not available yet. Planned minutes are shown as a projection." : isFinal ? "Completed treatment minutes are compared with each working staff member’s available shift." : "Completed productivity will increase as sessions are documented. Planned minutes are shown separately."}</p>
              </div>

              {viewMode === "admin" ? (
                <>
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Completed rate</p><p className="mt-1 text-2xl font-extrabold text-blue-700">{productivity.departmentAverageProductivityRate}%</p><p className="text-xs text-slate-500">{productivity.departmentCapturedBillableHours} billable hours</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Projected rate</p><p className="mt-1 text-2xl font-extrabold text-violet-700">{productivity.departmentProjectedProductivityRate}%</p><p className="text-xs text-slate-500">{productivity.departmentPlannedBillableHours} planned hours</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Daily target</p><p className="mt-1 text-2xl font-extrabold text-slate-950">{productivity.departmentTargetBillableHours}h</p><p className="text-xs text-slate-500">81% of available shifts</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Working staff</p><p className="mt-1 text-2xl font-extrabold text-slate-950">{productivity.totalTherapistsCount}</p><p className="text-xs text-slate-500">{productivity.absentTherapistsCount} absent excluded</p></div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    {(["PT", "OT", "SLP"] as const).map((therapyType) => {
                      const item = productivity.disciplineAverages[therapyType];
                      return <button key={therapyType} type="button" onClick={() => setDiscipline(discipline === therapyType ? "all" : therapyType)} className={cn("rounded-xl border bg-white p-3 text-left", discipline === therapyType ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200")}><div className="flex items-center justify-between"><span className="text-sm font-extrabold text-slate-950">{therapyType}</span><span className="text-xs text-slate-500">{item.count} staff</span></div><p className="mt-1 text-xl font-extrabold text-blue-700">{item.averageProductivityRate}% <span className="text-xs font-semibold text-slate-500">completed</span></p></button>;
                    })}
                  </div>

                  <div className="flex flex-col gap-2 lg:flex-row">
                    <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff or team…" className="h-11 border-slate-300 bg-white pl-10"/></div>
                    <Select value={status} onValueChange={(value: StatusFilter) => setStatus(value)}><SelectTrigger className="h-11 w-full border-slate-300 bg-white lg:w-44"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="exceeding">At or above target</SelectItem><SelectItem value="near_target">Near target</SelectItem><SelectItem value="under_target">Below target</SelectItem></SelectContent></Select>
                    <Select value={sort} onValueChange={(value: SortOption) => setSort(value)}><SelectTrigger className="h-11 w-full border-slate-300 bg-white lg:w-44"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="rate">Highest rate</SelectItem><SelectItem value="variance">Best variance</SelectItem><SelectItem value="name">Staff name</SelectItem></SelectContent></Select>
                  </div>

                  <ScrollArea className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
                    {leaderboard.length === 0 ? <EmptyState title="No productivity records" message="No active, present staff are scheduled to work on this date." />
                    : filteredLeaderboard.length === 0 ? <EmptyState title="No matching staff" message="Try another search or filter." action={() => { setSearch(""); setDiscipline("all"); setStatus("all"); }} />
                    : <div className="divide-y divide-slate-100">{filteredLeaderboard.map((item) => <ProductivityRow key={item.therapistId} item={item} showFinalStatus={isFinal} onOpen={() => { setSelectedStaffId(String(item.therapistId)); setViewMode("staff"); }}/>)}</div>}
                  </ScrollArea>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div><label className="text-sm font-bold text-slate-900">Staff member</label><p className="text-xs text-slate-500">Only staff scheduled and present on this date have results.</p></div><Select value={selectedItem ? selectedStaffId : ""} onValueChange={setSelectedStaffId}><SelectTrigger className="h-11 w-full border-slate-300 sm:w-72"><SelectValue placeholder="Select staff…"/></SelectTrigger><SelectContent>{leaderboard.map((item) => <SelectItem key={item.therapistId} value={String(item.therapistId)}>{item.therapistName} · {item.therapyType}</SelectItem>)}</SelectContent></Select></div>

                  {!selectedItem ? (
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center"><UserRound className="h-10 w-10 text-slate-300"/><h3 className="mt-4 font-bold text-slate-950">No result for {selectedTherapist?.name ?? "this staff member"}</h3><p className="mt-1 max-w-md text-sm text-slate-600">They may be absent, archived, or not scheduled to work on this date. Select another staff member to continue.</p></div>
                  ) : (
                    <ScrollArea className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="space-y-5 p-5 sm:p-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-extrabold text-slate-950">{selectedItem.therapistName}</h3><span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-800">{selectedItem.therapyType}</span>{selectedItem.isPRN && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">PRN</span>}</div><p className="mt-1 text-sm text-slate-500">{selectedItem.teamName ?? "No team assigned"} · {selectedItem.shiftHours} available hours</p></div>{isFinal && <span className={cn("w-fit rounded-full px-3 py-1 text-xs font-bold", selectedItem.status === "exceeding" ? "bg-emerald-100 text-emerald-800" : selectedItem.status === "near_target" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800")}>{statusLabel[selectedItem.status]}</span>}</div>
                        <div><div className="flex items-end justify-between"><p className="text-sm font-bold text-slate-700">Completed productivity</p><p className="text-3xl font-extrabold text-slate-950">{selectedItem.productivityRate}%</p></div><div className="relative mt-2 h-3 overflow-hidden rounded-full bg-slate-100"><div className="absolute inset-y-0 z-10 w-0.5 bg-slate-900" style={{ left: "81%" }}/><div className={cn("h-full rounded-full", selectedItem.productivityRate >= 81 ? "bg-emerald-500" : selectedItem.productivityRate >= 75 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${Math.min(100, selectedItem.productivityRate)}%` }}/></div><div className="mt-1 flex justify-between text-xs text-slate-500"><span>0%</span><span>81% target</span><span>100%</span></div></div>
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Available shift" value={`${selectedItem.shiftMinutes}m`} note={`${selectedItem.shiftHours} hours`}/><Metric label="81% target" value={`${selectedItem.targetBillableMinutes}m`} note={`${selectedItem.targetBillableHours} hours`}/><Metric label="Completed" value={`${selectedItem.capturedBillableMinutes}m`} note={`${selectedItem.completedSessionCount} completed sessions`} tone="emerald"/><Metric label="Planned" value={`${selectedItem.plannedBillableMinutes}m`} note={`${selectedItem.projectedProductivityRate}% projected`} tone="violet"/></div>
                        <div className={cn("rounded-xl border p-4", selectedItem.billableVarianceMinutes >= 0 ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}><p className="text-sm font-bold text-slate-950">Completed variance: {selectedItem.billableVarianceMinutes >= 0 ? "+" : ""}{selectedItem.billableVarianceMinutes} minutes</p><p className="mt-1 text-sm text-slate-700">{isFinal ? selectedItem.billableVarianceMinutes >= 0 ? "The documented completed minutes met the daily benchmark." : `${Math.abs(selectedItem.billableVarianceMinutes)} additional completed minutes would have been needed to reach the benchmark.` : "This is not final until the workday ends and completed sessions are documented."}</p></div>
                      </div>
                    </ScrollArea>
                  )}
                </>
              )}

              <details open={calculatorOpen} onToggle={(event) => setCalculatorOpen(event.currentTarget.open)} className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-slate-900"><Calculator className="h-4 w-4 text-blue-700"/>81% target calculator</summary>
                {calculatorOpen && <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-4"><div><label className="text-sm font-bold text-slate-700">Shift hours</label><Input type="number" min="1" max="16" step="0.5" value={shiftHours} onChange={(event) => setShiftHours(Math.min(16, Math.max(1, Number(event.target.value) || 8)))} className="mt-2 h-11"/></div><Metric label="Meal deduction" value={`${mealMinutes}m`} note="for shifts of 6+ hours"/><Metric label="Available shift" value={`${availableMinutes}m`} note="after meal deduction"/><Metric label="81% target" value={`${targetMinutes}m`} note={`${(targetMinutes / 60).toFixed(2)} billable hours`} tone="emerald"/></div>}
              </details>
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="text-xs text-slate-500">Completed rates use documented completed treatment only; scheduled sessions appear only in projections.</p><Button className="h-11 bg-blue-700 px-6 hover:bg-blue-800" onClick={() => onOpenChange(false)}>Close productivity</Button></div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value, note, tone = "slate" }: { label: string; value: string; note: string; tone?: "slate" | "emerald" | "violet" }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className={cn("mt-1 text-xl font-extrabold", tone === "emerald" ? "text-emerald-700" : tone === "violet" ? "text-violet-700" : "text-slate-950")}>{value}</p><p className="text-xs text-slate-500">{note}</p></div>;
}

function EmptyState({ title, message, action }: { title: string; message: string; action?: () => void }) {
  return <div className="flex min-h-52 flex-col items-center justify-center p-8 text-center"><Users className="h-9 w-9 text-slate-300"/><h3 className="mt-3 font-bold text-slate-950">{title}</h3><p className="mt-1 text-sm text-slate-600">{message}</p>{action && <Button variant="outline" className="mt-4 h-10" onClick={action}>Clear filters</Button>}</div>;
}

function ProductivityRow({ item, showFinalStatus, onOpen }: { item: ProductivityItem; showFinalStatus: boolean; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="grid w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 lg:grid-cols-[minmax(180px,1fr)_minmax(220px,1.4fr)_repeat(3,auto)] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-bold text-slate-950">{item.therapistName}</p><span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-800">{item.therapyType}</span>{item.isPRN && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">PRN</span>}</div><p className="mt-1 text-xs text-slate-500">{item.teamName ?? "No team"} · {item.shiftHours}h shift</p></div><div><div className="mb-1 flex justify-between text-xs"><span className="font-semibold text-slate-600">{item.productivityRate}% completed</span><span className="text-slate-500">81% target</span></div><div className="relative h-2 overflow-hidden rounded-full bg-slate-100"><div className="absolute inset-y-0 z-10 w-0.5 bg-slate-800" style={{ left: "81%" }}/><div className={cn("h-full rounded-full", item.productivityRate >= 81 ? "bg-emerald-500" : item.productivityRate >= 75 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${Math.min(100, item.productivityRate)}%` }}/></div></div><div><p className="text-sm font-extrabold text-slate-950">{item.capturedBillableMinutes}m</p><p className="text-xs text-slate-500">completed</p></div><div><p className="text-sm font-extrabold text-violet-700">{item.plannedBillableMinutes}m</p><p className="text-xs text-slate-500">planned</p></div><div className="lg:text-right">{showFinalStatus ? <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", item.status === "exceeding" ? "bg-emerald-100 text-emerald-800" : item.status === "near_target" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800")}>{statusLabel[item.status]}</span> : <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-800">Tracking</span>}</div></button>;
}
