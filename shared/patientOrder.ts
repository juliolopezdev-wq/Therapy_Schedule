export type PatientOrder = {
  id: number;
  teamId: number | null;
  orderIndex: number | null;
  roomNumber: string;
  isDischarged?: boolean;
  archivedAt?: unknown;
};
export type PatientMove = {
  patientId: number;
  targetTeamId: number | null;
  targetPatientId?: number | null;
  placeAfter?: boolean;
};
export type PatientPosition = {
  id: number;
  teamId: number | null;
  orderIndex: number;
};
export const comparePatientOrder = (a: PatientOrder, b: PatientOrder) =>
  a.orderIndex == null && b.orderIndex != null
    ? -1
    : a.orderIndex != null && b.orderIndex == null
      ? 1
      : (a.orderIndex ?? 0) - (b.orderIndex ?? 0) ||
        a.roomNumber.localeCompare(b.roomNumber);

/** Normally changes only the moving row. Legacy ties/precision exhaustion rebalance the destination. */
export function planPatientMove<T extends PatientOrder>(
  patients: T[],
  move: PatientMove
): PatientPosition[] {
  const active = patients.filter(p => !p.isDischarged && !p.archivedAt);
  const moving = active.find(p => p.id === move.patientId);
  if (!moving) throw new Error("Active admission not found");
  if (move.targetPatientId === moving.id && moving.teamId === move.targetTeamId)
    return [];
  const destination = active
    .filter(p => p.id !== moving.id && p.teamId === move.targetTeamId)
    .sort(comparePatientOrder);
  let at = destination.length;
  if (move.targetPatientId != null) {
    const target = destination.findIndex(p => p.id === move.targetPatientId);
    if (target < 0) throw new Error("Drop target is no longer available");
    at = target + (move.placeAfter ? 1 : 0);
  }
  const before = at > 0 ? (destination[at - 1].orderIndex ?? 0) : undefined;
  const after =
    at < destination.length ? (destination[at].orderIndex ?? 0) : undefined;
  const rank =
    before == null
      ? after == null
        ? 100
        : after - 100
      : after == null
        ? before + 100
        : before / 2 + after / 2;
  const fits =
    destination.every(
      p => p.orderIndex != null && Number.isFinite(p.orderIndex)
    ) &&
    Number.isFinite(rank) &&
    (before == null || rank > before) &&
    (after == null || rank < after);
  if (fits)
    return moving.teamId === move.targetTeamId && moving.orderIndex === rank
      ? []
      : [{ id: moving.id, teamId: move.targetTeamId, orderIndex: rank }];
  const reordered = [...destination];
  reordered.splice(at, 0, moving);
  return reordered.flatMap((p, index) =>
    p.teamId === move.targetTeamId && p.orderIndex === (index + 1) * 100
      ? []
      : [{ id: p.id, teamId: move.targetTeamId, orderIndex: (index + 1) * 100 }]
  );
}

export function applyPatientPositions<T extends PatientOrder>(
  patients: T[],
  positions: PatientPosition[]
): T[] {
  if (!positions.length) return patients;
  const byId = new Map(positions.map(p => [p.id, p]));
  return patients
    .map(p => (byId.has(p.id) ? { ...p, ...byId.get(p.id)! } : p))
    .sort(comparePatientOrder);
}

/** Rebase pending gestures after success/failure instead of rolling back an entire stale snapshot. */
export class PatientMoveQueue<T extends PatientOrder> {
  private pending: { id: number; move: PatientMove }[] = [];
  constructor(private base: T[]) {}
  add(id: number, move: PatientMove) {
    this.pending.push({ id, move });
  }
  settle(id: number, positions?: PatientPosition[]) {
    if (positions) this.base = applyPatientPositions(this.base, positions);
    this.pending = this.pending.filter(operation => operation.id !== id);
  }
  get size() {
    return this.pending.length;
  }
  view(): T[] {
    return this.pending.reduce((current, operation) => {
      try {
        return applyPatientPositions(
          current,
          planPatientMove(current, operation.move)
        );
      } catch {
        return current;
      } // A failed preceding gesture may invalidate this target; the server decides.
    }, this.base);
  }
}
