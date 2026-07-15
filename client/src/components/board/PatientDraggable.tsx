import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

export function PatientDraggable({ patient, children, className }: { patient: any, children: React.ReactNode, className?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `patient-${patient.id}`,
    data: { patient, isPatientDrop: true, teamId: patient.teamId, teamName: patient.teamName },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        className,
        isDragging && "opacity-50 ring-2 ring-primary relative z-50",
      )}
    >
      {children}
    </div>
  );
}
