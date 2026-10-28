import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  countRecentMagicLinks: vi.fn(),
  getInviteByEmail: vi.fn(),
  getUserByOpenId: vi.fn(),
  createMagicLink: vi.fn(),
  deleteUnusedInviteLinks: vi.fn(),
  getMagicLinkByTokenHash: vi.fn(),
  markMagicLinkUsed: vi.fn(),
  upsertUser: vi.fn(),
  markInviteAccepted: vi.fn(),
  createSession: vi.fn(),
  getSessionByTokenHash: vi.fn(),
  getUserById: vi.fn(),
  touchSession: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("../db", () => ({
  ...mocks,
}));

vi.mock("../email", () => ({
  isEmailConfigured: () => true,
  sendEmail: mocks.sendEmail,
}));

import { registerAuthRoutes, requestMagicLink, verifyMagicLink, authenticateRequest, recordUserActivity, getSessionStatus } from "./auth";
import { COOKIE_NAME } from "@shared/const";

const existingTeamLead = {
  id: 7,
  openId: "email:lead@example.com",
  email: "lead@example.com",
  name: "Team Lead",
  loginMethod: "email",
  role: "team_lead" as const,
  deactivatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

describe("magic-link access for existing accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countRecentMagicLinks.mockResolvedValue(0);
    mocks.getInviteByEmail.mockResolvedValue(undefined);
    mocks.getUserByOpenId.mockResolvedValue(existingTeamLead);
    mocks.createMagicLink.mockResolvedValue(undefined);
    mocks.sendEmail.mockResolvedValue(true);
  });

  it("emails an active existing team lead even when the accepted invite was cleaned up", async () => {
    const delivery = await requestMagicLink(" Lead@Example.com ", {
      ip: "127.0.0.1",
      protocol: "https",
      get: () => "example.com",
      socket: {},
    } as never, { awaitDelivery: true });

    expect(delivery).toBe("sent");
    expect(mocks.createMagicLink).toHaveBeenCalledWith(expect.objectContaining({ email: "lead@example.com" }));
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });

  it("accepts a valid link for that account without recreating it", async () => {
    mocks.getMagicLinkByTokenHash.mockResolvedValue({
      id: 11,
      email: "lead@example.com",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    mocks.markMagicLinkUsed.mockResolvedValue(true);
    mocks.createSession.mockResolvedValue(22);
    const cookie = vi.fn();

    const user = await verifyMagicLink("valid-token", {
      ip: "127.0.0.1",
      protocol: "https",
      headers: {},
      socket: {},
    } as never, { cookie } as never);

    expect(user).toEqual(existingTeamLead);
    expect(mocks.upsertUser).toHaveBeenCalledWith(expect.objectContaining({
      openId: existingTeamLead.openId,
      lastSignedIn: expect.any(Date),
    }));
    expect(mocks.markInviteAccepted).not.toHaveBeenCalled();
    expect(cookie).toHaveBeenCalledOnce();
  });
});

describe("invite links", () => {
  const pendingInvite = { email: "new@example.com", role: "staff", name: null, acceptedAt: null };
  const req = { ip: "127.0.0.1", protocol: "https", get: () => "example.com", headers: {}, socket: {} } as never;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.countRecentMagicLinks.mockResolvedValue(0);
    mocks.sendEmail.mockResolvedValue(true);
    mocks.markMagicLinkUsed.mockResolvedValue(true);
    mocks.createSession.mockResolvedValue(1);
  });

  it("sends an invite link that lasts 7 days and retires older invite links", async () => {
    mocks.getInviteByEmail.mockResolvedValue(pendingInvite);
    mocks.getUserByOpenId.mockResolvedValue(undefined);

    await requestMagicLink("new@example.com", req, { awaitDelivery: true, invitation: true });

    expect(mocks.deleteUnusedInviteLinks).toHaveBeenCalledWith("new@example.com");
    const link = mocks.createMagicLink.mock.calls[0][0];
    expect(link.forInvite).toBe(true);
    const lifetime = link.expiresAt.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(7 * 86400_000 - 60_000);
    expect(lifetime).toBeLessThanOrEqual(7 * 86400_000);
    expect(mocks.sendEmail.mock.calls[0][0].text).toContain("works for 7 days or until you accept the invitation");
  });

  it("keeps normal sign-in links at 15 minutes", async () => {
    mocks.getInviteByEmail.mockResolvedValue(undefined);
    mocks.getUserByOpenId.mockResolvedValue(existingTeamLead);

    await requestMagicLink("lead@example.com", req, { awaitDelivery: true });

    expect(mocks.deleteUnusedInviteLinks).not.toHaveBeenCalled();
    const link = mocks.createMagicLink.mock.calls[0][0];
    expect(link.forInvite).toBe(false);
    expect(link.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
  });

  it("accepts an old invite link while the invite is still pending", async () => {
    mocks.getMagicLinkByTokenHash.mockResolvedValue({
      id: 3, email: "new@example.com", forInvite: true, usedAt: null,
      createdAt: new Date(Date.now() - 5 * 86400_000), expiresAt: new Date(Date.now() + 2 * 86400_000),
    });
    mocks.getInviteByEmail.mockResolvedValue(pendingInvite);
    mocks.getUserByOpenId.mockResolvedValueOnce(undefined).mockResolvedValue(existingTeamLead);

    expect(await verifyMagicLink("token", req, { cookie: vi.fn() } as never)).toBeTruthy();
    expect(mocks.markInviteAccepted).toHaveBeenCalledWith("new@example.com");
  });

  it("rejects an invite link after 7 days even if the invite is still pending", async () => {
    mocks.getMagicLinkByTokenHash.mockResolvedValue({
      id: 5, email: "new@example.com", forInvite: true, usedAt: null, expiresAt: new Date(Date.now() - 1000),
    });
    mocks.getInviteByEmail.mockResolvedValue(pendingInvite);

    expect(await verifyMagicLink("token", req, { cookie: vi.fn() } as never)).toBeNull();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ["accepted", { ...pendingInvite, acceptedAt: new Date() }],
    ["revoked", undefined],
  ])("rejects an invite link once the invite is %s", async (_label, invite) => {
    mocks.getMagicLinkByTokenHash.mockResolvedValue({
      id: 4, email: "new@example.com", forInvite: true, usedAt: null, expiresAt: new Date(Date.now() + 2 * 86400_000),
    });
    mocks.getInviteByEmail.mockResolvedValue(invite);
    mocks.getUserByOpenId.mockResolvedValue(existingTeamLead);

    expect(await verifyMagicLink("token", req, { cookie: vi.fn() } as never)).toBeNull();
    expect(mocks.markMagicLinkUsed).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

describe("optional invited account names", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getMagicLinkByTokenHash.mockResolvedValue({ id: 1, email: "new@example.com", expiresAt: new Date(Date.now() + 60_000), usedAt: null });
    mocks.markMagicLinkUsed.mockResolvedValue(true);
    mocks.getUserByOpenId.mockResolvedValueOnce(undefined).mockResolvedValue(existingTeamLead);
    mocks.createSession.mockResolvedValue(1);
  });
  it.each([[null, null], ["", null], ["  Assigned Name  ", "Assigned Name"]])("uses invited name %s without inventing a name from the email", async (name, expected) => {
    mocks.getInviteByEmail.mockResolvedValue({ role: "team_lead", name });
    await verifyMagicLink("token", { headers: {}, socket: {} } as never, { cookie: vi.fn() } as never);
    expect(mocks.upsertUser).toHaveBeenCalledWith(expect.objectContaining({ name: expected, role: "team_lead" }));
  });
});

describe("email-link confirmation", () => {
  const routes = new Map<string, (req: Request, res: Response) => Promise<void>>();
  registerAuthRoutes({
    get: (path: string, handler: never) => routes.set(`GET ${path}`, handler),
    post: (path: string, handler: never) => routes.set(`POST ${path}`, handler),
  } as unknown as Express);

  function response() {
    return {
      setHeader: vi.fn(), type: vi.fn().mockReturnThis(), send: vi.fn(),
      redirect: vi.fn(), cookie: vi.fn(),
    };
  }

  function request(token = "valid-token") {
    return {
      query: { token }, body: { token }, headers: {}, ip: "127.0.0.1", protocol: "https", socket: {},
    } as unknown as Request;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getMagicLinkByTokenHash.mockResolvedValue({
      id: 11, email: existingTeamLead.email, expiresAt: new Date(Date.now() + 60_000), usedAt: null,
    });
    mocks.getUserByOpenId.mockResolvedValue(existingTeamLead);
    mocks.markMagicLinkUsed.mockResolvedValue(true);
    mocks.createSession.mockResolvedValue(22);
  });

  it("does not consume a link or create a session when it is opened repeatedly", async () => {
    const res = response();
    const open = routes.get("GET /api/auth/verify")!;
    await open(request(), res as unknown as Response);
    await open(request(), res as unknown as Response);
    expect(mocks.getMagicLinkByTokenHash).not.toHaveBeenCalled();
    expect(mocks.markMagicLinkUsed).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('method="post"'));
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("escapes untrusted tokens in the confirmation form", async () => {
    const res = response();
    await routes.get("GET /api/auth/verify")!(request('\"><script>alert(1)</script>'), res as unknown as Response);
    expect(res.send.mock.calls[0][0]).toContain('&quot;&gt;&lt;script&gt;');
    expect(res.send.mock.calls[0][0]).not.toContain("<script>");
  });

  it("consumes the link only after confirmation and sets a session cookie", async () => {
    const res = response();
    await routes.get("POST /api/auth/verify")!(request(), res as unknown as Response);
    expect(mocks.markMagicLinkUsed).toHaveBeenCalledWith(11);
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(res.cookie).toHaveBeenCalledOnce();
    expect(res.redirect).toHaveBeenCalledWith(303, "/board");
  });

  it.each(["used", "expired", "missing", "claimed concurrently"])("rejects a %s link without creating a session", async (state) => {
    if (state === "used") mocks.getMagicLinkByTokenHash.mockResolvedValue({ usedAt: new Date() });
    if (state === "expired") mocks.getMagicLinkByTokenHash.mockResolvedValue({ expiresAt: new Date(0) });
    if (state === "missing") mocks.getMagicLinkByTokenHash.mockResolvedValue(undefined);
    if (state === "claimed concurrently") mocks.markMagicLinkUsed.mockResolvedValue(false);
    const res = response();
    await routes.get("POST /api/auth/verify")!(request(), res as unknown as Response);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(303, "/login?error=invalid_or_expired");
  });

  it("keeps an already authenticated user signed in on a repeated confirmation", async () => {
    mocks.getMagicLinkByTokenHash.mockResolvedValue({ usedAt: new Date() });
    mocks.getSessionByTokenHash.mockResolvedValue({ id: 22, userId: existingTeamLead.id, expiresAt: new Date(Date.now() + 60_000) });
    mocks.getUserById.mockResolvedValue(existingTeamLead);
    mocks.touchSession.mockResolvedValue(undefined);
    const req = request();
    req.headers.cookie = `${COOKIE_NAME}=existing-session`;
    const res = response();
    await routes.get("POST /api/auth/verify")!(req, res as unknown as Response);
    expect(res.redirect).toHaveBeenCalledWith(303, "/board");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});


describe("shared-device session limits", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.getUserById.mockResolvedValue(existingTeamLead); mocks.touchSession.mockResolvedValue(undefined); });
  const req = () => ({ headers: { cookie: `${COOKIE_NAME}=valid-session` } }) as unknown as Request;
  const active = () => ({ id: 22, userId: 7, createdAt: new Date(Date.now() - 30 * 60_000), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400_000), revokedAt: null });
  it("does not extend an idle session for background authentication", async () => {
    mocks.getSessionByTokenHash.mockResolvedValue(active());
    expect(await authenticateRequest(req())).toEqual(existingTeamLead);
    expect(mocks.touchSession).not.toHaveBeenCalled();
    await recordUserActivity(req());
    expect(mocks.touchSession).toHaveBeenCalledWith(22);
  });
  it("rejects one-hour-idle sessions and previously issued sessions older than 24 hours", async () => {
    mocks.getSessionByTokenHash.mockResolvedValue({ ...active(), lastSeenAt: new Date(Date.now() - 3600_000) });
    expect(await authenticateRequest(req())).toBeNull();
    mocks.getSessionByTokenHash.mockResolvedValue({ ...active(), createdAt: new Date(Date.now() - 24 * 3600_000) });
    expect(await authenticateRequest(req())).toBeNull();
  });
  it("reports the earlier deadline for the save-work warning", async () => {
    const session = active(); mocks.getSessionByTokenHash.mockResolvedValue(session);
    expect(await getSessionStatus(req())).toMatchObject({ expiresAt: session.lastSeenAt.getTime() + 3600_000, canExtend: true });
  });
});
