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
  THERAPY_TYPES,
  isEvaluationTherapyType,
  therapyDiscipline,
  FLAG_META,
  SESSION_STATUS_META,
  isCanceledStatus,
  isMissedStatus,
} from "../client/src/lib/board";
import { getPatientWeekBounds, patientWeekStart } from "../shared/weekUtils";
import { availableShiftMinutesForDay } from "../shared/workSchedule";

describe("time grid", () => {
  it("spans 7 AM to 6 PM in 30-min increments (22 slots)", () => {
    expect(TOTAL_SLOTS).toBe(22);
    expect(TIME_SLOTS[0].label).toBe("7:00");
    expect(TIME_SLOTS[TIME_SLOTS.length - 1].label).toBe("5:30");
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
    expect(durationToSlots(31)).toBe(2); // any partial slot remains occupied
    expect(durationToSlots(45)).toBe(2);
    expect(durationToSlots(61)).toBe(3);
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

describe("discharge cancellation status", () => {
  it("keeps discharge cancellations distinct from missed treatment", () => {
    expect(isCanceledStatus("canceled_discharge")).toBe(true);
    expect(isMissedStatus("canceled_discharge")).toBe(false);
    expect(SESSION_STATUS_META.canceled_discharge.label).toBe("Canceled — Discharged");
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

describe("IRF week and staffing math", () => {
  it("anchors each 7-day IRF period on the admission date", () => {
    const admission = "2026-06-15"; // Monday
    const firstWeek = getPatientWeekBounds(admission, new Date(2026, 5, 15, 12));
    expect(firstWeek.start.getDate()).toBe(15);
    expect(firstWeek.end.getDate()).toBe(21);
    expect(firstWeek.weekNumber).toBe(1);

    const secondWeek = getPatientWeekBounds(admission, new Date(2026, 5, 22, 12));
    expect(secondWeek.start.getDate()).toBe(22);
    expect(secondWeek.weekNumber).toBe(2);
  });

  it("falls back to a finite calendar week for malformed legacy admission dates", () => {
    const reference = new Date(2026, 9, 22, 12);
    for (const malformed of ["not-a-date", "2026-02-30", "   "]) {
      const start = patientWeekStart(malformed, reference);
      const bounds = getPatientWeekBounds(malformed, reference);
      expect(Number.isFinite(start.getTime())).toBe(true);
      expect(Number.isFinite(bounds.end.getTime())).toBe(true);
      expect(start.getDay()).toBe(1);
      expect(bounds.weekNumber).toBe(1);
    }
  });

  it("accepts legacy ISO timestamps without constructing an invalid date", () => {
    const reference = new Date(2026, 9, 24, 12);
    const start = patientWeekStart("2026-10-17T00:00:00.000Z", reference);
    expect(Number.isFinite(start.getTime())).toBe(true);
    expect(start.getFullYear()).toBe(2026);
  });

  it("uses the actual shift and one consistent 30-minute meal deduction", () => {
    const monday = new Date(2026, 5, 15, 12);
    expect(availableShiftMinutesForDay({
      workDays: "1,2,3,4,5",
      workStartTime: "08:00",
      workEndTime: "16:00",
    }, monday)).toBe(450);

    expect(availableShiftMinutesForDay({
      workDays: "1",
      workStartTime: "08:00",
      workEndTime: "12:00",
    }, monday)).toBe(240);

    const sunday = new Date(2026, 5, 14, 12);
    expect(availableShiftMinutesForDay({
      workDays: "1,2,3,4,5",
      workStartTime: "08:00",
      workEndTime: "16:00",
    }, sunday)).toBe(0);
  });
});

describe("fixed labels and colors", () => {
  it("therapy types keep exact labels and fixed colors", () => {
    expect(THERAPY_META.PT.label).toBe("PT");
    expect(THERAPY_META.OT.label).toBe("OT");
    expect(THERAPY_META.SLP.label).toBe("SLP");
    expect(THERAPY_META["PT Eval"].label).toBe("PT Eval");
    expect(THERAPY_META["OT Eval"].label).toBe("OT Eval");
    expect(THERAPY_META["SLP Eval"].label).toBe("SLP Eval");
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

  it("offers discipline-specific evaluations while recognizing legacy evaluations", () => {
    expect(THERAPY_TYPES).toContain("PT Eval");
    expect(THERAPY_TYPES).toContain("OT Eval");
    expect(THERAPY_TYPES).toContain("SLP Eval");
    expect(THERAPY_TYPES).not.toContain("Eval");

    expect(isEvaluationTherapyType("PT Eval")).toBe(true);
    expect(isEvaluationTherapyType("OT Eval")).toBe(true);
    expect(isEvaluationTherapyType("SLP Eval")).toBe(true);
    expect(isEvaluationTherapyType("Eval")).toBe(true);
    expect(isEvaluationTherapyType("PT")).toBe(false);

    expect(therapyDiscipline("PT Eval")).toBe("PT");
    expect(therapyDiscipline("OT Eval")).toBe("OT");
    expect(therapyDiscipline("SLP Eval")).toBe("SLP");
    expect(therapyDiscipline("Eval")).toBeNull();
  });

  it("status flags keep exact labels", () => {
    expect(FLAG_META.DC.label).toBe("DC");
    expect(FLAG_META["Name Alert"].label).toBe("Name Alert");
    expect(FLAG_META.Weekend.label).toBe("Weekend");
    expect(FLAG_META["In-Service"].label).toBe("In-Service");
    expect(FLAG_META.Appointment.label).toBe("Appointment");
  });
});
