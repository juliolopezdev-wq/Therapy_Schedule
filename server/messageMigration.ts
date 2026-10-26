import { eq, sql } from "drizzle-orm";
import type { getDb } from "./db";
import { staffMessages, staffDirectMessages } from "../drizzle/schema";
import { messageEncryptionKey, migrateMessage, boardMessageContext, directMessageContext } from "./messageEncryption";

export async function migrateStoredMessages(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  messageEncryptionKey();
  // One write transaction prevents partial migration and concurrent plaintext changes.
  return db.transaction(async tx => {
    let board = 0;
    let direct = 0;
    for (const row of await tx.select().from(staffMessages)) {
      const title = migrateMessage(row.title, boardMessageContext(row.authorUserId, "title"));
      const body = migrateMessage(row.body, boardMessageContext(row.authorUserId, "body"));
      if (title !== row.title || body !== row.body) {
        await tx.update(staffMessages).set({ title, body }).where(eq(staffMessages.id, row.id));
        board++;
      }
    }
    for (const row of await tx.select().from(staffDirectMessages)) {
      const body = migrateMessage(row.body, directMessageContext(row.senderUserId, row.recipientUserId));
      if (body !== row.body) {
        await tx.update(staffDirectMessages).set({ body }).where(eq(staffDirectMessages.id, row.id));
        direct++;
      }
    }
    // Once migrated, older app instances must not reintroduce plaintext messages.
    // Metadata-only updates remain allowed. Ciphertext authenticity is checked on reads.
    await tx.run(sql`CREATE TRIGGER IF NOT EXISTS staffMessages_require_encryption_insert
      BEFORE INSERT ON staffMessages
      WHEN substr(NEW.title, 1, 10) != 'msgenc:v1:' OR substr(NEW.body, 1, 10) != 'msgenc:v1:'
      BEGIN SELECT RAISE(ABORT, 'Message encryption is required'); END`);
    await tx.run(sql`CREATE TRIGGER IF NOT EXISTS staffMessages_require_encryption_update
      BEFORE UPDATE OF title, body ON staffMessages
      WHEN substr(NEW.title, 1, 10) != 'msgenc:v1:' OR substr(NEW.body, 1, 10) != 'msgenc:v1:'
      BEGIN SELECT RAISE(ABORT, 'Message encryption is required'); END`);
    await tx.run(sql`CREATE TRIGGER IF NOT EXISTS staffDirectMessages_require_encryption_insert
      BEFORE INSERT ON staffDirectMessages
      WHEN substr(NEW.body, 1, 10) != 'msgenc:v1:'
      BEGIN SELECT RAISE(ABORT, 'Message encryption is required'); END`);
    await tx.run(sql`CREATE TRIGGER IF NOT EXISTS staffDirectMessages_require_encryption_update
      BEFORE UPDATE OF body ON staffDirectMessages
      WHEN substr(NEW.body, 1, 10) != 'msgenc:v1:'
      BEGIN SELECT RAISE(ABORT, 'Message encryption is required'); END`);
    return { board, direct };
  });
}
