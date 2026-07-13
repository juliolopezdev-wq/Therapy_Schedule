import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Printer, ClipboardList } from "lucide-react";
import { THERAPY_META, TIME_SLOTS, formatLongDate, type TherapyType } from "@/lib/board";
import type { SessionTileData } from "./SessionTile";

interface PatientDayQuickViewProps {
  patient: { id: number; name: string; roomNumber: string };
  day: Date;
  sessions: SessionTileData[];
  therapists: { id: number; name: string }[];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export interface ScheduleRow {
  time: string;
  typeMeta: (typeof THERAPY_META)[TherapyType];
  durationMinutes: number;
  therapistName: string | null;
}

/** Shared row-building logic so the single-patient quickview and the "print all" batch stay in sync. */
export function getPatientScheduleRows(
  patientId: number,
  sessions: SessionTileData[],
  therapists: { id: number; name: string }[],
): ScheduleRow[] {
  return sessions
    .filter((s) => s.patientId === patientId && s.therapyType !== "Block")
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((s) => ({
      time: TIME_SLOTS[s.slotIndex]?.shortLabel ?? "",
      typeMeta: THERAPY_META[s.therapyType as TherapyType],
      durationMinutes: s.durationMinutes,
      therapistName: s.therapistId != null ? therapists.find((t) => t.id === s.therapistId)?.name ?? null : null,
    }));
}

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #1e293b;
    padding: 48px;
    background: #f8fafc;
  }
  .sheet:not(:last-child) { page-break-after: always; }
  .header { text-align: center; margin-bottom: 32px; }
  .brand { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #6366f1; margin-bottom: 18px; }
  .brand .dot { width: 8px; height: 8px; border-radius: 2px; background: #6366f1; }
  .patient-name { font-size: 32px; font-weight: 800; letter-spacing: -0.01em; }
  .room { display: inline-block; margin-top: 6px; font-size: 13px; font-weight: 700; color: #64748b; background: #f1f5f9; border-radius: 999px; padding: 4px 14px; }
  .date { margin-top: 16px; font-size: 17px; font-weight: 600; color: #475569; }

  .card { max-width: 560px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 1px 3px rgba(15,23,42,0.05); overflow: hidden; }
  .row { display: flex; align-items: stretch; gap: 0; }
  .row:not(:last-child) { border-bottom: 1px solid #f1f5f9; }
  .time-col { width: 110px; flex-shrink: 0; padding: 18px 14px; text-align: right; }
  .time { font-size: 17px; font-weight: 800; }
  .duration { font-size: 12px; color: #94a3b8; margin-top: 2px; }
  .bar { width: 5px; flex-shrink: 0; }
  .info { padding: 18px 20px; display: flex; flex-direction: column; justify-content: center; }
  .type { font-size: 16px; font-weight: 700; }
  .therapist { font-size: 13px; color: #64748b; margin-top: 2px; }

  .empty { max-width: 560px; margin: 0 auto; text-align: center; padding: 56px 24px; color: #94a3b8; font-size: 15px; background: white; border: 1px solid #e2e8f0; border-radius: 16px; }
  .footer { margin-top: 32px; text-align: center; font-size: 11px; color: #cbd5e1; letter-spacing: 0.04em; }
  @media print {
    body { padding: 0.4in; background: white; }
    .card, .empty { box-shadow: none; }
    @page { margin: 0.5in; }
  }
`;

function scheduleSheetHtml(patientName: string, roomNumber: string, dateLabel: string, rows: ScheduleRow[]): string {
  const cards = rows
    .map(
      (r) => `<div class="row">
        <div class="time-col">
          <div class="time">${escapeHtml(r.time)}</div>
          <div class="duration">${escapeHtml(r.durationMinutes.toString())} min</div>
        </div>
        <div class="bar" style="background:${r.typeMeta.accent}"></div>
        <div class="info">
          <div class="type">${escapeHtml(r.typeMeta.full)}</div>
          ${r.therapistName ? `<div class="therapist">with ${escapeHtml(r.therapistName)}</div>` : ""}
        </div>
      </div>`,
    )
    .join("");

  return `<div class="sheet">
  <div class="header">
    <div class="brand"><span class="dot"></span>PAM Rehab Scheduler</div>
    <div class="patient-name">${escapeHtml(patientName)}</div>
    <div class="room">Room ${escapeHtml(roomNumber)}</div>
    <div class="date">${escapeHtml(dateLabel)}</div>
  </div>

  ${
    rows.length === 0
      ? `<div class="empty">No therapy sessions scheduled for today.</div>`
      : `<div class="card">${cards}</div>`
  }

  <div class="footer">PAM REHAB SCHEDULER</div>
</div>`;
}

function buildPatientPrintHtml(patientName: string, roomNumber: string, dateLabel: string, rows: ScheduleRow[]): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Schedule — ${escapeHtml(patientName)} — ${escapeHtml(dateLabel)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>${scheduleSheetHtml(patientName, roomNumber, dateLabel, rows)}</body>
</html>`;
}

export function buildAllPatientsPrintHtml(
  entries: { patientName: string; roomNumber: string; rows: ScheduleRow[] }[],
  dateLabel: string,
): string {
  const sheets = entries.map((e) => scheduleSheetHtml(e.patientName, e.roomNumber, dateLabel, e.rows)).join("\n");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Patient Schedules — ${escapeHtml(dateLabel)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>${sheets}</body>
</html>`;
}

function openAndPrint(html: string) {
  const win = window.open("", "_blank", "width=800,height=1000");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function printPatientDay(patientName: string, roomNumber: string, dateLabel: string, rows: ScheduleRow[]) {
  openAndPrint(buildPatientPrintHtml(patientName, roomNumber, dateLabel, rows));
}

export function printAllPatientSchedules(
  patients: { id: number; name: string; roomNumber: string }[],
  day: Date,
  sessions: SessionTileData[],
  therapists: { id: number; name: string }[],
) {
  const dateLabel = formatLongDate(day);
  const entries = patients
    .slice()
    .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
    .map((p) => ({
      patientName: p.name,
      roomNumber: p.roomNumber,
      rows: getPatientScheduleRows(p.id, sessions, therapists),
    }));
  openAndPrint(buildAllPatientsPrintHtml(entries, dateLabel));
}

export function PatientDayQuickView({ patient, day, sessions, therapists }: PatientDayQuickViewProps) {
  const [open, setOpen] = useState(false);

  const rows = useMemo<ScheduleRow[]>(
    () => getPatientScheduleRows(patient.id, sessions, therapists),
    [sessions, patient.id, therapists],
  );

  const dateLabel = formatLongDate(day);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:scale-95"
            aria-label="View & print today's schedule"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
          >
            <ClipboardList className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>View & print today's schedule</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-6">
              <span className="truncate">
                {patient.name} · Rm {patient.roomNumber}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1.5 text-xs"
                onClick={() => printPatientDay(patient.name, patient.roomNumber, dateLabel, rows)}
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </Button>
            </DialogTitle>
            <DialogDescription>{dateLabel}</DialogDescription>
          </DialogHeader>

          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <ClipboardList className="h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">No therapy sessions scheduled for today.</p>
            </div>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {rows.map((r, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
                >
                  <span
                    className="flex h-9 w-11 shrink-0 items-center justify-center rounded text-xs font-bold"
                    style={{ backgroundColor: r.typeMeta.bg, color: r.typeMeta.fg }}
                  >
                    {r.typeMeta.label}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{r.typeMeta.full}</p>
                    <p className="text-xs text-slate-400">
                      {r.time} · {r.durationMinutes} min
                      {r.therapistName ? ` · ${r.therapistName}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
