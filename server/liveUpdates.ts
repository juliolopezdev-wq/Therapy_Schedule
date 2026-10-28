import type { Express, Response } from "express";
import { authenticateRequest } from "./_core/auth";

// Tells every open browser "something changed, reload what you're showing". The signal carries
// no data -- each browser refetches through the normal API, with its own access rules.

// Changes when a new version is deployed, so open tabs can offer a reload.
export const APP_VERSION = process.env.RENDER_GIT_COMMIT || String(Date.now());

const HEARTBEAT_MS = 25_000;
const NOTIFY_DELAY_MS = 300;

const clients = new Set<Response>();
let pending: ReturnType<typeof setTimeout> | null = null;

// Saves that don't change anything other people see.
const QUIET_MUTATIONS = new Set([
  "auth.requestLink",
  "auth.activity",
  "auth.logout",
  "directMessages.setTyping",
  "charting.logView",
  "ai.askScheduler",
  "ai.analyzeData",
]);

export function shouldNotify(path: string) {
  return !QUIET_MUTATIONS.has(path);
}

/** Several saves in a row (a drag, a bulk complete) go out as one signal. */
export function notifyDataChanged() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    for (const res of Array.from(clients)) res.write("event: change\ndata: {}\n\n");
  }, NOTIFY_DELAY_MS);
}

export function registerLiveUpdates(app: Express) {
  app.get("/api/live", async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: version\ndata: ${JSON.stringify(APP_VERSION)}\n\n`);
    clients.add(res);
    // proxies drop connections that stay silent too long
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  });
}
