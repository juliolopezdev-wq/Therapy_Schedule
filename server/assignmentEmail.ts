import { getTherapists, getTherapySessionsForDateRange } from "./db";
import { sendEmail, isEmailConfigured } from "./email";
import { ENV } from "./_core/env";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildEmailContent(
  therapistName: string,
  dateLabel: string,
  sessionCount: number,
): { subject: string; html: string; text: string } {
  const subject = `Your schedule for ${dateLabel} (${sessionCount} session${sessionCount === 1 ? "" : "s"})`;

  const boardUrl = ENV.appUrl ? `${ENV.appUrl}/board` : "";
  const text = `Hi ${therapistName}, your schedule for ${dateLabel} has ${sessionCount} session(s). Sign in to MinuteMinder to view patient details and the latest changes.${boardUrl ? `\n\n${boardUrl}` : ""}`;
  const html = `<div style="font-family:system-ui,sans-serif"><h2>Your schedule is ready</h2><p>${escapeHtml(therapistName)}, you have ${sessionCount} session(s) for ${escapeHtml(dateLabel)}.</p><p>Sign in to MinuteMinder to view patient details and the latest changes.</p>${boardUrl ? `<p><a href="${escapeHtml(boardUrl).replace(/"/g, "&quot;")}">Open MinuteMinder</a></p>` : ""}</div>`;

  return { subject, html, text };
}

export interface SendTomorrowAssignmentsResult {
  /** Handed off to the mail server -- NOT a delivery confirmation. See the note below on why. */
  queued: { therapistId: number; therapistName: string; sessionCount: number }[];
  skippedNoEmail: { therapistId: number; therapistName: string }[];
  noSessions: { therapistId: number; therapistName: string }[];
  /** Only ever populated by the fast, no-I/O "SMTP isn't configured at all" check -- never by a slow/network send failure (see below). */
  failed: { therapistId: number; therapistName: string }[];
}

/**
 * Groups tomorrow's real (non-Block) sessions by therapist and emails each therapist their own
 * schedule. "Tomorrow" is derived from referenceDate (defaults to now) so callers can pass the
 * board's currently-viewed date instead of always meaning the server's calendar day.
 *
 * With no therapistIds, this is the bulk "send to everyone working tomorrow" action -- therapists
 * with no sessions are silently skipped (not everyone needs a "you're off tomorrow" email). With
 * therapistIds (an explicit pick-this-person action from the Staff panel), every requested
 * therapist gets a result row, including a "noSessions" one if the board doesn't have anything
 * booked for them yet -- so a single/few-person send always gives clear feedback.
 *
 * The actual SMTP round-trip (`sendEmail`) is deliberately NOT awaited here. On some hosts
 * (Render's outbound path to Gmail in particular) that round-trip can take long enough to blow
 * past the platform's request timeout -- the client then sees the request fail even though the
 * server keeps running and the email goes out moments later. Awaiting it turns a slow network hop
 * into a false "failed to send" in the UI. Firing it and responding immediately means the client
 * always gets an accurate, fast answer to "did I hand this off"; any genuine delivery failure
 * (bad address, auth error) is still logged server-side by sendEmail() itself.
 */
export async function sendTomorrowAssignments(
  referenceDate: Date = new Date(),
  therapistIds?: number[],
): Promise<SendTomorrowAssignmentsResult> {
  const tomorrow = new Date(referenceDate);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [therapists, sessions] = await Promise.all([
    getTherapists(),
    getTherapySessionsForDateRange(tomorrow, tomorrow),
  ]);

  const therapistMap = new Map(therapists.map((t) => [t.id, t]));
  const dateLabel = tomorrow.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const byTherapist = new Map<number, number>();
  for (const s of sessions) {
    if (s.therapyType === "Block") continue;
    if (s.status !== "scheduled") continue;
    if (s.therapistId == null) continue;
    byTherapist.set(s.therapistId, (byTherapist.get(s.therapistId) ?? 0) + 1);
  }

  const result: SendTomorrowAssignmentsResult = { queued: [], skippedNoEmail: [], noSessions: [], failed: [] };
  const emailReady = isEmailConfigured(); // fast, no I/O -- safe to check inline

  const targetIds = therapistIds && therapistIds.length > 0 ? therapistIds : Array.from(byTherapist.keys());

  for (const therapistId of targetIds) {
    const therapist = therapistMap.get(therapistId);
    const therapistName = therapist?.name ?? `Therapist ${therapistId}`;
    const sessionCount = byTherapist.get(therapistId) ?? 0;

    if (sessionCount === 0) {
      result.noSessions.push({ therapistId, therapistName });
      continue;
    }
    if (!therapist?.email) {
      result.skippedNoEmail.push({ therapistId, therapistName });
      continue;
    }
    if (!emailReady) {
      result.failed.push({ therapistId, therapistName });
      continue;
    }
    const { subject, html, text } = buildEmailContent(therapistName, dateLabel, sessionCount);
    void sendEmail({ to: [therapist.email], subject, html, text });
    result.queued.push({ therapistId, therapistName, sessionCount });
  }

  return result;
}
