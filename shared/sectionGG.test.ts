import { expect, it } from "vitest";
import {
  assessmentProgress,
  assessmentWindow,
  SECTION_GG_ITEMS,
  isDateKey,
} from "./sectionGG";
it("distinguishes empty/partial drafts, review-ready records, and signatures", () => {
  expect(assessmentProgress({}).status).toBe("Draft");
  expect(assessmentProgress({ GG0130A: 3 }).status).toBe("Incomplete draft");
  const scores = Object.fromEntries(
    SECTION_GG_ITEMS.map(item => [item.code, 88])
  );
  expect(assessmentProgress(scores)).toMatchObject({
    complete: true,
    status: "Ready for review",
  });
  expect(assessmentProgress({ ...scores, GG0130A: 0 }).complete).toBe(false);
  expect(assessmentProgress(scores, new Date()).status).toBe("Signed");
});
it("checks admission/discharge windows without substituting estimated discharge dates", () => {
  const patient = {
    admissionDate: "2026-10-01",
    actualDischargeDate: "2026-10-20",
  };
  expect(
    assessmentWindow(
      { assessmentType: "admission", assessmentDate: "2026-10-03" },
      patient
    )
  ).toBe("within");
  expect(
    assessmentWindow(
      { assessmentType: "admission", assessmentDate: "2026-10-04" },
      patient
    )
  ).toBe("outside");
  expect(
    assessmentWindow(
      { assessmentType: "discharge", assessmentDate: "2026-10-18" },
      patient
    )
  ).toBe("within");
  expect(
    assessmentWindow(
      { assessmentType: "discharge", assessmentDate: "2026-10-21" },
      patient
    )
  ).toBe("outside");
  expect(
    assessmentWindow(
      { assessmentType: "discharge", assessmentDate: "2026-10-20" },
      { admissionDate: "2026-10-01" }
    )
  ).toBe("unverified");
  expect(isDateKey("2026-02-30")).toBe(false);
});
