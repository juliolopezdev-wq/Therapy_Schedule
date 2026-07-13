import { startOfWeek, startOfDay, differenceInDays, addDays } from "date-fns";

export type SessionStatus = "scheduled" | "completed" | "missed_refusal" | "missed_clinical_hold" | "missed_staffing" | "missed_other";
export function isMissedStatus(status: string): boolean {
  return status.startsWith("missed_");
}

export interface WeeklyMinutesSummary {
  patientId: number;
  patientName: string;
  roomNumber: string;
  teamId: number | null;
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
 * A patient's personalized week does NOT start on their admission day itself -- it starts the
 * day after admission (their first full day on the unit), and that day resets every 7 days from
 * then on. E.g. admitted Monday -> week 1 runs Tuesday-Monday, week 2 starts the following Tuesday.
 */
function patientWeekEpoch(admissionDateStr: string): Date {
  const adminStart = startOfDay(new Date(`${admissionDateStr}T12:00:00`));
  return addDays(adminStart, 1);
}

export function patientWeekStart(admissionDateStr: string | null | undefined, referenceDate: Date): Date {
  const viewed = startOfDay(referenceDate);
  if (!admissionDateStr) {
    const d = new Date(viewed);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday-based week
    d.setDate(d.getDate() + diff);
    return d;
  }

  const weekEpoch = patientWeekEpoch(admissionDateStr);
  const diff = differenceInDays(viewed, weekEpoch);

  if (diff < 0) {
    // Viewing the admission day itself (or earlier) -- their personalized week hasn't started yet.
    const d = new Date(viewed);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const dif = day === 0 ? -6 : 1 - day; // Monday-based week
    d.setDate(d.getDate() + dif);
    return d;
  }

  const weeksPassed = Math.floor(diff / 7);
  return addDays(weekEpoch, weeksPassed * 7);
}

export function patientWeekEnd(weekStart: Date): Date {
  const end = new Date(weekStart);
  end.setDate(weekStart.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function daysRemainingInWeek(weekStart: Date, referenceDate: Date): number {
  const viewed = startOfDay(referenceDate);
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
    const viewed = startOfDay(viewedDate);
    const diff = differenceInDays(viewed, weekEpoch);
    if (diff >= 0) {
      weekNumber = Math.floor(diff / 7) + 1;
    }
  }
  return { start, end, weekNumber };
}
