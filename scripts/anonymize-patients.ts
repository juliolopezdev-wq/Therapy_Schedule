import { getDb } from "../server/db";
import { patients } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database not available.");
    process.exit(1);
  }
  const allPatients = await db.select().from(patients);
  for (const patient of allPatients) {
    let name = patient.name.trim();
    if (name.toLowerCase() === "available") continue;

    let first = "";
    let last = "";

    // Handle "LAST, FIRST" format
    if (name.includes(",")) {
      const parts = name.split(",");
      last = parts[0].trim();
      first = parts[1].trim();
    } else {
      // Handle "FIRST LAST" format
      const parts = name.split(" ");
      if (parts.length > 1) {
        first = parts[0].trim();
        last = parts[parts.length - 1].trim();
      } else {
        first = parts[0].trim();
      }
    }

    const firstInitial = first ? first.charAt(0).toUpperCase() + "." : "";
    const lastInitial = last ? last.charAt(0).toUpperCase() + "." : "";

    const initials = [firstInitial, lastInitial].filter(Boolean).join(" ");
    
    await db.update(patients).set({ name: initials }).where(eq(patients.id, patient.id));
    console.log(`Updated "${patient.name}" -> "${initials}"`);
  }
  console.log("Successfully anonymized all patient names.");
  process.exit(0);
}

main().catch(console.error);
