// Facility-level Section GG analytics: completeness (the CMS reporting-threshold risk),
// admission-to-discharge trend (the publicly reported quality measure), and cross-therapist
// scoring consistency (the audit/accuracy risk). Reference analytics only -- see shared/sectionGG.ts.
import { getPatients, getAllFunctionalAssessments } from "./db";
import { isActiveAdmission } from "../shared/patientLifecycle";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function totalScore(itemScores: Record<string, number>): number {
  return Object.values(itemScores).reduce((sum, v) => sum + (v > 0 ? v : 0), 0);
}

export interface GGCompletenessItem {
  patientId: number;
  patientName: string;
  roomNumber: string;
  admissionDate: string | null;
  estimatedDischargeDate: string | null;
  isDischarged: boolean;
  hasAdmissionGG: boolean;
  hasDischargeGG: boolean;
  daysSinceAdmission: number | null;
  daysUntilDischarge: number | null;
  flag: "missing_admission" | "discharge_due_soon" | "missing_discharge" | null;
  severity: "critical" | "warning" | null;
}

export async function getGGCompletenessReport(referenceDate: Date = new Date()): Promise<{
  items: GGCompletenessItem[];
  admissionCompletionRate: number;
  dischargeCompletionRate: number;
}> {
  const [allPatients, allAssessments] = await Promise.all([getPatients(), getAllFunctionalAssessments()]);
  const activePatients = allPatients.filter(isActiveAdmission);
  const recentlyDischarged = allPatients.filter((p) => p.isDischarged && !p.archivedAt);
  const relevantPatients = [...activePatients, ...recentlyDischarged.filter((p) => !activePatients.some((a) => a.id === p.id))];

  const hasAdmission = new Set<number>();
  const hasDischarge = new Set<number>();
  for (const a of allAssessments) {
    if (a.assessmentType === "admission") hasAdmission.add(a.patientId);
    if (a.assessmentType === "discharge") hasDischarge.add(a.patientId);
  }

  const items: GGCompletenessItem[] = relevantPatients.map((p) => {
    const hasAdmissionGG = hasAdmission.has(p.id);
    const hasDischargeGG = hasDischarge.has(p.id);
    const daysSinceAdmission = p.admissionDate
      ? Math.floor((referenceDate.getTime() - new Date(p.admissionDate).getTime()) / MS_PER_DAY)
      : null;
    const daysUntilDischarge = p.estimatedDischargeDate
      ? Math.floor((new Date(p.estimatedDischargeDate).getTime() - referenceDate.getTime()) / MS_PER_DAY)
      : null;

    let flag: GGCompletenessItem["flag"] = null;
    let severity: GGCompletenessItem["severity"] = null;

    if (p.isDischarged && !hasDischargeGG) {
      flag = "missing_discharge";
      severity = "critical";
    } else if (!p.isDischarged && daysUntilDischarge != null && daysUntilDischarge <= 2 && !hasDischargeGG) {
      flag = "discharge_due_soon";
      severity = daysUntilDischarge <= 0 ? "critical" : "warning";
    } else if (!hasAdmissionGG && daysSinceAdmission != null && daysSinceAdmission >= 0) {
      if (daysSinceAdmission > 8) {
        flag = "missing_admission";
        severity = "critical";
      } else if (daysSinceAdmission > 3) {
        flag = "missing_admission";
        severity = "warning";
      }
    }

    return {
      patientId: p.id,
      patientName: p.name,
      roomNumber: p.roomNumber,
      admissionDate: p.admissionDate,
      estimatedDischargeDate: p.estimatedDischargeDate,
      isDischarged: p.isDischarged,
      hasAdmissionGG,
      hasDischargeGG,
      daysSinceAdmission,
      daysUntilDischarge,
      flag,
      severity,
    };
  });

  const rank = (s: GGCompletenessItem["severity"]) => (s === "critical" ? 0 : s === "warning" ? 1 : 2);
  items.sort((a, b) => rank(a.severity) - rank(b.severity));

  const eligibleForAdmission = items.filter((i) => i.daysSinceAdmission != null && i.daysSinceAdmission >= 0);
  const admissionCompletionRate = eligibleForAdmission.length > 0
    ? Math.round((eligibleForAdmission.filter((i) => i.hasAdmissionGG).length / eligibleForAdmission.length) * 100)
    : 100;
  const eligibleForDischarge = items.filter((i) => i.isDischarged || (i.daysUntilDischarge != null && i.daysUntilDischarge <= 0));
  const dischargeCompletionRate = eligibleForDischarge.length > 0
    ? Math.round((eligibleForDischarge.filter((i) => i.hasDischargeGG).length / eligibleForDischarge.length) * 100)
    : 100;

  return { items, admissionCompletionRate, dischargeCompletionRate };
}

export interface GGTrendPoint {
  month: string; // "YYYY-MM"
  therapyType: string | null;
  admissionAvg: number;
  dischargeAvg: number;
  changeAvg: number;
  patientCount: number;
}

export async function getGGTrendReport(): Promise<GGTrendPoint[]> {
  const assessments = await getAllFunctionalAssessments();
  const byPatient = new Map<number, { admission?: typeof assessments[number]; discharge?: typeof assessments[number] }>();
  for (const a of assessments) {
    const entry = byPatient.get(a.patientId) ?? {};
    if (a.assessmentType === "admission" && (!entry.admission || a.assessmentDate > entry.admission.assessmentDate)) entry.admission = a;
    if (a.assessmentType === "discharge" && (!entry.discharge || a.assessmentDate > entry.discharge.assessmentDate)) entry.discharge = a;
    byPatient.set(a.patientId, entry);
  }

  const grouped = new Map<string, { admissionSum: number; dischargeSum: number; count: number; therapyType: string | null; month: string }>();
  for (const pair of Array.from(byPatient.values())) {
    if (!pair.admission || !pair.discharge) continue;
    const month = pair.discharge.assessmentDate.slice(0, 7);
    const therapyType = pair.discharge.therapyType ?? null;
    const key = `${month}|${therapyType ?? "unassigned"}`;
    const existing = grouped.get(key) ?? { admissionSum: 0, dischargeSum: 0, count: 0, therapyType, month };
    existing.admissionSum += totalScore(pair.admission.itemScores as Record<string, number>);
    existing.dischargeSum += totalScore(pair.discharge.itemScores as Record<string, number>);
    existing.count += 1;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values())
    .map((v) => ({
      month: v.month,
      therapyType: v.therapyType,
      admissionAvg: Math.round((v.admissionSum / v.count) * 10) / 10,
      dischargeAvg: Math.round((v.dischargeSum / v.count) * 10) / 10,
      changeAvg: Math.round(((v.dischargeSum - v.admissionSum) / v.count) * 10) / 10,
      patientCount: v.count,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export interface GGConsistencyFlag {
  therapistId: number;
  therapistName: string;
  itemCode: string;
  therapistAvg: number;
  facilityAvg: number;
  deviation: number;
  sampleSize: number;
}

const MIN_SAMPLE_SIZE = 3;
const DEVIATION_THRESHOLD = 1.0;

/** Flags a therapist as scoring an item meaningfully differently from the facility average --
 *  a signal for calibration, not proof anyone is wrong (could be a harder caseload). */
export async function getGGScoringConsistencyReport(): Promise<GGConsistencyFlag[]> {
  const assessments = await getAllFunctionalAssessments();
  const facilitySums = new Map<string, { sum: number; count: number }>();
  const therapistSums = new Map<string, { therapistId: number; therapistName: string; itemCode: string; sum: number; count: number }>();

  for (const a of assessments) {
    if (a.completedByTherapistId == null) continue;
    const scores = a.itemScores as Record<string, number>;
    for (const [itemCode, score] of Object.entries(scores)) {
      if (!(score > 0)) continue; // skip not-attempted/unscored
      const fEntry = facilitySums.get(itemCode) ?? { sum: 0, count: 0 };
      fEntry.sum += score;
      fEntry.count += 1;
      facilitySums.set(itemCode, fEntry);

      const tKey = `${a.completedByTherapistId}|${itemCode}`;
      const tEntry = therapistSums.get(tKey) ?? {
        therapistId: a.completedByTherapistId, therapistName: a.therapistName ?? "Unknown", itemCode, sum: 0, count: 0,
      };
      tEntry.sum += score;
      tEntry.count += 1;
      therapistSums.set(tKey, tEntry);
    }
  }

  const flags: GGConsistencyFlag[] = [];
  for (const t of Array.from(therapistSums.values())) {
    const f = facilitySums.get(t.itemCode);
    if (!f || t.count < MIN_SAMPLE_SIZE) continue;
    const therapistAvg = t.sum / t.count;
    const facilityAvg = f.sum / f.count;
    const deviation = Math.round((therapistAvg - facilityAvg) * 10) / 10;
    if (Math.abs(deviation) >= DEVIATION_THRESHOLD) {
      flags.push({
        therapistId: t.therapistId,
        therapistName: t.therapistName,
        itemCode: t.itemCode,
        therapistAvg: Math.round(therapistAvg * 10) / 10,
        facilityAvg: Math.round(facilityAvg * 10) / 10,
        deviation,
        sampleSize: t.count,
      });
    }
  }
  return flags.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
}
