export interface AdmissionLifecycleRecord {
  isDischarged: boolean;
  isRoomPlaceholder: boolean;
  archivedAt: Date | null;
}

/** True only for a real, current admission that belongs in census and scheduling workflows. */
export function isActiveAdmission(record: AdmissionLifecycleRecord): boolean {
  return !record.isDischarged && !record.isRoomPlaceholder && !record.archivedAt;
}
