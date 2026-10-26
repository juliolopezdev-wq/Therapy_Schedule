import { describe, expect, it } from "vitest";
import { isActiveAdmission } from "./patientLifecycle";

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
