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
  therapyType: text("therapyType", { enum: ["PT", "OT", "SLP"] }).notNull().default("PT"),
  teamId: integer("teamId"),
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
  teamId: integer("teamId"),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type Patient = typeof patients.$inferSelect;
export type InsertPatient = typeof patients.$inferInsert;

export const statusFlags = sqliteTable("statusFlags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patientId").notNull(),
  flagType: text("flagType", { enum: ["DC", "Name Alert", "Weekend", "In-Service", "Appointment", "Stroke Program", "Shower"] }).notNull(),
  date: integer("date", { mode: 'timestamp' }).notNull(),
  createdAt: integer("createdAt", { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type StatusFlag = typeof statusFlags.$inferSelect;
export type InsertStatusFlag = typeof statusFlags.$inferInsert;

export const therapySessions = sqliteTable("therapySessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patientId").notNull(),
  therapistId: integer("therapistId"),
  therapyType: text("therapyType", { enum: ["PT", "OT", "SLP", "Eval"] }).notNull(),
  startTime: integer("startTime", { mode: 'timestamp' }).notNull(),
  endTime: integer("endTime", { mode: 'timestamp' }).notNull(),
  durationMinutes: integer("durationMinutes").notNull(),
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