export const THERAPY_TYPES = [
  "PT",
  "OT",
  "SLP",
  "PT Eval",
  "OT Eval",
  "SLP Eval",
  "Block",
] as const;

/** Kept for historical sessions created before evaluations were discipline-specific. */
export const LEGACY_THERAPY_TYPE = "Eval" as const;

export type TherapyType = (typeof THERAPY_TYPES)[number] | typeof LEGACY_THERAPY_TYPE;
export type TherapyDiscipline = "PT" | "OT" | "SLP";

export const ALL_THERAPY_TYPES = [
  "PT", "OT", "SLP", "PT Eval", "OT Eval", "SLP Eval", "Eval", "Block",
] as const satisfies readonly TherapyType[];

export const EVALUATION_THERAPY_TYPES = ["PT Eval", "OT Eval", "SLP Eval"] as const;
export const ALL_EVALUATION_THERAPY_TYPES: readonly TherapyType[] = [
  LEGACY_THERAPY_TYPE,
  ...EVALUATION_THERAPY_TYPES,
];

export function isEvaluationTherapyType(value: string): boolean {
  return ALL_EVALUATION_THERAPY_TYPES.includes(value as TherapyType);
}

/** Returns the licensed discipline that can perform the session, when one is known. */
export function therapyDiscipline(value: string): TherapyDiscipline | null {
  if (value === "PT" || value === "PT Eval") return "PT";
  if (value === "OT" || value === "OT Eval") return "OT";
  if (value === "SLP" || value === "SLP Eval") return "SLP";
  return null;
}
