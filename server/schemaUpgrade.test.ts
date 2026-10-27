import { createClient } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createClient> | null,
}));
vi.mock("@libsql/client/http", async original => ({
  ...(await original<typeof import("@libsql/client/http")>()),
  createClient: () => state.client,
}));
import { upgradeSafetySchema } from "./schemaUpgrade";
import { appRouter } from "./routers";
let directory: string;
beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "http://unused.invalid");
  directory = mkdtempSync(join(tmpdir(), "schema-upgrade-"));
  state.client = createClient({ url: `file:${join(directory, "test.db")}` });
});
beforeEach(async () => {
  await state.client!
    .executeMultiple(`DROP TABLE IF EXISTS patients; DROP TABLE IF EXISTS signInAttempts; DROP TABLE IF EXISTS aiChangeProposals;
    CREATE TABLE patients (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO patients VALUES (1, 'Synthetic existing record');`);
});
afterAll(() => {
  state.client?.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it("repairs the actual sign-in-status failure against an older database", async () => {
  const caller = appRouter.createCaller({
    user: null,
    req: {
      ip: "192.0.2.1",
      headers: { cookie: `sign_in_client=${"a".repeat(43)}` },
      socket: {},
    } as Request,
    res: {} as Response,
  });
  await expect(caller.auth.signInStatus()).rejects.toThrow();
  expect(await upgradeSafetySchema(state.client!)).toEqual([
    "patients.actualDischargeDate",
    "signInAttempts",
    "aiChangeProposals",
  ]);
  expect(await caller.auth.signInStatus()).toMatchObject({ lockedUntil: 0 });
  const rows = (await state.client!.execute("SELECT * FROM patients")).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: 1,
    name: "Synthetic existing record",
    actualDischargeDate: null,
  });
});

it("can run on every startup without resetting existing locks or replacing patient data", async () => {
  await upgradeSafetySchema(state.client!);
  await state.client!.execute(
    "INSERT INTO signInAttempts VALUES ('existing-lock',3,100,200)"
  );
  await state.client!.execute(
    "UPDATE patients SET actualDischargeDate='2026-10-27' WHERE id=1"
  );
  expect(await upgradeSafetySchema(state.client!)).toEqual([]);
  expect(
    (await state.client!.execute("SELECT * FROM signInAttempts")).rows[0]
  ).toMatchObject({ failures: 3, lockedUntil: 200 });
  expect(
    (await state.client!.execute("SELECT actualDischargeDate FROM patients"))
      .rows[0].actualDischargeDate
  ).toBe("2026-10-27");
});

it("does not create a partial schema when the base database is absent", async () => {
  await state.client!.execute("DROP TABLE patients");
  await expect(upgradeSafetySchema(state.client!)).rejects.toThrow(
    "base patient schema is missing"
  );
  expect(
    (
      await state.client!.execute(
        "SELECT name FROM sqlite_master WHERE name IN ('signInAttempts','aiChangeProposals')"
      )
    ).rows
  ).toHaveLength(0);
});
