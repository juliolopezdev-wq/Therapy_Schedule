import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { verifyBackup } from "../scripts/verify-backup";
import { encryptMessage, boardMessageContext } from "./messageEncryption";
let directory: string | undefined;
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
  vi.unstubAllEnvs();
});
it("verifies recovery key against a copy without changing the backup", async () => {
  directory = mkdtempSync(join(tmpdir(), "backup-fixture-"));
  const path = join(directory, "backup.db");
  vi.stubEnv("MESSAGE_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  const client = createClient({ url: `file:${path}` });
  await client.executeMultiple(
    "CREATE TABLE patients (id INTEGER); CREATE TABLE therapySessions (id INTEGER); CREATE TABLE staffMessages (authorUserId INTEGER, title TEXT, body TEXT);"
  );
  await client.execute({
    sql: "INSERT INTO staffMessages VALUES (1,?,?)",
    args: [
      encryptMessage("Synthetic title", boardMessageContext(1, "title")),
      encryptMessage("Synthetic body", boardMessageContext(1, "body")),
    ],
  });
  client.close();
  const original = readFileSync(path);
  expect(await verifyBackup(path)).toMatchObject({
    integrity: "ok",
    messagesVerified: 2,
    counts: { patients: 0, therapySessions: 0 },
  });
  expect(readFileSync(path).equals(original)).toBe(true);
  vi.stubEnv("MESSAGE_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  await expect(verifyBackup(path)).rejects.toThrow("could not be decrypted");
});
it("rejects a missing or invalid database", async () => {
  await expect(
    verifyBackup("/tmp/nonexistent-therapy-backup.db")
  ).rejects.toThrow("Provide a local SQLite backup");
});
