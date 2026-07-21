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
  RoomConflictError,
} from "./db";
import { getWeeklyMinutesSummary, getGapFillSuggestions, getOrCreateTodaysDigest, getPredictiveForecast } from "./scheduling";
import { askScheduler, analyzeData } from "./ollama";

const therapyTypeEnum = z.enum(["PT", "OT", "SLP", "Eval", "Block"]);
const flagTypeEnum = z.enum(["DC", "Name Alert", "Weekend", "In-Service", "Appointment", "Stroke Program", "Shower", "Medical Hold", "Dialysis", "Block Time", "Group Appropriate", "Male Therapist Only", "Female Therapist Only", "Home Eval", "Family Training"]);
const sessionStatusEnum = z.enum(["scheduled", "completed", "missed_refusal", "missed_clinical_hold", "missed_staffing", "missed_other"]);
const deliveryModeEnum = z.enum(["individual", "concurrent", "group"]);

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
  /* Attendance                                                         */
  /* ------------------------------------------------------------------ */
  attendance: router({
    getAbsences: publicProcedure
      .input(z.object({ date: z.date() }))
      .query(async ({ input }) => {
        return getTherapistAbsences(input.date);
      }),
    callOff: publicProcedure
      .input(z.object({ therapistId: z.number(), date: z.date(), reason: z.string().optional() }))
      .mutation(async ({ input }) => {
        return callOffTherapist(input.therapistId, input.date, input.reason);
      }),
    cancelCallOff: publicProcedure
      .input(z.object({ therapistId: z.number(), date: z.date() }))
      .mutation(async ({ input }) => {
        return cancelCallOffTherapist(input.therapistId, input.date);
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* Analytics / Planning                                               */
  /* ------------------------------------------------------------------ */
  forecast: publicProcedure
    .input(z.object({ date: z.date() }))
    .query(async ({ input }) => {
      return getPredictiveForecast(input.date);
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
          estimatedDischargeDate: z.string().optional(),
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
          estimatedDischargeDate: z.string().optional(),
          weeklyMinuteTarget: z.number().optional(),
          teamId: z.number().nullable().optional(),
          orderIndex: z.number().optional(),
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
          actualDurationMinutes: z.number().positive().optional(),
          deliveryMode: deliveryModeEnum.optional(),
          therapistId: z.number().nullable().optional(),
          notes: z.string().optional(),
          status: sessionStatusEnum.optional(),
          missedReason: z.string().optional(),
          ignoreConflicts: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input }) =>
        createTherapySession({
          ...input,
          therapistId: input.therapistId ?? null,
        }, input.ignoreConflicts),
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
          actualDurationMinutes: z.number().positive().optional(),
          deliveryMode: deliveryModeEnum.optional(),
          therapistId: z.number().nullable().optional(),
          notes: z.string().optional(),
          status: sessionStatusEnum.optional(),
          missedReason: z.string().optional(),
          ignoreConflicts: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ignoreConflicts, ...data } = input;
        return updateTherapySession(id, data, ignoreConflicts);
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => deleteTherapySession(input.id)),
    copyDayToNextDay: publicProcedure
      .input(z.object({ date: z.date() }))
      .mutation(async ({ input }) => copyDayToNextDay(input.date)),
    copyPatientSessionsToNextDay: publicProcedure
      .input(z.object({ patientId: z.number(), date: z.date() }))
      .mutation(async ({ input }) => copyPatientSessionsToNextDay(input.patientId, input.date)),
    movePatientSessionsToNextDay: publicProcedure
      .input(z.object({ patientId: z.number(), date: z.date() }))
      .mutation(async ({ input }) => movePatientSessionsToNextDay(input.patientId, input.date)),
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
          therapyType: z.enum(["PT", "OT", "SLP"]).optional(),
          // Working hours for auto-placement. workDays is 0=Sun..6=Sat; null/omitted on any
          // of the three means "no restriction" for that dimension.
          workDays: z.array(z.number().min(0).max(6)).nullable().optional(),
          workStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
          workEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const therapists = await getTherapists();
        const hue = Math.floor((therapists.length * 137.5) % 360).toString();
        return createTherapist({
          name: input.name,
          teamId: input.teamId ?? null,
          userId: input.userId ?? null,
          color: hue,
          therapyType: input.therapyType ?? "PT",
          workDays: input.workDays ? input.workDays.join(",") : null,
          workStartTime: input.workStartTime ?? null,
          workEndTime: input.workEndTime ?? null,
        });
      }),
    update: publicProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().optional(),
          teamId: z.number().nullable().optional(),
          therapyType: z.enum(["PT", "OT", "SLP"]).optional(),
          workDays: z.array(z.number().min(0).max(6)).nullable().optional(),
          workStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
          workEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, workDays, ...rest } = input;
        return updateTherapist(id, {
          ...rest,
          ...(workDays !== undefined ? { workDays: workDays ? workDays.join(",") : null } : {}),
        });
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => deleteTherapist(input.id)),
  }),

  /* ------------------------------------------------------------------ */
  /* Teams                                                               */
  /* ------------------------------------------------------------------ */
  teams: router({
    list: publicProcedure.query(async () => getTeams()),
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
        const flag = await setStatusFlag(input.patientId, input.flagType, input.date, input.active);
        let roomConflict: { roomNumber: string; occupiedByName: string } | null = null;

        // Only fire the DC side effects when the flag actually flips -- not on a redundant
        // toggle of a flag that (thanks to carry-forward) was already active/inactive.
        if (input.flagType === "DC" && flag.changed) {
          if (input.active) {
            const previousPatient = await getPatientById(input.patientId);
            if (previousPatient && !previousPatient.isDischarged) {
              await updatePatient(input.patientId, { isDischarged: true });
              await createPatient({
                roomNumber: previousPatient.roomNumber,
                name: "Available",
                notes: "",
                isDischarged: false,
                weeklyMinuteTarget: 900,
                teamId: previousPatient.teamId ?? null,
              });
            }
          } else {
            // Readmission: taking a patient off DC status. Their old room may have already been
            // handed to whoever's in it now (via the "Available" placeholder above, or a
            // straightforward re-assignment) -- reactivating them into a room someone else
            // already occupies would silently create the exact duplicate-room state this guards
            // against. Leave them on DC status and report the conflict back instead; the client
            // opens the edit-patient dialog so staff can pick a real open room right away.
            try {
              await updatePatient(input.patientId, { isDischarged: false });
            } catch (err) {
              if (err instanceof RoomConflictError) {
                roomConflict = { roomNumber: err.roomNumber, occupiedByName: err.occupiedByName };
              } else {
                throw err;
              }
            }
          }
        }

        return { ...flag, roomConflict };
      }),
  }),

  /* ------------------------------------------------------------------ */
  /* Additional Minutes                                                  */
  /* ------------------------------------------------------------------ */
  additionalMinutes: router({
    listByPatient: publicProcedure
      .input(z.object({ patientId: z.number() }))
      .query(async ({ input }) => getAdditionalMinutesForPatient(input.patientId)),
    create: publicProcedure
      .input(
        z.object({
          patientId: z.number(),
          date: z.date(),
          additionalMinutes: z.number(),
          reason: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => createAdditionalMinutes(input)),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => deleteAdditionalMinutes(input.id)),
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
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => deleteBoardSnapshot(input.id)),
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
  /* Morning gap-fill digest -- generated automatically (see              */
  /* _core/digestScheduler.ts); this query is also the lazy-fallback path */
  /* that guarantees it exists even if the server was cold this morning.  */
  /* ------------------------------------------------------------------ */
  digest: router({
    today: publicProcedure
      .input(z.object({ referenceDate: z.date().optional() }).optional())
      .query(async ({ input }) => getOrCreateTodaysDigest(input?.referenceDate ?? new Date())),
  }),

  /* ------------------------------------------------------------------ */
  /* AI scheduling assistant (free, self-hosted via Ollama)               */
  /* ------------------------------------------------------------------ */
  ai: router({
    ask: publicProcedure
      .input(
        z.object({
          question: z.string().min(1),
          referenceDate: z.date().optional(),
          history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
        }),
      )
      .mutation(async ({ input }) =>
        askScheduler(input.question, input.referenceDate ?? new Date(), input.history ?? []),
      ),
    analyzeData: publicProcedure
      .input(
        z.object({
          question: z.string().min(1),
          contextData: z.string(),
          referenceDate: z.date().optional(),
          history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
        }),
      )
      .mutation(async ({ input }) =>
        analyzeData(input.question, input.contextData, input.referenceDate ?? new Date(), input.history ?? []),
      ),
  }),
});

export type AppRouter = typeof appRouter;
