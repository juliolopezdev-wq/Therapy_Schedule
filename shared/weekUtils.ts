import { startOfWeek, startOfDay, differenceInDays, addDays } from "date-fns";

export interface WeeklyMinutesSummary {
  patientId: number;
  patientName: string;
  roomNumber: string;
  teamId: number | null;
  weekStart: Date;
  weekEnd: Date;
  target: number;
  completedMinutes: number;
  remainingMinutes: number;
  daysRemaining: number;
  atRisk: boolean;
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

  const adminStart = startOfDay(new Date(`${admissionDateStr}T12:00:00`));
  const diff = differenceInDays(viewed, adminStart);
  
  if (diff < 0) {
    const d = new Date(viewed);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const dif = day === 0 ? -6 : 1 - day; // Monday-based week
    d.setDate(d.getDate() + dif);
    return d;
  }

  const weeksPassed = Math.floor(diff / 7);
  return addDays(adminStart, weeksPassed * 7);
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
    const adminStart = startOfDay(new Date(`${admissionDateStr}T12:00:00`));
    const viewed = startOfDay(viewedDate);
    const diff = differenceInDays(viewed, adminStart);
    if (diff >= 0) {
      weekNumber = Math.floor(diff / 7) + 1;
    }
  }
  return { start, end, weekNumber };
}
