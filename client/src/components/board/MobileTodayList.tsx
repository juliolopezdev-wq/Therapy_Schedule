import { memo, useMemo } from "react";
import { AlertTriangle, CheckCircle2, Clock3, LogOut, Plus, UserRound, XCircle } from "lucide-react";
import type { Patient, Team, Therapist } from "../../../../drizzle/schema";
import { Button } from "@/components/ui/button";
import { THERAPY_META, TIME_SLOTS, isMissedStatus } from "@/lib/board";
import type { SessionTileData } from "@/components/board/SessionTile";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/_core/hooks/usePermissions";

interface MobileTodayListProps {
  day: Date;
  patients: Array<Patient & { accessLevel?: "full" | "schedule" }>;
  teams: Team[];
  therapists: Therapist[];
  sessions: SessionTileData[];
  conflictIds: Set<number>;
  canEdit: boolean;
  onAddSession: (patientId: number, slotIndex: number) => void;
  onEditSession: (session: SessionTileData) => void;
  onAddPatient: () => void;
}

const STATUS_COPY = {
  scheduled: "Scheduled",
  completed: "Completed",
  canceled_discharge: "Canceled · discharged",
  missed_refusal: "Missed · refusal",
  missed_clinical_hold: "Missed · clinical hold",
  missed_staffing: "Missed · staffing",
  missed_other: "Missed · other",
} as const;

function MobileTodayListImpl({
  day,
  patients,
  teams,
  therapists,
  sessions,
  conflictIds,
  canEdit,
  onAddSession,
  onEditSession,
  onAddPatient,
}: MobileTodayListProps) {
  const { isAdmin } = usePermissions();
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const therapistById = useMemo(() => new Map(therapists.map((therapist) => [therapist.id, therapist])), [therapists]);
  const sessionsByPatient = useMemo(() => {
    const result = new Map<number, SessionTileData[]>();
    sessions.forEach((session) => {
      const current = result.get(session.patientId) ?? [];
      current.push(session);
      result.set(session.patientId, current);
    });
    result.forEach((items) => items.sort((a, b) => a.slotIndex - b.slotIndex));
    return result;
  }, [sessions]);

  const sortedPatients = useMemo(() => [...patients].sort((a, b) => {
    const roomCompare = (a.roomNumber || "").localeCompare(b.roomNumber || "", undefined, { numeric: true });
    return roomCompare || a.name.localeCompare(b.name);
  }), [patients]);

  const dateLabel = day.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const isToday = day.toDateString() === new Date().toDateString();
  const completedCount = sessions.filter((session) => session.status === "completed").length;
  const missedCount = sessions.filter((session) => isMissedStatus(session.status)).length;

  const firstOpenSlot = (patientId: number) => {
    const occupied = new Set<number>();
    (sessionsByPatient.get(patientId) ?? []).forEach((session) => {
      for (let offset = 0; offset < session.slotSpan; offset += 1) occupied.add(session.slotIndex + offset);
    });
    return TIME_SLOTS.find((slot) => slot.hour !== 12 && !occupied.has(slot.index))?.index ?? 0;
  };

  return (
    <section className="space-y-4 md:hidden" aria-labelledby="mobile-today-heading">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">{isToday ? "Today list" : "Daily list"}</p>
            <h1 id="mobile-today-heading" className="mt-1 text-xl font-bold text-slate-950">{dateLabel}</h1>
          </div>
          <div className="rounded-lg bg-slate-100 px-3 py-2 text-right">
            <div className="text-lg font-bold tabular-nums text-slate-950">{sessions.length}</div>
            <div className="text-xs font-medium text-slate-600">sessions</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <div className="font-bold tabular-nums text-slate-900">{patients.length}</div>
            <div className="text-xs text-slate-600">Patients</div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
            <div className="font-bold tabular-nums text-emerald-900">{completedCount}</div>
            <div className="text-xs text-emerald-800">Completed</div>
          </div>
          <div className={cn("rounded-lg border p-2", missedCount ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50")}>
            <div className={cn("font-bold tabular-nums", missedCount ? "text-rose-900" : "text-slate-900")}>{missedCount}</div>
            <div className={cn("text-xs", missedCount ? "text-rose-800" : "text-slate-600")}>Missed</div>
          </div>
        </div>
      </div>

      {sortedPatients.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center shadow-sm">
          <UserRound className="mx-auto h-9 w-9 text-slate-400" />
          <h2 className="mt-3 text-base font-bold text-slate-900">No active admissions</h2>
          <p className="mt-1 text-sm text-slate-600">Add an admission to begin scheduling this day.</p>
          {isAdmin && <Button className="mt-4 h-11" onClick={onAddPatient}><Plus className="mr-2 h-4 w-4" />Add admission</Button>}
        </div>
      ) : sortedPatients.map((patient) => {
        const patientSessions = sessionsByPatient.get(patient.id) ?? [];
        const team = patient.teamId == null ? null : teamById.get(patient.teamId);
        const canManagePatient = isAdmin || (canEdit && patient.accessLevel === "full");
        return (
          <article key={patient.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-blue-200 bg-blue-100 px-2.5 py-1 text-sm font-extrabold tabular-nums text-blue-950">
                    Room {patient.roomNumber || "—"}
                  </span>
                  {team && <span className="min-w-0 truncate text-xs font-semibold text-slate-600">{team.name}</span>}
                </div>
                <h2 className="mt-2 truncate text-base font-bold text-slate-950">{patient.name}</h2>
                {patient.mrn && <p className="mt-0.5 text-xs font-medium text-slate-600">MRN {patient.mrn}</p>}
              </div>
              {canManagePatient && (
                <Button
                  variant="outline"
                  className="h-11 shrink-0 border-blue-200 bg-white px-3 text-blue-800"
                  onClick={() => onAddSession(patient.id, firstOpenSlot(patient.id))}
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Session
                </Button>
              )}
            </div>

            <div className="divide-y divide-slate-100">
              {patientSessions.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-5 text-sm text-slate-600">
                  <Clock3 className="h-4 w-4 text-slate-400" /> No sessions scheduled
                </div>
              ) : patientSessions.map((session) => {
                const isConflict = conflictIds.has(session.id);
                const isMissed = isMissedStatus(session.status);
                const isCanceledDischarge = session.status === "canceled_discharge";
                const therapist = session.therapistId == null ? null : therapistById.get(session.therapistId);
                const statusText = STATUS_COPY[session.status] ?? session.status;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => onEditSession(session)}
                    className="flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                  >
                    <div className="w-[68px] shrink-0">
                      <div className="text-sm font-bold tabular-nums text-slate-950">{TIME_SLOTS[session.slotIndex]?.shortLabel ?? "—"}</div>
                      <div className="mt-0.5 text-xs text-slate-600">{session.durationMinutes} min</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-extrabold text-slate-800">{THERAPY_META[session.therapyType].label}</span>
                        <span className="truncate text-sm font-semibold text-slate-900">{therapist?.name ?? "Unassigned"}</span>
                      </div>
                      <div className={cn("mt-1 flex items-center gap-1.5 text-xs font-medium", isMissed ? "text-rose-800" : session.status === "completed" ? "text-emerald-800" : "text-slate-600")}>
                        {isMissed ? <XCircle className="h-4 w-4" /> : session.status === "completed" ? <CheckCircle2 className="h-4 w-4" /> : isCanceledDischarge ? <LogOut className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                        {statusText}
                      </div>
                    </div>
                    {isConflict && (
                      <span className="flex shrink-0 items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-900">
                        <AlertTriangle className="h-4 w-4" /> Conflict
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </article>
        );
      })}
    </section>
  );
}

export const MobileTodayList = memo(MobileTodayListImpl);
