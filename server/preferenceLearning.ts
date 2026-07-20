import { getRecentScheduleOverrides, getTherapists } from "./db";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Coarse time-of-day bucket for an hour-of-day (0-23), used to group overrides so "moved off
 *  overnight Fridays 3 times" reads as one pattern rather than three different exact times. */
function timeBucket(hour: number): string {
  if (hour < 6 || hour >= 20) return "overnight";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** How many times the same (therapist, day-of-week, time-of-day) combination has to be
 *  overridden before it's confident enough to feed back to PAMi as a standing preference.
 *  Kept low -- this is a small unit, so 2 independent overrides of the same slot already is a
 *  real signal, not noise. */
const PATTERN_THRESHOLD = 2;

/** How far back to look for override patterns. Older overrides age out so a preference that
 *  was true 6 months ago (e.g. before a therapist changed availability) doesn't stick around
 *  forever -- this is meant to track *current* actual preferences, not permanent history. */
const LOOKBACK_DAYS = 90;

/**
 * Mines server/db.ts's scheduleOverrides log for recurring (therapist, day-of-week, time-of-day)
 * patterns -- the "self-correcting feedback loop": every time a human moves, reassigns, or
 * cancels a session PAMi booked, that's one data point. Once the same slot has been overridden
 * enough times, this turns it into a plain-language standing preference and returns it as a block
 * of text meant to be injected as its own system message in askScheduler (see server/ollama.ts) --
 * so staff don't have to keep re-explaining the same rule (e.g. "don't put Karin overnight on
 * Fridays") in every conversation.
 *
 * Returns "" when nothing meets the threshold yet, so the caller can skip adding an empty/noisy
 * system message.
 */
export async function getLearnedPreferencesContext(referenceDate: Date = new Date()): Promise<string> {
  const since = new Date(referenceDate.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const [overrides, therapists] = await Promise.all([
    getRecentScheduleOverrides(since),
    getTherapists(),
  ]);

  const relevant = overrides.filter((o) => o.therapistId != null);
  if (relevant.length === 0) return "";

  const therapistNames = new Map(therapists.map((t) => [t.id, t.name]));

  type GroupKey = string;
  const groups = new Map<GroupKey, { therapistId: number; dayOfWeek: number; bucket: string; count: number }>();

  for (const o of relevant) {
    const start = new Date(o.originalStartTime);
    const dayOfWeek = start.getDay();
    const bucket = timeBucket(start.getHours());
    const key: GroupKey = `${o.therapistId}|${dayOfWeek}|${bucket}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      groups.set(key, { therapistId: o.therapistId as number, dayOfWeek, bucket, count: 1 });
    }
  }

  const patterns = Array.from(groups.values())
    .filter((g) => g.count >= PATTERN_THRESHOLD)
    .sort((a, b) => b.count - a.count);

  if (patterns.length === 0) return "";

  const lines = patterns.map((p) => {
    const name = therapistNames.get(p.therapistId) ?? `Therapist ${p.therapistId}`;
    const dayLabel = DAY_NAMES[p.dayOfWeek];
    const bucketLabel = p.bucket === "overnight" ? "overnight" : `in the ${p.bucket}`;
    return `- ${name}: staff have moved, reassigned, or cancelled her/his ${dayLabel} ${bucketLabel} bookings ${p.count} times -- avoid scheduling ${name} ${bucketLabel} on ${dayLabel}s unless the user specifically asks for it.`;
  });

  return (
    `Learned scheduling preferences (mined from ${relevant.length} staff override(s) of PAMi's own past bookings over the last ${LOOKBACK_DAYS} days). ` +
    `Treat these as standing constraints -- apply them automatically without asking again, the same way you would a rule the user stated out loud. ` +
    `If the user's current request directly contradicts one of these, follow the user's explicit request and mention you're overriding the learned pattern this one time.\n` +
    lines.join("\n")
  );
}
