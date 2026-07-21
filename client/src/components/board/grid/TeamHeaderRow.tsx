import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TIME_SLOTS } from "@/lib/board";

const SLOT_WIDTH = 72;

interface TeamHeaderRowProps {
  section: {
    id: number;
    name: string;
    color: string;
    patients: any[];
  };
  isCollapsed: boolean;
  sectionSessionCount: number;
  onToggle: (id: number) => void;
  onAddPatient: (teamId: number) => void;
}

export function TeamHeaderRow({
  section,
  isCollapsed,
  sectionSessionCount,
  onToggle,
  onAddPatient,
}: TeamHeaderRowProps) {
  return (
    <div 
      className="flex items-center border-b border-slate-200/50 relative overflow-hidden"
      style={{ 
        borderTop: `2px solid ${section.color}80`,
        background: `linear-gradient(to right, ${section.color}15, transparent 1000px)`
      }}
    >
      <div
        className="sticky left-0 z-30 flex w-72 shrink-0 items-center gap-2 border-r border-slate-200/60 px-3 py-2 shadow-[6px_0_15px_-4px_rgba(0,0,0,0.08)] backdrop-blur-md"
        style={{ backgroundColor: `${section.color}05` }}
      >
        <button
          onClick={() => onToggle(section.id)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span
            className="h-3 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: section.color }}
          />
          <span className="text-xs font-bold text-slate-800">{section.name}</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
            style={{ backgroundColor: section.color }}>
            {section.patients.length}
          </span>
          {sectionSessionCount > 0 && (
            <span className="text-[10px] text-slate-500 font-medium">{sectionSessionCount} session{sectionSessionCount !== 1 ? "s" : ""} today</span>
          )}
          <ChevronRight
            className={cn("ml-auto h-4 w-4 text-slate-500 transition-transform", !isCollapsed && "rotate-90")}
          />
        </button>
        <button
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-white/60 transition-colors"
          title={`Add patient to ${section.name}`}
          onClick={() => onAddPatient(section.id)}
        >
          <Plus className="h-4 w-4 text-slate-600" />
        </button>
      </div>
      <div className="flex-1" style={{ minWidth: TIME_SLOTS.length * SLOT_WIDTH }} />
    </div>
  );
}
