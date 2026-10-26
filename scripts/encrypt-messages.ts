import "dotenv/config";
import { getDb } from "../server/db";
import { migrateStoredMessages } from "../server/messageMigration";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const counts = await migrateStoredMessages(db);
  console.log(`Encrypted ${counts.board} board posts and ${counts.direct} direct messages. Existing encrypted values verified.`);
}

main().catch(() => {
  console.error("Message migration failed; transaction rolled back. Check database connectivity, MESSAGE_ENCRYPTION_KEY, and ciphertext integrity.");
  process.exitCode = 1;
});
