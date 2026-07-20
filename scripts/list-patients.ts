import { getDb } from "../server/db";
import { patients } from "../drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database not available.");
    process.exit(1);
  }
  const allPatients = await db.select().from(patients);
  console.log("Current patients:", allPatients.map(p => p.name));
  process.exit(0);
}

main().catch(console.error);
