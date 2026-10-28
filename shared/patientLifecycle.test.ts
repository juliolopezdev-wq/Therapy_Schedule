import { describe, expect, it } from "vitest";
import { isActiveAdmission, wasOnUnitOn } from "./patientLifecycle";

describe("isActiveAdmission", () => {
  it("includes only real, current, non-archived admissions", () => {
    expect(isActiveAdmission({ isDischarged: false, isRoomPlaceholder: false, archivedAt: null })).toBe(true);
  });

  it.each([
    { label: "discharged admission", record: { isDischarged: true, isRoomPlaceholder: false, archivedAt: null } },
    { label: "available-room placeholder", record: { isDischarged: false, isRoomPlaceholder: true, archivedAt: null } },
    { label: "archived admission", record: { isDischarged: true, isRoomPlaceholder: false, archivedAt: new Date() } },
  ])("excludes a $label", ({ record }) => {
    expect(isActiveAdmission(record)).toBe(false);
  });
});

describe("wasOnUnitOn", () => {
  const stay = { isDischarged: true, isRoomPlaceholder: false, archivedAt: null, admissionDate: "2026-10-05", actualDischargeDate: "2026-10-20" };

  it("shows a patient from admission day through discharge day", () => {
    expect(wasOnUnitOn(stay, "2026-10-05")).toBe(true);
    expect(wasOnUnitOn(stay, "2026-10-12")).toBe(true);
    expect(wasOnUnitOn(stay, "2026-10-20")).toBe(true);
  });

  it("hides a patient before admission and after discharge", () => {
    expect(wasOnUnitOn(stay, "2026-10-04")).toBe(false);
    expect(wasOnUnitOn(stay, "2026-10-21")).toBe(false);
  });

  it("shows a current patient on every day from admission on", () => {
    const current = { ...stay, isDischarged: false, actualDischargeDate: null };
    expect(wasOnUnitOn(current, "2026-10-04")).toBe(false);
    expect(wasOnUnitOn(current, "2026-12-01")).toBe(true);
  });

  it("hides a discharged patient with no discharge date, and archived admissions", () => {
    expect(wasOnUnitOn({ ...stay, actualDischargeDate: null }, "2026-10-12")).toBe(false);
    expect(wasOnUnitOn({ ...stay, archivedAt: new Date() }, "2026-10-12")).toBe(false);
  });

  it("always shows vacant-room markers", () => {
    expect(wasOnUnitOn({ ...stay, isRoomPlaceholder: true, admissionDate: null }, "2026-10-01")).toBe(true);
  });
});
