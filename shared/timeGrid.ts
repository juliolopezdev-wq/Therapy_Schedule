export const START_HOUR = 7;
export const END_HOUR = 17; // 5 PM
export const SLOT_MINUTES = 30;

function buildSlotCount(): number {
  return ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;
}

export const TOTAL_SLOTS = buildSlotCount();

export function dateToSlotIndex(date: Date): number {
  const hour = date.getHours();
  const minute = date.getMinutes();
  const totalMinutes = (hour - START_HOUR) * 60 + minute;
  return Math.round(totalMinutes / SLOT_MINUTES);
}

export function slotIndexToDate(baseDay: Date, slotIndex: number): Date {
  const d = new Date(baseDay);
  const totalMinutes = slotIndex * SLOT_MINUTES;
  const hour = START_HOUR + Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function durationToSlots(durationMinutes: number): number {
  return Math.max(1, Math.round(durationMinutes / SLOT_MINUTES));
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}
