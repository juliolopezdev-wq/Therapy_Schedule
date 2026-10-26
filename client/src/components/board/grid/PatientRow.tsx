import { memo, useCallback, useMemo } from "react";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { AlertTriangle, Copy, GripVertical } from "lucide-react";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
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
import { GridCell } from "@/components/board/GridCell";
import { SessionTile, type SessionTileData } from "@/components/board/SessionTile";

import { TIME_SLOTS, type FlagType, isMissedStatus, DEFAULT_WEEKLY_MINUTE_TARGET, formatDateKey, dateToSlotIndex } from "@/lib/board";
import { getPatientWeekBounds } from "../../../../../shared/weekUtils";
import type { Patient, Therapist } from "../../../../../drizzle/schema";

const SLOT_WIDTH = 72;
const EOW_DAY_LETTERS = ["S", "M", "T", "W", "TH", "F", "S"];
const EOW_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface PatientRowProps {
  patient: Patient & { accessLevel?: "full" | "schedule" };
  rowIdx: number;
  day: Date;
  tiles: SessionTileData[];
  therapists: Therapist[];
  pFlags: { id: number; flagType: FlagType; date: Date | string }[];
  weekMinsByPatient: Map<number, number>;
  projectedWeekMinsByPatient: Map<number, number>;
  tilesByPatientSlot: Map<string, SessionTileData>;
  occupiedCells: Set<string>;
  dailyMinutesByPatient: Map<number, number>;
  missedTherapyAlert: boolean;
  missingExitEvalAlert: boolean;
  isDC: boolean;
  isMedicalHold: boolean;
  setPatientDraft: (draft: any) => void;
  setPatientDialogOpen: (open: boolean) => void;
  toggleFlag: (patientId: number, flagType: FlagType, active: boolean) => Promise<void> | void;
  copyPatientSessions: (patientId: number) => void;
  isCopying: boolean;
  openNewSession: (patientId: number, slotIndex: number) => void;
  openEditSession: (tile: SessionTileData) => void;
  handleResizeSession: (sessionId: number, newDurationMinutes: number) => void;
  therapistName: (id: number | null) => string | undefined;
  therapistColor: (id: number | null) => string | undefined;
}

function PatientRowImpl({
  patient,
  rowIdx,
  day,
  tiles,
  therapists,
  pFlags,
  weekMinsByPatient,
  projectedWeekMinsByPatient,
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
  const { canEdit, isAdmin, therapistId } = usePermissions();
  const canManagePatient = isAdmin || (canEdit && patient.accessLevel === "full");
  const isPlaceholder = patient.isRoomPlaceholder;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `patient-${patient.id}`,
    data: { patient, isPatientDrop: true, teamId: patient.teamId },
    disabled: !canManagePatient,
  });
  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 180ms cubic-bezier(0.2, 0, 0, 1)",
  };
  // Stable across re-renders unless pFlags itself changes -- otherwise FlagToggle would see a
  // "new" array/callback (and thus re-render) on every PatientRow render regardless of its own
  // memoization.
  const activeFlags = useMemo(() => pFlags.map((f) => f.flagType), [pFlags]);
  const displayFlags = useMemo(
    () => [...pFlags].sort((a, b) => Number(b.flagType === "DC") - Number(a.flagType === "DC")),
    [pFlags],
  );
  const dischargeFlag = pFlags.find(
    (flag) => flag.flagType === "DC" && formatDateKey(new Date(flag.date)) === formatDateKey(day),
  );
  const dischargeAt = dischargeFlag ? new Date(dischargeFlag.date) : null;
  const dischargeSlotIndex = dischargeAt ? dateToSlotIndex(dischargeAt) : null;
  const isDischargeToday = dischargeSlotIndex != null;
  const dischargeTimeLabel = dischargeAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const handleFlagToggle = useCallback(
    (flag: FlagType, active: boolean) => toggleFlag(patient.id, flag, active),
    [toggleFlag, patient.id],
  );

  return (
    <div
      ref={setNodeRef}
      id={`patient-row-${patient.id}`}
      style={sortableStyle}
      className={cn(
        "group/row relative flex h-[72px] border-b border-slate-100 transition-[transform,background-color,box-shadow,opacity] last:border-b-0 hover:bg-slate-50/80 will-change-transform",
        isDC && "bg-slate-200 opacity-60 grayscale",
        isDischargeToday && !isDC && "bg-rose-50/50",
        isDragging && "z-40 opacity-25 shadow-lg",
      )}
    >
      {/* Patient label */}
      <div
        className={cn(
          "sticky left-0 z-20 flex h-full w-52 shrink-0 items-center border-r border-slate-200 px-1 py-2 transition-all duration-300 shadow-[2px_0_10px_-3px_rgba(0,0,0,0.02)] sm:w-72 sm:px-2",
          isDC ? "bg-slate-200" : isDischargeToday ? "bg-rose-50" : (rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50/50"),
          "group-hover/row:bg-white group-hover/row:shadow-md",
        )}
      >
        {canManagePatient && (
          <button
            type="button"
            className="mr-0.5 flex h-10 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-slate-400 outline-none transition-colors hover:bg-slate-100 hover:text-sky-700 focus-visible:ring-2 focus-visible:ring-sky-500 active:cursor-grabbing sm:mr-1 sm:w-7"
            aria-label={`Move ${patient.name}`}
            title="Drag to reorder or move to another team"
            onClick={(event) => event.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <div className="flex h-full min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex w-full min-w-0 items-center gap-1">
            <button
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left"
              onClick={() => {
                if (!canManagePatient) return;
                setPatientDraft({
                  id: patient.id,
                  mrn: patient.mrn ?? "",
                  previousAdmissionId: patient.previousAdmissionId,
                  roomNumber: patient.roomNumber,
                  name: patient.name,
                  notes: patient.notes ?? "",
                  isDischarged: patient.isDischarged,
                  admissionDate: patient.admissionDate ?? "",
                  estimatedDischargeDate: patient.estimatedDischargeDate ?? "",
                  weeklyMinuteTarget: patient.weeklyMinuteTarget ?? DEFAULT_WEEKLY_MINUTE_TARGET,
                  teamId: patient.teamId ?? null,
                  isRoomPlaceholder: patient.isRoomPlaceholder,
                });
                setPatientDialogOpen(true);
              }}
            >
              <span
                className="inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 border-l-[3px] border-l-sky-500 bg-white px-1.5 text-[11px] font-black tabular-nums tracking-tight text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                title={`Room ${patient.roomNumber}`}
              >
                {patient.roomNumber}
              </span>
              <span className={cn("min-w-0 flex-1 truncate text-[13px] font-bold text-slate-900 drop-shadow-sm", isDC && "text-slate-400 line-through drop-shadow-none")}>
                {patient.name}
              </span>
              {isDischargeToday && !isDC && (
                <span className="hidden shrink-0 rounded-full border border-rose-200 bg-rose-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-rose-800 sm:inline-flex">
                  D/C {dischargeTimeLabel}
                </span>
              )}
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
            </button>
            {!isPlaceholder && <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              <FlagToggle
                activeFlags={activeFlags}
                onToggle={handleFlagToggle}
                disabled={!canManagePatient}
              />
              {canManagePatient && (
                <div className="hidden sm:block">
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
                        <AlertDialogAction onClick={() => copyPatientSessions(patient.id)}>
                          Copy
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
              <PatientDayQuickView
                patient={patient}
                day={day}
                sessions={tiles}
                therapists={therapists}
              />
            </div>}
          </div>
          {!isPlaceholder && (displayFlags.length > 0 || patient.notes) && (
            <div className="flex h-[18px] w-full min-w-0 items-center gap-1.5 overflow-hidden">
              {displayFlags.length > 0 && (
                <div className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200/80 bg-slate-50 px-1.5 py-0.5">
                  {displayFlags.slice(0, 5).map((f) => (
                    <FlagBadge
                      key={f.id}
                      flag={f.flagType}
                      iconOnly
                      effectiveDate={f.date}
                    />
                  ))}
                  {displayFlags.length > 5 && (
                    <span
                      className="pl-0.5 text-[9px] font-bold text-slate-500"
                      title={`${displayFlags.length - 5} more active flags`}
                    >
                      +{displayFlags.length - 5}
                    </span>
                  )}
                </div>
              )}
              {patient.notes && (
                <span className="min-w-0 flex-1 truncate text-[10px] italic text-slate-500" title={patient.notes}>
                  {patient.notes}
                </span>
              )}
            </div>
          )}
          {/* Apply the standard target before deciding whether to render so legacy records
              without a persisted value still receive the same progress display. */}
          {!isDC && !isPlaceholder && (patient.weeklyMinuteTarget ?? DEFAULT_WEEKLY_MINUTE_TARGET) > 0 && (() => {
            const weekMins = weekMinsByPatient.get(patient.id) ?? 0;
            const projectedMins = projectedWeekMinsByPatient.get(patient.id) ?? weekMins;
            const target = patient.weeklyMinuteTarget ?? DEFAULT_WEEKLY_MINUTE_TARGET;
            const safeTarget = Math.max(1, target);
            const completedPct = Math.min(100, (weekMins / safeTarget) * 100);
            const projectedPct = Math.min(100 - completedPct, ((projectedMins - weekMins) / safeTarget) * 100);
            const isCompleted = weekMins >= target;
            const isProjectedOnTrack = projectedMins >= target;
            return (
              <div className="flex items-center gap-1.5 w-full mt-0.5">
                <div className={cn(
                  "flex h-1.5 flex-1 overflow-hidden rounded-full border border-slate-200/50",
                  isProjectedOnTrack ? "bg-slate-100" : "bg-rose-100",
                )} title={`${weekMins} completed · ${projectedMins} projected · ${Math.max(0, target - projectedMins)} still needed`}>
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${completedPct}%` }}
                  />
                  <div
                    className="h-full bg-amber-400 transition-all duration-500"
                    style={{ width: `${projectedPct}%` }}
                  />
                </div>
                <span className={cn("shrink-0 text-[10px] font-bold tabular-nums", isCompleted ? "text-emerald-600" : isProjectedOnTrack ? "text-amber-600" : "text-rose-600")} title={`${projectedMins} projected by week end`}>
                  {weekMins}<span className="font-medium text-slate-400">/{target}</span>
                </span>
              </div>
            );
          })()}
        </div>
      </div>

      {/* EOW (End Of Week) column */}
      {(() => {
        const eowDayIndex = getPatientWeekBounds(patient.admissionDate, day).end.getDay();
        return (
          <div
            className={cn(
              "sticky left-52 z-20 flex h-full w-9 shrink-0 items-center justify-center border-r border-slate-200 transition-colors shadow-[6px_0_15px_-4px_rgba(0,0,0,0.08)] sm:left-72 sm:w-11",
              isDC ? "bg-slate-200" : (rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50"),
              "group-hover/row:bg-slate-100",
            )}
          >
            {!isPlaceholder && <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-[10px] border border-white bg-gradient-to-br from-blue-100 via-sky-50 to-blue-200/80 px-1 text-[11px] font-black tracking-tight text-blue-800 shadow-[0_2px_8px_-2px_rgba(2,132,199,0.3),inset_0_1px_1px_rgba(255,255,255,1)] transition-all hover:scale-105 hover:shadow-sky-500/20">
                  {EOW_DAY_LETTERS[eowDayIndex]}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Week ends {EOW_DAY_NAMES[eowDayIndex]}
              </TooltipContent>
            </Tooltip>}
          </div>
        );
      })()}

      {/* Time cells */}
      {TIME_SLOTS.map((slot) => {
        const isLunchSlot = slot.hour === 12;
        const tile = tilesByPatientSlot.get(`${patient.id}-${slot.index}`);
        const isOccupied = occupiedCells.has(`${patient.id}-${slot.index}`);

        const isHourEnd = slot.index % 2 === 1;
        const isAfterDischarge = dischargeSlotIndex != null && slot.index >= dischargeSlotIndex;
        const isDischargeBoundary = dischargeSlotIndex != null && slot.index === dischargeSlotIndex;
        const borderClass = isHourEnd ? "border-r border-slate-200" : "border-r border-slate-100";

        if (isOccupied) {
          return <div key={slot.index} style={{ flex: `0 0 ${SLOT_WIDTH}px`, width: SLOT_WIDTH, minWidth: SLOT_WIDTH }} className={cn("shrink-0", borderClass, isDischargeBoundary && "border-l-2 border-l-rose-500", isAfterDischarge && "bg-slate-200/60 bg-[repeating-linear-gradient(135deg,rgba(100,116,139,0.10),rgba(100,116,139,0.10)_5px,transparent_5px,transparent_10px)]", isMedicalHold && "bg-slate-200/50 bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.03),rgba(0,0,0,0.03)_4px,transparent_4px,transparent_8px)] grayscale pointer-events-none opacity-80")} />;
        }
        return (
          <div key={slot.index} style={{ flex: `0 0 ${SLOT_WIDTH}px`, width: SLOT_WIDTH, minWidth: SLOT_WIDTH }} className={cn("shrink-0 transition-colors duration-300", borderClass, isDischargeBoundary && "border-l-2 border-l-rose-500", isAfterDischarge && "bg-slate-200/60 bg-[repeating-linear-gradient(135deg,rgba(100,116,139,0.10),rgba(100,116,139,0.10)_5px,transparent_5px,transparent_10px)]", isMedicalHold && "bg-slate-200/50 bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.03),rgba(0,0,0,0.03)_4px,transparent_4px,transparent_8px)] grayscale opacity-80")}>
            <GridCell patientId={patient.id} slotIndex={slot.index} onAdd={canManagePatient && !isPlaceholder ? openNewSession : undefined} isAlternate={rowIdx % 2 !== 0} isLunch={isLunchSlot}>
              {tile ? (
                <div
                  className="absolute inset-y-1 left-1 z-10"
                  style={{ width: tile.slotSpan * SLOT_WIDTH - 6 }}
                >
                  <SessionTile
                    session={tile}
                    therapistName={therapistName(tile.therapistId)}
                    therapistColor={therapistColor(tile.therapistId)}
                    onClick={openEditSession}
                    slotWidth={SLOT_WIDTH}
                    draggable={canEdit}
                    onResize={canEdit ? handleResizeSession : undefined}
                    isAfterPlannedDischarge={dischargeSlotIndex != null && tile.slotIndex >= dischargeSlotIndex}
                    crossesPlannedDischarge={dischargeSlotIndex != null && tile.slotIndex < dischargeSlotIndex && tile.slotIndex + tile.slotSpan > dischargeSlotIndex}
                  />
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
          !isPlaceholder && dailyMinutesByPatient.get(patient.id)
            ? "border-emerald-200 bg-emerald-50 text-emerald-700" 
            : "border-slate-200 bg-slate-50 text-slate-400"
        )}>
          {isPlaceholder ? "—" : dailyMinutesByPatient.get(patient.id) || 0}
        </span>
      </div>
    </div>
  );
}

// This row renders once per patient per day (up to ~22 grid cells each) and the board re-renders
// on nearly every query refetch/drag interaction -- memoize so a patient's row only re-renders
// when its own props actually changed, not whenever any other patient's session/flag/drag state
// changes. Depends on the parent (TherapyBoard.tsx) passing stable references for tiles/handlers.
export const PatientRow = memo(PatientRowImpl);
