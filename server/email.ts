import nodemailer from "nodemailer";
import { ENV } from "./_core/env";

let _transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (_transporter) return _transporter;
  if (!ENV.smtpHost || !ENV.smtpUser || !ENV.smtpPass) return null;
  _transporter = nodemailer.createTransport({
    host: ENV.smtpHost,
    port: ENV.smtpPort,
    secure: ENV.smtpPort === 465,
    auth: { user: ENV.smtpUser, pass: ENV.smtpPass },
  });
  return _transporter;
}

/** Fast, synchronous, no-I/O check -- safe to await/check inline before deciding whether to queue a send. */
export function isEmailConfigured(): boolean {
  return !!(ENV.smtpHost && ENV.smtpUser && ENV.smtpPass);
}

/**
 * Sends an email via generic SMTP (SMTP_HOST/PORT/USER/PASS/FROM env vars -- works with a Gmail
 * app password, SES SMTP credentials, SendGrid SMTP, etc.). Returns false (and just logs a
 * warning) rather than throwing when SMTP isn't configured or the send fails -- this is a
 * best-effort proactive notification, not something that should ever take the server down or
 * block a request.
 */
export async function sendEmail(params: { to: string[]; subject: string; html: string; text: string }): Promise<boolean> {
  if (params.to.length === 0) {
    console.warn("[email] No recipients configured (DIGEST_NOTIFICATION_EMAILS) -- skipping send.");
    return false;
  }
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[email] SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS) -- skipping send.");
    return false;
  }
  try {
    await transporter.sendMail({
      from: ENV.smtpFrom || ENV.smtpUser,
      to: params.to.join(", "),
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    return true;
  } catch (error) {
    console.warn("[email] Failed to send:", error);
    return false;
  }
}
