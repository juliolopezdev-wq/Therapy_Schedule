import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface GridCellProps {
  patientId: number;
  slotIndex: number;
  onAdd?: (patientId: number, slotIndex: number) => void;
  children?: React.ReactNode;
  isAlternate?: boolean;
  isLunch?: boolean;
}

export function GridCell({ patientId, slotIndex, onAdd, children, isAlternate, isLunch }: GridCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${patientId}-${slotIndex}`,
    data: { patientId, slotIndex },
    disabled: isLunch,
  });

  // The slot to the LEFT of an hour mark gets a stronger right border (closes the hour block)
  const isHourEnd = slotIndex % 2 === 1;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group relative h-full border-b border-slate-100 transition-colors duration-150",
        isLunch ? "bg-slate-200/50 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,0.02)_4px,rgba(0,0,0,0.02)_8px)]" : isAlternate ? "bg-slate-50/40" : "bg-transparent",
        isOver && !isLunch && "bg-primary/10 ring-2 ring-inset ring-primary/70 z-20",
        isLunch && "cursor-not-allowed",
      )}
      onClick={() => {
        if (!children && !isLunch) onAdd?.(patientId, slotIndex);
      }}
    >
      {children}
      {!children && !isLunch ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAdd?.(patientId, slotIndex);
          }}
          className="absolute inset-1 flex items-center justify-center rounded opacity-0 transition-all duration-150 hover:bg-slate-100/60 group-hover:opacity-100"
          aria-label="Add session"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
            <Plus className="h-2.5 w-2.5 text-primary" strokeWidth={2.5} />
          </span>
        </button>
      ) : null}
    </div>
  );
}
