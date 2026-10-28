export interface AdmissionLifecycleRecord {
  isDischarged: boolean;
  isRoomPlaceholder: boolean;
  archivedAt: Date | null;
}

/** True only for a real, current admission that belongs in census and scheduling workflows. */
export function isActiveAdmission(record: AdmissionLifecycleRecord): boolean {
  return !record.isDischarged && !record.isRoomPlaceholder && !record.archivedAt;
}

export interface AdmissionStayRecord extends AdmissionLifecycleRecord {
  admissionDate: string | null;
  actualDischargeDate: string | null;
}

/**
 * True when the patient was on the unit on this day (YYYY-MM-DD), admission and discharge day
 * included. Vacant-room markers always show. A discharge with no date on file is hidden.
 */
export function wasOnUnitOn(record: AdmissionStayRecord, dateKey: string): boolean {
  if (record.isRoomPlaceholder) return true;
  if (record.archivedAt) return false;
  if (record.admissionDate && dateKey < record.admissionDate) return false;
  if (!record.isDischarged) return true;
  return record.actualDischargeDate !== null && dateKey <= record.actualDischargeDate;
}
