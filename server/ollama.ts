import { ENV } from "./_core/env";
import { getWeeklyMinutesSummary, getGapFillSuggestions, GapFillSuggestion } from "./scheduling";
import { formatWeekRangeLabel, WeeklyMinutesSummary } from "../shared/weekUtils";

export async function buildSchedulerContext(referenceDate: Date = new Date()): Promise<string> {
  const summary = await getWeeklyMinutesSummary(referenceDate);
  if (summary.length === 0) {
    return "There are no active (non-discharged) patients on the board right now.";
  }

  const lines: string[] = [];
  lines.push(`Today is ${referenceDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}.`);
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
    "You are a scheduling assistant for a rehab therapy unit. Use ONLY the data below to answer.",
    "Be concise and concrete (cite room numbers, names, times, and minutes). If the data doesn't contain",
    "the answer, say so plainly instead of guessing.",
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
    return {
      answer: data.response?.trim() || "(Ollama returned an empty response.)",
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
