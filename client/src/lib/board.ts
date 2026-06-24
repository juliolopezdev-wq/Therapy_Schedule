// Board-wide constants and helpers

export type TherapyType = "PT" | "OT" | "SLP" | "Eval";
export type FlagType = "DC" | "Name Alert" | "Weekend" | "In-Service" | "Appointment" | "Stroke Program";

export const THERAPY_TYPES: TherapyType[] = ["PT", "OT", "SLP", "Eval"];
export const FLAG_TYPES: FlagType[] = ["DC", "Name Alert", "Weekend", "In-Service", "Appointment", "Stroke Program"];

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
  "Stroke Program": { label: "Stroke Program", bg: "#fce7f3", fg: "#be185d", description: "Specialized Stroke Program Protocol" },
};

import {
  START_HOUR,
  END_HOUR,
  SLOT_MINUTES,
  dateToSlotIndex,
  slotIndexToDate,
  durationToSlots,
  formatDateKey
} from "../../../shared/timeGrid";

export {
  START_HOUR,
  END_HOUR,
  SLOT_MINUTES,
  dateToSlotIndex,
  slotIndexToDate,
  durationToSlots,
  formatDateKey
};

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

// Exports from shared/timeGrid are now available in board.ts scope

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

export function subDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

export function differenceInDays(laterDate: Date | string, earlierDate: Date | string): number {
  const d1 = new Date(laterDate);
  d1.setHours(0, 0, 0, 0);
  const d2 = new Date(earlierDate);
  d2.setHours(0, 0, 0, 0);
  const diffTime = d1.getTime() - d2.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
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
