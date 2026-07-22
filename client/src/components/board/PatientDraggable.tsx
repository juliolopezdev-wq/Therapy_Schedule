import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import type { Patient } from "../../../../drizzle/schema";

interface PatientDraggableProps {
  patient: Patient;
  children: React.ReactNode;
  className?: string;
}

function PatientDraggableImpl({ patient, children, className }: PatientDraggableProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `patient-${patient.id}`,
    data: { patient, isPatientDrop: true, teamId: patient.teamId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "cursor-grab touch-none select-none active:cursor-grabbing",
        className,
        isDragging && "opacity-50 ring-2 ring-primary relative z-50",
      )}
    >
      {children}
    </div>
  );
}

export const PatientDraggable = memo(PatientDraggableImpl);
export default PatientDraggable;
