import "dotenv/config";
import { createClient } from "@libsql/client";

async function main() {
  const localDb = createClient({ url: "file:sqlite.db" });
  const tursoClient = createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  const tables = [
    "users", "teams", "therapists", "patients", "statusFlags", "therapySessions", "boardHistory"
  ];

  for (const table of tables) {
    console.log(`Migrating ${table}...`);
    const { rows } = await localDb.execute(`SELECT * FROM ${table}`);
    if (rows.length === 0) continue;

    const columns = Object.keys(rows[0]);
    
    for (const row of rows) {
      const vals = columns.map(c => row[c] !== null ? row[c] : null);
      const placeholders = columns.map(() => "?").join(", ");
      
      try {
        await tursoClient.execute({
          sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
          args: vals,
        });
      } catch (e: any) {
        if (!e.message.includes("UNIQUE constraint failed")) {
          console.error(`Failed to insert into ${table}:`, e.message);
        }
      }
    }
    console.log(`Migrated ${rows.length} rows for ${table}`);
  }
  console.log("Migration complete!");
}

main().catch(console.error);
