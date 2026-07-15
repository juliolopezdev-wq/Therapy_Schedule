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
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type Therapist = typeof therapists.$inferSelect;
export type InsertTherapist = typeof therapists.$inferInsert;

export const patients = sqliteTable("patients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomNumber: text("roomNumber").notNull(),
  name: text("name").notNull(),
  notes: text("notes"),
  isDischarged: integer("isDischarged", { mode: 'boolean' }).default(false).notNull(),
  admissionDate: text("admissionDate"),
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
  flagType: text("flagType", { enum: ["DC", "Name Alert", "Weekend", "In-Service", "Appointment", "Stroke Program", "Shower", "Medical Hold", "Dialysis", "Block Time", "Group Appropriate", "Male Therapist Only", "Female Therapist Only", "Home Eval", "Family Training"] }).notNull(),
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