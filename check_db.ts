import "dotenv/config";
import { createClient } from "@libsql/client/http";

async function main() {
  const tursoClient = createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  const res = await tursoClient.execute("SELECT * FROM patients LIMIT 5");
  console.log("Patients in Turso:", res.rows);
}

main().catch(console.error);
