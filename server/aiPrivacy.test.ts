import { describe, expect, it } from "vitest";
import { AiPseudonymizer } from "./aiPrivacy";

const patients = [
  { id: 12, name: "Jane Doe", roomNumber: "204", mrn: "MRN88231" },
  { id: 15, name: "Robert Quill", roomNumber: "211B", mrn: null },
];
const staff = ["Alex Rivera", "Sam Doe-Lee"];
// Tue Oct 27 2026, 8:00 local
const today = new Date(2026, 9, 27, 8, 0);

function make() {
  return new AiPseudonymizer(patients, staff, today);
}

describe("AI pseudonymizer", () => {
  it("replaces every patient reference format used in the scheduler context", () => {
    const p = make();
    const jane = p.codeFor(12);
    const robert = p.codeFor(15);
    const context = [
      "- [id 12] Room 204 (Jane Doe), team 1: 300/900 min",
      "- Team 1, PT: Room 204 (Jane Doe, id 12), Room 211B (Robert Quill, id 15)",
      "- Team 1 [team id 1]: therapists: Alex Rivera (id 3); patients: Room 211B Robert Quill (id 15)",
      "Warning: patient 12's PT minutes are now 30% concurrent/group",
    ].join("\n");
    const out = p.encodeText(context);
    expect(out).toContain(`- ${jane}, team 1`);
    expect(out).toContain(`PT: ${jane}, ${robert}`);
    expect(out).toContain(`patients: ${robert}`);
    expect(out).toContain(`Warning: ${jane}'s PT`);
    expect(out).toContain("Alex Rivera (id 3)");
    expect(p.findLeaks(out)).toEqual([]);
  });

  it("codes names, rooms and MRNs that staff type into a question", () => {
    const p = make();
    const out = p.encodeText("Can doe in 204 get PT? Her MRN is mrn88231. What about Quill?", { bareRooms: true });
    expect(out).not.toMatch(/doe|204|88231|quill/i);
    expect(out).toContain(p.codeFor(12));
    expect(out).toContain(p.codeFor(15));
  });

  it("keeps staff names even when they share a patient's last name", () => {
    const p = make();
    expect(p.encodeText("Sam Doe-Lee is free at 10")).toContain("Sam Doe-Lee");
  });

  it("turns calendar dates into days relative to today", () => {
    const p = make();
    expect(p.encodeText("Est. DC: 2026-10-30.")).toBe("Est. DC: today+3.");
    expect(p.encodeText("Wed, Oct 28: refused")).toBe("today+1: refused");
    expect(p.encodeText("starts 2026-10-26T14:30:00")).toBe("starts today-1 14:30");
    expect(p.encodeText("admitted 10/20/2026")).toBe("admitted today-7");
    expect(p.findLeaks(p.encodeText("on 2026-11-02"))).toEqual([]);
  });

  it("encodes tool results structurally", () => {
    const p = make();
    const json = JSON.stringify({
      patients: [{ id: 12, name: "Jane Doe", roomNumber: "204", mrn: "MRN88231", weeklyMinuteTarget: 900 }],
      sessions: [{ id: 99, patientId: 15, patientName: "Robert Quill", roomNumber: "211B", startTime: "2026-10-28T09:00:00" }],
    });
    const out = p.encodeToolResult(json);
    const parsed = JSON.parse(out);
    expect(parsed.patients[0]).toEqual({ patientCode: p.codeFor(12), weeklyMinuteTarget: 900 });
    expect(parsed.sessions[0]).toEqual({ id: 99, patientId: p.codeFor(15), patientName: p.codeFor(15), startTime: "today+1 09:00" });
    expect(p.findLeaks(out)).toEqual([]);
  });

  it("decodes codes and relative days in model output and tool arguments", () => {
    const p = make();
    const jane = p.codeFor(12);
    expect(p.decodeText(`${jane} can do PT today+1 09:30.`)).toBe("Room 204 (Jane Doe) can do PT Wed, Oct 28 9:30 AM.");
    const call = p.decodeToolCall({
      function: { name: "create_session", arguments: { patientId: jane, therapistId: 3, startTime: "today+1 09:30", durationMinutes: 60 } },
    });
    expect(call.function.arguments).toEqual({ patientId: 12, therapistId: 3, startTime: "2026-10-28T09:30:00", durationMinutes: 60 });
    expect(p.decodeToolCall({ function: { name: "view_calendar", arguments: { startDate: "today-2" } } }).function.arguments).toEqual({ startDate: "2026-10-25" });
  });

  it("rejects tool calls with an unknown patient code", () => {
    const p = make();
    expect(() => p.decodeToolCall({ function: { name: "create_session", arguments: { patientId: "P-ZZZZ" } } })).toThrow(/Unknown patient code/);
  });

  it("round-trips the model's own tool calls when they are sent back", () => {
    const p = make();
    const decoded = p.decodeToolCall({ function: { name: "get_delivery_mode_mix", arguments: { patientId: p.codeFor(15), therapyType: "PT" } } });
    const [msg] = p.encodeMessages([{ role: "assistant", content: "", tool_calls: [decoded] }]);
    expect(msg.tool_calls?.[0].function.arguments).toEqual({ patientId: p.codeFor(15), therapyType: "PT" });
  });

  it("rewrites tool schemas to codes and relative days", () => {
    const p = make();
    const tools = [{ function: { name: "x", parameters: { properties: {
      patientId: { type: "integer" },
      startTime: { type: "string", description: "ISO 8601 datetime, e.g. 2026-06-18T09:00:00" },
      startDate: { type: "string", description: "ISO 8601 date, e.g. 2026-07-20. The first day." },
    } } } }];
    const out = JSON.stringify(p.encodeTools(tools));
    expect(out).toContain("Patient code");
    expect(out).toContain("today+1 09:00");
    expect(p.findLeaks(out)).toEqual([]);
  });

  it("flags anything that slipped through", () => {
    const p = make();
    expect(p.findLeaks("Jane Doe in Room 204, MRN88231, 2026-10-28")).toEqual(["patient name", "MRN", "room number", "calendar date"]);
  });
});
