import {
  getPatients,
  getPatientById,
  getTherapists,
  getTherapySessionsForDateRange,
  createTherapySession,
} from "./db";
import {
  patientWeekStart,
  patientWeekEnd,
  daysRemainingInWeek,
  WeeklyMinutesSummary,
} from "../shared/weekUtils";
import {
  TOTAL_SLOTS,
  SLOT_MINUTES,
  dateToSlotIndex,
  slotIndexToDate,
  durationToSlots,
  formatDateKey,
} from "../shared/timeGrid";

export interface GapFillSuggestion {
  startTime: Date;
  durationMinutes: number;
  therapistId: number | null;
  therapistName: string | null;
  reason: string;
}

const BLOCK_OPTIONS = [60, 45, 30];

function startOfDayLocal(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDaysLocal(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export async function getWeeklyMinutesSummary(referenceDate: Date = new Date()): Promise<WeeklyMinutesSummary[]> {
  const allPatients = await getPatients();
  const active = allPatients.filter((p) => !p.isDischarged);
  if (active.length === 0) return [];

  const ranges = active.map((p) => {
    const weekStart = patientWeekStart(p.admissionDate, referenceDate);
    return { weekStart, weekEnd: patientWeekEnd(weekStart) };
  });
  const minStart = new Date(Math.min(...ranges.map((r) => r.weekStart.getTime())));
  const maxEnd = new Date(Math.max(...ranges.map((r) => r.weekEnd.getTime())));
  const sessionsInRange = await getTherapySessionsForDateRange(minStart, maxEnd);

  return active.map((patient) => {
    const weekStart = patientWeekStart(patient.admissionDate, referenceDate);
    const weekEnd = patientWeekEnd(weekStart);

    const completedMinutes = sessionsInRange
      .filter((s) => {
        if (s.patientId !== patient.id) return false;
        const t = new Date(s.startTime).getTime();
        return t >= weekStart.getTime() && t <= weekEnd.getTime();
      })
      .reduce((sum, s) => sum + s.durationMinutes, 0);

    const target = (patient as any).weeklyMinuteTarget ?? 900;
    const remainingMinutes = Math.max(0, target - completedMinutes);
    const daysRemaining = daysRemainingInWeek(weekStart, referenceDate);
    const atRisk = remainingMinutes > 0 && daysRemaining > 0 && (remainingMinutes / daysRemaining) > 150;

    return {
      patientId: patient.id,
      patientName: patient.name,
      roomNumber: patient.roomNumber,
      teamId: patient.teamId ?? null,
      weekStart,
      weekEnd,
      target,
      completedMinutes,
      remainingMinutes,
      daysRemaining,
      atRisk,
    };
  });
}

export async function getGapFillSuggestions(patientId: number, referenceDate: Date = new Date()): Promise<GapFillSuggestion[]> {
  const patient = await getPatientById(patientId);
  if (!patient || patient.isDischarged) return [];

  const weekStart = patientWeekStart(patient.admissionDate, referenceDate);
  const weekEnd = patientWeekEnd(weekStart);
  
  const [weekSessions, therapists] = await Promise.all([
    getTherapySessionsForDateRange(weekStart, weekEnd),
    getTherapists(),
  ]);

  const target = (patient as any).weeklyMinuteTarget ?? 900;
  const completed = weekSessions
    .filter((s) => s.patientId === patient.id)
    .reduce((sum, s) => sum + s.durationMinutes, 0);
  let remaining = Math.max(0, target - completed);
  if (remaining <= 0) return [];

  const sameTeam = patient.teamId ? therapists.filter((t) => t.teamId === patient.teamId) : [];
  const candidatePool = sameTeam.length > 0 ? [...sameTeam, ...therapists] : therapists;
  
  // Create unique pool (sameTeam members appear first, so Set handles dupes naturally if we just map)
  const pool = Array.from(new Map(candidatePool.map((t) => [t.id, t])).values());

  const busyByTherapist = new Map<number, Set<string>>();
  const patientBusy = new Set<string>();

  for (const s of weekSessions) {
    const start = new Date(s.startTime);
    const dayKey = formatDateKey(start);
    const slot = dateToSlotIndex(start);
    const span = durationToSlots(s.durationMinutes);
    for (let i = 0; i < span; i++) {
      const key = `${dayKey}:${slot + i}`;
      if (s.therapistId != null) {
        if (!busyByTherapist.has(s.therapistId)) busyByTherapist.set(s.therapistId, new Set());
        busyByTherapist.get(s.therapistId)!.add(key);
      }
      if (s.patientId === patient.id) patientBusy.add(key);
    }
  }

  const today = startOfDayLocal(referenceDate);
  const suggestions: GapFillSuggestion[] = [];

  for (let dayOffset = 0; dayOffset < 7 && remaining > 0; dayOffset++) {
    const day = startOfDayLocal(addDaysLocal(weekStart, dayOffset));
    if (day.getTime() < today.getTime()) continue; // don't suggest the past
    const dayKey = formatDateKey(day);

    for (let slot = 0; slot < TOTAL_SLOTS && remaining > 0; slot++) {
      for (const block of BLOCK_OPTIONS) {
        const span = block / SLOT_MINUTES;
        if (slot + span > TOTAL_SLOTS) continue;
        if (block > remaining + 15) continue; // don't wildly overshoot

        let patientFree = true;
        for (let i = 0; i < span; i++) {
          if (patientBusy.has(`${dayKey}:${slot + i}`)) {
            patientFree = false;
            break;
          }
        }
        if (!patientFree) continue;

        let chosen = null;
        for (const t of pool) {
          const busy = busyByTherapist.get(t.id);
          let free = true;
          if (busy) {
            for (let i = 0; i < span; i++) {
              if (busy.has(`${dayKey}:${slot + i}`)) {
                free = false;
                break;
              }
            }
          }
          if (free) {
            chosen = t;
            break;
          }
        }
        if (!chosen) continue;

        const startTime = slotIndexToDate(day, slot);
        const onOwnTeam = sameTeam.some((t) => t.id === chosen!.id);
        
        suggestions.push({
          startTime,
          durationMinutes: block,
          therapistId: chosen.id,
          therapistName: chosen.name,
          reason: onOwnTeam
            ? `${chosen.name} (${patient.name}'s team) is open for ${block} min`
            : `${chosen.name} is open for ${block} min`,
        });

        // Mark as busy so we don't double book this therapist/patient for the rest of the suggestions
        for (let i = 0; i < span; i++) {
          const key = `${dayKey}:${slot + i}`;
          patientBusy.add(key);
          if (!busyByTherapist.has(chosen.id)) busyByTherapist.set(chosen.id, new Set());
          busyByTherapist.get(chosen.id)!.add(key);
        }
        remaining -= block;
        break; // Stop looking at other block sizes for this specific slot
      }
    }
  }

  return suggestions;
}

export async function autoScheduleAllGaps(referenceDate: Date = new Date()): Promise<number> {
  const summary = await getWeeklyMinutesSummary(referenceDate);
  let totalScheduled = 0;

  for (const patient of summary) {
    if (patient.remainingMinutes <= 0) continue;

    const suggestions = await getGapFillSuggestions(patient.patientId, referenceDate);
    for (const suggestion of suggestions) {
      if (!suggestion.therapistId) continue;

      const startTime = suggestion.startTime;
      const endTime = new Date(startTime.getTime() + suggestion.durationMinutes * 60000);

      await createTherapySession({
        patientId: patient.patientId,
        therapistId: suggestion.therapistId,
        therapyType: "PT", // Default to PT for auto-scheduled sessions
        startTime,
        endTime,
        durationMinutes: suggestion.durationMinutes,
        notes: "Auto-scheduled by AI Assistant",
      });

      totalScheduled++;
    }
  }

  return totalScheduled;
}
