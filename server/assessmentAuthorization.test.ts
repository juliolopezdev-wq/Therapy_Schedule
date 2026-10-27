import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
const mocks = vi.hoisted(() => ({
  getFunctionalAssessmentById: vi.fn(),
  updateFunctionalAssessment: vi.fn(),
  signFunctionalAssessment: vi.fn(),
  createFunctionalAssessment: vi.fn(),
  getPatientGoalById: vi.fn(),
  updatePatientGoal: vi.fn(),
  archivePatientGoal: vi.fn(),
  logAudit: vi.fn(),
}));
vi.mock("./db", async original => ({
  ...(await original<typeof import("./db")>()),
  ...mocks,
}));
vi.mock("./accessControl", async original => ({
  ...(await original<typeof import("./accessControl")>()),
  resolveAccessScope: async () => ({
    role: "staff",
    therapistId: 7,
    linked: true,
    teamId: 1,
  }),
  assertPatientInScope: async (_scope: unknown, patientId: number) => {
    if (patientId !== 1) throw new Error("Out of scope");
  },
}));
import { appRouter } from "./routers";
import { SECTION_GG_ITEMS } from "../shared/sectionGG";

const caller = appRouter.createCaller({
  req: {} as Request,
  res: {} as Response,
  user: { id: 1, role: "staff", email: "staff@example.com" } as never,
});
const complete = Object.fromEntries(
  SECTION_GG_ITEMS.map(item => [item.code, 3])
);
const assessment = {
  id: 99,
  patientId: 1,
  completedByTherapistId: 7,
  signedAt: null,
  itemScores: complete,
  updatedAt: new Date(),
  assessmentDate: "2026-10-27",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFunctionalAssessmentById.mockResolvedValue({ ...assessment });
  mocks.createFunctionalAssessment.mockResolvedValue({ id: 100 });
});

describe("assessment ownership and signatures", () => {
  it("cannot edit or archive another patient's goal using an allowed patient ID", async () => {
    mocks.getPatientGoalById.mockResolvedValue({ id: 99, patientId: 2 });
    await expect(
      caller.charting.goals.update({ id: 99, patientId: 1, status: "met" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.charting.goals.archive({ id: 99, patientId: 1 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.updatePatientGoal).not.toHaveBeenCalled();
    expect(mocks.archivePatientGoal).not.toHaveBeenCalled();
  });
  it.each(["update", "sign"] as const)(
    "rejects %s when the stored record belongs to a different patient",
    async operation => {
      mocks.getFunctionalAssessmentById.mockResolvedValue({
        ...assessment,
        patientId: 2,
      });
      await expect(
        caller.charting.functionalAssessments[operation]({
          id: 99,
          patientId: 1,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mocks.updateFunctionalAssessment).not.toHaveBeenCalled();
      expect(mocks.signFunctionalAssessment).not.toHaveBeenCalled();
    }
  );
  it.each(["update", "sign"] as const)(
    "rejects another therapist's %s",
    async operation => {
      mocks.getFunctionalAssessmentById.mockResolvedValue({
        ...assessment,
        completedByTherapistId: 8,
      });
      await expect(
        caller.charting.functionalAssessments[operation]({
          id: 99,
          patientId: 1,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );
  it("prevents edits to signed records", async () => {
    mocks.getFunctionalAssessmentById.mockResolvedValue({
      ...assessment,
      signedAt: new Date(),
    });
    await expect(
      caller.charting.functionalAssessments.update({
        id: 99,
        patientId: 1,
        itemScores: {},
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("does not sign empty or partially scored assessments", async () => {
    mocks.getFunctionalAssessmentById.mockResolvedValue({
      ...assessment,
      itemScores: { GG0130A: 3 },
    });
    await expect(
      caller.charting.functionalAssessments.sign({ id: 99, patientId: 1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.signFunctionalAssessment).not.toHaveBeenCalled();
  });
  it("signs a complete owned assessment with a snapshot check and audit record", async () => {
    await caller.charting.functionalAssessments.sign({ id: 99, patientId: 1 });
    expect(mocks.signFunctionalAssessment).toHaveBeenCalledWith(
      99,
      1,
      1,
      assessment
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 1,
        action: "functional_assessment.sign",
      })
    );
  });
  it("accepts reason codes while rejecting unknown item codes and impossible dates", async () => {
    await caller.charting.functionalAssessments.create({
      patientId: 1,
      assessmentType: "admission",
      assessmentDate: "2026-10-27",
      itemScores: { GG0130A: 88, GG0130B: 7, GG0130C: 9, GG0130E: 10 },
    });
    await expect(
      caller.charting.functionalAssessments.create({
        patientId: 1,
        assessmentType: "admission",
        assessmentDate: "2026-02-30",
        itemScores: {},
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.charting.functionalAssessments.create({
        patientId: 1,
        assessmentType: "admission",
        assessmentDate: "2026-10-27",
        itemScores: { invented: 6 },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
