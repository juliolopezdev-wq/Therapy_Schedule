import { AlertTriangle, CheckCircle2, Clock3, ShieldCheck, UserRoundCheck, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";

export function TeamHuddle({ day }: { day: Date }) {
  const { role, hasBoardAccess } = usePermissions();
  const isAdmin = role === "admin";
  const query = trpc.huddle.today.useQuery({ date: day }, { enabled: !isAdmin && hasBoardAccess });

  if (isAdmin) return null;

  if (!hasBoardAccess) {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm" role="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="font-extrabold">Account setup required</h2>
            <p className="mt-1 text-sm">
              Ask an administrator to match your login email to your staff profile. A team assignment is not required.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (query.isLoading) {
    return <div className={`${role === "viewer" ? "h-20" : "h-28"} animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm`} aria-label="Loading schedule summary" />;
  }

  if (!query.data) return null;
  const { metrics, accessMode, nextTeamSessions, nextOwnSessions, therapistId } = query.data;

  if (role === "viewer") {
    return (
      <section className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm" aria-labelledby="my-schedule-summary-title">
        <div className="flex flex-col lg:min-h-20 lg:flex-row lg:items-stretch">
          <div className="flex shrink-0 items-center justify-between gap-3 bg-gradient-to-r from-blue-800 to-sky-700 px-4 py-2.5 text-white lg:w-72">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                <Clock3 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 id="my-schedule-summary-title" className="truncate text-sm font-extrabold">My schedule</h2>
                <p className="truncate text-[11px] text-blue-100">Complete your assigned sessions</p>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-[10px] font-bold ring-1 ring-white/20 lg:hidden">
              <ShieldCheck className="h-3 w-3" /> Limited access
            </span>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5 sm:flex-row sm:items-center">
            <div className="grid shrink-0 grid-cols-3 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-slate-50">
              {[
                { label: "Left", value: metrics.myRemaining, tone: "text-blue-700" },
                { label: "Done", value: metrics.myCompleted, tone: "text-emerald-700" },
                { label: "Missed", value: metrics.myMissed, tone: "text-rose-700" },
              ].map(({ label, value, tone }) => (
                <div key={label} className="min-w-16 px-3 py-1.5 text-center">
                  <p className={`text-base font-black leading-none tabular-nums ${tone}`}>{value}</p>
                  <p className="mt-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-500">{label}</p>
                </div>
              ))}
            </div>

            <div className="min-w-0 flex-1 sm:border-l sm:border-slate-200 sm:pl-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Up next</p>
                <span className="hidden items-center gap-1 text-[10px] font-semibold text-slate-500 xl:inline-flex">
                  <ShieldCheck className="h-3 w-3" /> Schedule read-only · assigned completion enabled
                </span>
              </div>
              {nextOwnSessions.length === 0 ? (
                <p className="mt-1 text-xs font-medium text-emerald-700">No assigned sessions remaining.</p>
              ) : (
                <div className="mt-1 flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
                  {nextOwnSessions.map((session) => (
                    <span key={session.sessionId} className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-950">
                      <strong>{new Date(session.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong> · {session.patientName} · Rm {session.roomNumber}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  const accessLabel = accessMode === "all"
    ? "Full schedule manager"
    : accessMode === "chart_own"
      ? "Chart your sessions"
      : "Full schedule · read only";

  return (
    <section className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-[0_12px_36px_-24px_rgba(30,64,175,0.45)]" aria-labelledby="team-huddle-title">
      <div className="flex flex-col gap-3 border-b border-blue-100 bg-gradient-to-r from-blue-800 to-sky-700 px-4 py-3 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15"><Users className="h-5 w-5" /></span>
          <div>
            <h2 id="team-huddle-title" className="font-extrabold">Schedule Huddle</h2>
            <p className="text-xs text-blue-100">{accessMode === "all" ? "Manage assignments, times, completion, and coverage across the full board." : "Full-board view—clinical details remain limited to your assigned patients."}</p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold ring-1 ring-white/20">
          <ShieldCheck className="h-3.5 w-3.5" /> {accessLabel}
        </span>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Staff", value: metrics.teamMembers, icon: Users, tone: "text-blue-700" },
            { label: "Remaining", value: metrics.remaining, icon: Clock3, tone: "text-amber-700" },
            { label: "Completed", value: metrics.completed, icon: CheckCircle2, tone: "text-emerald-700" },
            { label: "Missed", value: metrics.missed, icon: AlertTriangle, tone: "text-rose-700" },
            { label: "Unassigned", value: metrics.unassigned, icon: UserRoundCheck, tone: metrics.unassigned ? "text-rose-700" : "text-slate-600" },
            { label: "Mine left", value: metrics.myRemaining, icon: Clock3, tone: "text-blue-700" },
          ].map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="flex items-center gap-1.5"><Icon className={`h-3.5 w-3.5 ${tone}`} /><span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span></div>
              <p className={`mt-1 text-xl font-black tabular-nums ${tone}`}>{value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Next scheduled sessions</p>
          {nextTeamSessions.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No remaining sessions for this day.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {nextTeamSessions.slice(0, 3).map((session) => (
                <span key={session.sessionId} className={`rounded-lg border bg-white px-2.5 py-1.5 text-xs ${session.therapistId === therapistId ? "border-blue-300 text-blue-900" : "border-slate-200 text-slate-700"}`}>
                  <strong>{new Date(session.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong> · {session.patientName} · Rm {session.roomNumber}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
