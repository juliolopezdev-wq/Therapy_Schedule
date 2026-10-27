import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import type { Express, Request, Response } from "express";

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createClient> | null, sendEmail: vi.fn() }));
vi.mock("@libsql/client/http", () => ({ createClient: () => state.client }));
vi.mock("./_core/env", () => ({ ENV: { ownerEmail: "", appUrl: "https://example.com" } }));
vi.mock("./email", () => ({ isEmailConfigured: () => true, sendEmail: state.sendEmail }));

import { recordIncorrectSignIn, getSignInLock } from "./db";
import { getSignInStatus, registerAuthRoutes, requestSignInLink } from "./_core/auth";
import { appRouter } from "./routers";

const WAIT = 15 * 60_000;
const req = (ip = "192.0.2.1", client = "a".repeat(43)) => ({ ip, headers: { cookie: `sign_in_client=${client}` }, socket: {}, protocol: "https", get: () => "example.com" }) as unknown as Request;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "http://unused.invalid");
  state.client = createClient({ url: "file::memory:" });
  await state.client.executeMultiple(`
    CREATE TABLE signInAttempts (ipHash TEXT PRIMARY KEY NOT NULL, failures INTEGER NOT NULL, resetAt INTEGER NOT NULL, lockedUntil INTEGER DEFAULT 0 NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, openId TEXT, name TEXT, email TEXT, loginMethod TEXT, role TEXT, deactivatedAt INTEGER, createdAt INTEGER, updatedAt INTEGER, lastSignedIn INTEGER);
    CREATE TABLE invites (id INTEGER PRIMARY KEY, email TEXT, role TEXT, invitedByUserId INTEGER, createdAt INTEGER, acceptedAt INTEGER);
    CREATE TABLE magicLinks (id INTEGER PRIMARY KEY, email TEXT, tokenHash TEXT, expiresAt INTEGER, usedAt INTEGER, ipAddress TEXT, createdAt INTEGER);
  `);
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  state.sendEmail.mockReset().mockResolvedValue(true);
  await state.client!.executeMultiple(`DELETE FROM signInAttempts; DELETE FROM magicLinks; DELETE FROM users; DELETE FROM invites;
    INSERT INTO invites VALUES (1, 'invited@gmail.com', 'staff', 1, 1, NULL);`);
});
afterEach(() => vi.useRealTimers());
afterAll(() => { state.client?.close(); vi.unstubAllEnvs(); });

describe("persistent browser sign-in lock", () => {
  it("uses a separate high-volume throttle when clients reset cookies", async () => {
    for (let i = 0; i < 99; i++) {
      const result = await requestSignInLink("bad", req("192.0.2.1", String(i).padStart(43, "x")));
      expect(result.lockedUntil).toBe(0);
    }
    expect((await requestSignInLink("bad", req("192.0.2.1", "z".repeat(43)))).lockedUntil).toBe(Date.now() + WAIT);
    expect((await getSignInStatus(req("192.0.2.1", "w".repeat(43)))).lockedUntil).toBe(Date.now() + WAIT);
  });
  it("locks after a mixture of malformed and uninvited emails, and blocks invited addresses too", async () => {
    expect((await requestSignInLink("bad-address", req())).invalidFormat).toBe(true);
    expect((await requestSignInLink("unknown@example.com", req())).lockedUntil).toBe(0);
    const third = await requestSignInLink("also-unknown@example.com", req());
    expect(third.lockedUntil).toBe(Date.now() + WAIT);
    expect((await requestSignInLink("invited@gmail.com", req())).lockedUntil).toBe(third.lockedUntil);
    expect(state.sendEmail).not.toHaveBeenCalled();
    expect((await getSignInStatus(req())).lockedUntil).toBe(third.lockedUntil);
  });

  it("unlocks automatically at exactly 15 minutes and resets failures", async () => {
    for (let i = 0; i < 3; i++) await requestSignInLink("bad", req());
    vi.setSystemTime(Date.now() + WAIT - 1);
    expect((await getSignInStatus(req())).lockedUntil).toBeGreaterThan(Date.now());
    vi.setSystemTime(Date.now() + 1);
    expect((await getSignInStatus(req())).lockedUntil).toBe(0);
    expect((await requestSignInLink("invited@gmail.com", req())).lockedUntil).toBe(0);
    expect(state.sendEmail).toHaveBeenCalledOnce();
    expect((await requestSignInLink("bad", req())).lockedUntil).toBe(0);
  });

  it("does not extend the lock when more requests arrive", async () => {
    for (let i = 0; i < 3; i++) await requestSignInLink("bad", req());
    const original = await getSignInStatus(req());
    vi.setSystemTime(Date.now() + 60_000);
    expect((await requestSignInLink("bad", req())).lockedUntil).toBe(original.lockedUntil);
  });

  it("isolates browsers sharing an IP", async () => {
    for (let i = 0; i < 3; i++) await requestSignInLink("bad", req());
    expect((await getSignInStatus(req())).lockedUntil).toBeGreaterThan(0);
    expect((await requestSignInLink("invited@gmail.com", req("192.0.2.1", "b".repeat(43)))).lockedUntil).toBe(0);
    expect(state.sendEmail).toHaveBeenCalledOnce();
  });

  it("does not count valid invited emails as incorrect attempts", async () => {
    await requestSignInLink("bad", req());
    await requestSignInLink(" Invited@Gmail.com ", req());
    expect((await requestSignInLink("bad", req())).lockedUntil).toBe(0);
    expect((await requestSignInLink("bad", req())).lockedUntil).toBeGreaterThan(0);
    expect(state.sendEmail).toHaveBeenCalledOnce();
  });

  it("expires incomplete failure windows after 15 minutes", async () => {
    await requestSignInLink("bad", req());
    await requestSignInLink("bad", req());
    vi.setSystemTime(Date.now() + WAIT);
    expect((await requestSignInLink("bad", req())).lockedUntil).toBe(0);
  });

  it("counts simultaneous failures atomically and preserves active locks", async () => {
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 3 }, () => recordIncorrectSignIn("network-hash", now)));
    expect(results.filter(value => value > 0)).toHaveLength(1);
    expect(await recordIncorrectSignIn("network-hash", now + 1000)).toBe(now + WAIT);
    expect(await getSignInLock("network-hash")).toBe(now + WAIT);
  });

  it("applies the same lock to the REST request-link endpoint", async () => {
    const routes = new Map<string, (req: Request, res: Response) => Promise<void>>();
    registerAuthRoutes({ get: () => {}, post: (path: string, handler: never) => routes.set(path, handler) } as unknown as Express);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
    for (let i = 0; i < 3; i++) await routes.get("/api/auth/request-link")!({ ...req(), body: { email: "bad" } } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenLastCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "900");
    expect((await getSignInStatus(req())).lockedUntil).toBe(Date.now() + WAIT);
  });

  it("counts malformed input through tRPC and shares its lock with REST", async () => {
    const caller = appRouter.createCaller({ req: req(), res: {} as Response, user: null });
    await caller.auth.requestLink({ email: "bad" });
    await caller.auth.requestLink({ email: "bad" });
    expect((await caller.auth.requestLink({ email: "bad" })).lockedUntil).toBe(Date.now() + WAIT);
    expect((await caller.auth.signInStatus()).lockedUntil).toBe(Date.now() + WAIT);
    expect((await requestSignInLink("invited@gmail.com", req())).lockedUntil).toBe(Date.now() + WAIT);
    expect(state.sendEmail).not.toHaveBeenCalled();
  });
});
