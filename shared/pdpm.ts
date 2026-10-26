// PDPM variable per diem adjustment + Medicare Part A benefit-period awareness.
// These are the foundational PDPM mechanics that have held since its 2019 implementation
// (CMS can and does revise specifics) -- this is a planning aid, not a billing/MDS system,
// and does not replace verifying the current rule set with your MDS/billing team.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayOfStay(admissionDate: Date, asOfDate: Date): number {
  const diff = Math.floor((asOfDate.getTime() - admissionDate.getTime()) / MS_PER_DAY);
  return diff + 1; // admission day itself is day 1
}

/** PT/OT variable per diem: no adjustment through day 20, then the per diem rate steps down
 *  2% every 7 days starting day 21 (day 21-27 = 0.98x, day 28-34 = 0.96x, ...). */
export function ptOtAdjustmentFactor(day: number): number {
  if (day <= 20) return 1.0;
  const periodsPast20 = Math.floor((day - 21) / 7) + 1;
  return Math.round((1.0 - periodsPast20 * 0.02) * 100) / 100;
}

/** NTA variable per diem: 3x the base NTA rate for days 1-3, then 1x from day 4 on. */
export function ntaAdjustmentFactor(day: number): number {
  return day <= 3 ? 3.0 : 1.0;
}

export interface PdpmTimelineEvent {
  day: number;
  date: string; // "YYYY-MM-DD"
  label: string;
}

/** Upcoming adjustment-day events from `asOfDate` forward, within `horizonDays`. */
export function upcomingPdpmEvents(admissionDateStr: string, asOfDate: Date, horizonDays: number = 14): PdpmTimelineEvent[] {
  const admissionDate = new Date(admissionDateStr);
  if (Number.isNaN(admissionDate.getTime())) return [];
  const currentDay = dayOfStay(admissionDate, asOfDate);
  const events: PdpmTimelineEvent[] = [];

  // NTA rate drop at day 4 (only relevant while still in days 1-3).
  if (currentDay >= 1 && currentDay <= 3) {
    const date = new Date(admissionDate.getTime() + 3 * MS_PER_DAY);
    events.push({ day: 4, date: date.toISOString().slice(0, 10), label: "NTA variable per diem drops from 3x to 1x" });
  }

  // PT/OT 2% step-downs every 7 days from day 21 on.
  for (let day = 21; day <= currentDay + horizonDays; day += 7) {
    if (day < currentDay) continue;
    const date = new Date(admissionDate.getTime() + (day - 1) * MS_PER_DAY);
    const factor = ptOtAdjustmentFactor(day);
    events.push({ day, date: date.toISOString().slice(0, 10), label: `PT/OT variable per diem steps down to ${Math.round(factor * 100)}%` });
  }

  // Medicare Part A SNF benefit period caps out at 100 days.
  if (currentDay <= 100 && 100 - currentDay <= horizonDays) {
    const date = new Date(admissionDate.getTime() + 99 * MS_PER_DAY);
    events.push({ day: 100, date: date.toISOString().slice(0, 10), label: "Medicare Part A 100-day SNF benefit period ends" });
  }

  return events.filter((e) => e.day >= currentDay).sort((a, b) => a.day - b.day);
}
