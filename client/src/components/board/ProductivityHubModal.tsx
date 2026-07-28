import { useState } from "react";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Therapist } from "../../../../drizzle/schema";
import {
  TrendingUp,
  Award,
  Users,
  Target,
  Clock,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Search,
  Filter,
  BarChart2,
  UserCheck,
  User,
  Loader2,
  Copy,
  Calculator,
  ArrowUpDown,
  ChevronDown,
  Sparkles,
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

export function ProductivityHubModal({
  open,
  onOpenChange,
  therapists,
  date,
  initialTherapistId = null,
  initialViewMode = "admin",
}: ProductivityHubModalProps) {
  const [viewMode, setViewMode] = useState<"admin" | "staff">(initialViewMode);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(
    initialTherapistId ? String(initialTherapistId) : therapists[0]?.id ? String(therapists[0].id) : ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [disciplineFilter, setDisciplineFilter] = useState<string>("all");
  const [showCalculator, setShowCalculator] = useState(false);
  const [calcShiftHours, setCalcShiftHours] = useState<number>(8.0);

  const { data: productivity, isLoading } = trpc.therapists.getProductivity.useQuery(
    { date },
    { enabled: open }
  );

  if (!open) return null;

  const leaderboard = productivity?.leaderboard ?? [];

  // Filtered leaderboard for Admin view
  const filteredLeaderboard = leaderboard.filter((item) => {
    const matchesSearch = item.therapistName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDisc = disciplineFilter === "all" || item.therapyType.toUpperCase() === disciplineFilter.toUpperCase();
    return matchesSearch && matchesDisc;
  });

  // Selected therapist item for Staff view
  const currentStaffId = Number(selectedStaffId);
  const myItem = leaderboard.find((item) => item.therapistId === currentStaffId) ?? leaderboard[0];

  function copyExecutiveSummary() {
    if (!productivity) return;
    const text = `📊 CLINICAL PRODUCTIVITY EXECUTIVE SUMMARY (${format(date, "MMM d, yyyy")})
--------------------------------------------------
Facility Productivity Avg: ${productivity.departmentAverageProductivityRate}% (Target: 81.0%)
Billable Hours Delivered: ${productivity.departmentCapturedBillableHours}h / ${productivity.departmentTargetBillableHours}h target (Variance: ${productivity.departmentVarianceMinutes >= 0 ? "+" : ""}${productivity.departmentVarianceMinutes} mins)
Staff Goal Compliance: ${productivity.exceedingCount} Meeting 81% Goal | ${productivity.nearTargetCount} Near Goal | ${productivity.underTargetCount} Under Goal

Discipline Averages:
- Physical Therapy (PT): ${productivity.disciplineAverages.PT.averageProductivityRate}% (${productivity.disciplineAverages.PT.count} staff)
- Occupational Therapy (OT): ${productivity.disciplineAverages.OT.averageProductivityRate}% (${productivity.disciplineAverages.OT.count} staff)
- Speech Therapy (SLP): ${productivity.disciplineAverages.SLP.averageProductivityRate}% (${productivity.disciplineAverages.SLP.count} staff)
`;
    navigator.clipboard.writeText(text);
    toast.success("Executive summary copied to clipboard!");
  }

  // Calculator math
  const calcTargetMins = Math.round(calcShiftHours * 60 * 0.81 * 10) / 10;
  const calcTargetHrs = Math.round((calcTargetMins / 60) * 100) / 100;
  const calcNonBillableMins = Math.round((calcShiftHours * 60 - calcTargetMins) * 10) / 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={true} className="sm:max-w-4xl glass-panel p-6 rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="mb-4 pb-3.5 border-b border-slate-200/80 text-left">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-sky-100/80 text-sky-700 border border-sky-200/80 shadow-2xs">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                  Therapist Productivity Hub
                  <span className="text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200/80 shadow-2xs">
                    81.0% Benchmark
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 font-semibold mt-0.5">
                  Clinical billable minute tracking & performance metrics for {format(date, "EEEE, MMMM d, yyyy")}.
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-8.5 rounded-xl text-xs font-extrabold text-slate-700 bg-white border-slate-200 shadow-2xs hover:bg-slate-50"
                onClick={copyExecutiveSummary}
                disabled={isLoading || !productivity}
                title="Copy formatted summary to clipboard"
              >
                <Copy className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
                Copy Summary
              </Button>

              {/* View Switcher */}
              <div className="flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setViewMode("admin")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer",
                    viewMode === "admin"
                      ? "bg-white text-slate-900 shadow-2xs border border-slate-200/60"
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <BarChart2 className="h-3.5 w-3.5 text-sky-600" />
                  <span>Admin Analytics</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("staff")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer",
                    viewMode === "staff"
                      ? "bg-white text-slate-900 shadow-2xs border border-slate-200/60"
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <User className="h-3.5 w-3.5 text-sky-600" />
                  <span>Staff Performance</span>
                </button>
              </div>
            </div>
          </div>
        </DialogHeader>

        {isLoading || !productivity ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-sky-600 mb-2" />
            <span className="text-xs font-bold text-slate-600">Calculating 81% clinical productivity rates...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Interactive 81% Target Calculator Bar */}
            <div className="rounded-2xl border border-sky-200/80 bg-sky-50/50 p-3.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-lg bg-sky-100 text-sky-700">
                    <Calculator className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-black uppercase tracking-wider text-slate-800">
                    81.0% Clinical Productivity Equation & Target Calculator
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCalculator((v) => !v)}
                  className="text-xs font-bold text-sky-700 hover:text-sky-800 flex items-center gap-1 cursor-pointer"
                >
                  <span>{showCalculator ? "Hide Calculator" : "Interactive Calculator"}</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showCalculator && "rotate-180")} />
                </button>
              </div>

              {showCalculator ? (
                <div className="mt-3 pt-3 border-t border-sky-200/60 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <label className="text-[11px] font-bold text-slate-500 block mb-1">Shift Length (Hours)</label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        step="0.5"
                        min="1"
                        max="16"
                        value={calcShiftHours}
                        onChange={(e) => setCalcShiftHours(parseFloat(e.target.value) || 8.0)}
                        className="h-8 text-xs font-bold bg-white border-sky-200"
                      />
                      <span className="text-xs font-semibold text-slate-500">hrs</span>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-sky-200/80 space-y-0.5">
                    <span className="text-[10px] font-extrabold uppercase text-slate-400">Total Shift</span>
                    <p className="text-sm font-black text-slate-900 tabular-nums">{calcShiftHours * 60} mins</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-emerald-300/80 space-y-0.5">
                    <span className="text-[10px] font-extrabold uppercase text-emerald-700">81% Target Billable</span>
                    <p className="text-sm font-black text-emerald-900 tabular-nums">{calcTargetMins} mins ({calcTargetHrs}h)</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 space-y-0.5">
                    <span className="text-[10px] font-extrabold uppercase text-slate-400">Admin / Non-Billable</span>
                    <p className="text-sm font-bold text-slate-600 tabular-nums">{calcNonBillableMins} mins</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-600 font-semibold mt-1">
                  Formula: <strong className="font-extrabold text-slate-900">Target Billable Minutes = Shift Hours × 60 × 0.81</strong> (e.g. an 8-hour shift requires <strong className="text-sky-800 font-black">388.8 billable minutes / 6.48 hours</strong>).
                </p>
              )}
            </div>

            {/* ================================================================== */}
            {/* ADMIN ANALYTICS DASHBOARD VIEW                                      */}
            {/* ================================================================== */}
            {viewMode === "admin" && (
              <div className="space-y-4">
                {/* Executive KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-sky-50/90 via-white to-blue-50/70 border border-sky-200/90 text-slate-900 shadow-2xs space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-sky-800 flex items-center gap-1.5">
                      <Target className="h-3.5 w-3.5 text-sky-600" /> Facility Productivity Average
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black tabular-nums tracking-tight text-slate-900">
                        {productivity.departmentAverageProductivityRate}%
                      </span>
                      <span
                        className={cn(
                          "text-xs font-bold px-2.5 py-0.5 rounded-full border",
                          productivity.departmentAverageProductivityRate >= 81.0
                            ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                            : "bg-amber-100 text-amber-900 border-amber-300"
                        )}
                      >
                        {productivity.departmentAverageProductivityRate >= 81.0 ? "🎯 Exceeding Goal" : "🟡 Under 81% Goal"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 font-medium pt-0.5">
                      Benchmark target: <strong className="font-bold text-slate-800">81.0%</strong> across {productivity.totalTherapistsCount} staff members
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-sky-600" /> Total Billable Hours Delivered
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black tabular-nums text-slate-900">
                        {productivity.departmentCapturedBillableHours}h
                      </span>
                      <span className="text-xs font-bold text-slate-400">
                        / {productivity.departmentTargetBillableHours}h target
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 font-semibold pt-0.5">
                      Department Variance:{" "}
                      <strong
                        className={cn(
                          productivity.departmentVarianceMinutes >= 0 ? "text-emerald-700 font-black" : "text-amber-700 font-black"
                        )}
                      >
                        {productivity.departmentVarianceMinutes >= 0 ? "+" : ""}
                        {productivity.departmentVarianceMinutes} mins
                      </strong>
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Goal Compliance Status
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black tabular-nums text-emerald-800">
                        {productivity.exceedingCount}
                      </span>
                      <span className="text-xs font-bold text-slate-500">
                        / {productivity.totalTherapistsCount} Staff Meeting 81%
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 pt-1 text-[11px] font-extrabold flex-wrap">
                      <span className="text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200/70">
                        🎯 {productivity.exceedingCount} Exceeding
                      </span>
                      <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200/70">
                        🟡 {productivity.nearTargetCount} Near Goal
                      </span>
                      <span className="text-rose-800 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-200/70">
                        🚨 {productivity.underTargetCount} Under
                      </span>
                    </div>
                  </div>
                </div>

                {/* Discipline Performance Cards */}
                <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-200/80 space-y-2.5">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                    <BarChart2 className="h-4 w-4 text-sky-600" /> Discipline Average Performance
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-xl bg-white border border-amber-200/80 flex items-center justify-between shadow-2xs">
                      <div>
                        <span className="text-xs font-extrabold text-amber-900 block">Physical Therapy (PT)</span>
                        <p className="text-[10px] text-slate-500 font-semibold">{productivity.disciplineAverages.PT.count} active staff</p>
                      </div>
                      <span className="text-xl font-black text-amber-900 tabular-nums">
                        {productivity.disciplineAverages.PT.averageProductivityRate}%
                      </span>
                    </div>
                    <div className="p-3.5 rounded-xl bg-white border border-purple-200/80 flex items-center justify-between shadow-2xs">
                      <div>
                        <span className="text-xs font-extrabold text-purple-900 block">Occupational Therapy (OT)</span>
                        <p className="text-[10px] text-slate-500 font-semibold">{productivity.disciplineAverages.OT.count} active staff</p>
                      </div>
                      <span className="text-xl font-black text-purple-900 tabular-nums">
                        {productivity.disciplineAverages.OT.averageProductivityRate}%
                      </span>
                    </div>
                    <div className="p-3.5 rounded-xl bg-white border border-sky-200/80 flex items-center justify-between shadow-2xs">
                      <div>
                        <span className="text-xs font-extrabold text-sky-900 block">Speech Therapy (SLP)</span>
                        <p className="text-[10px] text-slate-500 font-semibold">{productivity.disciplineAverages.SLP.count} active staff</p>
                      </div>
                      <span className="text-xl font-black text-sky-900 tabular-nums">
                        {productivity.disciplineAverages.SLP.averageProductivityRate}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Staff Leaderboard Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      <Award className="h-4 w-4 text-emerald-600" /> Facility Staff Productivity Leaderboard
                    </h4>
                    <div className="flex items-center gap-2">
                      <div className="relative w-48">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                        <Input
                          placeholder="Search staff..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="h-8 text-xs pl-8 rounded-xl bg-white border-slate-200 shadow-2xs"
                        />
                      </div>
                      <Select value={disciplineFilter} onValueChange={setDisciplineFilter}>
                        <SelectTrigger className="h-8 text-xs font-extrabold rounded-xl bg-white border-slate-200 w-28 shadow-2xs">
                          <SelectValue placeholder="Discipline" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Staff</SelectItem>
                          <SelectItem value="PT">PT Only</SelectItem>
                          <SelectItem value="OT">OT Only</SelectItem>
                          <SelectItem value="SLP">SLP Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Leaderboard Table */}
                  <div className="border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-2xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/90 border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="py-2.5 px-3">Rank</th>
                          <th className="py-2.5 px-3">Therapist</th>
                          <th className="py-2.5 px-3">Shift Hrs</th>
                          <th className="py-2.5 px-3">81% Target</th>
                          <th className="py-2.5 px-3">Captured Mins</th>
                          <th className="py-2.5 px-3 w-44">Productivity Gauge</th>
                          <th className="py-2.5 px-3">Variance</th>
                          <th className="py-2.5 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                        {filteredLeaderboard.map((item) => (
                          <tr key={item.therapistId} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 px-3">
                              <span
                                className={cn(
                                  "inline-flex items-center justify-center h-6 w-6 rounded-full text-micro font-extrabold tabular-nums border",
                                  item.rank === 1
                                    ? "bg-amber-100 text-amber-900 border-amber-300 shadow-2xs"
                                    : item.rank === 2
                                    ? "bg-slate-200 text-slate-800 border-slate-300"
                                    : item.rank === 3
                                    ? "bg-orange-100 text-orange-800 border-orange-200"
                                    : "bg-slate-100 text-slate-600 border-slate-200"
                                )}
                              >
                                #{item.rank}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <div
                                  className="h-3 w-3 rounded-full shrink-0 shadow-2xs border border-white/40"
                                  style={{ backgroundColor: item.color }}
                                />
                                <div>
                                  <span className="font-extrabold text-slate-900 block truncate">{item.therapistName}</span>
                                  <span className="text-[10px] text-slate-400 font-bold uppercase">
                                    {item.therapyType} {item.isPRN ? "• PRN" : ""}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 tabular-nums font-extrabold text-slate-700">{item.shiftHours}h</td>
                            <td className="py-2.5 px-3 tabular-nums text-slate-600 font-bold">
                              {item.targetBillableMinutes}m <span className="text-slate-400 font-normal">({item.targetBillableHours}h)</span>
                            </td>
                            <td className="py-2.5 px-3 tabular-nums font-black text-slate-900">
                              {item.capturedBillableMinutes}m <span className="text-slate-400 font-normal">({item.capturedBillableHours}h)</span>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[11px] font-black tabular-nums">
                                  <span
                                    className={cn(
                                      item.status === "exceeding"
                                        ? "text-emerald-800"
                                        : item.status === "near_target"
                                        ? "text-amber-800"
                                        : "text-rose-800"
                                    )}
                                  >
                                    {item.productivityRate}%
                                  </span>
                                  <span className="text-[9px] text-slate-400">Target 81%</span>
                                </div>
                                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden relative border border-slate-200/80">
                                  <div
                                    className="absolute top-0 bottom-0 w-0.5 bg-amber-500 z-10"
                                    style={{ left: "81%" }}
                                  />
                                  <div
                                    className={cn(
                                      "h-full rounded-full transition-all",
                                      item.status === "exceeding"
                                        ? "bg-emerald-500"
                                        : item.status === "near_target"
                                        ? "bg-amber-500"
                                        : "bg-rose-500"
                                    )}
                                    style={{ width: `${Math.min(100, item.productivityRate)}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 tabular-nums font-black">
                              <span className={cn(item.billableVarianceMinutes >= 0 ? "text-emerald-700" : "text-rose-700")}>
                                {item.billableVarianceMinutes >= 0 ? "+" : ""}
                                {item.billableVarianceMinutes}m
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={cn(
                                  "text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border flex items-center gap-1 w-fit",
                                  item.status === "exceeding"
                                    ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                                    : item.status === "near_target"
                                    ? "bg-amber-100 text-amber-900 border-amber-300"
                                    : "bg-rose-100 text-rose-900 border-rose-300"
                                )}
                              >
                                {item.status === "exceeding" ? (
                                  <>
                                    <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Exceeding
                                  </>
                                ) : item.status === "near_target" ? (
                                  <>
                                    <AlertTriangle className="h-3 w-3 text-amber-600" /> Near Goal
                                  </>
                                ) : (
                                  <>
                                    <AlertTriangle className="h-3 w-3 text-rose-600" /> Under Target
                                  </>
                                )}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================== */}
            {/* STAFF INDIVIDUAL PERFORMANCE & PEER COMPARISON VIEW                  */}
            {/* ================================================================== */}
            {viewMode === "staff" && (
              <div className="space-y-4">
                {/* Staff Selection Header */}
                <div className="flex items-center justify-between p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200/80 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-sky-600" />
                    <label className="text-xs font-extrabold text-slate-800">Select Therapist for Performance Audit:</label>
                  </div>
                  <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                    <SelectTrigger className="h-9 text-xs font-extrabold rounded-xl bg-white border-slate-200 w-56 shadow-2xs">
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

                {myItem && (
                  <div className="space-y-4">
                    {/* Personal Productivity Gauge Card */}
                    <div className="p-5 rounded-2xl bg-gradient-to-br from-sky-50/90 via-white to-blue-50/70 border border-sky-200/90 text-slate-900 shadow-2xs space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="h-4 w-4 rounded-full shadow-2xs border border-white/40" style={{ backgroundColor: myItem.color }} />
                          <h3 className="text-lg font-black text-slate-900">{myItem.therapistName}</h3>
                          <span className="text-xs font-extrabold bg-sky-100 text-sky-800 px-2.5 py-0.5 rounded-md uppercase border border-sky-200">
                            {myItem.therapyType}
                          </span>
                        </div>

                        <span
                          className={cn(
                            "text-xs font-extrabold uppercase px-3 py-1 rounded-full border flex items-center gap-1.5",
                            myItem.status === "exceeding"
                              ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                              : myItem.status === "near_target"
                              ? "bg-amber-100 text-amber-900 border-amber-300"
                              : "bg-rose-100 text-rose-900 border-rose-300"
                          )}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          {myItem.status === "exceeding"
                            ? "Exceeding 81% Goal"
                            : myItem.status === "near_target"
                            ? "Near 81% Goal"
                            : "Under 81% Goal"}
                        </span>
                      </div>

                      {/* Productivity Rate Gauge Bar */}
                      <div className="space-y-2">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-extrabold text-slate-500">Current Daily Productivity Rate</span>
                          <div className="flex items-baseline gap-1">
                            <span className="text-4xl font-black tracking-tight text-slate-900 tabular-nums">
                              {myItem.productivityRate}%
                            </span>
                            <span className="text-xs font-extrabold text-slate-500">/ 81.0% Goal</span>
                          </div>
                        </div>

                        <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200 relative">
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-amber-500 z-10"
                            style={{ left: "81%" }}
                            title="81% Clinical Target Marker"
                          />
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              myItem.productivityRate >= 81.0
                                ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                                : myItem.productivityRate >= 75.0
                                ? "bg-gradient-to-r from-amber-500 to-yellow-400"
                                : "bg-gradient-to-r from-rose-500 to-red-400"
                            )}
                            style={{ width: `${Math.min(100, myItem.productivityRate)}%` }}
                          />
                        </div>

                        <div className="flex justify-between text-[10px] font-extrabold text-slate-400">
                          <span>0%</span>
                          <span className="text-amber-700 font-black">▲ 81.0% Clinical Benchmark</span>
                          <span>100%</span>
                        </div>
                      </div>
                    </div>

                    {/* Shift Minutes Breakdown Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Shift Duration</span>
                        <p className="text-xl font-black text-slate-900 tabular-nums">{myItem.shiftHours} Hours</p>
                        <p className="text-[11px] text-slate-400 font-semibold">{myItem.shiftMinutes} total shift mins</p>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">81% Billable Goal</span>
                        <p className="text-xl font-black text-amber-900 tabular-nums">{myItem.targetBillableMinutes} Mins</p>
                        <p className="text-[11px] text-amber-700 font-semibold">({myItem.targetBillableHours} hrs billable)</p>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Captured Today</span>
                        <p className="text-xl font-black text-emerald-900 tabular-nums">{myItem.capturedBillableMinutes} Mins</p>
                        <p className="text-[11px] text-emerald-700 font-semibold">({myItem.capturedBillableHours} hrs delivered)</p>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Target Surplus / Deficit</span>
                        <p
                          className={cn(
                            "text-xl font-black tabular-nums",
                            myItem.billableVarianceMinutes >= 0 ? "text-emerald-700" : "text-rose-700"
                          )}
                        >
                          {myItem.billableVarianceMinutes >= 0 ? "+" : ""}
                          {myItem.billableVarianceMinutes} Mins
                        </p>
                        <p className="text-[11px] text-slate-500 font-semibold">
                          {myItem.billableVarianceMinutes >= 0 ? "Goal Met!" : "Needs " + Math.abs(myItem.billableVarianceMinutes) + "m to hit 81%"}
                        </p>
                      </div>
                    </div>

                    {/* Department Peer Comparison Ranking Table */}
                    <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-200/80 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <Award className="h-5 w-5 text-amber-600" />
                          <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                            Department Peer Comparison Ranking
                          </h4>
                        </div>

                        <span className="text-xs font-extrabold text-slate-700 bg-white px-3 py-1 rounded-xl border border-slate-200/80 shadow-2xs">
                          {myItem.therapistName} Ranks <strong className="text-emerald-700 font-black">#{myItem.rank}</strong> of {leaderboard.length} Staff
                        </span>
                      </div>

                      <div className="space-y-2">
                        {leaderboard.map((item) => {
                          const isMe = item.therapistId === myItem.therapistId;
                          return (
                            <div
                              key={item.therapistId}
                              className={cn(
                                "flex items-center justify-between p-2.5 rounded-xl border text-xs transition-all",
                                isMe
                                  ? "bg-sky-50/90 border-sky-300 ring-2 ring-sky-300 ring-offset-1 shadow-2xs"
                                  : "bg-white border-slate-200/70 opacity-90"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  className={cn(
                                    "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-black tabular-nums border",
                                    item.rank === 1
                                      ? "bg-amber-100 text-amber-900 border-amber-300"
                                      : item.rank === 2
                                      ? "bg-slate-200 text-slate-800 border-slate-300"
                                      : item.rank === 3
                                      ? "bg-orange-100 text-orange-800 border-orange-200"
                                      : "bg-slate-100 text-slate-600 border-slate-200"
                                  )}
                                >
                                  #{item.rank}
                                </span>

                                <div className="flex items-center gap-2">
                                  <div className="h-2.5 w-2.5 rounded-full shrink-0 shadow-2xs border border-white/40" style={{ backgroundColor: item.color }} />
                                  <span className="font-extrabold text-slate-900">
                                    {isMe ? `${item.therapistName} (Selected)` : item.therapistName}
                                  </span>
                                  <span className="text-[10px] font-extrabold text-slate-400 uppercase">
                                    {item.therapyType}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="text-slate-500 font-semibold text-[11px] tabular-nums">
                                  {item.capturedBillableMinutes}m captured
                                </span>
                                <span
                                  className={cn(
                                    "font-black px-2 py-0.5 rounded-md text-xs border tabular-nums",
                                    item.status === "exceeding"
                                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                      : item.status === "near_target"
                                      ? "bg-amber-50 text-amber-800 border-amber-200"
                                      : "bg-rose-50 text-rose-800 border-rose-200"
                                  )}
                                >
                                  {item.productivityRate}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
