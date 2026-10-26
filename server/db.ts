import { storeMessage, readMessage, boardMessageContext, directMessageContext } from "./messageEncryption";
import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
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
  weekendStaffingOverrides,
  InsertWeekendStaffingOverride,
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
  invites,
  Invite,
  InsertInvite,
  magicLinks,
  InsertMagicLink,
  sessions,
  InsertSession,
  auditLog,
  InsertAuditLogEntry,
  staffMessages,
  staffMessageAcknowledgements,
  InsertStaffMessage,
  staffDirectMessages,
  InsertStaffDirectMessage,
  scheduleChangeRequests,
  InsertScheduleChangeRequest,
  patientAccessLog,
  treatmentNotes,
  InsertTreatmentNote,
  patientGoals,
  InsertPatientGoal,
  functionalAssessments,
  InsertFunctionalAssessment,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { isMissedStatus, isCanceledStatus } from "../shared/weekUtils";
import { availableShiftMinutesForDay } from "../shared/workSchedule";
import { isActiveAdmission } from "../shared/patientLifecycle";
import { getSessionTimingError } from "../shared/sessionValidation";
import { therapyDiscipline, type TherapyType } from "../shared/therapyTypes";

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

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
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
  return db
    .select()
    .from(patients)
    .where(isNull(patients.archivedAt))
    .orderBy(patients.orderIndex, patients.roomNumber);
}

export async function getArchivedPatients() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(patients)
    .where(and(isNotNull(patients.archivedAt), eq(patients.isRoomPlaceholder, false)))
    .orderBy(desc(patients.archivedAt));
}

/** Includes archived episodes for historical reports; never use this for live census work. */
export async function getAllPatientAdmissions() {
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

export class ActiveMrnConflictError extends Error {
  constructor(public mrn: string) {
    super(`MRN ${mrn} already has an active admission.`);
    this.name = "ActiveMrnConflictError";
  }
}

async function getActiveAdmissionByMrn(mrn: string, excludePatientId?: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(patients)
    .where(and(
      eq(patients.mrn, mrn.trim().toUpperCase()),
      eq(patients.isDischarged, false),
      eq(patients.isRoomPlaceholder, false),
      isNull(patients.archivedAt),
    ));
  return rows.find((row) => row.id !== excludePatientId);
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
    .where(and(
      eq(patients.roomNumber, roomNumber.trim()),
      eq(patients.isDischarged, false),
      eq(patients.isRoomPlaceholder, false),
      isNull(patients.archivedAt),
    ));
  return rows.find((p) => p.id !== excludePatientId);
}

function normalizePatientData(data: Partial<InsertPatient>): Partial<InsertPatient> {
  return {
    ...data,
    ...(data.roomNumber !== undefined ? { roomNumber: data.roomNumber.trim() } : {}),
    ...(data.name !== undefined ? { name: data.name.trim() } : {}),
    ...(data.mrn !== undefined ? { mrn: data.mrn?.trim().toUpperCase() || null } : {}),
  };
}

export async function createPatient(data: InsertPatient) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalized = normalizePatientData(data) as InsertPatient;
  if (!normalized.isRoomPlaceholder && !normalized.mrn) {
    throw new Error("MRN is required for a patient admission");
  }
  if (normalized.previousAdmissionId) {
    const previous = await getPatientById(normalized.previousAdmissionId);
    if (!previous || previous.isRoomPlaceholder) throw new Error("Previous admission not found");
    if (previous.mrn && previous.mrn !== normalized.mrn) {
      throw new Error("Previous admission MRN does not match the new admission");
    }
  }
  if (!normalized.isDischarged && !normalized.isRoomPlaceholder) {
    const conflict = await getActivePatientByRoomNumber(normalized.roomNumber);
    if (conflict) throw new RoomConflictError(data.roomNumber, conflict.name);
    if (normalized.mrn && await getActiveAdmissionByMrn(normalized.mrn)) {
      throw new ActiveMrnConflictError(normalized.mrn);
    }
  }

  if (!normalized.isRoomPlaceholder && normalized.mrn && !normalized.previousAdmissionId) {
    const previous = await db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.mrn, normalized.mrn), eq(patients.isRoomPlaceholder, false)))
      .orderBy(desc(patients.id))
      .limit(1);
    if (previous[0]) normalized.previousAdmissionId = previous[0].id;
  }

  // A real admission replaces the vacant-room marker for that room. The marker has no clinical
  // data and exists only to keep open rooms visible on the board.
  return db.transaction(async (tx) => {
    if (!normalized.isRoomPlaceholder) {
      await tx.delete(patients).where(and(
        eq(patients.roomNumber, normalized.roomNumber),
        eq(patients.isRoomPlaceholder, true),
        isNull(patients.archivedAt),
      ));
    }
    const result = await tx.insert(patients).values(normalized);
    return { id: extractInsertId(result) };
  });
}

export async function updatePatient(id: number, data: Partial<InsertPatient>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalized = normalizePatientData(data);
  normalized.updatedAt = new Date();
  const existing = await getPatientById(id);
  if (!existing) throw new Error("Admission not found");

  if (existing.isRoomPlaceholder && normalized.isRoomPlaceholder === false) {
    throw new Error("Create a new admission instead of converting an available-room marker");
  }

  // Only need to check when the patient will actually be active afterward -- a discharged
  // patient (or one being discharged in this same update) can't collide with anyone, and a room
  // that isn't changing was already valid the last time it was checked.
  if (normalized.roomNumber !== undefined || normalized.isDischarged !== undefined || normalized.isRoomPlaceholder !== undefined) {
    const resolvedRoom = normalized.roomNumber ?? existing.roomNumber;
    const resolvedDischarged = normalized.isDischarged ?? existing.isDischarged;
    const resolvedPlaceholder = normalized.isRoomPlaceholder ?? existing.isRoomPlaceholder;
    if (!resolvedDischarged && !resolvedPlaceholder) {
      const conflict = await getActivePatientByRoomNumber(resolvedRoom, id);
      if (conflict) throw new RoomConflictError(resolvedRoom, conflict.name);
      const resolvedMrn = normalized.mrn ?? existing.mrn;
      if (resolvedMrn && await getActiveAdmissionByMrn(resolvedMrn, id)) {
        throw new ActiveMrnConflictError(resolvedMrn);
      }
    }
  }

  const justDischarged = normalized.isDischarged === true && !existing.isDischarged && !existing.isRoomPlaceholder;
  let dischargeCutoff = new Date();
  if (justDischarged) {
    const [latestDischargeFlag] = await db
      .select()
      .from(statusFlags)
      .where(and(eq(statusFlags.patientId, id), eq(statusFlags.flagType, "DC")))
      .orderBy(desc(statusFlags.date), desc(statusFlags.id))
      .limit(1);
    if (latestDischargeFlag?.active) dischargeCutoff = new Date(latestDischargeFlag.date);
  }
  let canceledSessionCount = 0;
  await db.transaction(async (tx) => {
    await tx.update(patients).set(normalized).where(eq(patients.id, id));
    if (justDischarged) {
      const sessionsToCancel = await tx
        .select({ id: therapySessions.id })
        .from(therapySessions)
        .where(and(
          eq(therapySessions.patientId, id),
          eq(therapySessions.status, "scheduled"),
          gte(therapySessions.startTime, dischargeCutoff),
        ));
      canceledSessionCount = sessionsToCancel.length;
      if (canceledSessionCount > 0) {
        await tx
          .update(therapySessions)
          .set({ status: "canceled_discharge", actualDurationMinutes: null, missedReason: null, updatedAt: new Date() })
          .where(and(
            eq(therapySessions.patientId, id),
            eq(therapySessions.status, "scheduled"),
            gte(therapySessions.startTime, dischargeCutoff),
          ));
      }
      const roomNumber = normalized.roomNumber ?? existing.roomNumber;
      const teamId = normalized.teamId !== undefined ? normalized.teamId : existing.teamId;
      const existingPlaceholder = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(
          eq(patients.roomNumber, roomNumber),
          eq(patients.isRoomPlaceholder, true),
          isNull(patients.archivedAt),
        ))
        .limit(1);
      if (!existingPlaceholder[0]) {
        await tx.insert(patients).values({
          roomNumber,
          name: "Available",
          isDischarged: false,
          isRoomPlaceholder: true,
          weeklyMinuteTarget: 900,
          teamId,
        });
      }
    }
  });
  return { success: true, canceledSessionCount, dischargeCutoff: justDischarged ? dischargeCutoff : null };
}

/**
 * Move an active admission to a new position (and optionally a new team) in one
 * transaction. Re-numbering the affected lists avoids duplicate/fractional order
 * values, which made older admissions occasionally snap back after a drag.
 */
export async function reorderPatient(
  patientId: number,
  targetTeamId: number | null,
  targetPatientId?: number | null,
  placeAfter = false,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    const activePatients = await tx
      .select()
      .from(patients)
      .where(and(isNull(patients.archivedAt), eq(patients.isDischarged, false)))
      .orderBy(patients.orderIndex, patients.roomNumber);

    const moving = activePatients.find((patient) => patient.id === patientId);
    if (!moving) throw new Error("Active admission not found");

    const sameTeam = (teamId: number | null, candidateTeamId: number | null) =>
      teamId === candidateTeamId;
    const sourceTeamId = moving.teamId;
    const destination = activePatients.filter(
      (patient) => patient.id !== patientId && sameTeam(patient.teamId, targetTeamId),
    );

    let insertAt = destination.length;
    if (targetPatientId != null) {
      const targetIndex = destination.findIndex((patient) => patient.id === targetPatientId);
      if (targetIndex === -1) throw new Error("Drop target is no longer available");
      insertAt = targetIndex + (placeAfter ? 1 : 0);
    }
    destination.splice(insertAt, 0, { ...moving, teamId: targetTeamId });

    const source = sameTeam(sourceTeamId, targetTeamId)
      ? []
      : activePatients.filter(
          (patient) => patient.id !== patientId && sameTeam(patient.teamId, sourceTeamId),
        );
    const now = new Date();

    for (let index = 0; index < destination.length; index += 1) {
      const patient = destination[index];
      await tx
        .update(patients)
        .set({
          teamId: patient.id === patientId ? targetTeamId : patient.teamId,
          orderIndex: (index + 1) * 100,
          updatedAt: now,
        })
        .where(eq(patients.id, patient.id));
    }
    for (let index = 0; index < source.length; index += 1) {
      const patient = source[index];
      await tx
        .update(patients)
        .set({ orderIndex: (index + 1) * 100, updatedAt: now })
        .where(eq(patients.id, patient.id));
    }

    return { success: true, teamId: targetTeamId, orderIndex: (insertAt + 1) * 100 };
  });
}

export async function archivePatient(id: number, archivedByUserId: number, archiveReason?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const patient = await getPatientById(id);
  if (!patient || patient.isRoomPlaceholder) throw new Error("Admission not found");
  if (patient.archivedAt) throw new Error("Admission is already archived");
  await db.transaction(async (tx) => {
    await tx.update(patients).set({
      archivedAt: new Date(),
      archivedByUserId,
      archiveReason: archiveReason?.trim() || null,
      isDischarged: true,
      updatedAt: new Date(),
    }).where(eq(patients.id, id));
    if (!patient.isDischarged) {
      const existingPlaceholder = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(
          eq(patients.roomNumber, patient.roomNumber),
          eq(patients.isRoomPlaceholder, true),
          isNull(patients.archivedAt),
        ))
        .limit(1);
      if (!existingPlaceholder[0]) {
        await tx.insert(patients).values({
          roomNumber: patient.roomNumber,
          name: "Available",
          isDischarged: false,
          isRoomPlaceholder: true,
          weeklyMinuteTarget: 900,
          teamId: patient.teamId,
        });
      }
    }
  });
  return { success: true };
}

export async function restorePatient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const patient = await getPatientById(id);
  if (!patient?.archivedAt || patient.isRoomPlaceholder) throw new Error("Archived admission not found");
  await db.update(patients).set({
    archivedAt: null,
    archivedByUserId: null,
    archiveReason: null,
    // Restoration only reveals the historical episode; re-admission is always a separate action.
    isDischarged: true,
    updatedAt: new Date(),
  }).where(eq(patients.id, id));
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
export async function hasEverHadTherapyType(patientId: number, therapyType: TherapyType): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: therapySessions.id })
    .from(therapySessions)
    .where(and(eq(therapySessions.patientId, patientId), eq(therapySessions.therapyType, therapyType)))
    .limit(1);
  return rows.length > 0;
}

export async function hasEverHadAnyTherapyType(patientId: number, types: readonly TherapyType[]): Promise<boolean> {
  if (types.length === 0) return false;
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: therapySessions.id })
    .from(therapySessions)
    .where(and(eq(therapySessions.patientId, patientId), inArray(therapySessions.therapyType, [...types])))
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
/** Most recent completed, non-block treatment for each patient. */
export async function getMostRecentSessionsForPatients(patientIds: number[]): Promise<Map<number, TherapySession>> {
  const result = new Map<number, TherapySession>();
  if (patientIds.length === 0) return result;
  const db = await getDb();
  if (!db) return result;
  const rows = await db
    .select()
    .from(therapySessions)
    .where(
      and(
        inArray(therapySessions.patientId, patientIds),
        ne(therapySessions.therapyType, "Block"),
        eq(therapySessions.status, "completed"),
      ),
    );
  for (const row of rows) {
    const existing = result.get(row.patientId);
    if (!existing || new Date(row.startTime).getTime() > new Date(existing.startTime).getTime()) {
      result.set(row.patientId, row);
    }
  }
  return result;
}

/**
 * Most recent past session's notes for a patient in a given discipline, excluding a specific
 * session id (the one currently being edited, if any) and any Block sessions -- used to carry
 * a note forward into a new session so staff edit deltas instead of writing one from scratch.
 * Only ever reads sessions that already started, so it never surfaces a future/still-scheduled
 * session's placeholder notes as if they were a completed note.
 */
export async function getLastSessionNoteForPatient(
  patientId: number,
  therapyType: TherapyType,
  referenceDate: Date,
  excludeSessionId?: number,
  therapistId?: number,
): Promise<{ sessionId: number; startTime: Date; notes: string } | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const idCond = excludeSessionId != null ? ne(therapySessions.id, excludeSessionId) : undefined;
  const rows = await db
    .select()
    .from(therapySessions)
    .where(
      and(
        eq(therapySessions.patientId, patientId),
        eq(therapySessions.therapyType, therapyType),
        lt(therapySessions.startTime, referenceDate),
        idCond,
        therapistId != null ? eq(therapySessions.therapistId, therapistId) : undefined,
      ),
    );
  const withNotes = rows.filter((r) => r.notes && r.notes.trim().length > 0);
  if (withNotes.length === 0) return undefined;
  const mostRecent = withNotes.reduce((latest, r) =>
    new Date(r.startTime).getTime() > new Date(latest.startTime).getTime() ? r : latest,
  );
  return { sessionId: mostRecent.id, startTime: mostRecent.startTime, notes: mostRecent.notes! };
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

export class SchedulingEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulingEligibilityError";
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
  ignoreTherapistConflicts?: boolean;
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
  const activePatientMatches = patientMatches.filter((session) => !isCanceledStatus(session.status));
  if (activePatientMatches.length > 0) {
    const conflict = activePatientMatches[0];
    throw new SchedulingConflictError(
      `Patient ${patientId} already has a session (#${conflict.id}, ${conflict.therapyType}) overlapping this time.`,
    );
  }

  if (therapistId != null && !params.ignoreTherapistConflicts) {
    const therapistMatches = await db
      .select()
      .from(therapySessions)
      .where(and(eq(therapySessions.therapistId, therapistId), overlapCond, idCond));
    const realConflicts = therapistMatches.filter((existing) => {
      if (isCanceledStatus(existing.status)) return false;
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

async function assertSchedulablePatient(patientId: number): Promise<void> {
  const patient = await getPatientById(patientId);
  if (!patient || !isActiveAdmission(patient)) {
    throw new SchedulingEligibilityError("Sessions can only be scheduled for an active admission.");
  }
}

async function assertActiveTherapist(therapistId: number | null | undefined): Promise<void> {
  if (therapistId == null) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [therapist] = await db.select().from(therapists).where(eq(therapists.id, therapistId)).limit(1);
  if (!therapist || therapist.archivedAt) {
    throw new SchedulingEligibilityError("Sessions can only be assigned to an active staff member.");
  }
}

async function assertTherapistDiscipline(
  therapistId: number | null | undefined,
  therapyType: TherapyType,
): Promise<void> {
  const requiredDiscipline = therapyDiscipline(therapyType);
  if (therapistId == null || requiredDiscipline == null) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [therapist] = await db.select().from(therapists).where(eq(therapists.id, therapistId)).limit(1);
  if (therapist?.therapyType !== requiredDiscipline) {
    throw new SchedulingEligibilityError(`${therapyType} sessions must be assigned to a ${requiredDiscipline} therapist.`);
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
  const startTime = new Date(data.startTime);
  const endTime = new Date(data.endTime);
  const timingError = getSessionTimingError({ startTime, endTime, durationMinutes: data.durationMinutes });
  if (timingError) throw new Error(timingError);
  await assertSchedulablePatient(data.patientId);
  await assertActiveTherapist(data.therapistId);
  await assertTherapistDiscipline(data.therapistId, data.therapyType);
  await assertNoSchedulingConflict({
    patientId: data.patientId,
    therapistId: data.therapistId,
    startTime,
    endTime,
    deliveryMode: data.deliveryMode,
    // Explicit overrides may permit a therapist warning, but never two sessions for one patient.
    ignoreTherapistConflicts: ignoreConflicts,
  });
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
  if (!existing) throw new Error("Session not found");

  const nextStartTime = data.startTime ? new Date(data.startTime) : new Date(existing.startTime);
  const nextEndTime = data.endTime ? new Date(data.endTime) : new Date(existing.endTime);
  const nextDuration = data.durationMinutes ?? existing.durationMinutes;
  if (data.startTime !== undefined || data.endTime !== undefined || data.durationMinutes !== undefined) {
    const timingError = getSessionTimingError({
      startTime: nextStartTime,
      endTime: nextEndTime,
      durationMinutes: nextDuration,
    });
    if (timingError) throw new Error(timingError);
  }
  if (data.patientId !== undefined && data.patientId !== existing.patientId) {
    await assertSchedulablePatient(data.patientId);
  }
  if (data.therapistId !== undefined && data.therapistId !== existing.therapistId) {
    await assertActiveTherapist(data.therapistId);
  }
  if (data.therapistId !== undefined || data.therapyType !== undefined) {
    await assertTherapistDiscipline(
      data.therapistId !== undefined ? data.therapistId : existing.therapistId,
      data.therapyType ?? existing.therapyType,
    );
  }

  // Only re-check when the change could actually create a new overlap -- editing notes/status
  // shouldn't pay for a conflict scan.
  if (data.startTime || data.endTime || data.therapistId !== undefined || data.patientId !== undefined) {
    await assertNoSchedulingConflict({
      patientId: data.patientId ?? existing.patientId,
      therapistId: data.therapistId !== undefined ? data.therapistId : existing.therapistId,
      startTime: nextStartTime,
      endTime: nextEndTime,
      deliveryMode: data.deliveryMode ?? existing.deliveryMode,
      excludeSessionId: id,
      ignoreTherapistConflicts: ignoreConflicts,
    });
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

/** Mark every still-scheduled treatment on one calendar day as completed.
 * Block time and sessions already documented as completed/missed are intentionally untouched. */
export async function completeAllTherapySessionsForDate(date: Date, therapistId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { startOfDay, endOfDay } = dayBounds(date);

  return db.transaction(async (tx) => {
    const eligible = await tx
      .select({ id: therapySessions.id })
      .from(therapySessions)
      .where(and(
        gte(therapySessions.startTime, startOfDay),
        lte(therapySessions.startTime, endOfDay),
        eq(therapySessions.status, "scheduled"),
        ne(therapySessions.therapyType, "Block"),
        therapistId != null ? eq(therapySessions.therapistId, therapistId) : undefined,
      ));

    if (eligible.length === 0) return { count: 0 };

    await tx
      .update(therapySessions)
      .set({
        status: "completed",
        // The confirmation explicitly verifies the scheduled treatment was delivered, so store
        // that duration as the actual delivered value instead of relying on analytics fallbacks.
        actualDurationMinutes: sql`${therapySessions.durationMinutes}`,
        missedReason: null,
        updatedAt: new Date(),
      })
      .where(inArray(therapySessions.id, eligible.map((session) => session.id)));

    return { count: eligible.length };
  });
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

  if (sessionsToCopy.length === 0) return { success: true, count: 0, skippedConflicts: 0, skippedUnavailable: 0, sessionIds: [] as number[] };

  // Looped (not a single batch insert) so one conflicting copy doesn't abort the rest --
  // each session is checked and created independently, and conflicts are skipped and counted.
  const sessionIds: number[] = [];
  let skippedConflicts = 0;
  let skippedUnavailable = 0;
  for (const s of sessionsToCopy) {
    try {
      // Advance by one calendar day so the local clock time remains stable across DST changes.
      const nextStart = new Date(s.startTime);
      nextStart.setDate(nextStart.getDate() + 1);
      const nextEnd = new Date(s.endTime);
      nextEnd.setDate(nextEnd.getDate() + 1);
      const created = await createTherapySession({
        patientId: s.patientId,
        therapistId: s.therapistId,
        therapyType: s.therapyType,
        startTime: nextStart,
        endTime: nextEnd,
        durationMinutes: s.durationMinutes,
        deliveryMode: s.deliveryMode,
        notes: s.notes,
        // This is a new schedule, not a copy of yesterday's clinical outcome.
        status: "scheduled",
      }, false, source);
      sessionIds.push(created.id);
    } catch (err) {
      if (err instanceof SchedulingConflictError) {
        skippedConflicts++;
        continue;
      }
      if (err instanceof SchedulingEligibilityError) {
        skippedUnavailable++;
        continue;
      }
      throw err;
    }
  }
  return { success: true, count: sessionIds.length, skippedConflicts, skippedUnavailable, sessionIds };
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

/** `linkedUserEmail`/`linkedUserRole` surface whether this staff profile has a login account
 *  tied to it (therapists.userId -> users.id) -- shown in Staff Management so an admin can see
 *  who can actually sign in vs. who's roster-only. */
export async function getTherapists() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ ...getTableColumns(therapists), linkedUserEmail: users.email, linkedUserRole: users.role })
    .from(therapists)
    .leftJoin(users, eq(therapists.userId, users.id))
    .where(isNull(therapists.archivedAt))
    .orderBy(therapists.name);
}

export async function getArchivedTherapists() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ ...getTableColumns(therapists), linkedUserEmail: users.email, linkedUserRole: users.role })
    .from(therapists)
    .leftJoin(users, eq(therapists.userId, users.id))
    .where(isNotNull(therapists.archivedAt))
    .orderBy(desc(therapists.archivedAt));
}

/** Count of sessions today or later for a therapist -- shown in the archive confirmation so an
 *  admin isn't archiving blind. Past sessions are left alone either way (history is retained). */
export async function countUpcomingSessionsForTherapist(therapistId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const result = await db
    .select({ id: therapySessions.id })
    .from(therapySessions)
    .where(and(eq(therapySessions.therapistId, therapistId), gte(therapySessions.startTime, todayStart)));
  return result.length;
}

export async function archiveTherapist(id: number, archivedByUserId: number, archiveReason?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [therapist] = await db.select().from(therapists).where(eq(therapists.id, id)).limit(1);
  if (!therapist) throw new Error("Staff member not found");
  if (therapist.archivedAt) throw new Error("Staff member is already archived");
  await db.update(therapists).set({
    archivedAt: new Date(),
    archivedByUserId,
    archiveReason: archiveReason?.trim() || null,
    updatedAt: new Date(),
  }).where(eq(therapists.id, id));
  return { success: true };
}

export async function restoreTherapist(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [therapist] = await db.select().from(therapists).where(eq(therapists.id, id)).limit(1);
  if (!therapist?.archivedAt) throw new Error("Archived staff member not found");
  await db.update(therapists).set({
    archivedAt: null,
    archivedByUserId: null,
    archiveReason: null,
    updatedAt: new Date(),
  }).where(eq(therapists.id, id));
  return { success: true };
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
    .orderBy(desc(statusFlags.id))
    .limit(1);

  let id: number;
  if (existing.length > 0) {
    // Update every duplicate from this effective day if legacy/concurrent writes created more
    // than one. Otherwise an older opposite-valued row can win depending on query ordering.
    await db
      .update(statusFlags)
      .set({ active, date })
      .where(
        and(
          eq(statusFlags.patientId, patientId),
          eq(statusFlags.flagType, flagType),
          gte(statusFlags.date, startOfDay),
          lte(statusFlags.date, endOfDay),
        ),
      );
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
  return withRetry(() => db.select().from(boardHistory).orderBy(desc(boardHistory.createdAt)));
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
      .orderBy(desc(boardHistory.createdAt))
      .limit(1),
  );
  return result[0];
}

export async function saveBoardSnapshot(
  date: Date,
  options: { note?: string; actorUserId: number; actorEmail: string | null },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Build the record from server-side data rather than trusting a large browser-supplied object.
  // Only retain fields needed to reconstruct the board record; patient/staff notes, MRNs,
  // emails, availability, and other unrelated data are deliberately excluded.
  const [sessions, patientRows, flagRows, therapistRows, teamRows] = await Promise.all([
    getTherapySessions(date),
    getPatients(),
    getStatusFlagsForDate(date),
    getTherapists(),
    getTeams(),
  ]);
  const { startOfDay, endOfDay } = dayBounds(date);
  const existing = await withRetry(() =>
    db.select({ id: boardHistory.id })
      .from(boardHistory)
      .where(and(gte(boardHistory.date, startOfDay), lte(boardHistory.date, endOfDay))),
  );
  const revision = existing.length + 1;
  const snapshot = {
    schemaVersion: 2,
    metadata: {
      revision,
      source: "manual",
      note: options.note?.trim() || null,
      savedByUserId: options.actorUserId,
      savedByEmail: options.actorEmail,
    },
    summary: {
      sessions: sessions.length,
      patients: new Set(sessions.filter((session) => session.therapyType !== "Block").map((session) => session.patientId)).size,
      therapists: new Set(sessions.map((session) => session.therapistId).filter((id) => id != null)).size,
      minutes: sessions.reduce((total, session) => total + session.durationMinutes, 0),
    },
    sessions: sessions.map((session) => ({
      id: session.id,
      patientId: session.patientId,
      therapistId: session.therapistId,
      therapyType: session.therapyType,
      startTime: session.startTime,
      endTime: session.endTime,
      durationMinutes: session.durationMinutes,
      actualDurationMinutes: session.actualDurationMinutes,
      deliveryMode: session.deliveryMode,
      status: session.status,
    })),
    patients: patientRows.map((patient) => ({
      id: patient.id,
      roomNumber: patient.roomNumber,
      name: patient.name,
      isDischarged: patient.isDischarged,
      isRoomPlaceholder: patient.isRoomPlaceholder,
      teamId: patient.teamId,
    })),
    flags: flagRows.map((flag) => ({
      id: flag.id,
      patientId: flag.patientId,
      flagType: flag.flagType,
      date: flag.date,
      active: flag.active,
    })),
    therapists: therapistRows.map((therapist) => ({
      id: therapist.id,
      name: therapist.name,
      therapyType: therapist.therapyType,
      teamId: therapist.teamId,
      color: therapist.color,
    })),
    teams: teamRows.map((team) => ({ id: team.id, name: team.name, color: team.color })),
  };
  const result = await withRetry(() => db.insert(boardHistory).values({ date, snapshot: snapshot as object }));
  return { id: extractInsertId(result), revision, summary: snapshot.summary };
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

export interface CallOffAssignmentChange {
  sessionId: number;
  previous: { therapistId: number | null; startTime: string; endTime: string; status: TherapySession["status"] };
  applied: { therapistId: number | null; startTime: string; endTime: string; status: TherapySession["status"] };
}

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

  // 1. Fetch the target therapist and reject archived/missing staff.
  const [targetTherapist] = await db.select().from(therapists).where(eq(therapists.id, therapistId));
  if (!targetTherapist || targetTherapist.archivedAt) throw new Error("Active staff member not found");

  const existingAbsence = await db.select({ id: therapistAbsences.id }).from(therapistAbsences).where(
    and(eq(therapistAbsences.therapistId, therapistId), gte(therapistAbsences.date, startOfDay), lte(therapistAbsences.date, endOfDay)),
  ).limit(1);
  if (existingAbsence[0]) throw new Error("This staff member is already marked absent for the selected day");

  // 2. Mark absent.
  await db.insert(therapistAbsences).values({ therapistId, date: startOfDay, reason });

  // 3. Find candidates of the same discipline
  const allCandidates = await db.select().from(therapists).where(
    and(eq(therapists.therapyType, targetTherapist.therapyType), isNull(therapists.archivedAt)),
  );
  
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
        eq(therapySessions.status, "scheduled"),
        gte(therapySessions.startTime, startOfDay),
        lte(therapySessions.startTime, endOfDay)
      )
    );

  let reAssignedCount = 0;
  let unassignedCount = 0;
  const reassignedTo: Record<number, number> = {};
  const suggestions: string[] = [];
  const undoAssignments: CallOffAssignmentChange[] = [];

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

      // Check therapist availability for candidate at session time window
      const therapistOverlap = await db
        .select()
        .from(therapySessions)
        .where(
          and(
            eq(therapySessions.therapistId, candidate.id),
            ne(therapySessions.id, session.id),
            lt(therapySessions.startTime, session.endTime),
            gt(therapySessions.endTime, session.startTime)
          )
        );

      if (therapistOverlap.length > 0) {
        continue; // candidate is busy at this time
      }

      // Success! Candidate is free. Reassign to this candidate.
      await db.update(therapySessions)
        .set({ therapistId: candidate.id })
        .where(eq(therapySessions.id, session.id));
      undoAssignments.push({
        sessionId: session.id,
        previous: { therapistId: session.therapistId, startTime: new Date(session.startTime).toISOString(), endTime: new Date(session.endTime).toISOString(), status: session.status },
        applied: { therapistId: candidate.id, startTime: new Date(session.startTime).toISOString(), endTime: new Date(session.endTime).toISOString(), status: session.status },
      });
        
      reAssignedCount++;
      reassignedTo[candidate.id] = (reassignedTo[candidate.id] || 0) + 1;
      workloads.set(candidate.id, (workloads.get(candidate.id) || 0) + session.durationMinutes);
      reAssigned = true;
      break; // Stop looking for a candidate for this session
    }

    if (!reAssigned) {
      // Unassigned gap, stays as 'scheduled' so it can still be filled
      await db.update(therapySessions)
        .set({ therapistId: null, status: "scheduled" })
        .where(eq(therapySessions.id, session.id));
      undoAssignments.push({
        sessionId: session.id,
        previous: { therapistId: session.therapistId, startTime: new Date(session.startTime).toISOString(), endTime: new Date(session.endTime).toISOString(), status: session.status },
        applied: { therapistId: null, startTime: new Date(session.startTime).toISOString(), endTime: new Date(session.endTime).toISOString(), status: "scheduled" },
      });
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

  return { success: true, reAssignedCount, unassignedCount, reassignedTo, suggestions, undoAssignments };
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

export async function recordTherapistAbsence(therapistId: number, date: Date, reason: string = "Call-Off") {
  const db = await getDb();
  if (!db) return;
  const { startOfDay, endOfDay } = dayBounds(date);
  const existing = await db
    .select()
    .from(therapistAbsences)
    .where(
      and(
        eq(therapistAbsences.therapistId, therapistId),
        gte(therapistAbsences.date, startOfDay),
        lte(therapistAbsences.date, endOfDay)
      )
    );
  if (existing.length === 0) {
    await db.insert(therapistAbsences).values({
      therapistId,
      date: startOfDay,
      reason,
    });
  }
}

export async function getTherapistStats(therapistId: number, targetDate: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database uninitialized");

  const [therapist] = await db.select().from(therapists).where(eq(therapists.id, therapistId));
  if (!therapist) throw new Error("Therapist not found");

  let teamName: string | null = null;
  if (therapist.teamId) {
    const [team] = await db.select().from(teams).where(eq(teams.id, therapist.teamId));
    if (team) teamName = team.name;
  }

  const { startOfDay, endOfDay } = dayBounds(targetDate);

  // Today's sessions & absences
  const todaySessions = await db
    .select()
    .from(therapySessions)
    .where(
      and(
        eq(therapySessions.therapistId, therapistId),
        gte(therapySessions.startTime, startOfDay),
        lte(therapySessions.startTime, endOfDay)
      )
    );

  const todayAbsences = await db
    .select()
    .from(therapistAbsences)
    .where(
      and(
        eq(therapistAbsences.therapistId, therapistId),
        gte(therapistAbsences.date, startOfDay),
        lte(therapistAbsences.date, endOfDay)
      )
    );

  const isAbsentToday = todayAbsences.length > 0;
  const todayTreatmentSessions = todaySessions.filter((s) => s.therapyType !== "Block" && !isMissedStatus(s.status) && !isCanceledStatus(s.status));
  const todayTotalMinutes = todayTreatmentSessions.reduce(
    (acc, s) => acc + (s.status === "completed" ? (s.actualDurationMinutes ?? s.durationMinutes) : s.durationMinutes),
    0,
  );
  const todayCompletedSessions = todayTreatmentSessions.filter((s) => s.status === "completed");
  const todayCompletedMinutes = todayCompletedSessions.reduce((acc, s) => acc + (s.actualDurationMinutes ?? s.durationMinutes), 0);

  // Patient names for today's sessions
  const allPatients = await getAllPatientAdmissions();
  const patientMap = new Map(allPatients.map((p) => [p.id, p]));

  const todaySessionDetails = todaySessions.map((s) => {
    const patient = patientMap.get(s.patientId);
    const sStart = new Date(s.startTime);
    const timeLabel = sStart.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return {
      id: s.id,
      patientId: s.patientId,
      patientName: patient?.name ?? `Patient ${s.patientId}`,
      roomNumber: patient?.roomNumber ?? "N/A",
      timeLabel,
      startTime: s.startTime,
      durationMinutes: s.durationMinutes,
      therapyType: s.therapyType,
      status: s.status,
    };
  });

  const uniquePatientIdsToday = new Set(todayTreatmentSessions.map((s) => s.patientId));

  // Week sessions (Sun - Sat)
  const weekStart = new Date(startOfDay);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const weekSessions = await db
    .select()
    .from(therapySessions)
    .where(
      and(
        eq(therapySessions.therapistId, therapistId),
        gte(therapySessions.startTime, weekStart),
        lte(therapySessions.startTime, weekEnd)
      )
    );

  const weekTreatmentSessions = weekSessions.filter((s) => s.therapyType !== "Block" && !isMissedStatus(s.status) && !isCanceledStatus(s.status));
  const weekTotalMinutes = weekTreatmentSessions.reduce(
    (acc, s) => acc + (s.status === "completed" ? (s.actualDurationMinutes ?? s.durationMinutes) : s.durationMinutes),
    0,
  );
  const weekCompletedSessions = weekTreatmentSessions.filter((s) => s.status === "completed");
  const weekCompletedMinutes = weekCompletedSessions.reduce((acc, s) => acc + (s.actualDurationMinutes ?? s.durationMinutes), 0);
  let weekAvailableMinutes = 0;
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + offset);
    weekAvailableMinutes += availableShiftMinutesForDay(therapist, date);
  }
  const weekTargetMinutes = Math.round(weekAvailableMinutes * 0.81);
  const productivityPct = weekTargetMinutes > 0
    ? Math.round((weekTotalMinutes / weekTargetMinutes) * 100)
    : 0;

  // Absence history
  const allAbsences = await db
    .select()
    .from(therapistAbsences)
    .where(eq(therapistAbsences.therapistId, therapistId))
    .orderBy(desc(therapistAbsences.date));

  const totalAbsencesCount = allAbsences.length;
  const recentAbsences = allAbsences.slice(0, 5).map((a) => ({
    id: a.id,
    date: new Date(a.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
    reason: a.reason,
  }));

  // Attendance is calculated over the latest 90 calendar days using only days the
  // therapist was actually scheduled, rather than an arbitrary penalty per absence.
  const attendanceWindowStart = new Date(startOfDay);
  attendanceWindowStart.setDate(attendanceWindowStart.getDate() - 89);
  let scheduledWorkDays = 0;
  for (let cursor = new Date(attendanceWindowStart); cursor <= startOfDay; cursor.setDate(cursor.getDate() + 1)) {
    if (availableShiftMinutesForDay(therapist, cursor) > 0) scheduledWorkDays++;
  }
  const absenceDatesInWindow = new Set(
    allAbsences
      .map((absence) => new Date(absence.date))
      .filter((date) => date >= attendanceWindowStart && date <= endOfDay)
      .map((date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`),
  );
  const attendanceRatePct = scheduledWorkDays > 0
    ? Math.max(0, Math.round(((scheduledWorkDays - absenceDatesInWindow.size) / scheduledWorkDays) * 100))
    : 100;

  return {
    therapist: {
      id: therapist.id,
      name: therapist.name,
      therapyType: therapist.therapyType,
      color: therapist.color,
      teamId: therapist.teamId,
      teamName,
      workDays: therapist.workDays,
      workStartTime: therapist.workStartTime,
      workEndTime: therapist.workEndTime,
      workHours: therapist.workHours,
      isPRN: therapist.isPRN,
    },
    today: {
      isAbsent: isAbsentToday,
      totalMinutes: todayTotalMinutes,
      sessionCount: todayTreatmentSessions.length,
      completedMinutes: todayCompletedMinutes,
      completedCount: todayCompletedSessions.length,
      uniquePatientsCount: uniquePatientIdsToday.size,
      sessions: todaySessionDetails,
    },
    week: {
      totalMinutes: weekTotalMinutes,
      sessionCount: weekTreatmentSessions.length,
      completedMinutes: weekCompletedMinutes,
      targetMinutes: weekTargetMinutes,
      productivityPct,
    },
    attendance: {
      absenceCount: totalAbsencesCount,
      attendanceRatePct,
      recentAbsences,
    },
  };
}

/* ========================================================================== */
/* THERAPIST PRODUCTIVITY ENGINE (81% BENCHMARK)                              */
/* ========================================================================== */

export interface TherapistProductivityItem {
  therapistId: number;
  therapistName: string;
  therapyType: string;
  teamId: number | null;
  teamName: string | null;
  color: string;
  isPRN: boolean;
  shiftHours: number;
  shiftMinutes: number;
  targetBillableMinutes: number;
  targetBillableHours: number;
  capturedBillableMinutes: number;
  capturedBillableHours: number;
  plannedBillableMinutes: number;
  projectedProductivityRate: number;
  sessionCount: number;
  completedSessionCount: number;
  productivityRate: number;
  targetAchievementPercent: number;
  billableVarianceMinutes: number;
  status: "exceeding" | "near_target" | "under_target";
  rank: number;
}

export interface ProductivitySummary {
  date: string;
  reportingState: "future" | "in_progress" | "final";
  benchmarkPercent: number;
  departmentAverageProductivityRate: number;
  departmentTargetBillableHours: number;
  departmentCapturedBillableHours: number;
  departmentPlannedBillableHours: number;
  departmentProjectedProductivityRate: number;
  departmentVarianceMinutes: number;
  totalTherapistsCount: number;
  absentTherapistsCount: number;
  exceedingCount: number;
  nearTargetCount: number;
  underTargetCount: number;
  disciplineAverages: {
    PT: { count: number; averageProductivityRate: number };
    OT: { count: number; averageProductivityRate: number };
    SLP: { count: number; averageProductivityRate: number };
  };
  leaderboard: TherapistProductivityItem[];
}

export async function getTherapistProductivityStats(targetDate: Date): Promise<ProductivitySummary> {
  const db = await getDb();
  if (!db) throw new Error("Database uninitialized");

  const allTherapists = await db.select().from(therapists).where(isNull(therapists.archivedAt));
  const allTeams = await db.select().from(teams);
  const teamMap = new Map(allTeams.map((t) => [t.id, t.name]));

  const { startOfDay, endOfDay } = dayBounds(targetDate);

  const daySessions = await db
    .select()
    .from(therapySessions)
    .where(and(gte(therapySessions.startTime, startOfDay), lte(therapySessions.startTime, endOfDay)));

  const dayAbsences = await db
    .select()
    .from(therapistAbsences)
    .where(and(gte(therapistAbsences.date, startOfDay), lte(therapistAbsences.date, endOfDay)));

  const absentTherapistIds = new Set(dayAbsences.map((a) => a.therapistId));

  const items: TherapistProductivityItem[] = [];

  for (const t of allTherapists) {
    // Skip if therapist is on call-off/absent today
    if (absentTherapistIds.has(t.id)) continue;

    // Use the therapist's actual schedule for this day. A therapist who is not
    // scheduled to work should not dilute the department's productivity rate.
    const shiftMinutes = availableShiftMinutesForDay(t, targetDate);
    if (shiftMinutes <= 0) continue;

    const shiftHours = Math.round((shiftMinutes / 60) * 10) / 10;
    const targetBillableMinutes = Math.round(shiftMinutes * 0.81);
    const targetBillableHours = Math.round((targetBillableMinutes / 60) * 100) / 100;

    const tSessions = daySessions.filter(
      (s) => s.therapistId === t.id && s.therapyType !== "Block" && !isMissedStatus(s.status) && !isCanceledStatus(s.status)
    );

    const completedSessions = tSessions.filter((s) => s.status === "completed");

    // Productivity is earned only when treatment is completed. Scheduled minutes
    // belong in projections and must not be reported as captured productivity.
    const capturedBillableMinutes = completedSessions.reduce(
      (sum, s) => sum + (s.actualDurationMinutes ?? s.durationMinutes ?? 0),
      0
    );
    const capturedBillableHours = Math.round((capturedBillableMinutes / 60) * 100) / 100;
    const plannedBillableMinutes = tSessions.reduce(
      (sum, session) => sum + (session.status === "completed" ? (session.actualDurationMinutes ?? session.durationMinutes) : session.durationMinutes),
      0,
    );

    const productivityRate = shiftMinutes > 0 ? Math.round((capturedBillableMinutes / shiftMinutes) * 1000) / 10 : 0;
    const projectedProductivityRate = shiftMinutes > 0 ? Math.round((plannedBillableMinutes / shiftMinutes) * 1000) / 10 : 0;
    const targetAchievementPercent =
      targetBillableMinutes > 0 ? Math.round((capturedBillableMinutes / targetBillableMinutes) * 1000) / 10 : 0;

    const billableVarianceMinutes = capturedBillableMinutes - targetBillableMinutes;

    let status: "exceeding" | "near_target" | "under_target" = "under_target";
    if (productivityRate >= 81.0) {
      status = "exceeding";
    } else if (productivityRate >= 75.0) {
      status = "near_target";
    }

    items.push({
      therapistId: t.id,
      therapistName: t.name,
      therapyType: t.therapyType,
      teamId: t.teamId,
      teamName: t.teamId ? teamMap.get(t.teamId) ?? null : null,
      color: t.color,
      isPRN: !!t.isPRN,
      shiftHours,
      shiftMinutes,
      targetBillableMinutes,
      targetBillableHours,
      capturedBillableMinutes,
      capturedBillableHours,
      plannedBillableMinutes,
      projectedProductivityRate,
      sessionCount: tSessions.length,
      completedSessionCount: completedSessions.length,
      productivityRate,
      targetAchievementPercent,
      billableVarianceMinutes,
      status,
      rank: 0,
    });
  }

  // Sort leaderboard by productivityRate descending
  items.sort((a, b) => b.productivityRate - a.productivityRate);
  items.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  const totalCount = items.length;
  const departmentShiftMinutes = items.reduce((acc, i) => acc + i.shiftMinutes, 0);
  const departmentTargetMinutes = items.reduce((acc, i) => acc + i.targetBillableMinutes, 0);
  const departmentCapturedMinutes = items.reduce((acc, i) => acc + i.capturedBillableMinutes, 0);
  const departmentPlannedMinutes = items.reduce((acc, i) => acc + i.plannedBillableMinutes, 0);
  // Weight the department rate by worked minutes. Averaging individual percentages
  // would make a short PRN shift count the same as a full-time shift.
  const departmentAverageProductivityRate = departmentShiftMinutes > 0
    ? Math.round((departmentCapturedMinutes / departmentShiftMinutes) * 1000) / 10
    : 0;

  const departmentTargetBillableHours = Math.round((departmentTargetMinutes / 60) * 10) / 10;
  const departmentCapturedBillableHours = Math.round((departmentCapturedMinutes / 60) * 10) / 10;
  const departmentPlannedBillableHours = Math.round((departmentPlannedMinutes / 60) * 10) / 10;
  const departmentProjectedProductivityRate = departmentShiftMinutes > 0
    ? Math.round((departmentPlannedMinutes / departmentShiftMinutes) * 1000) / 10
    : 0;
  const departmentVarianceMinutes = items.reduce((acc, i) => acc + i.billableVarianceMinutes, 0);

  const exceedingCount = items.filter((i) => i.status === "exceeding").length;
  const nearTargetCount = items.filter((i) => i.status === "near_target").length;
  const underTargetCount = items.filter((i) => i.status === "under_target").length;

  const getDisciplineAvg = (disc: string) => {
    const discItems = items.filter((i) => i.therapyType.toUpperCase() === disc.toUpperCase());
    if (discItems.length === 0) return { count: 0, averageProductivityRate: 0 };
    const shiftMinutes = discItems.reduce((sum, item) => sum + item.shiftMinutes, 0);
    const capturedMinutes = discItems.reduce((sum, item) => sum + item.capturedBillableMinutes, 0);
    const avg = shiftMinutes > 0 ? Math.round((capturedMinutes / shiftMinutes) * 1000) / 10 : 0;
    return { count: discItems.length, averageProductivityRate: avg };
  };

  return {
    date: targetDate.toISOString(),
    reportingState: startOfDay > new Date() ? "future" : endOfDay < new Date() ? "final" : "in_progress",
    benchmarkPercent: 81.0,
    departmentAverageProductivityRate,
    departmentTargetBillableHours,
    departmentCapturedBillableHours,
    departmentPlannedBillableHours,
    departmentProjectedProductivityRate,
    departmentVarianceMinutes,
    totalTherapistsCount: totalCount,
    absentTherapistsCount: dayAbsences.filter((absence) => allTherapists.some((therapist) => therapist.id === absence.therapistId)).length,
    exceedingCount,
    nearTargetCount,
    underTargetCount,
    disciplineAverages: {
      PT: getDisciplineAvg("PT"),
      OT: getDisciplineAvg("OT"),
      SLP: getDisciplineAvg("SLP"),
    },
    leaderboard: items,
  };
}

/* ---------------------------------------------------------------------------
 * Weekend staffing overrides
 * ------------------------------------------------------------------------ */

export async function getWeekendOverridesForRange(startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return [];
  const { startOfDay } = dayBounds(startDate);
  const { endOfDay } = dayBounds(endDate);
  return db
    .select()
    .from(weekendStaffingOverrides)
    .where(and(gte(weekendStaffingOverrides.date, startOfDay), lte(weekendStaffingOverrides.date, endOfDay)));
}

/** Upserts a manual working/not-working call for one therapist on one date; pass `working: null` to clear back to the computed default. */
export async function setWeekendOverride(therapistId: number, date: Date, working: boolean | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { startOfDay, endOfDay } = dayBounds(date);
  const existing = await db
    .select()
    .from(weekendStaffingOverrides)
    .where(
      and(
        eq(weekendStaffingOverrides.therapistId, therapistId),
        gte(weekendStaffingOverrides.date, startOfDay),
        lte(weekendStaffingOverrides.date, endOfDay),
      ),
    );

  if (working === null) {
    if (existing.length > 0) {
      await db.delete(weekendStaffingOverrides).where(eq(weekendStaffingOverrides.id, existing[0].id));
    }
    return { success: true };
  }

  if (existing.length > 0) {
    await db.update(weekendStaffingOverrides).set({ working }).where(eq(weekendStaffingOverrides.id, existing[0].id));
  } else {
    await db.insert(weekendStaffingOverrides).values({ therapistId, date: startOfDay, working } as InsertWeekendStaffingOverride);
  }
  return { success: true };
}

/* ---------------------------------------------------------------------------
 * Auth: invites, magic links, sessions, audit log
 * ------------------------------------------------------------------------ */

export async function getInviteByEmail(email: string): Promise<Invite | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(invites).where(eq(invites.email, email.toLowerCase())).limit(1);
  return result[0];
}

export async function listInvites(): Promise<Invite[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(invites).orderBy(desc(invites.createdAt));
}

export async function createInvite(data: InsertInvite): Promise<Invite> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(invites).values({ ...data, email: data.email.toLowerCase() });
  const id = extractInsertId(result);
  const [row] = await db.select().from(invites).where(eq(invites.id, id)).limit(1);
  return row;
}

export async function updateInviteRole(email: string, role: "admin" | "team_lead" | "staff" | "viewer"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(invites).set({ role }).where(eq(invites.email, email.toLowerCase()));
}

export async function revokePendingInvite(id: number): Promise<{ email: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(invites).where(eq(invites.id, id)).limit(1);
    if (!invite) throw new Error("Invite not found");
    if (invite.acceptedAt) throw new Error("Accepted invites cannot be revoked");

    await tx
      .delete(magicLinks)
      .where(and(eq(magicLinks.email, invite.email.toLowerCase()), isNull(magicLinks.usedAt)));
    await tx
      .delete(invites)
      .where(and(eq(invites.id, id), isNull(invites.acceptedAt)));

    return { email: invite.email };
  });
}

export async function markInviteAccepted(email: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.email, email.toLowerCase()));
}

export async function createMagicLink(data: InsertMagicLink): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(magicLinks).values(data);
}

export async function getMagicLinkByTokenHash(tokenHash: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, tokenHash)).limit(1);
  return result[0];
}

export async function markMagicLinkUsed(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(magicLinks).set({ usedAt: new Date() }).where(eq(magicLinks.id, id));
}

/** Count of unexpired, unused magic-link requests for this email/IP since `since` -- used for rate limiting. */
export async function countRecentMagicLinks(params: { email?: string; ipAddress?: string; since: Date }): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  // Upper-bounded by "now" too, not just lower-bounded by `since` -- a row with a bad/future
  // createdAt (bad data, clock skew, a bug) would otherwise look permanently "recent" and lock
  // that email out of requesting new login links forever instead of just for the rate-limit window.
  const conditions = [
    gte(magicLinks.createdAt, params.since),
    lte(magicLinks.createdAt, new Date()),
  ];
  if (params.email) conditions.push(eq(magicLinks.email, params.email.toLowerCase()));
  if (params.ipAddress) conditions.push(eq(magicLinks.ipAddress, params.ipAddress));
  const result = await db.select().from(magicLinks).where(and(...conditions));
  return result.length;
}

export async function createSession(data: InsertSession) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(sessions).values(data);
  return extractInsertId(result);
}

export async function getSessionByTokenHash(tokenHash: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  return result[0];
}

export async function touchSession(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
}

export async function revokeSession(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
}

export async function revokeAllSessionsForUser(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
}

export async function listActiveSessionsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
}

export async function listAllActiveSessions() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
      revokedAt: sessions.revokedAt,
      userName: users.name,
      userEmail: users.email,
      userRole: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(gt(sessions.expiresAt, new Date()), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.lastSeenAt));
}

export async function listUsers() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      ...getTableColumns(users),
      therapistId: therapists.id,
      staffName: therapists.name,
      teamId: therapists.teamId,
      teamName: teams.name,
    })
    .from(users)
    .leftJoin(therapists, and(eq(therapists.userId, users.id), isNull(therapists.archivedAt)))
    .leftJoin(teams, eq(therapists.teamId, teams.id))
    .orderBy(users.email);
}

export async function updateUserRole(userId: number, role: "admin" | "team_lead" | "staff" | "viewer"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function updateUserName(userId: number, name: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ name: name.trim(), updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function linkUserToTherapist(userId: number, therapistId: number | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error("User not found");
    if (user.role === "admin") throw new Error("Admin accounts do not require a staff profile");

    let target: { id: number; userId: number | null; teamId: number | null; name: string } | undefined;
    if (therapistId != null) {
      [target] = await tx.select({ id: therapists.id, userId: therapists.userId, teamId: therapists.teamId, name: therapists.name })
        .from(therapists)
        .where(and(eq(therapists.id, therapistId), isNull(therapists.archivedAt)))
        .limit(1);
      if (!target) throw new Error("Staff profile not found");
      if (target.userId != null && target.userId !== userId) throw new Error("That staff profile is linked to another account");
    }

    await tx.update(therapists).set({ userId: null, updatedAt: new Date() }).where(eq(therapists.userId, userId));
    if (target) {
      await tx.update(therapists).set({ userId, updatedAt: new Date() }).where(eq(therapists.id, target.id));
      await tx.update(users).set({ name: target.name, updatedAt: new Date() }).where(eq(users.id, userId));
    }
  });
}

export async function setUserDeactivated(userId: number, deactivated: boolean): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ deactivatedAt: deactivated ? new Date() : null, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function logAudit(entry: Omit<InsertAuditLogEntry, "id" | "createdAt">): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(auditLog).values(entry);
  return extractInsertId(result);
}

interface CallOffAuditMetadata {
  therapistId: number;
  date: string;
  undoAssignments: CallOffAssignmentChange[];
  undoneAt?: string;
  undoneByUserId?: number;
  [key: string]: unknown;
}

function isCallOffAuditMetadata(value: unknown): value is CallOffAuditMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CallOffAuditMetadata>;
  return typeof candidate.therapistId === "number"
    && typeof candidate.date === "string"
    && Array.isArray(candidate.undoAssignments);
}

function assignmentMatches(
  current: { therapistId: number | null; startTime: Date; endTime: Date; status: TherapySession["status"] },
  expected: CallOffAssignmentChange["applied"],
) {
  return current.therapistId === expected.therapistId
    && current.startTime.getTime() === new Date(expected.startTime).getTime()
    && current.endTime.getTime() === new Date(expected.endTime).getTime()
    && current.status === expected.status;
}

export async function undoCallOffChange(auditId: number, undoneByUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    const [entry] = await tx.select().from(auditLog).where(eq(auditLog.id, auditId)).limit(1);
    if (!entry || !["attendance.call_off", "attendance.call_off_coverage"].includes(entry.action)) {
      throw new Error("Call-off undo record not found");
    }
    if (!isCallOffAuditMetadata(entry.metadata)) {
      throw new Error("This call-off does not contain a restorable schedule snapshot");
    }
    if (entry.metadata.undoneAt) throw new Error("This call-off has already been undone");

    const changes = entry.metadata.undoAssignments;
    const currentSessions = new Map<number, typeof therapySessions.$inferSelect>();
    for (const change of changes) {
      const [current] = await tx.select().from(therapySessions).where(eq(therapySessions.id, change.sessionId)).limit(1);
      if (!current || !assignmentMatches(current, change.applied)) {
        throw new Error("The schedule changed after this call-off. Review the affected sessions before undoing it.");
      }
      currentSessions.set(change.sessionId, current);
    }

    for (const change of changes) {
      await tx.update(therapySessions).set({
        therapistId: change.previous.therapistId,
        startTime: new Date(change.previous.startTime),
        endTime: new Date(change.previous.endTime),
        status: change.previous.status,
        updatedAt: new Date(),
      }).where(eq(therapySessions.id, change.sessionId));
    }

    const callOffDate = new Date(entry.metadata.date);
    if (Number.isNaN(callOffDate.getTime())) throw new Error("The call-off date is invalid");
    const { startOfDay, endOfDay } = dayBounds(callOffDate);
    await tx.delete(therapistAbsences).where(and(
      eq(therapistAbsences.therapistId, entry.metadata.therapistId),
      gte(therapistAbsences.date, startOfDay),
      lte(therapistAbsences.date, endOfDay),
    ));

    await tx.update(auditLog).set({
      metadata: {
        ...entry.metadata,
        undoneAt: new Date().toISOString(),
        undoneByUserId,
      },
    }).where(eq(auditLog.id, auditId));

    return {
      success: true as const,
      restoredCount: currentSessions.size,
      therapistId: entry.metadata.therapistId,
      date: callOffDate,
    };
  });
}

export async function getCallOffAssignmentHistory(date: Date) {
  const db = await getDb();
  if (!db) return [];

  const { startOfDay, endOfDay } = dayBounds(date);
  const [entries, staff] = await Promise.all([
    db.select().from(auditLog).where(inArray(auditLog.action, [
      "attendance.call_off",
      "attendance.call_off_coverage",
      "session.reassign",
    ])).orderBy(desc(auditLog.createdAt)),
    db.select({ id: therapists.id, name: therapists.name }).from(therapists),
  ]);
  const staffNames = new Map(staff.map((member) => [member.id, member.name]));
  const seenSessionIds = new Set<number>();
  const history: Array<{
    sessionId: number;
    previousTherapistId: number | null;
    previousTherapistName: string;
    changedAt: Date;
  }> = [];

  for (const entry of entries) {
    if (entry.action === "session.reassign") {
      const metadata = entry.metadata as {
        sessionId?: unknown;
        date?: unknown;
        previousTherapistId?: unknown;
      } | null;
      if (!metadata || typeof metadata.sessionId !== "number" || typeof metadata.date !== "string") continue;
      const assignmentDate = new Date(metadata.date);
      if (assignmentDate < startOfDay || assignmentDate > endOfDay || seenSessionIds.has(metadata.sessionId)) continue;
      const previousTherapistId = typeof metadata.previousTherapistId === "number" ? metadata.previousTherapistId : null;
      seenSessionIds.add(metadata.sessionId);
      history.push({
        sessionId: metadata.sessionId,
        previousTherapistId,
        previousTherapistName: previousTherapistId == null
          ? "Unassigned"
          : staffNames.get(previousTherapistId) ?? "Former staff member",
        changedAt: entry.createdAt,
      });
      continue;
    }
    if (!isCallOffAuditMetadata(entry.metadata) || entry.metadata.undoneAt) continue;
    const callOffDate = new Date(entry.metadata.date);
    if (callOffDate < startOfDay || callOffDate > endOfDay) continue;

    for (const change of entry.metadata.undoAssignments) {
      if (seenSessionIds.has(change.sessionId)) continue;
      seenSessionIds.add(change.sessionId);
      history.push({
        sessionId: change.sessionId,
        previousTherapistId: change.previous.therapistId,
        previousTherapistName: change.previous.therapistId == null
          ? "Unassigned"
          : staffNames.get(change.previous.therapistId) ?? "Former staff member",
        changedAt: entry.createdAt,
      });
    }
  }

  return history;
}

export async function listCallOffChanges(date: Date) {
  const db = await getDb();
  if (!db) return [];

  const { startOfDay, endOfDay } = dayBounds(date);
  const [entries, staff, patientRows, sessionRows] = await Promise.all([
    db.select().from(auditLog).where(inArray(auditLog.action, [
      "attendance.call_off",
      "attendance.call_off_coverage",
    ])).orderBy(desc(auditLog.createdAt)),
    db.select({ id: therapists.id, name: therapists.name }).from(therapists),
    db.select({ id: patients.id, name: patients.name, roomNumber: patients.roomNumber }).from(patients),
    db.select().from(therapySessions),
  ]);
  const staffNames = new Map(staff.map((member) => [member.id, member.name]));
  const patientById = new Map(patientRows.map((patient) => [patient.id, patient]));
  const sessionById = new Map(sessionRows.map((session) => [session.id, session]));

  return entries.flatMap((entry) => {
    const metadata = entry.metadata as Partial<CallOffAuditMetadata> & {
      reason?: unknown;
      reassigned?: unknown;
      unassigned?: unknown;
    } | null;
    if (!metadata || typeof metadata.therapistId !== "number" || typeof metadata.date !== "string") return [];
    const callOffDate = new Date(metadata.date);
    if (callOffDate < startOfDay || callOffDate > endOfDay) return [];

    const changes = Array.isArray(metadata.undoAssignments) ? metadata.undoAssignments : [];
    const hasRestorableSnapshot = Array.isArray(metadata.undoAssignments);
    const scheduleStillMatches = hasRestorableSnapshot && changes.every((change) => {
      const current = sessionById.get(change.sessionId);
      return !!current && assignmentMatches(current, change.applied);
    });
    const undone = typeof metadata.undoneAt === "string";
    const changeDetails = changes.map((change) => {
      const session = sessionById.get(change.sessionId);
      const patient = session ? patientById.get(session.patientId) : undefined;
      return {
        sessionId: change.sessionId,
        patientName: patient?.name ?? `Session ${change.sessionId}`,
        roomNumber: patient?.roomNumber ?? null,
        previousTherapistName: change.previous.therapistId == null
          ? "Unassigned"
          : staffNames.get(change.previous.therapistId) ?? "Former staff member",
        assignedTherapistName: change.applied.therapistId == null
          ? "Unassigned"
          : staffNames.get(change.applied.therapistId) ?? "Former staff member",
        previousStartTime: new Date(change.previous.startTime),
        assignedStartTime: new Date(change.applied.startTime),
      };
    });

    return [{
      auditId: entry.id,
      therapistId: metadata.therapistId,
      therapistName: staffNames.get(metadata.therapistId) ?? "Former staff member",
      reason: typeof metadata.reason === "string" ? metadata.reason : "Call-off",
      actorEmail: entry.actorEmail,
      createdAt: entry.createdAt,
      reassignedCount: typeof metadata.reassigned === "number" ? metadata.reassigned : changeDetails.filter((change) => change.assignedTherapistName !== "Unassigned").length,
      unassignedCount: typeof metadata.unassigned === "number" ? metadata.unassigned : changeDetails.filter((change) => change.assignedTherapistName === "Unassigned").length,
      changes: changeDetails,
      undone,
      undoneAt: undone ? new Date(metadata.undoneAt!) : null,
      canUndo: !undone && scheduleStillMatches,
      undoUnavailableReason: undone
        ? "Already undone"
        : !hasRestorableSnapshot
          ? "This older call-off was recorded before detailed assignment history was available."
          : !scheduleStillMatches
            ? "One or more sessions changed after this call-off. Review them manually before reversing coverage."
            : null,
    }];
  });
}

export async function listAuditLog(limit: number = 200) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}

/* ---------------------------------------------------------------------------
 * Staff message board
 * ------------------------------------------------------------------------ */

type StoredBoardMessage = Pick<
  typeof staffMessages.$inferSelect,
  "authorUserId" | "title" | "body"
>;
type StoredDirectMessage = Pick<
  typeof staffDirectMessages.$inferSelect,
  "senderUserId" | "recipientUserId" | "body"
>;

function readBoardMessageContent(message: StoredBoardMessage) {
  return {
    title: readMessage(
      message.title,
      boardMessageContext(message.authorUserId, "title")
    ),
    body: readMessage(
      message.body,
      boardMessageContext(message.authorUserId, "body")
    ),
  };
}

function readDirectMessageBody(message: StoredDirectMessage) {
  return readMessage(
    message.body,
    directMessageContext(message.senderUserId, message.recipientUserId)
  );
}

export async function listStaffMessages(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      ...getTableColumns(staffMessages),
      authorName: users.name,
      authorRole: users.role,
    })
    .from(staffMessages)
    .leftJoin(users, eq(staffMessages.authorUserId, users.id))
    .where(isNull(staffMessages.archivedAt))
    .orderBy(desc(staffMessages.pinned), desc(staffMessages.createdAt));

  if (rows.length === 0) return [];
  const acknowledgements = await db
    .select()
    .from(staffMessageAcknowledgements)
    .where(
      inArray(
        staffMessageAcknowledgements.messageId,
        rows.map(row => row.id)
      )
    );
  const acknowledgementCount = new Map<number, number>();
  const mine = new Set<number>();
  for (const acknowledgement of acknowledgements) {
    acknowledgementCount.set(
      acknowledgement.messageId,
      (acknowledgementCount.get(acknowledgement.messageId) ?? 0) + 1
    );
    if (acknowledgement.userId === userId) mine.add(acknowledgement.messageId);
  }
  return rows.map(row => ({
    ...row,
    ...readBoardMessageContent(row),
    acknowledgementCount: acknowledgementCount.get(row.id) ?? 0,
    acknowledgedByMe: mine.has(row.id),
  }));
}

export async function getStaffMessage(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(staffMessages)
    .where(eq(staffMessages.id, id))
    .limit(1);
  return row ? { ...row, ...readBoardMessageContent(row) } : undefined;
}

export async function createStaffMessage(
  data: Omit<
    InsertStaffMessage,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "archivedAt"
    | "resolvedAt"
    | "resolvedByUserId"
    | "pinned"
  >
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(staffMessages).values({
    ...data,
    title: storeMessage(
      data.title,
      boardMessageContext(data.authorUserId, "title")
    ),
    body: storeMessage(
      data.body,
      boardMessageContext(data.authorUserId, "body")
    ),
  });
  const id = extractInsertId(result);
  return getStaffMessage(id);
}

export async function acknowledgeStaffMessage(
  messageId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db
    .select({ id: staffMessageAcknowledgements.id })
    .from(staffMessageAcknowledgements)
    .where(
      and(
        eq(staffMessageAcknowledgements.messageId, messageId),
        eq(staffMessageAcknowledgements.userId, userId)
      )
    )
    .limit(1);
  if (!existing)
    await db.insert(staffMessageAcknowledgements).values({ messageId, userId });
}

export async function resolveStaffMessage(
  id: number,
  userId: number,
  resolved: boolean
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(staffMessages)
    .set({
      resolvedAt: resolved ? new Date() : null,
      resolvedByUserId: resolved ? userId : null,
      updatedAt: new Date(),
    })
    .where(eq(staffMessages.id, id));
}

export async function archiveStaffMessage(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(staffMessages)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(staffMessages.id, id));
}

export async function pinStaffMessage(id: number, pinned: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(staffMessages)
    .set({ pinned, updatedAt: new Date() })
    .where(eq(staffMessages.id, id));
}

export async function listDirectMessageDirectory(currentUserId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(ne(users.id, currentUserId), isNull(users.deactivatedAt)))
    .orderBy(users.name, users.id);
}

export async function listDirectMessageThreads(currentUserId: number) {
  const db = await getDb();
  if (!db) return [];
  const [messages, directory] = await Promise.all([
    db
      .select()
      .from(staffDirectMessages)
      .where(
        or(
          eq(staffDirectMessages.senderUserId, currentUserId),
          eq(staffDirectMessages.recipientUserId, currentUserId)
        )
      )
      .orderBy(
        desc(staffDirectMessages.createdAt),
        desc(staffDirectMessages.id)
      )
      .limit(500),
    db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(isNull(users.deactivatedAt)),
  ]);
  const people = new Map(directory.map(person => [person.id, person]));
  const threads = new Map<
    number,
    {
      peerUserId: number;
      peerName: string | null;
      peerRole: typeof users.$inferSelect.role;
      lastMessage: string;
      lastMessageAt: Date;
      sentByMe: boolean;
      unreadCount: number;
    }
  >();
  for (const message of messages) {
    const peerUserId =
      message.senderUserId === currentUserId
        ? message.recipientUserId
        : message.senderUserId;
    const person = people.get(peerUserId);
    if (!person) continue;
    const existing = threads.get(peerUserId);
    const unread =
      message.recipientUserId === currentUserId && !message.readAt ? 1 : 0;
    if (!existing) {
      threads.set(peerUserId, {
        peerUserId,
        peerName: person.name,
        peerRole: person.role,
        lastMessage: readDirectMessageBody(message),
        lastMessageAt: message.createdAt,
        sentByMe: message.senderUserId === currentUserId,
        unreadCount: unread,
      });
    } else {
      existing.unreadCount += unread;
    }
  }
  return Array.from(threads.values());
}

export async function listDirectConversation(
  currentUserId: number,
  peerUserId: number
) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(staffDirectMessages)
    .where(
      or(
        and(
          eq(staffDirectMessages.senderUserId, currentUserId),
          eq(staffDirectMessages.recipientUserId, peerUserId)
        ),
        and(
          eq(staffDirectMessages.senderUserId, peerUserId),
          eq(staffDirectMessages.recipientUserId, currentUserId)
        )
      )
    )
    .orderBy(asc(staffDirectMessages.createdAt), asc(staffDirectMessages.id))
    .limit(200);
  return rows.map(row => ({ ...row, body: readDirectMessageBody(row) }));
}

export async function createDirectMessage(data: InsertStaffDirectMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [recipient] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, data.recipientUserId), isNull(users.deactivatedAt)))
    .limit(1);
  if (!recipient) throw new Error("Recipient account is unavailable");
  const result = await db.insert(staffDirectMessages).values({
    ...data,
    body: storeMessage(
      data.body,
      directMessageContext(data.senderUserId, data.recipientUserId)
    ),
  });
  return { id: extractInsertId(result) };
}

export async function markDirectConversationRead(
  currentUserId: number,
  peerUserId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(staffDirectMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(staffDirectMessages.senderUserId, peerUserId),
        eq(staffDirectMessages.recipientUserId, currentUserId),
        isNull(staffDirectMessages.readAt)
      )
    );
}

/* ---------------------------------------------------------------------------
 * Patient chart access log (HIPAA-style "who viewed this" trail)
 * ------------------------------------------------------------------------ */

export async function logPatientChartAccess(patientId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.insert(patientAccessLog).values({ patientId, userId });
}

export async function getPatientChartAccessLog(patientId: number, limit: number = 20) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: patientAccessLog.id,
      accessedAt: patientAccessLog.accessedAt,
      userId: patientAccessLog.userId,
      userName: users.name,
      userRole: users.role,
    })
    .from(patientAccessLog)
    .innerJoin(users, eq(patientAccessLog.userId, users.id))
    .where(eq(patientAccessLog.patientId, patientId))
    .orderBy(desc(patientAccessLog.accessedAt))
    .limit(limit);
}

/* ---------------------------------------------------------------------------
 * Clinical documentation -- treatment notes, goals, functional (Section GG) assessments
 * ------------------------------------------------------------------------ */

export async function getTreatmentNotesForPatient(patientId: number, limit: number = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      ...getTableColumns(treatmentNotes),
      therapistName: therapists.name,
      therapyType: therapists.therapyType,
      signedByName: users.name,
    })
    .from(treatmentNotes)
    .leftJoin(therapists, eq(treatmentNotes.therapistId, therapists.id))
    .leftJoin(users, eq(treatmentNotes.signedByUserId, users.id))
    .where(eq(treatmentNotes.patientId, patientId))
    .orderBy(desc(treatmentNotes.createdAt))
    .limit(limit);
}

export async function getTreatmentNoteById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(treatmentNotes).where(eq(treatmentNotes.id, id)).limit(1);
  return row;
}

export async function createTreatmentNote(data: InsertTreatmentNote) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(treatmentNotes).values(data);
  return { id: extractInsertId(result) };
}

/** Unsigned notes only -- a signed note is locked; corrections go through createTreatmentNote
 *  with isAddendum: true instead of editing history. */
export async function updateTreatmentNote(id: number, data: Partial<InsertTreatmentNote>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(treatmentNotes).set({ ...data, updatedAt: new Date() })
    .where(and(eq(treatmentNotes.id, id), isNull(treatmentNotes.signedAt)));
}

export async function signTreatmentNote(id: number, signedByUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(treatmentNotes).set({ signedAt: new Date(), signedByUserId, updatedAt: new Date() })
    .where(and(eq(treatmentNotes.id, id), isNull(treatmentNotes.signedAt)));
}

export async function getPatientGoals(patientId: number, includeArchived: boolean = false) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(patientGoals.patientId, patientId)];
  if (!includeArchived) conditions.push(isNull(patientGoals.archivedAt));
  return db.select().from(patientGoals).where(and(...conditions)).orderBy(desc(patientGoals.createdAt));
}

export async function createPatientGoal(data: InsertPatientGoal) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(patientGoals).values(data);
  return { id: extractInsertId(result) };
}

export async function updatePatientGoal(id: number, data: Partial<InsertPatientGoal>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(patientGoals).set({ ...data, updatedAt: new Date() }).where(eq(patientGoals.id, id));
}

export async function archivePatientGoal(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(patientGoals).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(patientGoals.id, id));
}

export async function getFunctionalAssessmentsForPatient(patientId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      ...getTableColumns(functionalAssessments),
      therapistName: therapists.name,
      signedByName: users.name,
    })
    .from(functionalAssessments)
    .leftJoin(therapists, eq(functionalAssessments.completedByTherapistId, therapists.id))
    .leftJoin(users, eq(functionalAssessments.signedByUserId, users.id))
    .where(eq(functionalAssessments.patientId, patientId))
    .orderBy(desc(functionalAssessments.assessmentDate));
}

/** Facility-wide, not patient-scoped -- feeds the GG completeness/trend/consistency reports.
 *  Admin-only call site; not redacted per-patient since it's an aggregate operational view. */
export async function getAllFunctionalAssessments() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      ...getTableColumns(functionalAssessments),
      patientName: patients.name,
      roomNumber: patients.roomNumber,
      therapistName: therapists.name,
      therapyType: therapists.therapyType,
    })
    .from(functionalAssessments)
    .innerJoin(patients, eq(functionalAssessments.patientId, patients.id))
    .leftJoin(therapists, eq(functionalAssessments.completedByTherapistId, therapists.id))
    .orderBy(desc(functionalAssessments.assessmentDate));
}

export async function createFunctionalAssessment(data: InsertFunctionalAssessment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(functionalAssessments).values(data);
  return { id: extractInsertId(result) };
}

export async function updateFunctionalAssessment(id: number, data: Partial<InsertFunctionalAssessment>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(functionalAssessments).set({ ...data, updatedAt: new Date() })
    .where(and(eq(functionalAssessments.id, id), isNull(functionalAssessments.signedAt)));
}

export async function signFunctionalAssessment(id: number, signedByUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(functionalAssessments).set({ signedAt: new Date(), signedByUserId, updatedAt: new Date() })
    .where(and(eq(functionalAssessments.id, id), isNull(functionalAssessments.signedAt)));
}

/* ---------------------------------------------------------------------------
 * Therapist self-scheduling requests (PTO / shift swap)
 * ------------------------------------------------------------------------ */

export async function listScheduleChangeRequests(filter: { therapistId?: number; teamIds?: number[]; status?: "pending" | "approved" | "denied" | "canceled" } = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filter.therapistId != null) conditions.push(eq(scheduleChangeRequests.therapistId, filter.therapistId));
  if (filter.status) conditions.push(eq(scheduleChangeRequests.status, filter.status));
  const rows = await db
    .select({
      ...getTableColumns(scheduleChangeRequests),
      therapistName: therapists.name,
      therapistTeamId: therapists.teamId,
    })
    .from(scheduleChangeRequests)
    .innerJoin(therapists, eq(scheduleChangeRequests.therapistId, therapists.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(scheduleChangeRequests.createdAt));
  if (!filter.teamIds) return rows;
  const teamSet = new Set(filter.teamIds);
  return rows.filter((row) => row.therapistTeamId != null && teamSet.has(row.therapistTeamId));
}

export async function getScheduleChangeRequestById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(scheduleChangeRequests).where(eq(scheduleChangeRequests.id, id)).limit(1);
  return row;
}

export async function createScheduleChangeRequest(data: InsertScheduleChangeRequest) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(scheduleChangeRequests).values(data);
  return { id: extractInsertId(result) };
}

export async function cancelScheduleChangeRequest(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(scheduleChangeRequests).set({ status: "canceled", updatedAt: new Date() })
    .where(and(eq(scheduleChangeRequests.id, id), eq(scheduleChangeRequests.status, "pending")));
}

export async function reviewScheduleChangeRequest(
  id: number,
  status: "approved" | "denied",
  reviewedByUserId: number,
  reviewNote?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(scheduleChangeRequests).set({
    status, reviewedByUserId, reviewedAt: new Date(), reviewNote: reviewNote ?? null, updatedAt: new Date(),
  }).where(and(eq(scheduleChangeRequests.id, id), eq(scheduleChangeRequests.status, "pending")));
}
