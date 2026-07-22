import { type DragStartEvent, type DragEndEvent, type CollisionDetection, pointerWithin } from "@dnd-kit/core";
import { toast } from "sonner";
import { TIME_SLOTS, slotIndexToDate, DEFAULT_WEEKLY_MINUTE_TARGET } from "@/lib/board";
import { type SessionTileData } from "@/components/board/SessionTile";
import type { Patient, Team } from "../../../drizzle/schema";
import type { trpc } from "@/lib/trpc";

export type BoardSection = Team & { patients: Patient[] };

interface UseBoardDndProps {
  day: Date;
  patientsBySection: BoardSection[];
  setActiveDrag: (session: SessionTileData | null) => void;
  setActiveDragPatient: (patient: Patient | null) => void;
  updatePatient: ReturnType<typeof trpc.patients.update.useMutation>;
  updateSession: ReturnType<typeof trpc.sessions.update.useMutation>;
  checkLunchOverlap: (start: Date, end: Date) => string | null;
  checkTherapistAvailability: (therapistId: number | null, start: Date, end: Date) => string | null;
  checkDoubleBooking: (therapistId: number | null, deliveryMode: string, start: Date, end: Date, ignoreSessionId?: number) => string | null;
  processWarnings: (warnings: (string | null)[], onConfirm: () => void) => void;
}

export const customCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
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
  updatePatient,
  updateSession,
  checkLunchOverlap,
  checkTherapistAvailability,
  checkDoubleBooking,
  processWarnings
}: UseBoardDndProps) {
  
  function handleDragStart(event: DragStartEvent) {
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
    const { active, over } = event;
    if (!over) return;
    
    const data = active.data.current as any;
    
    // Handle patient drag
    if (data?.patient) {
      const targetData = over.data.current as any;
      if (targetData?.teamId !== undefined) {
        let newOrderIndex = data.patient.orderIndex ?? 0;

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

              const isMovingDown = activeIndex !== -1 && activeIndex < overIndex;
              const prevPatient = targetSection.patients[isMovingDown ? overIndex : overIndex - 1];
              const nextPatient = targetSection.patients[isMovingDown ? overIndex + 1 : overIndex];

              const prevOrder = prevPatient ? (prevPatient.orderIndex ?? 0) : (nextPatient ? (nextPatient.orderIndex ?? 0) - 100 : 0);
              const nextOrder = nextPatient ? (nextPatient.orderIndex ?? 0) : (prevPatient ? (prevPatient.orderIndex ?? 0) + 100 : 100);

              newOrderIndex = (prevOrder + nextOrder) / 2;
            }
          }
        } else if (data.patient.teamId === targetData.teamId) {
           // Dropped onto the same team header, don't move
           return;
        }
        
        updatePatient.mutate({
          id: data.patient.id,
          roomNumber: data.patient.roomNumber,
          name: data.patient.name,
          notes: data.patient.notes ?? "",
          isDischarged: data.patient.isDischarged,
          admissionDate: data.patient.admissionDate ?? undefined,
          weeklyMinuteTarget: data.patient.weeklyMinuteTarget ?? DEFAULT_WEEKLY_MINUTE_TARGET,
          teamId: targetData.teamId === 0 ? null : targetData.teamId,
          orderIndex: newOrderIndex,
        });
        toast.success(`Patient moved to ${targetData.teamName || (targetData.teamId ? "another team" : "Unassigned")}`);
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
      toast.error("Session exceeds clinical hours (5 PM limit)");
      return;
    }

    const doMove = () => {
      updateSession.mutate({
        id: session.id,
        patientId: target.patientId,
        startTime: newStart,
        endTime: newEnd,
        ignoreConflicts: true,
      }, {
        onSuccess: () => toast.success("Session moved")
      });
    };

    const warnings = [checkLunchOverlap(newStart, newEnd), checkTherapistAvailability(session.therapistId, newStart, newEnd), checkDoubleBooking(session.therapistId, session.deliveryMode, newStart, newEnd, session.id)];
    processWarnings(warnings, doMove);
  }

  return {
    customCollisionDetection,
    handleDragStart,
    handleDragEnd
  };
}
