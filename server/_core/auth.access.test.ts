import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countRecentMagicLinks: vi.fn(),
  getInviteByEmail: vi.fn(),
  getUserByOpenId: vi.fn(),
  createMagicLink: vi.fn(),
  getMagicLinkByTokenHash: vi.fn(),
  markMagicLinkUsed: vi.fn(),
  upsertUser: vi.fn(),
  markInviteAccepted: vi.fn(),
  createSession: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("../db", () => ({
  ...mocks,
}));

vi.mock("../email", () => ({
  isEmailConfigured: () => true,
  sendEmail: mocks.sendEmail,
}));

import { requestMagicLink, verifyMagicLink } from "./auth";

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
    mocks.markMagicLinkUsed.mockResolvedValue(undefined);
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
