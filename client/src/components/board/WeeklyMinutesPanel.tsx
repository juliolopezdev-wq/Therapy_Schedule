import { useMemo, useState } from "react";
import { usePermissions } from "@/_core/hooks/usePermissions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeeklyMinutesSummary } from "../../../../shared/weekUtils";

interface WeeklyMinutesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referenceDate: Date;
}

type StatusFilter = "all" | "risk" | "needs" | "covered" | "completed";

function fmtHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes} min`;
  if (remainingMinutes === 0) return `${hours} hr`;
  return `${hours} hr ${remainingMinutes} min`;
}

function fmtWhen(value: Date | string) {
  return new Date(value).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SuggestionRow({
  patientId,
  referenceDate,
  suggestion,
}: {
  patientId: number;
  referenceDate: Date;
  suggestion: {
    startTime: Date | string;
    durationMinutes: number;
    therapistId: number | null;
    therapistName: string | null;
    therapistTherapyType: "PT" | "OT" | "SLP";
    reason: string;
  };
}) {
  const { canEdit } = usePermissions();
  const utils = trpc.useUtils();
  const [added, setAdded] = useState(false);
  const start = new Date(suggestion.startTime);
  const end = new Date(start.getTime() + suggestion.durationMinutes * 60_000);

  const createSession = trpc.sessions.create.useMutation({
    onSuccess: () => {
      setAdded(true);
      void utils.sessions.list.invalidate();
      void utils.sessions.listForDateRange.invalidate();
      void utils.weeklyMinutes.summary.invalidate({ referenceDate });
      void utils.gapFill.suggestions.invalidate({ patientId, referenceDate });
      void utils.digest.today.invalidate();
    },
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <Clock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-slate-900">{fmtWhen(start)}</p>
              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-xs text-blue-800">
                {suggestion.therapistTherapyType}
              </Badge>
              <span className="text-xs font-semibold text-slate-600">{suggestion.durationMinutes} min</span>
            </div>
            <p className="mt-1 text-xs text-slate-600">{suggestion.therapistName ?? "Unassigned therapist"}</p>
            <p className="mt-0.5 text-xs text-slate-500">{suggestion.reason}</p>
          </div>
        </div>

        {added ? (
          <span className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800">
            <Check className="h-4 w-4" /> Added
          </span>
        ) : canEdit ? (
          <Button
            size="sm"
            className="h-10 shrink-0 bg-blue-600 px-3 font-bold text-white hover:bg-blue-700"
            disabled={createSession.isPending}
            onClick={() => createSession.mutate({
              patientId,
              therapyType: suggestion.therapistTherapyType,
              startTime: start,
              endTime: end,
              durationMinutes: suggestion.durationMinutes,
              therapistId: suggestion.therapistId,
            })}
          >
            {createSession.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add session
          </Button>
        ) : null}
      </div>

      {createSession.error && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-900">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {createSession.error.message}
        </div>
      )}
    </div>
  );
}

function PatientMinutesCard({ patient, referenceDate }: { patient: WeeklyMinutesSummary; referenceDate: Date }) {
  const [expanded, setExpanded] = useState(false);
  const target = Math.max(1, patient.target);
  const completedPercent = Math.min(100, (patient.completedMinutes / target) * 100);
  const pendingPercent = Math.min(100 - completedPercent, (patient.pendingMinutes / target) * 100);
  const completedTarget = patient.completedMinutes >= patient.target;
  const projectedTarget = patient.projectedTotalMinutes >= patient.target;

  const suggestionsQuery = trpc.gapFill.suggestions.useQuery(
    { patientId: patient.patientId, referenceDate },
    { enabled: expanded },
  );

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex min-w-[72px] shrink-0 flex-col items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
              <span className="text-xs font-semibold text-blue-700">Room</span>
              <span className="text-lg font-black tabular-nums text-blue-950">{patient.roomNumber}</span>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-bold text-slate-950">{patient.patientName}</h2>
                {completedTarget ? (
                  <Badge className="bg-emerald-100 text-xs text-emerald-800 hover:bg-emerald-100"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Target completed</Badge>
                ) : patient.atRisk ? (
                  <Badge variant="outline" className="border-rose-300 bg-rose-50 text-xs text-rose-900"><AlertTriangle className="mr-1 h-3.5 w-3.5" /> At risk</Badge>
                ) : projectedTarget ? (
                  <Badge variant="outline" className="border-blue-200 bg-blue-50 text-xs text-blue-800">Projected on track</Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-xs text-amber-900">Needs minutes</Badge>
                )}
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                <CalendarDays className="h-3.5 w-3.5" /> {patient.daysRemaining} day{patient.daysRemaining === 1 ? "" : "s"} left in this admission week
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <div className={cn("text-lg font-bold tabular-nums", completedTarget ? "text-emerald-700" : "text-slate-950")}>
              {fmtHours(patient.completedMinutes)}
            </div>
            <div className="text-xs font-medium text-slate-500">of {fmtHours(patient.target)} delivered</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Delivered", value: patient.completedMinutes, style: "border-emerald-200 bg-emerald-50 text-emerald-900" },
            { label: "Scheduled", value: patient.pendingMinutes, style: "border-amber-200 bg-amber-50 text-amber-900" },
            { label: "Missed", value: patient.missedMinutes, style: patient.missedMinutes ? "border-rose-200 bg-rose-50 text-rose-900" : "border-slate-200 bg-slate-50 text-slate-700" },
            { label: "Still needed", value: patient.remainingMinutes, style: patient.remainingMinutes ? "border-blue-200 bg-blue-50 text-blue-900" : "border-slate-200 bg-slate-50 text-slate-700" },
          ].map((metric) => (
            <div key={metric.label} className={cn("rounded-lg border px-3 py-2", metric.style)}>
              <div className="text-sm font-bold tabular-nums">{metric.value} min</div>
              <div className="mt-0.5 text-xs font-medium opacity-80">{metric.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <div className={cn("flex h-3 overflow-hidden rounded-full", projectedTarget ? "bg-slate-100" : "bg-rose-100")}>
            <div className="h-full bg-emerald-500" style={{ width: `${completedPercent}%` }} />
            <div className="h-full bg-amber-400" style={{ width: `${pendingPercent}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex flex-wrap gap-3">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Delivered</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Scheduled</span>
              {!projectedTarget && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-200" /> Uncovered</span>}
            </div>
            <span className="font-semibold">Projected: {fmtHours(patient.projectedTotalMinutes)}</span>
          </div>
        </div>
      </div>

      {patient.remainingMinutes > 0 && (
        <div className="border-t border-slate-200 bg-slate-50 p-3">
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full border-blue-200 bg-white font-semibold text-blue-800 hover:bg-blue-50"
            onClick={() => setExpanded((current) => !current)}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {expanded ? "Hide available sessions" : `Find sessions for ${fmtHours(patient.remainingMinutes)}`}
            {expanded ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
          </Button>

          {expanded && (
            <div className="mt-3 space-y-2">
              {suggestionsQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-6 text-sm text-slate-600">
                  <RefreshCw className="h-4 w-4 animate-spin text-blue-600" /> Finding conflict-free openings…
                </div>
              ) : suggestionsQuery.error ? (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                  <div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> Couldn't load openings</div>
                  <p className="mt-1 text-xs">{suggestionsQuery.error.message}</p>
                  <Button variant="outline" size="sm" className="mt-3 h-10 border-rose-300 bg-white" onClick={() => void suggestionsQuery.refetch()}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Retry
                  </Button>
                </div>
              ) : (suggestionsQuery.data ?? []).length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> No conflict-free openings found</div>
                  <p className="mt-1 text-xs text-amber-800">The patient or available team members are fully booked during the remaining admission week.</p>
                </div>
              ) : (
                (suggestionsQuery.data ?? []).map((suggestion, index) => (
                  <SuggestionRow
                    key={`${new Date(suggestion.startTime).toISOString()}-${suggestion.therapistId}-${index}`}
                    patientId={patient.patientId}
                    referenceDate={referenceDate}
                    suggestion={suggestion}
                  />
                ))
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function WeeklyMinutesPanel({ open, onOpenChange, referenceDate }: WeeklyMinutesPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const summaryQuery = trpc.weeklyMinutes.summary.useQuery({ referenceDate }, { enabled: open });
  const summary = summaryQuery.data ?? [];

  const atRiskCount = summary.filter((patient) => patient.atRisk).length;
  const coveredCount = summary.filter((patient) => patient.projectedTotalMinutes >= patient.target).length;
  const missingMinutes = summary.reduce((total, patient) => total + patient.remainingMinutes, 0);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return summary
      .filter((patient) => !query || patient.patientName.toLowerCase().includes(query) || patient.roomNumber.toLowerCase().includes(query))
      .filter((patient) => {
        if (statusFilter === "risk") return patient.atRisk;
        if (statusFilter === "needs") return patient.remainingMinutes > 0;
        if (statusFilter === "covered") return patient.projectedTotalMinutes >= patient.target;
        if (statusFilter === "completed") return patient.completedMinutes >= patient.target;
        return true;
      })
      .sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || b.remainingMinutes - a.remainingMinutes || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  }, [summary, searchQuery, statusFilter]);

  const dateLabel = referenceDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const filters: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "risk", label: "At risk" },
    { id: "needs", label: "Needs minutes" },
    { id: "covered", label: "Covered" },
    { id: "completed", label: "Completed" },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-slate-50 p-0 sm:max-w-xl lg:max-w-2xl [&>[data-slot=sheet-close]]:flex [&>[data-slot=sheet-close]]:h-10 [&>[data-slot=sheet-close]]:w-10 [&>[data-slot=sheet-close]]:items-center [&>[data-slot=sheet-close]]:justify-center [&>[data-slot=sheet-close]]:rounded-xl [&>[data-slot=sheet-close]]:border [&>[data-slot=sheet-close]]:border-white/30 [&>[data-slot=sheet-close]]:bg-white/15 [&>[data-slot=sheet-close]]:text-white [&>[data-slot=sheet-close]]:opacity-100 [&>[data-slot=sheet-close]]:shadow-sm [&>[data-slot=sheet-close]]:hover:bg-white/25 [&>[data-slot=sheet-close]]:focus:ring-white [&>[data-slot=sheet-close]>svg]:size-5">
        <SheetHeader className="border-b border-blue-700 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 p-5 pr-16 text-white">
          <div className="flex items-start gap-3 text-left">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
              <Target className="h-6 w-6 text-blue-100" />
            </div>
            <div>
              <SheetTitle className="text-xl font-bold text-white">Weekly Minutes</SheetTitle>
              <SheetDescription className="mt-1 text-sm text-blue-100">
                Delivered, scheduled, and missing therapy minutes for {dateLabel}.
              </SheetDescription>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2" aria-label="Weekly minutes summary">
            {[
              { label: "Patients", value: summary.length, tone: "text-white" },
              { label: "At risk", value: atRiskCount, tone: "text-rose-200" },
              { label: "Covered", value: coveredCount, tone: "text-emerald-200" },
              { label: "Need (min)", value: missingMinutes, tone: "text-amber-200" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-left">
                <div className={cn("text-lg font-bold tabular-nums", stat.tone)}>{stat.value.toLocaleString()}</div>
                <div className="truncate text-xs font-semibold text-blue-100">{stat.label}</div>
              </div>
            ))}
          </div>
        </SheetHeader>

        <div className="space-y-3 border-b border-slate-200 bg-white p-4">
          <div className="relative">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search patient or room..."
              className="h-11 rounded-xl border-slate-300 bg-white pl-10 pr-11 text-sm shadow-sm"
            />
            {searchQuery && (
              <button type="button" aria-label="Clear search" onClick={() => setSearchQuery("")} className="absolute right-1.5 top-0.5 flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {filters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatusFilter(filter.id)}
                className={cn(
                  "min-h-10 shrink-0 rounded-lg border px-3 text-xs font-bold transition-colors",
                  statusFilter === filter.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                {filter.label}
              </button>
            ))}
            <span className="ml-auto self-center whitespace-nowrap pl-2 text-xs font-semibold text-slate-500">{filtered.length} shown</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
          {summaryQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
            </div>
          ) : summaryQuery.error ? (
            <div role="alert" className="rounded-2xl border border-rose-200 bg-white px-6 py-12 text-center shadow-sm">
              <AlertTriangle className="mx-auto h-10 w-10 text-rose-700" />
              <h2 className="mt-3 text-base font-bold text-slate-900">Couldn't load weekly minutes</h2>
              <p className="mt-1 text-sm text-slate-600">{summaryQuery.error.message}</p>
              <Button variant="outline" className="mt-4 h-10" onClick={() => void summaryQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" /> Retry</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <Target className="mx-auto h-10 w-10 text-slate-300" />
              <h2 className="mt-3 text-base font-bold text-slate-800">{summary.length === 0 ? "No active admissions" : "No patients match these filters"}</h2>
              <p className="mt-1 text-sm text-slate-500">{summary.length === 0 ? "Weekly-minute progress will appear when an admission is active." : "Try a different search or status filter."}</p>
              {summary.length > 0 && <Button variant="outline" className="mt-4 h-10" onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}>Clear filters</Button>}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((patient) => <PatientMinutesCard key={patient.patientId} patient={patient} referenceDate={referenceDate} />)}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
