import { createClient } from "@libsql/client";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createClient> | null,
}));
vi.mock("@libsql/client/http", () => ({ createClient: () => state.client }));
import { functionalAssessments } from "../drizzle/schema";
import {
  getFunctionalAssessmentById,
  updateFunctionalAssessment,
  signFunctionalAssessment,
} from "./db";
let directory: string;
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "http://unused.invalid");
  directory = mkdtempSync(join(tmpdir(), "assessment-storage-"));
  state.client = createClient({ url: `file:${join(directory, "test.db")}` });
  const config = getTableConfig(functionalAssessments);
  await state.client.execute(
    `CREATE TABLE functionalAssessments (${config.columns.map(c => `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}`).join(", ")})`
  );
});
beforeEach(async () => {
  await state.client!.executeMultiple(
    `DELETE FROM functionalAssessments; INSERT INTO functionalAssessments (id,patientId,assessmentType,assessmentDate,itemScores,updatedAt) VALUES (1,1,'admission','2026-10-27','{"GG0130A":3}',100);`
  );
});
afterAll(() => {
  state.client?.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
it("enforces patient identity at the storage layer", async () => {
  await expect(
    updateFunctionalAssessment(1, { itemScores: {} }, 2)
  ).rejects.toThrow("changed or was signed");
  expect((await getFunctionalAssessmentById(1))!.itemScores).toEqual({
    GG0130A: 3,
  });
});
it("will not sign scores that changed after the review, even within the same timestamp second", async () => {
  const reviewed = (await getFunctionalAssessmentById(1))!;
  await state.client!.execute(
    `UPDATE functionalAssessments SET itemScores = '{"GG0130A":4}' WHERE id=1`
  );
  await expect(signFunctionalAssessment(1, 7, 1, reviewed)).rejects.toThrow(
    "changed or was signed"
  );
  expect((await getFunctionalAssessmentById(1))!.signedAt).toBeNull();
});
it("locks signed assessments against subsequent updates or signatures", async () => {
  const reviewed = (await getFunctionalAssessmentById(1))!;
  await signFunctionalAssessment(1, 7, 1, reviewed);
  await expect(
    updateFunctionalAssessment(1, { itemScores: {} }, 1)
  ).rejects.toThrow("changed or was signed");
  await expect(signFunctionalAssessment(1, 8, 1, reviewed)).rejects.toThrow(
    "changed or was signed"
  );
  expect((await getFunctionalAssessmentById(1))!.signedByUserId).toBe(7);
});
