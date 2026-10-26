export interface SessionTiming {
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
}

/** Returns a user-safe validation message when persisted session timing would be inconsistent. */
export function getSessionTimingError({ startTime, endTime, durationMinutes }: SessionTiming): string | null {
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "Session start and end times are required.";
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return "Session duration must be a positive whole number of minutes.";
  }
  if (endMs <= startMs) return "Session end time must be after its start time.";

  const elapsedMinutes = (endMs - startMs) / 60_000;
  if (elapsedMinutes !== durationMinutes) {
    return "Session duration must match the selected start and end times.";
  }

  return null;
}
