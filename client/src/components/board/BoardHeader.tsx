import { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronLeft, ChevronRight, AlertTriangle, Calendar as CalendarIcon,
  History, Users, UserRound, Clock, Bot, Smartphone, BarChart3, Camera, Printer, Copy
} from "lucide-react";
import { 
  THERAPY_TYPES, THERAPY_META, TIME_SLOTS, type TherapyType,
  formatLongDate, startOfWeek, weekRangeLabel, addDays, subDays, startOfDay
} from "@/lib/board";
import { cn } from "@/lib/utils";
import { getPatientWeekBounds } from "../../../../shared/weekUtils";
import { ConflictPair } from "@/pages/TherapyBoard";
import { MySchedule } from "@/components/board/MySchedule";
import { SessionTileData } from "@/components/board/SessionTile";

function FilterButton({ active, onClick, children, color, activeBg, activeFg }: any) {
  const isCustomColor = !!color;
  return (
    <button
      onClick={onClick}
      style={
        isCustomColor && active
          ? { backgroundColor: activeBg || color, color: activeFg || "#fff", borderColor: color }
          : {}
      }
      className={cn(
        "rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all duration-200 cursor-pointer border",
        active
          ? (!isCustomColor ? "bg-slate-800 text-white border-slate-800 shadow-sm" : "shadow-sm")
          : "bg-transparent text-slate-500 border-transparent hover:bg-slate-100 hover:text-slate-800"
      )}
    >
      <div className="flex items-center gap-1.5">
        {isCustomColor && !active && (
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
        )}
        {children}
      </div>
    </button>
  );
}

export interface BoardHeaderProps {
  day: Date;
  setDay: Dispatch<SetStateAction<Date>>;
  filter: "all" | TherapyType;
  setFilter: Dispatch<SetStateAction<"all" | TherapyType>>;
  teamFilter: number | "all";
  setTeamFilter: Dispatch<SetStateAction<number | "all">>;
  teams: any[];
  patientsUnderTarget: any[];
  weekMinsByPatient: Map<number, number>;
  conflictCount: number;
  conflictPairs: ConflictPair[];
  therapists: any[];
  patients: any[];
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
}

export function BoardHeader({
  day, setDay, filter, setFilter, teamFilter, setTeamFilter, teams,
  patientsUnderTarget, weekMinsByPatient, conflictCount, conflictPairs,
  therapists, patients, jumpToPatient, setPanelOpen, setStaffPanelOpen,
  setWeeklyMinutesPanelOpen, setAskSchedulerPanelOpen, setHistoryOpen, setDataAnalysisOpen, handleSnapshot,
  handlePrintAllPatients, mySchedTherapist, setMySchedTherapist, tiles, handleCopyDay
}: BoardHeaderProps) {
  const weekStart = startOfWeek(day);
  const weekLabel = weekRangeLabel(weekStart);

  return (
    <header className="sticky top-0 z-30 flex flex-col shadow-[0_4px_20px_-4px_rgba(0,0,0,0.1)] transition-all border-b border-slate-200">
      {/* 1. Global Command Bar (Dark Mode, Deep Blue Theme) */}
      <div className="relative flex flex-wrap items-center justify-between px-4 py-3 sm:px-6 bg-gradient-to-r from-blue-800 via-sky-600 to-blue-800 text-blue-50 min-h-[88px] shadow-md border-b border-blue-700/50">
        
        {/* Left: Logo */}
        <div className="flex shrink-0 items-center gap-4 w-1/3 group cursor-default">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 via-blue-600 to-sky-600 shadow-[0_0_25px_rgba(59,130,246,0.5)] border border-white/20 overflow-hidden transition-all duration-500 group-hover:shadow-[0_0_30px_rgba(59,130,246,0.7)] group-hover:-translate-y-0.5">
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent mix-blend-overlay" />
            <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
            <svg viewBox="0 0 24 24" className="relative z-10 h-7 w-7 text-white drop-shadow-[0_2px_5px_rgba(0,0,0,0.4)] transform transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 3 3 8 12 13 21 8 12 3" fill="currentColor" fillOpacity="0.25"/>
              <polyline points="3 13 12 18 21 13" />
              <polyline points="3 18 12 23 21 18" />
            </svg>
          </div>
          <div className="hidden flex-col leading-none sm:flex">
            <span className="text-[20px] font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-200 drop-shadow-sm">PAM</span>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-blue-300 mt-1 opacity-90">Rehab Scheduler</span>
          </div>
        </div>

        {/* Right: Global Actions */}
        <div className="flex items-center justify-end gap-2.5 w-1/3 ml-auto">
          <Button variant="ghost" size="sm" className="h-10 rounded-full px-4 font-medium text-blue-100 hover:bg-blue-500/20 hover:text-white transition-all" onClick={() => setPanelOpen(true)}>
            <Users className="mr-2 h-4.5 w-4.5" />
            <span className="hidden xl:inline text-sm">Patients</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-10 rounded-full px-4 font-medium text-blue-100 hover:bg-blue-500/20 hover:text-white transition-all" onClick={() => setStaffPanelOpen(true)}>
            <UserRound className="mr-2 h-4.5 w-4.5" />
            <span className="hidden xl:inline text-sm">Staff</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-10 rounded-full px-4 font-medium text-blue-100 hover:bg-blue-500/20 hover:text-white transition-all" onClick={() => setWeeklyMinutesPanelOpen(true)}>
            <Clock className="mr-2 h-4.5 w-4.5" />
            <span className="hidden xl:inline text-sm">Mins</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-10 rounded-full px-4 font-medium text-blue-100 hover:bg-blue-500/20 hover:text-white transition-all" onClick={() => setDataAnalysisOpen(true)}>
            <BarChart3 className="mr-2 h-4.5 w-4.5" />
            <span className="hidden xl:inline text-sm">Data</span>
          </Button>
          
          <div className="mx-1.5 h-6 w-[1px] bg-blue-500/20" />
          
          <Button variant="ghost" size="sm" className="h-10 rounded-full px-6 font-extrabold text-white bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:via-blue-500 hover:to-indigo-500 border border-sky-300/50 transition-all duration-300 shadow-[0_0_20px_rgba(14,165,233,0.5)] hover:shadow-[0_0_30px_rgba(14,165,233,0.8)] hover:-translate-y-0.5" onClick={() => setAskSchedulerPanelOpen(true)}>
            <Bot className="mr-2 h-5 w-5 text-white drop-shadow-sm" />
            <span className="hidden xl:inline text-sm tracking-wide drop-shadow-sm">Ask PAMi</span>
          </Button>
        </div>
      </div>

      {/* 2. Board Toolbar (Light Mode / Glassmorphism) */}
      <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-3 bg-white/95 px-4 py-3 sm:px-6 min-h-[68px]">
        
        {/* Left: Filters */}
        <div className="flex flex-wrap items-center gap-5 z-10">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Discipline</span>
            <div className="flex items-center gap-0.5">
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>All</FilterButton>
              {THERAPY_TYPES.map((t) => (
                <FilterButton
                  key={t}
                  active={filter === t}
                  onClick={() => setFilter(t)}
                  color={THERAPY_META[t].accent}
                  activeBg={THERAPY_META[t].soft}
                  activeFg={THERAPY_META[t].fg}
                >
                  {t}
                </FilterButton>
              ))}
            </div>
          </div>
          <div className="w-[1px] h-4 bg-slate-200" />
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Team</span>
            <div className="flex items-center gap-0.5">
              <FilterButton active={teamFilter === "all"} onClick={() => setTeamFilter("all")}>All</FilterButton>
              {teams.map((team) => (
                <FilterButton
                  key={team.id}
                  active={teamFilter === team.id}
                  onClick={() => setTeamFilter(team.id)}
                  color={team.color}
                >
                  {team.name}
                </FilterButton>
              ))}
            </div>
          </div>
        </div>

        {/* Center: Date Chooser */}
        <div className="flex items-center justify-center absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden lg:flex">
          <div className="flex items-center gap-2 bg-white/95 backdrop-blur-md rounded-full p-1.5 border border-slate-200 shadow-sm transition-all hover:shadow-md">
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-all" onClick={() => setDay(subDays(day, 1))}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            
            <div className="flex flex-col items-center px-6 min-w-[190px] cursor-default">
              <span className="text-base font-extrabold tracking-tight text-slate-800">{formatLongDate(day)}</span>
              <span className="text-[10.5px] font-bold text-sky-600 uppercase tracking-widest mt-0.5">{weekLabel}</span>
            </div>
            
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-all" onClick={() => setDay(addDays(day, 1))}>
              <ChevronRight className="h-5 w-5" />
            </Button>
            
            <div className="ml-2 pl-3 border-l border-slate-200 py-0.5">
              <Button variant="ghost" size="sm" className="h-8 rounded-full px-4 text-xs font-bold tracking-wider text-slate-500 hover:text-sky-700 hover:bg-sky-50 transition-colors" onClick={() => setDay(startOfDay(new Date()))}>
                TODAY
              </Button>
            </div>
          </div>
        </div>

        {/* Right: Board Tools & Status */}
        <div className="flex items-center gap-3 ml-auto">
          
          <MySchedule
            therapists={therapists}
            value={mySchedTherapist}
            onChange={setMySchedTherapist}
            sessions={tiles}
            patients={patients}
            day={day}
          />

          <div className="flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm transition-all" onClick={() => {
                  if (confirm("Copy all sessions on this day to tomorrow?")) handleCopyDay();
                }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy all sessions to tomorrow</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm transition-all" onClick={handleSnapshot}>
                  <Camera className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save board snapshot</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm transition-all" onClick={() => setHistoryOpen(true)}>
                  <History className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>View & print board history</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm transition-all" onClick={handlePrintAllPatients}>
                  <Printer className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Print all patient schedules</TooltipContent>
            </Tooltip>
          </div>

          <div className="w-[1px] h-4 bg-slate-200" />

          {/* Status Badges */}
          <div className="flex items-center gap-2">
            {patientsUnderTarget.length > 0 ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="group flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-amber-700 bg-gradient-to-br from-amber-50 to-amber-100 hover:from-amber-100 hover:to-amber-200 px-3 py-1.5 rounded-full shadow-sm border border-amber-200/50 transition-all hover:shadow-md">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white shadow-inner">
                      <span className="text-[10px] font-black">{patientsUnderTarget.length}</span>
                    </span>
                    At Risk
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end" sideOffset={8}>
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
                        return (
                          <button
                            key={p.id}
                            onClick={() => jumpToPatient(p.id)}
                            className="w-full text-left rounded-lg p-2 hover:bg-slate-50 transition-colors flex flex-col gap-1.5 group"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-sm text-slate-800 group-hover:text-indigo-600 transition-colors">{p.name}</span>
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
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                Target
              </div>
            )}

            {conflictCount > 0 ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="group flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-rose-700 bg-gradient-to-br from-rose-50 to-rose-100 hover:from-rose-100 hover:to-rose-200 px-3 py-1.5 rounded-full shadow-sm border border-rose-200/50 transition-all hover:shadow-md animate-pulse">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white shadow-inner">
                      <span className="text-[10px] font-black">{conflictCount}</span>
                    </span>
                    Conflicts
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="end" sideOffset={8}>
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
                              <span className="text-slate-600 group-hover:text-indigo-600 transition-colors">
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
                              <span className="text-slate-600 group-hover:text-indigo-600 transition-colors">
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
                </PopoverContent>
              </Popover>
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                Schedule
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile hint */}
      <div className="flex items-center gap-2 bg-indigo-50/50 px-4 py-1.5 text-[11px] text-indigo-700 sm:hidden">
        <Smartphone className="h-3 w-3 shrink-0" />
        <span>Tap <strong className="font-semibold">My Schedule</strong> for a focused view. Swipe the grid to see all times.</span>
      </div>
    </header>
  );
}
