import { useMemo, useState } from "react";
import { usePermissions } from "@/_core/hooks/usePermissions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Printer, ClipboardList, MoveRight } from "lucide-react";
import { THERAPY_META, TIME_SLOTS, formatLongDate, isCanceledStatus, type SessionStatus, type TherapyType } from "@/lib/board";
import type { SessionTileData } from "./SessionTile";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { nameWithoutTrailingInitial } from "@shared/printPrivacy";

interface PatientDayQuickViewProps {
  patient: { id: number; name: string; roomNumber: string; accessLevel?: "full" | "schedule" };
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
  status: SessionStatus;
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
      status: s.status,
    }));
}

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #0f172a;
    margin: 0;
    padding: 40px;
    background: #eef4fb;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { width: 100%; max-width: 680px; min-height: 9.2in; margin: 0 auto; padding: 30px; background: white; border-radius: 20px; box-shadow: 0 12px 35px rgba(15,23,42,0.10); }
  .sheet:not(:last-child) { margin-bottom: 42px; break-after: page; page-break-after: always; }
  .topline { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid #dbe4f0; }
  .brand { display: inline-flex; align-items: center; gap: 8px; font-size: 10px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; color: #1d4ed8; }
  .brand .dot { width: 9px; height: 9px; border-radius: 3px; background: linear-gradient(135deg,#1d4ed8,#0284c7); }
  .date { font-size: 12px; font-weight: 750; color: #475569; }
  .identity { margin: 22px 0 20px; padding: 20px 22px; border: 1px solid #bfdbfe; border-left: 6px solid #2563eb; border-radius: 14px; background: #eff6ff; }
  .eyebrow { font-size: 10px; font-weight: 900; letter-spacing: 0.13em; text-transform: uppercase; color: #2563eb; }
  .identity-line { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 6px; }
  .patient-name { font-size: 29px; line-height: 1.05; font-weight: 850; letter-spacing: -0.025em; }
  .room { flex-shrink: 0; font-size: 14px; font-weight: 850; color: #1e3a8a; background: white; border: 1px solid #bfdbfe; border-radius: 10px; padding: 8px 12px; }
  .plan-summary { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 9px; }
  .plan-title { font-size: 14px; font-weight: 850; }
  .plan-meta { font-size: 11px; font-weight: 700; color: #64748b; }
  .card { background: white; border: 1px solid #cbd5e1; border-radius: 14px; overflow: hidden; }
  .row { display: flex; min-height: 78px; align-items: stretch; break-inside: avoid; page-break-inside: avoid; }
  .row:not(:last-child) { border-bottom: 1px solid #e2e8f0; }
  .row.canceled { background: #f1f5f9; color: #64748b; }
  .row.canceled .time, .row.canceled .type { text-decoration: line-through; }
  .canceled-label { display: inline-block; width: fit-content; margin-top: 5px; padding: 3px 7px; border: 1px solid #cbd5e1; border-radius: 999px; background: white; color: #475569; font-size: 9px; font-weight: 850; letter-spacing: 0.04em; text-transform: uppercase; }
  .number { width: 34px; display: flex; align-items: center; justify-content: center; background: #f8fafc; color: #94a3b8; font-size: 11px; font-weight: 900; }
  .time-col { width: 105px; flex-shrink: 0; padding: 18px 14px; }
  .time { font-size: 18px; font-weight: 850; letter-spacing: -0.01em; }
  .duration { font-size: 11px; color: #64748b; margin-top: 3px; font-weight: 650; }
  .bar { width: 5px; flex-shrink: 0; }
  .info { min-width: 0; flex: 1; padding: 17px 20px; display: flex; flex-direction: column; justify-content: center; }
  .type { font-size: 16px; font-weight: 800; }
  .therapist { font-size: 12px; color: #64748b; margin-top: 4px; }
  .empty { text-align: center; padding: 64px 24px; color: #64748b; font-size: 14px; background: #f8fafc; border: 1px dashed #94a3b8; border-radius: 14px; }
  .footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 22px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; }
  .footer strong { color: #64748b; letter-spacing: 0.08em; }
  @media print {
    body { padding: 0; background: white; }
    .sheet { max-width: none; min-height: 0; padding: 0; border-radius: 0; box-shadow: none; }
    .sheet:not(:last-child) { margin-bottom: 0; }
    @page { size: portrait; margin: 0.45in; }
  }
`;

function scheduleSheetHtml(patientName: string, roomNumber: string, dateLabel: string, rows: ScheduleRow[]): string {
  const activeRows = rows.filter((row) => !isCanceledStatus(row.status));
  const cards = rows
    .map(
      (r, index) => `<div class="row${isCanceledStatus(r.status) ? " canceled" : ""}">
        <div class="number">${index + 1}</div>
        <div class="time-col">
          <div class="time">${escapeHtml(r.time)}</div>
          <div class="duration">${escapeHtml(r.durationMinutes.toString())} min</div>
        </div>
        <div class="bar" style="background:${r.typeMeta.accent}"></div>
        <div class="info">
          <div class="type">${escapeHtml(r.typeMeta.full)}</div>
          ${isCanceledStatus(r.status) ? `<div class="canceled-label">Canceled — discharged</div>` : ""}
          ${r.therapistName ? `<div class="therapist">with ${escapeHtml(r.therapistName)}</div>` : ""}
        </div>
      </div>`,
    )
    .join("");

  return `<div class="sheet">
  <div class="topline">
    <div class="brand"><span class="dot"></span>MinuteMinder</div>
    <div class="date">${escapeHtml(dateLabel)}</div>
  </div>
  <div class="identity">
    <div class="eyebrow">Your therapy schedule</div>
    <div class="identity-line"><div class="patient-name">${escapeHtml(patientName)}</div><div class="room">Room ${escapeHtml(roomNumber)}</div></div>
  </div>
  <div class="plan-summary"><div class="plan-title">Today’s sessions</div><div class="plan-meta">${activeRows.length} active session${activeRows.length === 1 ? "" : "s"} · ${activeRows.reduce((total, row) => total + row.durationMinutes, 0)} minutes</div></div>

  ${
    rows.length === 0
      ? `<div class="empty">No therapy sessions scheduled for today.</div>`
      : `<div class="card">${cards}</div>`
  }

  <div class="footer"><strong>MINUTEMINDER</strong><span>Please be ready at the scheduled time. Times may change during the day.</span></div>
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

function openAndPrint(html: string): boolean {
  const win = window.open("", "_blank", "width=800,height=1000");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
  return true;
}

function printPatientDay(patientName: string, roomNumber: string, dateLabel: string, rows: ScheduleRow[]) {
  openAndPrint(buildPatientPrintHtml(patientName, roomNumber, dateLabel, rows.map((row) => ({
    ...row,
    therapistName: row.therapistName ? nameWithoutTrailingInitial(row.therapistName) : null,
  }))));
}

export function printAllPatientSchedules(
  patients: { id: number; name: string; roomNumber: string }[],
  day: Date,
  sessions: SessionTileData[],
  therapists: { id: number; name: string }[],
  options?: { includeTherapistNames?: boolean; sortBy?: "room" | "name" },
): boolean {
  const dateLabel = formatLongDate(day);
  const includeTherapistNames = options?.includeTherapistNames ?? true;
  const entries = patients
    .slice()
    .sort((a, b) => options?.sortBy === "name"
      ? a.name.localeCompare(b.name)
      : a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
    .map((p) => ({
      patientName: p.name,
      roomNumber: p.roomNumber,
      rows: getPatientScheduleRows(p.id, sessions, therapists).map((row) => ({
        ...row,
        therapistName: includeTherapistNames && row.therapistName ? nameWithoutTrailingInitial(row.therapistName) : null,
      })),
    }));
  return openAndPrint(buildAllPatientsPrintHtml(entries, dateLabel));
}

export function PatientDayQuickView({ patient, day, sessions, therapists }: PatientDayQuickViewProps) {
  const { canEdit, isAdmin } = usePermissions();
  const canManagePatient = isAdmin || (canEdit && patient.accessLevel === "full");
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const moveSessions = trpc.sessions.movePatientSessionsToNextDay.useMutation({
    onSuccess: (res) => {
      utils.sessions.list.invalidate();
      utils.sessions.listForWeek.invalidate();
      toast.success(`Transferred ${res.count} session(s) to tomorrow.`);
      setOpen(false);
    },
    onError: () => {
      toast.error("Could not transfer sessions to tomorrow.");
    }
  });

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
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:scale-95"
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
              <div className="flex items-center gap-2">
                {canManagePatient && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1.5 text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-50 border-amber-200"
                    onClick={() => {
                      if (confirm("Move all of this patient's sessions from today to tomorrow?")) {
                        moveSessions.mutate({ patientId: patient.id, date: day });
                      }
                    }}
                    disabled={moveSessions.isPending || rows.length === 0}
                  >
                    <MoveRight className="h-3.5 w-3.5" /> Transfer
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 text-xs"
                  onClick={() => printPatientDay(patient.name, patient.roomNumber, dateLabel, rows)}
                >
                  <Printer className="h-3.5 w-3.5" /> Print
                </Button>
              </div>
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
