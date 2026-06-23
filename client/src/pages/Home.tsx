import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  CalendarClock,
  LayoutGrid,
  Move,
  Users,
  AlertTriangle,
  History,
  Smartphone,
  Flag,
  CheckCircle2,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { THERAPY_TYPES, THERAPY_META } from "@/lib/board";

const FEATURES = [
  {
    icon: LayoutGrid,
    title: "Clinical Time-Grid",
    body: "A structured 7 AM – 5 PM workspace in 30-minute intervals. Track patients, room numbers, and clinicians instantly.",
  },
  {
    icon: Move,
    title: "Intuitive Rescheduling",
    body: "Drag-and-drop sessions smoothly across slots and patient rows. Real-time updates keep care coordinators aligned.",
  },
  {
    icon: AlertTriangle,
    title: "Conflict Interceptor",
    body: "Instantly flags overlapping schedules, double-booked therapists, and over-allocated sessions as they happen.",
  },
  {
    icon: Users,
    title: "Discipline & Team Filters",
    body: "Filter schedules dynamically by therapy type (PT, OT, SLP, Eval) or assigned clinical care teams.",
  },
  {
    icon: Flag,
    title: "Patient Status Indicators",
    body: "Tag patient rows with discharge planning (DC), weekend coverage, appointments, and critical identity alerts.",
  },
  {
    icon: CalendarClock,
    title: "Focused Personal views",
    body: "A simplified 'My Schedule' mobile portal. Clinicians view their individual worklist on the go.",
  },
  {
    icon: History,
    title: "Daily Audit Ledger",
    body: "Take snapshot backups of the board. Browse complete historical logs for progress auditing.",
  },
  {
    icon: Smartphone,
    title: "Optimized Mobile Access",
    body: "Responsive layout designed for tablets and mobile devices to keep care teams synchronized on the floor.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 text-white shadow-md shadow-blue-700/10">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-base font-extrabold tracking-tight text-slate-900">PAM Rehabilitation Scheduling</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-blue-700">Rehabilitation Scheduling</span>
            </div>
          </div>
          <Link href="/board">
            <Button size="sm" className="bg-blue-700 hover:bg-blue-800 text-white font-semibold shadow-sm">
              Open Scheduler <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-100 bg-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage:
              "radial-gradient(60rem 30rem at 80% -10%, rgba(13,148,136,0.12), transparent), radial-gradient(50rem 26rem at 0% 10%, rgba(14,165,233,0.08), transparent)",
          }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50/70 px-3 py-1 text-xs font-bold text-blue-800 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
              For Acute & Rehabilitation Clinics
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Modern digital
              <br />
              <span className="bg-gradient-to-r from-blue-700 to-cyan-600 bg-clip-text text-transparent">
                rehab scheduling.
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-500">
              Replace physical dry-erase boards with a secure, real-time clinical time-grid. 
              Reschedule sessions in seconds, catch scheduling conflicts automatically, and 
              improve floor coordination across therapies.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/board">
                <Button size="lg" className="bg-blue-700 hover:bg-blue-800 text-white font-semibold shadow-md">
                  Launch Board Scheduler <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <div className="flex items-center gap-2 text-sm text-slate-400 font-medium">
                <ShieldCheck className="h-4 w-4 text-blue-600" />
                HIPAA Aligned Architecture
              </div>
            </div>

            {/* Therapy legend chips */}
            <div className="mt-10 flex flex-wrap items-center gap-2">
              {THERAPY_TYPES.map((t) => {
                const meta = THERAPY_META[t];
                return (
                  <span
                    key={t}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1 pl-1.5 pr-3 text-xs font-semibold text-slate-600 shadow-sm"
                  >
                    <span
                      className="flex h-5 w-8 items-center justify-center rounded-md text-[10px] font-extrabold"
                      style={{ backgroundColor: meta.bg, color: meta.fg }}
                    >
                      {meta.label}
                    </span>
                    {meta.full}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Hero mock card */}
          <div className="relative">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/50">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    St. Jude Rehab Center
                  </span>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">
                  <AlertTriangle className="h-3 w-3" /> 1 scheduling conflict
                </span>
              </div>
              <div className="space-y-2.5">
                {([
                  { room: "106", name: "LIN MON", tiles: [{ t: "PT", at: 1 }, { t: "OT", at: 3 }] },
                  { room: "221", name: "JOH", tiles: [{ t: "SLP", at: 2 }] },
                  { room: "103", name: "CAM", tiles: [{ t: "SLP", at: 4, span: 2 }] },
                  { room: "205", name: "GRA", tiles: [{ t: "Eval", at: 0 }] },
                ] as { room: string; name: string; tiles: { t: string; at: number; span?: number }[] }[]).map((row) => (
                  <div key={row.room} className="flex items-center gap-2">
                    <div className="flex w-20 shrink-0 items-center gap-1.5">
                      <span className="inline-flex min-w-[2.25rem] justify-center rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[9px] font-bold text-slate-500">
                        {row.room}
                      </span>
                      <span className="truncate text-[11px] font-bold text-slate-700">
                        {row.name}
                      </span>
                    </div>
                    <div className="grid flex-1 grid-cols-6 gap-1.5">
                      {Array.from({ length: 6 }).map((_, i) => {
                        const tile = row.tiles.find((x) => x.at === i);
                        if (!tile) {
                          return (
                            <div
                              key={i}
                              className="h-7 rounded border border-dashed border-slate-100 bg-slate-50/50"
                            />
                          );
                        }
                        const meta = THERAPY_META[tile.t as keyof typeof THERAPY_META];
                        return (
                          <div
                            key={i}
                            className="relative flex h-7 items-center justify-between rounded px-1.5 text-[9px] font-extrabold border border-black/[0.04] shadow-sm"
                            style={{
                              backgroundColor: meta.bg,
                              color: meta.fg,
                              gridColumn: tile.span ? `span ${tile.span}` : undefined,
                            }}
                          >
                            <span
                              className="absolute inset-y-0 left-0 w-[3px] rounded-l"
                              style={{ backgroundColor: meta.accent }}
                            />
                            <span className="pl-1 uppercase">{meta.label}</span>
                            <span className="text-[8px] opacity-75">{tile.span ? "60m" : "30m"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute -bottom-4 -left-4 -z-10 h-full w-full rounded-xl bg-slate-100" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Engineered for clinical workflows
          </h2>
          <p className="mt-3 text-slate-500 leading-relaxed">
            All the visibility of a whiteboard scheduling system, updated for modern EHR coordination standards.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700 transition-colors group-hover:bg-blue-700 group-hover:text-white">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.body}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-16 overflow-hidden rounded-xl bg-gradient-to-br from-blue-800 to-blue-950 px-8 py-14 text-center shadow-lg">
          <h2 className="text-3xl font-extrabold tracking-tight text-white">
            Ready to transition to PAM Rehabilitation Scheduling?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-blue-100/90 text-sm leading-relaxed">
            Open the scheduling dashboard now. We have pre-populated a suite of sample patient profiles, care plans, and sessions to let you explore the flow.
          </p>
          <Link href="/board">
            <Button size="lg" className="mt-8 bg-white text-blue-900 hover:bg-blue-50 font-bold shadow-md">
              Launch Live Board <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-10 text-center text-xs font-semibold text-slate-400">
        PAM Rehabilitation Scheduling Operations Management System · Secure Rehabilitation Scheduling
      </footer>
    </div>
  );
}
