import { getDb } from "../server/db";
import { therapySessions } from "../drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database not available.");
    process.exit(1);
  }
  await db.delete(therapySessions);
  console.log("Successfully removed all sessions.");
  process.exit(0);
}

main().catch(console.error);
