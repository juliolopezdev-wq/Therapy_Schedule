import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createClient> | null,
}));
vi.mock("@libsql/client/http", () => ({ createClient: () => state.client }));

import {
  createStaffMessage,
  listStaffMessages,
  createDirectMessage,
  listDirectConversation,
  listDirectMessageThreads,
  getDb,
} from "./db";
import { migrateStoredMessages } from "./messageMigration";

let testDirectory: string;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "http://unused.invalid");
  vi.stubEnv("MESSAGE_ENCRYPTION_ENABLED", "true");
  vi.stubEnv("MESSAGE_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  testDirectory = mkdtempSync(join(tmpdir(), "message-storage-"));
  state.client = createClient({
    url: `file:${join(testDirectory, "test.db")}`,
  });
  await state.client.executeMultiple(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, role TEXT, deactivatedAt INTEGER, email TEXT);
    INSERT INTO users VALUES (1, 'Sender', 'staff', NULL, NULL), (2, 'Recipient', 'staff', NULL, NULL), (3, 'Other', 'staff', NULL, NULL);
    CREATE TABLE staffMessages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, authorUserId INTEGER, title TEXT, body TEXT,
      channel TEXT DEFAULT 'general', priority TEXT DEFAULT 'normal',
      requiresAcknowledgement INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0,
      resolvedAt INTEGER, resolvedByUserId INTEGER, archivedAt INTEGER,
      createdAt INTEGER, updatedAt INTEGER
    );
    CREATE TABLE staffMessageAcknowledgements (id INTEGER PRIMARY KEY, messageId INTEGER, userId INTEGER, createdAt INTEGER);
    CREATE TABLE staffDirectMessages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, senderUserId INTEGER, recipientUserId INTEGER,
      body TEXT, readAt INTEGER, createdAt INTEGER
    );
  `);
});

afterAll(() => {
  state.client?.close();
  if (testDirectory) rmSync(testDirectory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it("stores encrypted board fields and returns readable posts", async () => {
  const post = await createStaffMessage({
    authorUserId: 1,
    title: "Coverage",
    body: "Private board message",
    channel: "coverage",
    priority: "normal",
  });
  expect(post?.title).toBe("Coverage");
  expect(post?.body).toBe("Private board message");
  const raw = await state.client!.execute(
    "SELECT title, body FROM staffMessages"
  );
  expect(raw.rows[0].title).toMatch(/^msgenc:v1:/);
  expect(raw.rows[0].body).toMatch(/^msgenc:v1:/);
  expect((await listStaffMessages(2))[0].body).toBe("Private board message");
});

it("encrypts direct messages and decrypts conversations and previews only for participants", async () => {
  await createDirectMessage({
    senderUserId: 1,
    recipientUserId: 2,
    body: "Private direct message",
  });
  const raw = await state.client!.execute(
    "SELECT body FROM staffDirectMessages"
  );
  expect(raw.rows[0].body).toMatch(/^msgenc:v1:/);
  expect((await listDirectConversation(1, 2))[0].body).toBe(
    "Private direct message"
  );
  expect((await listDirectConversation(2, 1))[0].body).toBe(
    "Private direct message"
  );
  expect((await listDirectMessageThreads(2))[0].lastMessage).toBe(
    "Private direct message"
  );
  expect(await listDirectConversation(3, 1)).toEqual([]);
  expect(await listDirectMessageThreads(3)).toEqual([]);
});

it("rolls back every migration change when a stored value fails authentication", async () => {
  await state.client!.execute(
    "INSERT INTO staffMessages (authorUserId, title, body) VALUES (1, 'Must roll back', 'Still plaintext')"
  );
  await state.client!.execute(
    "INSERT INTO staffDirectMessages (senderUserId, recipientUserId, body) VALUES (1, 2, 'msgenc:v1:broken')"
  );
  await expect(migrateStoredMessages((await getDb())!)).rejects.toThrow();
  const raw = await state.client!.execute(
    "SELECT body FROM staffMessages WHERE title = 'Must roll back'"
  );
  expect(raw.rows[0].body).toBe("Still plaintext");
  await state.client!.execute(
    "DELETE FROM staffMessages WHERE title = 'Must roll back'"
  );
  await state.client!.execute(
    "DELETE FROM staffDirectMessages WHERE body = 'msgenc:v1:broken'"
  );
});

it("migrates archived posts and direct messages, and can safely rerun", async () => {
  await state.client!.execute(
    "INSERT INTO staffMessages (authorUserId, title, body, archivedAt) VALUES (1, 'Archived title', 'Archived body', 1)"
  );
  await state.client!.execute(
    "INSERT INTO staffDirectMessages (senderUserId, recipientUserId, body) VALUES (1, 2, 'Legacy direct')"
  );
  expect(await migrateStoredMessages((await getDb())!)).toEqual({
    board: 1,
    direct: 1,
  });
  expect(await migrateStoredMessages((await getDb())!)).toEqual({
    board: 0,
    direct: 0,
  });
  const raw = await state.client!.execute(
    "SELECT title, body FROM staffMessages WHERE archivedAt IS NOT NULL"
  );
  expect(raw.rows[0].title).toMatch(/^msgenc:v1:/);
  expect(raw.rows[0].body).toMatch(/^msgenc:v1:/);
});

it("does not persist plaintext when the encryption key is missing", async () => {
  const before = await state.client!.execute(
    "SELECT COUNT(*) AS count FROM staffDirectMessages"
  );
  vi.stubEnv("MESSAGE_ENCRYPTION_KEY", "");
  await expect(
    createDirectMessage({
      senderUserId: 1,
      recipientUserId: 2,
      body: "Must not persist",
    })
  ).rejects.toThrow();
  const result = await state.client!.execute(
    "SELECT COUNT(*) AS count FROM staffDirectMessages"
  );
  expect(result.rows[0].count).toBe(before.rows[0].count);
});

it("blocks plaintext writes from older instances after migration", async () => {
  await expect(
    state.client!.execute(
      "INSERT INTO staffMessages (authorUserId, title, body) VALUES (1, 'Plain title', 'Plain body')"
    )
  ).rejects.toThrow();
  await expect(
    state.client!.execute(
      "INSERT INTO staffDirectMessages (senderUserId, recipientUserId, body) VALUES (1, 2, 'Plain body')"
    )
  ).rejects.toThrow();
  await expect(
    state.client!.execute(
      "UPDATE staffMessages SET body = 'Plain body' WHERE id = 1"
    )
  ).rejects.toThrow();
  await expect(
    state.client!.execute(
      "UPDATE staffDirectMessages SET body = 'Plain body' WHERE id = 1"
    )
  ).rejects.toThrow();
  await expect(
    state.client!.execute(
      "UPDATE staffDirectMessages SET readAt = 1 WHERE id = 1"
    )
  ).resolves.toBeDefined();
});
