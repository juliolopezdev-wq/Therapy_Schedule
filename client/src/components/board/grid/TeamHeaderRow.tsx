import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TIME_SLOTS } from "@/lib/board";
import type { Patient } from "../../../../../drizzle/schema";
import { usePermissions } from "@/_core/hooks/usePermissions";

const SLOT_WIDTH = 72;

export interface TeamHeaderRowProps {
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

export function TeamHeaderRow({
  section,
  isCollapsed,
  sectionSessionCount,
  onToggle,
  onAddPatient,
}: TeamHeaderRowProps) {
  const { isAdmin } = usePermissions();
  return (
    <div 
      className="sticky top-0 z-20 flex h-10 items-stretch border-b border-slate-200 bg-slate-100/95 text-slate-800 shadow-sm backdrop-blur-sm"
      style={{ 
        borderTop: `3px solid ${section.color}`,
      }}
    >
      {/* 1. Primary Sticky Team Label */}
      <div
        className="sticky left-0 z-30 flex h-full w-52 shrink-0 items-center justify-between gap-2 border-r border-slate-200 bg-slate-100 px-2.5 shadow-[2px_0_10px_-3px_rgba(0,0,0,0.04)] sm:w-72 sm:px-3.5"
      >
        <button
          onClick={() => onToggle(section.id)}
          className="flex h-full w-full items-center gap-2 text-left min-w-0 focus:outline-none"
        >
          <span
            className="h-3.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: section.color }}
          />
          <span className="min-w-0 text-xs font-extrabold text-slate-900 tracking-tight truncate">{section.name}</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white shadow-xs shrink-0"
            style={{ backgroundColor: section.color }}>
            {section.patients.filter((patient) => !patient.isRoomPlaceholder).length}
          </span>
          {sectionSessionCount > 0 && (
            <span className="text-[10px] text-slate-500 font-semibold truncate">{sectionSessionCount} session{sectionSessionCount !== 1 ? "s" : ""} today</span>
          )}
          <ChevronRight
            className={cn("ml-auto h-4 w-4 text-slate-400 shrink-0 transition-transform", !isCollapsed && "rotate-90")}
          />
        </button>
      </div>

      {/* 2. Secondary Sticky EOW Button Cell */}
      <div
        className="sticky left-52 z-30 flex h-full w-9 shrink-0 items-center justify-center border-r border-slate-200 bg-slate-100 shadow-[2px_0_10px_-3px_rgba(0,0,0,0.04)] sm:left-72 sm:w-11"
      >
        {isAdmin && (
          <button
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-slate-200 transition-colors text-slate-500 hover:text-slate-700"
            title={`Add patient to ${section.name}`}
            onClick={() => onAddPatient(section.id)}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* 3. Scrollable Time Slots Track */}
      <div className="flex-1 h-full bg-slate-100/50" style={{ minWidth: TIME_SLOTS.length * SLOT_WIDTH }} />
    </div>
  );
}
