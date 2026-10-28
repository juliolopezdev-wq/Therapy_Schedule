import { afterEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

const authenticateRequest = vi.hoisted(() => vi.fn());
vi.mock("./_core/auth", () => ({ authenticateRequest }));

import { notifyDataChanged, registerLiveUpdates, shouldNotify } from "./liveUpdates";

function connect() {
  let handler: (req: unknown, res: unknown) => Promise<void> = async () => {};
  registerLiveUpdates({ get: (_path: string, h: typeof handler) => { handler = h; } } as unknown as Express);
  const closeHandlers: Array<() => void> = [];
  const req = { on: (_event: string, fn: () => void) => closeHandlers.push(fn) };
  const res = { writeHead: vi.fn(), write: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() };
  return { open: () => handler(req, res), res, close: () => closeHandlers.forEach((fn) => fn()) };
}

const changeEvents = (write: ReturnType<typeof vi.fn>) =>
  write.mock.calls.filter(([chunk]) => String(chunk).startsWith("event: change")).length;

afterEach(() => vi.useRealTimers());

describe("live updates", () => {
  it("refuses a browser that isn't signed in", async () => {
    authenticateRequest.mockResolvedValue(null);
    const browser = connect();
    await browser.open();
    expect(browser.res.status).toHaveBeenCalledWith(401);
    expect(browser.res.writeHead).not.toHaveBeenCalled();
  });

  it("sends one change signal for a burst of saves, and none after the tab closes", async () => {
    vi.useFakeTimers();
    authenticateRequest.mockResolvedValue({ id: 1 });
    const browser = connect();
    await browser.open();
    expect(String(browser.res.write.mock.calls[0][0])).toMatch(/^event: version/);

    notifyDataChanged();
    notifyDataChanged();
    notifyDataChanged();
    vi.advanceTimersByTime(500);
    expect(changeEvents(browser.res.write)).toBe(1);

    browser.close();
    notifyDataChanged();
    vi.advanceTimersByTime(500);
    expect(changeEvents(browser.res.write)).toBe(1);
  });

  it("skips saves that change nothing others see", () => {
    expect(shouldNotify("directMessages.setTyping")).toBe(false);
    expect(shouldNotify("auth.activity")).toBe(false);
    expect(shouldNotify("sessions.update")).toBe(true);
    expect(shouldNotify("directMessages.markRead")).toBe(true);
  });
});
