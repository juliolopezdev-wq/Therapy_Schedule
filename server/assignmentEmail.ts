import { getTherapists, getPatients, getTherapySessionsForDateRange } from "./db";
import { sendEmail, isEmailConfigured } from "./email";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatSlotTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface AssignmentEntry {
  timeLabel: string;
  startTime: Date;
  patientName: string;
  roomNumber: string;
  therapyType: string;
  durationMinutes: number;
}

function buildEmailContent(
  therapistName: string,
  dateLabel: string,
  entries: AssignmentEntry[],
): { subject: string; html: string; text: string } {
  const subject = `Your schedule for ${dateLabel} (${entries.length} session${entries.length === 1 ? "" : "s"})`;

  const sorted = [...entries].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const textLines = sorted.map(
    (e) => `- ${e.timeLabel}: ${e.therapyType} with ${e.patientName} (Room ${e.roomNumber}), ${e.durationMinutes} min`,
  );

  const rows = sorted
    .map(
      (e) => `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(e.timeLabel)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(e.patientName)} <span style="color:#6b7280;">(Room ${escapeHtml(e.roomNumber)})</span></td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(e.therapyType)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${e.durationMinutes} min</td>
      </tr>`,
    )
    .join("");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;">
      <h2 style="color:#1e293b;">Hi ${escapeHtml(therapistName)}, here's your schedule for ${escapeHtml(dateLabel)}</h2>
      <p style="color:#334155;">You're assigned to ${entries.length} session${entries.length === 1 ? "" : "s"}:</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#64748b;">
            <th style="padding:6px 12px;">Time</th>
            <th style="padding:6px 12px;">Patient</th>
            <th style="padding:6px 12px;">Type</th>
            <th style="padding:6px 12px;">Duration</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#64748b;font-size:13px;margin-top:16px;">This is an automated schedule notice -- check the board for any changes before your shift.</p>
    </div>
  `;

  const text = `Hi ${therapistName}, here's your schedule for ${dateLabel}:\n\n${textLines.join("\n")}`;

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

  const [therapists, patients, sessions] = await Promise.all([
    getTherapists(),
    getPatients(),
    getTherapySessionsForDateRange(tomorrow, tomorrow),
  ]);

  const therapistMap = new Map(therapists.map((t) => [t.id, t]));
  const patientMap = new Map(patients.map((p) => [p.id, p]));
  const dateLabel = tomorrow.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const byTherapist = new Map<number, AssignmentEntry[]>();
  for (const s of sessions) {
    if (s.therapyType === "Block") continue;
    if (s.status !== "scheduled") continue;
    if (s.therapistId == null) continue;
    const patient = patientMap.get(s.patientId);
    const startTime = new Date(s.startTime);
    const entry: AssignmentEntry = {
      timeLabel: formatSlotTime(startTime),
      startTime,
      patientName: patient?.name ?? `Patient ${s.patientId}`,
      roomNumber: patient?.roomNumber ?? "N/A",
      therapyType: s.therapyType,
      durationMinutes: s.durationMinutes,
    };
    if (!byTherapist.has(s.therapistId)) byTherapist.set(s.therapistId, []);
    byTherapist.get(s.therapistId)!.push(entry);
  }

  const result: SendTomorrowAssignmentsResult = { queued: [], skippedNoEmail: [], noSessions: [], failed: [] };
  const emailReady = isEmailConfigured(); // fast, no I/O -- safe to check inline

  const targetIds = therapistIds && therapistIds.length > 0 ? therapistIds : Array.from(byTherapist.keys());

  for (const therapistId of targetIds) {
    const therapist = therapistMap.get(therapistId);
    const therapistName = therapist?.name ?? `Therapist ${therapistId}`;
    const entries = byTherapist.get(therapistId);

    if (!entries || entries.length === 0) {
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
    const { subject, html, text } = buildEmailContent(therapistName, dateLabel, entries);
    void sendEmail({ to: [therapist.email], subject, html, text });
    result.queued.push({ therapistId, therapistName, sessionCount: entries.length });
  }

  return result;
}
