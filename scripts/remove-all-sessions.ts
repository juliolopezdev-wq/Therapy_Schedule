import { getDb } from "../server/db";
import { therapySessions } from "../drizzle/schema";

// This wipes every therapy session in the connected database, full stop -- there's no undo and
// no date scoping. It's meant for clearing seeded/test data, not something to run out of habit
// against whatever DATABASE_URL happens to be active. Requires an explicit --yes flag; without
// it, this only reports what it *would* delete and which database it's pointed at.
async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database not available.");
    process.exit(1);
  }

  const target = process.env.DATABASE_URL ?? "(unset)";
  const existing = await db.select().from(therapySessions);

  if (!process.argv.includes("--yes")) {
    console.log(`Target database: ${target}`);
    console.log(`This would permanently delete ALL ${existing.length} session(s). Nothing was deleted.`);
    console.log(`Re-run with --yes to actually delete: npx tsx scripts/remove-all-sessions.ts --yes`);
    process.exit(0);
  }

  console.log(`Target database: ${target}`);
  console.log(`Deleting ${existing.length} session(s)...`);
  await db.delete(therapySessions);
  console.log("Successfully removed all sessions.");
  process.exit(0);
}

main().catch(console.error);
