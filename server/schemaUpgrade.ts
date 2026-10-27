import { createClient, type Client } from "@libsql/client/http";

/** Small, additive compatibility upgrade. Never drops tables, replaces rows, or invents dates. */
export async function upgradeSafetySchema(client: Pick<Client, "transaction">) {
  const tx = await client.transaction("write");
  const changes: string[] = [];
  try {
    const patientColumns = await tx.execute("PRAGMA table_info(patients)");
    if (!patientColumns.rows.length)
      throw new Error(
        "The base patient schema is missing. Initialize the application database first."
      );
    if (!patientColumns.rows.some(row => row.name === "actualDischargeDate")) {
      await tx.execute(
        "ALTER TABLE patients ADD COLUMN actualDischargeDate TEXT"
      );
      changes.push("patients.actualDischargeDate");
    }
    const existing = await tx.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('signInAttempts','aiChangeProposals')"
    );
    const tables = new Set(existing.rows.map(row => String(row.name)));
    await tx.execute(`CREATE TABLE IF NOT EXISTS signInAttempts (
      ipHash TEXT PRIMARY KEY NOT NULL, failures INTEGER NOT NULL, resetAt INTEGER NOT NULL,
      lockedUntil INTEGER DEFAULT 0 NOT NULL
    )`);
    if (!tables.has("signInAttempts")) changes.push("signInAttempts");
    await tx.execute(`CREATE TABLE IF NOT EXISTS aiChangeProposals (
      id TEXT PRIMARY KEY NOT NULL, actorUserId INTEGER NOT NULL, state TEXT DEFAULT 'pending' NOT NULL,
      payload TEXT NOT NULL, result TEXT, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL
    )`);
    if (!tables.has("aiChangeProposals")) changes.push("aiChangeProposals");
    await tx.commit();
    return changes;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

export async function upgradeConfiguredSafetySchema() {
  const url = (
    process.env.DATABASE_URL ||
    process.env.TURSO_DATABASE_URL ||
    ""
  ).replace(/^libsql:\/\//, "https://");
  if (!url) throw new Error("Database configuration is missing.");
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    return await upgradeSafetySchema(client);
  } finally {
    client.close();
  }
}
