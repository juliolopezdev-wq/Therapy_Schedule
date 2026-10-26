import { describe, expect, it } from "vitest";
import { canChartAssignedSession, canManageSchedule, isChartOnlyUpdate } from "./accessPolicy";

describe("account access policy", () => {
  it("allows admins and Team Leads to manage schedules", () => {
    expect(canManageSchedule("admin")).toBe(true);
    expect(canManageSchedule("team_lead")).toBe(true);
    expect(canManageSchedule("staff")).toBe(false);
    expect(canManageSchedule("viewer")).toBe(false);
  });

  it("allows staff to chart only assigned sessions and Team Leads to chart any session", () => {
    expect(canChartAssignedSession("staff", 12, 12)).toBe(true);
    expect(canChartAssignedSession("staff", 12, 13)).toBe(false);
    expect(canChartAssignedSession("staff", null, 12)).toBe(false);
    expect(canChartAssignedSession("viewer", 12, 12)).toBe(false);
    expect(canChartAssignedSession("team_lead", 12, 12)).toBe(true);
    expect(canChartAssignedSession("team_lead", 12, 13)).toBe(true);
    expect(canChartAssignedSession("team_lead", null, 13)).toBe(true);
    expect(canChartAssignedSession("admin", null, 13)).toBe(true);
  });

  it("rejects scheduling fields from a chart-only update", () => {
    expect(isChartOnlyUpdate(["status", "actualDurationMinutes", "notes", "missedReason"])).toBe(true);
    expect(isChartOnlyUpdate(["status", "startTime"])).toBe(false);
    expect(isChartOnlyUpdate(["therapistId"])).toBe(false);
  });
});
