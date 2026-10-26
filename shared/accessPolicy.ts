export type AccountRole = "admin" | "team_lead" | "staff" | "viewer";

const STAFF_CHART_FIELDS = new Set(["actualDurationMinutes", "notes", "status", "missedReason"]);

export function canManageSchedule(role: AccountRole): boolean {
  return role === "admin" || role === "team_lead";
}

export function canChartAssignedSession(
  role: AccountRole,
  ownTherapistId: number | null,
  sessionTherapistId: number | null,
): boolean {
  if (canManageSchedule(role)) return true;
  return role === "staff"
    && ownTherapistId != null
    && ownTherapistId === sessionTherapistId;
}

export function isChartOnlyUpdate(fields: string[]): boolean {
  return fields.every((field) => STAFF_CHART_FIELDS.has(field));
}
