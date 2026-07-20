import { getOrCreateTodaysDigest, type MorningDigestPatientEntry } from "./scheduling";
import { hasDigestEmailBeenSentForDate, recordDigestEmailSent } from "./db";
import { sendEmail } from "./email";
import { ENV } from "./_core/env";
import { formatDateKey } from "../shared/timeGrid";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function buildEmailContent(atRisk: MorningDigestPatientEntry[], dateLabel: string): { subject: string; html: string; text: string } {
  const subject = `PAM: ${atRisk.length} patient(s) at risk of missing weekly minutes -- ${dateLabel}`;

  const textLines = atRisk.map((p) => {
    const slot = p.proposedSlots[0];
    const slotText = slot
      ? `Proposed: ${slot.therapyType} with ${slot.therapistName ?? "unassigned"} at ${formatSlotTime(slot.startTime)} (${slot.durationMinutes} min)`
      : "No open slot found -- needs a manual look.";
    return `- ${p.patientName} (Room ${p.roomNumber}): ${p.remainingMinutes} of ${p.target} min remaining. ${slotText}`;
  });

  const rows = atRisk
    .map((p) => {
      const slot = p.proposedSlots[0];
      const slotHtml = slot
        ? `${escapeHtml(slot.therapyType)} with ${escapeHtml(slot.therapistName ?? "unassigned")} at ${formatSlotTime(slot.startTime)} (${slot.durationMinutes} min)`
        : `<em>No open slot found -- needs a manual look.</em>`;
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(p.patientName)} <span style="color:#6b7280;">(Room ${escapeHtml(p.roomNumber)})</span></td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#dc2626;font-weight:600;">${p.remainingMinutes} / ${p.target} min</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${slotHtml}</td>
      </tr>`;
    })
    .join("");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;">
      <h2 style="color:#1e293b;">PAM morning digest -- ${escapeHtml(dateLabel)}</h2>
      <p style="color:#334155;">${atRisk.length} patient(s) are projected to miss their weekly therapy-minute target unless something changes today. PAMi has already proposed an open slot for each where one exists -- these are proposals only, nothing has been booked.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#64748b;">
            <th style="padding:6px 12px;">Patient</th>
            <th style="padding:6px 12px;">Remaining</th>
            <th style="padding:6px 12px;">Proposed slot</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#64748b;font-size:13px;margin-top:16px;">Open the board or ask PAMi to book any of these. This is an automated digest -- no reply needed.</p>
    </div>
  `;

  const text = `PAM morning digest -- ${dateLabel}\n\n${atRisk.length} patient(s) at risk of missing their weekly target:\n\n${textLines.join("\n")}\n\nOpen the board or ask PAMi to book any of these.`;

  return { subject, html, text };
}

/**
 * The proactive half of the morning digest: instead of only waiting for someone to open the
 * board or ask PAMi, this emails the configured recipient list (DIGEST_NOTIFICATION_EMAILS) once
 * a day, whenever there's at least one at-risk patient. Idempotent per calendar day via
 * digestEmailLog -- safe to call from the 15-minute scheduler tick without resending. Read-only
 * from a scheduling standpoint (same propose-only guarantee as the digest itself); this only ever
 * sends mail, never books anything.
 */
export async function sendAtRiskDigestEmailIfNeeded(referenceDate: Date = new Date()): Promise<void> {
  const dateKey = formatDateKey(referenceDate);
  if (await hasDigestEmailBeenSentForDate(dateKey)) return;

  const recipients = ENV.digestNotificationEmails;
  if (recipients.length === 0) return; // Not configured -- nothing to do, and nothing to warn about every 15 min.

  const entries = await getOrCreateTodaysDigest(referenceDate);
  const atRisk = entries.filter((e) => e.atRisk);
  if (atRisk.length === 0) return;

  const dateLabel = referenceDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const { subject, html, text } = buildEmailContent(atRisk, dateLabel);
  const sent = await sendEmail({ to: recipients, subject, html, text });
  if (!sent) return; // Leave no log row on failure so the next scheduler tick retries.

  await recordDigestEmailSent(dateKey, recipients.length, atRisk.length);
}
