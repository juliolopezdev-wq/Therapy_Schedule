import { permanentlyDeleteAccount } from "./accountDeletion";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure, staffProcedure, schedulerProcedure, adminProcedure } from "./_core/trpc";
import { logout as logoutUser, requestMagicLink, requestSignInLink, getSignInStatus, recordUserActivity, getSessionStatus } from "./_core/auth";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getPatients,
  getArchivedPatients,
  getPatientById,
  createPatient,
  updatePatient,
  reorderPatient,
  archivePatient,
  restorePatient,
  getTherapySessions,
  getTherapySessionsForWeek,
  getTherapySessionsForDateRange,
  getSessionById,
  createTherapySession,
  updateTherapySession,
  completeAllTherapySessionsForDate,
  deleteTherapySession,
  getTherapists,
  getArchivedTherapists,
  createTherapist,
  updateTherapist,
  archiveTherapist,
  restoreTherapist,
  countUpcomingSessionsForTherapist,
  getTeams,
  createTeam,
  getStatusFlagsForDate,
  createStatusFlag,
  deleteStatusFlag,
  setStatusFlag,
  getBoardHistory,
  getSnapshotForDate,
  saveBoardSnapshot,
  deleteBoardSnapshot,
  seedTeamsIfEmpty,
  copyDayToNextDay,
  copyPatientSessionsToNextDay,
  movePatientSessionsToNextDay,
  deleteStatusFlagByPatientAndType,
  getAdditionalMinutesForPatient,
  createAdditionalMinutes,
  deleteAdditionalMinutes,
  callOffTherapist,
  cancelCallOffTherapist,
  getTherapistAbsences,
  getCallOffAssignmentHistory,
  listCallOffChanges,
  getLastSessionNoteForPatient,
  getTherapistStats,
  getTherapistProductivityStats,
  setWeekendOverride,
  listInvites,
  createInvite,
  updateInviteRole,
  revokePendingInvite,
  getInviteByEmail,
  listUsers,
  updateUserRole,
  updateUserName,
  linkUserToTherapist,
  setUserDeactivated,
  listAllActiveSessions,
  revokeSession,
  logAudit,
  undoCallOffChange,
  listAuditLog,
  listStaffMessages,
  getStaffMessage,
  createStaffMessage,
  acknowledgeStaffMessage,
  resolveStaffMessage,
  archiveStaffMessage,
  pinStaffMessage,
  listDirectMessageDirectory,
  listDirectMessageThreads,
  listDirectConversation,
  createDirectMessage,
  markDirectConversationRead,
  logPatientChartAccess,
  getPatientChartAccessLog,
  getTreatmentNotesForPatient,
  getTreatmentNoteById,
  createTreatmentNote,
  updateTreatmentNote,
  signTreatmentNote,
  getPatientGoals,
  getPatientGoalById,
  createPatientGoal,
  updatePatientGoal,
  archivePatientGoal,
  getFunctionalAssessmentsForPatient,
  getFunctionalAssessmentById,
  createFunctionalAssessment,
  updateFunctionalAssessment,
  signFunctionalAssessment,
  listScheduleChangeRequests,
  getScheduleChangeRequestById,
  createScheduleChangeRequest,
  cancelScheduleChangeRequest,
  reviewScheduleChangeRequest,
} from "./db";
import {
  assertOwnTherapist,
  assertPatientInScope,
  assertSessionWriteAccess,
  getScopedPatients,
  getScopedSessions,
  getScopedSessionsForDateRange,
  getScopedSessionsForWeek,
  getScopedAbsences,
  getDetailPatientIds,
  getScopedStatusFlags,
  getScopedTeams,
  getScopedTherapists,
  requireLinkedScope,
  resolveAccessScope,
  assertTherapistWriteAccess,
} from "./accessControl";
import { sendTomorrowAssignments } from "./assignmentEmail";
import { getWeekendCoverage, autoAssignWeekendStaff } from "./weekendStaffing";
import { getWeeklyMinutesSummary, getGapFillSuggestions, getOrCreateTodaysDigest, getPredictiveForecast, rebalanceTherapistAbsence, getComplianceSentinelReport, previewSickCallPriorityTriage } from "./scheduling";
import { getGGCompletenessReport, getGGTrendReport, getGGScoringConsistencyReport } from "./sectionGGCompliance";
import { approveAiProposal, listAiProposals, dismissAiProposal, undoAiProposal } from "./aiReview";
import { askScheduler, analyzeData, executeTool } from "./ollama";
import { canManageSchedule, isChartOnlyUpdate } from "../shared/accessPolicy";
import { SECTION_GG_ITEMS, SECTION_GG_VALUES, assessmentProgress, isDateKey } from "../shared/sectionGG";
import { ALL_THERAPY_TYPES } from "../shared/therapyTypes";

const ggScoresSchema = z.record(z.string(), z.number().int()).refine(scores => Object.entries(scores).every(([key, value]) => SECTION_GG_ITEMS.some(item => item.code === key) && SECTION_GG_VALUES.has(value)), "Use supported assessment items and scores");
const assessmentDateSchema = z.string().refine(isDateKey, "Use a valid calendar date (YYYY-MM-DD)");

const therapyTypeEnum = z.enum(ALL_THERAPY_TYPES);
const flagTypeEnum = z.enum(["DC", "Name Alert", "Weekend", "In-Service", "Appointment", "Stroke Program", "Shower", "Medical Hold", "Dialysis", "Block Time", "Group Appropriate", "Male Therapist Only", "Female Therapist Only", "Home Eval", "Family Training", "LOA", "15/7"]);
const sessionStatusEnum = z.enum(["scheduled", "completed", "canceled_discharge", "missed_refusal", "missed_clinical_hold", "missed_staffing", "missed_other"]);
const deliveryModeEnum = z.enum(["individual", "concurrent", "group"]);
const employmentTypeEnum = z.enum(["full_time", "part_time", "prn"]);
const accountRoleEnum = z.enum(["admin", "team_lead", "staff", "viewer"]);
const messageChannelEnum = z.enum(["general", "handoff", "coverage", "kudos"]);
const messagePriorityEnum = z.enum(["normal", "important", "urgent"]);
const mrnSchema = z.string().trim().min(1, "MRN is required").max(64);
const weekendRotationSchema = z
  .object({
    days: z.array(z.number().min(0).max(6)),
    intervalWeeks: z.number().min(1).max(12),
    anchorDate: z.string(),
  })
  .nullable()
  .optional();

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(async (opts) => {
      if (!opts.ctx.user) return null;
      return { ...opts.ctx.user, accessScope: await resolveAccessScope(opts.ctx.user) };
    }),
    requestLink: publicProcedure
      // format is checked in requestSignInLink so bad addresses count toward the lock
      .input(z.object({ email: z.string().max(1024) }))
      .mutation(({ input, ctx }) => requestSignInLink(input.email, ctx.req)),
    signInStatus: publicProcedure.query(({ ctx }) => getSignInStatus(ctx.req)),
    activity: protectedProcedure.mutation(async ({ ctx }) => { await recordUserActivity(ctx.req); return { success: true }; }),
    sessionStatus: publicProcedure.query(({ ctx }) => ctx.user ? getSessionStatus(ctx.req) : null),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      await logoutUser(ctx.req, ctx.res);
      return { success: true } as const;
    }),
  }),

  admin: router({
    /** Admins can manage each other's access (role, activation) but can't see each other's
     *  personal identity -- only the acting admin's own row is shown in full; every other
     *  admin's name, email, and last-sign-in are redacted. */
    listUsers: adminProcedure.query(async ({ ctx }) => {
      const rows = await listUsers();
      return rows.map((row) => row.role !== "admin" || row.id === ctx.user.id ? row : {
        ...row,
        name: null,
        email: null,
        openId: "",
        lastSignedIn: null,
        staffName: null,
        teamName: null,
      });
    }),
    listInvites: adminProcedure.query(async () => listInvites()),
    invite: adminProcedure
      .input(z.object({ email: z.string().email(), role: accountRoleEnum }))
      .mutation(async ({ input, ctx }) => {
        const existing = await getInviteByEmail(input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "That email has already been invited." });
        }
        const invite = await createInvite({ email: input.email, role: input.role, invitedByUserId: ctx.user.id });
        let emailDelivery: Awaited<ReturnType<typeof requestMagicLink>> = "send_failed";
        try {
          emailDelivery = await requestMagicLink(input.email, ctx.req, { awaitDelivery: true, invitation: true });
        } catch (error) {
          console.error(`[Invite] Failed to prepare invitation email for ${input.email}:`, error);
        }
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "invite.create",
          targetType: "invite",
          targetId: input.email,
          metadata: { role: input.role, emailDelivery },
        });
        return { ...invite, emailDelivery };
      }),
    updateInviteRole: adminProcedure
      .input(z.object({ email: z.string().email(), role: accountRoleEnum }))
      .mutation(async ({ input, ctx }) => {
        await updateInviteRole(input.email, input.role);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "invite.role_change",
          targetType: "invite",
          targetId: input.email,
          metadata: { role: input.role },
        });
        return { success: true } as const;
      }),
    revokeInvite: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        let revoked: Awaited<ReturnType<typeof revokePendingInvite>>;
        try {
          revoked = await revokePendingInvite(input.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invite could not be revoked";
          if (message === "Invite not found") {
            throw new TRPCError({ code: "NOT_FOUND", message });
          }
          if (message === "Accepted invites cannot be revoked") {
            throw new TRPCError({ code: "BAD_REQUEST", message });
          }
          throw error;
        }
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "invite.revoke",
          targetType: "invite",
          targetId: String(input.id),
          metadata: { email: revoked.email },
        });
        return { success: true } as const;
      }),
    resendInvite: adminProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input, ctx }) => {
        const invite = await getInviteByEmail(input.email);
        if (!invite) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
        }
        if (invite.acceptedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation has already been accepted." });
        }

        const emailDelivery = await requestMagicLink(input.email, ctx.req, { awaitDelivery: true, invitation: true });
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "invite.resend",
          targetType: "invite",
          targetId: input.email,
          metadata: { emailDelivery },
        });
        return { emailDelivery };
      }),
    updateUserRole: adminProcedure
      .input(z.object({ userId: z.number(), role: accountRoleEnum }))
      .mutation(async ({ input, ctx }) => {
        if (input.userId === ctx.user.id && input.role !== "admin") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove your own admin access." });
        }
        await updateUserRole(input.userId, input.role);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "user.role_change",
          targetType: "user",
          targetId: String(input.userId),
          metadata: { role: input.role },
        });
        return { success: true } as const;
      }),
    updateUserName: adminProcedure
      .input(z.object({ userId: z.number().int().positive(), name: z.string().trim().min(2).max(80) }))
      .mutation(async ({ input, ctx }) => {
        await updateUserName(input.userId, input.name);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "user.name_change",
          targetType: "user",
          targetId: String(input.userId),
          metadata: { name: input.name },
        });
        return { success: true } as const;
      }),
    linkUserToTherapist: adminProcedure
      .input(z.object({ userId: z.number().int().positive(), therapistId: z.number().int().positive().nullable() }))
      .mutation(async ({ input, ctx }) => {
        try {
          await linkUserToTherapist(input.userId, input.therapistId);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Account could not be linked";
          throw new TRPCError({ code: message.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST", message });
        }
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: input.therapistId == null ? "user.staff_unlink" : "user.staff_link",
          targetType: "user",
          targetId: String(input.userId),
          metadata: { therapistId: input.therapistId },
        });
        return { success: true } as const;
      }),
    deleteUser: adminProcedure
      .input(z.object({ userId: z.number().int().positive(), confirmation: z.literal("DELETE") }))
      .mutation(async ({ input, ctx }) => {
        await permanentlyDeleteAccount(input.userId, ctx.user.id);
        return { success: true } as const;
      }),
    setUserDeactivated: adminProcedure
      .input(z.object({ userId: z.number(), deactivated: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        if (input.userId === ctx.user.id && input.deactivated) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot deactivate your own account." });
        }
        await setUserDeactivated(input.userId, input.deactivated);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: input.deactivated ? "user.deactivate" : "user.reactivate",
          targetType: "user",
          targetId: String(input.userId),
        });
        return { success: true } as const;
      }),
    // Other admins' active sessions (identity + IP) are hidden entirely -- an admin's own
    // session, and every non-admin user's sessions, are unaffected.
    listSessions: adminProcedure.query(async ({ ctx }) => {
      const rows = await listAllActiveSessions();
      return rows.filter((row) => row.userRole !== "admin" || row.userId === ctx.user.id);
    }),
    revokeSession: adminProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await revokeSession(input.sessionId);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "session.revoke",
          targetType: "session",
          targetId: String(input.sessionId),
        });
        return { success: true } as const;
      }),
    auditLog: adminProcedure
      .input(z.object({ limit: z.number().min(1).max(500).optional() }))
      .query(async ({ input }) => listAuditLog(input.limit ?? 200)),
  }),

  /* ------------------------------------------------------------------ */
  /* Attendance                                                         */
  /* ------------------------------------------------------------------ */
  attendance: router({
    getAbsences: protectedProcedure
      .input(z.object({ date: z.date() }))
      .query(async ({ input, ctx }) => {
        return getScopedAbsences(ctx.user, input.date);
      }),
    assignmentHistory: protectedProcedure
      .input(z.object({ date: z.date() }))
      .query(async ({ input }) => getCallOffAssignmentHistory(input.date)),
    callOffHistory: schedulerProcedure
      .input(z.object({ date: z.date() }))
      .query(async ({ input }) => listCallOffChanges(input.date)),
    callOff: schedulerProcedure
      .input(z.object({ therapistId: z.number(), date: z.date(), reason: z.string().trim().min(1).max(200).optional() }))
      .mutation(async ({ input, ctx }) => {
        await assertTherapistWriteAccess(await resolveAccessScope(ctx.user), input.therapistId);
        const { undoAssignments, ...result } = await callOffTherapist(input.therapistId, input.date, input.reason);
        const undoAuditId = await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "attendance.call_off",
          targetType: "therapist",
          targetId: String(input.therapistId),
          metadata: {
            therapistId: input.therapistId,
            date: input.date.toISOString(),
            reason: input.reason || "Call-Off",
            reassigned: result.reAssignedCount,
            unassigned: result.unassignedCount,
            undoAssignments,
          },
        });
        return { ...result, undoAuditId };
      }),
    undoCallOff: schedulerProcedure
      .input(z.object({ auditId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        let result: Awaited<ReturnType<typeof undoCallOffChange>>;
        try {
          result = await undoCallOffChange(input.auditId, ctx.user.id);
        } catch (error) {
          throw new TRPCError({
            code: "CONFLICT",
            message: error instanceof Error ? error.message : "Could not undo the call-off",
          });
        }
        return result;
      }),
    cancelCallOff: schedulerProcedure
      .input(z.object({ therapistId: z.number(), date: z.date() }))
      .mutation(async ({ input, ctx }) => {
        await assertTherapistWriteAccess(await resolveAccessScope(ctx.user), input.therapistId);
        const result = await cancelCallOffTherapist(input.therapistId, input.date);
        await logAudit({ actorUserId: ctx.user.id, actorEmail: ctx.user.email, action: "attendance.mark_present", targetType: "therapist", targetId: String(input.therapistId), metadata: { date: input.date.toISOString() } });
        return result;
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* Analytics / Planning                                               */
  /* ------------------------------------------------------------------ */
  forecast: adminProcedure
    .input(z.object({ date: z.date() }))
    .query(async ({ input }) => {
      return getPredictiveForecast(input.date);
    }),

  /* ------------------------------------------------------------------ */
  /* Patients                                                            */
  /* ------------------------------------------------------------------ */
  patients: router({
    list: protectedProcedure
      .input(z.object({ date: z.date().optional() }).optional())
      .query(async ({ input, ctx }) => getScopedPatients(ctx.user, input?.date)),
    listArchived: adminProcedure.query(async () => getArchivedPatients()),
    getById: schedulerProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const patient = await getPatientById(input.id);
        if (patient) await assertPatientInScope(await resolveAccessScope(ctx.user), patient.id);
        return patient;
      }),
    create: adminProcedure
      .input(
        z.object({
          mrn: mrnSchema,
          previousAdmissionId: z.number().optional(),
          roomNumber: z.string().trim().min(1),
          name: z.string().trim().min(1),
          notes: z.string().optional(),
          isDischarged: z.boolean().optional(),
          admissionDate: z.string().optional(),
          estimatedDischargeDate: z.string().optional(),
          actualDischargeDate: assessmentDateSchema.optional(),
          weeklyMinuteTarget: z.number().int().min(30).optional(),
          teamId: z.number().nullable().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const admission = await createPatient(input);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: input.previousAdmissionId ? "admission.readmit" : "admission.create",
          targetType: "admission",
          targetId: String(admission.id),
          metadata: { previousAdmissionId: input.previousAdmissionId ?? null },
        });
        return admission;
      }),
    update: schedulerProcedure
      .input(
        z.object({
          id: z.number(),
          mrn: mrnSchema.optional(),
          previousAdmissionId: z.number().nullable().optional(),
          roomNumber: z.string().trim().min(1).optional(),
          name: z.string().trim().min(1).optional(),
          notes: z.string().optional(),
          isDischarged: z.boolean().optional(),
          isRoomPlaceholder: z.boolean().optional(),
          admissionDate: z.string().optional(),
          estimatedDischargeDate: z.string().optional(),
          actualDischargeDate: assessmentDateSchema.optional(),
          weeklyMinuteTarget: z.number().int().min(30).optional(),
          teamId: z.number().nullable().optional(),
          orderIndex: z.number().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const scope = await resolveAccessScope(ctx.user);
        await assertPatientInScope(scope, id);
        const result = await updatePatient(id, data);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: input.isDischarged ? "admission.discharge" : "admission.update",
          targetType: "admission",
          targetId: String(id),
          metadata: input.isDischarged ? {
            dischargeCutoff: result.dischargeCutoff?.toISOString() ?? null,
            canceledSessionCount: result.canceledSessionCount,
          } : undefined,
        });
        return result;
      }),
    reorder: schedulerProcedure
      .input(z.object({
        patientId: z.number(),
        targetTeamId: z.number().nullable(),
        targetPatientId: z.number().nullable().optional(),
        placeAfter: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        await assertPatientInScope(scope, input.patientId);
        const result = await reorderPatient(
          input.patientId,
          input.targetTeamId,
          input.targetPatientId,
          input.placeAfter,
        );
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "admission.reorder",
          targetType: "admission",
          targetId: String(input.patientId),
          metadata: {
            targetTeamId: input.targetTeamId,
            targetPatientId: input.targetPatientId ?? null,
            placeAfter: input.placeAfter ?? false,
          },
        });
        return result;
      }),
    archive: adminProcedure
      .input(z.object({ id: z.number(), reason: z.string().trim().max(500).optional() }))
      .mutation(async ({ input, ctx }) => {
        const result = await archivePatient(input.id, ctx.user.id, input.reason);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "admission.archive",
          targetType: "admission",
          targetId: String(input.id),
          metadata: { reason: input.reason || null },
        });
        return result;
      }),
    restore: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const result = await restorePatient(input.id);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "admission.restore",
          targetType: "admission",
          targetId: String(input.id),
        });
        return result;
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* Therapy Sessions                                                    */
  /* ------------------------------------------------------------------ */
  sessions: router({
    list: protectedProcedure
      .input(z.object({ date: z.date().optional() }).optional())
      .query(async ({ input, ctx }) => getScopedSessions(ctx.user, input?.date)),
    listForWeek: protectedProcedure
      .input(z.object({ weekStart: z.date() }))
      .query(async ({ input, ctx }) => getScopedSessionsForWeek(ctx.user, input.weekStart)),
    listForDateRange: protectedProcedure
      .input(z.object({ startDate: z.date(), endDate: z.date() }))
      .query(async ({ input, ctx }) => getScopedSessionsForDateRange(ctx.user, input.startDate, input.endDate)),
    create: schedulerProcedure
      .input(
        z.object({
          patientId: z.number(),
          therapyType: therapyTypeEnum,
          startTime: z.date(),
          endTime: z.date(),
          durationMinutes: z.number().int().positive(),
          actualDurationMinutes: z.number().int().positive().optional(),
          deliveryMode: deliveryModeEnum.optional(),
          therapistId: z.number().nullable().optional(),
          notes: z.string().optional(),
          status: sessionStatusEnum.optional(),
          missedReason: z.string().optional(),
          ignoreConflicts: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        await assertPatientInScope(scope, input.patientId);
        if (!canManageSchedule(scope.role) && input.therapistId !== scope.therapistId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only create sessions assigned to you." });
        }
        return createTherapySession({
          ...input,
          therapistId: input.therapistId ?? null,
        }, input.ignoreConflicts);
      }),
    update: staffProcedure
      .input(
        z.object({
          id: z.number(),
          patientId: z.number().optional(),
          therapyType: therapyTypeEnum.optional(),
          startTime: z.date().optional(),
          endTime: z.date().optional(),
          durationMinutes: z.number().int().positive().optional(),
          actualDurationMinutes: z.number().int().positive().optional(),
          deliveryMode: deliveryModeEnum.optional(),
          therapistId: z.number().nullable().optional(),
          notes: z.string().optional(),
          status: sessionStatusEnum.optional(),
          missedReason: z.string().optional(),
          ignoreConflicts: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const { id, ignoreConflicts, ...data } = input;
        const scope = await resolveAccessScope(ctx.user);
        const existing = await getSessionById(id);
        await assertSessionWriteAccess(scope, existing, true);
        if (data.patientId !== undefined) await assertPatientInScope(scope, data.patientId);
        if (scope.role === "staff") {
          if (!isChartOnlyUpdate(Object.keys(data))) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Staff can chart completion details but cannot reschedule sessions." });
          }
        }
        const result = await updateTherapySession(id, data, ignoreConflicts);
        if (data.therapistId !== undefined && data.therapistId !== existing?.therapistId) {
          await logAudit({
            actorUserId: ctx.user.id,
            actorEmail: ctx.user.email,
            action: "session.reassign",
            targetType: "therapy_session",
            targetId: String(id),
            metadata: {
              sessionId: id,
              date: new Date(data.startTime ?? existing!.startTime).toISOString(),
              previousTherapistId: existing?.therapistId ?? null,
              newTherapistId: data.therapistId,
            },
          });
        }
        return result;
      }),
    completeOwn: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        const session = await getSessionById(input.id);
        if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
        if (!canManageSchedule(scope.role)) {
          requireLinkedScope(scope);
          if (session.therapistId !== scope.therapistId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only complete sessions assigned to you." });
          }
        }
        if (session.therapyType === "Block") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Block time cannot be completed as treatment." });
        }
        if (session.status !== "scheduled") return { success: true, changed: false } as const;
        await updateTherapySession(input.id, {
          status: "completed",
          actualDurationMinutes: session.durationMinutes,
          missedReason: null,
        });
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "session.complete_own",
          targetType: "therapy_session",
          targetId: String(input.id),
          metadata: { scheduledMinutes: session.durationMinutes },
        });
        return { success: true, changed: true } as const;
      }),
    undoOwnCompletion: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        if (scope.role !== "viewer") {
          throw new TRPCError({ code: "FORBIDDEN", message: "This correction is available to view-only accounts for their own sessions." });
        }
        requireLinkedScope(scope);
        const session = await getSessionById(input.id);
        if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
        if (session.therapistId !== scope.therapistId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only undo completion for sessions assigned to you." });
        }
        if (session.therapyType === "Block") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Block time does not have a completion status." });
        }
        if (session.status !== "completed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only a completed session can be returned to Scheduled." });
        }
        await updateTherapySession(input.id, {
          status: "scheduled",
          actualDurationMinutes: null,
          missedReason: null,
        });
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "session.undo_complete_own",
          targetType: "therapy_session",
          targetId: String(input.id),
          metadata: { previousActualMinutes: session.actualDurationMinutes },
        });
        return { success: true } as const;
      }),
    completeAllForDate: staffProcedure
      .input(z.object({ date: z.date() }))
      .mutation(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        if (!canManageSchedule(scope.role)) requireLinkedScope(scope);
        const result = await completeAllTherapySessionsForDate(input.date, canManageSchedule(scope.role) ? undefined : scope.therapistId ?? undefined);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "sessions.complete_all",
          targetType: "therapy_session",
          metadata: { date: input.date.toISOString(), count: result.count },
        });
        return result;
      }),
    delete: schedulerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await assertSessionWriteAccess(await resolveAccessScope(ctx.user), await getSessionById(input.id));
        return deleteTherapySession(input.id);
      }),
    copyDayToNextDay: schedulerProcedure
      .input(z.object({ date: z.date() }))
      .mutation(async ({ input }) => copyDayToNextDay(input.date)),
    copyPatientSessionsToNextDay: schedulerProcedure
      .input(z.object({ patientId: z.number(), date: z.date() }))
      .mutation(async ({ input, ctx }) => {
        await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
        return copyPatientSessionsToNextDay(input.patientId, input.date);
      }),
    movePatientSessionsToNextDay: schedulerProcedure
      .input(z.object({ patientId: z.number(), date: z.date() }))
      .mutation(async ({ input, ctx }) => {
        await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
        return movePatientSessionsToNextDay(input.patientId, input.date);
      }),
    lastNote: protectedProcedure
      .input(
        z.object({
          patientId: z.number(),
          therapyType: therapyTypeEnum,
          referenceDate: z.date(),
          excludeSessionId: z.number().optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        await assertPatientInScope(scope, input.patientId);
        if (scope.role === "viewer") return null;
        return getLastSessionNoteForPatient(
          input.patientId,
          input.therapyType,
          input.referenceDate,
          input.excludeSessionId,
          scope.role === "staff" ? scope.therapistId ?? undefined : undefined,
        ) ?? null;
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* Therapists                                                          */
  /* ------------------------------------------------------------------ */
  therapists: router({
    list: protectedProcedure.query(async ({ ctx }) => getScopedTherapists(ctx.user)),
    listArchived: adminProcedure.query(async () => getArchivedTherapists()),
    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          email: z.string().email().nullable().optional(),
          phone: z.string().trim().max(30).nullable().optional(),
          teamId: z.number().nullable().optional(),
          userId: z.number().nullable().optional(),
          therapyType: z.enum(["PT", "OT", "SLP"]).optional(),
          // Working hours for auto-placement. workDays is 0=Sun..6=Sat; null/omitted on any
          // of the three means "no restriction" for that dimension.
          workDays: z.array(z.number().min(0).max(6)).nullable().optional(),
          workStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
          workEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
          workHours: z.string().nullable().optional(),
          employmentType: employmentTypeEnum.optional(),
          weekendRotation: weekendRotationSchema,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const therapists = await getTherapists();
        const hue = Math.floor((therapists.length * 137.5) % 360).toString();
        const employmentType = input.employmentType ?? "full_time";
        const result = await createTherapist({
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          teamId: input.teamId ?? null,
          userId: input.userId ?? null,
          color: hue,
          therapyType: input.therapyType ?? "PT",
          workDays: input.workDays ? input.workDays.join(",") : null,
          workStartTime: input.workStartTime ?? null,
          workEndTime: input.workEndTime ?? null,
          workHours: input.workHours ?? null,
          employmentType,
          isPRN: employmentType === "prn",
          weekendRotation: input.weekendRotation ? JSON.stringify(input.weekendRotation) : null,
        });
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "staff.create",
          targetType: "therapist",
          targetId: String(result.id),
          metadata: { name: input.name },
        });
        return result;
      }),
    /** Admins can change any staff record in full. Team Leads are limited to their own team's
     *  roster and to contact/scheduling fields (email, hours, availability) -- they can't
     *  reassign a team, change discipline/employment type, or edit staff outside their team. */
    update: schedulerProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().optional(),
          email: z.string().email().nullable().optional(),
          phone: z.string().trim().max(30).nullable().optional(),
          teamId: z.number().nullable().optional(),
          therapyType: z.enum(["PT", "OT", "SLP"]).optional(),
          workDays: z.array(z.number().min(0).max(6)).nullable().optional(),
          workStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
          workEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
          workHours: z.string().nullable().optional(),
          employmentType: employmentTypeEnum.optional(),
          weekendRotation: weekendRotationSchema,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        if (scope.role !== "admin") {
          requireLinkedScope(scope);
          const target = (await getTherapists()).find((therapist) => therapist.id === input.id);
          if (!target || target.teamId !== scope.teamId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only manage staff on your own team." });
          }
          const rosterOnlyFields = ["name", "teamId", "therapyType", "employmentType", "weekendRotation"] as const;
          for (const field of rosterOnlyFields) {
            if (input[field] !== undefined) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "Team Leads can update a teammate's email, hours, and availability -- only an admin can change roster details.",
              });
            }
          }
        }
        const { id, workDays, employmentType, weekendRotation, ...rest } = input;
        const result = await updateTherapist(id, {
          ...rest,
          ...(workDays !== undefined ? { workDays: workDays ? workDays.join(",") : null } : {}),
          ...(employmentType !== undefined ? { employmentType, isPRN: employmentType === "prn" } : {}),
          ...(weekendRotation !== undefined ? { weekendRotation: weekendRotation ? JSON.stringify(weekendRotation) : null } : {}),
        });
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "staff.update",
          targetType: "therapist",
          targetId: String(id),
        });
        return result;
      }),
    /** Any linked staff member can update their own contact info without waiting on a team
     *  lead or admin -- scoped to email/phone only, and only ever "my own" record. */
    updateOwnContact: protectedProcedure
      .input(z.object({
        email: z.string().email().nullable().optional(),
        phone: z.string().trim().max(30).nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        requireLinkedScope(scope);
        if (scope.therapistId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Your account isn't linked to a staff profile, so there's nothing to update here." });
        }
        await updateTherapist(scope.therapistId, {
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
        });
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "staff.update_own_contact",
          targetType: "therapist",
          targetId: String(scope.therapistId),
        });
        return { success: true } as const;
      }),
    upcomingSessionCount: adminProcedure
      .input(z.object({ therapistId: z.number() }))
      .query(async ({ input }) => countUpcomingSessionsForTherapist(input.therapistId)),
    archive: adminProcedure
      .input(z.object({ id: z.number(), reason: z.string().trim().max(500).optional() }))
      .mutation(async ({ input, ctx }) => {
        const result = await archiveTherapist(input.id, ctx.user.id, input.reason);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "staff.archive",
          targetType: "therapist",
          targetId: String(input.id),
          metadata: { reason: input.reason || null },
        });
        return result;
      }),
    restore: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const result = await restoreTherapist(input.id);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "staff.restore",
          targetType: "therapist",
          targetId: String(input.id),
        });
        return result;
      }),
    getStats: protectedProcedure
      .input(z.object({ therapistId: z.number(), date: z.date().optional() }))
      .query(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        if (scope.role === "staff" || scope.role === "viewer") assertOwnTherapist(scope, input.therapistId);
        else await assertTherapistWriteAccess(scope, input.therapistId);
        return getTherapistStats(input.therapistId, input.date ?? new Date());
      }),
    getProductivity: adminProcedure
      .input(z.object({ date: z.date().optional() }).optional())
      .query(async ({ input }) => getTherapistProductivityStats(input?.date ?? new Date())),
    /** Same authorization as getStats (self, or admin/scope override) -- but unlike the admin-only
     *  getProductivity above, this never returns the full peer leaderboard. An employee looking at
     *  their own numbers gets their own row plus anonymous department/discipline averages for
     *  context, never named colleagues' individual rates. */
    getProductivityForTherapist: protectedProcedure
      .input(z.object({ therapistId: z.number(), date: z.date().optional() }))
      .query(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        if (scope.role === "staff" || scope.role === "viewer") assertOwnTherapist(scope, input.therapistId);
        else await assertTherapistWriteAccess(scope, input.therapistId);
        const summary = await getTherapistProductivityStats(input.date ?? new Date());
        const mine = summary.leaderboard.find((item) => item.therapistId === input.therapistId);
        if (!mine) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No productivity data for this staff member on this date." });
        }
        return {
          date: summary.date,
          reportingState: summary.reportingState,
          benchmarkPercent: summary.benchmarkPercent,
          me: mine,
          department: {
            averageProductivityRate: summary.departmentAverageProductivityRate,
            projectedProductivityRate: summary.departmentProjectedProductivityRate,
          },
          disciplineAverage: summary.disciplineAverages[mine.therapyType as "PT" | "OT" | "SLP"],
        };
      }),
    sendTomorrowAssignments: schedulerProcedure
      .input(z.object({ referenceDate: z.date().optional(), therapistIds: z.array(z.number()).optional() }))
      .mutation(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        if (scope.role !== "admin") {
          for (const therapistId of input.therapistIds ?? []) await assertTherapistWriteAccess(scope, therapistId);
          if (!input.therapistIds?.length) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Team Leads must select team members before sending schedules." });
          }
        }
        return sendTomorrowAssignments(input.referenceDate ?? new Date(), input.therapistIds);
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* Weekend staffing (rotation-based coverage + manual/AI assignment)  */
  /* ------------------------------------------------------------------ */
  weekendStaffing: router({
    getCoverage: adminProcedure
      .input(z.object({ referenceDate: z.date().optional() }))
      .query(async ({ input }) => getWeekendCoverage(input.referenceDate ?? new Date())),
    setOverride: schedulerProcedure
      .input(z.object({ therapistId: z.number(), date: z.date(), working: z.boolean().nullable() }))
      .mutation(async ({ input, ctx }) => {
        await assertTherapistWriteAccess(await resolveAccessScope(ctx.user), input.therapistId);
        return setWeekendOverride(input.therapistId, input.date, input.working);
      }),
    autoAssign: adminProcedure
      .input(z.object({ referenceDate: z.date().optional() }))
      .mutation(async ({ input }) => autoAssignWeekendStaff(input.referenceDate ?? new Date())),
  }),

  /* ------------------------------------------------------------------ */
  /* Teams                                                               */
  /* ------------------------------------------------------------------ */
  teams: router({
    list: protectedProcedure.query(async ({ ctx }) => getScopedTeams(ctx.user)),
    create: adminProcedure
      .input(z.object({ name: z.string().min(1), color: z.string().optional() }))
      .mutation(async ({ input }) =>
        createTeam({ name: input.name, color: input.color ?? "#6366f1" }),
      ),
    seed: adminProcedure.mutation(async () => {
      await seedTeamsIfEmpty();
      return { success: true };
    }),
  }),

  /* ------------------------------------------------------------------ */
  /* Status Flags                                                        */
  /* ------------------------------------------------------------------ */
  statusFlags: router({
    listForDate: protectedProcedure
      .input(z.object({ date: z.date() }))
      .query(async ({ input, ctx }) => getScopedStatusFlags(ctx.user, input.date)),
    create: schedulerProcedure
      .input(
        z.object({
          patientId: z.number(),
          flagType: flagTypeEnum,
          date: z.date(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
        return createStatusFlag(input);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => deleteStatusFlag(input.id)),
    toggle: schedulerProcedure
      .input(
        z.object({
          patientId: z.number(),
          flagType: flagTypeEnum,
          date: z.date(),
          active: z.boolean(),
        }),
      )
      // Clinical flags are informational. In particular, DC records the planned discharge date;
      // it must never discharge, delete, replace, or otherwise mutate the patient record.
      .mutation(async ({ input, ctx }) => {
        await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
        return setStatusFlag(input.patientId, input.flagType, input.date, input.active);
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* Additional Minutes                                                  */
  /* ------------------------------------------------------------------ */
  additionalMinutes: router({
    listByPatient: protectedProcedure
      .input(z.object({ patientId: z.number() }))
      .query(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        await assertPatientInScope(scope, input.patientId);
        if (scope.role === "staff" || scope.role === "viewer") {
          const allowed = await getDetailPatientIds(scope);
          if (!allowed.has(input.patientId)) throw new TRPCError({ code: "FORBIDDEN", message: "You can only view adjustments for your assigned patients." });
        }
        return getAdditionalMinutesForPatient(input.patientId);
      }),
    create: schedulerProcedure
      .input(
        z.object({
          patientId: z.number(),
          date: z.date(),
          additionalMinutes: z.number(),
          reason: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
        return createAdditionalMinutes(input);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => deleteAdditionalMinutes(input.id)),
  }),

  /* ------------------------------------------------------------------ */
  /* Board History (daily snapshots)                                     */
  /* ------------------------------------------------------------------ */
  history: router({
    list: adminProcedure.query(async () => getBoardHistory()),
    getForDate: adminProcedure
      .input(z.object({ date: z.date() }))
      .query(async ({ input }) => getSnapshotForDate(input.date)),
    save: adminProcedure
      .input(z.object({ date: z.date(), note: z.string().trim().max(500).optional() }))
      .mutation(async ({ input, ctx }) => {
        const result = await saveBoardSnapshot(input.date, {
          note: input.note,
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
        });
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "board_snapshot.create",
          targetType: "board_snapshot",
          targetId: String(result.id),
          metadata: { date: input.date.toISOString(), revision: result.revision, note: input.note || null },
        });
        return result;
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteBoardSnapshot(input.id);
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "board_snapshot.delete",
          targetType: "board_snapshot",
          targetId: String(input.id),
        });
        return result;
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* Weekly Minutes & Gap Fill                                           */
  /* ------------------------------------------------------------------ */
  weeklyMinutes: router({
    summary: protectedProcedure
      .input(z.object({ referenceDate: z.date().optional() }).optional())
      .query(async ({ input, ctx }) => {
        const rows = await getWeeklyMinutesSummary(input?.referenceDate ?? new Date());
        if (ctx.user.role === "admin") return rows;
        const patientIds = await getDetailPatientIds(await resolveAccessScope(ctx.user));
        return rows.filter((row) => patientIds.has(row.patientId));
      }),
  }),

  gapFill: router({
    suggestions: schedulerProcedure
      .input(z.object({ patientId: z.number(), referenceDate: z.date().optional() }))
      .query(async ({ input, ctx }) => {
        await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
        return getGapFillSuggestions(input.patientId, input.referenceDate ?? new Date());
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* Morning gap-fill digest -- generated automatically (see              */
  /* _core/digestScheduler.ts); this query is also the lazy-fallback path */
  /* that guarantees it exists even if the server was cold this morning.  */
  /* ------------------------------------------------------------------ */
  digest: router({
    today: protectedProcedure
      .input(z.object({ referenceDate: z.date().optional() }).optional())
      .query(async ({ input, ctx }) => {
        const rows = await getOrCreateTodaysDigest(input?.referenceDate ?? new Date());
        if (ctx.user.role === "admin") return rows;
        const patientIds = await getDetailPatientIds(await resolveAccessScope(ctx.user));
        return rows.filter((row) => patientIds.has(row.patientId));
      }),
  }),

  huddle: router({
    today: protectedProcedure
      .input(z.object({ date: z.date() }))
      .query(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        if (!canManageSchedule(scope.role)) requireLinkedScope(scope);
        const [scopedPatients, scopedSessions, absences] = await Promise.all([
          getScopedPatients(ctx.user, input.date),
          getScopedSessions(ctx.user, input.date),
          getScopedAbsences(ctx.user, input.date),
        ]);
        const patientById = new Map(scopedPatients.map((patient) => [patient.id, patient]));
        const treatment = scopedSessions.filter((session) => session.therapyType !== "Block");
        const ownSessions = scope.therapistId == null ? [] : treatment.filter((session) => session.therapistId === scope.therapistId);
        const outstanding = treatment
          .filter((session) => session.status === "scheduled")
          .map((session) => {
            const patient = patientById.get(session.patientId);
            return patient ? {
              sessionId: session.id,
              patientId: patient.id,
              patientName: patient.name,
              roomNumber: patient.roomNumber,
              startTime: session.startTime,
              therapistId: session.therapistId,
            } : null;
          })
          .filter((row): row is NonNullable<typeof row> => row !== null)
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

        // "Staff" in the huddle means who's actually working today, not the full roster size.
        // Grounded in real assigned sessions (a distinct-id set, so no one is ever double-counted)
        // rather than each therapist's standing shift template -- PRN staff have no configured
        // workDays by design (their availability isn't a fixed weekly pattern), and treating an
        // unset schedule as "available every day" would count every PRN staffer on every day.
        const absentTherapistIds = new Set(absences.map((absence) => absence.therapistId));
        const workingTherapistIds = new Set(
          treatment
            .map((session) => session.therapistId)
            .filter((therapistId): therapistId is number => therapistId != null && !absentTherapistIds.has(therapistId)),
        );
        const workingToday = workingTherapistIds.size;

        return {
          team: null,
          accessMode: canManageSchedule(scope.role) ? "all" : scope.role === "staff" ? "chart_own" : "view_all",
          therapistId: scope.therapistId,
          metrics: {
            teamMembers: workingToday,
            absent: absences.length,
            sessions: treatment.length,
            completed: treatment.filter((session) => session.status === "completed").length,
            remaining: treatment.filter((session) => session.status === "scheduled").length,
            missed: treatment.filter((session) => session.status.startsWith("missed_")).length,
            unassigned: treatment.filter((session) => session.therapistId == null).length,
            myRemaining: ownSessions.filter((session) => session.status === "scheduled").length,
            myCompleted: ownSessions.filter((session) => session.status === "completed").length,
            myMissed: ownSessions.filter((session) => session.status.startsWith("missed_")).length,
          },
          nextTeamSessions: outstanding.slice(0, 5),
          nextOwnSessions: outstanding
            .filter((session) => session.therapistId === scope.therapistId)
            .slice(0, 3),
        };
      }),
  }),

  messageBoard: router({
    list: protectedProcedure.query(({ ctx }) => listStaffMessages(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({
        title: z.string().trim().min(2).max(100),
        body: z.string().trim().min(2).max(1200),
        channel: messageChannelEnum,
        priority: messagePriorityEnum,
        requiresAcknowledgement: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const message = await createStaffMessage({
          authorUserId: ctx.user.id,
          title: input.title,
          body: input.body,
          channel: input.channel,
          priority: input.priority,
          // An urgent signal is a broadcast, not a passive post. Every account must
          // explicitly acknowledge it before the alert leaves their screen.
          requiresAcknowledgement: input.priority === "urgent" ? true : input.requiresAcknowledgement ?? false,
        });
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "message.create",
          targetType: "staff_message",
          targetId: message ? String(message.id) : null,
          metadata: { channel: input.channel, priority: input.priority },
        });
        return message;
      }),
    acknowledge: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const message = await getStaffMessage(input.id);
        if (!message || message.archivedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
        await acknowledgeStaffMessage(input.id, ctx.user.id);
        return { success: true } as const;
      }),
    resolve: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), resolved: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const message = await getStaffMessage(input.id);
        if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
        if (message.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the author or an admin can resolve this message." });
        }
        await resolveStaffMessage(input.id, ctx.user.id, input.resolved);
        return { success: true } as const;
      }),
    archive: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const message = await getStaffMessage(input.id);
        if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
        if (message.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the author or an admin can archive this message." });
        }
        await archiveStaffMessage(input.id);
        return { success: true } as const;
      }),
    pin: adminProcedure
      .input(z.object({ id: z.number().int().positive(), pinned: z.boolean() }))
      .mutation(async ({ input }) => {
        await pinStaffMessage(input.id, input.pinned);
        return { success: true } as const;
      }),
  }),

  directMessages: router({
    directory: protectedProcedure.query(({ ctx }) => listDirectMessageDirectory(ctx.user.id)),
    threads: protectedProcedure.query(({ ctx }) => listDirectMessageThreads(ctx.user.id)),
    conversation: protectedProcedure
      .input(z.object({ peerUserId: z.number().int().positive() }))
      .query(({ input, ctx }) => {
        if (input.peerUserId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose another staff member." });
        return listDirectConversation(ctx.user.id, input.peerUserId);
      }),
    send: protectedProcedure
      .input(z.object({ recipientUserId: z.number().int().positive(), body: z.string().trim().min(1).max(1200) }))
      .mutation(async ({ input, ctx }) => {
        if (input.recipientUserId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot message yourself." });
        const message = await createDirectMessage({
          senderUserId: ctx.user.id,
          recipientUserId: input.recipientUserId,
          body: input.body,
        });
        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "direct_message.send",
          targetType: "user",
          targetId: String(input.recipientUserId),
          metadata: { messageId: message.id },
        });
        return message;
      }),
    markRead: protectedProcedure
      .input(z.object({ peerUserId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        await markDirectConversationRead(ctx.user.id, input.peerUserId);
        return { success: true } as const;
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* Clinical documentation -- treatment notes, goals, Section GG scoring */
  /* ------------------------------------------------------------------ */
  charting: router({
    /** Fired when a chart is opened, not when it's just fetched in the bulk board list -- a
     *  HIPAA-style "who looked at this patient" trail, separate from the admin audit log. */
    logView: protectedProcedure
      .input(z.object({ patientId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
        await logPatientChartAccess(input.patientId, ctx.user.id);
        return { success: true } as const;
      }),
    accessLog: adminProcedure
      .input(z.object({ patientId: z.number() }))
      .query(({ input }) => getPatientChartAccessLog(input.patientId)),

    /** Internal reference-set review only, not official CMS completeness or quality measures. */
    ggCompleteness: schedulerProcedure
      .input(z.object({ referenceDate: z.date().optional() }).optional())
      .query(({ input }) => getGGCompletenessReport(input?.referenceDate ?? new Date())),
    ggTrend: schedulerProcedure.query(() => getGGTrendReport()),
    ggScoringConsistency: schedulerProcedure.query(() => getGGScoringConsistencyReport()),

    notes: router({
      list: protectedProcedure
        .input(z.object({ patientId: z.number() }))
        .query(async ({ input, ctx }) => {
          await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
          return getTreatmentNotesForPatient(input.patientId);
        }),
      create: staffProcedure
        .input(z.object({
          sessionId: z.number(),
          patientId: z.number(),
          subjective: z.string().trim().max(4000).optional(),
          objective: z.string().trim().max(4000).optional(),
          assessment: z.string().trim().max(4000).optional(),
          plan: z.string().trim().max(4000).optional(),
          isAddendum: z.boolean().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
          const scope = await resolveAccessScope(ctx.user);
          await assertPatientInScope(scope, input.patientId);
          const session = await getSessionById(input.sessionId);
          if (!session || session.patientId !== input.patientId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "That session doesn't belong to this patient." });
          }
          if (scope.role !== "admin" && session.therapistId !== scope.therapistId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only document sessions assigned to you." });
          }
          const therapistId = scope.role === "admin" ? session.therapistId : scope.therapistId;
          if (therapistId == null) throw new TRPCError({ code: "BAD_REQUEST", message: "This session has no assigned therapist to chart as." });
          const result = await createTreatmentNote({
            sessionId: input.sessionId,
            patientId: input.patientId,
            therapistId,
            subjective: input.subjective || null,
            objective: input.objective || null,
            assessment: input.assessment || null,
            plan: input.plan || null,
            isAddendum: input.isAddendum ?? false,
          });
          await logAudit({
            actorUserId: ctx.user.id, actorEmail: ctx.user.email,
            action: "treatment_note.create", targetType: "patient", targetId: String(input.patientId),
            metadata: { noteId: result.id, sessionId: input.sessionId },
          });
          return result;
        }),
      update: staffProcedure
        .input(z.object({
          id: z.number(),
          subjective: z.string().trim().max(4000).optional(),
          objective: z.string().trim().max(4000).optional(),
          assessment: z.string().trim().max(4000).optional(),
          plan: z.string().trim().max(4000).optional(),
        }))
        .mutation(async ({ input, ctx }) => {
          const { id, ...data } = input;
          const note = await getTreatmentNoteById(id);
          if (!note) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
          const scope = await resolveAccessScope(ctx.user);
          if (scope.role !== "admin" && note.therapistId !== scope.therapistId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own notes." });
          }
          if (note.signedAt) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This note is signed and locked. Add an addendum instead." });
          }
          await updateTreatmentNote(id, data);
          await logAudit({ actorUserId: ctx.user.id, actorEmail: ctx.user.email, action: "treatment_note.update", targetType: "patient", targetId: String(note.patientId), metadata: { noteId: id, fields: Object.keys(data) } });
          return { success: true } as const;
        }),
      sign: staffProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input, ctx }) => {
          const note = await getTreatmentNoteById(input.id);
          if (!note) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
          const scope = await resolveAccessScope(ctx.user);
          if (scope.role !== "admin" && note.therapistId !== scope.therapistId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only sign your own notes." });
          }
          await signTreatmentNote(input.id, ctx.user.id);
          await logAudit({
            actorUserId: ctx.user.id, actorEmail: ctx.user.email,
            action: "treatment_note.sign", targetType: "patient", targetId: String(note.patientId),
            metadata: { noteId: input.id },
          });
          return { success: true } as const;
        }),
    }),

    goals: router({
      list: protectedProcedure
        .input(z.object({ patientId: z.number(), includeArchived: z.boolean().optional() }))
        .query(async ({ input, ctx }) => {
          await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
          return getPatientGoals(input.patientId, input.includeArchived ?? false);
        }),
      create: staffProcedure
        .input(z.object({
          patientId: z.number(),
          therapyType: therapyTypeEnum,
          termType: z.enum(["long_term", "short_term"]),
          description: z.string().trim().min(1).max(500),
          baselineValue: z.string().trim().max(120).optional(),
          targetValue: z.string().trim().max(120).optional(),
          targetDate: z.string().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
          await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
          const result = await createPatientGoal({
            patientId: input.patientId,
            therapyType: input.therapyType as "PT" | "OT" | "SLP",
            termType: input.termType,
            description: input.description,
            baselineValue: input.baselineValue || null,
            targetValue: input.targetValue || null,
            targetDate: input.targetDate || null,
            createdByUserId: ctx.user.id,
          });
          return result;
        }),
      update: staffProcedure
        .input(z.object({
          id: z.number(),
          patientId: z.number(),
          currentValue: z.string().trim().max(120).optional(),
          status: z.enum(["not_started", "in_progress", "met", "discontinued"]).optional(),
          description: z.string().trim().min(1).max(500).optional(),
          targetValue: z.string().trim().max(120).optional(),
          targetDate: z.string().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
          const { id, patientId, ...data } = input;
          await assertPatientInScope(await resolveAccessScope(ctx.user), patientId);
          const goal = await getPatientGoalById(id);
          if (!goal || goal.patientId !== patientId) throw new TRPCError({ code: "NOT_FOUND", message: "Goal not found for this patient" });
          await updatePatientGoal(id, data);
          await logAudit({ actorUserId: ctx.user.id, actorEmail: ctx.user.email, action: "patient_goal.update", targetType: "patient", targetId: String(goal.patientId), metadata: { goalId: id, fields: Object.keys(data) } });
          return { success: true } as const;
        }),
      archive: staffProcedure
        .input(z.object({ id: z.number(), patientId: z.number() }))
        .mutation(async ({ input, ctx }) => {
          await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
          const goal = await getPatientGoalById(input.id);
          if (!goal || goal.patientId !== input.patientId) throw new TRPCError({ code: "NOT_FOUND", message: "Goal not found for this patient" });
          await archivePatientGoal(input.id);
          await logAudit({ actorUserId: ctx.user.id, actorEmail: ctx.user.email, action: "patient_goal.archive", targetType: "patient", targetId: String(goal.patientId), metadata: { goalId: input.id } });
          return { success: true } as const;
        }),
    }),

    functionalAssessments: router({
      list: protectedProcedure
        .input(z.object({ patientId: z.number() }))
        .query(async ({ input, ctx }) => {
          await assertPatientInScope(await resolveAccessScope(ctx.user), input.patientId);
          return getFunctionalAssessmentsForPatient(input.patientId);
        }),
      create: staffProcedure
        .input(z.object({
          patientId: z.number(),
          assessmentType: z.enum(["admission", "interim", "discharge"]),
          assessmentDate: assessmentDateSchema,
          itemScores: ggScoresSchema,
        }))
        .mutation(async ({ input, ctx }) => {
          const scope = await resolveAccessScope(ctx.user);
          await assertPatientInScope(scope, input.patientId);
          const result = await createFunctionalAssessment({
            patientId: input.patientId,
            assessmentType: input.assessmentType,
            assessmentDate: input.assessmentDate,
            itemScores: input.itemScores,
            completedByTherapistId: scope.role === "admin" ? null : scope.therapistId,
          });
          await logAudit({
            actorUserId: ctx.user.id, actorEmail: ctx.user.email,
            action: "functional_assessment.create", targetType: "patient", targetId: String(input.patientId),
            metadata: { assessmentId: result.id, assessmentType: input.assessmentType },
          });
          return result;
        }),
      update: staffProcedure
        .input(z.object({
          id: z.number(),
          patientId: z.number(),
          itemScores: ggScoresSchema.optional(),
          assessmentDate: assessmentDateSchema.optional(),
        }))
        .mutation(async ({ input, ctx }) => {
          const { id, patientId, ...data } = input;
          const assessment = await getFunctionalAssessmentById(id);
          if (!assessment || assessment.patientId !== patientId) throw new TRPCError({ code: "NOT_FOUND", message: "Assessment not found for this patient" });
          const scope = await resolveAccessScope(ctx.user);
          await assertPatientInScope(scope, assessment.patientId);
          if (scope.role !== "admin" && assessment.completedByTherapistId !== scope.therapistId) throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own assessments." });
          if (assessment.signedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Signed assessments are locked. Create a new assessment for corrections." });
          await updateFunctionalAssessment(id, data, assessment.patientId);
          await logAudit({ actorUserId: ctx.user.id, actorEmail: ctx.user.email, action: "functional_assessment.update", targetType: "patient", targetId: String(assessment.patientId), metadata: { assessmentId: id, before: assessment.itemScores, after: data.itemScores ?? assessment.itemScores } });
          return { success: true } as const;
        }),
      sign: staffProcedure
        .input(z.object({ id: z.number(), patientId: z.number() }))
        .mutation(async ({ input, ctx }) => {
          const assessment = await getFunctionalAssessmentById(input.id);
          if (!assessment || assessment.patientId !== input.patientId) throw new TRPCError({ code: "NOT_FOUND", message: "Assessment not found for this patient" });
          const scope = await resolveAccessScope(ctx.user);
          await assertPatientInScope(scope, assessment.patientId);
          if (scope.role !== "admin" && assessment.completedByTherapistId !== scope.therapistId) throw new TRPCError({ code: "FORBIDDEN", message: "You can only sign your own assessments." });
          if (assessment.signedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "This assessment is already signed." });
          if (!assessmentProgress(assessment.itemScores as Record<string, number>).complete) throw new TRPCError({ code: "BAD_REQUEST", message: "Complete every reference item or specify why it was not attempted before signing." });
          await signFunctionalAssessment(input.id, ctx.user.id, assessment.patientId, assessment);
          await logAudit({ actorUserId: ctx.user.id, actorEmail: ctx.user.email, action: "functional_assessment.sign", targetType: "patient", targetId: String(assessment.patientId), metadata: { assessmentId: assessment.id } });
          return { success: true } as const;
        }),
    }),
  }),

  /* ------------------------------------------------------------------ */
  /* Therapist self-scheduling requests (PTO / shift swap)                */
  /* ------------------------------------------------------------------ */
  scheduleRequests: router({
    /** Staff/viewer see only their own requests; a team lead sees their whole team's queue;
     *  an admin sees everything. */
    list: protectedProcedure
      .input(z.object({ status: z.enum(["pending", "approved", "denied", "canceled"]).optional() }).optional())
      .query(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        if (scope.role === "admin") return listScheduleChangeRequests({ status: input?.status });
        requireLinkedScope(scope);
        if (scope.role === "team_lead") {
          return listScheduleChangeRequests({ teamIds: scope.teamId != null ? [scope.teamId] : [], status: input?.status });
        }
        return listScheduleChangeRequests({ therapistId: scope.therapistId ?? undefined, status: input?.status });
      }),
    create: staffProcedure
      .input(z.object({
        requestType: z.enum(["pto", "shift_swap"]),
        startDate: z.string(),
        endDate: z.string(),
        swapWithTherapistId: z.number().optional(),
        reason: z.string().trim().max(500).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        requireLinkedScope(scope);
        if (scope.therapistId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Your account isn't linked to a staff profile." });
        }
        const result = await createScheduleChangeRequest({
          therapistId: scope.therapistId,
          requestType: input.requestType,
          startDate: input.startDate,
          endDate: input.endDate,
          swapWithTherapistId: input.swapWithTherapistId ?? null,
          reason: input.reason || null,
        });
        return result;
      }),
    cancel: staffProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        const request = await getScheduleChangeRequestById(input.id);
        if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
        if (scope.role !== "admin" && request.therapistId !== scope.therapistId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only cancel your own request." });
        }
        await cancelScheduleChangeRequest(input.id);
        return { success: true } as const;
      }),
    /** Approving a PTO request marks the therapist absent for each day in range, reusing the
     *  same call-off path a scheduler would use manually (so reassignment/notification logic
     *  stays in one place). A shift-swap approval is recorded but not auto-applied -- the actual
     *  reassignment still happens on the board. */
    review: schedulerProcedure
      .input(z.object({ id: z.number(), decision: z.enum(["approved", "denied"]), note: z.string().trim().max(500).optional() }))
      .mutation(async ({ input, ctx }) => {
        const scope = await resolveAccessScope(ctx.user);
        const request = await getScheduleChangeRequestById(input.id);
        if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
        if (request.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This request has already been reviewed." });
        }
        if (scope.role !== "admin") {
          requireLinkedScope(scope);
          const requester = (await getTherapists()).find((t) => t.id === request.therapistId);
          if (!requester || requester.teamId !== scope.teamId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only review requests from your own team." });
          }
        }
        await reviewScheduleChangeRequest(input.id, input.decision, ctx.user.id, input.note);

        let callOffDays: { date: string; ok: boolean }[] | undefined;
        if (input.decision === "approved" && request.requestType === "pto") {
          callOffDays = [];
          const cursor = new Date(request.startDate);
          const end = new Date(request.endDate);
          while (cursor <= end) {
            try {
              await callOffTherapist(request.therapistId, new Date(cursor), "Approved PTO");
              callOffDays.push({ date: cursor.toISOString().slice(0, 10), ok: true });
            } catch {
              callOffDays.push({ date: cursor.toISOString().slice(0, 10), ok: false });
            }
            cursor.setDate(cursor.getDate() + 1);
          }
        }

        await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: `schedule_request.${input.decision}`,
          targetType: "therapist",
          targetId: String(request.therapistId),
          metadata: { requestId: input.id, callOffDays },
        });
        return { success: true, callOffDays } as const;
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* AI scheduling assistant (free, self-hosted via Ollama)               */
  /* ------------------------------------------------------------------ */
  ai: router({
    proposals: adminProcedure.query(({ ctx }) => listAiProposals(ctx.user.id)),
    approve: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input, ctx }) => approveAiProposal(input.id, ctx.user, executeTool)),
    dismiss: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input, ctx }) => dismissAiProposal(input.id, ctx.user.id)),
    undo: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input, ctx }) => undoAiProposal(input.id, ctx.user)),
    ask: adminProcedure
      .input(
        z.object({
          question: z.string().trim().min(1).max(2000),
          referenceDate: z.date().optional(),
          history: z.array(z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(12000),
          })).max(12).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) =>
        askScheduler(input.question, input.referenceDate ?? new Date(), input.history ?? [], ctx.user),
      ),
    analyzeData: adminProcedure
      .input(
        z.object({
          question: z.string().trim().min(1).max(2000),
          contextData: z.string().max(250000),
          referenceDate: z.date().optional(),
          history: z.array(z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(12000),
          })).max(12).optional(),
        }),
      )
      .mutation(async ({ input }) =>
        analyzeData(input.question, input.contextData, input.referenceDate ?? new Date(), input.history ?? []),
      ),
  }),
  /* ------------------------------------------------------------------ */
  /* AI Clinical Agents Suite                                           */
  /* ------------------------------------------------------------------ */
  aiAgents: router({
    previewSickCallTriage: schedulerProcedure
      .input(z.object({ therapistId: z.number(), date: z.date(), includePRN: z.boolean().optional() }))
      .query(async ({ input, ctx }) => {
        await assertTherapistWriteAccess(await resolveAccessScope(ctx.user), input.therapistId);
        return previewSickCallPriorityTriage(input.therapistId, input.date, input.includePRN ?? true);
      }),
    rebalanceSickCall: schedulerProcedure
      .input(
        z.object({
          therapistId: z.number(),
          date: z.date(),
          customPriorityOrder: z.array(z.number()).optional(),
          includePRN: z.boolean().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await assertTherapistWriteAccess(await resolveAccessScope(ctx.user), input.therapistId);
        const { undoAssignments, ...result } = await rebalanceTherapistAbsence(input.therapistId, input.date, input.customPriorityOrder, input.includePRN ?? true);
        const undoAuditId = await logAudit({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "attendance.call_off_coverage",
          targetType: "therapist",
          targetId: String(input.therapistId),
          metadata: {
            therapistId: input.therapistId,
            date: input.date.toISOString(),
            includePRN: input.includePRN ?? true,
            reassigned: result.reassignedCount,
            unassigned: result.unassignedCount,
            undoAssignments,
          },
        });
        return { ...result, undoAuditId };
      }),
    getComplianceReport: adminProcedure
      .input(z.object({ referenceDate: z.date().optional() }).optional())
      .query(async ({ input }) => getComplianceSentinelReport(input?.referenceDate ?? new Date())),
    getPredictiveForecast: adminProcedure
      .input(z.object({ date: z.date() }))
      .query(async ({ input }) => getPredictiveForecast(input.date)),
  }),
});

export type AppRouter = typeof appRouter;
