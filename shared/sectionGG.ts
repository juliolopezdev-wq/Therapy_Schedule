// Internal 17-item IRF Section GG reference set, not the full IRF-PAI instrument or a CMS submission schema.
// Verify official coding, skip logic, exceptions, and reporting against the current IRF-PAI manual.
export const SECTION_GG_SCALE = [
  { value: 6, label: "6 - Independent" },
  { value: 5, label: "5 - Setup or clean-up assistance" },
  { value: 4, label: "4 - Supervision or touching assistance" },
  { value: 3, label: "3 - Partial/moderate assistance" },
  { value: 2, label: "2 - Substantial/maximal assistance" },
  { value: 1, label: "1 - Dependent" },
  { value: 7, label: "07 - Patient refused" },
  { value: 9, label: "09 - Not applicable" },
  { value: 10, label: "10 - Environmental limitations" },
  { value: 88, label: "88 - Medical condition or safety concern" },
  { value: 0, label: "Unscored / legacy unspecified reason" },
] as const;

export interface SectionGGItem {
  code: string;
  label: string;
  group: "self_care" | "mobility";
}

export const SECTION_GG_ITEMS: SectionGGItem[] = [
  { code: "GG0130A", label: "Eating", group: "self_care" },
  { code: "GG0130B", label: "Oral hygiene", group: "self_care" },
  { code: "GG0130C", label: "Toileting hygiene", group: "self_care" },
  { code: "GG0130E", label: "Shower/bathe self", group: "self_care" },
  { code: "GG0130F", label: "Upper body dressing", group: "self_care" },
  { code: "GG0130G", label: "Lower body dressing", group: "self_care" },
  { code: "GG0130H", label: "Putting on/taking off footwear", group: "self_care" },
  { code: "GG0170B", label: "Sit to lying", group: "mobility" },
  { code: "GG0170C", label: "Lying to sitting on side of bed", group: "mobility" },
  { code: "GG0170D", label: "Sit to stand", group: "mobility" },
  { code: "GG0170E", label: "Chair/bed-to-chair transfer", group: "mobility" },
  { code: "GG0170F", label: "Toilet transfer", group: "mobility" },
  { code: "GG0170I", label: "Walk 10 feet", group: "mobility" },
  { code: "GG0170J", label: "Walk 50 feet with two turns", group: "mobility" },
  { code: "GG0170K", label: "Walk 150 feet", group: "mobility" },
  { code: "GG0170M", label: "1 step (curb)", group: "mobility" },
  { code: "GG0170P", label: "Picking up object off floor", group: "mobility" },
];

export const SECTION_GG_VALUES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 88]);
export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function assessmentProgress(scores: Record<string, number>, signedAt?: unknown) {
  const answered = SECTION_GG_ITEMS.filter(item => SECTION_GG_VALUES.has(scores[item.code]) && scores[item.code] !== 0).length;
  const complete = answered === SECTION_GG_ITEMS.length;
  return { answered, complete, status: signedAt ? "Signed" : complete ? "Ready for review" : answered ? "Incomplete draft" : "Draft" };
}

/** Internal reference-set window checks, never a CMS submission/quality-measure calculation. */
export function assessmentWindow(assessment: { assessmentDate: string; assessmentType: string }, patient: { admissionDate: string | null; actualDischargeDate?: string | null }) {
  if (!isDateKey(assessment.assessmentDate) || !patient.admissionDate || !isDateKey(patient.admissionDate)) return "unverified" as const;
  const day = Date.parse(assessment.assessmentDate);
  const admission = Date.parse(patient.admissionDate);
  if (day < admission) return "outside" as const;
  if (assessment.assessmentType === "admission") return day < admission + 3 * 86_400_000 ? "within" as const : "outside" as const;
  if (assessment.assessmentType === "discharge") {
    if (!patient.actualDischargeDate || !isDateKey(patient.actualDischargeDate)) return "unverified" as const;
    const discharge = Date.parse(patient.actualDischargeDate);
    return day >= discharge - 2 * 86_400_000 && day <= discharge ? "within" as const : "outside" as const;
  }
  return "within" as const;
}
