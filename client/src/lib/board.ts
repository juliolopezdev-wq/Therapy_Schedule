// Board-wide constants and helpers

export type TherapyType = "PT" | "OT" | "SLP" | "Eval";
export type FlagType = "DC" | "Name Alert" | "Weekend" | "In-Service" | "Appointment";

export const THERAPY_TYPES: TherapyType[] = ["PT", "OT", "SLP", "Eval"];
export const FLAG_TYPES: FlagType[] = ["DC", "Name Alert", "Weekend", "In-Service", "Appointment"];

export const THERAPY_META: Record<
  TherapyType,
  { label: string; full: string; bg: string; fg: string; accent: string; soft: string }
> = {
  // bg = tile fill, fg = tile text, accent = darker left bar, soft = pale tint for legend/filters
  PT: { label: "PT", full: "Physical Therapy", bg: "#fef08a", fg: "#713f12", accent: "#ca8a04", soft: "#fef9c3" },
  OT: { label: "OT", full: "Occupational Therapy", bg: "#f3e8ff", fg: "#581c87", accent: "#a855f7", soft: "#faf5ff" },
  SLP: { label: "SLP", full: "Speech Therapy", bg: "#e0f2fe", fg: "#0c4a6e", accent: "#0ea5e9", soft: "#f0f9ff" },
  Eval: { label: "Eval", full: "Evaluation", bg: "#d1fae5", fg: "#064e3b", accent: "#10b981", soft: "#f0fdf4" },
};

// Format a slot index into a short clock label, e.g. 8:00
export function slotShortTime(slotIndex: number): string {
  const slot = TIME_SLOTS[slotIndex];
  return slot ? slot.label : "";
}

export const FLAG_META: Record<
  FlagType,
  { label: string; bg: string; fg: string; description: string }
> = {
  DC: { label: "DC", bg: "#fee2e2", fg: "#991b1b", description: "Discharge Scheduled" },
  "Name Alert": { label: "Name Alert", bg: "#ffedd5", fg: "#9a3412", description: "Name Alert (Verify Identity)" },
  Weekend: { label: "Weekend", bg: "#e0f2fe", fg: "#0369a1", description: "Weekend therapy order" },
  "In-Service": { label: "In-Service", bg: "#f3e8ff", fg: "#6b21a8", description: "In-Service training session" },
  Appointment: { label: "Appointment", bg: "#d1fae5", fg: "#065f46", description: "Off-unit clinical appointment" },
};

// Time grid: 7:00 AM to 5:00 PM in 30-minute increments
export const START_HOUR = 7;
export const END_HOUR = 17; // 5 PM
export const SLOT_MINUTES = 30;

export interface TimeSlot {
  index: number;
  hour: number;
  minute: number;
  label: string; // e.g. "7:00"
  shortLabel: string; // e.g. "7:00 AM"
}

export function buildTimeSlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  let index = 0;
  for (let hour = START_HOUR; hour < END_HOUR; hour++) {
    for (let minute = 0; minute < 60; minute += SLOT_MINUTES) {
      const display12 = hour > 12 ? hour - 12 : hour;
      const ampm = hour >= 12 ? "PM" : "AM";
      const mm = minute.toString().padStart(2, "0");
      slots.push({
        index,
        hour,
        minute,
        label: `${display12}:${mm}`,
        shortLabel: `${display12}:${mm} ${ampm}`,
      });
      index++;
    }
  }
  return slots;
}

export const TIME_SLOTS = buildTimeSlots();
export const TOTAL_SLOTS = TIME_SLOTS.length;

// Convert a Date to a slot index (0-based) within the day's grid
export function dateToSlotIndex(date: Date): number {
  const hour = date.getHours();
  const minute = date.getMinutes();
  const totalMinutes = (hour - START_HOUR) * 60 + minute;
  return Math.round(totalMinutes / SLOT_MINUTES);
}

// Build a Date for a given base day + slot index
export function slotIndexToDate(baseDay: Date, slotIndex: number): Date {
  const d = new Date(baseDay);
  const totalMinutes = slotIndex * SLOT_MINUTES;
  const hour = START_HOUR + Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  d.setHours(hour, minute, 0, 0);
  return d;
}

// How many slots a duration spans
export function durationToSlots(durationMinutes: number): number {
  return Math.max(1, Math.round(durationMinutes / SLOT_MINUTES));
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatLongDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday-based week
  d.setDate(d.getDate() + diff);
  return d;
}

export function weekRangeLabel(date: Date): string {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

// Two sessions overlap in time if their slot ranges intersect
export function sessionsOverlap(
  aStart: number,
  aSpan: number,
  bStart: number,
  bSpan: number,
): boolean {
  const aEnd = aStart + aSpan;
  const bEnd = bStart + bSpan;
  return aStart < bEnd && bStart < aEnd;
}
