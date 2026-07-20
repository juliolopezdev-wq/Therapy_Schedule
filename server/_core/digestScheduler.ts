import { getOrCreateTodaysDigest } from "../scheduling";
import { sendAtRiskDigestEmailIfNeeded } from "../atRiskDigestEmail";

// Local hour the digest should exist by -- before the board's own 7am grid start, so it's ready
// the moment the first shift-start check happens.
const MORNING_HOUR = 6;
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 min

async function ensureTodaysDigestIfPastMorningHour(): Promise<void> {
  const now = new Date();
  if (now.getHours() < MORNING_HOUR) return;
  try {
    await getOrCreateTodaysDigest(now);
  } catch (error) {
    // Never let a digest failure take the server down -- this is a background convenience,
    // not a request in flight. getOrCreateTodaysDigest is also called lazily from the
    // digest.today tRPC query, so a failure here just means that lazy path covers it instead.
    console.error("[digestScheduler] Failed to generate morning digest:", error);
  }

  // Proactive notification: rather than only surfacing at-risk patients when someone opens the
  // board or asks PAMi, email the configured recipients once today's digest has at-risk entries.
  // sendAtRiskDigestEmailIfNeeded is itself idempotent-per-day, so it's safe to call on every tick.
  try {
    await sendAtRiskDigestEmailIfNeeded(now);
  } catch (error) {
    console.error("[digestScheduler] Failed to send at-risk digest email:", error);
  }
}

/**
 * Starts the in-process morning gap-fill digest job. This alone is NOT a reliable "runs every
 * morning" guarantee on a host that can spin an idle instance down overnight (e.g. Render's
 * free/starter tiers) -- if nothing wakes the process before staff arrive, this loop simply
 * isn't running yet either. The real guarantee is the combination of this periodic check (for
 * whenever the server happens to be warm) plus the identical getOrCreateTodaysDigest() call in
 * the digest.today tRPC query (server/routers.ts) -- whichever happens first, this loop or the
 * first real page load/PAMi turn that morning, generates and persists it, and every path after
 * that just reads the cached row.
 */
export function startDigestScheduler(): void {
  // Cover the case where the process starts mid-morning (e.g. a cold start at 9am) instead of
  // waiting up to CHECK_INTERVAL_MS for the first periodic check.
  void ensureTodaysDigestIfPastMorningHour();
  setInterval(() => {
    void ensureTodaysDigestIfPastMorningHour();
  }, CHECK_INTERVAL_MS);
}
