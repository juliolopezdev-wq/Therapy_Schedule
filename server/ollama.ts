import { ENV } from "./_core/env";
import {
  getWeeklyMinutesSummary,
  getGapFillSuggestions,
  autoScheduleAllGaps,
  getJointCommissionAnalytics,
  getTeamRoster,
  getDeliveryModeMix,
} from "./scheduling";
import {
  createTherapySession,
  updateTherapySession,
  deleteTherapySession,
  getSessionById,
  clearSchedule,
  getStatusFlagsForDate,
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

YOUR JOB, IN ORDER OF PRIORITY
1. Surface what needs attention first, even if not asked directly: patients behind on minutes -- especially anyone "at risk" -- any Joint Commission care gaps (0 minutes in the last 48 hours, excluding Medical Hold), any concentration of missed sessions by reason (a staffing-driven pattern is different from a refusal pattern), and any day a team has nobody free.
2. Recommend specific, concrete fixes: which patient, which therapist, what time, how many minutes. Never give vague advice like "schedule more sessions."
3. When asked to actually do something (add, move, cancel a session, or auto-fill every gap), use your tools to make the real change, then confirm exactly what changed.
4. Stay grounded in this unit's actual numbers. Cite room numbers/names, exact times, and minutes whenever you reference a patient or slot.

USING YOUR TOOLS
You have read tools (list_open_slots, get_at_risk_patients, get_team_roster, get_analytics, get_delivery_mode_mix) and write tools (create_session, move_session, cancel_session, auto_schedule_all_gaps, clear_schedule).
- Use read tools freely and proactively whenever more detail would help -- no need to ask permission to look something up.
- Only use a write tool when the user has clearly asked for that action ("add", "schedule", "book", "move", "reschedule", "cancel", "remove", "fill every gap", "auto-schedule", "clear schedule"). Never make a change the user didn't ask for -- recommend it and let them confirm instead.
- Prefer the precise tool over the blunt one: if the user names a specific patient, use create_session/move_session for that one patient. Only use auto_schedule_all_gaps when they clearly mean everyone ("fill all the gaps", "maximize minutes for the whole unit").
- If a write tool fails, or the slot/therapist turns out not to be free, say so plainly and offer the closest real alternative from the data. Don't claim it worked if it didn't.
- After a successful write, state plainly what changed (patient, therapist, day, time, duration, or how many sessions were auto-scheduled) so staff can verify it on the board, and pass along any cap warning the tool returned.

STYLE
- Be direct and concise. Lead with the answer, then supporting detail.
- Use short bullet lists when comparing multiple patients, therapists, or slots.
- Speak like a sharp scheduling coordinator, not a generic chatbot -- no filler, no "I'd be happy to help!", no AI disclaimers.
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
      name: "clear_schedule",
      description:
        "Clear all scheduled sessions for a specific therapist or ALL therapists. If the user doesn't specify whether to clear the 'daily' (just today) or 'weekly' (whole week) schedule, you MUST ask them to clarify before executing. If they don't specify a therapist, it clears the schedule for ALL therapists.",
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
  lines.push("Therapist Utilization:");
  analytics.therapistUtilization.forEach((t) => lines.push(`- ${t.name}: ${t.scheduledMinutes} min`));
  if (analytics.careGaps.length > 0) {
    lines.push("CRITICAL GAPS IN CARE (0 minutes in last 48 hours, excluding Medical Hold patients):");
    analytics.careGaps.forEach((g) => lines.push(`- Room ${g.roomNumber} (${g.patientName})`));
  } else {
    lines.push("Gaps in Care: None (All eligible patients have received therapy recently)");
  }
  const missed = analytics.missedSessionsByReason;
  const totalMissed = missed.missed_refusal + missed.missed_clinical_hold + missed.missed_staffing + missed.missed_other;
  lines.push(
    `Missed Sessions by Reason (past 7 days, total ${totalMissed}): refusal ${missed.missed_refusal}, clinical hold ${missed.missed_clinical_hold}, staffing ${missed.missed_staffing}, other ${missed.missed_other}.`,
  );
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
    for (const p of underTarget.slice(0, 6)) {
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
        return JSON.stringify({ ok: true, action: "moved", session: updated });
      }

      case "cancel_session": {
        const sessionId = Number(args.sessionId);
        const existing = await getSessionById(sessionId);
        if (!existing) return JSON.stringify({ ok: false, error: `No session with id ${sessionId} exists.` });
        await deleteTherapySession(sessionId);
        return JSON.stringify({ ok: true, action: "cancelled", sessionId });
      }

      case "auto_schedule_all_gaps": {
        const count = await autoScheduleAllGaps(referenceDate);
        return JSON.stringify({ ok: true, action: "auto_scheduled", count });
      }

      case "clear_schedule": {
        const timeframe = String(args.timeframe) as "daily" | "weekly";
        const therapistId = args.therapistId ? Number(args.therapistId) : undefined;
        await clearSchedule(timeframe, referenceDate, therapistId);
        return JSON.stringify({ ok: true, action: "cleared_schedule", timeframe, therapistId });
      }

      case "get_delivery_mode_mix": {
        const mix = await getDeliveryModeMix(
          Number(args.patientId),
          String(args.therapyType) as "PT" | "OT" | "SLP" | "Eval",
          referenceDate,
        );
        return JSON.stringify(mix);
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
    if (toolName === "create_session") return "Created a new session";
    if (toolName === "move_session") return "Moved a session";
    if (toolName === "cancel_session") return "Cancelled a session";
    if (toolName === "auto_schedule_all_gaps") return `Auto-scheduled ${result.count} session(s)`;
    if (toolName === "clear_schedule") return `Cleared ${result.timeframe} schedule${result.therapistId ? ` for therapist ID ${result.therapistId}` : " for all therapists"}`;
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
- You also have read-only tools (get_analytics, get_at_risk_patients, get_team_roster, get_delivery_mode_mix, list_open_slots) if the user asks something the table alone can't answer (e.g. comparing to current active patients, or unit-wide compliance). Use them freely.
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
