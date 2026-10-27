import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getPatients: vi.fn(),
  getAllFunctionalAssessments: vi.fn(),
}));
vi.mock("./db", () => mocks);
import {
  getGGCompletenessReport,
  getGGTrendReport,
} from "./sectionGGCompliance";
import { SECTION_GG_ITEMS } from "../shared/sectionGG";
const scores = Object.fromEntries(SECTION_GG_ITEMS.map(item => [item.code, 3]));
const patient = {
  id: 1,
  name: "Patient A",
  roomNumber: "101",
  admissionDate: "2026-10-01",
  actualDischargeDate: "2026-10-20",
  isDischarged: true,
  archivedAt: null,
};
beforeEach(() => {
  mocks.getPatients.mockResolvedValue([patient]);
  mocks.getAllFunctionalAssessments.mockResolvedValue([]);
});
it("never counts empty, unsigned, or out-of-window assessments as complete", async () => {
  for (const extra of [
    { itemScores: {} },
    { signedAt: null },
    { assessmentDate: "2026-10-04" },
  ]) {
    mocks.getAllFunctionalAssessments.mockResolvedValue([
      {
        patientId: 1,
        assessmentType: "admission",
        assessmentDate: "2026-10-01",
        itemScores: scores,
        signedAt: new Date(),
        ...extra,
      },
    ]);
    expect((await getGGCompletenessReport()).admissionCompletionRate).toBe(0);
  }
});
it("does not count an estimated or unknown discharge date as verified", async () => {
  mocks.getPatients.mockResolvedValue([
    {
      ...patient,
      actualDischargeDate: null,
      estimatedDischargeDate: "2026-10-20",
    },
  ]);
  mocks.getAllFunctionalAssessments.mockResolvedValue([
    {
      patientId: 1,
      assessmentType: "discharge",
      assessmentDate: "2026-10-20",
      itemScores: scores,
      signedAt: new Date(),
    },
  ]);
  const report = await getGGCompletenessReport();
  expect(report.dischargeCompletionRate).toBe(0);
  expect(report.items[0].dischargeStatus).toContain("unverified");
});
it("excludes reason codes and incomplete pairs from raw performance-score trends", async () => {
  const admission = {
    patientId: 1,
    assessmentType: "admission",
    assessmentDate: "2026-10-01",
    itemScores: scores,
    signedAt: new Date(),
  };
  const discharge = {
    ...admission,
    assessmentType: "discharge",
    assessmentDate: "2026-10-20",
  };
  mocks.getAllFunctionalAssessments.mockResolvedValue([
    admission,
    { ...discharge, itemScores: { ...scores, GG0130A: 88 } },
  ]);
  expect(await getGGTrendReport()).toEqual([]);
  mocks.getAllFunctionalAssessments.mockResolvedValue([admission, discharge]);
  expect((await getGGTrendReport())[0].changeAvg).toBe(0);
});
