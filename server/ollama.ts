import { ENV } from "./_core/env";
import {
  getWeeklyMinutesSummary,
  getGapFillSuggestions,
  autoScheduleAllGaps,
  autoSchedulePatientGaps,
  getJointCommissionAnalytics,
  getTeamRoster,
  getDeliveryModeMix,
  getCalendarView,
} from "./scheduling";
import {
  createTherapySession,
  updateTherapySession,
  deleteTherapySession,
  getSessionById,
  clearSchedule,
  getStatusFlagsForDate,
  movePatientSessionsToNextDay,
  copyPatientSessionsToNextDay,
  copyDayToNextDay,
  logAiAction,
  getUndoableActions,
  markAiActionUndone,
} from "./db";
import { formatWeekRangeLabel, isMissedStatus, WeeklyMinutesSummary } from "../shared/weekUtils";

/* ========================================================================== */
/* THE PROMPT                                                                  */
/*                                                                            */
/* This is what makes the assistant genuinely useful for this app instead of */
/* a generic chatbot bolted onto a database. Tune the wording here freely -- */
/* nothing else in this file needs to change.                                */
/* ========================================================================== */

export const SCHEDULER_SYSTEM_PROMPT = `You are PAMi, an expert AI scheduling assistant embedded in a rehab therapy unit's scheduling app. You help staff fill therapy-minute gaps, balance therapist workload, stay Joint Commission compliant, and keep every patient on track to hit their weekly therapy-minute target before their personalized week resets.

CONTEXT YOU'RE GIVEN
Before every question you receive a live snapshot: Joint Commission/rehab analytics for the past 7 days (including a breakdown of missed sessions by reason -- refusal, clinical hold, staffing, other), every active patient's weekly minute progress broken out as scheduled / delivered / missed / still-pending minutes (each patient's week starts on their own admission day, not a shared Monday), which patients are on Medical Hold or otherwise flagged today, open-slot suggestions for anyone behind target, and the team roster (which therapists are assigned to which patients, by ID). Treat this data as ground truth. Never invent patients, therapists, room numbers, IDs, or times that aren't in it. If something isn't in the data, say so plainly instead of guessing.

DELIVERED VS. SCHEDULED -- ALWAYS SAY WHICH ONE YOU MEAN
A patient can look on-track from scheduled minutes alone and still miss target if those sessions get marked missed later in the week. Every time you cite a patient's minutes, be explicit about whether you mean minutes actually delivered (completed) or minutes booked/still-pending. "At risk" in the data is already a projection -- it accounts for remaining scheduled sessions, not just a same-day snapshot -- so when asked who's at risk and why, cite the specific missed-session reasons or the shortfall in projected total, not just "behind on minutes."

WHO'S UNAVAILABLE
A patient on Medical Hold cannot receive therapy right now -- never suggest scheduling a session for them, and don't count them as a "care gap" even if they haven't had therapy recently (the data already excludes them from care gaps for this reason). Other flags (Group Appropriate, Male/Female Therapist Only, Home Eval, Family Training, etc.) describe scheduling constraints on that patient -- factor them in when relevant.

WHO CAN SEE WHOM
Therapists are grouped into teams, and each patient belongs to one team. A therapist can technically treat anyone, but normally only treats patients on their own team -- that's the coverage rule staff care about. When asked who can see or cover a patient, answer with therapists on that patient's team first. Only suggest an off-team therapist if the roster shows nobody on-team is free, and say so explicitly when you do (e.g. "nobody on Team 2 is open Thursday, but Alex from Team 1 is free at 10am").

CONCURRENT / GROUP MINUTE CAP
PDPM caps combined concurrent + group minutes at 25% of a patient's total minutes per discipline per week. When booking or moving a session with delivery mode "concurrent" or "group", the tool result will tell you if that patient's discipline is now over the cap -- if so, warn the user plainly (don't silently place it, and don't refuse to place it either; it's a warning, not a block).

DOUBLE-BOOKING IS BLOCKED, NOT JUST WARNED
The system will not let you create or move a session on top of another session for the same patient, or the same therapist (unless every overlapping session involved is concurrent/group -- that's a legitimate shared slot, not a conflict). If a write tool fails for this reason, its error will name exactly who's double-booked and with what; read it and offer the closest real open alternative instead of retrying the same time. Bulk tools (auto_schedule_all_gaps, auto_schedule_patient_gaps, copy_day_to_next_day, copy_patient_sessions_to_next_day, transfer_patient_sessions_to_next_day) skip individual conflicts rather than failing the whole batch -- their result includes a skippedConflicts count; if it's non-zero, tell the user plainly how many were skipped and that those specific gaps still need a manual look, don't just report the successful count.

YOUR JOB, IN ORDER OF PRIORITY
1. Surface what needs attention first, even if not asked directly: patients behind on minutes -- especially anyone "at risk" -- any Joint Commission care gaps (0 minutes in the last 48 hours, excluding Medical Hold; each gap lists exactly how many days it's actually been, so treat a 2-day gap and a 9-day gap with different urgency, don't flatten them into one bucket), any concentration of missed sessions by reason (a staffing-driven pattern is different from a refusal pattern), and any day a team has nobody free. Also lead with these when present, unprompted, the same way: a REFUSAL PATTERN (a specific, data-backed suggestion -- pass it along, don't just say "this patient refuses sometimes"), any session in NEEDS A STATUS UPDATE (it already happened -- staff should mark it completed/missed so the numbers above stay accurate), and a therapist whose productivity is notably low (lots of open capacity, worth reassigning gap-fill toward them) or notably high (over ~95%, at risk of being overloaded).
2. Recommend specific, concrete fixes: which patient, which therapist, what time, how many minutes. Never give vague advice like "schedule more sessions." If a GROUP THERAPY OPPORTUNITY is listed and relevant, suggest it by name (which patients, which discipline) instead of only individual slots -- it's real therapist-time savings within PDPM's 25% concurrent/group allowance.
3. When asked to actually do something (add, move, cancel a session, or auto-fill every gap), use your tools to make the real change, then confirm exactly what changed.
4. Stay grounded in this unit's actual numbers. Cite room numbers/names, exact times, and minutes whenever you reference a patient or slot.

USING YOUR TOOLS
- You have read tools (list_open_slots, get_at_risk_patients, get_team_roster, get_analytics, get_delivery_mode_mix, view_calendar) and write tools (create_session, move_session, copy_session, cancel_session, auto_schedule_all_gaps, auto_schedule_patient_gaps, transfer_patient_sessions_to_next_day, copy_patient_sessions_to_next_day, copy_day_to_next_day, clear_schedule, undo_last_action).
- Use read tools freely and proactively whenever more detail would help -- no need to ask permission to look something up.
- Your default context only covers today (plus gap-fill suggestions for patients behind target). Use view_calendar for anything about a different day, a date range, or a specific patient's/therapist's actual booked schedule -- e.g. "what's on the calendar Thursday", "what does Room 214 have next week", "is therapist 6 free at 2pm Friday".
- The gap-fill suggestions list is capped to the 6 most urgent patients behind target (at-risk first, then furthest behind) to keep the context brief -- if more exist, they're named explicitly with a note telling you to call list_open_slots for them. If asked broadly "who needs help" and that note is present, don't stop at the 6 shown -- mention the omitted patients by name too, and look them up if the user wants specifics.
- Only use a write tool when the user has clearly asked for that action ("add", "schedule", "book", "move", "reschedule", "copy", "duplicate", "paste", "cancel", "remove", "fill every gap", "auto-schedule", "clear schedule", "transfer to tomorrow", "copy to tomorrow", "undo", "revert"). Never make a change the user didn't ask for -- recommend it and let them confirm instead.
- clear_schedule specifically needs a confirmation round-trip before it executes, even when timeframe/therapist are already unambiguous: state what will be cleared (how many sessions if you know, which therapist(s), which timeframe) and wait for an explicit "yes"/"confirm"/"do it" in their next reply. Don't call the tool in the same turn you first mention it.
- Prefer the precise tool over the blunt one: if the user names a specific patient, use create_session/move_session/copy_session for that one patient. Only use auto_schedule_all_gaps or copy_day_to_next_day when they clearly mean everyone.
- Use transfer_patient_sessions_to_next_day if asked to *move* a specific patient's sessions to tomorrow.
- Use copy_patient_sessions_to_next_day if asked to *copy* or *duplicate* a specific patient's sessions to tomorrow.
- Use copy_session if asked to copy, duplicate, or "paste" a specific session to a new time or therapist.
- Use auto_schedule_patient_gaps if asked to add available therapists to a specific patient to complete their weekly minutes. Both auto-schedule tools now pick PT/OT/SLP per patient based on their actual shortfall against ptTarget/otTarget/slpTarget (falling back to PT only when a patient has none of those three set) -- the result's byDiscipline breakdown tells you what was actually booked, so report it (e.g. "booked 3 PT, 2 OT") instead of just a total count.
- Every write tool you use is remembered, so if the user says "undo that", "undo the last change", or "revert", call undo_last_action -- it reverses your most recent change(s) in order (booking, move, copy, cancel, auto-schedule, transfer, or clear), most recent first. If they say "undo the last 3" or similar, pass that count. If nothing is left to undo, or an undo fails partway (e.g. someone already changed that session manually), say exactly what did and didn't get reversed -- don't claim a full undo if it wasn't.
- If a write tool fails, or the slot/therapist turns out not to be free, say so plainly and offer the closest real alternative from the data. Don't claim it worked if it didn't.
- After a successful write, state plainly what changed (patient, therapist, day, time, duration, or how many sessions were auto-scheduled) so staff can verify it on the board, and pass along any cap warning the tool returned.

STYLE
- Be direct and concise. Lead with the answer, then supporting detail.
- Use short bullet lists when comparing multiple patients, therapists, or slots.
- Speak like a sharp scheduling coordinator, not a generic chatbot -- no filler, no "I'd be happy to help!", no AI disclaimers.
- Talk like a person, not a report generator. Vary sentence structure, use contractions, react naturally ("Yeah, three of hers are still unmarked" beats "The following 3 sessions require status updates:"). Bullet lists are for comparing multiple concrete items (patients/therapists/slots), not the default format for every answer -- a one- or two-sentence conversational reply is often the better fit, especially for a quick yes/no or single-fact question.
- Never mention tool or function names (create_session, auto_schedule_all_gaps, get_analytics, etc.) to the user -- those are internal implementation details, not something staff should ever see or need to know about. Describe what you're doing or offering in plain language instead: not "I can call auto_schedule_all_gaps" but "I can go ahead and fill the most urgent openings across the unit" -- not "use auto_schedule_patient_gaps for the patients listed above" but "or just focus on the patients listed above, if you'd rather start smaller."
- Don't give up and cite a "data limitation" without actually checking first. If asked something specific your default context doesn't spell out by name (e.g. "which patient had that refusal," "who was the no-show yesterday"), use your tools to go find the real answer (view_calendar or get_analytics can usually narrow it down) before telling the user the data doesn't say -- only say that after you've actually looked and it's genuinely not findable, and say specifically what you checked.
- If a question is ambiguous (e.g. which patient "Sarah" refers to when there are two), ask exactly one clarifying question instead of guessing.
- This is a multi-turn conversation -- use the prior messages for context (e.g. "her" or "that slot" may refer to something a few turns back) instead of asking the user to repeat themselves.`;

/* ========================================================================== */
/* Tool definitions (Ollama / OpenAI-style function-calling schema)           */
/* ========================================================================== */

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_open_slots",
      description:
        "Find open therapy slots for one specific patient this week, matched to an available therapist (their own team preferred). Use when asked about gaps, open slots, or how to help a specific patient catch up.",
      parameters: {
        type: "object",
        properties: {
          patientId: { type: "integer", description: "The patient's numeric ID from the roster context." },
        },
        required: ["patientId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_at_risk_patients",
      description:
        "List every active patient behind on their weekly minute target, sorted by how far behind they are. Use whenever asked broadly who needs help, who's behind, or about staffing gaps.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_team_roster",
      description:
        "List every team with its assigned therapists and active patients -- i.e. which therapists can see which patients. Use when asked who can see/cover a patient, who's on a team, or about coverage.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_analytics",
      description:
        "Get Joint Commission / rehab compliance analytics for the past 7 days: compliance counts, therapy-type minute breakdown, therapist utilization, and care gaps. Use for any metrics, compliance, or utilization question.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "view_calendar",
      description:
        "Look up the actual booked schedule (real session-by-session calendar, not the gap-fill projections) for a date or date range, optionally narrowed to one patient and/or one therapist. Use whenever asked what's on the calendar/schedule for a specific day, week, patient, or therapist -- especially days outside today, which aren't in your default context.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "ISO 8601 date, e.g. 2026-07-20. The first day to include." },
          endDate: {
            type: "string",
            description: "ISO 8601 date. Omit to view just startDate alone.",
          },
          patientId: { type: "integer", description: "Omit to include all patients." },
          therapistId: { type: "integer", description: "Omit to include all therapists." },
        },
        required: ["startDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_session",
      description:
        "Schedule a brand-new therapy session for one patient. Only call when the user explicitly asks to add, schedule, or book a session for a specific patient.",
      parameters: {
        type: "object",
        properties: {
          patientId: { type: "integer" },
          therapistId: { type: "integer" },
          therapyType: { type: "string", enum: ["PT", "OT", "SLP", "Eval"] },
          startTime: { type: "string", description: "ISO 8601 datetime, e.g. 2026-06-18T09:00:00" },
          durationMinutes: { type: "integer" },
          deliveryMode: {
            type: "string",
            enum: ["individual", "concurrent", "group"],
            description: "Defaults to individual. If concurrent or group, the result will flag whether this pushes the patient's discipline over the 25% PDPM cap.",
          },
        },
        required: ["patientId", "therapistId", "therapyType", "startTime", "durationMinutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_session",
      description:
        "Reschedule an existing session to a new time and/or a new therapist. Only call when the user explicitly asks to move, reschedule, or reassign a session.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "integer" },
          newStartTime: { type: "string", description: "ISO 8601 datetime" },
          newTherapistId: { type: "integer", description: "Omit to keep the same therapist." },
        },
        required: ["sessionId", "newStartTime"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "copy_session",
      description:
        "Copy/duplicate an existing session to a new time and/or a new therapist. Use this when the user asks to 'paste' or 'copy' a session instead of moving it.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "integer" },
          newStartTime: { type: "string", description: "ISO 8601 datetime" },
          newTherapistId: { type: "integer", description: "Omit to keep the same therapist." },
        },
        required: ["sessionId", "newStartTime"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_delivery_mode_mix",
      description:
        "Check what percentage of a patient's minutes in a given discipline this week were delivered concurrently or in a group, against the 25% PDPM cap. Use before recommending or booking a concurrent/group session, or when asked about mix/cap compliance.",
      parameters: {
        type: "object",
        properties: {
          patientId: { type: "integer" },
          therapyType: { type: "string", enum: ["PT", "OT", "SLP", "Eval"] },
        },
        required: ["patientId", "therapyType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_session",
      description:
        "Cancel and delete an existing session. Only call when the user explicitly asks to cancel or remove a session.",
      parameters: {
        type: "object",
        properties: { sessionId: { type: "integer" } },
        required: ["sessionId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_schedule_all_gaps",
      description:
        "Book every recommended gap-fill session for every patient currently behind target, across the whole unit. Only call when the user clearly means everyone (e.g. 'fill all the gaps', 'maximize minutes for the unit') -- not for a single named patient.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_schedule_patient_gaps",
      description:
        "Book recommended gap-fill sessions for a specific patient to help them reach their weekly target. Use when the user asks to 'add available therapists to the patient to complete their weekly minutes'.",
      parameters: {
        type: "object",
        properties: {
          patientId: { type: "integer", description: "The patient's numeric ID" },
        },
        required: ["patientId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transfer_patient_sessions_to_next_day",
      description:
        "Move/transfer all of a specific patient's scheduled sessions for today to tomorrow. Use when asked to 'move certain patients' or 'transfer their sessions to tomorrow'.",
      parameters: {
        type: "object",
        properties: {
          patientId: { type: "integer", description: "The patient's numeric ID" },
        },
        required: ["patientId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "copy_patient_sessions_to_next_day",
      description:
        "Copy/duplicate all of a specific patient's scheduled sessions for today to tomorrow. Use when asked to 'copy' or 'duplicate' their sessions to tomorrow.",
      parameters: {
        type: "object",
        properties: {
          patientId: { type: "integer", description: "The patient's numeric ID" },
        },
        required: ["patientId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "copy_day_to_next_day",
      description:
        "Copy/duplicate the entire unit's schedule from today to tomorrow. Use when asked to 'copy today's schedule' or 'paste today's sessions to tomorrow' without naming a specific patient.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_schedule",
      description:
        "Clear all scheduled sessions for a specific therapist or ALL therapists. If the user doesn't specify whether to clear the 'daily' (just today) or 'weekly' (whole week) schedule, you MUST ask them to clarify before executing. If they don't specify a therapist, it clears the schedule for ALL therapists. This is high-blast-radius and irreversible-feeling to staff even though undo_last_action can restore it -- you MUST state exactly what will be cleared (timeframe, therapist(s) affected) and get an explicit yes in a reply before calling this tool, even if the original request sounded like a direct command.",
      parameters: {
        type: "object",
        properties: {
          timeframe: { type: "string", enum: ["daily", "weekly"], description: "Whether to clear the schedule for just today or the entire week." },
          therapistId: { type: "integer", description: "The ID of the therapist whose schedule to clear. Omit to clear ALL therapists." },
        },
        required: ["timeframe"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undo_last_action",
      description:
        "Reverse the most recent change(s) PAMi made to the schedule -- a booking, move, cancel, auto-schedule, transfer to next day, or schedule clear. Only call when the user explicitly asks to undo, revert, or roll back a recent change. Defaults to undoing just the single most recent action; pass count to walk back further, most recent first.",
      parameters: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            description: "How many of the most recent actions to undo, most recent first. Defaults to 1.",
          },
        },
      },
    },
  },
] as const;

/* ========================================================================== */
/* Context builder -- the live "ground truth" handed to the model each turn   */
/* ========================================================================== */

export async function buildSchedulerContext(referenceDate: Date = new Date()): Promise<string> {
  const summary = await getWeeklyMinutesSummary(referenceDate);
  const lines: string[] = [];
  lines.push(
    `Today is ${referenceDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}.`,
  );
  lines.push("");

  const analytics = await getJointCommissionAnalytics(referenceDate);
  lines.push("=== JOINT COMMISSION & REHAB ANALYTICS (Past 7 Days) ===");
  lines.push(
    `Compliance: ${analytics.compliance.onTarget} on target, ${analytics.compliance.atRisk} at risk (Total Active: ${analytics.compliance.totalActive})`,
  );
  lines.push(
    `Therapy Breakdown: PT: ${analytics.therapyBreakdown.PT} min, OT: ${analytics.therapyBreakdown.OT} min, SLP: ${analytics.therapyBreakdown.SLP} min, Eval: ${analytics.therapyBreakdown.Eval} min`,
  );
  lines.push("Therapist Utilization & Productivity (scheduled min / available shift min, past 7 days; SNF rehab typically targets ~90-95%):");
  analytics.therapistUtilization.forEach((t) =>
    lines.push(
      `- ${t.name}: ${t.scheduledMinutes} min scheduled / ${t.availableMinutes} min available` +
        (t.productivityPct == null ? " (no shift hours in this window)" : ` — ${t.productivityPct}% productivity`),
    ),
  );
  if (analytics.careGaps.length > 0) {
    lines.push("CRITICAL GAPS IN CARE (0 minutes in last 48 hours, excluding Medical Hold patients):");
    analytics.careGaps.forEach((g) =>
      lines.push(
        `- Room ${g.roomNumber} (${g.patientName}) — ${g.daysWithoutTherapy == null ? "no therapy session on record at all" : `${g.daysWithoutTherapy} day(s) without therapy`}`,
      ),
    );
  } else {
    lines.push("Gaps in Care: None (All eligible patients have received therapy recently)");
  }
  const missed = analytics.missedSessionsByReason;
  const totalMissed = missed.missed_refusal + missed.missed_clinical_hold + missed.missed_staffing + missed.missed_other;
  lines.push(
    `Missed Sessions by Reason (past 7 days, total ${totalMissed}): refusal ${missed.missed_refusal}, clinical hold ${missed.missed_clinical_hold}, staffing ${missed.missed_staffing}, other ${missed.missed_other}.`,
  );
  if (analytics.missedSessionsDetail.length > 0) {
    lines.push("Missed Sessions, individually (so 'which patient' is always answerable, not just a count):");
    analytics.missedSessionsDetail.forEach((m) =>
      lines.push(
        `- Room ${m.roomNumber} (${m.patientName}), ${m.therapyType}, ${m.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}: ${m.reason}${m.missedReason ? ` (${m.missedReason})` : ""}.`,
      ),
    );
  }
  if (analytics.refusalPatterns.length > 0) {
    lines.push("REFUSAL PATTERNS (last 14 days, trending toward chronic):");
    analytics.refusalPatterns.forEach((r) =>
      lines.push(`- Room ${r.roomNumber} (${r.patientName}): ${r.suggestion}`),
    );
  }
  if (analytics.groupTherapyOpportunities.length > 0) {
    lines.push("GROUP THERAPY OPPORTUNITIES (Group Appropriate + same team + same discipline shortfall):");
    analytics.groupTherapyOpportunities.forEach((g) =>
      lines.push(
        `- ${g.teamName}, ${g.therapyType}: ${g.patients.map((p) => `Room ${p.roomNumber} (${p.name}, id ${p.id})`).join(", ")}`,
      ),
    );
  }
  if (analytics.staleSessions.length > 0) {
    lines.push(`NEEDS A STATUS UPDATE (${analytics.staleSessions.length} session(s) today already ended but still marked "scheduled"):`);
    analytics.staleSessions.forEach((s) =>
      lines.push(
        `- Session #${s.sessionId}: Room ${s.roomNumber} (${s.patientName}), ${s.therapyType}, ended ${s.endTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`,
      ),
    );
  }
  lines.push("==========================================================");

  if (summary.length === 0) {
    lines.push("");
    lines.push("No active (non-discharged) patients on the board right now.");
    return lines.join("\n");
  }

  const todaysFlags = await getStatusFlagsForDate(referenceDate);
  const flagsByPatient = new Map<number, string[]>();
  for (const f of todaysFlags) {
    if (!flagsByPatient.has(f.patientId)) flagsByPatient.set(f.patientId, []);
    flagsByPatient.get(f.patientId)!.push(f.flagType);
  }

  lines.push("");
  lines.push("=== WEEKLY MINUTE PROGRESS (per patient, personalized week) -- delivered vs. scheduled shown separately ===");
  const underTarget: WeeklyMinutesSummary[] = [];
  for (const p of summary) {
    const status = p.remainingMinutes <= 0 ? "ON TARGET" : p.atRisk ? "AT RISK (projected to miss target)" : "behind, but still projected to catch up";
    const flags = flagsByPatient.get(p.patientId);
    const flagNote = flags && flags.length > 0 ? ` Flags today: ${flags.join(", ")}.` : "";
    lines.push(
      `- [id ${p.patientId}] Room ${p.roomNumber} (${p.patientName}), team ${p.teamId ?? "none"}: ` +
        `delivered ${p.completedMinutes} min, missed ${p.missedMinutes} min, still-pending ${p.pendingMinutes} min, ` +
        `projected total ${p.projectedTotalMinutes}/${p.target} min (${formatWeekRangeLabel(p.weekStart)}), ` +
        `${p.remainingMinutes} min still needed to deliver, ${p.daysRemaining} day(s) left. Status: ${status}.${flagNote}`,
    );
    if (p.remainingMinutes > 0 && !(flags ?? []).includes("Medical Hold")) underTarget.push(p);
  }

  if (underTarget.length > 0) {
    lines.push("");
    lines.push("=== NEEDS ATTENTION: open-slot suggestions for patients behind target ===");
    // Most urgent first -- at-risk patients, then furthest behind -- so if the list below is
    // truncated, it's the least-urgent patients that get cut, not whoever happened to sort
    // first by room number.
    const sortedUnderTarget = [...underTarget].sort((a, b) => {
      if (a.atRisk !== b.atRisk) return a.atRisk ? -1 : 1;
      return b.remainingMinutes - a.remainingMinutes;
    });
    const SHOWN_PATIENT_CAP = 6;
    const shown = sortedUnderTarget.slice(0, SHOWN_PATIENT_CAP);
    for (const p of shown) {
      const suggestions = await getGapFillSuggestions(p.patientId, referenceDate);
      if (suggestions.length === 0) {
        lines.push(`- Room ${p.roomNumber} (${p.patientName}): no open slots found this week.`);
        continue;
      }
      lines.push(`- Room ${p.roomNumber} (${p.patientName}):`);
      for (const s of suggestions.slice(0, 4)) {
        const when = s.startTime.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
        lines.push(
          `    • ${when}, ${s.durationMinutes} min — therapist id ${s.therapistId} (${s.therapistName}). ${s.reason}`,
        );
      }
    }
    const omitted = sortedUnderTarget.slice(SHOWN_PATIENT_CAP);
    if (omitted.length > 0) {
      lines.push(
        `- (+${omitted.length} more patient(s) behind target not shown here to keep this brief: ` +
          `${omitted.map((p) => `Room ${p.roomNumber} (${p.patientName})`).join(", ")}. ` +
          `Call list_open_slots with their patient id if asked about them specifically.)`,
      );
    }
  }

  const roster = await getTeamRoster();
  lines.push("");
  lines.push("=== TEAM ROSTER (who can see whom) ===");
  for (const team of roster) {
    const therapistList =
      team.therapists.length > 0
        ? team.therapists.map((t) => `${t.name} (id ${t.id})`).join(", ")
        : "no therapists assigned";
    const patientList =
      team.patients.length > 0
        ? team.patients.map((p) => `Room ${p.roomNumber} ${p.name} (id ${p.id})`).join(", ")
        : "no patients assigned";
    lines.push(`- ${team.teamName} [team id ${team.teamId}]: therapists: ${therapistList}; patients: ${patientList}.`);
  }

  return lines.join("\n");
}

/* ========================================================================== */
/* Tool execution -- where "the AI can make changes" actually happens         */
/* ========================================================================== */

interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

/** Warn (never block) when a just-booked concurrent/group session pushes a discipline over the 25% PDPM cap. */
async function checkConcurrentGroupCap(
  patientId: number,
  therapyType: "PT" | "OT" | "SLP" | "Eval",
  deliveryMode: "individual" | "concurrent" | "group",
  referenceDate: Date,
): Promise<string | null> {
  if (deliveryMode === "individual") return null;
  const mix = await getDeliveryModeMix(patientId, therapyType, referenceDate);
  if (!mix.overCap) return null;
  return `Warning: patient ${patientId}'s ${therapyType} minutes are now ${mix.pct}% concurrent/group this week, over the 25% PDPM cap (${mix.concurrentGroupMinutes}/${mix.totalMinutes} min).`;
}

/**
 * Reverses one logged PAMi write action. Each actionType's undoData shape is set where
 * it's logged in executeTool below -- keep the two in sync when adding a new write tool.
 * Throws (rather than silently no-op'ing) when the underlying data has moved out from
 * under it, e.g. a session that's since been deleted by someone else -- the caller stops
 * the undo chain there instead of reporting a false success.
 */
async function reverseAiAction(entry: {
  id: number;
  actionType: string;
  description: string;
  undoData: unknown;
}): Promise<string> {
  const data = entry.undoData as Record<string, any>;

  switch (entry.actionType) {
    case "create_session": {
      const existing = await getSessionById(data.sessionId);
      if (!existing) throw new Error("that session no longer exists");
      await deleteTherapySession(data.sessionId);
      return `Removed the session booked by "${entry.description}"`;
    }

    case "move_session": {
      const existing = await getSessionById(data.sessionId);
      if (!existing) throw new Error("that session no longer exists");
      await updateTherapySession(data.sessionId, {
        startTime: new Date(data.previousStartTime),
        endTime: new Date(data.previousEndTime),
        therapistId: data.previousTherapistId,
      });
      return `Moved session ${data.sessionId} back to its previous time`;
    }

    case "cancel_session": {
      const s = data.session;
      const recreated = await createTherapySession({
        patientId: s.patientId,
        therapistId: s.therapistId,
        therapyType: s.therapyType,
        startTime: new Date(s.startTime),
        endTime: new Date(s.endTime),
        durationMinutes: s.durationMinutes,
        actualDurationMinutes: s.actualDurationMinutes ?? undefined,
        deliveryMode: s.deliveryMode,
        status: s.status,
        missedReason: s.missedReason ?? undefined,
        notes: s.notes ?? undefined,
      });
      return `Restored the cancelled session (now session ${recreated.id})`;
    }

    case "auto_schedule_all_gaps":
    case "auto_schedule_patient_gaps": {
      const ids: number[] = data.sessionIds ?? [];
      for (const id of ids) {
        await deleteTherapySession(id).catch(() => {});
      }
      return `Removed ${ids.length} auto-scheduled session(s)`;
    }

    case "transfer_patient_sessions_to_next_day": {
      const ids: number[] = data.sessionIds ?? [];
      let reverted = 0;
      for (const id of ids) {
        const existing = await getSessionById(id);
        if (!existing) continue;
        await updateTherapySession(id, {
          startTime: new Date(new Date(existing.startTime).getTime() - 24 * 60 * 60 * 1000),
          endTime: new Date(new Date(existing.endTime).getTime() - 24 * 60 * 60 * 1000),
        });
        reverted++;
      }
      return `Moved ${reverted} session(s) back a day`;
    }

    case "copy_session":
    case "copy_patient_sessions_to_next_day":
    case "copy_day_to_next_day": {
      const ids: number[] = data.sessionIds ?? (data.sessionId ? [data.sessionId] : []);
      let reverted = 0;
      for (const id of ids) {
        const existing = await getSessionById(id);
        if (existing) {
          await deleteTherapySession(id);
          reverted++;
        }
      }
      return `Removed ${reverted} copied session(s)`;
    }

    case "clear_schedule": {
      const sessions: any[] = data.sessions ?? [];
      for (const s of sessions) {
        await createTherapySession({
          patientId: s.patientId,
          therapistId: s.therapistId,
          therapyType: s.therapyType,
          startTime: new Date(s.startTime),
          endTime: new Date(s.endTime),
          durationMinutes: s.durationMinutes,
          actualDurationMinutes: s.actualDurationMinutes ?? undefined,
          deliveryMode: s.deliveryMode,
          status: s.status,
          missedReason: s.missedReason ?? undefined,
          notes: s.notes ?? undefined,
        });
      }
      return `Restored ${sessions.length} session(s) from the cleared schedule`;
    }

    default:
      throw new Error(`don't know how to undo "${entry.actionType}"`);
  }
}

/**
 * `new Date("2026-07-15")` parses as UTC midnight, which lands on the *previous* local day
 * in any negative-UTC-offset timezone (e.g. becomes July 14, 6pm in Mountain Time) -- exactly
 * the kind of date-only string a tool-calling model sends for a bare "startDate"/"endDate"
 * arg. Parse date-only strings as local midnight instead; anything with a time component
 * (e.g. from create_session's ISO datetime args) parses as before.
 */
function parseLocalDate(input: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  return new Date(input);
}

async function executeTool(call: ToolCall, referenceDate: Date): Promise<string> {
  const { name, arguments: args } = call.function;

  try {
    switch (name) {
      case "list_open_slots": {
        const suggestions = await getGapFillSuggestions(Number(args.patientId), referenceDate);
        return JSON.stringify(suggestions);
      }

      case "get_at_risk_patients": {
        const summary = await getWeeklyMinutesSummary(referenceDate);
        const atRisk = summary
          .filter((p) => p.atRisk)
          .sort((a, b) => (b.target - b.projectedTotalMinutes) - (a.target - a.projectedTotalMinutes));
        return JSON.stringify(atRisk);
      }

      case "get_team_roster": {
        return JSON.stringify(await getTeamRoster());
      }

      case "get_analytics": {
        return JSON.stringify(await getJointCommissionAnalytics(referenceDate));
      }

      case "view_calendar": {
        const startDate = parseLocalDate(String(args.startDate));
        const endDate = args.endDate ? parseLocalDate(String(args.endDate)) : startDate;
        const patientId = args.patientId != null ? Number(args.patientId) : undefined;
        const therapistId = args.therapistId != null ? Number(args.therapistId) : undefined;
        const entries = await getCalendarView(startDate, endDate, { patientId, therapistId });
        return JSON.stringify(entries);
      }

      case "create_session": {
        const startTime = new Date(String(args.startTime));
        const durationMinutes = Number(args.durationMinutes);
        const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);
        const patientId = Number(args.patientId);
        const therapyType = String(args.therapyType) as "PT" | "OT" | "SLP" | "Eval";
        const deliveryMode = (args.deliveryMode ? String(args.deliveryMode) : "individual") as
          | "individual"
          | "concurrent"
          | "group";
        const created = await createTherapySession({
          patientId,
          therapistId: Number(args.therapistId),
          therapyType,
          startTime,
          endTime,
          durationMinutes,
          deliveryMode,
          notes: "Booked by PAMi",
        });
        const capWarning = await checkConcurrentGroupCap(patientId, therapyType, deliveryMode, referenceDate);
        await logAiAction({
          actionType: "create_session",
          description: `Booked a ${therapyType} session for patient ${patientId} at ${startTime.toLocaleString()}`,
          undoData: { sessionId: created.id },
        });
        return JSON.stringify({ ok: true, action: "created", session: created, capWarning });
      }

      case "move_session": {
        const sessionId = Number(args.sessionId);
        const existing = await getSessionById(sessionId);
        if (!existing) return JSON.stringify({ ok: false, error: `No session with id ${sessionId} exists.` });

        const newStartTime = new Date(String(args.newStartTime));
        const newEndTime = new Date(newStartTime.getTime() + existing.durationMinutes * 60_000);
        const update: Record<string, unknown> = { startTime: newStartTime, endTime: newEndTime };
        if (args.newTherapistId != null) update.therapistId = Number(args.newTherapistId);

        const updated = await updateTherapySession(sessionId, update);
        await logAiAction({
          actionType: "move_session",
          description: `Moved session ${sessionId} from ${existing.startTime.toLocaleString()} to ${newStartTime.toLocaleString()}`,
          undoData: {
            sessionId,
            previousStartTime: existing.startTime,
            previousEndTime: existing.endTime,
            previousTherapistId: existing.therapistId,
          },
        });
        return JSON.stringify({ ok: true, action: "moved", session: updated });
      }

      case "copy_session": {
        const sessionId = Number(args.sessionId);
        const existing = await getSessionById(sessionId);
        if (!existing) return JSON.stringify({ ok: false, error: `No session with id ${sessionId} exists.` });

        const newStartTime = new Date(String(args.newStartTime));
        const newEndTime = new Date(newStartTime.getTime() + existing.durationMinutes * 60_000);
        
        const copied = await createTherapySession({
          patientId: existing.patientId,
          therapistId: args.newTherapistId != null ? Number(args.newTherapistId) : existing.therapistId,
          therapyType: existing.therapyType,
          startTime: newStartTime,
          endTime: newEndTime,
          durationMinutes: existing.durationMinutes,
          deliveryMode: existing.deliveryMode,
          notes: "Copied by PAMi",
        });

        await logAiAction({
          actionType: "copy_session",
          description: `Copied session ${sessionId} to ${newStartTime.toLocaleString()}`,
          undoData: { sessionId: copied.id },
        });
        return JSON.stringify({ ok: true, action: "copied", session: copied });
      }

      case "cancel_session": {
        const sessionId = Number(args.sessionId);
        const existing = await getSessionById(sessionId);
        if (!existing) return JSON.stringify({ ok: false, error: `No session with id ${sessionId} exists.` });
        await deleteTherapySession(sessionId);
        await logAiAction({
          actionType: "cancel_session",
          description: `Cancelled session ${sessionId} for patient ${existing.patientId}`,
          undoData: {
            session: {
              patientId: existing.patientId,
              therapistId: existing.therapistId,
              therapyType: existing.therapyType,
              startTime: existing.startTime,
              endTime: existing.endTime,
              durationMinutes: existing.durationMinutes,
              actualDurationMinutes: existing.actualDurationMinutes,
              deliveryMode: existing.deliveryMode,
              status: existing.status,
              missedReason: existing.missedReason,
              notes: existing.notes,
            },
          },
        });
        return JSON.stringify({ ok: true, action: "cancelled", sessionId });
      }

      case "auto_schedule_all_gaps": {
        const result = await autoScheduleAllGaps(referenceDate);
        if (result.count > 0) {
          await logAiAction({
            actionType: "auto_schedule_all_gaps",
            description: `Auto-scheduled ${result.count} session(s) across the unit`,
            undoData: { sessionIds: result.sessionIds },
          });
        }
        return JSON.stringify({ ok: true, action: "auto_scheduled", count: result.count, skippedConflicts: result.skippedConflicts, byDiscipline: result.byDiscipline });
      }

      case "auto_schedule_patient_gaps": {
        const patientId = Number(args.patientId);
        const result = await autoSchedulePatientGaps(patientId, referenceDate);
        if (result.count > 0) {
          await logAiAction({
            actionType: "auto_schedule_patient_gaps",
            description: `Auto-scheduled ${result.count} session(s) for patient ${patientId}`,
            undoData: { sessionIds: result.sessionIds },
          });
        }
        return JSON.stringify({ ok: true, action: "auto_scheduled_patient", count: result.count, skippedConflicts: result.skippedConflicts, byDiscipline: result.byDiscipline });
      }

      case "transfer_patient_sessions_to_next_day": {
        const patientId = Number(args.patientId);
        const result = await movePatientSessionsToNextDay(patientId, referenceDate);
        if (result.count > 0) {
          await logAiAction({
            actionType: "transfer_patient_sessions_to_next_day",
            description: `Transferred ${result.count} session(s) for patient ${patientId} to tomorrow`,
            undoData: { sessionIds: result.sessionIds },
          });
        }
        return JSON.stringify({ ok: true, action: "transferred_sessions", count: result.count, skippedConflicts: result.skippedConflicts });
      }

      case "copy_patient_sessions_to_next_day": {
        const patientId = Number(args.patientId);
        const result = await copyPatientSessionsToNextDay(patientId, referenceDate);
        if (result.count > 0) {
          await logAiAction({
            actionType: "copy_patient_sessions_to_next_day",
            description: `Copied ${result.count} session(s) for patient ${patientId} to tomorrow`,
            undoData: { sessionIds: result.sessionIds },
          });
        }
        return JSON.stringify({ ok: true, action: "copied_patient_sessions", count: result.count, skippedConflicts: result.skippedConflicts });
      }

      case "copy_day_to_next_day": {
        const result = await copyDayToNextDay(referenceDate);
        if (result.count > 0) {
          await logAiAction({
            actionType: "copy_day_to_next_day",
            description: `Copied today's schedule to tomorrow (${result.count} session(s))`,
            undoData: { sessionIds: result.sessionIds },
          });
        }
        return JSON.stringify({ ok: true, action: "copied_day", count: result.count, skippedConflicts: result.skippedConflicts });
      }

      case "clear_schedule": {
        const timeframe = String(args.timeframe) as "daily" | "weekly";
        const therapistId = args.therapistId ? Number(args.therapistId) : undefined;
        const result = await clearSchedule(timeframe, referenceDate, therapistId);
        if (result.deletedSessions.length > 0) {
          await logAiAction({
            actionType: "clear_schedule",
            description: `Cleared ${timeframe} schedule${therapistId ? ` for therapist ${therapistId}` : " for all therapists"} (${result.deletedSessions.length} session(s))`,
            undoData: {
              sessions: result.deletedSessions.map((s) => ({
                patientId: s.patientId,
                therapistId: s.therapistId,
                therapyType: s.therapyType,
                startTime: s.startTime,
                endTime: s.endTime,
                durationMinutes: s.durationMinutes,
                actualDurationMinutes: s.actualDurationMinutes,
                deliveryMode: s.deliveryMode,
                status: s.status,
                missedReason: s.missedReason,
                notes: s.notes,
              })),
            },
          });
        }
        return JSON.stringify({ ok: true, action: "cleared_schedule", timeframe, therapistId, count: result.deletedSessions.length });
      }

      case "get_delivery_mode_mix": {
        const mix = await getDeliveryModeMix(
          Number(args.patientId),
          String(args.therapyType) as "PT" | "OT" | "SLP" | "Eval",
          referenceDate,
        );
        return JSON.stringify(mix);
      }

      case "undo_last_action": {
        const count = args.count ? Math.max(1, Math.min(20, Number(args.count))) : 1;
        const actions = await getUndoableActions(count);
        if (actions.length === 0) {
          return JSON.stringify({ ok: false, error: "Nothing to undo -- no recent PAMi actions found." });
        }

        const undone: string[] = [];
        let stoppedEarly: string | null = null;
        for (const action of actions) {
          try {
            const desc = await reverseAiAction(action);
            await markAiActionUndone(action.id);
            undone.push(desc);
          } catch (err) {
            stoppedEarly = err instanceof Error ? err.message : String(err);
            break; // keep the undo chain strictly LIFO -- don't skip over a broken entry
          }
        }
        return JSON.stringify({ ok: undone.length > 0, action: "undone", undone, stoppedEarly });
      }

      default:
        return JSON.stringify({ ok: false, error: `Unknown tool "${name}".` });
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ ok: false, error: reason });
  }
}

function describeAction(toolName: string, resultJson: string): string | null {
  try {
    const result = JSON.parse(resultJson);
    if (!result.ok) return null;
    // Bulk booking tools can silently skip a suggestion that would've double-booked a
    // therapist/patient (a real conflict slipped in between suggestion and insert) -- surface
    // that in the action chip so it's visible on the board, not just buried in the chat reply.
    const conflictSuffix = result.skippedConflicts > 0 ? ` (${result.skippedConflicts} skipped -- conflict)` : "";
    if (toolName === "create_session") return "Created a new session";
    if (toolName === "move_session") return "Moved a session";
    if (toolName === "copy_session") return "Copied a session";
    if (toolName === "cancel_session") return "Cancelled a session";
    if (toolName === "auto_schedule_all_gaps") return `Auto-scheduled ${result.count} session(s)${conflictSuffix}`;
    if (toolName === "auto_schedule_patient_gaps") return `Auto-scheduled ${result.count} session(s) for patient${conflictSuffix}`;
    if (toolName === "transfer_patient_sessions_to_next_day") return `Transferred ${result.count} session(s) to tomorrow${conflictSuffix}`;
    if (toolName === "copy_patient_sessions_to_next_day") return `Copied ${result.count} session(s) to tomorrow${conflictSuffix}`;
    if (toolName === "copy_day_to_next_day") return `Copied ${result.count} session(s) to tomorrow${conflictSuffix}`;
    if (toolName === "clear_schedule") return `Cleared ${result.timeframe} schedule${result.therapistId ? ` for therapist ID ${result.therapistId}` : " for all therapists"}`;
    if (toolName === "undo_last_action") return `Undid ${result.undone.length} action(s)`;
    return null;
  } catch {
    return null;
  }
}

/* ========================================================================== */
/* Main entry point                                                          */
/* ========================================================================== */

export interface OllamaAskResult {
  answer: string;
  model: string;
  usedFallback: boolean;
  actionsTaken: string[];
}

const MAX_TOOL_ITERATIONS = 4;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const READ_ONLY_TOOL_NAMES = new Set([
  "list_open_slots",
  "get_at_risk_patients",
  "get_team_roster",
  "get_analytics",
  "get_delivery_mode_mix",
  "view_calendar",
]);
const READ_ONLY_TOOLS = TOOLS.filter((t) => READ_ONLY_TOOL_NAMES.has(t.function.name));

/**
 * Runs the shared Ollama tool-calling loop: sends messages + tools, executes any tool
 * calls the model makes against live data, feeds the results back, and repeats until
 * the model returns a plain text answer or the iteration cap is hit. Shared by both
 * askScheduler (full read/write tools) and analyzeData (read-only tools).
 */
async function runToolLoop(
  messages: Array<{ role: string; content: string; tool_calls?: ToolCall[] }>,
  tools: typeof TOOLS | typeof READ_ONLY_TOOLS,
  referenceDate: Date,
  fallbackContext: string,
): Promise<OllamaAskResult> {
  const actionsTaken: string[] = [];
  const OLLAMA_BASE_URL = ENV.ollamaBaseUrl;
  const OLLAMA_MODEL = ENV.ollamaModel;
  const OLLAMA_API_KEY = ENV.ollamaApiKey;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY) headers["Authorization"] = `Bearer ${OLLAMA_API_KEY}`;

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: OLLAMA_MODEL, messages, tools, stream: false }),
      });

      if (!res.ok) throw new Error(`Ollama returned ${res.status}`);

      const data = (await res.json()) as { message?: { content?: string; tool_calls?: ToolCall[] } };
      const message = data.message;
      if (!message) throw new Error("Ollama response had no message");

      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push({ role: "assistant", content: message.content ?? "", tool_calls: message.tool_calls });

        for (const call of message.tool_calls) {
          const resultJson = await executeTool(call, referenceDate);
          const described = describeAction(call.function.name, resultJson);
          if (described) actionsTaken.push(described);
          messages.push({ role: "tool", content: resultJson });
        }
        continue; // let the model see tool results and respond again
      }

      return {
        answer: message.content?.trim() || "(Ollama returned an empty response.)",
        model: OLLAMA_MODEL,
        usedFallback: false,
        actionsTaken,
      };
    }

    return {
      answer: "Reached the tool-call limit for this turn. Try asking a more specific follow-up.",
      model: OLLAMA_MODEL,
      usedFallback: false,
      actionsTaken,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      answer:
        `Couldn't reach Ollama at ${OLLAMA_BASE_URL} (${reason}). ` +
        `Run "ollama serve" and "ollama pull ${OLLAMA_MODEL}" on this machine, then try again. ` +
        `(Use a tool-calling model -- llama3.1 or qwen2.5 -- so the assistant can actually look things up and make changes.)\n\n` +
        `In the meantime, here's the raw scheduling data:\n\n${fallbackContext}`,
      model: OLLAMA_MODEL,
      usedFallback: true,
      actionsTaken: [],
    };
  }
}

const DATA_ANALYSIS_SYSTEM_PROMPT = `You are PAMi, the same AI scheduling assistant used elsewhere in this app, now answering questions about a specific historical data table the user is looking at (minutes delivered per discharged patient, for a date range and patient filter they've chosen).

- Answer primarily from the table data you're given below -- that's what's on the user's screen, so ground your numbers in it.
- You also have read-only tools (get_analytics, get_at_risk_patients, get_team_roster, get_delivery_mode_mix, list_open_slots, view_calendar) if the user asks something the table alone can't answer (e.g. comparing to current active patients, unit-wide compliance, or what was actually on the calendar for a given day). Use them freely.
- You cannot make changes here (no create/move/cancel/auto-schedule tools) -- if asked to book or change something, tell the user to use the main "Ask PAMi" panel on the board instead.
- Be concise, accurate, and cite exact numbers/names from the data.`;

/**
 * Sends a question to Ollama (local or the configured cloud endpoint) with
 * tool-calling enabled, so the model can both look up live scheduling data
 * and make real, precise changes -- a single session move, a single new
 * booking, or (only when clearly asked) a full auto-schedule of every gap.
 * Requires a tool-calling-capable model (llama3.1 and qwen2.5 both support
 * tools in Ollama).
 */
export async function askScheduler(
  question: string,
  referenceDate: Date = new Date(),
  history: ChatTurn[] = [],
): Promise<OllamaAskResult> {
  const context = await buildSchedulerContext(referenceDate);
  const messages: Array<{ role: string; content: string; tool_calls?: ToolCall[] }> = [
    { role: "system", content: SCHEDULER_SYSTEM_PROMPT },
    { role: "system", content: `Current scheduling data:\n${context}` },
    // Prior turns give the model conversational memory (e.g. "her" or "that slot" referring a few turns back).
    // Only user/assistant text is replayed -- tool calls from earlier turns aren't resent since the live
    // scheduling data above already supersedes them.
    ...history.slice(-12).map((h) => ({ role: h.role as string, content: h.content })),
    { role: "user", content: question },
  ];
  return runToolLoop(messages, TOOLS, referenceDate, context);
}

export async function analyzeData(
  question: string,
  contextData: string,
  referenceDate: Date = new Date(),
  history: ChatTurn[] = [],
): Promise<OllamaAskResult> {
  const messages: Array<{ role: string; content: string; tool_calls?: ToolCall[] }> = [
    { role: "system", content: DATA_ANALYSIS_SYSTEM_PROMPT },
    { role: "system", content: `Table Data:\n${contextData}` },
    ...history.slice(-12).map((h) => ({ role: h.role as string, content: h.content })),
    { role: "user", content: question },
  ];
  return runToolLoop(messages, READ_ONLY_TOOLS, referenceDate, contextData);
}
