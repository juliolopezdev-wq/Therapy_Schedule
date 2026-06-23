import { describe, expect, it } from "vitest";
import {
  TIME_SLOTS,
  TOTAL_SLOTS,
  dateToSlotIndex,
  slotIndexToDate,
  durationToSlots,
  sessionsOverlap,
  startOfDay,
  addDays,
  THERAPY_META,
  FLAG_META,
} from "../client/src/lib/board";

describe("time grid", () => {
  it("spans 7 AM to 5 PM in 30-min increments (20 slots)", () => {
    expect(TOTAL_SLOTS).toBe(20);
    expect(TIME_SLOTS[0].label).toBe("7:00");
    expect(TIME_SLOTS[TIME_SLOTS.length - 1].label).toBe("4:30");
  });

  it("converts a date to the correct slot index", () => {
    const d = new Date(2026, 5, 17, 9, 30, 0, 0); // 9:30 AM
    expect(dateToSlotIndex(d)).toBe(5); // 7:00=0, 7:30=1, 8:00=2, 8:30=3, 9:00=4, 9:30=5
  });

  it("round-trips slot index to date and back", () => {
    const base = startOfDay(new Date(2026, 5, 17));
    const d = slotIndexToDate(base, 5);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
    expect(dateToSlotIndex(d)).toBe(5);
  });

  it("computes slot span from duration", () => {
    expect(durationToSlots(30)).toBe(1);
    expect(durationToSlots(60)).toBe(2);
    expect(durationToSlots(45)).toBe(2); // rounds up-ish
    expect(durationToSlots(0)).toBe(1); // minimum 1
  });
});

describe("conflict detection (overlap)", () => {
  it("detects overlapping ranges", () => {
    // 8:00-9:00 (slot 2, span 2) overlaps 8:30-9:00 (slot 3, span 1)
    expect(sessionsOverlap(2, 2, 3, 1)).toBe(true);
  });

  it("treats adjacent ranges as non-overlapping", () => {
    // 8:00-8:30 (slot 2, span 1) and 8:30-9:00 (slot 3, span 1)
    expect(sessionsOverlap(2, 1, 3, 1)).toBe(false);
  });

  it("detects identical ranges as overlapping", () => {
    expect(sessionsOverlap(4, 1, 4, 1)).toBe(true);
  });
});

describe("date helpers", () => {
  it("startOfDay zeroes the time", () => {
    const d = startOfDay(new Date(2026, 5, 17, 14, 22, 5));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it("addDays moves the date", () => {
    const base = startOfDay(new Date(2026, 5, 17));
    const next = addDays(base, 1);
    expect(next.getDate()).toBe(18);
    const prev = addDays(base, -1);
    expect(prev.getDate()).toBe(16);
  });
});

describe("fixed labels and colors", () => {
  it("therapy types keep exact labels and fixed colors", () => {
    expect(THERAPY_META.PT.label).toBe("PT");
    expect(THERAPY_META.OT.label).toBe("OT");
    expect(THERAPY_META.SLP.label).toBe("SLP");
    expect(THERAPY_META.Eval.label).toBe("Eval");

    // Fixed color families: PT=yellow, OT=purple, SLP=blue, Eval=green.
    // Assert the dominant hue family (robust to shade tweaks) rather than exact hex.
    const hueOf = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return 0;
      let h = 0;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      return h < 0 ? h + 360 : h;
    };
    const inRange = (h: number, lo: number, hi: number) => h >= lo && h <= hi;

    expect(inRange(hueOf(THERAPY_META.PT.bg), 35, 60)).toBe(true); // yellow/amber
    expect(inRange(hueOf(THERAPY_META.OT.bg), 250, 290)).toBe(true); // purple
    expect(inRange(hueOf(THERAPY_META.SLP.bg), 180, 220)).toBe(true); // blue/cyan
    expect(inRange(hueOf(THERAPY_META.Eval.bg), 120, 160)).toBe(true); // green
  });

  it("status flags keep exact labels", () => {
    expect(FLAG_META.DC.label).toBe("DC");
    expect(FLAG_META["Name Alert"].label).toBe("Name Alert");
    expect(FLAG_META.Weekend.label).toBe("Weekend");
    expect(FLAG_META["In-Service"].label).toBe("In-Service");
    expect(FLAG_META.Appointment.label).toBe("Appointment");
  });
});
