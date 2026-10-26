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
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    // Render has no outbound IPv6 -- force IPv4 or smtp.gmail.com resolves to an unreachable AAAA record.
    family: 4,
  } as nodemailer.TransportOptions);
  return _transporter;
}

/** Fast, synchronous, no-I/O check -- safe to await/check inline before deciding whether to queue a send. */
export function isEmailConfigured(): boolean {
  return !!ENV.gmailRelayUrl || !!ENV.resendApiKey || !!(ENV.smtpHost && ENV.smtpUser && ENV.smtpPass);
}

/**
 * Sends via a Google Apps Script web app (see scripts/gmail-relay.gs) that calls GmailApp from the
 * owner's Google account. HTTPS-only, so it works on hosts that block SMTP, and needs no domain.
 */
async function sendViaGmailRelay(params: { to: string[]; subject: string; html: string; text: string }): Promise<boolean> {
  try {
    // Apps Script answers POST with a 302 to googleusercontent.com; fetch follows it automatically.
    const res = await fetch(ENV.gmailRelayUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ secret: ENV.gmailRelaySecret, ...params }),
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    let ok = false;
    try {
      ok = JSON.parse(body).ok === true;
    } catch {
      /* non-JSON = Google error page */
    }
    if (!ok) {
      console.warn(`[email] Gmail relay failed (${res.status}):`, body.slice(0, 500));
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[email] Gmail relay failed to send:", error);
    return false;
  }
}

/**
 * Sends via Resend's HTTPS API (port 443). Preferred over SMTP because hosts like Render's free
 * tier block outbound SMTP ports (25/465/587) entirely.
 */
async function sendViaResend(params: { to: string[]; subject: string; html: string; text: string }): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${ENV.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: ENV.smtpFrom || "onboarding@resend.dev",
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[email] Resend failed (${res.status}):`, await res.text());
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[email] Resend failed to send:", error);
    return false;
  }
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
  if (ENV.gmailRelayUrl) return sendViaGmailRelay(params);
  if (ENV.resendApiKey) return sendViaResend(params);
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
