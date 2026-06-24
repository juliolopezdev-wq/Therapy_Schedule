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

export interface JointCommissionAnalytics {
  compliance: {
    totalActive: number;
    onTarget: number;
    atRisk: number;
  };
  therapyBreakdown: {
    PT: number;
    OT: number;
    SLP: number;
    Eval: number;
  };
  therapistUtilization: Array<{
    name: string;
    scheduledMinutes: number;
  }>;
  careGaps: Array<{
    patientName: string;
    roomNumber: string;
    daysWithoutTherapy: number;
  }>;
}

export async function getJointCommissionAnalytics(referenceDate: Date = new Date()): Promise<JointCommissionAnalytics> {
  const summary = await getWeeklyMinutesSummary(referenceDate);
  const therapists = await getTherapists();

  const past7DaysStart = startOfDayLocal(addDaysLocal(referenceDate, -6));
  const todayEnd = startOfDayLocal(addDaysLocal(referenceDate, 1));
  const recentSessions = await getTherapySessionsForDateRange(past7DaysStart, todayEnd);

  // 1. Compliance
  const compliance = {
    totalActive: summary.length,
    onTarget: summary.filter(p => p.remainingMinutes <= 0 || !p.atRisk).length,
    atRisk: summary.filter(p => p.atRisk).length,
  };

  // 2. Therapy Breakdown
  const therapyBreakdown = { PT: 0, OT: 0, SLP: 0, Eval: 0 };
  recentSessions.forEach(s => {
    if (s.therapyType === "PT") therapyBreakdown.PT += s.durationMinutes;
    else if (s.therapyType === "OT") therapyBreakdown.OT += s.durationMinutes;
    else if (s.therapyType === "SLP") therapyBreakdown.SLP += s.durationMinutes;
    else if (s.therapyType === "Eval") therapyBreakdown.Eval += s.durationMinutes;
  });

  // 3. Therapist Utilization
  const therapistMap = new Map<number, number>();
  recentSessions.forEach(s => {
    if (s.therapistId) {
      therapistMap.set(s.therapistId, (therapistMap.get(s.therapistId) || 0) + s.durationMinutes);
    }
  });
  const therapistUtilization = therapists.map(t => ({
    name: t.name,
    scheduledMinutes: therapistMap.get(t.id) || 0,
  })).sort((a, b) => b.scheduledMinutes - a.scheduledMinutes);

  // 4. Gaps in Care (Patients with 0 minutes in the last 2 days)
  const careGaps: JointCommissionAnalytics["careGaps"] = [];
  const yesterdayStart = startOfDayLocal(addDaysLocal(referenceDate, -1));
  
  for (const patient of summary) {
    const recentPatientSessions = recentSessions.filter(s => s.patientId === patient.patientId && new Date(s.startTime).getTime() >= yesterdayStart.getTime());
    if (recentPatientSessions.length === 0) {
      careGaps.push({
        patientName: patient.patientName,
        roomNumber: patient.roomNumber,
        daysWithoutTherapy: 2, // Approximated for "yesterday and today"
      });
    }
  }

  return {
    compliance,
    therapyBreakdown,
    therapistUtilization,
    careGaps,
  };
}
