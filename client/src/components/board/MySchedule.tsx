import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarClock, User, Printer } from "lucide-react";
import { useState } from "react";
import {
  THERAPY_META,
  TIME_SLOTS,
  SESSION_STATUS_META,
  formatLongDate,
  type TherapyType,
} from "@/lib/board";
import type { SessionTileData } from "./SessionTile";

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
  rows: { time: string; patientLabel: string; typeMeta: (typeof THERAPY_META)[TherapyType]; durationMinutes: number; statusLabel: string; notes: string }[],
): string {
  const totalMinutes = rows.reduce((sum, r) => sum + r.durationMinutes, 0);

  const tableRows = rows
    .map(
      (r, i) => `<tr style="border-left:4px solid ${r.typeMeta.accent}">
        <td class="time">${escapeHtml(r.time)}</td>
        <td class="patient">${escapeHtml(r.patientLabel)}</td>
        <td><span class="pill" style="background:${r.typeMeta.bg};color:${r.typeMeta.fg}">${escapeHtml(r.typeMeta.label)}</span></td>
        <td class="duration">${escapeHtml(r.durationMinutes.toString())}<span class="unit"> min</span></td>
        <td>${escapeHtml(r.statusLabel)}</td>
        <td class="notes">${escapeHtml(r.notes)}</td>
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
    padding: 40px 44px;
    background: #f8fafc;
  }
  .letterhead { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 24px; }
  .letterhead .brand { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #6366f1; }
  .letterhead .brand .dot { width: 8px; height: 8px; border-radius: 2px; background: #6366f1; }
  .letterhead .title { font-size: 26px; font-weight: 800; margin-top: 6px; letter-spacing: -0.01em; }
  .letterhead .subtitle { font-size: 13px; color: #64748b; margin-top: 2px; }
  .letterhead .meta { text-align: right; font-size: 11px; color: #94a3b8; }
  .letterhead .meta strong { display: block; font-size: 14px; color: #1e293b; font-weight: 700; }

  .summary { display: flex; gap: 12px; margin-bottom: 20px; }
  .summary .stat { flex: 1; background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; }
  .summary .stat .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; font-weight: 700; }
  .summary .stat .value { font-size: 20px; font-weight: 800; margin-top: 3px; color: #1e293b; }

  .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,0.04); }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  thead tr { background: #f1f5f9; }
  th { text-align: left; padding: 10px 14px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; color: #64748b; font-weight: 700; }
  tbody tr:nth-child(even) { background: #fafbfc; }
  tbody tr:not(:last-child) td { border-bottom: 1px solid #f1f5f9; }
  td { padding: 11px 14px; vertical-align: middle; }
  td.time { font-weight: 700; white-space: nowrap; color: #1e293b; }
  td.patient { font-weight: 600; }
  td.duration { font-weight: 700; white-space: nowrap; }
  td.duration .unit { font-weight: 400; color: #94a3b8; }
  td.notes { color: #94a3b8; font-style: italic; max-width: 180px; }
  .pill { display: inline-block; padding: 3px 9px; border-radius: 5px; font-weight: 700; font-size: 10.5px; white-space: nowrap; }
  .empty { padding: 56px 0; text-align: center; color: #94a3b8; font-size: 13px; }
  .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #cbd5e1; letter-spacing: 0.04em; }
  @media print {
    body { padding: 0; background: white; }
    .card { box-shadow: none; }
    @page { margin: 0.6in; }
  }
</style>
</head>
<body>
  <div class="letterhead">
    <div>
      <div class="brand"><span class="dot"></span>PAM Rehab Scheduler</div>
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
    <div class="stat"><div class="label">Total Minutes</div><div class="value">${totalMinutes}</div></div>
  </div>

  <div class="card">
  ${
    rows.length === 0
      ? `<div class="empty">No sessions scheduled for ${escapeHtml(therapistName)} this day.</div>`
      : `<table>
    <thead>
      <tr><th>Time</th><th>Patient</th><th>Type</th><th>Duration</th><th>Status</th><th>Notes</th></tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>`
  }
  </div>

  <div class="footer">PAM REHAB SCHEDULER</div>
</body>
</html>`;
}

function printSchedule(
  therapistName: string,
  dateLabel: string,
  rows: { time: string; patientLabel: string; typeMeta: (typeof THERAPY_META)[TherapyType]; durationMinutes: number; statusLabel: string; notes: string }[],
) {
  const html = buildSchedulePrintHtml(therapistName, dateLabel, rows);
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

export function MySchedule({
  therapists,
  value,
  onChange,
  sessions,
  patients,
  day,
}: MyScheduleProps) {
  const [open, setOpen] = useState(false);

  const therapist = therapists.find((t) => t.id === value);

  const mySessions = useMemo(() => {
    if (!value) return [];
    return sessions
      .filter((s) => s.therapistId === value)
      .sort((a, b) => a.slotIndex - b.slotIndex);
  }, [sessions, value]);

  const patientName = (id: number) => {
    const p = patients.find((x) => x.id === id);
    return p ? `${p.name} · Rm ${p.roomNumber}` : "Unknown";
  };

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
        statusLabel,
        notes: s.missedReason || s.notes || "",
      };
    });
    printSchedule(therapist.name, dateLabel, rows);
  };

  return (
    <>
      <Button
        size="sm"
        className="h-9 rounded-full bg-gradient-to-r from-blue-800 via-sky-600 to-blue-800 px-5 shadow-[0_4px_14px_0_rgba(2,132,199,0.4)] font-bold text-white hover:from-blue-900 hover:via-sky-700 hover:to-blue-900 hover:shadow-[0_6px_20px_rgba(2,132,199,0.5)] border border-sky-400/30 transition-all hover:-translate-y-0.5"
        onClick={() => setOpen(true)}
      >
        <CalendarClock className="mr-2 h-4 w-4" /> My Schedule
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-6">
              <span>My Schedule</span>
              {value && mySessions.length > 0 && (
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={handlePrint}>
                  <Printer className="h-3.5 w-3.5" /> Print
                </Button>
              )}
            </DialogTitle>
            <DialogDescription>{dateLabel}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Select
              value={value ? String(value) : "none"}
              onValueChange={(v) => onChange(v === "none" ? null : Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select therapist" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select therapist…</SelectItem>
                {therapists.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!value ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <User className="h-8 w-8 text-slate-300" />
                <p className="text-sm text-slate-500">
                  Choose a therapist to view their personal day.
                </p>
              </div>
            ) : mySessions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <CalendarClock className="h-8 w-8 text-slate-300" />
                <p className="text-sm text-slate-500">
                  No sessions scheduled for {therapist?.name} today.
                </p>
              </div>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {mySessions.map((s) => {
                  const meta = THERAPY_META[s.therapyType as TherapyType];
                  const slot = TIME_SLOTS[s.slotIndex];
                  return (
                    <li
                      key={s.id}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
                    >
                      <span
                        className="flex h-9 w-11 shrink-0 items-center justify-center rounded text-xs font-bold"
                        style={{ backgroundColor: meta.bg, color: meta.fg }}
                      >
                        {meta.label}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {patientName(s.patientId)}
                        </p>
                        <p className="text-xs text-slate-400">
                          {slot?.shortLabel} · {s.durationMinutes} min
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
