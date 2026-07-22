import { memo } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TIME_SLOTS } from "@/lib/board";
import type { Patient } from "../../../../../drizzle/schema";

const SLOT_WIDTH = 72;

interface TeamHeaderRowProps {
  section: {
    id: number;
    name: string;
    color: string;
    patients: Patient[];
  };
  isCollapsed: boolean;
  sectionSessionCount: number;
  onToggle: (id: number) => void;
  onAddPatient: (teamId: number) => void;
}

function TeamHeaderRowImpl({
  section,
  isCollapsed,
  sectionSessionCount,
  onToggle,
  onAddPatient,
}: TeamHeaderRowProps) {
  return (
    <div 
      className="flex items-center border-b border-slate-200 bg-slate-50/60 relative overflow-hidden"
      style={{ 
        borderTop: `2px solid ${section.color}aa`,
      }}
    >
      <div
        className="sticky left-0 z-30 flex w-[332px] shrink-0 items-center gap-2 border-r border-slate-200 px-3.5 py-2 bg-white shadow-[2px_0_10px_-3px_rgba(0,0,0,0.04)]"
      >
        <button
          onClick={() => onToggle(section.id)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span
            className="h-3.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: section.color }}
          />
          <span className="text-xs font-extrabold text-slate-800 tracking-tight">{section.name}</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white shadow-xs"
            style={{ backgroundColor: section.color }}>
            {section.patients.length}
          </span>
          {sectionSessionCount > 0 && (
            <span className="text-[10px] text-slate-500 font-semibold">{sectionSessionCount} session{sectionSessionCount !== 1 ? "s" : ""} today</span>
          )}
          <ChevronRight
            className={cn("ml-auto h-4 w-4 text-slate-400 transition-transform", !isCollapsed && "rotate-90")}
          />
        </button>
        <button
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-slate-100 transition-colors text-slate-500 hover:text-slate-700"
          title={`Add patient to ${section.name}`}
          onClick={() => onAddPatient(section.id)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1" style={{ minWidth: TIME_SLOTS.length * SLOT_WIDTH }} />
    </div>
  );
}

export const TeamHeaderRow = memo(TeamHeaderRowImpl);
