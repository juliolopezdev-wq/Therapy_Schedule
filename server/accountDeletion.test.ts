import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createClient> | null,
}));
vi.mock("@libsql/client/http", () => ({ createClient: () => state.client }));
vi.mock("./_core/env", () => ({ ENV: { ownerEmail: "owner@example.com" } }));

import { permanentlyDeleteAccount } from "./accountDeletion";
import { appRouter } from "./routers";

let directory: string;
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "http://unused.invalid");
  directory = mkdtempSync(join(tmpdir(), "account-deletion-"));
  state.client = createClient({ url: `file:${join(directory, "test.db")}` });
  await state.client.executeMultiple(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, openId TEXT, email TEXT, role TEXT, deactivatedAt INTEGER);
    CREATE TABLE sessions (id INTEGER PRIMARY KEY, userId INTEGER);
    CREATE TABLE invites (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE magicLinks (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE therapists (id INTEGER PRIMARY KEY, userId INTEGER, name TEXT, updatedAt INTEGER);
    CREATE TABLE auditLog (id INTEGER PRIMARY KEY, actorUserId INTEGER, actorEmail TEXT, action TEXT, targetType TEXT, targetId TEXT, metadata TEXT, createdAt INTEGER);
    CREATE TABLE staffMessages (id INTEGER PRIMARY KEY, authorUserId INTEGER, body TEXT);
  `);
});

beforeEach(async () => {
  await state.client!.executeMultiple(`
    DROP TRIGGER IF EXISTS fail_audit;
    DELETE FROM users; DELETE FROM sessions; DELETE FROM invites; DELETE FROM magicLinks;
    DELETE FROM therapists; DELETE FROM auditLog; DELETE FROM staffMessages;
    INSERT INTO users VALUES
      (1, 'email:admin@example.com', 'admin@example.com', 'admin', NULL),
      (2, 'email:staff@example.com', ' STAFF@example.com ', 'staff', NULL),
      (3, 'email:owner@example.com', 'owner@example.com', 'admin', NULL);
    INSERT INTO sessions VALUES (1, 1), (2, 2);
    INSERT INTO invites VALUES (1, 'admin@example.com'), (2, 'staff@example.com');
    INSERT INTO magicLinks VALUES (1, 'admin@example.com'), (2, 'Staff@example.com');
    INSERT INTO therapists VALUES (1, 2, 'Retained staff profile', NULL);
    INSERT INTO staffMessages VALUES (1, 2, 'Retained encrypted content');
  `);
});

afterAll(() => {
  state.client?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function count(table: string) {
  const result = await state.client!.execute(
    `SELECT COUNT(*) AS count FROM ${table}`
  );
  return result.rows[0].count;
}

it("permanently removes credentials, unlinks staff, and retains operational history", async () => {
  await permanentlyDeleteAccount(2, 1);
  expect(await count("users")).toBe(2);
  for (const table of ["sessions", "invites", "magicLinks"])
    expect(await count(table)).toBe(1);
  const profile = await state.client!.execute(
    "SELECT userId, name FROM therapists"
  );
  expect(profile.rows[0]).toMatchObject({
    userId: null,
    name: "Retained staff profile",
  });
  expect(await count("staffMessages")).toBe(1);
  const audit = await state.client!.execute(
    "SELECT action, actorUserId, targetId FROM auditLog"
  );
  expect(audit.rows[0]).toMatchObject({
    action: "user.delete",
    actorUserId: 1,
    targetId: "2",
  });
});

it("deletes deactivated accounts too", async () => {
  await state.client!.execute(
    "UPDATE users SET deactivatedAt = 1 WHERE id = 2"
  );
  await permanentlyDeleteAccount(2, 1);
  expect(await count("users")).toBe(2);
});

it("rejects self-deletion and protects the configured owner", async () => {
  await expect(permanentlyDeleteAccount(1, 1)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await expect(permanentlyDeleteAccount(3, 1)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await count("users")).toBe(3);
});

it("rejects missing targets and actors who are not active administrators", async () => {
  await expect(permanentlyDeleteAccount(99, 1)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(permanentlyDeleteAccount(3, 2)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(permanentlyDeleteAccount(2, 99)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await state.client!.execute(
    "UPDATE users SET deactivatedAt = 1 WHERE id = 1"
  );
  await expect(permanentlyDeleteAccount(2, 1)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(await count("users")).toBe(3);
});

it("rolls back deletion and credential cleanup if recording the audit event fails", async () => {
  await state.client!
    .executeMultiple(`CREATE TRIGGER fail_audit BEFORE INSERT ON auditLog
    BEGIN SELECT RAISE(ABORT, 'Audit unavailable'); END;`);
  await expect(permanentlyDeleteAccount(2, 1)).rejects.toThrow();
  expect(await count("users")).toBe(3);
  for (const table of ["sessions", "invites", "magicLinks"])
    expect(await count(table)).toBe(2);
  const profile = await state.client!.execute("SELECT userId FROM therapists");
  expect(profile.rows[0].userId).toBe(2);
});

it("requires administrator access and explicit confirmation at the API boundary", async () => {
  const anonymous = appRouter.createCaller({ user: null } as never);
  const staff = appRouter.createCaller({
    user: { id: 2, role: "staff" },
  } as never);
  const admin = appRouter.createCaller({
    user: { id: 1, role: "admin" },
  } as never);
  await expect(
    anonymous.admin.deleteUser({ userId: 2, confirmation: "DELETE" })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    staff.admin.deleteUser({ userId: 1, confirmation: "DELETE" })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    admin.admin.deleteUser({ userId: 2, confirmation: "no" } as never)
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    await admin.admin.deleteUser({ userId: 2, confirmation: "DELETE" })
  ).toEqual({ success: true });
});
