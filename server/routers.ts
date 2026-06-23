import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import {
  getPatients,
  getPatientById,
  createPatient,
  updatePatient,
  deletePatient,
  getTherapySessions,
  getTherapySessionsForWeek,
  getTherapySessionsForDateRange,
  createTherapySession,
  updateTherapySession,
  deleteTherapySession,
  getTherapists,
  createTherapist,
  updateTherapist,
  deleteTherapist,
  getTeams,
  createTeam,
  getStatusFlagsForDate,
  createStatusFlag,
  deleteStatusFlag,
  deleteStatusFlagByPatientAndType,
  getBoardHistory,
  getSnapshotForDate,
  saveBoardSnapshot,
  seedTeamsIfEmpty,
} from "./db";
import { getWeeklyMinutesSummary, getGapFillSuggestions } from "./scheduling";
import { askScheduler } from "./ollama";

const therapyTypeEnum = z.enum(["PT", "OT", "SLP", "Eval"]);
const flagTypeEnum = z.enum(["DC", "Name Alert", "Weekend", "In-Service", "Appointment"]);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  /* ------------------------------------------------------------------ */
  /* Patients                                                            */
  /* ------------------------------------------------------------------ */
  patients: router({
    list: publicProcedure.query(async () => getPatients()),
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => getPatientById(input.id)),
    create: publicProcedure
      .input(
        z.object({
          roomNumber: z.string().min(1),
          name: z.string().min(1),
          notes: z.string().optional(),
          isDischarged: z.boolean().optional(),
          admissionDate: z.string().optional(),
          weeklyMinuteTarget: z.number().optional(),
          teamId: z.number().nullable().optional(),
        }),
      )
      .mutation(async ({ input }) => createPatient(input)),
    update: publicProcedure
      .input(
        z.object({
          id: z.number(),
          roomNumber: z.string().optional(),
          name: z.string().optional(),
          notes: z.string().optional(),
          isDischarged: z.boolean().optional(),
          admissionDate: z.string().optional(),
          weeklyMinuteTarget: z.number().optional(),
          teamId: z.number().nullable().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updatePatient(id, data);
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => deletePatient(input.id)),
  }),

  /* ------------------------------------------------------------------ */
  /* Therapy Sessions                                                    */
  /* ------------------------------------------------------------------ */
  sessions: router({
    list: publicProcedure
      .input(z.object({ date: z.date().optional() }).optional())
      .query(async ({ input }) => getTherapySessions(input?.date)),
    listForWeek: publicProcedure
      .input(z.object({ weekStart: z.date() }))
      .query(async ({ input }) => getTherapySessionsForWeek(input.weekStart)),
    listForDateRange: publicProcedure
      .input(z.object({ startDate: z.date(), endDate: z.date() }))
      .query(async ({ input }) => getTherapySessionsForDateRange(input.startDate, input.endDate)),
    create: publicProcedure
      .input(
        z.object({
          patientId: z.number(),
          therapyType: therapyTypeEnum,
          startTime: z.date(),
          endTime: z.date(),
          durationMinutes: z.number().positive(),
          therapistId: z.number().nullable().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) =>
        createTherapySession({
          ...input,
          therapistId: input.therapistId ?? null,
        }),
      ),
    update: publicProcedure
      .input(
        z.object({
          id: z.number(),
          patientId: z.number().optional(),
          therapyType: therapyTypeEnum.optional(),
          startTime: z.date().optional(),
          endTime: z.date().optional(),
          durationMinutes: z.number().optional(),
          therapistId: z.number().nullable().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateTherapySession(id, data);
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => deleteTherapySession(input.id)),
  }),

  /* ------------------------------------------------------------------ */
  /* Therapists                                                          */
  /* ------------------------------------------------------------------ */
  therapists: router({
    list: publicProcedure.query(async () => getTherapists()),
    create: publicProcedure
      .input(
        z.object({
          name: z.string().min(1),
          teamId: z.number().nullable().optional(),
          userId: z.number().nullable().optional(),
        }),
      )
      .mutation(async ({ input }) =>
        createTherapist({
          name: input.name,
          teamId: input.teamId ?? null,
          userId: input.userId ?? null,
        }),
      ),
    update: publicProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().optional(),
          teamId: z.number().nullable().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateTherapist(id, data);
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => deleteTherapist(input.id)),
  }),

  /* ------------------------------------------------------------------ */
  /* Teams                                                               */
  /* ------------------------------------------------------------------ */
  teams: router({
    list: publicProcedure.query(async () => {
      const ts = await getTeams();
      console.log("[DEBUG] Teams list fetched:", ts);
      return ts;
    }),
    create: publicProcedure
      .input(z.object({ name: z.string().min(1), color: z.string().optional() }))
      .mutation(async ({ input }) =>
        createTeam({ name: input.name, color: input.color ?? "#6366f1" }),
      ),
    seed: publicProcedure.mutation(async () => {
      await seedTeamsIfEmpty();
      return { success: true };
    }),
  }),

  /* ------------------------------------------------------------------ */
  /* Status Flags                                                        */
  /* ------------------------------------------------------------------ */
  statusFlags: router({
    listForDate: publicProcedure
      .input(z.object({ date: z.date() }))
      .query(async ({ input }) => getStatusFlagsForDate(input.date)),
    create: publicProcedure
      .input(
        z.object({
          patientId: z.number(),
          flagType: flagTypeEnum,
          date: z.date(),
        }),
      )
      .mutation(async ({ input }) => createStatusFlag(input)),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => deleteStatusFlag(input.id)),
    toggle: publicProcedure
      .input(
        z.object({
          patientId: z.number(),
          flagType: flagTypeEnum,
          date: z.date(),
          active: z.boolean(),
        }),
      )
      .mutation(async ({ input }) => {
        if (input.active) {
          return createStatusFlag({
            patientId: input.patientId,
            flagType: input.flagType,
            date: input.date,
          });
        }
        return deleteStatusFlagByPatientAndType(input.patientId, input.flagType, input.date);
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* Board History (daily snapshots)                                     */
  /* ------------------------------------------------------------------ */
  history: router({
    list: publicProcedure.query(async () => getBoardHistory()),
    getForDate: publicProcedure
      .input(z.object({ date: z.date() }))
      .query(async ({ input }) => getSnapshotForDate(input.date)),
    save: publicProcedure
      .input(z.object({ date: z.date(), snapshot: z.any() }))
      .mutation(async ({ input }) => saveBoardSnapshot(input.date, input.snapshot)),
  }),

  /* ------------------------------------------------------------------ */
  /* Weekly Minutes & Gap Fill                                           */
  /* ------------------------------------------------------------------ */
  weeklyMinutes: router({
    summary: publicProcedure
      .input(z.object({ referenceDate: z.date().optional() }).optional())
      .query(async ({ input }) => getWeeklyMinutesSummary(input?.referenceDate ?? new Date())),
  }),

  gapFill: router({
    suggestions: publicProcedure
      .input(z.object({ patientId: z.number(), referenceDate: z.date().optional() }))
      .query(async ({ input }) => getGapFillSuggestions(input.patientId, input.referenceDate ?? new Date())),
  }),

  /* ------------------------------------------------------------------ */
  /* AI scheduling assistant (free, self-hosted via Ollama)               */
  /* ------------------------------------------------------------------ */
  ai: router({
    ask: publicProcedure
      .input(z.object({ question: z.string().min(1), referenceDate: z.date().optional() }))
      .mutation(async ({ input }) => askScheduler(input.question, input.referenceDate ?? new Date())),
  }),
});

export type AppRouter = typeof appRouter;
