import { getOrCreateTodaysDigest, type MorningDigestPatientEntry } from "./scheduling";
import { hasDigestEmailBeenSentForDate, recordDigestEmailSent } from "./db";
import { sendEmail } from "./email";
import { ENV } from "./_core/env";
import { formatDateKey } from "../shared/timeGrid";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildEmailContent(atRisk: MorningDigestPatientEntry[], dateLabel: string): { subject: string; html: string; text: string } {
  const subject = `Therapy planning review available -- ${dateLabel}`;
  const boardUrl = ENV.appUrl ? `${ENV.appUrl}/board` : "";
  const text = `A therapy planning review is available for ${dateLabel}. Sign in to MinuteMinder to review current patient goals, minute gaps, and proposed slots. No sessions have been booked.${boardUrl ? `\n\n${boardUrl}` : ""}`;
  const html = `<div style="font-family:system-ui,sans-serif"><h2>Therapy planning review available</h2><p>Sign in to review current patient goals, minute gaps, and proposed slots. No sessions have been booked.</p>${boardUrl ? `<p><a href="${escapeHtml(boardUrl).replace(/"/g, "&quot;")}">Open MinuteMinder</a></p>` : ""}</div>`;

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
