export interface WeekendRotationPattern {
  /** JS Date#getDay() values (0=Sun..6=Sat) this pattern applies to, e.g. [0,6] for Sat+Sun, [5] for Friday only. */
  days: number[];
  /** 1 = every week, 2 = every other week, 3 = every third week, etc. */
  intervalWeeks: number;
  /** Any date ("YYYY-MM-DD") that falls inside an "on" week -- the reference point the cycle counts from. */
  anchorDate: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LABELS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Monday-anchored week (not JS's default Sunday-start) so that Friday, Saturday, and Sunday of
// the same weekend always land in the same week bucket -- a Sunday-start week would otherwise
// split a Sat+Sun pair across two different weeks and break the parity check below.
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const offsetFromMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offsetFromMonday);
  return d;
}

function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function parseWeekendRotation(raw: string | null | undefined): WeekendRotationPattern | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.days) || typeof parsed.intervalWeeks !== "number" || typeof parsed.anchorDate !== "string") {
      return null;
    }
    return parsed as WeekendRotationPattern;
  } catch {
    return null;
  }
}

/** Whether `date` falls in an "on" week for this rotation, independent of which day of the week it is. */
export function isOnRotationWeek(pattern: WeekendRotationPattern, date: Date): boolean {
  const interval = Math.max(1, Math.round(pattern.intervalWeeks));
  const weekStart = startOfWeek(date).getTime();
  const anchorWeekStart = startOfWeek(parseLocalDate(pattern.anchorDate)).getTime();
  const weeksBetween = Math.round((weekStart - anchorWeekStart) / (7 * 24 * 60 * 60 * 1000));
  return ((weeksBetween % interval) + interval) % interval === 0;
}

/** Whether a therapist's rotation pattern says they're on for this specific calendar date. */
export function isOnRotationForDate(pattern: WeekendRotationPattern, date: Date): boolean {
  if (!pattern.days.includes(date.getDay())) return false;
  return isOnRotationWeek(pattern, date);
}

/** Short human summary, e.g. "Every other weekend (Sat, Sun)" or "Every 3rd Friday". */
export function describeWeekendRotation(pattern: WeekendRotationPattern): string {
  const dayNames = [...pattern.days].sort().map((d) => DAY_LABELS[d]).join(", ");
  const freq =
    pattern.intervalWeeks === 1 ? "Every week" : pattern.intervalWeeks === 2 ? "Every other week" : `Every ${pattern.intervalWeeks}${ordinalSuffix(pattern.intervalWeeks)} week`;
  const isSingleDay = pattern.days.length === 1;
  const dayWord = isSingleDay ? DAY_LABELS_LONG[pattern.days[0]] : dayNames;
  return pattern.intervalWeeks === 1 ? `Every ${dayWord}` : `${freq} (${dayWord})`;
}

function ordinalSuffix(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "st";
  if (n % 10 === 2 && n % 100 !== 12) return "nd";
  if (n % 10 === 3 && n % 100 !== 13) return "rd";
  return "th";
}
