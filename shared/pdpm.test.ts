import { describe, expect, it } from "vitest";
import { ntaAdjustmentFactor, ptOtAdjustmentFactor, upcomingPdpmEvents } from "./pdpm";

describe("ptOtAdjustmentFactor", () => {
  it("stays at 1.0 through day 20", () => {
    expect(ptOtAdjustmentFactor(1)).toBe(1.0);
    expect(ptOtAdjustmentFactor(20)).toBe(1.0);
  });
  it("steps down 2% every 7 days starting day 21", () => {
    expect(ptOtAdjustmentFactor(21)).toBe(0.98);
    expect(ptOtAdjustmentFactor(27)).toBe(0.98);
    expect(ptOtAdjustmentFactor(28)).toBe(0.96);
    expect(ptOtAdjustmentFactor(35)).toBe(0.94);
  });
});

describe("ntaAdjustmentFactor", () => {
  it("is 3x for days 1-3 and 1x after", () => {
    expect(ntaAdjustmentFactor(1)).toBe(3.0);
    expect(ntaAdjustmentFactor(3)).toBe(3.0);
    expect(ntaAdjustmentFactor(4)).toBe(1.0);
  });
});

describe("upcomingPdpmEvents", () => {
  it("flags the NTA drop during days 1-3", () => {
    const admission = new Date(2026, 0, 1); // Jan 1
    const asOf = new Date(2026, 0, 2); // day 2
    const events = upcomingPdpmEvents(admission.toISOString().slice(0, 10), asOf, 14);
    expect(events.some((e) => e.day === 4 && e.label.includes("NTA"))).toBe(true);
  });

  it("flags an upcoming PT/OT step-down within the horizon", () => {
    const admission = new Date(2026, 0, 1);
    const asOf = new Date(2026, 0, 15); // day 15, 6 days before day 21
    const events = upcomingPdpmEvents(admission.toISOString().slice(0, 10), asOf, 14);
    expect(events.some((e) => e.day === 21)).toBe(true);
  });

  it("flags the day-100 benefit period end as it approaches", () => {
    const admission = new Date(2026, 0, 1);
    const asOf = new Date(2026, 3, 1); // ~day 91
    const events = upcomingPdpmEvents(admission.toISOString().slice(0, 10), asOf, 14);
    expect(events.some((e) => e.day === 100)).toBe(true);
  });

  it("returns nothing when the window falls between thresholds", () => {
    const admission = new Date(2026, 0, 1);
    const asOf = new Date(2026, 0, 23); // day 23: just past the day-21 step, day-28 is 5 days out
    const events = upcomingPdpmEvents(admission.toISOString().slice(0, 10), asOf, 1);
    expect(events.length).toBe(0);
  });
});
