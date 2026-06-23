import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { THERAPY_META, type TherapyType } from "@/lib/board";
import { CheckCircle2, Scissors, CalendarX } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WeekSessionRow {
  id: number;
  therapyType: TherapyType;
  startTime: Date | string;
  durationMinutes: number;
  therapistName?: string;
}

interface TargetReachedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientName: string;
  target: number;
  totalMinutes: number;
  weekSessions: WeekSessionRow[];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmtHours(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

function fmtTime(dt: Date | string) {
  const d = new Date(dt);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function buildRecommendations(
  sessions: WeekSessionRow[],
  overBy: number,
): { action: "remove" | "reduce"; session: WeekSessionRow; reduceBy?: number }[] {
  if (overBy <= 0) return [];

  // Sort latest-in-week first so we suggest trimming from the end of the week
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );

  const recs: { action: "remove" | "reduce"; session: WeekSessionRow; reduceBy?: number }[] = [];
  let remaining = overBy;

  for (const s of sorted) {
    if (remaining <= 0) break;
    if (s.durationMinutes <= remaining) {
      recs.push({ action: "remove", session: s });
      remaining -= s.durationMinutes;
    } else {
      recs.push({ action: "reduce", session: s, reduceBy: remaining });
      remaining = 0;
    }
  }

  return recs;
}

export function TargetReachedDialog({
  open,
  onOpenChange,
  patientName,
  target,
  totalMinutes,
  weekSessions,
}: TargetReachedDialogProps) {
  const overBy = totalMinutes - target;

  const patientSessions = [...weekSessions].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  const recommendations = buildRecommendations(patientSessions, overBy);
  const recIds = new Set(recommendations.map((r) => r.session.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <DialogTitle className="text-base leading-snug">
                {patientName} reached their weekly target
              </DialogTitle>
              <p className="mt-1 text-sm text-slate-500">
                Review the schedule below to correct any over-scheduling.
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Target</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-700">{fmtHours(target)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Scheduled</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-700">{fmtHours(totalMinutes)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Over by</p>
            <p className={cn(
              "mt-0.5 text-lg font-bold tabular-nums",
              overBy > 0 ? "text-amber-600" : "text-emerald-600"
            )}>
              {overBy > 0 ? `+${fmtHours(overBy)}` : "On target"}
            </p>
          </div>
        </div>

        {/* Session list */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Sessions this week ({patientSessions.length})
          </p>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
            {patientSessions.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">No sessions scheduled this week</p>
            ) : (
              patientSessions.map((s) => {
                const meta = THERAPY_META[s.therapyType];
                const dt = new Date(s.startTime);
                const dayLabel = DAY_LABELS[dt.getDay()];
                const isFlagged = recIds.has(s.id);
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-xs transition-colors",
                      isFlagged ? "bg-amber-50 ring-1 ring-amber-200" : "bg-white hover:bg-slate-50"
                    )}
                  >
                    <span className="w-6 shrink-0 text-center text-[10px] font-bold text-slate-500">{dayLabel}</span>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ backgroundColor: meta.bg, color: meta.fg }}
                    >
                      {meta.label}
                    </span>
                    <span className="text-slate-500">{fmtTime(s.startTime)}</span>
                    <span className="font-semibold text-slate-700">{s.durationMinutes} min</span>
                    {s.therapistName && (
                      <span className="ml-auto truncate text-slate-400">{s.therapistName}</span>
                    )}
                    {isFlagged && (
                      <span className="ml-auto shrink-0 text-amber-500">
                        <CalendarX className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-1.5">
              <Scissors className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-xs font-semibold text-amber-800">Suggested corrections to reach target</span>
            </div>
            <ul className="space-y-1.5">
              {recommendations.map(({ action, session, reduceBy }) => {
                const dt = new Date(session.startTime);
                const meta = THERAPY_META[session.therapyType];
                const dayFull = FULL_DAY[dt.getDay()];
                return (
                  <li key={session.id} className="flex items-start gap-2 text-xs text-amber-900">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    {action === "remove" ? (
                      <span>
                        Remove the{" "}
                        <span className="font-semibold" style={{ color: meta.fg }}>
                          {meta.label}
                        </span>{" "}
                        session on {dayFull} at {fmtTime(session.startTime)} ({session.durationMinutes} min)
                      </span>
                    ) : (
                      <span>
                        Reduce the{" "}
                        <span className="font-semibold" style={{ color: meta.fg }}>
                          {meta.label}
                        </span>{" "}
                        session on {dayFull} at {fmtTime(session.startTime)} by{" "}
                        <span className="font-semibold">{reduceBy} min</span>{" "}
                        ({session.durationMinutes} → {session.durationMinutes - reduceBy!} min)
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
