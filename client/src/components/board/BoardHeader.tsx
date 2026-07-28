import { Dispatch, SetStateAction, useCallback, useMemo, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  History, Camera, Printer, Copy, MoreHorizontal, Sparkles, ChevronDown
} from "lucide-react";
import { DailyAttendance } from "./DailyAttendance";
import { THERAPY_TYPES, THERAPY_META, TIME_SLOTS, type TherapyType } from "@/lib/board";
import { getPatientWeekBounds } from "../../../../shared/weekUtils";
import type { Patient, Therapist, Team } from "../../../../drizzle/schema";
import { ConflictPair } from "@/pages/TherapyBoard";
import { MySchedule } from "@/components/board/MySchedule";
import { SessionTileData } from "@/components/board/SessionTile";
import { FilterGroup, type FilterOption } from "@/components/board/header/FilterGroup";
import { StatusBadge } from "@/components/board/header/StatusBadge";
import { DateChooser } from "@/components/board/header/DateChooser";
import { CommandBar, COMMAND_BAR_ICONS } from "@/components/board/header/CommandBar";
import { cn } from "@/lib/utils";

export interface BoardHeaderProps {
  day: Date;
  setDay: Dispatch<SetStateAction<Date>>;
  filter: "all" | TherapyType;
  setFilter: Dispatch<SetStateAction<"all" | TherapyType>>;
  teamFilter: number | "all";
  setTeamFilter: Dispatch<SetStateAction<number | "all">>;
  teams: Team[];
  patientsUnderTarget: Patient[];
  weekMinsByPatient: Map<number, number>;
  conflictCount: number;
  conflictPairs: ConflictPair[];
  therapists: Therapist[];
  patients: Patient[];
  jumpToPatient: (id: number) => void;
  setPanelOpen: (v: boolean) => void;
  setStaffPanelOpen: (v: boolean) => void;
  setWeeklyMinutesPanelOpen: (v: boolean) => void;
  setAskSchedulerPanelOpen: (v: boolean) => void;
  setHistoryOpen: (v: boolean) => void;
  setDataAnalysisOpen: (v: boolean) => void;
  handleSnapshot: () => void;
  handlePrintAllPatients: () => void;
  mySchedTherapist: number | null;
  setMySchedTherapist: Dispatch<SetStateAction<number | null>>;
  tiles: SessionTileData[];
  handleCopyDay: () => void;
  /** patientId -> today's auto-generated gap-fill digest entry (see server/scheduling.ts
   *  computeMorningDigest). Optional so this component doesn't hard-require the digest query. */
  digestByPatientId?: Map<number, any>;
  onBookSuggestion?: (patientId: number, slot: any) => void;
  onOpenSickCall?: () => void;
  onOpenComplianceSentinel?: () => void;
  onOpenPredictiveStaffing?: () => void;
  onOpenProductivityHub?: () => void;
  onViewStats?: (therapistId: number) => void;
}

export function BoardHeader({
  day, setDay, filter, setFilter, teamFilter, setTeamFilter, teams,
  patientsUnderTarget, weekMinsByPatient, conflictCount, conflictPairs,
  therapists, patients, jumpToPatient, setPanelOpen, setStaffPanelOpen,
  setWeeklyMinutesPanelOpen, setAskSchedulerPanelOpen, setHistoryOpen, setDataAnalysisOpen, handleSnapshot,
  handlePrintAllPatients, mySchedTherapist, setMySchedTherapist, tiles, handleCopyDay,
  digestByPatientId, onBookSuggestion,
  onOpenSickCall, onOpenComplianceSentinel, onOpenPredictiveStaffing, onOpenProductivityHub, onViewStats,
}: BoardHeaderProps) {
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [openDropdowns, setOpenDropdowns] = useState<Record<string, boolean>>({});

  const handleDropdownOpen = useCallback((key: string, open: boolean) => {
    setOpenDropdowns((prev) => ({ ...prev, [key]: open }));
  }, []);

  const isAnyDropdownOpen = useMemo(() => {
    return Object.values(openDropdowns).some(Boolean);
  }, [openDropdowns]);

  const isExpanded = isMobileExpanded || isHovered || isAnyDropdownOpen;

  const disciplineOptions: FilterOption<TherapyType>[] = useMemo(
    () => THERAPY_TYPES.map((t) => ({
      value: t,
      label: t,
      color: THERAPY_META[t].accent,
      activeBg: THERAPY_META[t].soft,
      activeFg: THERAPY_META[t].fg,
    })),
    [],
  );

  const teamOptions: FilterOption<number>[] = useMemo(
    () => teams.map((team) => ({ value: team.id, label: team.name, color: team.color })),
    [teams],
  );

  const navActions = useMemo(
    () => [
      { label: "Patients", icon: COMMAND_BAR_ICONS.Users, onClick: () => setPanelOpen(true) },
      { label: "Staff", icon: COMMAND_BAR_ICONS.UserRound, onClick: () => setStaffPanelOpen(true) },
      { label: "Mins", icon: COMMAND_BAR_ICONS.Clock, onClick: () => setWeeklyMinutesPanelOpen(true) },
      { label: "Data", icon: COMMAND_BAR_ICONS.BarChart3, onClick: () => setDataAnalysisOpen(true) },
    ],
    [setPanelOpen, setStaffPanelOpen, setWeeklyMinutesPanelOpen, setDataAnalysisOpen],
  );

  const handleAskPami = useCallback(() => setAskSchedulerPanelOpen(true), [setAskSchedulerPanelOpen]);
  const handleDayChange = useCallback((next: Date) => setDay(next), [setDay]);

  return (
    <header className="sticky top-0 z-40 flex flex-col shadow-header transition-all">
      <CommandBar actions={navActions} onAskPami={handleAskPami} />

      <div 
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="glass-header group relative flex flex-col md:flex-row flex-wrap items-center justify-between gap-x-6 px-4 py-3 sm:px-6 min-h-[68px] transition-all duration-300"
      >

        {/* Left: Filters */}
        <div className={cn("flex-wrap items-center gap-5 w-full md:w-auto md:flex-1 justify-start order-2 md:order-1 mt-4 md:mt-0", isExpanded ? "flex" : "hidden md:flex")}>
          <FilterGroup label="Discipline" options={disciplineOptions} value={filter} onChange={setFilter} onOpenChange={(o) => handleDropdownOpen("discipline", o)} />
          <div className="hidden sm:block w-[1px] h-4 bg-slate-200" />
          <FilterGroup label="Team" options={teamOptions} value={teamFilter} onChange={setTeamFilter} allLabel="All Teams" dropdownWidthClass="w-48" onOpenChange={(o) => handleDropdownOpen("team", o)} />
        </div>

        {/* Center: Date Chooser */}
        <div 
          onClick={() => setIsMobileExpanded((v) => !v)}
          className="flex w-full md:w-auto items-center justify-center z-10 shrink-0 order-1 md:order-2 cursor-pointer md:cursor-default"
        >
          <DateChooser day={day} onDayChange={handleDayChange} />
          <div className={cn("md:hidden ml-2 flex items-center justify-center text-slate-400 transition-all duration-200", isExpanded && "rotate-180")}>
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>

        {/* Right: Board Tools & Status */}
        <div className={cn("flex-wrap items-center gap-3 w-full md:w-auto md:flex-1 justify-center md:justify-end order-3 mt-4 md:mt-0", isExpanded ? "flex" : "hidden md:flex")}>

          <MySchedule
            therapists={therapists}
            value={mySchedTherapist}
            onChange={setMySchedTherapist}
            sessions={tiles}
            patients={patients}
            day={day}
          />

          <div className="flex items-center gap-1 rounded-full border border-slate-200/60 bg-white/50 p-1 shadow-sm backdrop-blur-sm">
            <AlertDialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Copy all sessions to tomorrow" className="h-8 w-8 rounded-full text-slate-500 hover:bg-white hover:text-primary hover:shadow-sm transition-all">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Copy all sessions to tomorrow</TooltipContent>
              </Tooltip>
              <AlertDialogContent className="glass-panel">
                <AlertDialogHeader>
                  <AlertDialogTitle>Copy Sessions</AlertDialogTitle>
                  <AlertDialogDescription>
                    Copy all sessions on this day to tomorrow?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCopyDay}>Copy</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <DropdownMenu onOpenChange={(o) => handleDropdownOpen("more", o)}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-500 hover:bg-white hover:text-primary hover:shadow-sm transition-all">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 glass-panel border-white/50 shadow-glass">
                <DropdownMenuItem onClick={handleSnapshot} className="cursor-pointer font-medium hover:bg-white/50">
                  <Camera className="mr-2 h-4 w-4 text-primary" />
                  <span>Save Snapshot</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setHistoryOpen(true)} className="cursor-pointer font-medium hover:bg-white/50">
                  <History className="mr-2 h-4 w-4 text-primary" />
                  <span>View History</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handlePrintAllPatients} className="cursor-pointer font-medium hover:bg-white/50">
                  <Printer className="mr-2 h-4 w-4 text-primary" />
                  <span>Print Schedules</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsAttendanceOpen(true)} className="cursor-pointer font-medium hover:bg-white/50">
                  <COMMAND_BAR_ICONS.ClipboardList className="mr-2 h-4 w-4 text-primary" />
                  <span>Staff Attendance</span>
                </DropdownMenuItem>
                <div className="my-1 h-px bg-slate-200/80" />
                <DropdownMenuItem onClick={onOpenSickCall} className="cursor-pointer font-bold text-rose-600 hover:bg-rose-50">
                  <span>🚨 Sick-Call Triage</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenComplianceSentinel} className="cursor-pointer font-bold text-amber-600 hover:bg-amber-50">
                  <span>🛡️ Compliance Sentinel</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenPredictiveStaffing} className="cursor-pointer font-bold text-sky-600 hover:bg-sky-50">
                  <span>📈 Capacity Planner</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenProductivityHub} className="cursor-pointer font-bold text-emerald-600 hover:bg-emerald-50">
                  <span>📊 81% Productivity Hub</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="w-[1px] h-6 bg-slate-200/80" />

          {/* Status Badges */}
          <div className="flex items-center gap-2">
            <StatusBadge count={patientsUnderTarget.length} variant="amber" label="At Risk" zeroLabel="Target">
              <div className="border-b border-amber-100 bg-amber-50 px-4 py-3">
                <h4 className="font-semibold text-amber-900">Patients At Risk</h4>
                <p className="text-xs text-amber-700 mt-0.5">
                  These patients are projected to fall short of their weekly minute targets.
                </p>
              </div>
              <ScrollArea className="h-64">
                <div className="p-2 space-y-1">
                  {patientsUnderTarget.map((p) => {
                    const target = p.weeklyMinuteTarget;
                    const current = weekMinsByPatient.get(p.id) ?? 0;
                    const progress = Math.min(100, Math.round((current / target) * 100));
                    const digestEntry = digestByPatientId?.get(p.id);
                    const topSlot = digestEntry?.proposedSlots?.[0];
                    return (
                      <div
                        key={p.id}
                        onClick={() => jumpToPatient(p.id)}
                        role="button"
                        tabIndex={0}
                        className="w-full text-left rounded-lg p-2 hover:bg-slate-50 transition-colors flex flex-col gap-1.5 group cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm text-slate-800 group-hover:text-sky-600 transition-colors">{p.name}</span>
                          <span className="text-xs font-bold tabular-nums text-amber-600">
                            {current} <span className="text-slate-400 font-normal">/ {target}m</span>
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        {/* Proposed slot from this morning's auto-generated gap-fill digest --
                            surfaced proactively here, not just available if someone asks PAMi. */}
                        {topSlot && onBookSuggestion && (
                          <div className="flex items-center justify-between gap-2 rounded-md bg-sky-50/60 px-2 py-1 border border-sky-100">
                            <span className="text-[10px] text-sky-700 truncate">
                              {topSlot.therapyType} · {new Date(topSlot.startTime).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })} · {topSlot.therapistName ?? "unassigned"}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onBookSuggestion(p.id, topSlot);
                              }}
                              className="shrink-0 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-sky-700 transition-colors"
                            >
                              Book
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </StatusBadge>

            <StatusBadge count={conflictCount} variant="rose" label="Conflicts" zeroLabel="Schedule" popoverWidthClass="w-[400px]">
              <div className="border-b border-rose-100 bg-rose-50 px-4 py-3">
                <h4 className="font-semibold flex items-center gap-2 text-rose-900">
                  <AlertTriangle className="h-4 w-4 text-rose-600" />
                  Scheduling Conflicts
                </h4>
                <p className="text-xs text-rose-700 mt-0.5">
                  The following sessions are double-booked.
                </p>
              </div>
              <ScrollArea className="h-64">
                <div className="p-2 space-y-1">
                  {conflictPairs.map((pair, idx) => (
                    <div key={idx} className="rounded-lg border border-rose-100 bg-white p-2.5 shadow-sm space-y-2">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: THERAPY_META[pair.sessionA.therapyType as TherapyType]?.accent || "#ccc" }} />
                          {therapists.find(t => t.id === pair.sessionA.therapistId)?.name || "Unassigned"}
                        </span>
                        <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                          {TIME_SLOTS[pair.sessionA.slotIndex]?.label || "Unknown"}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <button
                          onClick={() => jumpToPatient(pair.sessionA.patientId)}
                          className="w-full text-left flex items-center justify-between text-sm hover:bg-slate-50 p-1.5 rounded group"
                        >
                          <span className="text-slate-600 group-hover:text-sky-600 transition-colors">
                            {patients.find(p => p.id === pair.sessionA.patientId)?.name || "Unknown"}
                          </span>
                          <span className="text-xs font-medium text-slate-400 bg-slate-100 px-1.5 rounded">
                            Rm {patients.find(p => p.id === pair.sessionA.patientId)?.roomNumber || "?"}
                          </span>
                        </button>
                        <div className="flex items-center justify-center gap-2 text-rose-400">
                          <div className="h-[1px] flex-1 bg-rose-100" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-rose-500">Conflict</span>
                          <div className="h-[1px] flex-1 bg-rose-100" />
                        </div>
                        <button
                          onClick={() => jumpToPatient(pair.sessionB.patientId)}
                          className="w-full text-left flex items-center justify-between text-sm hover:bg-slate-50 p-1.5 rounded group"
                        >
                          <span className="text-slate-600 group-hover:text-sky-600 transition-colors">
                            {patients.find(p => p.id === pair.sessionB.patientId)?.name || "Unknown"}
                          </span>
                          <span className="text-xs font-medium text-slate-400 bg-slate-100 px-1.5 rounded">
                            Rm {patients.find(p => p.id === pair.sessionB.patientId)?.roomNumber || "?"}
                          </span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </StatusBadge>
          </div>
        </div>
      </div>

      <DailyAttendance
        day={day}
        therapists={therapists}
        open={isAttendanceOpen}
        onOpenChange={setIsAttendanceOpen}
        onViewStats={onViewStats}
      />
    </header>
  );
}
