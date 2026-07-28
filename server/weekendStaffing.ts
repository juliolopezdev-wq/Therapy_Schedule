import { getTherapists, getTherapySessionsForDateRange, getWeekendOverridesForRange, setWeekendOverride } from "./db";
import { getShiftForDay } from "./scheduling";
import { isOnRotationForDate, parseWeekendRotation, describeWeekendRotation } from "./weekendRotation";
import type { Therapist } from "../drizzle/schema";

export type CoverageSource = "override" | "rotation" | "fixed_schedule" | "none";

export interface CoverageEntry {
  therapistId: number;
  name: string;
  therapyType: string;
  employmentType: string;
  working: boolean;
  source: CoverageSource;
  rotationLabel: string | null;
  sessionCount: number;
}

export interface CoverageDay {
  date: string; // ISO date, midnight local
  dayLabel: string; // "Friday", "Saturday", "Sunday"
  entries: CoverageEntry[];
}

const WEEKEND_DAYS = [5, 6, 0]; // Fri, Sat, Sun -- covers "every other Friday" as well as classic Sat/Sun weekends
const DAY_LABELS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function startOfDayLocal(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The Friday/Saturday/Sunday of the weekend that contains or follows referenceDate. */
export function getUpcomingWeekendDays(referenceDate: Date = new Date()): Date[] {
  const start = startOfDayLocal(referenceDate);
  const dayIdx = start.getDay();
  // Days until the next Friday (0 if today is already Fri/Sat/Sun and we want *this* weekend).
  let deltaToFriday: number;
  if (dayIdx === 5 || dayIdx === 6 || dayIdx === 0) {
    deltaToFriday = dayIdx === 5 ? 0 : dayIdx === 6 ? -1 : -2;
  } else {
    deltaToFriday = 5 - dayIdx;
  }
  const friday = new Date(start);
  friday.setDate(friday.getDate() + deltaToFriday);
  return [0, 1, 2].map((offset) => {
    const d = new Date(friday);
    d.setDate(d.getDate() + offset);
    return d;
  });
}

function computeDefaultWorking(therapist: Therapist, date: Date): { working: boolean; source: CoverageSource; rotationLabel: string | null } {
  if (therapist.employmentType === "full_time") {
    const shift = getShiftForDay(therapist, date);
    return { working: shift.active, source: "fixed_schedule", rotationLabel: null };
  }

  const pattern = parseWeekendRotation(therapist.weekendRotation);
  if (pattern) {
    return {
      working: isOnRotationForDate(pattern, date),
      source: "rotation",
      rotationLabel: describeWeekendRotation(pattern),
    };
  }

  // Part-time/PRN with no rotation configured yet -- fall back to their static workDays/workHours
  // (e.g. a part-timer who just always works Saturdays, no alternating pattern needed).
  const shift = getShiftForDay(therapist, date);
  return { working: shift.active, source: shift.active ? "fixed_schedule" : "none", rotationLabel: null };
}

/**
 * Builds weekend coverage for the Fri/Sat/Sun surrounding referenceDate: for every therapist,
 * whether they're expected to work each of those three days and why (an explicit manual
 * override, their rotation cycle, a fixed non-rotating schedule, or nothing configured), plus
 * how many sessions are already booked for them that day so gaps are visible at a glance.
 */
export async function getWeekendCoverage(referenceDate: Date = new Date()): Promise<CoverageDay[]> {
  const days = getUpcomingWeekendDays(referenceDate);
  const [therapists, overrides, ...sessionsByDay] = await Promise.all([
    getTherapists(),
    getWeekendOverridesForRange(days[0], days[2]),
    ...days.map((d) => getTherapySessionsForDateRange(d, d)),
  ]);

  return days.map((date, i) => {
    const sessions = sessionsByDay[i];
    const sessionCountByTherapist = new Map<number, number>();
    for (const s of sessions) {
      if (s.therapistId == null || s.therapyType === "Block") continue;
      sessionCountByTherapist.set(s.therapistId, (sessionCountByTherapist.get(s.therapistId) ?? 0) + 1);
    }

    const entries: CoverageEntry[] = therapists.map((t) => {
      const override = overrides.find((o) => o.therapistId === t.id && startOfDayLocal(new Date(o.date)).getTime() === date.getTime());
      const computed = computeDefaultWorking(t, date);
      const working = override ? override.working : computed.working;
      const source: CoverageSource = override ? "override" : computed.source;
      return {
        therapistId: t.id,
        name: t.name,
        therapyType: t.therapyType,
        employmentType: t.employmentType,
        working,
        source,
        rotationLabel: computed.rotationLabel,
        sessionCount: sessionCountByTherapist.get(t.id) ?? 0,
      };
    });

    return { date: date.toISOString(), dayLabel: DAY_LABELS_LONG[date.getDay()], entries };
  });
}

export interface AutoAssignResult {
  confirmed: { therapistId: number; therapistName: string; date: string }[];
}

/**
 * The "AI assign" action: for the upcoming weekend, writes an explicit override confirming
 * every therapist the rotation/fixed-schedule computation already says should be working --
 * turning the computed default into a locked-in plan without the admin manually checking each
 * box. Already-overridden days are left alone (both true and false -- a manual "not working"
 * call is never silently flipped back on).
 */
export async function autoAssignWeekendStaff(referenceDate: Date = new Date()): Promise<AutoAssignResult> {
  const coverage = await getWeekendCoverage(referenceDate);
  const confirmed: AutoAssignResult["confirmed"] = [];

  for (const day of coverage) {
    for (const entry of day.entries) {
      if (entry.source === "override") continue;
      if (!entry.working) continue;
      await setWeekendOverride(entry.therapistId, new Date(day.date), true);
      confirmed.push({ therapistId: entry.therapistId, therapistName: entry.name, date: day.date });
    }
  }

  return { confirmed };
}
