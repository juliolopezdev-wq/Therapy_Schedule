import { Dispatch, SetStateAction, Suspense, lazy, useCallback, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  History, Camera, Printer, Copy, ChevronDown, Siren, ShieldCheck, TrendingUp, CheckCheck, MessageSquareText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DailyAttendance } from "./DailyAttendance";
import { THERAPY_TYPES, THERAPY_META, TIME_SLOTS, type TherapyType } from "@/lib/board";
import type { Patient, Therapist, Team } from "../../../../drizzle/schema";
import { ConflictPair } from "@/pages/TherapyBoard";
import { MySchedule } from "@/components/board/MySchedule";
import { SessionTileData } from "@/components/board/SessionTile";
import { FilterGroup, type FilterOption } from "@/components/board/header/FilterGroup";
import { StatusBadge } from "@/components/board/header/StatusBadge";
import { DateChooser } from "@/components/board/header/DateChooser";
import { CommandBar, COMMAND_BAR_ICONS, type MoreAction } from "@/components/board/header/CommandBar";
import { cn } from "@/lib/utils";
import { CopyDayDialog, type CopyDaySession } from "./CopyDayDialog";
import { SaveSnapshotDialog } from "./SaveSnapshotDialog";
import { PrintSchedulesDialog } from "./PrintSchedulesDialog";
import { StaffMessageBoard } from "./StaffMessageBoard";
import { StaffAlertBeacon } from "./StaffAlertBeacon";
import { AtRiskModal, type AtRiskDigestEntry, type AtRiskSlot } from "./AtRiskModal";
import { ScheduleRequestsPanel } from "./ScheduleRequestsPanel";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { CalendarOff, ClipboardCheck } from "lucide-react";

// Pulls in recharts -- lazy-loaded so it never bloats the main board bundle that every user
// downloads, only the admins/team leads who actually open this panel.
const GGComplianceCenter = lazy(() => import("./GGComplianceCenter").then((m) => ({ default: m.GGComplianceCenter })));

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
  projectedWeekMinsByPatient: Map<number, number>;
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
  handleSnapshot: (note?: string) => Promise<{
    revision: number;
    summary: { sessions: number; patients: number; therapists: number; minutes: number };
  } | null>;
  mySchedTherapist: number | null;
  setMySchedTherapist: Dispatch<SetStateAction<number | null>>;
  tiles: SessionTileData[];
  sourceSessions: CopyDaySession[];
  handleCopyDay: () => Promise<{ count: number; skippedConflicts: number; skippedUnavailable: number } | null>;
  /** patientId -> today's auto-generated gap-fill digest entry (see server/scheduling.ts
   *  computeMorningDigest). Optional so this component doesn't hard-require the digest query. */
  digestByPatientId?: Map<number, AtRiskDigestEntry>;
  onBookSuggestion?: (patientId: number, slot: AtRiskSlot) => void;
  onOpenSickCall?: () => void;
  onOpenComplianceSentinel?: () => void;
  onOpenPredictiveStaffing?: () => void;
  onOpenProductivityHub?: () => void;
  onViewStats?: (therapistId: number) => void;
  canCompleteAll: boolean;
  completionSessionCount?: number;
  personalCompletion?: boolean;
  isCompletingAllSessions: boolean;
  onCompleteAllSessions: () => Promise<{ count: number }>;
}

export function BoardHeader({
  day, setDay, filter, setFilter, teamFilter, setTeamFilter, teams,
  patientsUnderTarget, weekMinsByPatient, projectedWeekMinsByPatient, conflictCount, conflictPairs,
  therapists, patients, jumpToPatient, setPanelOpen, setStaffPanelOpen,
  setWeeklyMinutesPanelOpen, setAskSchedulerPanelOpen, setHistoryOpen, setDataAnalysisOpen, handleSnapshot,
  mySchedTherapist, setMySchedTherapist, tiles, sourceSessions, handleCopyDay,
  digestByPatientId, onBookSuggestion,
  onOpenSickCall, onOpenComplianceSentinel, onOpenPredictiveStaffing, onOpenProductivityHub, onViewStats,
  canCompleteAll, completionSessionCount, personalCompletion = false, isCompletingAllSessions, onCompleteAllSessions,
}: BoardHeaderProps) {
  const { role, therapistId } = usePermissions();
  const isAdmin = role === "admin";
  const isTeamLead = role === "team_lead";
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false);
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [printSchedulesOpen, setPrintSchedulesOpen] = useState(false);
  const [atRiskOpen, setAtRiskOpen] = useState(false);
  const [completeAllOpen, setCompleteAllOpen] = useState(false);
  const [messageBoardOpen, setMessageBoardOpen] = useState(false);
  const [scheduleRequestsOpen, setScheduleRequestsOpen] = useState(false);
  const [ggComplianceOpen, setGgComplianceOpen] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [openDropdowns, setOpenDropdowns] = useState<Record<string, boolean>>({});
  const pendingScheduleRequests = trpc.scheduleRequests.list.useQuery(
    { status: "pending" },
    { enabled: isAdmin || isTeamLead, refetchInterval: 60_000 },
  );
  const staffSignals = trpc.messageBoard.list.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });
  const activeStaffAlertCount = (staffSignals.data ?? []).filter(
    (message) => !message.resolvedAt && !message.acknowledgedByMe && (message.priority === "urgent" || message.requiresAcknowledgement),
  ).length;
  const directThreads = trpc.directMessages.threads.useQuery(undefined, { refetchInterval: 10_000 });
  const unreadDirectMessageCount = (directThreads.data ?? []).reduce((total, thread) => total + thread.unreadCount, 0);
  const staffCommunicationCount = activeStaffAlertCount + unreadDirectMessageCount;

  const handleDropdownOpen = useCallback((key: string, open: boolean) => {
    setOpenDropdowns((prev) => ({ ...prev, [key]: open }));
  }, []);

  const isAnyDropdownOpen = useMemo(() => {
    return Object.values(openDropdowns).some(Boolean);
  }, [openDropdowns]);

  const isExpanded = isMobileExpanded || isAnyDropdownOpen;
  const sessionsReadyToComplete = useMemo(
    () => completionSessionCount ?? tiles.filter((session) => session.therapyType !== "Block" && session.status === "scheduled").length,
    [completionSessionCount, tiles],
  );

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
      { label: "Staff inbox", icon: MessageSquareText, onClick: () => setMessageBoardOpen(true), badgeCount: staffCommunicationCount },
      ...(isAdmin || isTeamLead ? [{ label: "Staff", icon: COMMAND_BAR_ICONS.UserRound, onClick: () => setStaffPanelOpen(true) }] : []),
    ],
    [staffCommunicationCount, isAdmin, isTeamLead, setPanelOpen, setStaffPanelOpen],
  );

  const pendingScheduleRequestCount = pendingScheduleRequests.data?.length ?? 0;

  const moreActions = useMemo<MoreAction[]>(() => [
    { label: "Print schedules", icon: Printer, onClick: () => setPrintSchedulesOpen(true) },
    ...(therapistId != null ? [{ label: "My stats & productivity", icon: COMMAND_BAR_ICONS.BarChart3, onClick: () => onViewStats?.(therapistId) }] : []),
    ...(therapistId != null || isAdmin || isTeamLead ? [{
      label: (isAdmin || isTeamLead) && pendingScheduleRequestCount > 0 ? `Time off & swaps (${pendingScheduleRequestCount} pending)` : "Time off & swaps",
      icon: CalendarOff,
      onClick: () => setScheduleRequestsOpen(true),
    }] : []),
    ...(role !== "viewer" ? [{ label: "Weekly minutes", icon: COMMAND_BAR_ICONS.Clock, onClick: () => setWeeklyMinutesPanelOpen(true) }] : []),
    ...(isAdmin || isTeamLead ? [
      { label: "Staff attendance", icon: COMMAND_BAR_ICONS.ClipboardList, onClick: () => setIsAttendanceOpen(true) },
      { label: "Call-off scheduling assistance", icon: Siren, onClick: () => onOpenSickCall?.(), destructive: true },
      { label: "Copy day to tomorrow", icon: Copy, onClick: () => setCopyConfirmOpen(true) },
      { label: "Section GG compliance", icon: ClipboardCheck, onClick: () => setGgComplianceOpen(true) },
    ] : []),
    ...(isAdmin ? [
      { label: "Data analysis", icon: COMMAND_BAR_ICONS.BarChart3, onClick: () => setDataAnalysisOpen(true) },
      { label: "Save snapshot", icon: Camera, onClick: () => setSnapshotOpen(true) },
      { label: "Saved board records", icon: History, onClick: () => setHistoryOpen(true) },
      { label: "Review compliance", icon: ShieldCheck, onClick: () => onOpenComplianceSentinel?.() },
      { label: "Plan staffing", icon: TrendingUp, onClick: () => onOpenPredictiveStaffing?.() },
      { label: "View productivity", icon: COMMAND_BAR_ICONS.BarChart3, onClick: () => onOpenProductivityHub?.() },
    ] : []),
  ], [
    handleCopyDay, handleSnapshot, onOpenComplianceSentinel,
    isAdmin, isTeamLead, onOpenPredictiveStaffing, onOpenProductivityHub, onOpenSickCall, onViewStats, role,
    setDataAnalysisOpen, therapistId, pendingScheduleRequestCount,
    setHistoryOpen, setWeeklyMinutesPanelOpen,
  ]);

  const handleAskPami = useCallback(() => setAskSchedulerPanelOpen(true), [setAskSchedulerPanelOpen]);
  const handleDayChange = useCallback((next: Date) => setDay(next), [setDay]);

  return (
    <header className="sticky top-0 z-40 flex flex-col shadow-header transition-all">
      <CommandBar actions={navActions} moreActions={moreActions} onAskPami={isAdmin || isTeamLead ? handleAskPami : undefined} />
      <StaffAlertBeacon onOpenBoard={() => setMessageBoardOpen(true)} />

      <div 
        className="relative flex min-h-[68px] flex-col flex-wrap items-center justify-between gap-x-6 border-b border-slate-200 bg-white px-4 py-3 md:flex-row sm:px-6"
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
            therapists={isAdmin || isTeamLead ? therapists : therapists.filter((therapist) => therapist.id === therapistId)}
            value={mySchedTherapist}
            onChange={setMySchedTherapist}
            sessions={tiles}
            patients={patients}
            day={day}
          />

          {canCompleteAll && (
            <Button
              type="button"
              variant="outline"
              className="h-10 border-emerald-200 bg-emerald-50 px-3 font-bold text-emerald-800 shadow-sm hover:bg-emerald-100 hover:text-emerald-950"
              disabled={sessionsReadyToComplete === 0 || isCompletingAllSessions}
              onClick={() => setCompleteAllOpen(true)}
              title={sessionsReadyToComplete === 0 ? "No scheduled treatment sessions remain" : `Complete ${sessionsReadyToComplete} verified sessions`}
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              Complete all
              {sessionsReadyToComplete > 0 && (
                <span className="ml-2 rounded-full bg-emerald-700 px-1.5 py-0.5 text-[11px] font-black text-white">
                  {sessionsReadyToComplete}
                </span>
              )}
            </Button>
          )}

          {/* Status Badges */}
          <div className="flex items-center gap-2">
            <StatusBadge count={patientsUnderTarget.length} variant="amber" label="At Risk" zeroLabel="Target" onClick={() => setAtRiskOpen(true)} />

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
                          <span className="text-xs font-bold uppercase tracking-wide text-rose-700">Conflict</span>
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
        sessions={tiles}
        open={isAttendanceOpen}
        onOpenChange={setIsAttendanceOpen}
        onViewStats={onViewStats}
      />

      <AlertDialog open={completeAllOpen} onOpenChange={setCompleteAllOpen}>
        <AlertDialogContent className="overflow-hidden rounded-2xl border-slate-200 bg-white p-0 sm:max-w-lg">
          <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-5">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-xl text-slate-950">
                <CheckCheck className="h-6 w-6 text-emerald-700" />
                Verify {personalCompletion ? "my" : "all"} sessions
              </AlertDialogTitle>
              <AlertDialogDescription className="pt-2 text-sm leading-6 text-slate-700">
                Have you verified that {personalCompletion ? "your" : "all"} {sessionsReadyToComplete} scheduled treatment session{sessionsReadyToComplete === 1 ? " was" : "s were"} completed on {day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}?
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>
          <div className="space-y-3 px-6 py-5">
            <p className="text-sm font-semibold text-slate-900">
              This will mark every remaining scheduled treatment session as Completed using its scheduled minutes.
            </p>
            <p className="text-sm text-slate-600">
              Before continuing, individually mark refusals, clinical holds, staffing misses, or other missed sessions. Block time and sessions already documented as missed or completed will not change.
            </p>
          </div>
          <AlertDialogFooter className="border-t border-slate-200 bg-slate-50 px-6 py-4">
            <AlertDialogCancel disabled={isCompletingAllSessions}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={sessionsReadyToComplete === 0 || isCompletingAllSessions}
              className="bg-emerald-700 font-bold text-white hover:bg-emerald-800"
              onClick={() => { void onCompleteAllSessions().catch(() => undefined); }}
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              {isCompletingAllSessions ? "Completing…" : "Verified - complete all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AtRiskModal
        open={atRiskOpen}
        onOpenChange={setAtRiskOpen}
        day={day}
        patients={patientsUnderTarget}
        completedMinutes={weekMinsByPatient}
        projectedMinutes={projectedWeekMinsByPatient}
        digestByPatientId={digestByPatientId}
        onOpenPatient={jumpToPatient}
        onBookSuggestion={onBookSuggestion}
      />

      <CopyDayDialog
        open={copyConfirmOpen}
        onOpenChange={setCopyConfirmOpen}
        sourceDate={day}
        sessions={sourceSessions}
        onCopy={handleCopyDay}
        onViewTomorrow={() => {
          const tomorrow = new Date(day);
          tomorrow.setDate(tomorrow.getDate() + 1);
          setCopyConfirmOpen(false);
          setDay(tomorrow);
        }}
      />

      <SaveSnapshotDialog
        open={snapshotOpen}
        onOpenChange={setSnapshotOpen}
        date={day}
        sessions={sourceSessions}
        conflictCount={conflictCount}
        onSave={handleSnapshot}
        onViewHistory={() => {
          setSnapshotOpen(false);
          setHistoryOpen(true);
        }}
      />

      <PrintSchedulesDialog
        open={printSchedulesOpen}
        onOpenChange={setPrintSchedulesOpen}
        day={day}
        patients={patients}
        sessions={tiles}
        therapists={therapists}
      />

      <StaffMessageBoard open={messageBoardOpen} onOpenChange={setMessageBoardOpen} />
      <ScheduleRequestsPanel open={scheduleRequestsOpen} onOpenChange={setScheduleRequestsOpen} therapists={therapists} />
      {ggComplianceOpen && (
        <Suspense fallback={null}>
          <GGComplianceCenter open={ggComplianceOpen} onOpenChange={setGgComplianceOpen} />
        </Suspense>
      )}
    </header>
  );
}
