import { and, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Patient, TherapySession, User } from "../drizzle/schema";
import { therapists } from "../drizzle/schema";
import {
  getDb,
  getPatients,
  getStatusFlagsForDate,
  getTeams,
  getTherapistAbsences,
  getTherapists,
  getTherapySessions,
  getTherapySessionsForDateRange,
  getTherapySessionsForWeek,
} from "./db";

export type AccessScope = {
  role: User["role"];
  therapistId: number | null;
  teamId: number | null;
  linked: boolean;
};

function hasFullScheduleAccess(scope: AccessScope): boolean {
  return scope.role === "admin" || scope.role === "team_lead";
}

/** Resolve a login to its staff profile. Exact email matching is used only to claim an
 * unlinked profile; an account can never take over a profile already linked to someone else. */
export async function resolveAccessScope(user: User): Promise<AccessScope> {
  if (user.role === "admin") {
    return { role: user.role, therapistId: null, teamId: null, linked: true };
  }

  const unlinkedScope: AccessScope = {
    role: user.role,
    therapistId: null,
    teamId: null,
    linked: false,
  };
  const db = await getDb();
  if (!db) return unlinkedScope;

  const [linked] = await db
    .select()
    .from(therapists)
    .where(and(eq(therapists.userId, user.id), isNull(therapists.archivedAt)))
    .limit(1);
  let profile = linked;

  if (!profile) {
    const normalizedEmail = user.email?.trim().toLowerCase();
    if (!normalizedEmail) return unlinkedScope;

    const matches = await db
      .select()
      .from(therapists)
      .where(
        and(
          sql`lower(trim(${therapists.email})) = ${normalizedEmail}`,
          isNull(therapists.userId),
          isNull(therapists.archivedAt)
        )
      );
    if (matches.length !== 1) return unlinkedScope;

    profile = matches[0];
    await db
      .update(therapists)
      .set({ userId: user.id, updatedAt: new Date() })
      .where(and(eq(therapists.id, profile.id), isNull(therapists.userId)));
  }

  return {
    role: user.role,
    therapistId: profile.id,
    teamId: profile.teamId,
    linked: true,
  };
}

export function requireLinkedScope(scope: AccessScope): asserts scope is AccessScope & { therapistId: number } {
  if (scope.role === "admin") return;
  if (!scope.linked || scope.therapistId == null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your account must be linked to a staff profile by an administrator.",
    });
  }
}

export function assertOwnTherapist(scope: AccessScope, therapistId: number | null | undefined) {
  if (scope.role === "admin") return;
  requireLinkedScope(scope);
  if (therapistId !== scope.therapistId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can only access your own staff information." });
  }
}

export async function assertPatientInScope(scope: AccessScope, patientId: number) {
  if (hasFullScheduleAccess(scope)) return;
  requireLinkedScope(scope);
  const assignedPatientIds = await getDetailPatientIds(scope);
  if (!assignedPatientIds.has(patientId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can only change patients assigned to you." });
  }
}

export async function assertSessionWriteAccess(scope: AccessScope, session: TherapySession | undefined, chartOnly = false) {
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
  if (hasFullScheduleAccess(scope)) return;
  requireLinkedScope(scope);
  if (scope.role === "viewer" || session.therapistId !== scope.therapistId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can only change sessions assigned to you." });
  }
  if (!chartOnly && scope.role !== "team_lead") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Staff can chart their sessions but cannot change the schedule." });
  }
}

export type ScopedPatient = Patient & { accessLevel: "full" | "schedule" };

function withFullPatientAccess(patient: Patient): ScopedPatient {
  return { ...patient, accessLevel: "full" };
}

function redactPatient(patient: Patient): ScopedPatient {
  return {
    ...patient,
    accessLevel: "schedule",
    mrn: null,
    previousAdmissionId: null,
    notes: null,
    archivedAt: null,
    archivedByUserId: null,
    archiveReason: null,
    estimatedDischargeDate: null,
    ptTarget: null,
    otTarget: null,
    slpTarget: null,
    assessmentPeriodStart: null,
    assessmentPeriodEnd: null,
  };
}

export async function getDetailPatientIds(scope: AccessScope): Promise<Set<number>> {
  if (hasFullScheduleAccess(scope)) return new Set((await getPatients()).map((patient) => patient.id));
  requireLinkedScope(scope);
  return new Set(
    (await getTherapySessions())
      .filter((session) => session.therapistId === scope.therapistId)
      .map((session) => session.patientId),
  );
}

export async function getScopedPatients(user: User, _date?: Date): Promise<ScopedPatient[]> {
  const scope = await resolveAccessScope(user);
  const rows = await getPatients();
  if (hasFullScheduleAccess(scope)) return rows.map(withFullPatientAccess);
  requireLinkedScope(scope);
  const ownPatientIds = await getDetailPatientIds(scope);
  return rows.map((patient) => ownPatientIds.has(patient.id) ? withFullPatientAccess(patient) : redactPatient(patient));
}

function redactTeamSession(session: TherapySession, ownTherapistId: number): TherapySession {
  if (session.therapistId === ownTherapistId) return session;
  return { ...session, notes: null, missedReason: null, actualDurationMinutes: null };
}

async function scopeSessions(user: User, rows: TherapySession[]): Promise<TherapySession[]> {
  const scope = await resolveAccessScope(user);
  if (hasFullScheduleAccess(scope)) return rows;
  requireLinkedScope(scope);
  return rows.map((session) => redactTeamSession(session, scope.therapistId));
}

export async function getScopedSessions(user: User, date?: Date) {
  return scopeSessions(user, await getTherapySessions(date));
}

export async function getScopedSessionsForWeek(user: User, weekStart: Date) {
  return scopeSessions(user, await getTherapySessionsForWeek(weekStart));
}

export async function getScopedSessionsForDateRange(user: User, startDate: Date, endDate: Date) {
  return scopeSessions(user, await getTherapySessionsForDateRange(startDate, endDate));
}

export async function getScopedTherapists(user: User) {
  const scope = await resolveAccessScope(user);
  const rows = await getTherapists();
  if (scope.role === "admin") return rows;
  if (scope.role === "team_lead") {
    // Mirrors their write scope: full contact info for their own team (so they can actually see
    // what they're editing), redacted for everyone else.
    return rows.map((therapist) => therapist.teamId === scope.teamId
      ? { ...therapist, linkedUserEmail: null, linkedUserRole: null }
      : { ...therapist, email: null, phone: null, linkedUserEmail: null, linkedUserRole: null });
  }
  requireLinkedScope(scope);
  return rows
    .map((therapist) => therapist.id === scope.therapistId
      ? therapist
      : { ...therapist, email: null, phone: null, linkedUserEmail: null, linkedUserRole: null });
}

export async function getScopedTeams(user: User) {
  const scope = await resolveAccessScope(user);
  const rows = await getTeams();
  if (hasFullScheduleAccess(scope)) return rows;
  requireLinkedScope(scope);
  return rows;
}

export async function getScopedStatusFlags(user: User, date: Date) {
  const scope = await resolveAccessScope(user);
  const rows = await getStatusFlagsForDate(date);
  if (hasFullScheduleAccess(scope)) return rows;
  requireLinkedScope(scope);
  return rows;
}

export async function getScopedAbsences(user: User, date: Date) {
  const scope = await resolveAccessScope(user);
  const rows = await getTherapistAbsences(date);
  if (hasFullScheduleAccess(scope)) return rows;
  requireLinkedScope(scope);
  return rows
    .map((absence) => absence.therapistId === scope.therapistId
      ? absence
      : { ...absence, reason: null });
}

export async function assertTherapistWriteAccess(scope: AccessScope, therapistId: number) {
  if (hasFullScheduleAccess(scope)) return;
  requireLinkedScope(scope);
  if (therapistId !== scope.therapistId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can only change your own staff information." });
  }
}
