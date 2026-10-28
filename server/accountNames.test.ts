import { createClient } from "@libsql/client";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createClient> | null,
}));
vi.mock("@libsql/client/http", () => ({ createClient: () => state.client }));
import { users, therapists, auditLog, type User } from "../drizzle/schema";
import { appRouter } from "./routers";
import { linkUserToTherapist } from "./db";
import { resolveAccessScope } from "./accessControl";
let directory: string;
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "http://unused.invalid");
  directory = mkdtempSync(join(tmpdir(), "account-names-"));
  state.client = createClient({ url: `file:${join(directory, "test.db")}` });
  for (const table of [users, therapists, auditLog]) {
    const config = getTableConfig(table);
    await state.client.execute(
      `CREATE TABLE "${config.name}" (${config.columns.map(column => `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}`).join(",")})`
    );
  }
});
beforeEach(async () => {
  await state.client!
    .executeMultiple(`DELETE FROM users; DELETE FROM therapists; DELETE FROM auditLog;
    INSERT INTO users (id, openId, name, email, role) VALUES (1, 'email:admin@example.com', 'Admin', 'admin@example.com', 'admin'), (2, 'email:lead@example.com', NULL, 'lead@example.com', 'team_lead');
    INSERT INTO therapists (id, name, userId, teamId) VALUES (10, 'Clinical staff name', NULL, 3);`);
});
afterAll(() => {
  state.client?.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const actor = (id = 2, role: User["role"] = "team_lead") =>
  ({ id, role, email: "lead@example.com", name: null }) as User;
const caller = (user: User | null) =>
  appRouter.createCaller({ user, req: {}, res: {} } as TrpcContext);
async function name() {
  return (await state.client!.execute("SELECT name FROM users WHERE id=2"))
    .rows[0].name;
}
it("lets an unlinked account set and clear only its own name", async () => {
  await caller(actor()).auth.updateOwnName({ name: "  A  " });
  expect(await name()).toBe("A");
  expect(
    (await state.client!.execute("SELECT name FROM users WHERE id=1")).rows[0]
      .name
  ).toBe("Admin");
  await caller(actor()).auth.updateOwnName({ name: "  " });
  expect(await name()).toBeNull();
  expect(
    (await state.client!.execute("SELECT role FROM users WHERE id=2")).rows[0]
      .role
  ).toBe("team_lead");
});
it("lets an admin assign and clear a name", async () => {
  await caller(actor(1, "admin")).admin.updateUserName({
    userId: 2,
    name: "Assigned",
  });
  expect(await name()).toBe("Assigned");
  await caller(actor(1, "admin")).admin.updateUserName({ userId: 2, name: "" });
  expect(await name()).toBeNull();
});
it("preserves chosen and blank account names when linking a staff profile or resolving access", async () => {
  await caller(actor()).auth.updateOwnName({ name: "Chosen" });
  await linkUserToTherapist(2, 10);
  expect(await name()).toBe("Chosen");
  await caller(actor()).auth.updateOwnName({ name: "" });
  expect(await resolveAccessScope(actor())).toMatchObject({
    linked: true,
    therapistId: 10,
  });
  expect(await name()).toBeNull();
});
it("requires authentication, protects admin changes and rejects oversized names", async () => {
  await expect(
    caller(null).auth.updateOwnName({ name: "A" })
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    caller(actor()).admin.updateUserName({ userId: 1, name: "A" })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller(actor()).auth.updateOwnName({ name: "a".repeat(81) })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await name()).toBeNull();
});
