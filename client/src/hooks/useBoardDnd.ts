import { type DragStartEvent, type DragEndEvent, type CollisionDetection, pointerWithin } from "@dnd-kit/core";
import { toast } from "sonner";
import { TIME_SLOTS, slotIndexToDate } from "@/lib/board";
import { type SessionTileData } from "@/components/board/SessionTile";
import type { Patient, Team } from "../../../drizzle/schema";
import type { trpc } from "@/lib/trpc";

export type BoardSection = Team & { patients: Patient[] };

interface UseBoardDndProps {
  day: Date;
  patientsBySection: BoardSection[];
  setActiveDrag: (session: SessionTileData | null) => void;
  setActiveDragPatient: (patient: Patient | null) => void;
  reorderPatient: ReturnType<typeof trpc.patients.reorder.useMutation>;
  updateSession: ReturnType<typeof trpc.sessions.update.useMutation>;
  checkLunchOverlap: (start: Date, end: Date) => string | null;
  checkTherapistAvailability: (therapistId: number | null, start: Date, end: Date) => string | null;
  checkDoubleBooking: (therapistId: number | null, deliveryMode: string, start: Date, end: Date, ignoreSessionId?: number) => string | null;
  processWarnings: (warnings: (string | null)[], onConfirm: () => void) => void;
  /** Viewer role -- dragging would only hit a FORBIDDEN on drop, so disable it at the source. */
  canEdit: boolean;
}

export const customCollisionDetection: CollisionDetection = (args) => {
  const patientDrag = Boolean(args.active.data.current?.patient);
  const pointerCollisions = pointerWithin(patientDrag ? { ...args, droppableContainers: args.droppableContainers.filter(container => {
    const id = String(container.id);
    return id !== String(args.active.id) && (id.startsWith("patient-") || id.startsWith("team-"));
  }) } : args);
  const isSession = args.active.data.current?.session;

  if (isSession) {
    const pointerCell = pointerCollisions.find(c => c.id.toString().startsWith('cell-'));
    if (!pointerCell) return [];

    const pointerPatientId = pointerCell.id.toString().split('-')[1];
    const rowContainers = args.droppableContainers.filter(c => c.id.toString().startsWith(`cell-${pointerPatientId}-`));
    
    if (rowContainers.length === 0) return [pointerCell];

    const dragLeft = args.collisionRect.left;
    
    let closestCell = rowContainers[0];
    let minDiff = Infinity;
    
    for (const container of rowContainers) {
      const containerLeft = container.rect.current?.left ?? 0;
      const diff = Math.abs(containerLeft - dragLeft);
      if (diff < minDiff) {
        minDiff = diff;
        closestCell = container;
      }
    }
    
    return [{ id: closestCell.id, data: closestCell.data?.current }];
  }

  if (pointerCollisions.length > 0) {
    const isPatient = args.active.data.current?.patient;
    if (isPatient) {
      const patients = pointerCollisions.filter(c => c.id.toString().startsWith('patient-') && c.id !== args.active.id);
      if (patients.length > 0) return patients;
      const teams = pointerCollisions.filter(c => c.id.toString().startsWith('team-'));
      if (teams.length > 0) return teams;
    }
    return pointerCollisions;
  }
  return [];
};

export function useBoardDnd({
  day,
  patientsBySection,
  setActiveDrag,
  setActiveDragPatient,
  reorderPatient,
  updateSession,
  checkLunchOverlap,
  checkTherapistAvailability,
  checkDoubleBooking,
  processWarnings,
  canEdit,
}: UseBoardDndProps) {

  function handleDragStart(event: DragStartEvent) {
    if (!canEdit) return;
    const data = event.active.data.current as any;
    if (data?.session) {
      setActiveDrag(data.session);
    } else if (data?.patient) {
      setActiveDragPatient(data.patient);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    setActiveDragPatient(null);
    if (!canEdit) return;
    const { active, over } = event;
    if (!over) return;
    
    const data = active.data.current as any;
    
    // Handle patient drag
    if (data?.patient) {
      const targetData = over.data.current as any;
      if (targetData?.teamId !== undefined) {
        const targetTeamId = targetData.teamId === 0 ? null : targetData.teamId;
        if (targetData.isPatientDrop) {
          const targetPatientId = Number(over.id.toString().replace("patient-", ""));
          const targetSection = patientsBySection.find(s => 
            s.id === targetData.teamId || (s.id === 0 && targetData.teamId === null)
          );
          
          if (targetSection) {
            const overIndex = targetSection.patients.findIndex((p) => p.id === targetPatientId);
            const activeIndex = data.patient.teamId === targetData.teamId
              ? targetSection.patients.findIndex((p) => p.id === data.patient.id)
              : -1;

            if (overIndex !== -1) {
              if (activeIndex === overIndex) return; // Dropped in the exact same spot

              const activeRect = active.rect.current.translated;
              const activeCenter = activeRect
                ? activeRect.top + activeRect.height / 2
                : over.rect.top + over.rect.height / 2;
              const placeAfter = activeIndex !== -1
                ? activeIndex < overIndex
                : activeCenter > over.rect.top + over.rect.height / 2;

              reorderPatient.mutate({
                patientId: data.patient.id,
                targetTeamId,
                targetPatientId,
                placeAfter,
              });
              return;
            }
          }
          return;
        }

        // A team-header drop means "append to this team". It is a no-op when the
        // patient is already in that team (including the synthetic Unassigned team).
        if (data.patient.teamId === targetTeamId) return;
        reorderPatient.mutate({
          patientId: data.patient.id,
          targetTeamId,
          targetPatientId: null,
        });
      }
      return;
    }

    // Handle session drag
    const session = data?.session;
    let target = over.data.current as any;
    if (!session || !target) return;

    // If dropped onto a patient row header, keep the same time slot but change the patient
    if (target.isPatientDrop) {
      target = { patientId: target.patient.id, slotIndex: session.slotIndex };
    }

    if (target.patientId === undefined || target.slotIndex === undefined) return;
    if (session.patientId === target.patientId && session.slotIndex === target.slotIndex) return;

    const newStart = slotIndexToDate(day, target.slotIndex);
    const newEnd = new Date(newStart.getTime() + session.durationMinutes * 60000);

    const slotsNeeded = session.durationMinutes / 30;
    if (target.slotIndex + slotsNeeded > TIME_SLOTS.length) {
      toast.error("Session exceeds clinical hours (6 PM limit)");
      return;
    }

    const doMove = () => {
      updateSession.mutate({
        id: session.id,
        patientId: target.patientId,
        startTime: newStart,
        endTime: newEnd,
        ignoreConflicts: true,
      });
    };

    const warnings = [checkLunchOverlap(newStart, newEnd), checkTherapistAvailability(session.therapistId, newStart, newEnd), checkDoubleBooking(session.therapistId, session.deliveryMode, newStart, newEnd, session.id)];
    processWarnings(warnings, doMove);
  }

  function handleDragCancel() {
    setActiveDrag(null);
    setActiveDragPatient(null);
  }

  return {
    customCollisionDetection,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
}
