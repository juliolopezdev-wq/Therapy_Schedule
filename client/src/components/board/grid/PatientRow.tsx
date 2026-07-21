import { AlertTriangle, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { FlagBadge, FlagToggle } from "@/components/board/StatusFlags";
import { PatientDayQuickView } from "@/components/board/PatientDayQuickView";
import { PatientDraggable } from "@/components/board/PatientDraggable";
import { GridCell } from "@/components/board/GridCell";
import { SessionTile, type SessionTileData } from "@/components/board/SessionTile";

import { TIME_SLOTS, type FlagType, isMissedStatus } from "@/lib/board";
import { getPatientWeekBounds } from "../../../../../shared/weekUtils";
import type { Patient, Therapist } from "../../../../../drizzle/schema";

const SLOT_WIDTH = 72;
const EOW_DAY_LETTERS = ["S", "M", "T", "W", "TH", "F", "S"];
const EOW_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface PatientRowProps {
  patient: any;
  rowIdx: number;
  day: Date;
  tiles: SessionTileData[];
  therapists: Therapist[];
  pFlags: any[];
  weekMinsByPatient: Map<number, number>;
  tilesByPatientSlot: Map<string, SessionTileData>;
  occupiedCells: Set<string>;
  dailyMinutesByPatient: Map<number, number>;
  missedTherapyAlert: boolean;
  missingExitEvalAlert: boolean;
  isDC: boolean;
  isMedicalHold: boolean;
  setPatientDraft: (draft: any) => void;
  setPatientDialogOpen: (open: boolean) => void;
  toggleFlag: (patientId: number, flagType: FlagType, active: boolean) => void;
  copyPatientSessions: (patientId: number) => void;
  isCopying: boolean;
  openNewSession: (patientId: number, slotIndex: number) => void;
  openEditSession: (tile: SessionTileData) => void;
  handleResizeSession: (sessionId: number, newDurationMinutes: number) => void;
  therapistName: (id: number | null) => string | undefined;
  therapistColor: (id: number | null) => string | undefined;
}

export function PatientRow({
  patient,
  rowIdx,
  day,
  tiles,
  therapists,
  pFlags,
  weekMinsByPatient,
  tilesByPatientSlot,
  occupiedCells,
  dailyMinutesByPatient,
  missedTherapyAlert,
  missingExitEvalAlert,
  isDC,
  isMedicalHold,
  setPatientDraft,
  setPatientDialogOpen,
  toggleFlag,
  copyPatientSessions,
  isCopying,
  openNewSession,
  openEditSession,
  handleResizeSession,
  therapistName,
  therapistColor,
}: PatientRowProps) {
  return (
    <div id={`patient-row-${patient.id}`} className={cn("group/row flex h-16 border-b border-slate-100 transition-colors last:border-b-0 hover:bg-slate-50/80", isDC && "bg-slate-200 opacity-60 grayscale")}>
      {/* Patient label */}
      <PatientDraggable patient={patient}
        className={cn(
          "sticky left-0 z-30 flex h-full w-72 shrink-0 items-center justify-between gap-1.5 border-r border-slate-200 px-3 py-1.5 transition-all duration-300 cursor-grab active:cursor-grabbing shadow-[2px_0_10px_-3px_rgba(0,0,0,0.02)]",
          isDC ? "bg-slate-200" : (rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50/50"),
          "group-hover/row:bg-white group-hover/row:shadow-md",
        )}
      >
        <button
          className="flex min-w-0 flex-col gap-1 text-left w-full justify-center group-hover/row:scale-[1.01] transition-transform"
          onClick={() => {
            setPatientDraft({
              id: patient.id,
              roomNumber: patient.roomNumber,
              name: patient.name,
              notes: patient.notes ?? "",
              isDischarged: patient.isDischarged,
              admissionDate: patient.admissionDate ?? "",
              estimatedDischargeDate: patient.estimatedDischargeDate ?? "",
              weeklyMinuteTarget: patient.weeklyMinuteTarget ?? 900,
              teamId: patient.teamId ?? null,
            });
            setPatientDialogOpen(true);
          }}
        >
          <div className="flex items-center gap-2 w-full overflow-hidden">
            <span className={cn("truncate text-[13px] font-bold text-slate-900 drop-shadow-sm", isDC && "text-slate-400 line-through drop-shadow-none")}>
              {patient.name}
            </span>
            {missedTherapyAlert && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500 animate-pulse" strokeWidth={2.5} />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs font-semibold text-amber-700 bg-amber-50 border-amber-200">
                  No therapy in 2+ days
                </TooltipContent>
              </Tooltip>
            )}
            {missingExitEvalAlert && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 animate-pulse" strokeWidth={3} />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs font-semibold text-red-700 bg-red-50 border-red-200">
                  Missing Exit Eval (DC approaching)
                </TooltipContent>
              </Tooltip>
            )}
            <span className="shrink-0 inline-flex min-w-[2.25rem] justify-center rounded-md border border-slate-200/80 bg-slate-100/80 px-1 text-[10px] font-bold tabular-nums text-slate-600 shadow-sm">
              {patient.roomNumber}
            </span>
            {pFlags.length > 0 && (
              <div className="flex items-center gap-0.5 ml-auto shrink-0">
                {pFlags.map((f) => <FlagBadge key={f.id} flag={f.flagType} iconOnly />)}
              </div>
            )}
          </div>
          {patient.notes && (
            <div className="flex items-center w-full">
              <span className="truncate text-[10px] italic text-slate-500 w-full">{patient.notes}</span>
            </div>
          )}
          {!isDC && (() => {
            const weekMins = weekMinsByPatient.get(patient.id) ?? 0;
            const target = patient.weeklyMinuteTarget ?? 900;
            const pct = Math.min(100, Math.round((weekMins / target) * 100));
            const isOnTrack = weekMins >= target;
            const isClose = !isOnTrack && pct >= 67;
            return (
              <div className="flex items-center gap-1.5 w-full mt-0.5">
                <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden shadow-inner border border-slate-200/50">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", isOnTrack ? "bg-emerald-500" : isClose ? "bg-amber-400" : "bg-red-400")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={cn("shrink-0 text-[10px] font-bold tabular-nums", isOnTrack ? "text-emerald-600" : isClose ? "text-amber-600" : "text-red-600")}>
                  {weekMins}<span className="font-medium text-slate-400">/{target}</span>
                </span>
              </div>
            );
          })()}
        </button>
        <div className="flex items-center shrink-0 ml-0.5 gap-0.5">
          <FlagToggle
            activeFlags={pFlags.map((f) => f.flagType)}
            onToggle={(flag, active) =>
              toggleFlag(patient.id, flag, active)
            }
          />
          <AlertDialog>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50"
                    disabled={isCopying}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent>Copy to Tomorrow</TooltipContent>
            </Tooltip>
            <AlertDialogContent className="glass-panel">
              <AlertDialogHeader>
                <AlertDialogTitle>Copy Sessions</AlertDialogTitle>
                <AlertDialogDescription>
                  Copy all of {patient.name}&apos;s sessions from today to tomorrow?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                  copyPatientSessions(patient.id);
                }}>Copy</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <PatientDayQuickView
            patient={patient}
            day={day}
            sessions={tiles}
            therapists={therapists}
          />
        </div>
      </PatientDraggable>

      {/* EOW (End Of Week) column */}
      {(() => {
        const eowDayIndex = getPatientWeekBounds(patient.admissionDate, day).end.getDay();
        return (
          <div
            className={cn(
              "sticky z-30 flex h-full w-11 shrink-0 items-center justify-center border-r border-slate-200 transition-colors shadow-[6px_0_15px_-4px_rgba(0,0,0,0.08)]",
              isDC ? "bg-slate-200" : (rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50"),
              "group-hover/row:bg-slate-100",
            )}
            style={{ left: 288 }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-[10px] border border-white bg-gradient-to-br from-indigo-100 via-blue-50 to-indigo-200/80 px-1 text-[11px] font-black tracking-tight text-indigo-800 shadow-[0_2px_8px_-2px_rgba(79,70,229,0.3),inset_0_1px_1px_rgba(255,255,255,1)] transition-all hover:scale-105 hover:shadow-indigo-500/20">
                  {EOW_DAY_LETTERS[eowDayIndex]}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Week ends {EOW_DAY_NAMES[eowDayIndex]}
              </TooltipContent>
            </Tooltip>
          </div>
        );
      })()}

      {/* Time cells */}
      {TIME_SLOTS.map((slot) => {
        const isLunchSlot = slot.hour === 12;
        const tile = tilesByPatientSlot.get(`${patient.id}-${slot.index}`);
        const isOccupied = occupiedCells.has(`${patient.id}-${slot.index}`);

        const isHourEnd = slot.index % 2 === 1;
        const borderClass = isHourEnd ? "border-r border-slate-200" : "border-r border-slate-100";

        if (isOccupied) {
          return <div key={slot.index} style={{ flex: `0 0 ${SLOT_WIDTH}px`, width: SLOT_WIDTH, minWidth: SLOT_WIDTH }} className={cn("shrink-0", borderClass, isMedicalHold && "bg-slate-200/50 bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.03),rgba(0,0,0,0.03)_4px,transparent_4px,transparent_8px)] grayscale pointer-events-none opacity-80")} />;
        }
        return (
          <div key={slot.index} style={{ flex: `0 0 ${SLOT_WIDTH}px`, width: SLOT_WIDTH, minWidth: SLOT_WIDTH }} className={cn("shrink-0 transition-colors duration-300", borderClass, isMedicalHold && "bg-slate-200/50 bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.03),rgba(0,0,0,0.03)_4px,transparent_4px,transparent_8px)] grayscale opacity-80")}>
            <GridCell patientId={patient.id} slotIndex={slot.index} onAdd={openNewSession} isAlternate={rowIdx % 2 !== 0} isLunch={isLunchSlot}>
              {tile ? (
                <div
                  className="absolute inset-y-1 left-1 z-10"
                  style={{ width: tile.slotSpan * SLOT_WIDTH - 6 }}
                >
                  <SessionTile session={tile} therapistName={therapistName(tile.therapistId)} therapistColor={therapistColor(tile.therapistId)} onClick={openEditSession} slotWidth={SLOT_WIDTH} onResize={handleResizeSession} />
                </div>
              ) : null}
            </GridCell>
          </div>
        );
      })}

      {/* Daily Total Cell */}
      <div
        className={cn(
          "sticky right-0 z-20 flex w-14 shrink-0 items-center justify-center border-l border-slate-200/80 transition-colors shadow-[-6px_0_15px_-4px_rgba(0,0,0,0.08)]",
          isDC ? "bg-slate-200" : (rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50"),
          "group-hover/row:bg-slate-100"
        )}
      >
        <span className={cn(
          "flex min-w-[2rem] items-center justify-center rounded border px-1 py-0.5 text-[11px] font-black tabular-nums tracking-tight shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
          dailyMinutesByPatient.get(patient.id) 
            ? "border-emerald-200 bg-emerald-50 text-emerald-700" 
            : "border-slate-200 bg-slate-50 text-slate-400"
        )}>
          {dailyMinutesByPatient.get(patient.id) || 0}
        </span>
      </div>
    </div>
  );
}
