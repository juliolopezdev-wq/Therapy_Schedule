import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, or, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  aiChangeProposals,
  auditLog,
  patients,
  therapists,
  therapySessions,
  statusFlags,
  therapistAbsences,
  scheduleOverrides,
  treatmentNotes,
  functionalAssessments,
  patientGoals,
  weekendStaffingOverrides,
} from "../drizzle/schema";
import type { User } from "../drizzle/schema";
import { getDb, logAudit } from "./db";

const time = z.string().datetime({ offset: true });
const id = z.number().int().positive();
const schemas = {
  create_session: z.object({
    patientId: id,
    therapistId: id,
    therapyType: z.enum(["PT", "OT", "SLP"]),
    startTime: time,
    durationMinutes: z.number().int().min(1).max(720),
    deliveryMode: z.enum(["individual", "concurrent", "group"]).optional(),
  }),
  move_session: z.object({
    sessionId: id,
    newStartTime: time,
    newTherapistId: id.optional(),
  }),
  copy_session: z.object({
    sessionId: id,
    newStartTime: time,
    newTherapistId: id.optional(),
  }),
  cancel_session: z.object({ sessionId: id }),
};
export type ReviewedToolCall = {
  function: { name: string; arguments: Record<string, unknown> };
};
type Payload = {
  commands: ReviewedToolCall[];
  changes: { title: string; detail: string }[];
  fingerprint: string;
  referenceDate: string;
};
type SessionRow = typeof therapySessions.$inferSelect;
type Result = {
  actions: string[];
  errors: string[];
  before: SessionRow[];
  after: SessionRow[];
  fingerprint: string;
  affectedIds: number[];
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function database() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}
async function snapshot() {
  const db = await database();
  const [
    sessions,
    patientRows,
    staff,
    flags,
    absences,
    overrides,
    notes,
    assessments,
    goals,
    staffing,
  ] = await Promise.all([
    db.select().from(therapySessions).orderBy(therapySessions.id),
    db.select().from(patients).orderBy(patients.id),
    db.select().from(therapists).orderBy(therapists.id),
    db.select().from(statusFlags).orderBy(statusFlags.id),
    db.select().from(therapistAbsences).orderBy(therapistAbsences.id),
    db.select().from(scheduleOverrides).orderBy(scheduleOverrides.id),
    db.select().from(treatmentNotes).orderBy(treatmentNotes.id),
    db.select().from(functionalAssessments).orderBy(functionalAssessments.id),
    db.select().from(patientGoals).orderBy(patientGoals.id),
    db
      .select()
      .from(weekendStaffingOverrides)
      .orderBy(weekendStaffingOverrides.id),
  ]);
  return {
    sessions,
    patientRows,
    staff,
    signedSessionIds: new Set(
      notes.filter(note => note.signedAt).map(note => note.sessionId)
    ),
    fingerprint: digest([
      sessions,
      patientRows,
      staff,
      flags,
      absences,
      overrides,
      notes,
      assessments,
      goals,
      staffing,
    ]),
  };
}

export async function createAiProposal(
  calls: ReviewedToolCall[],
  actor: Pick<User, "id" | "email">,
  referenceDate: Date
) {
  if (!calls.length || calls.length > 100)
    throw new Error("Propose between 1 and 100 concrete changes at a time.");
  const current = await snapshot();
  const commands = calls.map(call => {
    const schema = schemas[call.function.name as keyof typeof schemas];
    if (!schema)
      throw new Error(
        "That operation needs concrete session changes before it can be reviewed."
      );
    return {
      function: {
        name: call.function.name,
        arguments: schema.parse(call.function.arguments) as Record<
          string,
          unknown
        >,
      },
    };
  });
  const changes = commands.map(call => {
    const args = call.function.arguments;
    const session = args.sessionId
      ? current.sessions.find(s => s.id === args.sessionId)
      : undefined;
    if (args.sessionId && !session)
      throw new Error(
        "A proposed session no longer exists. Ask PAMi for a fresh plan."
      );
    if (
      session &&
      current.signedSessionIds.has(session.id) &&
      call.function.name !== "copy_session"
    )
      throw new Error(
        "A session with signed clinical documentation cannot be moved or deleted by PAMi."
      );
    if (
      session &&
      session.status !== "scheduled" &&
      call.function.name !== "copy_session"
    )
      throw new Error(
        "PAMi cannot move or delete delivered/missed care. Use the clinical chart to correct that record."
      );
    const patient = current.patientRows.find(
      p => p.id === (args.patientId ?? session?.patientId)
    );
    const therapist = current.staff.find(
      t =>
        t.id ===
        (args.newTherapistId ?? args.therapistId ?? session?.therapistId)
    );
    if (!therapist && call.function.name !== "cancel_session")
      throw new Error("A proposed therapist no longer exists.");
    if (!patient) throw new Error("A proposed patient no longer exists.");
    const start = String(
      args.newStartTime ?? args.startTime ?? session?.startTime.toISOString()
    );
    const displayTime = new Date(start).toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
    const duration = Number(args.durationMinutes ?? session?.durationMinutes);
    return {
      title: `${call.function.name.replace("_session", "").replace(/^./, c => c.toUpperCase())}: ${patient.name} · Room ${patient.roomNumber}`,
      detail: `${therapist?.name ?? "Unassigned"} · ${args.therapyType ?? session?.therapyType} · ${displayTime} · ${duration} minutes${session && call.function.name === "move_session" ? ` (was ${session.startTime.toISOString()})` : ""}${args.deliveryMode ? ` · ${args.deliveryMode}` : ""}`,
    };
  });
  const proposalId = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const payload: Payload = {
    commands,
    changes,
    fingerprint: current.fingerprint,
    referenceDate: referenceDate.toISOString(),
  };
  const db = await database();
  await db
    .insert(aiChangeProposals)
    .values({ id: proposalId, actorUserId: actor.id, payload, expiresAt });
  await logAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: "ai.propose",
    targetType: "proposal",
    targetId: proposalId,
    metadata: { count: changes.length },
  });
  return { id: proposalId, changes, expiresAt };
}

export async function listAiProposals(actorId: number) {
  const db = await database();
  const rows = await db
    .select()
    .from(aiChangeProposals)
    .where(
      and(
        eq(aiChangeProposals.actorUserId, actorId),
        or(
          ne(aiChangeProposals.state, "pending"),
          gt(aiChangeProposals.expiresAt, new Date())
        )
      )
    )
    .orderBy(desc(aiChangeProposals.createdAt))
    .limit(10);
  return rows.map(row => ({
    id: row.id,
    state: row.state,
    changes: (row.payload as Payload).changes,
    expiresAt: row.expiresAt,
    actions: (row.result as Result | null)?.actions ?? [],
    errors: (row.result as Result | null)?.errors ?? [],
  }));
}

export async function dismissAiProposal(proposalId: string, actorId: number) {
  const db = await database();
  await db
    .update(aiChangeProposals)
    .set({ state: "dismissed" })
    .where(
      and(
        eq(aiChangeProposals.id, proposalId),
        eq(aiChangeProposals.actorUserId, actorId),
        eq(aiChangeProposals.state, "pending")
      )
    );
  return { success: true };
}

/** Claim before executing: retries cannot repeat a batch, even after a dropped connection. */
export async function approveAiProposal(
  proposalId: string,
  actor: Pick<User, "id" | "email">,
  execute: (call: ReviewedToolCall, date: Date) => Promise<string>
) {
  const db = await database();
  const [row] = await db
    .select()
    .from(aiChangeProposals)
    .where(
      and(
        eq(aiChangeProposals.id, proposalId),
        eq(aiChangeProposals.actorUserId, actor.id)
      )
    )
    .limit(1);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });
  if (row.state === "completed" || row.state === "partial")
    return {
      actions: (row.result as Result).actions,
      errors: (row.result as Result).errors,
    };
  if (row.state !== "pending" || row.expiresAt.getTime() <= Date.now())
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This proposal expired or is already being processed. Refresh to review its status.",
    });
  const payload = row.payload as Payload;
  const before = await snapshot();
  if (before.fingerprint !== payload.fingerprint)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The board changed since this proposal. Ask PAMi for a fresh plan before approving.",
    });
  const claimed = await db
    .update(aiChangeProposals)
    .set({ state: "running" })
    .where(
      and(
        eq(aiChangeProposals.id, proposalId),
        eq(aiChangeProposals.state, "pending"),
        eq(aiChangeProposals.actorUserId, actor.id),
        gt(aiChangeProposals.expiresAt, new Date())
      )
    )
    .returning({ id: aiChangeProposals.id });
  if (!claimed.length)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This proposal is already being processed.",
    });
  const result: Result = {
    actions: [],
    errors: [],
    before: before.sessions,
    after: before.sessions,
    fingerprint: before.fingerprint,
    affectedIds: [],
  };
  try {
    for (let index = 0; index < payload.commands.length; index++) {
      const command = payload.commands[index];
      const response = JSON.parse(
        await execute(
          {
            function: {
              ...command.function,
              arguments: { ...command.function.arguments, confirmed: true },
            },
          },
          new Date(payload.referenceDate)
        )
      );
      if (response.ok !== true) {
        result.errors.push(
          `${response.error ?? "A change could not be applied."} Remaining changes were stopped. Check the board before retrying; a write may have completed before the error.`
        );
        break;
      }
      const changedId = Number(
        response.session?.id ?? command.function.arguments.sessionId
      );
      if (Number.isInteger(changedId)) result.affectedIds.push(changedId);
      result.actions.push(payload.changes[index].title);
      await db
        .update(aiChangeProposals)
        .set({ result })
        .where(eq(aiChangeProposals.id, proposalId));
    }
  } catch (error) {
    result.errors.push(
      `${error instanceof Error ? error.message : "Interrupted while applying changes"}. Review the board for partially applied changes before retrying.`
    );
  }
  const after = await snapshot();
  result.after = after.sessions;
  result.fingerprint = after.fingerprint;
  await db
    .update(aiChangeProposals)
    .set({ state: result.errors.length ? "partial" : "completed", result })
    .where(eq(aiChangeProposals.id, proposalId));
  const minimal = (rows: SessionRow[]) => rows.map(({ notes, ...row }) => row);
  const changedIds = new Set(result.affectedIds);
  await logAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: "ai.apply",
    targetType: "proposal",
    targetId: proposalId,
    metadata: {
      actions: result.actions,
      errors: result.errors,
      before: minimal(before.sessions.filter(s => changedIds.has(s.id))),
      after: minimal(after.sessions.filter(s => changedIds.has(s.id))),
    },
  });
  return { actions: result.actions, errors: result.errors };
}

export async function undoAiProposal(
  proposalId: string,
  actor: Pick<User, "id" | "email">
) {
  const db = await database();
  const [row] = await db
    .select()
    .from(aiChangeProposals)
    .where(
      and(
        eq(aiChangeProposals.id, proposalId),
        eq(aiChangeProposals.actorUserId, actor.id)
      )
    )
    .limit(1);
  if (!row || !["completed", "partial"].includes(row.state) || !row.result)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This proposal cannot be undone.",
    });
  const result = row.result as Result;
  if ((await snapshot()).fingerprint !== result.fingerprint)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The board changed after this action. Review and correct it manually to preserve later work.",
    });
  const revive = (session: SessionRow): SessionRow => ({
    ...session,
    startTime: new Date(session.startTime),
    endTime: new Date(session.endTime),
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
  });
  await db.transaction(async tx => {
    const live = await tx
      .select()
      .from(therapySessions)
      .orderBy(therapySessions.id);
    if (digest(live) !== digest(result.after))
      throw new Error("Sessions changed. Undo was canceled.");
    const claimed = await tx
      .update(aiChangeProposals)
      .set({ state: "undone" })
      .where(
        and(
          eq(aiChangeProposals.id, proposalId),
          eq(aiChangeProposals.state, row.state)
        )
      )
      .returning({ id: aiChangeProposals.id });
    if (!claimed.length) throw new Error("This action was already undone.");
    for (const session of result.after.filter(s =>
      result.affectedIds.includes(s.id)
    ))
      if (!result.before.some(s => s.id === session.id))
        await tx
          .delete(therapySessions)
          .where(eq(therapySessions.id, session.id));
    for (const session of result.before.filter(s =>
      result.affectedIds.includes(s.id)
    )) {
      const later = result.after.find(s => s.id === session.id);
      if (digest(session) === digest(later)) continue;
      if (!later) await tx.insert(therapySessions).values(revive(session));
      else
        await tx
          .update(therapySessions)
          .set(revive(session))
          .where(eq(therapySessions.id, session.id));
    }
    await tx
      .insert(auditLog)
      .values({
        actorUserId: actor.id,
        actorEmail: actor.email,
        action: "ai.undo",
        targetType: "proposal",
        targetId: proposalId,
      });
  });
  return { success: true };
}
