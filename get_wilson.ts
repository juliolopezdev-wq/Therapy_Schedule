import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./drizzle/schema";
import { eq } from "drizzle-orm";
import "dotenv/config";

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const db = drizzle(client, { schema });

async function check() {
  const p = await db.select().from(schema.patients).where(eq(schema.patients.name, "WILSON, JAMES"));
  console.log(p);
  process.exit(0);
}

check();
