import { integer, sqliteTable, text, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  openId: text("openId").notNull().unique(),
  name: text("name"),
  email: text("email"),
  loginMethod: text("loginMethod"),
  role: text("role", { enum: ["user", "admin"] }).default("user").notNull(),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
  lastSignedIn: integer("lastSignedIn", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").default("#6366f1").notNull(),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type Team = typeof teams.$inferSelect;
export type InsertTeam = typeof teams.$inferInsert;

export const therapists = sqliteTable("therapists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("userId"),
  name: text("name").notNull(),
  email: text("email"), // Used to send next-day assignment notifications
  color: text("color").notNull().default("#3b82f6"), // Default to a blue
  therapyType: text("therapyType", { enum: ["PT", "OT", "SLP"] }).notNull().default("PT"),
  teamId: integer("teamId"),
  // Working hours, used to keep auto-placement/gap-fill from suggesting a therapist outside
  // their actual shift. All three are nullable -- null means "no restriction" (available every
  // day, full board hours), so existing staff with nothing set behave exactly as before this
  // feature existed. workDays is a comma-separated list of JS Date#getDay() values (0=Sun..6=Sat).
  workDays: text("workDays"),
  workStartTime: text("workStartTime"), // "HH:MM", 24-hour
  workEndTime: text("workEndTime"), // "HH:MM", 24-hour
  workHours: text("workHours"), // JSON string representing per-day availability schedules {"0":{"active":bool,"start":"HH:MM","end":"HH:MM"},...}
  // PRN/per-diem staff -- their availability isn't guaranteed the way regular staff's is, so
  // PAMi's risk-tier logic (server/riskAssessment.ts) requires human confirmation before writing
  // to their schedule, even for an action that would otherwise auto-execute. Kept in sync with
  // employmentType ("prn" <-> true) by the therapists.create/update routers so older isPRN-based
  // risk logic keeps working unchanged.
  isPRN: integer("isPRN", { mode: "boolean" }).default(false).notNull(),
  employmentType: text("employmentType", { enum: ["full_time", "part_time", "prn"] }).notNull().default("full_time"),
  // Only meaningful for part_time/prn staff whose weekend coverage repeats on a cycle instead of
  // every week (e.g. "every other Sat+Sun", "every 3rd Friday"). JSON: { days: number[] (0=Sun..
  // 6=Sat), intervalWeeks: number, anchorDate: "YYYY-MM-DD" (any date that falls in an "on" week) }.
  // null means no rotation -- weekend eligibility falls back to workDays/workHours like any other day.
  weekendRotation: text("weekendRotation"),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type Therapist = typeof therapists.$inferSelect;
export type InsertTherapist = typeof therapists.$inferInsert;

// One-off manual assign/unassign for a specific weekend date, overriding whatever the
// rotation pattern (or plain workDays for full-time staff) would otherwise compute. Lets an
// admin hand-pick "certain staff" for a given weekend without changing their standing rotation.
export const weekendStaffingOverrides = sqliteTable("weekendStaffingOverrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  therapistId: integer("therapistId").notNull(),
  date: integer("date", { mode: "timestamp" }).notNull(),
  working: integer("working", { mode: "boolean" }).notNull(),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type WeekendStaffingOverride = typeof weekendStaffingOverrides.$inferSelect;
export type InsertWeekendStaffingOverride = typeof weekendStaffingOverrides.$inferInsert;

export const patients = sqliteTable("patients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomNumber: text("roomNumber").notNull(),
  name: text("name").notNull(),
  notes: text("notes"),
  isDischarged: integer("isDischarged", { mode: 'boolean' }).default(false).notNull(),
  admissionDate: text("admissionDate"),
  estimatedDischargeDate: text("estimatedDischargeDate"),
  weeklyMinuteTarget: integer("weeklyMinuteTarget").default(900).notNull(),
  ptTarget: integer("ptTarget"),
  otTarget: integer("otTarget"),
  slpTarget: integer("slpTarget"),
  assessmentPeriodStart: text("assessmentPeriodStart"),
  assessmentPeriodEnd: text("assessmentPeriodEnd"),
  teamId: integer("teamId"),
  orderIndex: real("orderIndex").default(0),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type Patient = typeof patients.$inferSelect;
export type InsertPatient = typeof patients.$inferInsert;

export const statusFlags = sqliteTable("statusFlags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patientId").notNull(),
  flagType: text("flagType", { enum: ["DC", "Name Alert", "Weekend", "In-Service", "Appointment", "Stroke Program", "Shower", "Medical Hold", "Dialysis", "Block Time", "Group Appropriate", "Male Therapist Only", "Female Therapist Only", "Home Eval", "Family Training", "LOA", "15/7"] }).notNull(),
  // The day this row takes effect from. A flag carries forward to every later day until a newer
  // row for the same patient+flagType is written (see setStatusFlag) -- it is not a one-day-only marker.
  date: integer("date", { mode: 'timestamp' }).notNull(),
  active: integer("active", { mode: 'boolean' }).default(true).notNull(),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type StatusFlag = typeof statusFlags.$inferSelect;
export type InsertStatusFlag = typeof statusFlags.$inferInsert;

export const therapySessions = sqliteTable("therapySessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patientId").notNull(),
  therapistId: integer("therapistId"),
  therapyType: text("therapyType", { enum: ["PT", "OT", "SLP", "Eval", "Block"] }).notNull(),
  startTime: integer("startTime", { mode: 'timestamp' }).notNull(),
  endTime: integer("endTime", { mode: 'timestamp' }).notNull(),
  durationMinutes: integer("durationMinutes").notNull(),
  actualDurationMinutes: integer("actualDurationMinutes"),
  deliveryMode: text("deliveryMode", { enum: ["individual", "concurrent", "group"] }).default("individual").notNull(),
  status: text("status", { enum: ["scheduled", "completed", "missed_refusal", "missed_clinical_hold", "missed_staffing", "missed_other"] }).default("scheduled").notNull(),
  missedReason: text("missedReason"),
  notes: text("notes"),
  // Who made this booking/edit exist in its current form -- "ai" for PAMi tool calls, "human" for
  // everything else (including a human editing a session PAMi originally created). Feeds the
  // override-learning loop in server/preferenceLearning.ts: a human edit/cancel of a still-"ai"
  // session is logged as an override (see scheduleOverrides below), then this flips to "human" so
  // later edits to the same session aren't re-logged as new overrides.
  source: text("source", { enum: ["human", "ai"] }).default("human").notNull(),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type TherapySession = typeof therapySessions.$inferSelect;
export type InsertTherapySession = typeof therapySessions.$inferInsert;

export const boardHistory = sqliteTable("boardHistory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: integer("date", { mode: 'timestamp' }).notNull(),
  snapshot: text("snapshot", { mode: 'json' }).notNull(),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type BoardHistory = typeof boardHistory.$inferSelect;
export type InsertBoardHistory = typeof boardHistory.$inferInsert;

// One row per write action PAMi (the AI scheduling assistant) takes. `undoData` holds
// whatever's needed to reverse that specific action type -- see reverseAiAction in
// server/ollama.ts for the shape per actionType. `undone` is flipped once reversed so
// undo_last_action always walks back from the most recent still-live action.
export const aiActionLog = sqliteTable("aiActionLog", {
  
  id: integer("id").primaryKey({ autoIncrement: true }),
  actionType: text("actionType", {
    enum: [
      "create_session",
      "move_session",
      "copy_session",
      "cancel_session",
      "auto_schedule_all_gaps",
      "auto_schedule_patient_gaps",
      "auto_schedule_team_gaps",
      "transfer_patient_sessions_to_next_day",
      "copy_patient_sessions_to_next_day",
      "copy_day_to_next_day",
      "clear_schedule",
    ],
  }).notNull(),
  description: text("description").notNull(),
  undoData: text("undoData", { mode: "json" }).notNull(),
  undone: integer("undone", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export type AiActionLog = typeof aiActionLog.$inferSelect;
export type InsertAiActionLog = typeof aiActionLog.$inferInsert;

export const patientAdditionalMinutes = sqliteTable("patientAdditionalMinutes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patientId").notNull(),
  date: integer("date", { mode: 'timestamp' }).notNull(),
  additionalMinutes: integer("additionalMinutes").notNull(),
  reason: text("reason"),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type PatientAdditionalMinutes = typeof patientAdditionalMinutes.$inferSelect;
export type InsertPatientAdditionalMinutes = typeof patientAdditionalMinutes.$inferInsert;

// One row per behind-target patient, per morning the gap-fill digest job ran. Persisted (not
// just recomputed on the fly) so the "ran automatically this morning" guarantee survives a
// server restart/cold-start -- see server/_core/digestScheduler.ts for why that matters on a
// host like Render that can spin an idle instance down overnight.
export const morningDigest = sqliteTable("morningDigest", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // "YYYY-MM-DD", the morning this digest is for
  patientId: integer("patientId").notNull(),
  patientName: text("patientName").notNull(),
  roomNumber: text("roomNumber").notNull(),
  remainingMinutes: integer("remainingMinutes").notNull(),
  target: integer("target").notNull(),
  atRisk: integer("atRisk", { mode: "boolean" }).notNull(),
  // Array of { startTime (ISO string), durationMinutes, therapistId, therapistName, reason }
  proposedSlots: text("proposedSlots", { mode: "json" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export type MorningDigestEntry = typeof morningDigest.$inferSelect;
export type InsertMorningDigestEntry = typeof morningDigest.$inferInsert;

// One row per time a human directly edited or cancelled a session that PAMi (the AI) had created
// or last touched -- the "self-correcting feedback loop" signal. server/preferenceLearning.ts
// mines these for recurring (therapist, day-of-week, time-of-day) patterns and turns them into
// plain-language standing preferences fed back into PAMi's system prompt, so staff don't have to
// keep re-explaining the same rule (e.g. "don't put Karin on overnight Fridays").
export const scheduleOverrides = sqliteTable("scheduleOverrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("sessionId").notNull(),
  patientId: integer("patientId").notNull(),
  therapistId: integer("therapistId"), // PAMi's original therapist choice, before the override
  therapyType: text("therapyType").notNull(),
  originalStartTime: integer("originalStartTime", { mode: "timestamp" }).notNull(),
  overrideType: text("overrideType", { enum: ["moved", "reassigned", "cancelled"] }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export type ScheduleOverride = typeof scheduleOverrides.$inferSelect;
export type InsertScheduleOverride = typeof scheduleOverrides.$inferInsert;

// One row per day the at-risk email digest has actually been sent. Existence of a row for
// today's date key is the idempotency check -- server/atRiskDigestEmail.ts consults this before
// sending so the every-15-minutes scheduler tick (server/_core/digestScheduler.ts) doesn't spam
// staff with the same email on every check once it's gone out once that morning.
export const digestEmailLog = sqliteTable("digestEmailLog", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // "YYYY-MM-DD"
  recipientCount: integer("recipientCount").notNull(),
  atRiskCount: integer("atRiskCount").notNull(),
  sentAt: integer("sentAt", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export type DigestEmailLog = typeof digestEmailLog.$inferSelect;
export type InsertDigestEmailLog = typeof digestEmailLog.$inferInsert;

// Relations
export const userRelations = relations(users, ({ one }) => ({
  therapist: one(therapists),
}));

export const therapistRelations = relations(therapists, ({ one, many }) => ({
  user: one(users, {
    fields: [therapists.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [therapists.teamId],
    references: [teams.id],
  }),
  sessions: many(therapySessions),
}));

export const patientRelations = relations(patients, ({ many }) => ({
  sessions: many(therapySessions),
  flags: many(statusFlags),
  additionalMinutes: many(patientAdditionalMinutes),
}));

export const sessionRelations = relations(therapySessions, ({ one }) => ({
  patient: one(patients, {
    fields: [therapySessions.patientId],
    references: [patients.id],
  }),
  therapist: one(therapists, {
    fields: [therapySessions.therapistId],
    references: [therapists.id],
  }),
}));
export const therapistAbsences = sqliteTable("therapistAbsences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  therapistId: integer("therapistId").notNull(),
  date: integer("date", { mode: 'timestamp' }).notNull(),
  reason: text("reason").notNull().default("Call-Off"),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type TherapistAbsence = typeof therapistAbsences.$inferSelect;
export type InsertTherapistAbsence = typeof therapistAbsences.$inferInsert;
