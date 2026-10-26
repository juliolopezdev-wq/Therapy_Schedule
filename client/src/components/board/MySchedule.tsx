import { useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  LogOut,
  Printer,
  Search,
  User,
  Users,
  XCircle,
} from "lucide-react";
import {
  THERAPY_META,
  TIME_SLOTS,
  SESSION_STATUS_META,
  formatLongDate,
  isCanceledStatus,
  isMissedStatus,
  type TherapyType,
} from "@/lib/board";
import type { SessionTileData } from "./SessionTile";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface MyScheduleProps {
  therapists: { id: number; name: string }[];
  value: number | null;
  onChange: (id: number | null) => void;
  sessions: SessionTileData[];
  patients: { id: number; name: string; roomNumber: string }[];
  day: Date;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function buildSchedulePrintHtml(
  therapistName: string,
  dateLabel: string,
  rows: { time: string; patientLabel: string; typeMeta: (typeof THERAPY_META)[TherapyType]; durationMinutes: number; status: string; statusLabel: string; notes: string }[],
): string {
  const totalMinutes = rows.reduce((sum, r) => sum + (isCanceledStatus(r.status) ? 0 : r.durationMinutes), 0);
  const completedSessions = rows.filter((row) => row.statusLabel.toLowerCase() === "completed").length;
  const missedSessions = rows.filter((row) => row.statusLabel.toLowerCase().startsWith("missed")).length;

  const tableRows = rows
    .map(
      (r, i) => `<tr class="${isCanceledStatus(r.status) ? "canceled" : ""}" style="border-left:4px solid ${r.typeMeta.accent}">
        <td class="time">${escapeHtml(r.time)}</td>
        <td class="patient">${escapeHtml(r.patientLabel)}</td>
        <td><span class="pill" style="background:${r.typeMeta.bg};color:${r.typeMeta.fg}">${escapeHtml(r.typeMeta.label)}</span></td>
        <td class="duration">${escapeHtml(r.durationMinutes.toString())}<span class="unit"> min</span></td>
        <td><span class="status">${escapeHtml(r.statusLabel)}</span></td>
        <td class="notes">${r.notes ? escapeHtml(r.notes) : "—"}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Schedule — ${escapeHtml(therapistName)} — ${escapeHtml(dateLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #1e293b;
    margin: 0;
    padding: 36px 40px;
    background: #eef4fb;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { max-width: 1100px; margin: 0 auto; padding: 28px; background: white; border-radius: 18px; box-shadow: 0 12px 35px rgba(15,23,42,0.09); }
  .letterhead { display: flex; align-items: flex-end; justify-content: space-between; margin: -28px -28px 22px; padding: 24px 28px; border-radius: 18px 18px 0 0; color: white; background: linear-gradient(120deg,#1e40af,#0369a1); }
  .letterhead .brand { display: flex; align-items: center; gap: 8px; font-size: 10px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #dbeafe; }
  .letterhead .brand .dot { width: 8px; height: 8px; border-radius: 2px; background: #7dd3fc; }
  .letterhead .title { font-size: 27px; font-weight: 850; margin-top: 6px; letter-spacing: -0.02em; }
  .letterhead .subtitle { font-size: 12px; color: #dbeafe; margin-top: 3px; font-weight: 650; }
  .letterhead .meta { text-align: right; font-size: 10px; color: #bae6fd; }
  .letterhead .meta strong { display: block; font-size: 14px; color: white; font-weight: 800; }

  .summary { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 18px; }
  .summary .stat { background: #f8fafc; border: 1px solid #dbe4f0; border-radius: 10px; padding: 10px 14px; }
  .summary .stat .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; font-weight: 700; }
  .summary .stat .value { font-size: 19px; font-weight: 850; margin-top: 3px; color: #0f172a; }

  .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,0.04); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead tr { background: #eaf1f9; }
  th { text-align: left; padding: 10px 14px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; color: #64748b; font-weight: 700; }
  tbody tr:nth-child(even) { background: #fafbfc; }
  tbody tr.canceled { background: #f1f5f9; color: #64748b; }
  tbody tr.canceled td.time, tbody tr.canceled td.patient { text-decoration: line-through; }
  tbody tr:not(:last-child) td { border-bottom: 1px solid #f1f5f9; }
  td { padding: 11px 13px; vertical-align: middle; }
  tbody tr { break-inside: avoid; page-break-inside: avoid; }
  td.time { font-weight: 700; white-space: nowrap; color: #1e293b; }
  td.patient { font-weight: 600; }
  td.duration { font-weight: 700; white-space: nowrap; }
  td.duration .unit { font-weight: 400; color: #94a3b8; }
  td.notes { color: #64748b; max-width: 180px; }
  .pill { display: inline-block; padding: 3px 9px; border-radius: 5px; font-weight: 700; font-size: 10.5px; white-space: nowrap; }
  .status { display: inline-block; border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 999px; padding: 3px 8px; font-size: 10px; font-weight: 750; white-space: nowrap; }
  .empty { padding: 56px 0; text-align: center; color: #94a3b8; font-size: 13px; }
  .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #cbd5e1; letter-spacing: 0.04em; }
  @media print {
    body { padding: 0; background: white; }
    .page { max-width: none; padding: 0; border-radius: 0; box-shadow: none; }
    .letterhead { margin: 0 0 18px; border-radius: 0; }
    .card { box-shadow: none; }
    @page { size: landscape; margin: 0.4in; }
  }
</style>
</head>
<body>
<main class="page">
  <div class="letterhead">
    <div>
      <div class="brand"><span class="dot"></span>MinuteMinder</div>
      <div class="title">${escapeHtml(therapistName)}</div>
      <div class="subtitle">Daily Schedule</div>
    </div>
    <div class="meta">
      <strong>${escapeHtml(dateLabel)}</strong>
      Printed ${escapeHtml(new Date().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }))}
    </div>
  </div>

  <div class="summary">
    <div class="stat"><div class="label">Sessions</div><div class="value">${rows.length}</div></div>
    <div class="stat"><div class="label">Scheduled minutes</div><div class="value">${totalMinutes}</div></div>
    <div class="stat"><div class="label">Completed</div><div class="value">${completedSessions}</div></div>
    <div class="stat"><div class="label">Missed</div><div class="value">${missedSessions}</div></div>
  </div>

  <div class="card">
  ${
    rows.length === 0
      ? `<div class="empty">No sessions scheduled for ${escapeHtml(therapistName)} this day.</div>`
      : `<table>
    <thead>
      <tr><th>Time</th><th>Patient / Room</th><th>Type</th><th>Duration</th><th>Status</th><th>Notes</th></tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>`
  }
  </div>

  <div class="footer">MINUTEMINDER</div>
</main>
</body>
</html>`;
}

function printSchedule(
  therapistName: string,
  dateLabel: string,
  rows: { time: string; patientLabel: string; typeMeta: (typeof THERAPY_META)[TherapyType]; durationMinutes: number; status: string; statusLabel: string; notes: string }[],
): boolean {
  const html = buildSchedulePrintHtml(therapistName, dateLabel, rows);
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
  return true;
}

type ScheduleFilter = "all" | "scheduled" | "completed" | "missed" | "canceled" | "conflicts";

export function MySchedule({
  therapists,
  value,
  onChange,
  sessions,
  patients,
  day,
}: MyScheduleProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<ScheduleFilter>("all");
  const [search, setSearch] = useState("");

  const therapist = therapists.find((t) => t.id === value);

  const patientById = useMemo(
    () => new Map(patients.map((patient) => [patient.id, patient])),
    [patients],
  );

  const mySessions = useMemo(() => {
    if (!value) return [];
    return sessions
      .filter((s) => s.therapistId === value)
      .sort((a, b) => a.slotIndex - b.slotIndex);
  }, [sessions, value]);

  const patientName = (id: number) => {
    const p = patientById.get(id);
    return p ? `${p.name} · Rm ${p.roomNumber}` : "Unknown";
  };

  const filteredSessions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return mySessions.filter((session) => {
      if (filter === "scheduled" && session.status !== "scheduled") return false;
      if (filter === "completed" && session.status !== "completed") return false;
      if (filter === "missed" && !isMissedStatus(session.status)) return false;
      if (filter === "canceled" && !isCanceledStatus(session.status)) return false;
      if (filter === "conflicts" && !session.hasConflict) return false;
      const patient = patientById.get(session.patientId);
      return !term || patient?.name.toLowerCase().includes(term) || patient?.roomNumber.toLowerCase().includes(term) || session.therapyType.toLowerCase().includes(term);
    });
  }, [filter, mySessions, patientById, search]);

  const totalMinutes = mySessions.reduce((total, session) => total + (isCanceledStatus(session.status) ? 0 : session.durationMinutes), 0);
  const completedMinutes = mySessions.reduce(
    (total, session) => total + (session.status === "completed" ? (session.actualDurationMinutes ?? session.durationMinutes) : 0),
    0,
  );
  const uniquePatients = new Set(mySessions.filter((session) => session.therapyType !== "Block").map((session) => session.patientId)).size;
  const missedCount = mySessions.filter((session) => isMissedStatus(session.status)).length;
  const conflictCount = mySessions.filter((session) => session.hasConflict).length;

  const dateLabel = formatLongDate(day);

  const handlePrint = () => {
    if (!therapist) return;
    const rows = mySessions.map((s) => {
      const meta = THERAPY_META[s.therapyType as TherapyType];
      const slot = TIME_SLOTS[s.slotIndex];
      const statusLabel = SESSION_STATUS_META[s.status ?? "scheduled"]?.label ?? "Scheduled";
      return {
        time: slot?.shortLabel ?? "",
        patientLabel: patientName(s.patientId),
        typeMeta: meta,
        durationMinutes: s.durationMinutes,
        status: s.status,
        statusLabel,
        notes: s.missedReason || s.notes || "",
      };
    });
    if (!printSchedule(therapist.name, dateLabel, rows)) {
      toast.error("The print window was blocked. Allow pop-ups and try again.");
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setFilter("all");
      setSearch("");
    }
  };

  return (
    <>
      <Button
        size="sm"
        className="h-11 rounded-xl border border-blue-600 bg-blue-700 px-4 font-bold text-white shadow-sm transition-colors hover:bg-blue-800"
        onClick={() => setOpen(true)}
      >
        <CalendarClock className="mr-2 h-4 w-4" /> My Schedule
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex h-[88vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl xl:max-w-5xl">
          <div className="shrink-0 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-5 py-5 pr-20 text-white sm:px-6">
            <DialogHeader className="text-left">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25"><CalendarClock className="h-5 w-5" /></div>
                <div><DialogTitle className="text-xl font-bold tracking-tight text-white">My schedule</DialogTitle><DialogDescription className="mt-1 text-sm text-blue-50">View a staff member’s complete schedule for {dateLabel}.</DialogDescription></div>
              </div>
            </DialogHeader>
          </div>

          <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div className="w-full sm:max-w-sm"><label className="text-sm font-bold text-slate-800">Staff member</label><Select value={value ? String(value) : "none"} onValueChange={(nextValue) => { onChange(nextValue === "none" ? null : Number(nextValue)); setFilter("all"); setSearch(""); }}><SelectTrigger className="mt-2 h-11 border-slate-300 bg-white"><SelectValue placeholder="Select staff…"/></SelectTrigger><SelectContent><SelectItem value="none">Select staff…</SelectItem>{therapists.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>
            <Button variant="outline" className="h-11 border-blue-200 text-blue-800 hover:bg-blue-50" disabled={!therapist || mySessions.length === 0} onClick={handlePrint}><Printer className="mr-2 h-4 w-4"/>Print full schedule</Button>
          </div>

          {!value ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white p-8 text-center"><User className="h-10 w-10 text-blue-600"/><h3 className="mt-4 text-lg font-bold text-slate-950">Choose a staff member</h3><p className="mt-1 max-w-md text-sm text-slate-600">Select a staff member to review their sessions, treatment minutes, status, and conflicts.</p></div>
          ) : mySessions.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white p-8 text-center"><CalendarClock className="h-10 w-10 text-slate-300"/><h3 className="mt-4 text-lg font-bold text-slate-950">No sessions scheduled</h3><p className="mt-1 text-sm text-slate-600">{therapist?.name} has no sessions on {dateLabel}.</p></div>
          ) : (
            <>
              <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-200 bg-white p-4 sm:px-6 lg:grid-cols-4">
                {[{ label: "Sessions", value: mySessions.length, note: `${uniquePatients} patient${uniquePatients === 1 ? "" : "s"}`, icon: CalendarClock, tone: "text-blue-700" }, { label: "Scheduled", value: `${totalMinutes}m`, note: "including block time", icon: Clock3, tone: "text-slate-950" }, { label: "Completed", value: `${completedMinutes}m`, note: "documented treatment", icon: CheckCircle2, tone: "text-emerald-700" }, { label: "Missed", value: missedCount, note: conflictCount ? `${conflictCount} conflict${conflictCount === 1 ? "" : "s"}` : "no conflicts", icon: missedCount || conflictCount ? AlertTriangle : CheckCircle2, tone: missedCount || conflictCount ? "text-rose-700" : "text-emerald-700" }].map(({ label, value: statValue, note, icon: Icon, tone }) => <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center gap-2"><Icon className={cn("h-4 w-4", tone)}/><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p></div><p className={cn("mt-1 text-xl font-extrabold tabular-nums", tone)}>{statValue}</p><p className="text-xs text-slate-500">{note}</p></div>)}
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
                {conflictCount > 0 && <div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700"/><p className="text-sm"><strong>{conflictCount} scheduling conflict{conflictCount === 1 ? " needs" : "s need"} attention.</strong> Review the main board before using or printing this schedule.</p></div>}
                <div className="flex flex-col gap-2 lg:flex-row"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient, room, or therapy type…" className="h-11 border-slate-300 bg-white pl-10"/></div><Select value={filter} onValueChange={(nextFilter: ScheduleFilter) => setFilter(nextFilter)}><SelectTrigger className="h-11 w-full border-slate-300 bg-white lg:w-44"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All sessions</SelectItem><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="missed">Missed</SelectItem><SelectItem value="canceled">Canceled — D/C</SelectItem><SelectItem value="conflicts">Conflicts</SelectItem></SelectContent></Select></div>

                <ScrollArea className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
                  {filteredSessions.length === 0 ? (
                    <div className="flex min-h-52 flex-col items-center justify-center p-8 text-center"><Search className="h-9 w-9 text-slate-300"/><h3 className="mt-3 font-bold text-slate-950">No matching sessions</h3><p className="mt-1 text-sm text-slate-600">Try another search or status filter.</p><Button variant="outline" className="mt-4 h-10" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</Button></div>
                  ) : (
                    <div className="divide-y divide-slate-100">{filteredSessions.map((session) => {
                      const meta = THERAPY_META[session.therapyType as TherapyType];
                      const slot = TIME_SLOTS[session.slotIndex];
                      const patient = patientById.get(session.patientId);
                      const statusMeta = SESSION_STATUS_META[session.status ?? "scheduled"];
                      const missed = isMissedStatus(session.status);
                      const canceled = isCanceledStatus(session.status);
                      return <div key={session.id} className={cn("grid gap-3 p-4 lg:grid-cols-[100px_minmax(0,1fr)_auto] lg:items-center", session.hasConflict && "bg-rose-50/60", canceled && "bg-slate-100 text-slate-500")}><div><p className={cn("text-sm font-extrabold text-slate-950", canceled && "text-slate-500 line-through")}>{slot?.shortLabel ?? "—"}</p><p className="mt-0.5 text-xs text-slate-500">{session.durationMinutes} minutes</p></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className={cn("truncate text-sm font-bold text-slate-950", canceled && "text-slate-500 line-through")}>{patient?.name ?? "Unknown patient"}</p>{patient && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">Room {patient.roomNumber}</span>}<span className="rounded px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: meta.bg, color: meta.fg }}>{meta.label}</span>{session.deliveryMode && session.deliveryMode !== "individual" && <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold capitalize text-blue-800">{session.deliveryMode}</span>}</div>{(session.missedReason || session.notes) && <p className="mt-1 truncate text-xs text-slate-600">{session.missedReason || session.notes}</p>}</div><div className="flex items-center justify-end gap-2">{session.hasConflict && <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800"><AlertTriangle className="h-3.5 w-3.5"/>Conflict</span>}<span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: statusMeta.bg, color: statusMeta.fg }}>{session.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5"/> : missed ? <XCircle className="h-3.5 w-3.5"/> : canceled ? <LogOut className="h-3.5 w-3.5"/> : <Clock3 className="h-3.5 w-3.5"/>}{statusMeta.label}</span></div></div>;
                    })}</div>
                  )}
                </ScrollArea>
              </div>
            </>
          )}

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:px-6"><p className="text-xs text-slate-500">Read-only view — make schedule changes on the main board.</p><Button className="h-11 bg-blue-700 px-6 hover:bg-blue-800" onClick={() => setOpen(false)}>Close schedule</Button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
