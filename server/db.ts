import { and, eq, gte, lte } from "drizzle-orm";
import { createClient } from "@libsql/client/http";
import { drizzle } from "drizzle-orm/libsql";
import path from "path";
import { fileURLToPath } from "url";
import {
  InsertUser,
  users,
  patients,
  therapySessions,
  therapists,
  teams,
  statusFlags,
  boardHistory,
  InsertPatient,
  InsertTherapySession,
  InsertStatusFlag,
  InsertTherapist,
  InsertTeam,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

// libsql's insert result exposes the new row's id as `lastInsertRowid`, not `insertId`/`[0]`.
function extractInsertId(result: unknown): number {
  const rowid = (result as { lastInsertRowid?: bigint | number } | undefined)?.lastInsertRowid;
  return rowid != null ? Number(rowid) : 0;
}

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db) {
    const dbUrl = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
    if (!dbUrl) {
      console.warn("[Database] DATABASE_URL is missing. Database not available.");
      return null;
    }
    try {
      // @libsql/client/http only speaks http(s) -- a libsql:// URL connects but every
      // query then fails with a 502 from the edge, silently emptying every query result.
      const httpUrl = dbUrl.replace(/^libsql:\/\//, "https://");
      const client = createClient({
        url: httpUrl,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/* ---------------------------------------------------------------------------
 * Patients
 * ------------------------------------------------------------------------ */

export async function getPatients() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(patients).orderBy(patients.roomNumber);
}

export async function getPatientById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(patients).where(eq(patients.id, id)).limit(1);
  return result[0];
}

export async function createPatient(data: InsertPatient) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(patients).values(data);
  return { id: extractInsertId(result) };
}

export async function updatePatient(id: number, data: Partial<InsertPatient>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(patients).set(data).where(eq(patients.id, id));
  return { success: true };
}

export async function deletePatient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Clean up related records first
  await db.delete(therapySessions).where(eq(therapySessions.patientId, id));
  await db.delete(statusFlags).where(eq(statusFlags.patientId, id));
  await db.delete(patients).where(eq(patients.id, id));
  return { success: true };
}

/* ---------------------------------------------------------------------------
 * Therapy Sessions
 * ------------------------------------------------------------------------ */

function dayBounds(date: Date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return { startOfDay, endOfDay };
}

export async function getTherapySessions(date?: Date) {
  const db = await getDb();
  if (!db) return [];
  if (date) {
    const { startOfDay, endOfDay } = dayBounds(date);
    return db
      .select()
      .from(therapySessions)
      .where(and(gte(therapySessions.startTime, startOfDay), lte(therapySessions.startTime, endOfDay)));
  }
  return db.select().from(therapySessions);
}

export async function getTherapySessionsForWeek(weekStart: Date) {
  const db = await getDb();
  if (!db) return [];
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return db
    .select()
    .from(therapySessions)
    .where(and(gte(therapySessions.startTime, start), lte(therapySessions.startTime, end)));
}

export async function getTherapySessionsForDateRange(startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return [];
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  return db
    .select()
    .from(therapySessions)
    .where(and(gte(therapySessions.startTime, start), lte(therapySessions.startTime, end)));
}

export async function getSessionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(therapySessions).where(eq(therapySessions.id, id)).limit(1);
  return result[0];
}

export async function createTherapySession(data: InsertTherapySession) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(therapySessions).values(data);
  return { id: extractInsertId(result) };
}

export async function updateTherapySession(id: number, data: Partial<InsertTherapySession>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(therapySessions).set(data).where(eq(therapySessions.id, id));
  return { success: true };
}

export async function deleteTherapySession(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(therapySessions).where(eq(therapySessions.id, id));
  return { success: true };
}

export async function clearSchedule(timeframe: "daily" | "weekly", referenceDate: Date, therapistId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let start: Date;
  let end: Date;

  if (timeframe === "daily") {
    const bounds = dayBounds(referenceDate);
    start = bounds.startOfDay;
    end = bounds.endOfDay;
  } else {
    start = new Date(referenceDate);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  }

  let conditions = and(gte(therapySessions.startTime, start), lte(therapySessions.startTime, end));
  if (therapistId !== undefined) {
    conditions = and(conditions, eq(therapySessions.therapistId, therapistId));
  }

  await db.delete(therapySessions).where(conditions);
  return { success: true, timeframe, therapistId };
}

/* ---------------------------------------------------------------------------
 * Therapists
 * ------------------------------------------------------------------------ */

export async function getTherapists() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(therapists).orderBy(therapists.name);
}

export async function createTherapist(data: InsertTherapist) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(therapists).values(data);
  return { id: extractInsertId(result) };
}

export async function updateTherapist(id: number, data: Partial<InsertTherapist>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(therapists).set(data).where(eq(therapists.id, id));
  return { success: true };
}

export async function deleteTherapist(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(therapists).where(eq(therapists.id, id));
  return { success: true };
}

/* ---------------------------------------------------------------------------
 * Teams
 * ------------------------------------------------------------------------ */

export async function getTeams() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(teams).orderBy(teams.id);
}

export async function createTeam(data: InsertTeam) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(teams).values(data);
  return { id: extractInsertId(result) };
}

/* ---------------------------------------------------------------------------
 * Status Flags
 * ------------------------------------------------------------------------ */

/**
 * Flags carry forward: a flag set on day X stays active on every later day until a newer
 * row for the same patient+flagType is written (either re-activated or explicitly turned off
 * via setStatusFlag). So "active flags as of `date`" is the latest row per (patientId, flagType)
 * at or before `date`, filtered to the ones still marked active.
 */
export async function getStatusFlagsForDate(date: Date) {
  const db = await getDb();
  if (!db) return [];
  const { endOfDay } = dayBounds(date);
  const rows = await db
    .select()
    .from(statusFlags)
    .where(lte(statusFlags.date, endOfDay))
    .orderBy(statusFlags.date, statusFlags.id);

  const latestByKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    latestByKey.set(`${row.patientId}:${row.flagType}`, row); // ascending order, so last write wins
  }
  return Array.from(latestByKey.values()).filter((row) => row.active);
}

/**
 * Sets whether a patient's flag is active as of `date` -- this is the write side of the
 * carry-forward model above. Updates the row for the exact date in place if one already
 * exists (e.g. toggled twice in one day), otherwise inserts a new one.
 */
export async function setStatusFlag(
  patientId: number,
  flagType: InsertStatusFlag["flagType"],
  date: Date,
  active: boolean,
): Promise<{ id: number; changed: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const flagsAsOfDate = await getStatusFlagsForDate(date);
  const wasActive = flagsAsOfDate.some((f) => f.patientId === patientId && f.flagType === flagType);

  const { startOfDay, endOfDay } = dayBounds(date);
  const existing = await db
    .select()
    .from(statusFlags)
    .where(
      and(
        eq(statusFlags.patientId, patientId),
        eq(statusFlags.flagType, flagType),
        gte(statusFlags.date, startOfDay),
        lte(statusFlags.date, endOfDay),
      ),
    )
    .limit(1);

  let id: number;
  if (existing.length > 0) {
    await db.update(statusFlags).set({ active }).where(eq(statusFlags.id, existing[0].id));
    id = existing[0].id;
  } else {
    const result = await db.insert(statusFlags).values({ patientId, flagType, date, active });
    id = extractInsertId(result);
  }

  return { id, changed: wasActive !== active };
}

export async function createStatusFlag(data: InsertStatusFlag) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Prevent duplicate flags for the same patient, flagType, and date
  const { startOfDay, endOfDay } = dayBounds(data.date);
  const existing = await db
    .select()
    .from(statusFlags)
    .where(
      and(
        eq(statusFlags.patientId, data.patientId),
        eq(statusFlags.flagType, data.flagType),
        gte(statusFlags.date, startOfDay),
        lte(statusFlags.date, endOfDay)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return { id: existing[0].id, created: false };
  }

  const result = await db.insert(statusFlags).values(data);
  return { id: extractInsertId(result), created: true };
}

export async function deleteStatusFlag(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(statusFlags).where(eq(statusFlags.id, id));
  return { success: true };
}

export async function deleteStatusFlagByPatientAndType(
  patientId: number,
  flagType: InsertStatusFlag["flagType"],
  date: Date,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { startOfDay, endOfDay } = dayBounds(date);
  await db
    .delete(statusFlags)
    .where(
      and(
        eq(statusFlags.patientId, patientId),
        eq(statusFlags.flagType, flagType),
        gte(statusFlags.date, startOfDay),
        lte(statusFlags.date, endOfDay),
      ),
    );
  return { success: true };
}

/* ---------------------------------------------------------------------------
 * Board History (daily snapshots)
 * ------------------------------------------------------------------------ */

// The Turso HTTP edge occasionally returns a transient 502 on an otherwise-valid query.
// Snapshots are explicit user actions (click "save", click "print") rather than passive
// polling, so it's worth a couple of quick retries instead of failing the user's click outright.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("502") && !message.includes("SERVER_ERROR")) throw err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function getBoardHistory() {
  const db = await getDb();
  if (!db) return [];
  return withRetry(() => db.select().from(boardHistory).orderBy(boardHistory.date));
}

export async function getSnapshotForDate(date: Date) {
  const db = await getDb();
  if (!db) return undefined;
  const { startOfDay, endOfDay } = dayBounds(date);
  const result = await withRetry(() =>
    db
      .select()
      .from(boardHistory)
      .where(and(gte(boardHistory.date, startOfDay), lte(boardHistory.date, endOfDay)))
      .limit(1),
  );
  return result[0];
}

export async function saveBoardSnapshot(date: Date, snapshot: unknown) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Remove existing snapshot for the date, then insert a fresh one
  const { startOfDay, endOfDay } = dayBounds(date);
  await withRetry(() =>
    db
      .delete(boardHistory)
      .where(and(gte(boardHistory.date, startOfDay), lte(boardHistory.date, endOfDay))),
  );
  const result = await withRetry(() => db.insert(boardHistory).values({ date, snapshot: snapshot as object }));
  return { id: extractInsertId(result) };
}

export async function deleteBoardSnapshot(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await withRetry(() => db.delete(boardHistory).where(eq(boardHistory.id, id)));
  return { success: true };
}

/* ---------------------------------------------------------------------------
 * Seed helpers (idempotent)
 * ------------------------------------------------------------------------ */

export async function seedTeamsIfEmpty() {
  try {
    const db = await getDb();
    if (!db) {
      console.log("[DEBUG] seedTeamsIfEmpty: No DB");
      return;
    }
    const existing = await db.select().from(teams).limit(1);
    console.log("[DEBUG] seedTeamsIfEmpty: Existing teams length:", existing.length);
    if (existing.length > 0) return;
    const seedTeams: InsertTeam[] = [
      { name: "Team One", color: "#f59e0b" },
      { name: "Team Two", color: "#a855f7" },
      { name: "Team Three", color: "#0ea5e9" },
    ];
    await db.insert(teams).values(seedTeams);
    console.log("[DEBUG] seedTeamsIfEmpty: Inserted teams successfully");
  } catch (error) {
    console.error("[DEBUG] seedTeamsIfEmpty: Error", error);
  }
}
