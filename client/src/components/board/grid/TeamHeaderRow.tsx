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
      className="sticky top-[36px] z-20 flex items-center border-b border-slate-200 bg-slate-50/95 backdrop-blur-xs shadow-2xs"
      style={{ 
        borderTop: `2px solid ${section.color}aa`,
      }}
    >
      {/* 1. Primary Sticky Team Label (matching PATIENT / ROOM column, width 288px = w-72) */}
      <div
        className="sticky left-0 z-30 flex h-9 w-72 shrink-0 items-center justify-between gap-2 border-r border-slate-200 px-3 bg-white shadow-[2px_0_10px_-3px_rgba(0,0,0,0.02)]"
      >
        <button
          onClick={() => onToggle(section.id)}
          className="flex flex-1 items-center gap-2 text-left min-w-0"
        >
          <span
            className="h-3.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: section.color }}
          />
          <span className="text-xs font-extrabold text-slate-800 tracking-tight truncate">{section.name}</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white shadow-xs shrink-0"
            style={{ backgroundColor: section.color }}>
            {section.patients.length}
          </span>
          {sectionSessionCount > 0 && (
            <span className="text-[10px] text-slate-500 font-semibold truncate">{sectionSessionCount} session{sectionSessionCount !== 1 ? "s" : ""} today</span>
          )}
          <ChevronRight
            className={cn("ml-auto h-4 w-4 text-slate-400 shrink-0 transition-transform", !isCollapsed && "rotate-90")}
          />
        </button>
      </div>

      {/* 2. Secondary Sticky EOW Button Cell (matching EOW column, width 44px = w-11, left: 288px) */}
      <div
        className="sticky z-30 flex h-9 w-11 shrink-0 items-center justify-center border-r border-slate-200 bg-white shadow-[2px_0_10px_-3px_rgba(0,0,0,0.02)]"
        style={{ left: 288 }}
      >
        <button
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-slate-100 transition-colors text-slate-500 hover:text-slate-700"
          title={`Add patient to ${section.name}`}
          onClick={() => onAddPatient(section.id)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 3. Scrollable Time Slots Track */}
      <div className="flex-1 h-9" style={{ minWidth: TIME_SLOTS.length * SLOT_WIDTH }} />
    </div>
  );
}

export const TeamHeaderRow = memo(TeamHeaderRowImpl);
