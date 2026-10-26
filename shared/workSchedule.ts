import { END_HOUR, START_HOUR } from "./timeGrid";

export interface StaffSchedule {
  workDays: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  workHours?: string | null;
}

export const MEAL_BREAK_MINUTES = 30;
export const MEAL_BREAK_MINIMUM_SHIFT_MINUTES = 6 * 60;

function parseTimeToMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

export function getShiftForDay(
  staff: StaffSchedule,
  day: Date,
): { active: boolean; startMin: number; endMin: number } {
  const dayIndex = day.getDay();

  if (staff.workHours) {
    try {
      const parsed = JSON.parse(staff.workHours);
      const daySchedule = parsed[String(dayIndex)];
      if (daySchedule) {
        if (!daySchedule.active) return { active: false, startMin: 0, endMin: 0 };
        return {
          active: true,
          startMin: daySchedule.start ? parseTimeToMinutes(daySchedule.start) : START_HOUR * 60,
          endMin: daySchedule.end ? parseTimeToMinutes(daySchedule.end) : END_HOUR * 60,
        };
      }
    } catch {
      // Fall through to the standing schedule when per-day JSON is invalid.
    }
  }

  if (staff.workDays) {
    const workDays = staff.workDays.split(",").map(Number);
    if (!workDays.includes(dayIndex)) return { active: false, startMin: 0, endMin: 0 };
  }

  return {
    active: true,
    startMin: staff.workStartTime ? parseTimeToMinutes(staff.workStartTime) : START_HOUR * 60,
    endMin: staff.workEndTime ? parseTimeToMinutes(staff.workEndTime) : END_HOUR * 60,
  };
}

/** Paid/bookable minutes for productivity and capacity planning. */
export function availableShiftMinutesForDay(staff: StaffSchedule, day: Date): number {
  const shift = getShiftForDay(staff, day);
  if (!shift.active) return 0;

  const grossMinutes = Math.max(0, shift.endMin - shift.startMin);
  const mealMinutes = grossMinutes >= MEAL_BREAK_MINIMUM_SHIFT_MINUTES ? MEAL_BREAK_MINUTES : 0;
  return Math.max(0, grossMinutes - mealMinutes);
}
