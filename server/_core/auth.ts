import { randomBytes, createHash } from "crypto";
import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import * as db from "../db";
import { isEmailConfigured, sendEmail } from "../email";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME } from "@shared/const";

function getSessionTokenFromRequest(req: Request): string | undefined {
  return parseCookieHeader(req.headers.cookie || "")[COOKIE_NAME];
}

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_LINKS_PER_EMAIL_WINDOW = 3;
const MAX_LINKS_PER_IP_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function openIdForEmail(email: string): string {
  return `email:${email.toLowerCase()}`;
}

function getClientIp(req: Request): string {
  // Express resolves this using the app's explicit trust-proxy setting. Reading the forwarding
  // header directly lets a client spoof the key used by the magic-link rate limiter.
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Request a magic link for `email`. Always resolves the same way regardless of whether the
 * email is invited -- the caller must not be able to distinguish "invited" from "not invited"
 * from timing or response shape, or this becomes a way to enumerate staff email addresses.
 */
export type MagicLinkDelivery = "sent" | "queued" | "not_configured" | "send_failed" | "rate_limited" | "not_allowed";

export async function requestMagicLink(
  email: string,
  req: Request,
  options: { awaitDelivery?: boolean; invitation?: boolean } = {},
): Promise<MagicLinkDelivery> {
  const normalizedEmail = email.trim().toLowerCase();
  const ip = getClientIp(req);

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const [emailCount, ipCount] = await Promise.all([
    db.countRecentMagicLinks({ email: normalizedEmail, since }),
    db.countRecentMagicLinks({ ipAddress: ip, since }),
  ]);
  if (emailCount >= MAX_LINKS_PER_EMAIL_WINDOW || ipCount >= MAX_LINKS_PER_IP_WINDOW) {
    console.warn(`[Auth] Rate limit hit for magic-link request (email=${normalizedEmail}, ip=${ip})`);
    return "rate_limited";
  }

  const existingUser = await db.getUserByOpenId(openIdForEmail(normalizedEmail));
  if (existingUser?.deactivatedAt) {
    console.warn(`[Auth] Magic-link requested for deactivated user: ${normalizedEmail}`);
    return "not_allowed";
  }

  let invite = await db.getInviteByEmail(normalizedEmail);
  if (!invite && !existingUser && ENV.ownerEmail && normalizedEmail === ENV.ownerEmail) {
    // Bootstrap: no admins exist yet, so the configured owner email can self-invite as admin.
    invite = await db.createInvite({ email: normalizedEmail, role: "admin", invitedByUserId: 0 });
  }
  // Invites gate first-time access. Once the account exists, its active user row is the source
  // of truth; deleting old/accepted invite records must not lock that person out permanently.
  if (!invite && !existingUser) {
    console.warn(`[Auth] Magic-link requested for unknown, non-invited email: ${normalizedEmail}`);
    return "not_allowed";
  }

  if (!isEmailConfigured()) {
    console.warn(`[Auth] Cannot send magic link to ${normalizedEmail}: SMTP is not configured`);
    return "not_configured";
  }

  const token = generateToken();
  await db.createMagicLink({
    email: normalizedEmail,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    ipAddress: ip,
  });

  const appUrl = ENV.appUrl || `${req.protocol}://${req.get("host")}`;
  const verifyUrl = `${appUrl}/api/auth/verify?token=${token}`;
  const subject = options.invitation ? "You're invited to MinuteMinder" : "Your MinuteMinder login link";
  const introduction = options.invitation
    ? "You've been invited to MinuteMinder. Use the link below to accept your invitation and sign in."
    : "Click below to log in.";
  const emailMessage = {
    to: [normalizedEmail],
    subject,
    text: `${introduction}\n\n${verifyUrl}\n\nThis link expires in 15 minutes and can only be used once.`,
    html: `<p>${introduction}</p><p><a href="${verifyUrl}">${options.invitation ? "Accept invitation" : "Log in to MinuteMinder"}</a></p><p>This link expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.</p>`,
  };

  if (options.awaitDelivery) {
    return (await sendEmail(emailMessage)) ? "sent" : "send_failed";
  }

  // Deliberately not awaited: the invited-email path would otherwise take measurably longer
  // than the non-invited path above (DB insert + SMTP round trip vs. an instant return), letting
  // an attacker enumerate invited emails by timing alone even though the HTTP response is
  // identical either way.
  sendEmail(emailMessage).catch((err) => console.error("[Auth] Failed to send magic-link email:", err));
  return "queued";
}

/** Verifies a magic-link token, creates a session, and sets the session cookie. Returns the user on success. */
export async function verifyMagicLink(token: string, req: Request, res: Response): Promise<User | null> {
  const tokenHash = hashToken(token);
  const link = await db.getMagicLinkByTokenHash(tokenHash);
  if (!link) return null;
  if (link.usedAt) return null;
  if (link.expiresAt.getTime() < Date.now()) return null;

  await db.markMagicLinkUsed(link.id);

  const openId = openIdForEmail(link.email);
  let user = await db.getUserByOpenId(openId);
  const invite = await db.getInviteByEmail(link.email);
  // A valid invite is required only to create an account. Existing active users can continue
  // signing in if accepted invite records are later cleaned up.
  if (!user && !invite) return null;
  if (!user) {
    // The guard above guarantees the invite is present in this branch.
    await db.upsertUser({
      openId,
      email: link.email,
      name: link.email.split("@")[0],
      loginMethod: "email",
      role: invite!.role,
      lastSignedIn: new Date(),
    });
    user = await db.getUserByOpenId(openId);
    if (invite) await db.markInviteAccepted(link.email);
  } else {
    if (user.deactivatedAt) return null;
    await db.upsertUser({ openId, lastSignedIn: new Date() });
  }
  if (!user) return null;

  const sessionToken = generateToken();
  await db.createSession({
    userId: user.id,
    tokenHash: hashToken(sessionToken),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"] || null,
  });

  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: SESSION_TTL_MS });

  return user;
}

/** Looks up the current user from the session cookie. Returns null if missing/expired/revoked -- never falls back to a default user. */
export async function authenticateRequest(req: Request): Promise<User | null> {
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) return null;

  const session = await db.getSessionByTokenHash(hashToken(sessionToken));
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  const user = await db.getUserById(session.userId);
  if (!user || user.deactivatedAt) return null;

  db.touchSession(session.id).catch(() => {});

  return user;
}

export async function logout(req: Request, res: Response): Promise<void> {
  const sessionToken = getSessionTokenFromRequest(req);
  if (sessionToken) {
    const session = await db.getSessionByTokenHash(hashToken(sessionToken));
    if (session) await db.revokeSession(session.id);
  }
  const cookieOptions = getSessionCookieOptions(req);
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/request-link", async (req: Request, res: Response) => {
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    if (!email || !email.includes("@")) {
      res.status(400).json({ error: "Valid email is required" });
      return;
    }
    try {
      await requestMagicLink(email, req);
    } catch (error) {
      console.error("[Auth] Failed to process magic-link request:", error);
    }
    // Always the same response -- do not leak whether the email is invited.
    res.json({ message: "If that email is registered, a login link has been sent." });
  });

  app.get("/api/auth/verify", async (req: Request, res: Response) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      res.redirect(302, "/login?error=missing_token");
      return;
    }
    try {
      const user = await verifyMagicLink(token, req, res);
      if (!user) {
        res.redirect(302, "/login?error=invalid_or_expired");
        return;
      }
      res.redirect(302, "/board");
    } catch (error) {
      console.error("[Auth] Verify failed:", error);
      res.redirect(302, "/login?error=server_error");
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    await logout(req, res);
    res.json({ success: true });
  });
}
