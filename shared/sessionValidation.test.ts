import { describe, expect, it } from "vitest";
import { getSessionTimingError } from "./sessionValidation";

const startTime = new Date("2026-10-20T09:00:00.000Z");

describe("getSessionTimingError", () => {
  it("accepts consistent session timing", () => {
    expect(getSessionTimingError({
      startTime,
      endTime: new Date("2026-10-20T09:45:00.000Z"),
      durationMinutes: 45,
    })).toBeNull();
  });

  it("rejects an end before the start", () => {
    expect(getSessionTimingError({
      startTime,
      endTime: new Date("2026-10-20T08:30:00.000Z"),
      durationMinutes: 30,
    })).toMatch(/after its start/);
  });

  it("rejects a duration that does not match the time range", () => {
    expect(getSessionTimingError({
      startTime,
      endTime: new Date("2026-10-20T10:00:00.000Z"),
      durationMinutes: 30,
    })).toMatch(/must match/);
  });

  it("rejects fractional and non-positive durations", () => {
    expect(getSessionTimingError({ startTime, endTime: new Date("2026-10-20T09:30:00.000Z"), durationMinutes: 0 })).toMatch(/positive whole/);
    expect(getSessionTimingError({ startTime, endTime: new Date("2026-10-20T09:30:00.000Z"), durationMinutes: 30.5 })).toMatch(/positive whole/);
  });
});
