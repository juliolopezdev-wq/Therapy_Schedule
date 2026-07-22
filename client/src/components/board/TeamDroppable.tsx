import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { Team, Patient } from "../../../../drizzle/schema";

interface TeamDroppableProps {
  section: Team & { patients: Patient[] };
  children: React.ReactNode;
  className?: string;
}

function TeamDroppableImpl({ section, children, className }: TeamDroppableProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `team-${section.id}`,
    data: { teamId: section.id, teamName: section.name },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && "bg-slate-100/50 outline-2 outline-dashed outline-slate-400 outline-offset-[-2px]")}
    >
      {children}
    </div>
  );
}

export const TeamDroppable = memo(TeamDroppableImpl);
