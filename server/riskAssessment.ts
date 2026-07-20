// Pure, no DB/IO imports -- deliberately, so this can be called from server/db.ts,
// server/scheduling.ts, and server/ollama.ts alike without any circular-import risk. Callers do
// their own fetching and hand in plain data.

export type RiskTier = "low" | "medium" | "high";

/**
 * Baseline tier per write tool, before any escalation checks. Confirmation is specifically for
 * the three named categories (PRN therapist, discharge-adjacent patient, short-staffed team) --
 * so everything defaults to auto-execute (low) unless one of those escalation checks bumps a
 * specific call to high. clear_schedule is the one exception: it already required an explicit
 * confirmation round-trip before this risk-tier system existed (a unit-wide/therapist-wide wipe,
 * whole schedules at once), so it keeps that as its baseline rather than starting from scratch.
 * Bulk copy/transfer tools default to low too -- they're additive/reversible (undo_last_action
 * covers all of them), matching "rebalancing a day" in spirit even at multi-session scale.
 */
export const TOOL_BASE_RISK: Record<string, RiskTier> = {
  create_session: "low",
  copy_session: "low",
  move_session: "low",
  cancel_session: "low",
  auto_schedule_all_gaps: "low",
  auto_schedule_patient_gaps: "low",
  transfer_patient_sessions_to_next_day: "low",
  copy_patient_sessions_to_next_day: "low",
  copy_day_to_next_day: "low",
  clear_schedule: "high",
};

export interface RiskAssessment {
  tier: RiskTier;
  /** Human-readable reasons this specific call is at this tier -- passed straight into the
   *  confirmation message shown to the user, so keep these plain-language and specific. */
  reasons: string[];
}

export interface RiskContext {
  toolName: string;
  /** Set when the therapist involved is PRN/per-diem staff. */
  therapistIsPRN?: { name: string } | null;
  /** Set when the patient involved is flagged for discharge today. */
  patientDischargeFlagged?: boolean;
  /** Set when the patient's team has at most one therapist actually working that day. */
  teamShortStaffed?: boolean;
}

/** Resolves the actual risk tier for one specific tool call from pre-fetched context. */
export function assessActionRisk(ctx: RiskContext): RiskAssessment {
  const baseTier = TOOL_BASE_RISK[ctx.toolName] ?? "low";
  const reasons: string[] = [];
  let tier = baseTier;

  if (ctx.therapistIsPRN) {
    tier = "high";
    reasons.push(`${ctx.therapistIsPRN.name} is PRN/per-diem staff -- their availability isn't guaranteed the way regular staff's is.`);
  }
  if (ctx.patientDischargeFlagged) {
    tier = "high";
    reasons.push("This patient is flagged for discharge -- scheduling around a discharge needs a human decision.");
  }
  if (ctx.teamShortStaffed) {
    tier = "high";
    reasons.push("This patient's team has one or zero therapists working that day -- a short-staffed shift shouldn't be filled without a human checking coverage first.");
  }

  return { tier, reasons };
}

/** A team is "short-staffed" for a date if at most one of its therapists is actually scheduled
 *  to work that day (by workDays -- unset workDays is treated as always-available, matching how
 *  gap-fill already treats a therapist with no shift restriction set). */
export function isTeamShortStaffed(teamTherapists: Array<{ workDays: string | null }>, date: Date): boolean {
  if (teamTherapists.length === 0) return true;
  const workingToday = teamTherapists.filter((t) => {
    if (!t.workDays) return true;
    const days = new Set(t.workDays.split(",").map(Number));
    return days.has(date.getDay());
  });
  return workingToday.length <= 1;
}
