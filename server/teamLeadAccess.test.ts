import { expect, it, vi } from "vitest";
import type { Patient, TherapySession, User } from "../drizzle/schema";
const rows = vi.hoisted(() => ({
  patients: [
    { id: 1, teamId: 1, notes: "One" },
    { id: 2, teamId: 2, notes: "Two" },
  ] as Patient[],
  sessions: [
    { id: 1, patientId: 1, therapistId: 11, notes: "One" },
    { id: 2, patientId: 2, therapistId: 22, notes: "Two" },
  ] as TherapySession[],
}));
vi.mock("./db", () => ({
  getDb: async () => null,
  getPatients: async () => rows.patients,
  getTeams: async () => [{ id: 1 }, { id: 2 }],
  getTherapySessions: async () => rows.sessions,
  getTherapySessionsForWeek: async () => rows.sessions,
  getTherapySessionsForDateRange: async () => rows.sessions,
}));
import {
  resolveAccessScope,
  getScopedPatients,
  getScopedTeams,
  getScopedSessions,
  getScopedSessionsForWeek,
  getScopedSessionsForDateRange,
  assertSessionWriteAccess,
  assertPatientInScope,
  assertTherapistWriteAccess,
} from "./accessControl";
it("gives unlinked team leads full schedules and write access across all teams", async () => {
  const lead = { role: "team_lead", id: 7 } as User;
  const scope = await resolveAccessScope(lead);
  expect(scope.linked).toBe(false);
  expect(await getScopedPatients(lead)).toEqual(
    rows.patients.map(patient => ({ ...patient, accessLevel: "full" }))
  );
  expect(await getScopedTeams(lead)).toHaveLength(2);
  expect(await getScopedSessions(lead)).toEqual(rows.sessions);
  expect(await getScopedSessionsForWeek(lead, new Date())).toEqual(
    rows.sessions
  );
  expect(
    await getScopedSessionsForDateRange(lead, new Date(), new Date())
  ).toEqual(rows.sessions);
  for (const session of rows.sessions) {
    await expect(
      assertPatientInScope(scope, session.patientId)
    ).resolves.toBeUndefined();
    await expect(
      assertSessionWriteAccess(scope, session)
    ).resolves.toBeUndefined();
    await expect(
      assertTherapistWriteAccess(scope, session.therapistId!)
    ).resolves.toBeUndefined();
  }
});
it.each(["staff", "viewer"] as const)(
  "does not give an unlinked %s the same access",
  async role => {
    const user = { role, id: 8 } as User;
    await expect(getScopedPatients(user)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      assertSessionWriteAccess(await resolveAccessScope(user), rows.sessions[0])
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
);
