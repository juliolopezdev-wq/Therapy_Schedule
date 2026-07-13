import { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronLeft, ChevronRight, AlertTriangle, Calendar as CalendarIcon,
  History, Users, UserRound, Clock, Bot, Smartphone, BarChart3, Camera, Printer
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
        "rounded px-2.5 py-1 text-xs font-medium transition-all duration-200 cursor-pointer border",
        active
          ? (!isCustomColor ? "bg-slate-800 text-white border-slate-800 shadow-sm" : "shadow-sm font-semibold")
          : "bg-transparent text-slate-600 border-transparent hover:bg-slate-100"
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
}

export function BoardHeader({
  day, setDay, filter, setFilter, teamFilter, setTeamFilter, teams,
  patientsUnderTarget, weekMinsByPatient, conflictCount, conflictPairs,
  therapists, patients, jumpToPatient, setPanelOpen, setStaffPanelOpen,
  setWeeklyMinutesPanelOpen, setAskSchedulerPanelOpen, setHistoryOpen, setDataAnalysisOpen, handleSnapshot,
  handlePrintAllPatients, mySchedTherapist, setMySchedTherapist, tiles
}: BoardHeaderProps) {
  const weekStart = startOfWeek(day);
  const weekLabel = weekRangeLabel(weekStart);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/50 bg-white/80 backdrop-blur-xl shadow-sm transition-all">
      <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-blue-600 text-primary-foreground shadow-sm">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <div className="hidden flex-col leading-none sm:flex">
              <span className="text-sm font-extrabold tracking-tight text-slate-900">PAM</span>
              <span className="text-[9px] font-semibold uppercase tracking-widest text-primary">Rehab Scheduler</span>
            </div>
          </div>

          <div className="hidden h-5 w-px bg-slate-200 sm:block" />

          {/* Date navigation */}
          <div className="flex items-center gap-1 bg-slate-50/50 rounded-md p-0.5 border border-slate-100">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-800 hover:bg-white hover:shadow-sm transition-all" onClick={() => setDay(subDays(day, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex flex-col items-center px-2 min-w-[140px]">
              <span className="text-sm font-bold text-slate-800">{formatLongDate(day)}</span>
              <span className="text-[10px] font-medium text-slate-500">{weekLabel}</span>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-800 hover:bg-white hover:shadow-sm transition-all" onClick={() => setDay(addDays(day, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs font-medium text-primary hover:bg-primary/10 ml-1 transition-colors" onClick={() => setDay(startOfDay(new Date()))}>
              Today
            </Button>
          </div>

          <div className="hidden h-5 w-px bg-slate-200 md:block" />

          {/* Badges */}
          <div className="flex items-center gap-2">
            {patientsUnderTarget.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors cursor-pointer shadow-sm">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                    <span>{patientsUnderTarget.length} At Risk</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-0 overflow-hidden shadow-xl border-amber-200" sideOffset={8}>
                  <div className="p-3 border-b border-amber-200/40 bg-amber-100/50">
                    <p className="font-semibold text-amber-900 text-sm">Patients Under Target</p>
                    <p className="text-xs text-amber-700/80 mt-0.5">Custom weekly targets based on admission</p>
                  </div>
                  <ScrollArea className="h-[300px]">
                    <ul className="p-3 space-y-2">
                      {patientsUnderTarget.map((p) => {
                        const mins = weekMinsByPatient.get(p.id) ?? 0;
                        const target = (p as any).weeklyMinuteTarget ?? 900;
                        const bounds = getPatientWeekBounds((p as any).admissionDate, day);
                        const endLabel = bounds.end.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
                        const adminStr = (p as any).admissionDate;
                        const adminDate = adminStr ? new Date(`${adminStr}T12:00:00`) : null;
                        const adminLabel = adminDate ? adminDate.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }) : "N/A";
                        
                        return (
                          <li key={p.id} className="text-sm flex flex-col pb-2.5 mb-2 border-b border-amber-200/40 last:border-0 last:pb-0 last:mb-0">
                            <div className="flex justify-between items-start">
                              <span className="font-semibold text-amber-950">{p.name} <span className="text-amber-700/80 font-normal ml-1">(Week {bounds.weekNumber})</span></span>
                              <span className="text-xs font-medium bg-amber-200/60 px-1.5 py-0.5 rounded text-amber-950">
                                {mins} / {target} mins
                              </span>
                            </div>
                            <div className="flex justify-between items-center mt-1.5 text-xs text-amber-800/90">
                              <span>Admitted: <span className="font-medium">{adminLabel}</span></span>
                              {adminStr && <span>Ends: <span className="font-medium">{endLabel}</span></span>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            )}
            
            {conflictCount > 0 ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors cursor-pointer shadow-sm">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>{conflictCount} conflict{conflictCount !== 1 ? "s" : ""}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-0 overflow-hidden shadow-xl border-red-200" sideOffset={8}>
                  <div className="p-3 border-b border-red-200/40 bg-red-50">
                    <p className="font-semibold text-red-900 text-sm flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4" />
                      Scheduling Conflicts
                    </p>
                    <p className="text-xs text-red-700/80 mt-0.5">Please resolve the following double-bookings</p>
                  </div>
                  <ScrollArea className="max-h-[300px]">
                    <ul className="p-3 space-y-3 bg-white">
                      {conflictPairs.map((pair) => {
                        const isTherapist = pair.type === "therapist";
                        const t = therapists.find(th => th.id === pair.sessionA.therapistId);
                        const pA = patients.find(p => p.id === pair.sessionA.patientId);
                        const pB = patients.find(p => p.id === pair.sessionB.patientId);
                        const timeA = TIME_SLOTS[pair.sessionA.slotIndex]?.shortLabel || "Unknown";
                        const timeB = TIME_SLOTS[pair.sessionB.slotIndex]?.shortLabel || "Unknown";

                        return (
                          <li key={pair.id} className="text-sm flex flex-col pb-3 border-b border-red-100 last:border-0 last:pb-0">
                            <div className="font-medium text-red-950 mb-1.5 leading-tight">
                              {isTherapist ? (
                                <>⚠️ Therapist <span className="font-bold">{t?.name || "Unknown"}</span> is double-booked</>
                              ) : (
                                <>⚠️ Patient <span className="font-bold">{pA?.name || "Unknown"}</span> is double-booked</>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between bg-slate-50 p-1.5 rounded border border-slate-100">
                                <span className="text-xs text-slate-700">{timeA} with {isTherapist ? pA?.name : t?.name}</span>
                                <button onClick={() => jumpToPatient(pair.sessionA.patientId)} className="text-[10px] bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded shadow-sm hover:bg-slate-100 transition-colors">Jump to Patient</button>
                              </div>
                              <div className="flex items-center justify-between bg-slate-50 p-1.5 rounded border border-slate-100">
                                <span className="text-xs text-slate-700">{timeB} with {isTherapist ? pB?.name : t?.name}</span>
                                <button onClick={() => jumpToPatient(pair.sessionB.patientId)} className="text-[10px] bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded shadow-sm hover:bg-slate-100 transition-colors">Jump to Patient</button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                No conflicts
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 border-slate-200 font-medium text-slate-600 hover:bg-slate-50 shadow-sm transition-all" onClick={() => setPanelOpen(true)}>
            <Users className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Patients</span>
          </Button>
          <Button variant="outline" size="sm" className="h-8 border-slate-200 font-medium text-slate-600 hover:bg-slate-50 shadow-sm transition-all" onClick={() => setStaffPanelOpen(true)}>
            <UserRound className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Staff</span>
          </Button>
          <Button variant="outline" size="sm" className="h-8 border-slate-200 font-medium text-slate-600 hover:bg-slate-50 shadow-sm transition-all" onClick={() => setWeeklyMinutesPanelOpen(true)}>
            <Clock className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Weekly Minutes</span>
          </Button>
          <Button variant="outline" size="sm" className="h-8 border-slate-200 font-medium text-slate-600 hover:bg-slate-50 shadow-sm transition-all bg-gradient-to-r hover:from-blue-50 hover:to-cyan-50" onClick={() => setAskSchedulerPanelOpen(true)}>
            <Bot className="mr-1.5 h-3.5 w-3.5 text-blue-600" />
            <span className="hidden sm:inline text-blue-700">Ask PAMi</span>
          </Button>
          <Button variant="outline" size="sm" className="h-8 border-slate-200 font-medium text-slate-600 hover:bg-slate-50 shadow-sm transition-all" onClick={() => setDataAnalysisOpen(true)}>
            <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Data Analysis</span>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8 border-slate-200 text-slate-500 hover:bg-slate-50 shadow-sm transition-all" onClick={handleSnapshot}>
                <Camera className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Save board snapshot</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8 border-slate-200 text-slate-500 hover:bg-slate-50 shadow-sm transition-all" onClick={() => setHistoryOpen(true)}>
                <History className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View & print board history</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8 border-slate-200 text-slate-500 hover:bg-slate-50 shadow-sm transition-all" onClick={handlePrintAllPatients}>
                <Printer className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Print all patient schedules</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-slate-200/50 bg-slate-50/50 px-4 py-2.5 sm:px-6 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Discipline</span>
          <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-slate-200/80 bg-white/50 p-0.5 shadow-sm">
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

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Team</span>
          <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-slate-200/80 bg-white/50 p-0.5 shadow-sm">
            <FilterButton active={teamFilter === "all"} onClick={() => setTeamFilter("all")}>All Teams</FilterButton>
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

        <div className="ml-auto flex items-center gap-2">
          <MySchedule
            therapists={therapists}
            value={mySchedTherapist}
            onChange={setMySchedTherapist}
            sessions={tiles}
            patients={patients}
            day={day}
          />
        </div>
      </div>

      {/* Mobile hint */}
      <div className="flex items-center gap-2 border-t border-slate-200/50 bg-indigo-50/50 px-4 py-2 text-xs text-indigo-700 sm:hidden backdrop-blur-sm">
        <Smartphone className="h-3.5 w-3.5 shrink-0" />
        <span>Tap <strong className="font-semibold">My Schedule</strong> for a focused view. Swipe the grid to see all times.</span>
      </div>
    </header>
  );
}
