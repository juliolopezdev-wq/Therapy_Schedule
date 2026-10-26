import { useAuth } from "@/_core/hooks/useAuth";

/**
 * Single source of truth for role-based UI gating. The backend (server/_core/trpc.ts) is the
 * real enforcement point -- these flags only control what the UI shows/allows so staff/viewer
 * don't hit a dead-end FORBIDDEN toast on every click.
 */
export function usePermissions() {
  const { user } = useAuth();
  const role = user?.role ?? null;
  const therapistId = user?.accessScope?.therapistId ?? null;
  const teamId = user?.accessScope?.teamId ?? null;
  const isLinked = user?.accessScope?.linked ?? role === "admin";
  return {
    role,
    therapistId,
    teamId,
    isLinked,
    /** Team membership organizes the board; only a staff-profile link controls personal writes. */
    hasBoardAccess: role === "admin" || role === "team_lead" || (isLinked && therapistId != null),
    /** Scheduling, staffing, and team-level changes. */
    canEdit: role === "admin" || role === "team_lead",
    canSchedule: role === "admin" || role === "team_lead",
    /** Staff can document only their own assigned sessions. */
    canChart: role === "admin" || role === "team_lead" || role === "staff",
    isTeamLead: role === "team_lead",
    /** Destructive/config actions: deletes, therapist/team roster management, user management. */
    isAdmin: role === "admin",
  };
}
