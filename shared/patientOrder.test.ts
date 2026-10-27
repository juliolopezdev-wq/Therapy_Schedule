import { expect, it } from "vitest";
import {
  applyPatientPositions,
  planPatientMove,
  PatientMoveQueue,
} from "./patientOrder";
const rows = () =>
  [1, 2, 3, 4].map(id => ({
    id,
    roomNumber: String(100 + id),
    teamId: id === 4 ? 2 : 1,
    orderIndex: id * 100,
    isDischarged: false,
  }));
it("moves one row between neighbors while preserving other object references", () => {
  const source = rows();
  const positions = planPatientMove(source, {
    patientId: 1,
    targetTeamId: 1,
    targetPatientId: 3,
    placeAfter: true,
  });
  expect(positions).toHaveLength(1);
  const result = applyPatientPositions(source, positions);
  expect(result.filter(p => p.teamId === 1).map(p => p.id)).toEqual([2, 3, 1]);
  expect(result.find(p => p.id === 2)).toBe(source[1]);
});
it("supports before/after, cross-team, empty team, and unassigned moves", () => {
  for (const [move, expectedTeam] of [
    [
      { patientId: 3, targetTeamId: 1, targetPatientId: 1, placeAfter: false },
      1,
    ],
    [
      { patientId: 1, targetTeamId: 2, targetPatientId: 4, placeAfter: true },
      2,
    ],
    [{ patientId: 1, targetTeamId: 3 }, 3],
    [{ patientId: 1, targetTeamId: null }, null],
  ] as const) {
    const positions = planPatientMove(rows(), move);
    expect(positions).toHaveLength(1);
    expect(positions[0].teamId).toBe(expectedTeam);
  }
});
it("rebalances legacy ties and exhausted numeric gaps without changing the source team", () => {
  const source = rows().map(p => ({ ...p, orderIndex: 0 }));
  const positions = planPatientMove(source, {
    patientId: 4,
    targetTeamId: 1,
    targetPatientId: 2,
    placeAfter: true,
  });
  expect(
    applyPatientPositions(source, positions)
      .filter(p => p.teamId === 1)
      .map(p => p.id)
  ).toEqual([1, 2, 4, 3]);
  const tight = rows();
  tight[0].orderIndex = 1;
  tight[1].orderIndex = 1 + Number.EPSILON;
  expect(
    planPatientMove(tight, {
      patientId: 3,
      targetTeamId: 1,
      targetPatientId: 2,
    })
  ).toHaveLength(3);
});
it("rejects stale destinations and inactive source records", () => {
  expect(() =>
    planPatientMove(rows(), {
      patientId: 1,
      targetTeamId: 2,
      targetPatientId: 3,
    })
  ).toThrow("Drop target");
  expect(() =>
    planPatientMove(
      rows().map(p => ({ ...p, isDischarged: p.id === 1 })),
      { patientId: 1, targetTeamId: 2 }
    )
  ).toThrow("Active admission");
});
it("normalizes legacy null ranks so SQL and optimistic ordering agree", () => {
  const source = rows().map(p => ({
    ...p,
    orderIndex: p.id === 2 ? null : p.orderIndex,
  }));
  const positions = planPatientMove(source, {
    patientId: 3,
    targetTeamId: 1,
    targetPatientId: 2,
  });
  expect(
    applyPatientPositions(source, positions)
      .filter(p => p.teamId === 1)
      .map(p => p.id)
  ).toEqual([3, 2, 1]);
  expect(positions.every(p => Number.isFinite(p.orderIndex))).toBe(true);
});
it("rebases a newer gesture when the preceding save fails", () => {
  const queue = new PatientMoveQueue(rows());
  queue.add(1, {
    patientId: 1,
    targetTeamId: 1,
    targetPatientId: 3,
    placeAfter: true,
  });
  queue.add(2, {
    patientId: 2,
    targetTeamId: 2,
    targetPatientId: 4,
    placeAfter: true,
  });
  queue.settle(1);
  expect(queue.view().find(p => p.id === 1)?.teamId).toBe(1);
  expect(
    queue
      .view()
      .filter(p => p.teamId === 2)
      .map(p => p.id)
  ).toEqual([4, 2]);
  const confirmed = planPatientMove(rows(), {
    patientId: 2,
    targetTeamId: 2,
    targetPatientId: 4,
    placeAfter: true,
  });
  queue.settle(2, confirmed);
  expect(queue.size).toBe(0);
  expect(
    queue
      .view()
      .filter(p => p.teamId === 2)
      .map(p => p.id)
  ).toEqual([4, 2]);
});
it("keeps an earlier successful move when a later gesture fails", () => {
  const original = rows();
  const queue = new PatientMoveQueue(original);
  const first = {
    patientId: 1,
    targetTeamId: 2,
    targetPatientId: 4,
    placeAfter: true,
  };
  queue.add(1, first);
  queue.add(2, { patientId: 1, targetTeamId: null });
  queue.settle(1, planPatientMove(original, first));
  queue.settle(2);
  expect(queue.view().find(p => p.id === 1)?.teamId).toBe(2);
});
