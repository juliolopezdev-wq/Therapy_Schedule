import { createClient } from "@libsql/client";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createClient> | null,
}));
vi.mock("@libsql/client/http", () => ({ createClient: () => state.client }));
import { patients, teams } from "../drizzle/schema";
import { reorderPatient } from "./db";
let directory: string;
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "http://unused.invalid");
  directory = mkdtempSync(join(tmpdir(), "patient-reorder-"));
  state.client = createClient({ url: `file:${join(directory, "test.db")}` });
  for (const table of [patients, teams]) {
    const c = getTableConfig(table);
    await state.client.execute(
      `CREATE TABLE "${c.name}" (${c.columns.map(col => `"${col.name}" ${col.getSQLType()}${col.primary ? " PRIMARY KEY" : ""}`).join(", ")})`
    );
  }
  await state.client.executeMultiple(
    `CREATE TABLE writes (id INTEGER); CREATE TRIGGER count_patient_writes AFTER UPDATE ON patients BEGIN INSERT INTO writes VALUES (NEW.id); END;`
  );
});
beforeEach(async () => {
  await state.client!
    .executeMultiple(`DELETE FROM patients; DELETE FROM teams; DELETE FROM writes;
  INSERT INTO teams (id,name) VALUES (1,'One'),(2,'Two');
  INSERT INTO patients (id,name,roomNumber,teamId,orderIndex,isDischarged) VALUES (1,'A','101',1,100,0),(2,'B','102',1,200,0),(3,'C','103',1,300,0),(4,'D','104',2,100,0);`);
});
afterAll(() => {
  state.client?.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
it("writes only the moved patient during a same-team reorder", async () => {
  const result = await reorderPatient(1, 1, 3, true);
  expect(result.positions).toHaveLength(1);
  expect(
    (
      await state.client!.execute(
        "SELECT id FROM patients WHERE teamId=1 ORDER BY orderIndex"
      )
    ).rows.map(r => r.id)
  ).toEqual([2, 3, 1]);
  expect(
    (await state.client!.execute("SELECT id FROM writes")).rows.map(r => r.id)
  ).toEqual([1]);
});
it("leaves both teams' other ranks untouched on a cross-team move", async () => {
  await reorderPatient(1, 2, 4, true);
  expect(
    (await state.client!.execute("SELECT id FROM writes")).rows.map(r => r.id)
  ).toEqual([1]);
  expect(
    (await state.client!.execute("SELECT orderIndex FROM patients WHERE id=2"))
      .rows[0].orderIndex
  ).toBe(200);
});

it("updates the correct neighbor when a legacy null rank is the only rebalanced row", async () => {
  await state.client!.execute("UPDATE patients SET orderIndex=NULL WHERE id=2");
  await state.client!.execute("DELETE FROM writes");
  await reorderPatient(1, 1, 2, false);
  expect((await state.client!.execute("SELECT id FROM patients WHERE teamId=1 ORDER BY orderIndex")).rows.map(row => row.id)).toEqual([1, 2, 3]);
  expect((await state.client!.execute("SELECT id FROM writes")).rows.map(row => row.id)).toEqual([2]);
});
it("rebalances tied ranks atomically and rejects invalid targets without writing", async () => {
  await state.client!.execute("UPDATE patients SET orderIndex=0");
  await state.client!.execute("DELETE FROM writes");
  await reorderPatient(4, 1, 2, true);
  expect(
    (
      await state.client!.execute(
        "SELECT id FROM patients WHERE teamId=1 ORDER BY orderIndex"
      )
    ).rows.map(r => r.id)
  ).toEqual([1, 2, 4, 3]);
  await state.client!.execute("DELETE FROM writes");
  await expect(reorderPatient(1, 999)).rejects.toThrow("Destination team");
  await expect(reorderPatient(1, 2, 3)).rejects.toThrow("Drop target");
  expect(
    (await state.client!.execute("SELECT * FROM writes")).rows
  ).toHaveLength(0);
});
