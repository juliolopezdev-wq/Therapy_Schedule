import "dotenv/config";
import { createClient } from "@libsql/client";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decryptMessage,
  boardMessageContext,
  directMessageContext,
} from "../server/messageEncryption";

/** Verify a copy, never restore over the live database or print patient/message content. */
export async function verifyBackup(source: string) {
  const input = resolve(source);
  if (!existsSync(input) || !statSync(input).isFile())
    throw new Error("Provide a local SQLite backup file.");
  if (existsSync(`${input}-wal`) && statSync(`${input}-wal`).size > 0)
    throw new Error(
      "Export a consistent SQLite backup first; copying an active WAL database file alone is unsafe."
    );
  const directory = mkdtempSync(join(tmpdir(), "therapy-restore-check-"));
  const copy = join(directory, "restore.db");
  copyFileSync(input, copy);
  chmodSync(copy, 0o600);
  const client = createClient({ url: `file:${copy}` });
  try {
    const integrity = await client.execute("PRAGMA integrity_check");
    if (integrity.rows.some(row => Object.values(row)[0] !== "ok"))
      throw new Error("Backup integrity check failed.");
    const foreignKeys = await client.execute("PRAGMA foreign_key_check");
    if (foreignKeys.rows.length)
      throw new Error("Backup contains foreign-key violations.");
    const tableNames = new Set(
      (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE type='table'"
        )
      ).rows.map(row => String(row.name))
    );
    const counts: Record<string, number> = {};
    for (const name of [
      "patients",
      "therapySessions",
      "treatmentNotes",
      "functionalAssessments",
      "auditLog",
    ]) {
      if (tableNames.has(name))
        counts[name] = Number(
          (await client.execute(`SELECT count(*) AS count FROM "${name}"`))
            .rows[0].count
        );
    }
    if (!tableNames.has("patients") || !tableNames.has("therapySessions"))
      throw new Error("Backup is missing the patient or session table.");
    let messagesVerified = 0;
    if (tableNames.has("staffMessages")) {
      for (const row of (
        await client.execute(
          "SELECT authorUserId, title, body FROM staffMessages"
        )
      ).rows) {
        for (const field of ["title", "body"] as const) {
          const value = String(row[field] ?? "");
          if (value.startsWith("msgenc:")) {
            decryptMessage(
              value,
              boardMessageContext(Number(row.authorUserId), field)
            );
            messagesVerified++;
          } else if (value)
            throw new Error(
              "Backup contains legacy plaintext messages. Review migration and retention policy before restoring."
            );
        }
      }
    }
    if (tableNames.has("staffDirectMessages")) {
      for (const row of (
        await client.execute(
          "SELECT senderUserId, recipientUserId, body FROM staffDirectMessages"
        )
      ).rows) {
        decryptMessage(
          String(row.body),
          directMessageContext(
            Number(row.senderUserId),
            Number(row.recipientUserId)
          )
        );
        messagesVerified++;
      }
    }
    return {
      integrity: "ok",
      counts,
      messagesVerified,
      note: "Database and message-key checks passed on a temporary copy. This does not verify external storage, application workflows, backup freshness, or recovery time.",
    };
  } finally {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const source = process.argv[2];
  if (!source) {
    console.error(
      "Usage: npm run backup:verify -- /path/to/consistent-backup.db"
    );
    process.exitCode = 1;
  } else
    verifyBackup(source)
      .then(result => console.log(JSON.stringify(result, null, 2)))
      .catch(() => {
        console.error(
          "Backup verification failed. Check the file integrity, encryption key, and migration status. No live data was modified."
        );
        process.exitCode = 1;
      });
}
