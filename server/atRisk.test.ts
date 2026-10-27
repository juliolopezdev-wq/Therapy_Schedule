import { describe, expect, it } from "vitest";
import { isAtRisk } from "./scheduling";

// 900-minute week: an even share is ~129 min/day
const base = { target: 900, completedMinutes: 0, pendingMinutes: 0, pendingTodayMinutes: 0, daysRemaining: 7 };

describe("isAtRisk", () => {
  it("does not flag a patient on pace whose later days just aren't booked yet", () => {
    // day 2: 130 delivered yesterday, 135 booked today, nothing booked after
    expect(isAtRisk({ ...base, completedMinutes: 130, pendingMinutes: 135, pendingTodayMinutes: 135, daysRemaining: 6 })).toBe(false);
  });

  it("flags a patient with nothing delivered or booked today", () => {
    expect(isAtRisk({ ...base, daysRemaining: 7 })).toBe(true);
  });

  it("flags a patient who is behind pace mid-week", () => {
    // day 4: should have ~514 by tonight, has 300 + 60 booked
    expect(isAtRisk({ ...base, completedMinutes: 300, pendingMinutes: 60, pendingTodayMinutes: 60, daysRemaining: 4 })).toBe(true);
  });

  it("flags a patient on pace who still can't fit the remaining minutes", () => {
    // 2000-min week, day 6: on pace (1720 >= 1714) but 280 unbooked with one day left (max 240)
    expect(isAtRisk({ ...base, target: 2000, completedMinutes: 1720, daysRemaining: 2 })).toBe(true);
    expect(isAtRisk({ ...base, target: 2000, completedMinutes: 1780, daysRemaining: 2 })).toBe(false);
  });

  it("never flags a patient whose week is fully booked or delivered", () => {
    expect(isAtRisk({ ...base, completedMinutes: 200, pendingMinutes: 700, pendingTodayMinutes: 0, daysRemaining: 3 })).toBe(false);
    expect(isAtRisk({ ...base, completedMinutes: 950, daysRemaining: 1 })).toBe(false);
  });

  it("uses a modified target when one is set", () => {
    expect(isAtRisk({ ...base, target: 450, completedMinutes: 70, pendingMinutes: 0, pendingTodayMinutes: 0, daysRemaining: 6 })).toBe(true);
    expect(isAtRisk({ ...base, target: 450, completedMinutes: 70, pendingMinutes: 65, pendingTodayMinutes: 65, daysRemaining: 6 })).toBe(false);
  });
});
