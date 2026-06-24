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
      const client = createClient({
        url: dbUrl,
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
  return { id: Number((result as unknown as { insertId: number }[])[0]?.insertId ?? 0) };
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
  return { id: Number((result as unknown as { insertId: number }[])[0]?.insertId ?? 0) };
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
  return { id: Number((result as unknown as { insertId: number }[])[0]?.insertId ?? 0) };
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
  return { id: Number((result as unknown as { insertId: number }[])[0]?.insertId ?? 0) };
}

/* ---------------------------------------------------------------------------
 * Status Flags
 * ------------------------------------------------------------------------ */

export async function getStatusFlagsForDate(date: Date) {
  const db = await getDb();
  if (!db) return [];
  const { startOfDay, endOfDay } = dayBounds(date);
  return db
    .select()
    .from(statusFlags)
    .where(and(gte(statusFlags.date, startOfDay), lte(statusFlags.date, endOfDay)));
}

export async function createStatusFlag(data: InsertStatusFlag) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(statusFlags).values(data);
  return { id: Number((result as unknown as { insertId: number }[])[0]?.insertId ?? 0) };
}

export async function deleteStatusFlag(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(statusFlags).where(eq(statusFlags.id, id));
  return { success: true };
}

export async function deleteStatusFlagByPatientAndType(
  patientId: number,
  flagType: "DC" | "Name Alert" | "Weekend" | "In-Service" | "Appointment" | "Stroke Program",
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

export async function getBoardHistory() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(boardHistory).orderBy(boardHistory.date);
}

export async function getSnapshotForDate(date: Date) {
  const db = await getDb();
  if (!db) return undefined;
  const { startOfDay, endOfDay } = dayBounds(date);
  const result = await db
    .select()
    .from(boardHistory)
    .where(and(gte(boardHistory.date, startOfDay), lte(boardHistory.date, endOfDay)))
    .limit(1);
  return result[0];
}

export async function saveBoardSnapshot(date: Date, snapshot: unknown) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Remove existing snapshot for the date, then insert a fresh one
  const { startOfDay, endOfDay } = dayBounds(date);
  await db
    .delete(boardHistory)
    .where(and(gte(boardHistory.date, startOfDay), lte(boardHistory.date, endOfDay)));
  const result = await db.insert(boardHistory).values({ date, snapshot: snapshot as object });
  return { id: Number((result as unknown as { insertId: number }[])[0]?.insertId ?? 0) };
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
