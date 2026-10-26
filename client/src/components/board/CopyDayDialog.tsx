import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Copy,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type DeliveryMode = "individual" | "concurrent" | "group";

export interface CopyDaySession {
  id: number;
  patientId: number;
  therapistId: number | null;
  therapyType: string;
  durationMinutes: number;
  startTime: Date | string;
  endTime: Date | string;
  deliveryMode: DeliveryMode | null;
}

interface CopyResult {
  count: number;
  skippedConflicts: number;
  skippedUnavailable: number;
}

interface CopyDayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceDate: Date;
  sessions: CopyDaySession[];
  onCopy: () => Promise<CopyResult | null>;
  onViewTomorrow: () => void;
}

function addCalendarDay(value: Date | string) {
  const next = new Date(value);
  next.setDate(next.getDate() + 1);
  return next;
}

function formatDay(date: Date) {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function sessionsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

export function CopyDayDialog({
  open,
  onOpenChange,
  sourceDate,
  sessions,
  onCopy,
  onViewTomorrow,
}: CopyDayDialogProps) {
  const [isCopying, setIsCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [result, setResult] = useState<CopyResult | null>(null);
  const targetDate = useMemo(() => addCalendarDay(sourceDate), [sourceDate]);
  const targetQuery = trpc.sessions.list.useQuery(
    { date: targetDate },
    { enabled: open, staleTime: 0 },
  );

  useEffect(() => {
    if (!open) return;
    setCopyError(null);
    setResult(null);
  }, [open, sourceDate]);

  const patientCount = useMemo(
    () => new Set(sessions.filter((session) => session.therapyType !== "Block").map((session) => session.patientId)).size,
    [sessions],
  );
  const therapistCount = useMemo(
    () => new Set(sessions.map((session) => session.therapistId).filter((id): id is number => id != null)).size,
    [sessions],
  );
  const totalMinutes = useMemo(
    () => sessions.reduce((sum, session) => {
      const duration = new Date(session.endTime).getTime() - new Date(session.startTime).getTime();
      return sum + Math.max(0, Math.round(duration / 60_000));
    }, 0),
    [sessions],
  );

  const predictedConflicts = useMemo(() => {
    const targetSessions = targetQuery.data ?? [];
    return sessions.filter((source) => {
      const copiedStart = addCalendarDay(source.startTime);
      const copiedEnd = addCalendarDay(source.endTime);
      return targetSessions.some((target) => {
        if (!sessionsOverlap(copiedStart, copiedEnd, new Date(target.startTime), new Date(target.endTime))) return false;
        if (source.patientId === target.patientId) return true;
        if (source.therapistId == null || source.therapistId !== target.therapistId) return false;
        const sourceMode = source.deliveryMode ?? "individual";
        const targetMode = target.deliveryMode ?? "individual";
        return sourceMode !== targetMode || (sourceMode !== "group" && sourceMode !== "concurrent");
      });
    }).length;
  }, [sessions, targetQuery.data]);

  const handleCopy = async () => {
    setIsCopying(true);
    setCopyError(null);
    try {
      const copyResult = await onCopy();
      if (copyResult) setResult(copyResult);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "The schedule could not be copied.");
    } finally {
      setIsCopying(false);
    }
  };

  const skippedTotal = (result?.skippedConflicts ?? 0) + (result?.skippedUnavailable ?? 0);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isCopying && onOpenChange(nextOpen)}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-2xl gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl">
        <div className="bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-6 py-5 pr-20 text-white">
          <DialogHeader className="text-left">
            <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <Copy className="h-5 w-5" />
            </div>
            <DialogTitle className="text-xl font-bold tracking-tight text-white">Copy day to tomorrow</DialogTitle>
            <DialogDescription className="max-w-lg text-sm text-blue-50">
              Review the destination before duplicating this schedule. Tomorrow's existing sessions will remain in place.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 sm:gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Copy from</p>
              <p className="mt-1 text-base font-bold text-slate-950">{formatDay(sourceDate)}</p>
              <p className="mt-1 text-sm text-slate-600">{sessions.length} scheduled item{sessions.length === 1 ? "" : "s"}</p>
            </div>
            <div className="flex items-center justify-center text-blue-600">
              <ArrowRight className="h-5 w-5" />
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Copy to</p>
              <p className="mt-1 text-base font-bold text-slate-950">{formatDay(targetDate)}</p>
              <p className="mt-1 text-sm text-slate-600">
                {targetQuery.isLoading
                  ? "Checking existing schedule…"
                  : `${targetQuery.data?.length ?? 0} existing item${targetQuery.data?.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: "Patients", value: patientCount, icon: Users },
              { label: "Staff", value: therapistCount, icon: CalendarDays },
              { label: "Minutes", value: totalMinutes, icon: Clock3 },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-center shadow-sm">
                <Icon className="mx-auto h-4 w-4 text-blue-600" />
                <p className="mt-1 text-lg font-extrabold tabular-nums text-slate-950">{value}</p>
                <p className="text-xs font-medium text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          {!result && sessions.length === 0 && (
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-bold">Nothing to copy</p>
                <p className="mt-0.5 text-sm text-amber-800">The selected day has no scheduled sessions or blocks.</p>
              </div>
            </div>
          )}

          {!result && sessions.length > 0 && (
            <div className={cn(
              "flex gap-3 rounded-xl border p-4",
              predictedConflicts > 0 ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950",
            )}>
              {targetQuery.isLoading ? (
                <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-blue-600" />
              ) : predictedConflicts > 0 ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              ) : (
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              )}
              <div>
                <p className="text-sm font-bold">
                  {targetQuery.isLoading
                    ? "Checking tomorrow for conflicts"
                    : targetQuery.isError
                      ? "Preview unavailable — server safeguards still apply"
                      : predictedConflicts > 0
                        ? `${predictedConflicts} likely conflict${predictedConflicts === 1 ? "" : "s"} will be skipped`
                        : "No conflicts detected"}
                </p>
                <p className="mt-0.5 text-sm opacity-80">
                  Copied items keep their time, therapist, discipline, mode, and notes. Completion and missed statuses reset to scheduled.
                </p>
              </div>
            </div>
          )}

          {copyError && (
            <div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-950">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
              <div>
                <p className="text-sm font-bold">Copy failed</p>
                <p className="mt-0.5 text-sm text-rose-800">{copyError}</p>
              </div>
            </div>
          )}

          {result && (
            <div role="status" className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              <div>
                <p className="text-sm font-bold">Tomorrow's schedule is ready</p>
                <p className="mt-0.5 text-sm text-emerald-800">
                  Copied {result.count} item{result.count === 1 ? "" : "s"}.
                  {skippedTotal > 0 && ` Skipped ${skippedTotal} because of conflicts or unavailable records.`}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
          {result ? (
            <>
              <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Close</Button>
              <Button className="h-11 bg-blue-600 px-5 hover:bg-blue-700" onClick={onViewTomorrow}>
                View tomorrow <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="h-11" disabled={isCopying} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                className="h-11 bg-blue-600 px-5 hover:bg-blue-700"
                disabled={isCopying || sessions.length === 0 || targetQuery.isLoading}
                onClick={handleCopy}
              >
                {isCopying ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
                {isCopying ? "Copying schedule…" : `Copy ${sessions.length} item${sessions.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
