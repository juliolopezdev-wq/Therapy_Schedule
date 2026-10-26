import { startOfDay, differenceInDays, addDays } from "date-fns";

export type SessionStatus = "scheduled" | "completed" | "canceled_discharge" | "missed_refusal" | "missed_clinical_hold" | "missed_staffing" | "missed_other";
export function isMissedStatus(status: string): boolean {
  return status.startsWith("missed_");
}

export function isCanceledStatus(status: string): boolean {
  return status === "canceled_discharge";
}

export interface WeeklyMinutesSummary {
  patientId: number;
  patientName: string;
  roomNumber: string;
  teamId: number | null;
  estimatedDischargeDate: string | null;
  weekStart: Date;
  weekEnd: Date;
  target: number;
  scheduledMinutes: number;
  completedMinutes: number;
  missedMinutes: number;
  pendingMinutes: number;
  projectedTotalMinutes: number;
  remainingMinutes: number;
  daysRemaining: number;
  atRisk: boolean;
}

/**
 * IRF therapy-intensity weeks are consecutive 7-day periods beginning on the admission date.
 * E.g. admitted Monday -> week 1 runs Monday-Sunday, week 2 starts the following Monday.
 */
function validDate(date: Date): boolean {
  return Number.isFinite(date.getTime());
}

function safeViewedDate(referenceDate: Date): Date {
  const viewed = new Date(referenceDate);
  return startOfDay(validDate(viewed) ? viewed : new Date());
}

function calendarWeekStart(referenceDate: Date): Date {
  const d = safeViewedDate(referenceDate);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday-based week
  d.setDate(d.getDate() + diff);
  return d;
}

/** Parse both current YYYY-MM-DD values and older timestamp/date-string values without ever
 * returning Invalid Date. Invalid legacy values fall back to a normal calendar week. */
function patientWeekEpoch(admissionDateStr: string): Date | null {
  const value = admissionDateStr.trim();
  if (!value) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
      return null;
    }
    return startOfDay(parsed);
  }

  const parsed = new Date(value);
  return validDate(parsed) ? startOfDay(parsed) : null;
}

export function patientWeekStart(admissionDateStr: string | null | undefined, referenceDate: Date): Date {
  const viewed = safeViewedDate(referenceDate);
  if (!admissionDateStr) {
    return calendarWeekStart(viewed);
  }

  const weekEpoch = patientWeekEpoch(admissionDateStr);
  if (!weekEpoch) return calendarWeekStart(viewed);
  const diff = differenceInDays(viewed, weekEpoch);

  if (diff < 0) {
    // Viewing before admission -- fall back to a calendar week until the IRF stay starts.
    return calendarWeekStart(viewed);
  }

  const weeksPassed = Math.floor(diff / 7);
  return addDays(weekEpoch, weeksPassed * 7);
}

export function patientWeekEnd(weekStart: Date): Date {
  const safeStart = validDate(weekStart) ? new Date(weekStart) : calendarWeekStart(new Date());
  const end = new Date(safeStart);
  end.setDate(safeStart.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function daysRemainingInWeek(weekStart: Date, referenceDate: Date): number {
  const viewed = safeViewedDate(referenceDate);
  const end = patientWeekEnd(weekStart);
  const endStartOfDay = startOfDay(end);
  const diff = differenceInDays(endStartOfDay, viewed);
  return Math.max(0, diff + 1); // include today
}

export function formatWeekRangeLabel(weekStart: Date): string {
  const end = patientWeekEnd(weekStart);
  const s = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const e = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${s} - ${e}`;
}

export function getPatientWeekBounds(admissionDateStr: string | null | undefined, viewedDate: Date) {
  const start = patientWeekStart(admissionDateStr, viewedDate);
  const end = patientWeekEnd(start);
  let weekNumber = 1;
  
  if (admissionDateStr) {
    const weekEpoch = patientWeekEpoch(admissionDateStr);
    const viewed = safeViewedDate(viewedDate);
    const diff = weekEpoch ? differenceInDays(viewed, weekEpoch) : -1;
    if (weekEpoch && diff >= 0) {
      weekNumber = Math.floor(diff / 7) + 1;
    }
  }
  return { start, end, weekNumber };
}
