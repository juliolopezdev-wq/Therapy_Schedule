import { formatDateKey } from "../shared/timeGrid";
// Internal IRF reference-set review. These are not CMS submission rates, public quality measures, or validated staff rankings.
import { getPatients, getAllFunctionalAssessments } from "./db";
import { isActiveAdmission } from "../shared/patientLifecycle";
import { assessmentProgress, assessmentWindow, SECTION_GG_ITEMS } from "../shared/sectionGG";

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
  admissionStatus: string;
  dischargeStatus: string;
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
    const patient = allPatients.find(p => p.id === a.patientId);
    if (!patient || !a.signedAt || !assessmentProgress(a.itemScores as Record<string, number>).complete || assessmentWindow(a, patient) !== "within") continue;
    if (a.assessmentType === "admission") hasAdmission.add(a.patientId);
    if (a.assessmentType === "discharge") hasDischarge.add(a.patientId);
  }

  const items: GGCompletenessItem[] = relevantPatients.map((p) => {
    const reviewStatus = (type: string) => {
      const record = allAssessments.filter(a => a.patientId === p.id && a.assessmentType === type).sort((a, b) => b.assessmentDate.localeCompare(a.assessmentDate))[0];
      if (!record) return "Not started";
      const progress = assessmentProgress(record.itemScores as Record<string, number>, record.signedAt);
      if (!record.signedAt || !progress.complete) return `${progress.status} · ${progress.answered}/${SECTION_GG_ITEMS.length} items`;
      const window = assessmentWindow(record, p);
      return window === "within" ? "Signed and complete (reference set)" : window === "outside" ? "Signed · outside assessment window" : "Signed · assessment window unverified";
    };
    const hasAdmissionGG = hasAdmission.has(p.id);
    const hasDischargeGG = hasDischarge.has(p.id);
    const daysSinceAdmission = p.admissionDate
      ? Math.floor((Date.parse(formatDateKey(referenceDate)) - Date.parse(p.admissionDate)) / MS_PER_DAY)
      : null;
    const daysUntilDischarge = p.estimatedDischargeDate
      ? Math.floor((Date.parse(p.estimatedDischargeDate) - Date.parse(formatDateKey(referenceDate))) / MS_PER_DAY)
      : null;

    let flag: GGCompletenessItem["flag"] = null;
    let severity: GGCompletenessItem["severity"] = null;

    if (p.isDischarged && !hasDischargeGG) {
      flag = "missing_discharge";
      severity = "critical";
    } else if (!p.isDischarged && daysUntilDischarge != null && daysUntilDischarge <= 2 && !hasDischargeGG) {
      flag = "discharge_due_soon";
      severity = daysUntilDischarge <= 0 ? "critical" : "warning";
    } else if (!hasAdmissionGG) {
      if (daysSinceAdmission != null && daysSinceAdmission > 8) {
        flag = "missing_admission";
        severity = "critical";
      } else {
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
      admissionStatus: reviewStatus("admission"), dischargeStatus: reviewStatus("discharge"),
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
    : 0;
  const eligibleForDischarge = items.filter((i) => i.isDischarged || (i.daysUntilDischarge != null && i.daysUntilDischarge <= 0));
  const dischargeCompletionRate = eligibleForDischarge.length > 0
    ? Math.round((eligibleForDischarge.filter((i) => i.hasDischargeGG).length / eligibleForDischarge.length) * 100)
    : 0;

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
    if (!a.signedAt || !assessmentProgress(a.itemScores as Record<string, number>).complete) continue;
    // Raw totals are comparable only when every item has an actual 1–6 performance score.
    if (SECTION_GG_ITEMS.some(item => (a.itemScores as Record<string, number>)[item.code] < 1 || (a.itemScores as Record<string, number>)[item.code] > 6)) continue;
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

const MIN_SAMPLE_SIZE = 10; // Operational review floor, not a validated statistical cutoff.
const DEVIATION_THRESHOLD = 1.0;

/** Flags a therapist as scoring an item meaningfully differently from the facility average --
 *  a signal for calibration, not proof anyone is wrong (could be a harder caseload). */
export async function getGGScoringConsistencyReport(): Promise<GGConsistencyFlag[]> {
  const assessments = await getAllFunctionalAssessments();
  const facilitySums = new Map<string, { sum: number; count: number }>();
  const therapistSums = new Map<string, { therapistId: number; therapistName: string; itemCode: string; sum: number; count: number }>();

  for (const a of assessments) {
    if (a.completedByTherapistId == null || !a.signedAt) continue;
    const scores = a.itemScores as Record<string, number>;
    for (const [itemCode, score] of Object.entries(scores)) {
      if (!(score >= 1 && score <= 6)) continue;
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
