import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./drizzle/schema";
import { isNull } from "drizzle-orm";
import "dotenv/config";

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const db = drizzle(client, { schema });

async function update() {
  const result = await db.update(schema.patients)
    .set({ admissionDate: '2026-06-15' })
    .where(isNull(schema.patients.admissionDate));
  
  console.log("Updated patients with 2026-06-15");
  process.exit(0);
}

update();
