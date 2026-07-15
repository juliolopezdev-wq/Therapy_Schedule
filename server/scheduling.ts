import {
  getPatients,
  getPatientById,
  getTherapists,
  getTherapySessionsForDateRange,
  createTherapySession,
  getTeams,
  getStatusFlagsForDate,
  getAdditionalMinutesForDateRange,
  getMostRecentSessionsForPatients,
  SchedulingConflictError,
} from "./db";
import {
  patientWeekStart,
  patientWeekEnd,
  daysRemainingInWeek,
  isMissedStatus,
  WeeklyMinutesSummary,
} from "../shared/weekUtils";
import {
  TOTAL_SLOTS,
  SLOT_MINUTES,
  START_HOUR,
  END_HOUR,
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
  const additionalMinutesInRange = await getAdditionalMinutesForDateRange(minStart, maxEnd);

  return active.map((patient) => {
    const weekStart = patientWeekStart(patient.admissionDate, referenceDate);
    const weekEnd = patientWeekEnd(weekStart);

    const patientSessions = sessionsInRange.filter((s) => {
      if (s.patientId !== patient.id) return false;
      if (s.therapyType === "Block") return false; // block time isn't real therapy minutes
      const t = new Date(s.startTime).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    });

    const scheduledMinutes = patientSessions.reduce((sum, s) => sum + s.durationMinutes, 0);
    const completedMinutes = patientSessions
      .filter((s) => s.status === "completed")
      .reduce((sum, s) => sum + (s.actualDurationMinutes ?? s.durationMinutes), 0);
    const missedMinutes = patientSessions
      .filter((s) => isMissedStatus(s.status))
      .reduce((sum, s) => sum + s.durationMinutes, 0);
    // Still-scheduled, unstarted minutes -- what could still be delivered this period with zero further attrition
    const pendingMinutes = patientSessions
      .filter((s) => s.status === "scheduled")
      .reduce((sum, s) => sum + s.durationMinutes, 0);

    const baseTarget = (patient as any).weeklyMinuteTarget ?? 900;
    const extraMinutes = additionalMinutesInRange
      .filter((a) => {
        if (a.patientId !== patient.id) return false;
        const t = new Date(a.date).getTime();
        return t >= weekStart.getTime() && t <= weekEnd.getTime();
      })
      .reduce((sum, a) => sum + a.additionalMinutes, 0);
    const target = baseTarget + extraMinutes;

    const daysRemaining = daysRemainingInWeek(weekStart, referenceDate);
    const daysElapsed = Math.max(0, 7 - daysRemaining);
    const proRatedTarget = (target / 7) * daysElapsed;

    const remainingMinutes = Math.max(0, target - completedMinutes);
    const projectedTotalMinutes = completedMinutes + pendingMinutes;
    // At risk if projected end-of-week total (assuming zero further attrition) still falls short of target,
    // or if delivered-to-date is already behind the pro-rated target for elapsed days.
    const behindProjection = projectedTotalMinutes < target;
    const behindProRated = daysElapsed > 0 && completedMinutes < proRatedTarget;
    const atRisk = remainingMinutes > 0 && (behindProjection || behindProRated);

    return {
      patientId: patient.id,
      patientName: patient.name,
      roomNumber: patient.roomNumber,
      teamId: patient.teamId ?? null,
      weekStart,
      weekEnd,
      target,
      scheduledMinutes,
      completedMinutes,
      missedMinutes,
      pendingMinutes,
      projectedTotalMinutes,
      remainingMinutes,
      daysRemaining,
      atRisk,
    };
  });
}

function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Whether a therapist is actually on shift for the given day/slot span, per their optional
 * workDays/workStartTime/workEndTime. Any of the three left unset means "no restriction" on
 * that dimension -- a therapist with nothing set is available every day, full board hours,
 * exactly as gap-fill behaved before this field existed.
 */
function therapistWorksAt(
  t: { workDays: string | null; workStartTime: string | null; workEndTime: string | null },
  day: Date,
  slot: number,
  span: number,
): boolean {
  if (t.workDays) {
    const days = t.workDays.split(",").map(Number);
    if (!days.includes(day.getDay())) return false;
  }
  const slotStartMin = START_HOUR * 60 + slot * SLOT_MINUTES;
  const slotEndMin = slotStartMin + span * SLOT_MINUTES;
  if (t.workStartTime && slotStartMin < parseTimeToMinutes(t.workStartTime)) return false;
  if (t.workEndTime && slotEndMin > parseTimeToMinutes(t.workEndTime)) return false;
  return true;
}

/**
 * How many bookable minutes a therapist actually has on a given calendar day, for productivity
 * math -- their shift window (or the full 7am-6pm board grid if unset) minus the board's fixed
 * lunch hour (12:00-1:00) when the shift spans it, or 0 entirely if workDays excludes that day.
 */
function availableShiftMinutesForDay(
  t: { workDays: string | null; workStartTime: string | null; workEndTime: string | null },
  day: Date,
): number {
  if (t.workDays) {
    const days = t.workDays.split(",").map(Number);
    if (!days.includes(day.getDay())) return 0;
  }
  const startMin = t.workStartTime ? parseTimeToMinutes(t.workStartTime) : START_HOUR * 60;
  const endMin = t.workEndTime ? parseTimeToMinutes(t.workEndTime) : END_HOUR * 60;
  let available = Math.max(0, endMin - startMin);
  const lunchStart = 12 * 60;
  const lunchEnd = 13 * 60;
  if (startMin < lunchEnd && endMin > lunchStart) available = Math.max(0, available - 60);
  return available;
}

export async function getGapFillSuggestions(
  patientId: number,
  referenceDate: Date = new Date(),
  disciplineFilter?: "PT" | "OT" | "SLP",
): Promise<GapFillSuggestion[]> {
  const patient = await getPatientById(patientId);
  if (!patient || patient.isDischarged) return [];

  const weekStart = patientWeekStart(patient.admissionDate, referenceDate);
  const weekEnd = patientWeekEnd(weekStart);

  const [weekSessions, allTherapists] = await Promise.all([
    getTherapySessionsForDateRange(weekStart, weekEnd),
    getTherapists(),
  ]);
  // When a discipline is specified (e.g. auto-scheduling a PT-shortfall session), only a
  // PT-credentialed therapist is a legitimate candidate -- without this filter the pool search
  // below would happily hand a PT session to whichever OT/SLP happened to be free first.
  const therapists = disciplineFilter ? allTherapists.filter((t) => t.therapyType === disciplineFilter) : allTherapists;

  const target = (patient as any).weeklyMinuteTarget ?? 900;
  // Minutes already covered by a completed or still-pending (not missed) session -- missed sessions
  // reopen the gap so they get suggested again.
  const covered = weekSessions
    .filter((s) => s.patientId === patient.id && s.therapyType !== "Block" && !isMissedStatus(s.status))
    .reduce((sum, s) => sum + s.durationMinutes, 0);
  let remaining = Math.max(0, target - covered);
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
          if (!therapistWorksAt(t, day, slot, span)) continue;
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

/**
 * Which discipline to book for a gap-fill session, based on the patient's actual shortfall
 * against their optional per-discipline targets (ptTarget/otTarget/slpTarget) -- previously
 * auto-schedule hardcoded "PT" regardless of what the patient actually needed. Falls back to
 * PT (the prior, unconditional behavior) when a patient has none of the three targets set,
 * since there's no per-discipline data to reason from in that case.
 */
async function pickAutoScheduleDiscipline(
  patientId: number,
  referenceDate: Date,
): Promise<"PT" | "OT" | "SLP"> {
  const patient = await getPatientById(patientId);
  const ptTarget = (patient as any)?.ptTarget as number | null | undefined;
  const otTarget = (patient as any)?.otTarget as number | null | undefined;
  const slpTarget = (patient as any)?.slpTarget as number | null | undefined;
  if (!patient || (!ptTarget && !otTarget && !slpTarget)) return "PT";

  const weekStart = patientWeekStart(patient.admissionDate, referenceDate);
  const weekEnd = patientWeekEnd(weekStart);
  const weekSessions = await getTherapySessionsForDateRange(weekStart, weekEnd);

  const deliveredOrPending = (type: "PT" | "OT" | "SLP") =>
    weekSessions
      .filter((s) => s.patientId === patientId && s.therapyType === type && !isMissedStatus(s.status))
      .reduce((sum, s) => sum + s.durationMinutes, 0);

  const shortfalls: { type: "PT" | "OT" | "SLP"; remaining: number }[] = [
    { type: "PT", remaining: Math.max(0, (ptTarget ?? 0) - deliveredOrPending("PT")) },
    { type: "OT", remaining: Math.max(0, (otTarget ?? 0) - deliveredOrPending("OT")) },
    { type: "SLP", remaining: Math.max(0, (slpTarget ?? 0) - deliveredOrPending("SLP")) },
  ];
  shortfalls.sort((a, b) => b.remaining - a.remaining);
  return shortfalls[0].remaining > 0 ? shortfalls[0].type : "PT";
}

type DisciplineCounts = { PT: number; OT: number; SLP: number };

export async function autoScheduleAllGaps(
  referenceDate: Date = new Date(),
): Promise<{ count: number; sessionIds: number[]; skippedConflicts: number; byDiscipline: DisciplineCounts }> {
  const summary = await getWeeklyMinutesSummary(referenceDate);
  const sessionIds: number[] = [];
  const byDiscipline: DisciplineCounts = { PT: 0, OT: 0, SLP: 0 };
  let skippedConflicts = 0;

  for (const patient of summary) {
    if (patient.remainingMinutes <= 0) continue;

    const discipline = await pickAutoScheduleDiscipline(patient.patientId, referenceDate);
    const suggestions = await getGapFillSuggestions(patient.patientId, referenceDate, discipline);
    for (const suggestion of suggestions) {
      if (!suggestion.therapistId) continue;

      const startTime = suggestion.startTime;
      const endTime = new Date(startTime.getTime() + suggestion.durationMinutes * 60000);

      try {
        const created = await createTherapySession({
          patientId: patient.patientId,
          therapistId: suggestion.therapistId,
          therapyType: discipline,
          startTime,
          endTime,
          durationMinutes: suggestion.durationMinutes,
          notes: "Auto-scheduled by AI Assistant",
        });
        sessionIds.push(created.id);
        byDiscipline[discipline]++;
      } catch (err) {
        if (err instanceof SchedulingConflictError) {
          skippedConflicts++;
          continue;
        }
        throw err;
      }
    }
  }

  return { count: sessionIds.length, sessionIds, skippedConflicts, byDiscipline };
}

export async function autoSchedulePatientGaps(
  patientId: number,
  referenceDate: Date = new Date(),
): Promise<{ count: number; sessionIds: number[]; skippedConflicts: number; byDiscipline: DisciplineCounts }> {
  const summary = await getWeeklyMinutesSummary(referenceDate);
  const patient = summary.find(p => p.patientId === patientId);
  const emptyDiscipline: DisciplineCounts = { PT: 0, OT: 0, SLP: 0 };
  if (!patient || patient.remainingMinutes <= 0) {
    return { count: 0, sessionIds: [], skippedConflicts: 0, byDiscipline: emptyDiscipline };
  }

  const discipline = await pickAutoScheduleDiscipline(patientId, referenceDate);
  const sessionIds: number[] = [];
  const byDiscipline: DisciplineCounts = { PT: 0, OT: 0, SLP: 0 };
  let skippedConflicts = 0;
  const suggestions = await getGapFillSuggestions(patient.patientId, referenceDate, discipline);

  for (const suggestion of suggestions) {
    if (!suggestion.therapistId) continue;

    const startTime = suggestion.startTime;
    const endTime = new Date(startTime.getTime() + suggestion.durationMinutes * 60000);

    try {
      const created = await createTherapySession({
        patientId: patient.patientId,
        therapistId: suggestion.therapistId,
        therapyType: discipline,
        startTime,
        endTime,
        durationMinutes: suggestion.durationMinutes,
        notes: "Auto-scheduled by AI Assistant",
      });
      sessionIds.push(created.id);
      byDiscipline[discipline]++;
    } catch (err) {
      if (err instanceof SchedulingConflictError) {
        skippedConflicts++;
        continue;
      }
      throw err;
    }
  }

  return { count: sessionIds.length, sessionIds, skippedConflicts, byDiscipline };
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
    availableMinutes: number;
    /** scheduledMinutes/availableMinutes as a 0-100 percent, or null if they had no shift in the window at all. */
    productivityPct: number | null;
  }>;
  careGaps: Array<{
    patientName: string;
    roomNumber: string;
    daysWithoutTherapy: number | null; // null = no real session on record at all (e.g. brand-new admission)
  }>;
  missedSessionsByReason: {
    missed_refusal: number;
    missed_clinical_hold: number;
    missed_staffing: number;
    missed_other: number;
  };
  /** Who each missed session (past 7 days) actually was -- the aggregate counts above can't
   *  answer "which patient," so this is what makes that answerable without a guess. */
  missedSessionsDetail: Array<{
    patientName: string;
    roomNumber: string;
    therapyType: string;
    date: Date;
    reason: string;
    missedReason: string | null;
  }>;
  /** Patients trending toward chronic refusal (recent status history), with a data-driven suggestion. */
  refusalPatterns: Array<{
    patientName: string;
    roomNumber: string;
    refusalCount: number;
    totalRecentSessions: number;
    suggestion: string;
  }>;
  /** "Group Appropriate" patients who share a team + discipline shortfall -- real candidates to book together. */
  groupTherapyOpportunities: Array<{
    teamName: string;
    therapyType: "PT" | "OT" | "SLP";
    patients: Array<{ id: number; name: string; roomNumber: string }>;
  }>;
  /** Sessions whose end time has already passed today but are still sitting as "scheduled" -- unmarked admin pileup. */
  staleSessions: Array<{
    sessionId: number;
    patientName: string;
    roomNumber: string;
    therapyType: string;
    endTime: Date;
  }>;
}

export async function getJointCommissionAnalytics(referenceDate: Date = new Date()): Promise<JointCommissionAnalytics> {
  const past7DaysStart = startOfDayLocal(addDaysLocal(referenceDate, -6));
  const todayEnd = startOfDayLocal(addDaysLocal(referenceDate, 1));
  // None of these three depend on each other -- run concurrently instead of one-at-a-time
  // against the remote DB.
  const [summary, therapists, recentSessions] = await Promise.all([
    getWeeklyMinutesSummary(referenceDate),
    getTherapists(),
    getTherapySessionsForDateRange(past7DaysStart, todayEnd),
  ]);
  const patientById = new Map(summary.map((p) => [p.patientId, p]));

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

  // 3. Therapist Utilization + productivity (scheduled minutes against actual available shift
  // minutes over the same 7-day window) -- SNF rehab teams typically target ~90-95% productivity,
  // so a bare minutes count without this denominator doesn't tell you who's over/under-loaded.
  const therapistMap = new Map<number, number>();
  recentSessions.forEach(s => {
    if (s.therapistId) {
      therapistMap.set(s.therapistId, (therapistMap.get(s.therapistId) || 0) + s.durationMinutes);
    }
  });
  const therapistUtilization = therapists.map(t => {
    let availableMinutes = 0;
    for (let i = 0; i < 7; i++) {
      availableMinutes += availableShiftMinutesForDay(t, addDaysLocal(past7DaysStart, i));
    }
    const scheduledMinutes = therapistMap.get(t.id) || 0;
    return {
      name: t.name,
      scheduledMinutes,
      availableMinutes,
      productivityPct: availableMinutes > 0 ? Math.round((scheduledMinutes / availableMinutes) * 100) : null,
    };
  }).sort((a, b) => b.scheduledMinutes - a.scheduledMinutes);

  // 4. Gaps in Care (Patients with 0 real therapy minutes in the last 2 days, excluding anyone on Medical Hold)
  const careGaps: JointCommissionAnalytics["careGaps"] = [];
  const yesterdayStart = startOfDayLocal(addDaysLocal(referenceDate, -1));
  const todaysFlags = await getStatusFlagsForDate(referenceDate);
  const medicalHoldPatientIds = new Set(
    todaysFlags.filter((f) => f.flagType === "Medical Hold").map((f) => f.patientId),
  );

  const gapCandidates = summary.filter((patient) => {
    if (medicalHoldPatientIds.has(patient.patientId)) return false;
    const hasRecentSession = recentSessions.some(
      (s) =>
        s.patientId === patient.patientId &&
        s.therapyType !== "Block" &&
        new Date(s.startTime).getTime() >= yesterdayStart.getTime(),
    );
    return !hasRecentSession;
  });
  // The 7-day window already ruled out anything recent -- look back further (uncapped) for each
  // candidate's true last real session so the gap length is accurate, not a flat guess. Batched
  // into one query for every candidate instead of N sequential per-patient round-trips.
  const lastSessionByPatient = await getMostRecentSessionsForPatients(gapCandidates.map((p) => p.patientId));
  for (const patient of gapCandidates) {
    const lastSession = lastSessionByPatient.get(patient.patientId);
    const daysWithoutTherapy = lastSession
      ? Math.floor((startOfDayLocal(referenceDate).getTime() - startOfDayLocal(new Date(lastSession.startTime)).getTime()) / 86_400_000)
      : null; // never had a real session on record
    careGaps.push({
      patientName: patient.patientName,
      roomNumber: patient.roomNumber,
      daysWithoutTherapy,
    });
  }

  // 5. Missed sessions by reason (past 7 days) -- the "why" behind at-risk patients
  const missedSessionsByReason = {
    missed_refusal: 0,
    missed_clinical_hold: 0,
    missed_staffing: 0,
    missed_other: 0,
  };
  const missedReasonLabels: Record<string, string> = {
    missed_refusal: "refusal",
    missed_clinical_hold: "clinical hold",
    missed_staffing: "staffing",
    missed_other: "other",
  };
  const missedSessionsDetail: JointCommissionAnalytics["missedSessionsDetail"] = [];
  recentSessions.forEach((s) => {
    if (s.status in missedSessionsByReason) {
      missedSessionsByReason[s.status as keyof typeof missedSessionsByReason]++;
      const patient = patientById.get(s.patientId);
      missedSessionsDetail.push({
        patientName: patient?.patientName ?? `patient ${s.patientId}`,
        roomNumber: patient?.roomNumber ?? "?",
        therapyType: s.therapyType,
        date: new Date(s.startTime),
        reason: missedReasonLabels[s.status] ?? s.status,
        missedReason: s.missedReason,
      });
    }
  });

  const therapistNameById = new Map(therapists.map((t) => [t.id, t.name]));

  // 6. Refusal patterns -- PDPM removed the payment incentive to chase a refusing patient, so
  // this is exactly the kind of drift that needs to be caught proactively. Looks back 14 days
  // (wider than the 7-day window above) so a pattern is visible even if this week alone doesn't
  // show it yet.
  const refusalPatterns: JointCommissionAnalytics["refusalPatterns"] = [];
  const refusalLookbackStart = startOfDayLocal(addDaysLocal(referenceDate, -13));
  const refusalLookbackSessions = await getTherapySessionsForDateRange(refusalLookbackStart, todayEnd);
  for (const patient of summary) {
    const patientSessions = refusalLookbackSessions.filter(
      (s) => s.patientId === patient.patientId && s.therapyType !== "Block" && (s.status === "completed" || isMissedStatus(s.status)),
    );
    if (patientSessions.length < 4) continue; // not enough recent history to call it a pattern
    const refusals = patientSessions.filter((s) => s.status === "missed_refusal");
    if (refusals.length === 0) continue;
    const refusalRate = refusals.length / patientSessions.length;
    if (refusals.length < 3 && refusalRate < 0.5) continue;

    let suggestion = `Refused ${refusals.length} of ${patientSessions.length} recent sessions.`;

    const isAM = (s: (typeof patientSessions)[number]) => new Date(s.startTime).getHours() < 12;
    const completed = patientSessions.filter((s) => s.status === "completed");
    const refusedAM = refusals.filter(isAM).length;
    const refusedPM = refusals.length - refusedAM;
    const completedAM = completed.filter(isAM).length;
    const completedPM = completed.length - completedAM;
    if (refusedAM > refusedPM && completedPM >= completedAM && completed.length > 0) {
      suggestion += ` Refusals cluster in the morning (${refusedAM} AM vs ${refusedPM} PM) while afternoons go better -- try scheduling afternoons.`;
    } else if (refusedPM > refusedAM && completedAM >= completedPM && completed.length > 0) {
      suggestion += ` Refusals cluster in the afternoon (${refusedPM} PM vs ${refusedAM} AM) while mornings go better -- try scheduling mornings.`;
    }

    // Conservative therapist hint: only surface it when every refusal was with one therapist AND
    // a different therapist has at least one completed session with this patient -- avoids
    // reading a correlation into too little data.
    const refusalTherapistIds = new Set(refusals.map((s) => s.therapistId).filter((id): id is number => id != null));
    const completedTherapistIds = new Set(completed.map((s) => s.therapistId).filter((id): id is number => id != null));
    if (refusalTherapistIds.size === 1) {
      const soleId = Array.from(refusalTherapistIds)[0];
      const otherSuccessId = Array.from(completedTherapistIds).find((id) => id !== soleId);
      if (otherSuccessId != null) {
        const soleName = therapistNameById.get(soleId) ?? `therapist ${soleId}`;
        const otherName = therapistNameById.get(otherSuccessId) ?? `therapist ${otherSuccessId}`;
        suggestion += ` All refusals were with ${soleName}, while sessions with ${otherName} were completed -- consider trying ${otherName} instead.`;
      }
    }

    refusalPatterns.push({
      patientName: patient.patientName,
      roomNumber: patient.roomNumber,
      refusalCount: refusals.length,
      totalRecentSessions: patientSessions.length,
      suggestion,
    });
  }

  // 7. Group therapy opportunities -- "Group Appropriate" patients on the same team with the same
  // discipline shortfall are real, actionable candidates to book together (up to CMS's 6-patient
  // group definition), turning several individual sessions into one therapist's time.
  const groupTherapyOpportunities: JointCommissionAnalytics["groupTherapyOpportunities"] = [];
  const groupAppropriateIds = new Set(todaysFlags.filter((f) => f.flagType === "Group Appropriate").map((f) => f.patientId));
  if (groupAppropriateIds.size >= 2) {
    const teams = await getTeams();
    const groupCandidates = summary.filter(
      (p) => groupAppropriateIds.has(p.patientId) && !medicalHoldPatientIds.has(p.patientId) && p.remainingMinutes > 0 && p.teamId != null,
    );
    // Concurrent, not sequential -- each pickAutoScheduleDiscipline call is its own round-trip
    // to the (remote, HTTP-backed) database, and this loop's cost otherwise scales with however
    // many patients happen to be flagged Group Appropriate that day.
    const disciplines = await Promise.all(groupCandidates.map((p) => pickAutoScheduleDiscipline(p.patientId, referenceDate)));
    const buckets = new Map<string, { teamId: number; discipline: "PT" | "OT" | "SLP"; patients: typeof groupCandidates }>();
    groupCandidates.forEach((p, i) => {
      const discipline = disciplines[i];
      const key = `${p.teamId}:${discipline}`;
      if (!buckets.has(key)) buckets.set(key, { teamId: p.teamId!, discipline, patients: [] });
      buckets.get(key)!.patients.push(p);
    });
    for (const bucket of Array.from(buckets.values())) {
      if (bucket.patients.length < 2) continue;
      const team = teams.find((t) => t.id === bucket.teamId);
      groupTherapyOpportunities.push({
        teamName: team?.name ?? `Team ${bucket.teamId}`,
        therapyType: bucket.discipline,
        patients: bucket.patients.slice(0, 6).map((p) => ({ id: p.patientId, name: p.patientName, roomNumber: p.roomNumber })),
      });
    }
  }

  // 8. Stale sessions -- ended but never marked completed/missed. This is the specific admin
  // pileup research flags as eating into the same time budget as direct treatment; catching it
  // proactively beats a therapist manually scanning the whole day at shift's end.
  const staleSessions: JointCommissionAnalytics["staleSessions"] = [];
  const todayStart = startOfDayLocal(referenceDate);
  // recentSessions already spans through the end of today (and beyond), so filter it in-memory
  // instead of a second network round-trip to the remote DB for data already fetched above.
  const todaySessions = recentSessions.filter((s) => new Date(s.startTime).getTime() >= todayStart.getTime());
  for (const s of todaySessions) {
    if (s.status !== "scheduled" || s.therapyType === "Block") continue;
    if (new Date(s.endTime).getTime() >= referenceDate.getTime()) continue;
    const patient = patientById.get(s.patientId);
    staleSessions.push({
      sessionId: s.id,
      patientName: patient?.patientName ?? `patient ${s.patientId}`,
      roomNumber: patient?.roomNumber ?? "?",
      therapyType: s.therapyType,
      endTime: new Date(s.endTime),
    });
  }

  return {
    compliance,
    therapyBreakdown,
    therapistUtilization,
    careGaps,
    missedSessionsByReason,
    missedSessionsDetail,
    refusalPatterns,
    groupTherapyOpportunities,
    staleSessions,
  };
}

export interface DeliveryModeMix {
  patientId: number;
  therapyType: "PT" | "OT" | "SLP" | "Eval";
  totalMinutes: number;
  concurrentGroupMinutes: number;
  pct: number;
  overCap: boolean;
}

const CONCURRENT_GROUP_CAP_PCT = 25;

/**
 * PDPM caps combined concurrent + group minutes at 25% of total minutes per discipline per patient
 * per period. Computes the current mix for one patient/discipline over their current week so a
 * proposed new session's delivery mode can be checked against it before booking.
 */
export async function getDeliveryModeMix(
  patientId: number,
  therapyType: "PT" | "OT" | "SLP" | "Eval",
  referenceDate: Date = new Date(),
): Promise<DeliveryModeMix> {
  const patient = await getPatientById(patientId);
  const weekStart = patientWeekStart(patient?.admissionDate, referenceDate);
  const weekEnd = patientWeekEnd(weekStart);
  const sessions = (await getTherapySessionsForDateRange(weekStart, weekEnd)).filter(
    (s) => s.patientId === patientId && s.therapyType === therapyType && !isMissedStatus(s.status),
  );

  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
  const concurrentGroupMinutes = sessions
    .filter((s) => s.deliveryMode === "concurrent" || s.deliveryMode === "group")
    .reduce((sum, s) => sum + s.durationMinutes, 0);
  const pct = totalMinutes > 0 ? Math.round((concurrentGroupMinutes / totalMinutes) * 100) : 0;

  return {
    patientId,
    therapyType,
    totalMinutes,
    concurrentGroupMinutes,
    pct,
    overCap: pct > CONCURRENT_GROUP_CAP_PCT,
  };
}

/* ------------------------------------------------------------------------ */
/* Team roster -- which therapists can see which patients                   */
/* ------------------------------------------------------------------------ */

export interface TeamRosterEntry {
  teamId: number;
  teamName: string;
  therapists: { id: number; name: string }[];
  patients: { id: number; roomNumber: string; name: string }[];
}

/** Groups therapists and active patients by team -- the actual "who can see whom" coverage map. */
export async function getTeamRoster(): Promise<TeamRosterEntry[]> {
  const [teams, therapists, patients] = await Promise.all([getTeams(), getTherapists(), getPatients()]);
  const active = patients.filter((p) => !p.isDischarged);

  const entries: TeamRosterEntry[] = teams.map((t) => ({
    teamId: t.id,
    teamName: t.name,
    therapists: therapists.filter((th) => th.teamId === t.id).map((th) => ({ id: th.id, name: th.name })),
    patients: active
      .filter((p) => p.teamId === t.id)
      .map((p) => ({ id: p.id, roomNumber: p.roomNumber, name: p.name })),
  }));

  const unassignedTherapists = therapists.filter((th) => th.teamId == null);
  const unassignedPatients = active.filter((p) => p.teamId == null);
  if (unassignedTherapists.length > 0 || unassignedPatients.length > 0) {
    entries.push({
      teamId: 0,
      teamName: "Unassigned",
      therapists: unassignedTherapists.map((th) => ({ id: th.id, name: th.name })),
      patients: unassignedPatients.map((p) => ({ id: p.id, roomNumber: p.roomNumber, name: p.name })),
    });
  }

  return entries;
}

/* ------------------------------------------------------------------------ */
/* Calendar view -- the actual booked schedule for a date range, with names */
/* joined in so PAMi doesn't have to cross-reference IDs against the roster */
/* ------------------------------------------------------------------------ */

export interface CalendarViewEntry {
  sessionId: number;
  patientId: number;
  patientName: string;
  roomNumber: string;
  therapistId: number | null;
  therapistName: string | null;
  therapyType: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  deliveryMode: string;
  status: string;
  missedReason: string | null;
  notes: string | null;
}

/**
 * The booked schedule for [startDate, endDate], optionally narrowed to one patient and/or
 * therapist. Unlike the daily context snapshot (today only, plus gap suggestions for
 * patients behind target), this lets PAMi answer "what's on the calendar for <any day/range>"
 * for a specific patient, therapist, or the whole unit.
 */
export async function getCalendarView(
  startDate: Date,
  endDate: Date,
  options: { patientId?: number; therapistId?: number } = {},
): Promise<CalendarViewEntry[]> {
  const [sessions, patients, therapists] = await Promise.all([
    getTherapySessionsForDateRange(startDate, endDate),
    getPatients(),
    getTherapists(),
  ]);

  const patientById = new Map(patients.map((p) => [p.id, p]));
  const therapistById = new Map(therapists.map((t) => [t.id, t]));

  return sessions
    .filter((s) => (options.patientId == null || s.patientId === options.patientId))
    .filter((s) => (options.therapistId == null || s.therapistId === options.therapistId))
    .map((s) => {
      const patient = patientById.get(s.patientId);
      const therapist = s.therapistId != null ? therapistById.get(s.therapistId) : undefined;
      return {
        sessionId: s.id,
        patientId: s.patientId,
        patientName: patient?.name ?? `Unknown patient ${s.patientId}`,
        roomNumber: patient?.roomNumber ?? "?",
        therapistId: s.therapistId,
        therapistName: therapist?.name ?? null,
        therapyType: s.therapyType,
        startTime: new Date(s.startTime),
        endTime: new Date(s.endTime),
        durationMinutes: s.durationMinutes,
        deliveryMode: s.deliveryMode,
        status: s.status,
        missedReason: s.missedReason,
        notes: s.notes,
      };
    })
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}
