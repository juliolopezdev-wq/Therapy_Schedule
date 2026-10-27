import { expect, it } from "vitest";
import { customCollisionDetection } from "../client/src/hooks/useBoardDnd";
const rect = (left: number, top: number, width = 72, height = 72) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
function args(patient: boolean, pointer = { x: 120, y: 30 }) {
  const items = [
    {
      id: "patient-1",
      r: rect(0, 0, 500),
      data: { patient: { id: 1 }, isPatientDrop: true },
    },
    {
      id: "patient-2",
      r: rect(0, 0, 500),
      data: { patient: { id: 2 }, isPatientDrop: true },
    },
    { id: "team-1", r: rect(0, 0, 500), data: { teamId: 1 } },
    { id: "team-2", r: rect(0, 100, 500), data: { teamId: 2 } },
    { id: "cell-2-4", r: rect(100, 0), data: { patientId: 2, slotIndex: 4 } },
    { id: "cell-2-5", r: rect(172, 0), data: { patientId: 2, slotIndex: 5 } },
  ];
  return {
    active: {
      id: patient ? "patient-1" : "session-1",
      data: {
        current: patient ? { patient: { id: 1 } } : { session: { id: 1 } },
      },
    },
    pointerCoordinates: pointer,
    collisionRect: rect(100, 0),
    droppableRects: new Map(items.map(i => [i.id, i.r])),
    droppableContainers: items.map(i => ({
      id: i.id,
      key: i.id,
      disabled: false,
      data: { current: i.data },
      rect: { current: i.r },
    })),
  } as never;
}
it("whole-patient collision checks ignore time cells and the active source row", () => {
  expect(customCollisionDetection(args(true)).map(hit => hit.id)).toEqual([
    "patient-2",
  ]);
});
it("still permits a whole-patient drop into an empty team", () => {
  expect(
    customCollisionDetection(args(true, { x: 120, y: 130 })).map(hit => hit.id)
  ).toEqual(["team-2"]);
});
it("preserves time-slot snapping for therapy-session drags", () => {
  expect(customCollisionDetection(args(false)).map(hit => hit.id)).toEqual([
    "cell-2-4",
  ]);
});
