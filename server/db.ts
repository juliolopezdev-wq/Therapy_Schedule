import { and, desc, eq, gt, gte, inArray, lt, lte, ne } from "drizzle-orm";
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
  aiActionLog,
  patientAdditionalMinutes,
  morningDigest,
  therapistAbsences,
  scheduleOverrides,
  digestEmailLog,
  InsertPatient,
  InsertTherapySession,
  InsertStatusFlag,
  InsertTherapist,
  InsertTeam,
  InsertPatientAdditionalMinutes,
  InsertAiActionLog,
  InsertMorningDigestEntry,
  InsertScheduleOverride,
  TherapySession,
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
  return db.select().from(patients).orderBy(patients.orderIndex, patients.roomNumber);
}

export async function getPatientById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(patients).where(eq(patients.id, id)).limit(1);
  return result[0];
}

/** Thrown by createPatient/updatePatient when a room number would be shared by two active
 *  (non-discharged) patients at once. A discharged patient's old room is fair game -- the room
 *  isn't really "in use" once they're gone -- so this only ever compares against other active
 *  patients. */
export class RoomConflictError extends Error {
  constructor(public roomNumber: string, public occupiedByName: string) {
    super(`Room ${roomNumber} is already occupied by ${occupiedByName}.`);
    this.name = "RoomConflictError";
  }
}

/** The active (non-discharged) patient currently holding this room, if any, other than
 *  `excludePatientId` (so an update can check a room against everyone else without tripping
 *  over the patient's own unchanged room number). */
export async function getActivePatientByRoomNumber(roomNumber: string, excludePatientId?: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(patients)
    .where(and(eq(patients.roomNumber, roomNumber), eq(patients.isDischarged, false)));
  return rows.find((p) => p.id !== excludePatientId);
}

export async function createPatient(data: InsertPatient) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!data.isDischarged) {
    const conflict = await getActivePatientByRoomNumber(data.roomNumber);
    if (conflict) throw new RoomConflictError(data.roomNumber, conflict.name);
  }
  const result = await db.insert(patients).values(data);
  return { id: extractInsertId(result) };
}

export async function updatePatient(id: number, data: Partial<InsertPatient>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Only need to check when the patient will actually be active afterward -- a discharged
  // patient (or one being discharged in this same update) can't collide with anyone, and a room
  // that isn't changing was already valid the last time it was checked.
  if (data.roomNumber !== undefined || data.isDischarged !== undefined) {
    const existing = await getPatientById(id);
    if (existing) {
      const resolvedRoom = data.roomNumber ?? existing.roomNumber;
      const resolvedDischarged = data.isDischarged ?? existing.isDischarged;
      if (!resolvedDischarged) {
        const conflict = await getActivePatientByRoomNumber(resolvedRoom, id);
        if (conflict) throw new RoomConflictError(resolvedRoom, conflict.name);
      }
    }
  }

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

/** Whether this patient has ever had a real (non-Block) session of the given discipline --
 *  the signal auto-scheduling uses to decide whether speech therapy belongs in their plan at
 *  all (unlike PT/OT, SLP isn't given to every rehab patient). A single existence check, not a
 *  full row fetch. */
export async function hasEverHadTherapyType(patientId: number, therapyType: "PT" | "OT" | "SLP"): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: therapySessions.id })
    .from(therapySessions)
    .where(and(eq(therapySessions.patientId, patientId), eq(therapySessions.therapyType, therapyType)))
    .limit(1);
  return rows.length > 0;
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

/**
 * Most recent real (non-Block) session, of any status, for each of the given patients -- used
 * to compute how long a care gap has actually run. One query covering every candidate patient
 * (not N sequential per-patient round-trips) -- with a remote HTTP-backed SQLite client, N
 * sequential awaits was costing multiple seconds on every single PAMi turn.
 */
export async function getMostRecentSessionsForPatients(patientIds: number[]): Promise<Map<number, TherapySession>> {
  const result = new Map<number, TherapySession>();
  if (patientIds.length === 0) return result;
  const db = await getDb();
  if (!db) return result;
  const rows = await db
    .select()
    .from(therapySessions)
    .where(and(inArray(therapySessions.patientId, patientIds), ne(therapySessions.therapyType, "Block")));
  for (const row of rows) {
    const existing = result.get(row.patientId);
    if (!existing || new Date(row.startTime).getTime() > new Date(existing.startTime).getTime()) {
      result.set(row.patientId, row);
    }
  }
  return result;
}

/** Thrown by createTherapySession/updateTherapySession when the requested time would
 *  double-book the patient, or double-book the therapist outside a legitimate
 *  concurrent/group pairing. Callers that book in bulk (auto-schedule, copy-day, etc.)
 *  should catch this per-item and skip rather than let one conflict abort the whole batch. */
export class SchedulingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulingConflictError";
  }
}

/**
 * A patient can never legitimately be in two sessions at once, regardless of delivery mode.
 * A therapist CAN legitimately overlap with themselves when every overlapping session -- the
 * new one and each existing one it overlaps -- is "concurrent" or "group" (that's the whole
 * point of those delivery modes). Any overlap involving an "individual" session on either side
 * is a real conflict.
 */
async function assertNoSchedulingConflict(params: {
  patientId: number;
  therapistId: number | null | undefined;
  startTime: Date;
  endTime: Date;
  deliveryMode: "individual" | "concurrent" | "group" | undefined;
  excludeSessionId?: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const { patientId, therapistId, startTime, endTime, excludeSessionId } = params;
  const deliveryMode = params.deliveryMode ?? "individual";

  const overlapCond = and(lt(therapySessions.startTime, endTime), gt(therapySessions.endTime, startTime));
  const idCond = excludeSessionId != null ? ne(therapySessions.id, excludeSessionId) : undefined;

  const patientMatches = await db
    .select()
    .from(therapySessions)
    .where(and(eq(therapySessions.patientId, patientId), overlapCond, idCond));
  if (patientMatches.length > 0) {
    const conflict = patientMatches[0];
    throw new SchedulingConflictError(
      `Patient ${patientId} already has a session (#${conflict.id}, ${conflict.therapyType}) overlapping this time.`,
    );
  }

  if (therapistId != null) {
    const therapistMatches = await db
      .select()
      .from(therapySessions)
      .where(and(eq(therapySessions.therapistId, therapistId), overlapCond, idCond));
    const realConflicts = therapistMatches.filter((existing) => {
      const isMatchingGroupOrConcurrent = 
        deliveryMode === existing.deliveryMode && 
        (deliveryMode === "group" || deliveryMode === "concurrent");
      return !isMatchingGroupOrConcurrent;
    });
    if (realConflicts.length > 0) {
      const conflict = realConflicts[0];
      throw new SchedulingConflictError(
        `Therapist ${therapistId} is already booked (#${conflict.id}, ${conflict.therapyType} with patient ${conflict.patientId}) overlapping this time.`,
      );
    }
  }
}

/** Records one entry in scheduleOverrides -- see server/preferenceLearning.ts for how these get
 *  mined into standing preferences fed back into PAMi's system prompt. */
async function logScheduleOverride(entry: Omit<InsertScheduleOverride, "id" | "createdAt">) {
  const db = await getDb();
  if (!db) return;
  await db.insert(scheduleOverrides).values(entry);
}

/** All override rows since `sinceDate` -- feeds server/preferenceLearning.ts's pattern mining. */
export async function getRecentScheduleOverrides(sinceDate: Date) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scheduleOverrides).where(gte(scheduleOverrides.createdAt, sinceDate));
}

export async function createTherapySession(
  data: InsertTherapySession,
  ignoreConflicts: boolean = false,
  source: "human" | "ai" = "human",
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (!ignoreConflicts) {
    await assertNoSchedulingConflict({
      patientId: data.patientId,
      therapistId: data.therapistId,
      startTime: new Date(data.startTime),
      endTime: new Date(data.endTime),
      deliveryMode: data.deliveryMode,
    });
  }
  const result = await db.insert(therapySessions).values({ ...data, source });
  return { id: extractInsertId(result) };
}

export async function updateTherapySession(
  id: number,
  data: Partial<InsertTherapySession>,
  ignoreConflicts: boolean = false,
  source: "human" | "ai" = "human",
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Fetched unconditionally (not just for the conflict-check path below) so a human edit to a
  // still-"ai" session can be logged as an override before it's overwritten.
  const existing = await getSessionById(id);

  // Only re-check when the change could actually create a new overlap -- editing notes/status
  // shouldn't pay for a conflict scan.
  if (!ignoreConflicts && (data.startTime || data.endTime || data.therapistId !== undefined || data.patientId !== undefined)) {
    if (existing) {
      await assertNoSchedulingConflict({
        patientId: data.patientId ?? existing.patientId,
        therapistId: data.therapistId !== undefined ? data.therapistId : existing.therapistId,
        startTime: data.startTime ? new Date(data.startTime) : new Date(existing.startTime),
        endTime: data.endTime ? new Date(data.endTime) : new Date(existing.endTime),
        deliveryMode: data.deliveryMode ?? existing.deliveryMode,
        excludeSessionId: id,
      });
    }
  }

  const movedOrReassigned = data.startTime !== undefined || data.therapistId !== undefined;
  const nextData: Partial<InsertTherapySession> = { ...data };
  if (existing && existing.source === "ai" && source === "human" && movedOrReassigned) {
    await logScheduleOverride({
      sessionId: id,
      patientId: existing.patientId,
      therapistId: existing.therapistId,
      therapyType: existing.therapyType,
      originalStartTime: new Date(existing.startTime),
      overrideType: data.therapistId !== undefined && data.therapistId !== existing.therapistId ? "reassigned" : "moved",
    });
    // Ownership flips to the human who just overrode it, so later edits aren't re-logged.
    nextData.source = "human";
  }

  await db.update(therapySessions).set(nextData).where(eq(therapySessions.id, id));
  return { success: true };
}

export async function deleteTherapySession(id: number, source: "human" | "ai" = "human") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getSessionById(id);
  if (existing && existing.source === "ai" && source === "human") {
    await logScheduleOverride({
      sessionId: id,
      patientId: existing.patientId,
      therapistId: existing.therapistId,
      therapyType: existing.therapyType,
      originalStartTime: new Date(existing.startTime),
      overrideType: "cancelled",
    });
  }

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

  const deleted = await db.select().from(therapySessions).where(conditions);
  await db.delete(therapySessions).where(conditions);
  return { success: true, timeframe, therapistId, deletedSessions: deleted };
}

export async function copyDayToNextDay(referenceDate: Date, source: "human" | "ai" = "human") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { startOfDay, endOfDay } = dayBounds(referenceDate);
  const sessionsToCopy = await db
    .select()
    .from(therapySessions)
    .where(and(gte(therapySessions.startTime, startOfDay), lte(therapySessions.startTime, endOfDay)));

  if (sessionsToCopy.length === 0) return { success: true, count: 0, skippedConflicts: 0, sessionIds: [] as number[] };

  // Looped (not a single batch insert) so one conflicting copy doesn't abort the rest --
  // each session is checked and created independently, and conflicts are skipped and counted.
  const sessionIds: number[] = [];
  let skippedConflicts = 0;
  for (const s of sessionsToCopy) {
    try {
      const created = await createTherapySession({
        patientId: s.patientId,
        therapistId: s.therapistId,
        therapyType: s.therapyType,
        startTime: new Date(new Date(s.startTime).getTime() + 24 * 60 * 60 * 1000),
        endTime: new Date(new Date(s.endTime).getTime() + 24 * 60 * 60 * 1000),
        durationMinutes: s.durationMinutes,
        deliveryMode: s.deliveryMode,
        notes: s.notes,
        status: s.status,
      }, false, source);
      sessionIds.push(created.id);
    } catch (err) {
      if (err instanceof SchedulingConflictError) {
        skippedConflicts++;
        continue;
      }
      throw err;
    }
  }
  return { success: true, count: sessionIds.length, skippedConflicts, sessionIds };
}

export async function copyPatientSessionsToNextDay(patientId: number, referenceDate: Date, source: "human" | "ai" = "human") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { startOfDay, endOfDay } = dayBounds(referenceDate);
  const sessionsToCopy = await db
    .select()
    .from(therapySessions)
    .where(
      and(
        eq(therapySessions.patientId, patientId),
        gte(therapySessions.startTime, startOfDay),
        lte(therapySessions.startTime, endOfDay)
      )
    );

  if (sessionsToCopy.length === 0) return { success: true, count: 0, skippedConflicts: 0, sessionIds: [] as number[] };

  const sessionIds: number[] = [];
  let skippedConflicts = 0;
  for (const s of sessionsToCopy) {
    try {
      const created = await createTherapySession({
        patientId: s.patientId,
        therapistId: s.therapistId,
        therapyType: s.therapyType,
        startTime: new Date(new Date(s.startTime).getTime() + 24 * 60 * 60 * 1000),
        endTime: new Date(new Date(s.endTime).getTime() + 24 * 60 * 60 * 1000),
        durationMinutes: s.durationMinutes,
        deliveryMode: s.deliveryMode,
        notes: s.notes,
        status: s.status,
      }, false, source);
      sessionIds.push(created.id);
    } catch (err) {
      if (err instanceof SchedulingConflictError) {
        skippedConflicts++;
        continue;
      }
      throw err;
    }
  }
  return { success: true, count: sessionIds.length, skippedConflicts, sessionIds };
}

export async function movePatientSessionsToNextDay(patientId: number, referenceDate: Date, source: "human" | "ai" = "human") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { startOfDay, endOfDay } = dayBounds(referenceDate);
  const sessionsToMove = await db
    .select()
    .from(therapySessions)
    .where(
      and(
        eq(therapySessions.patientId, patientId),
        gte(therapySessions.startTime, startOfDay),
        lte(therapySessions.startTime, endOfDay)
      )
    );

  if (sessionsToMove.length === 0) return { success: true, count: 0, skippedConflicts: 0, sessionIds: [] as number[] };

  const sessionIds: number[] = [];
  let skippedConflicts = 0;
  for (const s of sessionsToMove) {
    try {
      await updateTherapySession(s.id, {
        startTime: new Date(new Date(s.startTime).getTime() + 24 * 60 * 60 * 1000),
        endTime: new Date(new Date(s.endTime).getTime() + 24 * 60 * 60 * 1000),
      }, false, source);
      sessionIds.push(s.id);
    } catch (err) {
      if (err instanceof SchedulingConflictError) {
        skippedConflicts++;
        continue;
      }
      throw err;
    }
  }

  return { success: true, count: sessionIds.length, skippedConflicts, sessionIds };
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

/* ---------------------------------------------------------------------------
 * Additional Minutes
 * ------------------------------------------------------------------------ */

export async function getAdditionalMinutesForDateRange(startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(patientAdditionalMinutes)
    .where(
      and(
        gte(patientAdditionalMinutes.date, startDate),
        lte(patientAdditionalMinutes.date, endDate),
      ),
    );
}

export async function getAdditionalMinutesForPatient(patientId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(patientAdditionalMinutes)
    .where(eq(patientAdditionalMinutes.patientId, patientId))
    .orderBy(desc(patientAdditionalMinutes.date));
}

export async function createAdditionalMinutes(data: InsertPatientAdditionalMinutes) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(patientAdditionalMinutes).values(data).returning();
  return result[0];
}

export async function deleteAdditionalMinutes(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(patientAdditionalMinutes).where(eq(patientAdditionalMinutes.id, id));
}

/* ---------------------------------------------------------------------------
 * Morning gap-fill digest
 * ------------------------------------------------------------------------ */

export async function getMorningDigestForDate(dateKey: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(morningDigest).where(eq(morningDigest.date, dateKey));
}

/** Idempotent: clears any existing rows for this date first, so re-running the job for the
 *  same morning (e.g. a manual refresh, or the scheduler firing twice) replaces rather than
 *  duplicates. */
export async function replaceMorningDigestForDate(dateKey: string, entries: Omit<InsertMorningDigestEntry, "id" | "createdAt" | "date">[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(morningDigest).where(eq(morningDigest.date, dateKey));
  if (entries.length === 0) return;
  await db.insert(morningDigest).values(entries.map((e) => ({ ...e, date: dateKey })));
}

/** Whether the at-risk email digest has already gone out for this date -- the idempotency check
 *  server/atRiskDigestEmail.ts consults before sending (see digestEmailLog in the schema). */
export async function hasDigestEmailBeenSentForDate(dateKey: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select().from(digestEmailLog).where(eq(digestEmailLog.date, dateKey)).limit(1);
  return rows.length > 0;
}

export async function recordDigestEmailSent(dateKey: string, recipientCount: number, atRiskCount: number) {
  const db = await getDb();
  if (!db) return;
  await db.insert(digestEmailLog).values({ date: dateKey, recipientCount, atRiskCount });
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
 * AI action log (undo support for PAMi)
 * ------------------------------------------------------------------------ */

export async function logAiAction(entry: Omit<InsertAiActionLog, "id" | "undone" | "createdAt">) {
  const db = await getDb();
  if (!db) return;
  await withRetry(() => db.insert(aiActionLog).values(entry));
}

/** Most recent still-live (not yet undone) actions, newest first. */
export async function getUndoableActions(limit: number) {
  const db = await getDb();
  if (!db) return [];
  return withRetry(() =>
    db
      .select()
      .from(aiActionLog)
      .where(eq(aiActionLog.undone, false))
      .orderBy(desc(aiActionLog.id))
      .limit(limit),
  );
}

export async function markAiActionUndone(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await withRetry(() => db.update(aiActionLog).set({ undone: true }).where(eq(aiActionLog.id, id)));
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

/* ---------------------------------------------------------------------------
 * Attendance / Call-Off Helpers
 * ------------------------------------------------------------------------ */

export async function getTherapistAbsences(date: Date) {
  const db = await getDb();
  if (!db) return [];
  const { startOfDay, endOfDay } = dayBounds(date);
  return db
    .select()
    .from(therapistAbsences)
    .where(and(gte(therapistAbsences.date, startOfDay), lte(therapistAbsences.date, endOfDay)));
}

export async function callOffTherapist(therapistId: number, date: Date, reason: string = "Call-Off") {
  const db = await getDb();
  if (!db) throw new Error("DB uninitialized");

  const { startOfDay, endOfDay } = dayBounds(date);

  // 1. Mark absent
  await db.insert(therapistAbsences).values({
    therapistId,
    date: startOfDay,
    reason,
  });

  // 2. Fetch the target therapist to know their discipline
  const [targetTherapist] = await db.select().from(therapists).where(eq(therapists.id, therapistId));
  if (!targetTherapist) {
     return { success: true, reAssignedCount: 0, unassignedCount: 0 };
  }

  // 3. Find candidates of the same discipline
  const allCandidates = await db.select().from(therapists).where(eq(therapists.therapyType, targetTherapist.therapyType));
  
  // Exclude the target and any already absent therapists
  const absentRecords = await db.select().from(therapistAbsences).where(
      and(gte(therapistAbsences.date, startOfDay), lte(therapistAbsences.date, endOfDay))
  );
  const absentIds = new Set(absentRecords.map(r => r.therapistId));
  
  const dayOfWeek = date.getDay();
  let candidates = allCandidates.filter(t => !absentIds.has(t.id));

  // Filter candidates by workDays if defined
  candidates = candidates.filter(t => {
    if (t.workDays) {
      const days = t.workDays.split(',').map(Number);
      if (!days.includes(dayOfWeek)) return false;
    }
    return true;
  });

  // Calculate current workload for each candidate
  const workloads = new Map<number, number>();
  for (const c of candidates) workloads.set(c.id, 0);

  if (candidates.length > 0) {
    const candidateSessions = await db
      .select()
      .from(therapySessions)
      .where(
        and(
          inArray(therapySessions.therapistId, candidates.map(c => c.id)),
          gte(therapySessions.startTime, startOfDay),
          lte(therapySessions.startTime, endOfDay)
        )
      );

    for (const s of candidateSessions) {
      if (s.therapistId) {
        workloads.set(s.therapistId, (workloads.get(s.therapistId) || 0) + s.durationMinutes);
      }
    }
  }

  // 4. Fetch affected sessions
  const affectedSessions = await db
    .select()
    .from(therapySessions)
    .where(
      and(
        eq(therapySessions.therapistId, therapistId),
        gte(therapySessions.startTime, startOfDay),
        lte(therapySessions.startTime, endOfDay)
      )
    );

  let reAssignedCount = 0;
  let unassignedCount = 0;
  const reassignedTo: Record<number, number> = {};
  const suggestions: string[] = [];

  for (const session of affectedSessions) {
    let reAssigned = false;
    const sessionStart = session.startTime.getHours() * 60 + session.startTime.getMinutes();
    const sessionEnd = session.endTime.getHours() * 60 + session.endTime.getMinutes();

    // Sort candidates by workload (lowest first) dynamically
    const sortedCandidates = [...candidates].sort((a, b) => (workloads.get(a.id) || 0) - (workloads.get(b.id) || 0));

    let bestFallback: typeof candidates[0] | null = null;

    for (const candidate of sortedCandidates) {
      // Check shift times
      if (candidate.workStartTime) {
        const [h, m] = candidate.workStartTime.split(':').map(Number);
        if (sessionStart < h * 60 + m) continue;
      }
      if (candidate.workEndTime) {
        const [h, m] = candidate.workEndTime.split(':').map(Number);
        if (sessionEnd > h * 60 + m) continue;
      }

      // Track the first valid candidate (shift matches) as best fallback even if conflict
      if (!bestFallback) {
        bestFallback = candidate;
      }

      try {
        await assertNoSchedulingConflict({
          patientId: session.patientId,
          therapistId: candidate.id,
          startTime: session.startTime,
          endTime: session.endTime,
          deliveryMode: session.deliveryMode as "individual" | "concurrent" | "group",
          excludeSessionId: session.id,
        });
        
        // Success! No conflict. Reassign to this candidate.
        await db.update(therapySessions)
          .set({ therapistId: candidate.id })
          .where(eq(therapySessions.id, session.id));
          
        reAssignedCount++;
        reassignedTo[candidate.id] = (reassignedTo[candidate.id] || 0) + 1;
        workloads.set(candidate.id, (workloads.get(candidate.id) || 0) + session.durationMinutes);
        reAssigned = true;
        break; // Stop looking for a candidate for this session
      } catch (err) {
        if (err instanceof SchedulingConflictError) {
           continue; // try next candidate
        }
        throw err;
      }
    }

    if (!reAssigned) {
      // Unassigned gap, stays as 'scheduled' so it can still be filled
      await db.update(therapySessions)
        .set({ therapistId: null, status: "scheduled" })
        .where(eq(therapySessions.id, session.id));
      unassignedCount++;

      // Generate AI suggestion for unassigned session
      const timeString = session.startTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (bestFallback) {
        suggestions.push(`${timeString}: Best option is ${bestFallback.name} (lowest load today). Consider swapping their existing session to fit this in.`);
      } else {
        suggestions.push(`${timeString}: No working therapist of matching discipline available.`);
      }
    }
  }

  return { success: true, reAssignedCount, unassignedCount, reassignedTo, suggestions };
}

export async function cancelCallOffTherapist(therapistId: number, date: Date) {
  const db = await getDb();
  if (!db) throw new Error("DB uninitialized");

  const { startOfDay, endOfDay } = dayBounds(date);
  await db
    .delete(therapistAbsences)
    .where(
      and(
        eq(therapistAbsences.therapistId, therapistId),
        gte(therapistAbsences.date, startOfDay),
        lte(therapistAbsences.date, endOfDay)
      )
    );

  return { success: true };
}
