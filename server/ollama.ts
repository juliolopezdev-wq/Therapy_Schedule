import { ENV } from "./_core/env";
import { getWeeklyMinutesSummary, getGapFillSuggestions, autoScheduleAllGaps, getJointCommissionAnalytics, GapFillSuggestion } from "./scheduling";
import { formatWeekRangeLabel, WeeklyMinutesSummary } from "../shared/weekUtils";

export async function buildSchedulerContext(referenceDate: Date = new Date()): Promise<string> {
  const summary = await getWeeklyMinutesSummary(referenceDate);
  if (summary.length === 0) {
    return "There are no active (non-discharged) patients on the board right now.";
  }

  const lines: string[] = [];
  lines.push(`Today is ${referenceDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}.`);
  lines.push("");

  const analytics = await getJointCommissionAnalytics(referenceDate);
  lines.push("=== JOINT COMMISSION & REHAB ANALYTICS (Past 7 Days) ===");
  lines.push(`Compliance: ${analytics.compliance.onTarget} on target, ${analytics.compliance.atRisk} at risk (Total Active: ${analytics.compliance.totalActive})`);
  lines.push(`Therapy Breakdown: PT: ${analytics.therapyBreakdown.PT} min, OT: ${analytics.therapyBreakdown.OT} min, SLP: ${analytics.therapyBreakdown.SLP} min, Eval: ${analytics.therapyBreakdown.Eval} min`);
  
  lines.push("Therapist Utilization:");
  analytics.therapistUtilization.forEach(t => lines.push(`- ${t.name}: ${t.scheduledMinutes} min`));
  
  if (analytics.careGaps.length > 0) {
    lines.push("CRITICAL GAPS IN CARE (0 minutes in last 48 hours):");
    analytics.careGaps.forEach(g => lines.push(`- Room ${g.roomNumber} (${g.patientName})`));
  } else {
    lines.push("Gaps in Care: None (All patients have received therapy recently)");
  }
  lines.push("==========================================================");
  lines.push("");
  
  lines.push("Weekly minute progress (each patient's week starts on their own admission day):");

  const underTarget: WeeklyMinutesSummary[] = [];

  for (const p of summary) {
    const status = p.remainingMinutes <= 0 ? "ON TARGET" : p.atRisk ? "AT RISK" : "behind";
    lines.push(
      `- Room ${p.roomNumber} (${p.patientName}): ${p.completedMinutes}/${p.target} min ` +
      `(${formatWeekRangeLabel(p.weekStart)}), ${p.remainingMinutes} min remaining, ` +
      `${p.daysRemaining} day(s) left in their week. Status: ${status}.`
    );
    if (p.remainingMinutes > 0) underTarget.push(p);
  }

  if (underTarget.length > 0) {
    lines.push("");
    lines.push("Open-slot suggestions for patients currently under target:");
    for (const p of underTarget.slice(0, 5)) {
      const suggestions = await getGapFillSuggestions(p.patientId, referenceDate);
      if (suggestions.length === 0) {
        lines.push(`- Room ${p.roomNumber} (${p.patientName}): no open slots found this week.`);
        continue;
      }
      lines.push(`- Room ${p.roomNumber} (${p.patientName}):`);
      for (const s of suggestions.slice(0, 4)) {
        const when = s.startTime.toLocaleString("en-US", {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        });
        lines.push(`    • ${when}, ${s.durationMinutes} min — ${s.reason}`);
      }
    }
  }

  return lines.join("\n");
}

export interface OllamaAskResult {
  answer: string;
  model: string;
  usedFallback: boolean;
}

export async function askScheduler(question: string, referenceDate: Date = new Date()): Promise<OllamaAskResult> {
  const context = await buildSchedulerContext(referenceDate);

  const prompt = [
    "You are a scheduling assistant AND a Joint Commission data analyst for a rehab therapy unit.",
    "Use ONLY the data below to answer.",
    "Be concise and concrete (cite room numbers, names, times, and minutes).",
    "If asked for metrics, compliance, or rehab analysis, use the ANALYTICS section to give a detailed breakdown.",
    "If the data doesn't contain the answer, say so plainly instead of guessing.",
    "",
    "IMPORTANT COMMAND INSTRUCTION:",
    "If the user explicitly asks you to 'schedule patients', 'fill gaps', 'maximize minutes', or 'auto-schedule',",
    "you MUST include the exact tag [EXECUTE_AUTO_SCHEDULE] anywhere in your text response.",
    "When you include this tag, the system will automatically book all recommended gap-fill sessions to maximize minutes.",
    "",
    "=== SCHEDULING DATA ===",
    context,
    "=== END DATA ===",
    "",
    `Question: ${question}`,
  ].join("\n");

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (ENV.ollamaApiKey) {
      headers["Authorization"] = `Bearer ${ENV.ollamaApiKey}`;
    }

    const res = await fetch(`${ENV.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: ENV.ollamaModel,
        prompt,
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }

    const data = await res.json() as any;
    let answerText = data.response?.trim() || "(Ollama returned an empty response.)";
    let autoScheduledCount = 0;

    if (answerText.includes("[EXECUTE_AUTO_SCHEDULE]")) {
      answerText = answerText.replace(/\[EXECUTE_AUTO_SCHEDULE\]/g, "").trim();
      autoScheduledCount = await autoScheduleAllGaps(referenceDate);
      answerText += `\n\n✅ **Auto-Scheduler Triggered!** I successfully scheduled ${autoScheduledCount} new sessions to maximize weekly minutes!`;
    }

    return {
      answer: answerText,
      model: ENV.ollamaModel,
      usedFallback: false,
    };
  } catch (err: any) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      answer:
        `Couldn't reach Ollama at ${ENV.ollamaBaseUrl} (${reason}). ` +
        `Run "ollama serve" and "ollama pull ${ENV.ollamaModel}" on this machine, then try again.\n\n` +
        `In the meantime, here's the raw scheduling data:\n\n${context}`,
      model: ENV.ollamaModel,
      usedFallback: true,
    };
  }
}
