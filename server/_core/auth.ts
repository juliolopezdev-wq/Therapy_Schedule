import { randomBytes, createHash } from "crypto";
import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import * as db from "../db";
import { isEmailConfigured, sendEmail } from "../email";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME, SIGN_IN_LOCK_MS, SIGN_IN_NETWORK_REQUEST_LIMIT, SESSION_IDLE_MS, SESSION_ABSOLUTE_MS } from "@shared/const";
import { z } from "zod";

function getSessionTokenFromRequest(req: Request): string | undefined {
  return parseCookieHeader(req.headers.cookie || "")[COOKIE_NAME];
}

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const INVITE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSION_TTL_MS = SESSION_ABSOLUTE_MS;
// keyed by email+IP so someone can't lock a coworker out by spamming their address
const MAX_LINKS_PER_EMAIL_IP_WINDOW = 3;
const MAX_LINKS_PER_EMAIL_WINDOW = 10;
const MAX_LINKS_PER_IP_WINDOW = SIGN_IN_NETWORK_REQUEST_LIMIT;
const RATE_LIMIT_WINDOW_MS = SIGN_IN_LOCK_MS;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function openIdForEmail(email: string): string {
  return `email:${normalizeEmail(email)}`;
}

function getClientIp(req: Request): string {
  // Express resolves this using the app's explicit trust-proxy setting. Reading the forwarding
  // header directly lets a client spoof the key used by the magic-link rate limiter.
  return req.ip || req.socket.remoteAddress || "unknown";
}

function signInClientKey(req: Request): string {
  const cookies = parseCookieHeader(req.headers?.cookie || "");
  let client = cookies.sign_in_client;
  if (!client || !/^[A-Za-z0-9_-]{43}$/.test(client)) {
    client = generateToken();
    req.headers ??= {};
    req.headers.cookie = `${req.headers.cookie || ""}; sign_in_client=${client}`;
    req.res?.cookie("sign_in_client", client, { ...getSessionCookieOptions(req), maxAge: 30 * 24 * 60 * 60_000 });
  }
  return hashToken(`client:${client}`);
}

export async function getSignInStatus(req: Request) {
  const [clientLock, networkLock] = await Promise.all([
    db.getSignInLock(signInClientKey(req)), db.getSignInLock(hashToken(`network:${getClientIp(req)}`)),
  ]);
  const lockedUntil = Math.max(clientLock, networkLock);
  const serverNow = Date.now();
  return { lockedUntil: lockedUntil > serverNow ? lockedUntil : 0, serverNow };
}

export async function requestSignInLink(email: string, req: Request) {
  const message = "If that email is registered, a login link has been sent.";
  const initial = await getSignInStatus(req);
  if (initial.lockedUntil) return { ...initial, message, invalidFormat: false };
  const networkLock = await db.recordIncorrectSignIn(hashToken(`network:${getClientIp(req)}`), Date.now(), SIGN_IN_NETWORK_REQUEST_LIMIT);
  if (networkLock) return { lockedUntil: networkLock, serverNow: Date.now(), message, invalidFormat: false };
  const normalized = normalizeEmail(email);
  const invalidFormat = !z.string().email().safeParse(normalized).success;
  const delivery = invalidFormat ? "not_allowed" : await requestMagicLink(normalized, req);
  const status = delivery === "not_allowed"
    ? { lockedUntil: await db.recordIncorrectSignIn(signInClientKey(req)), serverNow: Date.now() }
    : await getSignInStatus(req);
  return { ...status, message, invalidFormat };
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
  const normalizedEmail = normalizeEmail(email);
  const ip = getClientIp(req);

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const [emailIpCount, emailCount, ipCount] = await Promise.all([
    db.countRecentMagicLinks({ email: normalizedEmail, ipAddress: ip, since }),
    db.countRecentMagicLinks({ email: normalizedEmail, since }),
    db.countRecentMagicLinks({ ipAddress: ip, since }),
  ]);
  if (
    emailIpCount >= MAX_LINKS_PER_EMAIL_IP_WINDOW ||
    emailCount >= MAX_LINKS_PER_EMAIL_WINDOW ||
    ipCount >= MAX_LINKS_PER_IP_WINDOW
  ) {
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
  if (options.invitation) await db.deleteUnusedInviteLinks(normalizedEmail);
  await db.createMagicLink({
    email: normalizedEmail,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + (options.invitation ? INVITE_LINK_TTL_MS : MAGIC_LINK_TTL_MS)),
    ipAddress: ip,
    forInvite: options.invitation ?? false,
  });

  const appUrl = ENV.appUrl || `${req.protocol}://${req.get("host")}`;
  const verifyUrl = `${appUrl}/api/auth/verify?token=${token}`;
  const subject = options.invitation ? "You're invited to MinuteMinder" : "Your MinuteMinder login link";
  const expiryNote = options.invitation
    ? "This link works for 7 days or until you accept the invitation, and can only be used once."
    : "This link expires in 15 minutes and can only be used once.";
  const introduction = options.invitation
    ? "You've been invited to MinuteMinder. Use the link below to accept your invitation and sign in."
    : "Click below to log in.";
  const emailMessage = {
    to: [normalizedEmail],
    subject,
    text: `${introduction}\n\n${verifyUrl}\n\n${expiryNote}`,
    html: `<p>${introduction}</p><p><a href="${verifyUrl}">${options.invitation ? "Accept invitation" : "Log in to MinuteMinder"}</a></p><p>${expiryNote} If you didn't request this, you can safely ignore this email.</p>`,
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

  const openId = openIdForEmail(link.email);
  let user = await db.getUserByOpenId(openId);
  const invite = await db.getInviteByEmail(link.email);
  // An invite link stops working once the invite is accepted or revoked.
  if (link.forInvite && (!invite || invite.acceptedAt)) return null;
  // A valid invite is required only to create an account. Existing active users can continue
  // signing in if accepted invite records are later cleaned up.
  if (!user && !invite) return null;
  if (user?.deactivatedAt) return null;
  // Only one verification request may claim this link, even if two arrive together.
  if (!(await db.markMagicLinkUsed(link.id))) return null;
  if (!user) {
    // The guard above guarantees the invite is present in this branch.
    await db.upsertUser({
      openId,
      email: link.email,
      name: invite!.name?.trim() || null,
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
  if (session.createdAt && Date.now() - session.createdAt.getTime() >= SESSION_TTL_MS) return null;
  if (session.lastSeenAt && Date.now() - session.lastSeenAt.getTime() >= SESSION_IDLE_MS) return null;

  const user = await db.getUserById(session.userId);
  if (!user || user.deactivatedAt) return null;

  return user;
}

/** Only explicit user activity refreshes inactivity; background board polling must not. */
export async function recordUserActivity(req: Request): Promise<void> {
  const token = getSessionTokenFromRequest(req);
  if (!token) return;
  const session = await db.getSessionByTokenHash(hashToken(token));
  if (session && !session.revokedAt) await db.touchSession(session.id);
}

export async function getSessionStatus(req: Request) {
  const token = getSessionTokenFromRequest(req);
  if (!token) return null;
  const session = await db.getSessionByTokenHash(hashToken(token));
  if (!session || session.revokedAt) return null;
  const overall = Math.min(session.expiresAt.getTime(), session.createdAt.getTime() + SESSION_TTL_MS);
  const idle = session.lastSeenAt.getTime() + SESSION_IDLE_MS;
  return { serverNow: Date.now(), expiresAt: Math.min(overall, idle), canExtend: idle < overall };
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
    res.setHeader("Cache-Control", "no-store");
    try {
      const result = await requestSignInLink(email, req);
      if (result.lockedUntil) {
        res.setHeader("Retry-After", String(Math.ceil((result.lockedUntil - result.serverNow) / 1000)));
      }
      res.status(result.lockedUntil ? 429 : result.invalidFormat ? 400 : 200).json(result);
    } catch (error) {
      console.error("[Auth] Failed to process magic-link request:", error);
      res.status(503).json({ error: "Sign-in is temporarily unavailable. Please try again." });
    }
  });

  app.get("/api/auth/verify", async (req: Request, res: Response) => {
    // Email scanners and previews issue GET/HEAD requests. Never consume a link here.
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      res.redirect(302, "/login?error=missing_token");
      return;
    }
    const escapedToken = token.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]!);
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in to MinuteMinder</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#020617;color:#f8fafc;font-family:system-ui,sans-serif}main{max-width:24rem;margin:1rem;padding:2rem;border:1px solid #334155;border-radius:1rem;background:#0f172a}h1{font-size:1.5rem}p{color:#cbd5e1;line-height:1.6}button{width:100%;padding:.9rem;border:0;border-radius:.5rem;background:#38bdf8;color:#020617;font:inherit;font-weight:700;cursor:pointer}a{color:#7dd3fc}</style></head>
<body><main><h1>Sign in to MinuteMinder</h1><p>Continue to securely sign in with your email link.</p>
<form method="post" action="/api/auth/verify"><input type="hidden" name="token" value="${escapedToken}"><button type="submit">Continue to MinuteMinder</button></form>
<p>Links expire after 15 minutes. <a href="/login">Request a new link</a> if needed.</p></main></body></html>`);
  });

  app.post("/api/auth/verify", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!token) {
      res.redirect(303, "/login?error=missing_token");
      return;
    }
    try {
      const user = await verifyMagicLink(token, req, res);
      if (!user) {
        // A repeated submit after success should preserve the existing signed-in session.
        const currentUser = await authenticateRequest(req);
        res.redirect(303, currentUser ? "/board" : "/login?error=invalid_or_expired");
        return;
      }
      res.redirect(303, "/board");
    } catch (error) {
      console.error("[Auth] Verify failed:", error);
      res.redirect(303, "/login?error=server_error");
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    await logout(req, res);
    res.json({ success: true });
  });
}
