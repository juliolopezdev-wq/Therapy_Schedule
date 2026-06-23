import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { THERAPY_TYPES, THERAPY_META, TherapyType } from "@/lib/board";
import { Clock, Sparkles, Plus, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface WeeklyMinutesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function fmtHours(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

function fmtWhen(d: Date | string) {
  const dt = new Date(d);
  return dt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function SuggestionRow({
  patientId,
  suggestion,
}: {
  patientId: number;
  suggestion: {
    startTime: Date | string;
    durationMinutes: number;
    therapistId: number | null;
    therapistName: string | null;
    reason: string;
  };
}) {
  const utils = trpc.useUtils();
  const [therapyType, setTherapyType] = useState<TherapyType>("PT");
  const [added, setAdded] = useState(false);

  const createSession = trpc.sessions.create.useMutation({
    onSuccess: () => {
      setAdded(true);
      utils.sessions.list.invalidate();
      utils.sessions.listForDateRange.invalidate();
      utils.weeklyMinutes.summary.invalidate();
      utils.gapFill.suggestions.invalidate({ patientId });
    },
  });

  const start = new Date(suggestion.startTime);
  const end = new Date(start.getTime() + suggestion.durationMinutes * 60_000);

  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs">
      <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-700">
          {fmtWhen(start)} · {suggestion.durationMinutes} min
        </p>
        <p className="truncate text-slate-400">{suggestion.reason}</p>
      </div>
      {added ? (
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
          Added
        </Badge>
      ) : (
        <>
          <Select value={therapyType} onValueChange={(v) => setTherapyType(v as TherapyType)}>
            <SelectTrigger className="h-7 w-[72px] text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THERAPY_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {THERAPY_META[t].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={createSession.isPending}
            onClick={() =>
              createSession.mutate({
                patientId,
                therapyType,
                startTime: start,
                endTime: end,
                durationMinutes: suggestion.durationMinutes,
                therapistId: suggestion.therapistId,
              })
            }
          >
            <Plus className="mr-1 h-3 w-3" /> Add
          </Button>
        </>
      )}
    </div>
  );
}

function PatientRow({
  patient,
}: {
  patient: {
    patientId: number;
    patientName: string;
    roomNumber: string;
    target: number;
    completedMinutes: number;
    remainingMinutes: number;
    daysRemaining: number;
    atRisk: boolean;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const pct = Math.min(100, Math.round((patient.completedMinutes / patient.target) * 100));
  const onTarget = patient.remainingMinutes <= 0;

  const suggestionsQuery = trpc.gapFill.suggestions.useQuery(
    { patientId: patient.patientId },
    { enabled: expanded },
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
            {patient.roomNumber}
          </span>
          <span className="truncate text-sm font-semibold text-slate-800">{patient.patientName}</span>
          {patient.atRisk ? (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
              <AlertTriangle className="mr-1 h-3 w-3" /> At risk
            </Badge>
          ) : null}
        </div>
        <span
          className={cn(
            "shrink-0 text-xs font-bold tabular-nums",
            onTarget ? "text-emerald-600" : "text-slate-500",
          )}
        >
          {fmtHours(patient.completedMinutes)} / {fmtHours(patient.target)}
        </span>
      </div>

      <Progress value={pct} className={cn("mt-2 h-1.5", onTarget && "bg-emerald-100")} />

      <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
        <span>
          {onTarget
            ? "On target for the week"
            : `${fmtHours(patient.remainingMinutes)} remaining`}
        </span>
        <span>{patient.daysRemaining} day{patient.daysRemaining !== 1 ? "s" : ""} left</span>
      </div>

      {!onTarget && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-slate-200 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
        >
          <Sparkles className="h-3 w-3" />
          {expanded ? "Hide suggestions" : "Suggest open slots"}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      )}

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {suggestionsQuery.isLoading ? (
            <p className="py-2 text-center text-[11px] text-slate-400">Looking for open slots…</p>
          ) : (suggestionsQuery.data ?? []).length === 0 ? (
            <p className="py-2 text-center text-[11px] text-slate-400">
              No open slots found this week — every team member is booked.
            </p>
          ) : (
            (suggestionsQuery.data ?? []).map((s, i) => (
              <SuggestionRow key={i} patientId={patient.patientId} suggestion={s} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function WeeklyMinutesPanel({ open, onOpenChange }: WeeklyMinutesPanelProps) {
  const summaryQuery = trpc.weeklyMinutes.summary.useQuery(undefined, { enabled: open });
  const summary = summaryQuery.data ?? [];
  const sorted = [...summary].sort((a, b) => b.remainingMinutes - a.remainingMinutes);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-slate-200 p-5">
          <SheetTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-500" /> Weekly Minutes
          </SheetTitle>
          <SheetDescription>
            Each patient's week starts on their own admission day, not a shared
            calendar week. Patients short on minutes get open-slot suggestions
            you can add with one click.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {summaryQuery.isLoading ? (
            <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Clock className="h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">No active patients on the board.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sorted.map((p) => (
                <PatientRow key={p.patientId} patient={p} />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
