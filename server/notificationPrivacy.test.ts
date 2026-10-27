import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getTherapists: vi.fn(),
  getTherapySessionsForDateRange: vi.fn(),
  sendEmail: vi.fn(),
  getOrCreateTodaysDigest: vi.fn(),
  hasDigestEmailBeenSentForDate: vi.fn(),
  recordDigestEmailSent: vi.fn(),
}));
vi.mock("./db", () => mocks);
vi.mock("./email", () => ({
  sendEmail: mocks.sendEmail,
  isEmailConfigured: () => true,
}));
vi.mock("./scheduling", () => ({
  getOrCreateTodaysDigest: mocks.getOrCreateTodaysDigest,
}));
vi.mock("./_core/env", () => ({
  ENV: {
    appUrl: "https://example.com",
    digestNotificationEmails: ["approved@example.com"],
  },
}));
import { sendTomorrowAssignments } from "./assignmentEmail";
import { sendAtRiskDigestEmailIfNeeded } from "./atRiskDigestEmail";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendEmail.mockResolvedValue(true);
});
it("keeps assignment notifications useful without patient names or rooms", async () => {
  mocks.getTherapists.mockResolvedValue([
    { id: 1, name: "Therapist", email: "staff@example.com" },
  ]);
  mocks.getTherapySessionsForDateRange.mockResolvedValue([
    {
      patientId: 9,
      therapistId: 1,
      therapyType: "PT",
      status: "scheduled",
      notes: "Sensitive clinical details",
    },
  ]);
  expect((await sendTomorrowAssignments()).queued).toHaveLength(1);
  const email = mocks.sendEmail.mock.calls[0][0];
  expect(email.text).toContain("https://example.com/board");
  expect(JSON.stringify(email)).not.toMatch(
    /patientId|Sensitive|Room|with patient/i
  );
});
it("does not send identified digest data to email recipients", async () => {
  mocks.hasDigestEmailBeenSentForDate.mockResolvedValue(false);
  mocks.getOrCreateTodaysDigest.mockResolvedValue([
    {
      atRisk: true,
      patientName: "Sensitive Patient",
      roomNumber: "SecretRoom101",
      proposedSlots: [],
    },
  ]);
  await sendAtRiskDigestEmailIfNeeded();
  const email = mocks.sendEmail.mock.calls[0][0];
  expect(JSON.stringify(email)).not.toMatch(/Sensitive Patient|SecretRoom101/);
  expect(email.text).toContain("https://example.com/board");
  expect(mocks.recordDigestEmailSent).toHaveBeenCalledOnce();
});
