import { createClient } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createClient> | null,
}));
vi.mock("@libsql/client/http", () => ({ createClient: () => state.client }));
import * as tables from "../drizzle/schema";
import {
  createAiProposal,
  approveAiProposal,
  undoAiProposal,
  listAiProposals,
} from "./aiReview";
const actor = { id: 1, email: "admin@example.com" };
const command = {
  function: {
    name: "create_session",
    arguments: {
      patientId: 1,
      therapistId: 1,
      therapyType: "PT",
      startTime: "2026-10-27T15:00:00Z",
      durationMinutes: 30,
      confirmed: true,
    },
  },
};
const needed = [
  tables.aiChangeProposals,
  tables.auditLog,
  tables.patients,
  tables.therapists,
  tables.therapySessions,
  tables.statusFlags,
  tables.therapistAbsences,
  tables.scheduleOverrides,
  tables.treatmentNotes,
  tables.functionalAssessments,
  tables.patientGoals,
  tables.weekendStaffingOverrides,
];
let directory: string;
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "http://unused.invalid");
  directory = mkdtempSync(join(tmpdir(), "ai-review-test-"));
  state.client = createClient({ url: `file:${join(directory, "test.db")}` });
  for (const table of needed) {
    const config = getTableConfig(table);
    await state.client.execute(
      `CREATE TABLE "${config.name}" (${config.columns.map(c => `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}`).join(", ")})`
    );
  }
});
beforeEach(async () => {
  for (const table of needed)
    await state.client!.execute(`DELETE FROM "${getTableConfig(table).name}"`);
  await state.client!.executeMultiple(
    "INSERT INTO patients (id,name,roomNumber) VALUES (1,'Patient A','101'); INSERT INTO therapists (id,name,therapyType) VALUES (1,'Therapist A','PT');"
  );
});
afterAll(() => {
  state.client?.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const execute = vi.fn(async () => {
  await state.client!.execute(
    "INSERT INTO therapySessions (id,patientId,therapistId,therapyType,startTime,endTime,durationMinutes,status,source,createdAt,updatedAt) VALUES (10,1,1,'PT',1793113200,1793115000,30,'scheduled','ai',1,1)"
  );
  return JSON.stringify({ ok: true, session: { id: 10 } });
});
it("keeps proposals inert and strips model-supplied confirmation flags", async () => {
  const plan = await createAiProposal([command], actor, new Date());
  expect(plan.changes[0].title).toContain("Patient A");
  expect(
    (await state.client!.execute("SELECT * FROM therapySessions")).rows
  ).toHaveLength(0);
  const stored = (
    await state.client!.execute("SELECT payload FROM aiChangeProposals")
  ).rows[0].payload;
  expect(String(stored)).not.toContain("confirmed");
});
it("applies once, persists the result for retry, and supports a guarded undo", async () => {
  execute.mockClear();
  const plan = await createAiProposal([command], actor, new Date());
  await approveAiProposal(plan.id, actor, execute);
  await approveAiProposal(plan.id, actor, execute);
  expect(execute).toHaveBeenCalledOnce();
  await undoAiProposal(plan.id, actor);
  expect(
    (await state.client!.execute("SELECT * FROM therapySessions")).rows
  ).toHaveLength(0);
  expect((await listAiProposals(actor.id))[0].state).toBe("undone");
  await expect(undoAiProposal(plan.id, actor)).rejects.toMatchObject({
    code: "CONFLICT",
  });
});
it("rejects another reviewer's approval and stale plans", async () => {
  const plan = await createAiProposal([command], actor, new Date());
  await expect(
    approveAiProposal(plan.id, { ...actor, id: 2 }, execute)
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await state.client!.execute(
    "UPDATE patients SET name = 'Changed' WHERE id = 1"
  );
  await expect(
    approveAiProposal(plan.id, actor, execute)
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("does not run expired plans or replay concurrently submitted approvals", async () => {
  execute.mockClear();
  const plan = await createAiProposal([command], actor, new Date());
  const results = await Promise.allSettled([
    approveAiProposal(plan.id, actor, execute),
    approveAiProposal(plan.id, actor, execute),
  ]);
  expect(results.some(result => result.status === "fulfilled")).toBe(true);
  expect(execute).toHaveBeenCalledOnce();
  const later = await createAiProposal([command], actor, new Date());
  await state.client!.execute({
    sql: "UPDATE aiChangeProposals SET expiresAt = 1 WHERE id = ?",
    args: [later.id],
  });
  await expect(
    approveAiProposal(later.id, actor, execute)
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("stops on partial failures and blocks undo after later clinical work", async () => {
  const plan = await createAiProposal([command, command], actor, new Date());
  const executor = vi
    .fn()
    .mockImplementationOnce(execute)
    .mockResolvedValueOnce(
      JSON.stringify({ ok: false, error: "New conflict" })
    );
  const result = await approveAiProposal(plan.id, actor, executor);
  expect(result.actions).toHaveLength(1);
  expect(result.errors[0]).toContain("New conflict");
  await state.client!.execute(
    "INSERT INTO treatmentNotes (id,patientId,sessionId,signedAt) VALUES (1,1,10,1)"
  );
  await expect(undoAiProposal(plan.id, actor)).rejects.toMatchObject({
    code: "CONFLICT",
  });
});
it("never undoes unrelated sessions created during the batch", async () => {
  const plan = await createAiProposal([command], actor, new Date());
  await approveAiProposal(plan.id, actor, async () => {
    await state.client!.execute(
      "INSERT INTO therapySessions (id,patientId,therapistId,therapyType,startTime,endTime,durationMinutes,status,createdAt,updatedAt) VALUES (20,1,1,'PT',1793123200,1793125000,30,'scheduled',1,1)"
    );
    return execute();
  });
  await undoAiProposal(plan.id, actor);
  expect(
    (await state.client!.execute("SELECT id FROM therapySessions")).rows.map(
      r => r.id
    )
  ).toEqual([20]);
});
