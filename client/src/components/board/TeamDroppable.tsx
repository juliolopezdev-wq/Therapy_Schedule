import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

export function TeamDroppable({ section, children, className }: { section: any, children: React.ReactNode, className?: string }) {
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
