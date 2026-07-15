import { config } from "dotenv";
config();
import { getDb } from "../server/db";
import { patients } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) return;
  const allPatients = await db.select().from(patients).orderBy(patients.roomNumber);
  
  for (let i = 0; i < allPatients.length; i++) {
    await db.update(patients)
      .set({ orderIndex: (i + 1) * 1000 })
      .where(eq(patients.id, allPatients[i].id));
  }
  console.log(`Initialized orderIndex for ${allPatients.length} patients.`);
  process.exit(0);
}

main().catch(console.error);
