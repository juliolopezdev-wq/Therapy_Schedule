import { usePatientReorder } from "@/hooks/usePatientReorder";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  Plus,
  Users,
  UserRound,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  XCircle,
  UserCircle2,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TIME_SLOTS,
  type TherapyType,
  type FlagType,
  isMissedStatus,
  isCanceledStatus,
  isEvaluationTherapyType,
  dateToSlotIndex,
  slotIndexToDate,
  durationToSlots,
  startOfDay,
  addDays,
  subDays,
  differenceInDays,
  formatLongDate,
  sessionsOverlap,
  startOfWeek,
  weekRangeLabel,
  formatDateKey,
  DEFAULT_WEEKLY_MINUTE_TARGET,
} from "@/lib/board";
import { SessionTile, type SessionTileData } from "@/components/board/SessionTile";
import { GridCell } from "@/components/board/GridCell";
import { FlagBadge, FlagToggle } from "@/components/board/StatusFlags";
import { PatientDayQuickView } from "@/components/board/PatientDayQuickView";
import { BoardHeader } from "@/components/board/BoardHeader";
import { BoardStatusSummary } from "@/components/board/BoardStatusSummary";
import { TeamHuddle } from "@/components/board/TeamHuddle";
import { MobileTodayList } from "@/components/board/MobileTodayList";
import type { SessionFormValue } from "@/components/board/SessionDialog";
import type { PatientFormValue } from "@/components/board/PatientDialog";
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
import { cn } from "@/lib/utils";
import { TeamDroppable } from "@/components/board/TeamDroppable";
import { TimeHeaderRow } from "@/components/board/grid/TimeHeaderRow";
import { TeamHeaderRow } from "@/components/board/grid/TeamHeaderRow";
import { PatientRow } from "@/components/board/grid/PatientRow";
import { useBoardUI } from "@/hooks/useBoardUI";
import { useBoardDnd } from "@/hooks/useBoardDnd";

const AskSchedulerPanel = lazy(() => import("@/components/board/AskSchedulerPanel").then((module) => ({ default: module.AskSchedulerPanel })));
const BoardHistoryDialog = lazy(() => import("@/components/board/BoardHistoryDialog").then((module) => ({ default: module.BoardHistoryDialog })));
const ComplianceSentinelModal = lazy(() => import("@/components/board/ComplianceSentinelModal").then((module) => ({ default: module.ComplianceSentinelModal })));
const DataAnalysisModal = lazy(() => import("@/components/board/DataAnalysisModal").then((module) => ({ default: module.DataAnalysisModal })));
const PatientDialog = lazy(() => import("@/components/board/PatientDialog").then((module) => ({ default: module.PatientDialog })));
const PatientPanel = lazy(() => import("@/components/board/PatientPanel").then((module) => ({ default: module.PatientPanel })));
const PredictiveStaffingPanel = lazy(() => import("@/components/board/PredictiveStaffingPanel").then((module) => ({ default: module.PredictiveStaffingPanel })));
const ProductivityHubModal = lazy(() => import("@/components/board/ProductivityHubModal").then((module) => ({ default: module.ProductivityHubModal })));
const SessionDialog = lazy(() => import("@/components/board/SessionDialog").then((module) => ({ default: module.SessionDialog })));
const SickCallModal = lazy(() => import("@/components/board/SickCallModal").then((module) => ({ default: module.SickCallModal })));
const StaffStatsModal = lazy(() => import("@/components/board/StaffStatsModal").then((module) => ({ default: module.StaffStatsModal })));
const TherapistPanel = lazy(() => import("@/components/board/TherapistPanel").then((module) => ({ default: module.TherapistPanel })));
const WeekendStaffingModal = lazy(() => import("@/components/board/WeekendStaffingModal").then((module) => ({ default: module.WeekendStaffingModal })));
const WeeklyMinutesPanel = lazy(() => import("@/components/board/WeeklyMinutesPanel").then((module) => ({ default: module.WeeklyMinutesPanel })));

const SLOT_WIDTH = 72; // px per 30-min slot

import { getPatientWeekBounds } from "@/../../shared/weekUtils";
import { wasOnUnitOn } from "@/../../shared/patientLifecycle";
import type { Patient } from "../../../drizzle/schema";

const BOARD_SECTIONS = [
  { id: 1, name: "Team One",   color: "#3b82f6" },
  { id: 2, name: "Team Two",   color: "#10b981" },
  { id: 3, name: "Team Three", color: "#f59e0b" },
] as const;

// For the EOW (End Of Week) column -- single-letter day labels, indexed by Date#getDay() (0=Sun..6=Sat).
const EOW_DAY_LETTERS = ["S", "M", "T", "W", "TH", "F", "S"];
const EOW_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const EMPTY_PATIENT: PatientFormValue = {
  mrn: "",
  roomNumber: "",
  name: "",
  notes: "",
  isDischarged: false,
  admissionDate: "",
  weeklyMinuteTarget: DEFAULT_WEEKLY_MINUTE_TARGET,
  teamId: null,
  sessionTime: "none",
  sessionType: "PT",
  sessionDuration: 30,
  sessionTherapist: null,
};
type ViewFilter = "all" | TherapyType;

export interface ConflictPair {
  id: string;
  type: "therapist" | "patient";
  sessionA: SessionTileData;
  sessionB: SessionTileData;
}

// A patient with no sessions today gets this same empty-array reference every time, instead of a
// fresh `[]` per render, so it doesn't defeat memoization on the (memoized) PatientRow that
// receives it as a prop.
const EMPTY_TILES: SessionTileData[] = [];
const EMPTY_FLAGS: { id: number; flagType: FlagType; date: Date | string }[] = [];

// Pure function of its arguments (no component state) -- hoisted out of the component so it has
// stable identity across renders instead of being recreated (and passed to memoized children)
// on every render for no reason.
function checkLunchOverlapPure(startTime: Date, endTime: Date): string | null {
  const lunchStart = new Date(startTime);
  lunchStart.setHours(12, 0, 0, 0);
  const lunchEnd = new Date(startTime);
  lunchEnd.setHours(13, 0, 0, 0);
  if (startTime.getTime() < lunchEnd.getTime() && endTime.getTime() > lunchStart.getTime()) {
    return "This session overlaps the lunch period (12:00 PM - 1:00 PM).";
  }
  return null;
}

export default function TherapyBoard() {
  const { canEdit, canChart, therapistId: currentTherapistId, role, isAdmin, isLinked, hasBoardAccess } = usePermissions();
  // The backend already blocks these for viewer/staff -- these guards exist so clicking an
  // action surfaces a clear message instead of a raw FORBIDDEN toast from the failed mutation.
  const requireEdit = useCallback(() => {
    if (!canEdit) {
      toast.error("You have view-only access and can't make changes.");
      return false;
    }
    return true;
  }, [canEdit]);
  const requireAdmin = useCallback(() => {
    if (!isAdmin) {
      toast.error("This action requires admin access.");
      return false;
    }
    return true;
  }, [isAdmin]);
  const utils = trpc.useUtils();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [teamFilter, setTeamFilter] = useState<number | "all">(() => isAdmin ? 1 : "all");
  const [mySchedTherapist, setMySchedTherapist] = useState<number | null>(null);

  const [activeDrag, setActiveDrag] = useState<SessionTileData | null>(null);
  const [activeDragPatient, setActiveDragPatient] = useState<Patient | null>(null);
  const timeHeaderScrollRef = useRef<HTMLDivElement>(null);
  
  const {
    sessionDialogOpen,
    setSessionDialogOpen,
    sessionDraft,
    setSessionDraft,
    patientDialogOpen,
    setPatientDialogOpen,
    patientDraft,
    setPatientDraft,
    panelOpen,
    setPanelOpen,
    staffPanelOpen,
    setStaffPanelOpen,
    weeklyMinutesPanelOpen,
    setWeeklyMinutesPanelOpen,
    askSchedulerPanelOpen,
    setAskSchedulerPanelOpen,
    historyOpen,
    setHistoryOpen,
    dataAnalysisOpen,
    setDataAnalysisOpen,
    overrideWarning,
    setOverrideWarning,
    collapsedSections,
    setCollapsedSections,
  } = useBoardUI();

  const [sickCallModalOpen, setSickCallModalOpen] = useState(false);
  const [complianceSentinelOpen, setComplianceSentinelOpen] = useState(false);
  const [predictiveStaffingOpen, setPredictiveStaffingOpen] = useState(false);
  const [statsTherapistId, setStatsTherapistId] = useState<number | null>(null);
  const [productivityHubOpen, setProductivityHubOpen] = useState(false);
  const [productivityHubTherapistId, setProductivityHubTherapistId] = useState<number | null>(null);
  const [productivityHubViewMode, setProductivityHubViewMode] = useState<"admin" | "staff">("admin");
  const [weekendStaffingOpen, setWeekendStaffingOpen] = useState(false);

  const jumpToPatient = (patientId: number) => {
    const patient = patientsQuery.data?.find((p) => p.id === patientId);
    if (patient) {
      const teamId = patient.teamId;
      if (teamId != null) {
        setCollapsedSections((prev) => {
          const next = new Set(prev);
          next.delete(teamId);
          return next;
        });
      }
      setFilter("all");
      setTeamFilter("all");
      // The row for this patient doesn't exist yet -- it renders only after the collapse/filter
      // state above triggers a re-render. Poll via rAF (bounded) instead of guessing a fixed
      // delay, which could fire before the row exists on a slow render and silently no-op.
      let attempts = 0;
      const tryScroll = () => {
        const row = document.getElementById(`patient-row-${patientId}`);
        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
          row.classList.add("bg-amber-100/50", "transition-colors", "duration-500");
          setTimeout(() => row.classList.remove("bg-amber-100/50", "transition-colors", "duration-500"), 2000);
          return;
        }
        attempts++;
        if (attempts < 30) requestAnimationFrame(tryScroll);
      };
      requestAnimationFrame(tryScroll);
    }
  };

  // Seed teams once on mount -- admin-only on the backend, so staff/viewer must not fire this
  // (they'd get a FORBIDDEN toast on every page load otherwise).
  const seedTeams = trpc.teams.seed.useMutation();
  useEffect(() => {
    if (!isAdmin) return;
    seedTeams.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Queries
  const patientsQuery = trpc.patients.list.useQuery({ date: day }, { enabled: hasBoardAccess });
  const archivedPatientsQuery = trpc.patients.listArchived.useQuery(undefined, { enabled: isAdmin });
  const therapistsQuery = trpc.therapists.list.useQuery(undefined, { enabled: hasBoardAccess });
  const teamsQuery = trpc.teams.list.useQuery(undefined, { enabled: hasBoardAccess });
  const sessionsQuery = trpc.sessions.list.useQuery({ date: day }, { enabled: hasBoardAccess });
  const assignmentHistoryQuery = trpc.attendance.assignmentHistory.useQuery({ date: day }, { enabled: hasBoardAccess });
  const weekSessionsQuery = trpc.sessions.listForDateRange.useQuery({ 
    startDate: subDays(day, 7),
    endDate: addDays(day, 7)
  }, { enabled: hasBoardAccess });
  const flagsQuery = trpc.statusFlags.listForDate.useQuery({ date: day }, { enabled: hasBoardAccess });
  const digestQuery = trpc.digest.today.useQuery(undefined, { enabled: hasBoardAccess });

  // Fetch sessions for the next 2 days to check for exit evals
  const upcomingSessionsQuery = trpc.sessions.listForDateRange.useQuery({
    startDate: day,
    endDate: addDays(day, 2),
  }, { enabled: hasBoardAccess });

  const patients = patientsQuery.data ?? [];
  // the board only shows patients who were on the unit on the selected day
  const dayKey = formatDateKey(day);
  const boardPatients = useMemo(() => patients.filter((p) => wasOnUnitOn(p, dayKey)), [patients, dayKey]);
  const activePatientCount = boardPatients.filter((p) => !p.isRoomPlaceholder).length;
  const therapists = therapistsQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const rawSessions = sessionsQuery.data ?? [];
  const assignmentHistoryBySessionId = useMemo(() => {
    const map = new Map<number, NonNullable<typeof assignmentHistoryQuery.data>[number]>();
    (assignmentHistoryQuery.data ?? []).forEach((entry) => map.set(entry.sessionId, entry));
    return map;
  }, [assignmentHistoryQuery.data]);
  const weekSessions = weekSessionsQuery.data ?? [];
  const upcomingSessions = upcomingSessionsQuery.data ?? [];
  const digestByPatientId = useMemo(() => {
    const map = new Map<number, NonNullable<typeof digestQuery.data>[number]>();
    (digestQuery.data ?? []).forEach((entry) => map.set(entry.patientId, entry));
    return map;
  }, [digestQuery.data]);
  const flags = flagsQuery.data ?? [];

  // Mutations
  const invalidateBoard = () => {
    utils.sessions.list.invalidate();
    // The week view is fetched via listForDateRange (see weekSessionsQuery/upcomingSessionsQuery
    // above), not listForWeek -- invalidating listForWeek here was a no-op for this page, so the
    // weekly-minutes badge only ever refreshed on an unrelated trigger (e.g. a full reload).
    utils.sessions.listForDateRange.invalidate();
    utils.attendance.assignmentHistory.invalidate();
    utils.patients.list.invalidate();
    utils.patients.listArchived.invalidate();
    utils.statusFlags.listForDate.invalidate();
    // Session status/minutes feed every clinical and operational rollup below. Invalidate them
    // together so bulk or individual completion is immediately reflected everywhere, including
    // panels that were already open when the change was made.
    utils.weeklyMinutes.summary.invalidate();
    utils.gapFill.suggestions.invalidate();
    utils.therapists.getStats.invalidate();
    utils.therapists.getProductivity.invalidate();
    utils.aiAgents.getComplianceReport.invalidate();
    utils.aiAgents.getPredictiveForecast.invalidate();
    utils.forecast.invalidate();
  };

  const createSession = trpc.sessions.create.useMutation({
    onSuccess: () => { invalidateBoard(); toast.success("Session added"); },
    onError: (err) => toast.error(err.message)
  });
  const updateSession = trpc.sessions.update.useMutation({
    // Optimistic update: a drag-move/resize should feel instant, not wait on a remote-DB round
    // trip (server write) followed by a separate refetch (client read) before the tile visibly
    // moves -- that two-hop wait is what showed up as multi-second drag lag. Patch the cached
    // session list immediately; onError rolls back to the pre-drag snapshot if the write fails.
    onMutate: async (vars) => {
      await utils.sessions.list.cancel({ date: day });
      const previous = utils.sessions.list.getData({ date: day });
      utils.sessions.list.setData({ date: day }, (old) =>
        old?.map((s) => (s.id === vars.id ? { ...s, ...vars } : s)),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) utils.sessions.list.setData({ date: day }, ctx.previous);
      toast.error(err.message);
    },
    onSuccess: () => toast.success("Session updated"),
    onSettled: () => invalidateBoard(),
  });
  const undoOwnCompletion = trpc.sessions.undoOwnCompletion.useMutation({
    onSuccess: () => {
      toast.success("Completion undone — session returned to Scheduled");
      setSessionDialogOpen(false);
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => invalidateBoard(),
  });
  const completeOwnSession = trpc.sessions.completeOwn.useMutation({
    onSuccess: (_result, variables) => {
      toast.success("Session completed", {
        action: {
          label: "Undo",
          onClick: () => undoOwnCompletion.mutate({ id: variables.id }),
        },
      });
      setSessionDialogOpen(false);
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => invalidateBoard(),
  });
  const completeAllSessions = trpc.sessions.completeAllForDate.useMutation({
    onMutate: async ({ date }) => {
      const queryInput = { date };
      await utils.sessions.list.cancel(queryInput);
      const previous = utils.sessions.list.getData(queryInput);
      utils.sessions.list.setData(queryInput, (current) => current?.map((session) =>
        session.therapyType !== "Block" && session.status === "scheduled"
          ? {
              ...session,
              status: "completed" as const,
              actualDurationMinutes: session.durationMinutes,
              missedReason: null,
            }
          : session,
      ));
      return { previous, queryInput };
    },
    onError: (err, _variables, context) => {
      if (context?.previous) utils.sessions.list.setData(context.queryInput, context.previous);
      toast.error(`Could not complete sessions: ${err.message}`);
    },
    onSuccess: ({ count }) => {
      toast.success(count === 0 ? "No scheduled sessions needed completion." : `${count} session${count === 1 ? "" : "s"} completed.`);
    },
    onSettled: () => invalidateBoard(),
  });
  const deleteSession = trpc.sessions.delete.useMutation({ 
    onSuccess: () => { invalidateBoard(); toast.success("Session deleted"); }, 
    onError: (err) => toast.error(err.message) 
  });
  const createPatient = trpc.patients.create.useMutation({ 
    onSuccess: () => { invalidateBoard(); toast.success("Patient added"); }, 
    onError: (err) => toast.error(err.message) 
  });
  const updatePatient = trpc.patients.update.useMutation({ 
    onSuccess: () => { invalidateBoard(); toast.success("Patient updated"); }, 
    onError: (err) => toast.error(err.message) 
  });
  const reorderPatient = usePatientReorder(day);
  const archivePatient = trpc.patients.archive.useMutation({
    onSuccess: () => { invalidateBoard(); toast.success("Admission archived"); },
    onError: (err) => toast.error(err.message),
  });
  const restorePatient = trpc.patients.restore.useMutation({
    onSuccess: () => { invalidateBoard(); toast.success("Admission restored to discharged history"); },
    onError: (err) => toast.error(err.message),
  });
  const toggleFlag = trpc.statusFlags.toggle.useMutation({
    onMutate: async (variables) => {
      const queryInput = { date: day };
      await utils.statusFlags.listForDate.cancel(queryInput);
      const previous = utils.statusFlags.listForDate.getData(queryInput);

      utils.statusFlags.listForDate.setData(queryInput, (current) => {
        const flagsForDay = current ?? [];
        const withoutFlag = flagsForDay.filter(
          (flag) => !(flag.patientId === variables.patientId && flag.flagType === variables.flagType),
        );

        if (!variables.active) return withoutFlag;

        return [
          ...withoutFlag,
          {
            id: -Date.now(),
            patientId: variables.patientId,
            flagType: variables.flagType,
            date: variables.date,
            active: true,
            createdAt: new Date(),
          },
        ];
      });

      return { previous, queryInput };
    },
    onError: (err, _variables, context) => {
      if (context?.previous) {
        utils.statusFlags.listForDate.setData(context.queryInput, context.previous);
      }
      toast.error(err.message);
    },
    onSettled: () => invalidateBoard(),
  });
  const saveSnapshot = trpc.history.save.useMutation({
    onSuccess: () => {
      void utils.history.list.invalidate();
      void utils.history.getForDate.invalidate();
    },
  });
  const invalidateStaff = () => {
    utils.therapists.list.invalidate();
    utils.therapists.listArchived.invalidate();
  };
  const createTherapist = trpc.therapists.create.useMutation({
    onSuccess: () => { invalidateStaff(); toast.success("Staff member added"); },
    onError: (err) => toast.error(err.message),
  });
  const updateTherapist = trpc.therapists.update.useMutation({
    onSuccess: () => { invalidateStaff(); toast.success("Staff member updated"); },
    onError: (err) => toast.error(err.message),
  });
  const archiveTherapist = trpc.therapists.archive.useMutation({
    onSuccess: () => { invalidateStaff(); toast.success("Staff member archived"); },
    onError: (err) => toast.error(err.message),
  });
  const restoreTherapist = trpc.therapists.restore.useMutation({
    onSuccess: () => { invalidateStaff(); toast.success("Staff member restored"); },
    onError: (err) => toast.error(err.message),
  });
  const archivedTherapistsQuery = trpc.therapists.listArchived.useQuery();
  const inviteUser = trpc.admin.invite.useMutation({
    onSuccess: (result, variables) => {
      if (result.emailDelivery === "sent") {
        toast.success(`Invitation sent to ${variables.email}`);
      } else if (result.emailDelivery === "not_configured") {
        toast.warning(`Access was created for ${variables.email}, but server email is not configured.`);
      } else if (result.emailDelivery === "rate_limited") {
        toast.warning("Access was created, but too many sign-in links were requested. Try resending in 15 minutes.");
      } else {
        toast.error(`Access was created for ${variables.email}, but the invitation email could not be delivered.`);
      }
    },
    onError: (err) => toast.error(err.message),
  });
  const sendTomorrowAssignments = trpc.therapists.sendTomorrowAssignments.useMutation({
    onSuccess: (result) => {
      const { queued, skippedNoEmail, noSessions, failed } = result;
      if (queued.length === 0 && skippedNoEmail.length === 0 && noSessions.length === 0 && failed.length === 0) {
        toast.info("No sessions scheduled for tomorrow yet.");
        return;
      }
      const parts: string[] = [];
      // "Queued," not "Sent" -- the actual send happens in the background after this response,
      // so this only confirms the email was handed off, not that it landed in an inbox yet.
      if (queued.length > 0) parts.push(`Queued ${queued.length} assignment email${queued.length === 1 ? "" : "s"} to send.`);
      if (noSessions.length > 0) {
        const names = noSessions.map((n) => n.therapistName).join(", ");
        parts.push(`${names} ${noSessions.length === 1 ? "has" : "have"} no sessions scheduled tomorrow.`);
      }
      if (skippedNoEmail.length > 0) parts.push(`${skippedNoEmail.length} skipped (no email on file).`);
      if (failed.length > 0) parts.push(`${failed.length} couldn't be queued -- email isn't configured on the server.`);
      if (failed.length > 0) {
        toast.error(parts.join(" "));
      } else if (queued.length === 0) {
        toast.info(parts.join(" "));
      } else {
        toast.success(parts.join(" "));
      }
    },
    onError: (err) => toast.error(err.message),
  });
  const copyDayToNextDay = trpc.sessions.copyDayToNextDay.useMutation({
    onSuccess: () => invalidateBoard(),
  });
  const copyPatientSessions = trpc.sessions.copyPatientSessionsToNextDay.useMutation({
    onSuccess: (res) => {
      invalidateBoard();
      toast.success(`Copied ${res.count} session(s) to tomorrow.`);
    },
    onError: () => toast.error("Could not copy sessions."),
  });

  // Map sessions to tile data with slot positions. Reuses the previous tile object for a session
  // whose derived fields haven't actually changed, instead of allocating a brand-new object for
  // every session on every render -- invalidateBoard() refetches sessions.list on nearly every
  // mutation (even ones for a different patient), so without this every SessionTile/GridCell/
  // PatientRow downstream would see a new prop reference and re-render regardless of memoization.
  const tileCacheRef = useRef(new Map<number, SessionTileData>());
  const tiles: SessionTileData[] = useMemo(() => {
    const cache = tileCacheRef.current;
    const nextCache = new Map<number, SessionTileData>();
    const result = rawSessions.map((s) => {
      const start = new Date(s.startTime);
      const slotIndex = dateToSlotIndex(start);
      const slotSpan = durationToSlots(s.durationMinutes);
      const assignmentHistory = assignmentHistoryBySessionId.get(s.id);
      const computed: SessionTileData = {
        id: s.id,
        patientId: s.patientId,
        therapyType: s.therapyType as TherapyType,
        therapistId: s.therapistId,
        durationMinutes: s.durationMinutes,
        actualDurationMinutes: s.actualDurationMinutes,
        slotIndex,
        slotSpan,
        status: s.status || "scheduled",
        deliveryMode: s.deliveryMode || "individual",
        missedReason: s.missedReason,
        notes: s.notes,
        previousTherapistName: assignmentHistory?.previousTherapistName,
      };
      const cached = cache.get(s.id);
      const unchanged =
        !!cached &&
        (Object.keys(computed) as (keyof SessionTileData)[]).every((key) => cached[key] === computed[key]);
      const tile = unchanged ? cached! : computed;
      nextCache.set(s.id, tile);
      return tile;
    });
    tileCacheRef.current = nextCache;
    return result;
  }, [assignmentHistoryBySessionId, rawSessions]);


  // Conflict detection: same therapist overlapping in time, or same patient overlapping
  const { conflictIds, conflictPairs } = useMemo(() => {
    const ids = new Set<number>();
    const pairs: ConflictPair[] = [];
    // Bucket by therapist first -- a conflict can only occur between two tiles sharing the same
    // therapistId, so comparing every pair across the whole day (O(n^2)) wastes work comparing
    // tiles that could never conflict. Only pairs within the same bucket need checking.
    const byTherapist = new Map<number, SessionTileData[]>();
    tiles.forEach((t) => {
      if (isCanceledStatus(t.status)) return;
      if (t.therapistId == null) return;
      const arr = byTherapist.get(t.therapistId) ?? [];
      arr.push(t);
      byTherapist.set(t.therapistId, arr);
    });
    byTherapist.forEach((arr) => {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i];
          const b = arr[j];
          if (sessionsOverlap(a.slotIndex, a.slotSpan, b.slotIndex, b.slotSpan)) {
            const isMatchingGroupOrConcurrent = a.deliveryMode === b.deliveryMode && (a.deliveryMode === "group" || a.deliveryMode === "concurrent");
            if (!isMatchingGroupOrConcurrent) {
              ids.add(a.id);
              ids.add(b.id);
              pairs.push({
                id: `t-${a.id}-${b.id}`,
                type: "therapist",
                sessionA: a,
                sessionB: b,
              });
            }
          }
        }
      }
    });
    const byPatient = new Map<number, SessionTileData[]>();
    tiles.forEach((t) => {
      if (isCanceledStatus(t.status)) return;
      const arr = byPatient.get(t.patientId) ?? [];
      arr.push(t);
      byPatient.set(t.patientId, arr);
    });
    byPatient.forEach((arr) => {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          if (sessionsOverlap(arr[i].slotIndex, arr[i].slotSpan, arr[j].slotIndex, arr[j].slotSpan)) {
            ids.add(arr[i].id);
            ids.add(arr[j].id);
            pairs.push({
              id: `p-${arr[i].id}-${arr[j].id}`,
              type: "patient",
              sessionA: arr[i],
              sessionB: arr[j],
            });
          }
        }
      }
    });
    return { conflictIds: ids, conflictPairs: pairs };
  }, [tiles]);

  // Keep delivered and projected minutes separate. Completed minutes drive actual progress;
  // still-scheduled minutes extend the projection to show whether more time is needed by week end.
  const { weekMinsByPatient, projectedWeekMinsByPatient } = useMemo(() => {
    const completedMap = new Map<number, number>();
    const projectedMap = new Map<number, number>();
    boardPatients.forEach((p) => {
      if (p.isRoomPlaceholder) return;
      const bounds = getPatientWeekBounds(p.admissionDate, day);
      const patientSessions = weekSessions.filter((s) => {
        if (s.patientId !== p.id) return false;
        if (isMissedStatus(s.status) || isCanceledStatus(s.status) || s.therapyType === "Block") return false;
        const sessionStart = new Date(s.startTime);
        return sessionStart >= bounds.start && sessionStart <= bounds.end;
      });
      const completed = patientSessions
        .filter((session) => session.status === "completed")
        .reduce((sum, session) => sum + (session.actualDurationMinutes ?? session.durationMinutes), 0);
      const pending = patientSessions
        .filter((session) => session.status === "scheduled")
        .reduce((sum, session) => sum + session.durationMinutes, 0);
      completedMap.set(p.id, completed);
      projectedMap.set(p.id, completed + pending);
    });
    return {
      weekMinsByPatient: completedMap,
      projectedWeekMinsByPatient: projectedMap,
    };
  }, [boardPatients, weekSessions, day]);

  // How many active (non-discharged) patients are below their weekly target
  const patientsUnderTarget = useMemo(() => {
    return boardPatients.filter((p) => {
      if (p.isRoomPlaceholder) return false;
      if (teamFilter !== "all" && p.teamId !== teamFilter) return false;
      const mins = projectedWeekMinsByPatient.get(p.id) ?? 0;
      const target = p.weeklyMinuteTarget ?? DEFAULT_WEEKLY_MINUTE_TARGET;
      return mins < target;
    });
  }, [boardPatients, projectedWeekMinsByPatient, teamFilter]);

  // Therapist -> team map for filtering
  const therapistTeam = useMemo(() => {
    const map = new Map<number, number | null>();
    therapists.forEach((t) => map.set(t.id, t.teamId));
    return map;
  }, [therapists]);

  // Apply view filter to tiles
  const visibleTiles = useMemo(() => {
    return tiles.filter((t) => {
      if (filter !== "all" && t.therapyType !== filter) return false;
      return true;
    });
  }, [tiles, filter]);

  // Group flags by patient
  const flagsByPatient = useMemo(() => {
    const map = new Map<number, { id: number; flagType: FlagType; date: Date | string }[]>();
    flags.forEach((f) => {
      const arr = map.get(f.patientId) ?? [];
      arr.push({ id: f.id, flagType: f.flagType as FlagType, date: f.date });
      map.set(f.patientId, arr);
    });
    return map;
  }, [flags]);

  // Set of patient IDs who had therapy in the last 2 days (or scheduled today)
  const recentTherapyPatientIds = useMemo(() => {
    const set = new Set<number>();
    weekSessions.forEach((s) => {
      if (s.therapyType === "Block" || isMissedStatus(s.status) || isCanceledStatus(s.status)) return;
      const diff = differenceInDays(day, new Date(s.startTime));
      if (diff >= 0 && diff <= 2) {
        set.add(s.patientId);
      }
    });
    return set;
  }, [weekSessions, day]);

  // Therapist lookups as a memoized Map instead of an Array#find per call -- also gives
  // therapistName/therapistColor stable function identity (only changes when `therapists`
  // itself changes), which matters once callers of these are passed as memoized child props.
  const therapistById = useMemo(() => {
    const map = new Map<number, (typeof therapists)[number]>();
    therapists.forEach((t) => map.set(t.id, t));
    return map;
  }, [therapists]);
  const therapistName = useCallback(
    (id: number | null) => (id != null ? therapistById.get(id)?.name : undefined),
    [therapistById],
  );
  const therapistColor = useCallback(
    (id: number | null) => (id != null ? therapistById.get(id)?.color : undefined),
    [therapistById],
  );

  const checkDoubleBooking = useCallback((therapistId: number | null, deliveryMode: string, startTime: Date, endTime: Date, excludeSessionId?: number): string | null => {
    if (!therapistId) return null;

    const therapistOverlap = tiles.find(t => {
      if (t.therapistId !== therapistId || t.id === excludeSessionId || isCanceledStatus(t.status)) return false;

      const isMatchingGroupOrConcurrent = t.deliveryMode === deliveryMode && (deliveryMode === "group" || deliveryMode === "concurrent");
      if (isMatchingGroupOrConcurrent) return false;

      const tStart = slotIndexToDate(day, t.slotIndex);
      const tEnd = new Date(tStart.getTime() + t.durationMinutes * 60000);
      return tStart < endTime && tEnd > startTime;
    });
    if (therapistOverlap) {
      const pName = patients.find(p => p.id === therapistOverlap.patientId)?.name || "another patient";
      return `${therapistName(therapistId)} is already scheduled with ${pName} at this time. Do you want to double-book them anyway?`;
    }
    return null;
  }, [tiles, day, patients, therapistName]);

  const checkTherapistAvailability = useCallback((therapistId: number | null, startTime: Date, endTime: Date): string | null => {
    if (!therapistId) return null;
    const therapist = therapistById.get(therapistId);
    if (!therapist) return null;

    const dayIdx = startTime.getDay();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const formatTime = (time: string) => {
      const [h, m] = time.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
    };

    let isWorking = true;
    let workStart = therapist.workStartTime;
    let workEnd = therapist.workEndTime;

    if ((therapist as any).workHours) {
      try {
        const parsed = JSON.parse((therapist as any).workHours);
        const daySchedule = parsed[String(dayIdx)];
        if (daySchedule) {
          isWorking = !!daySchedule.active;
          workStart = daySchedule.start;
          workEnd = daySchedule.end;
        }
      } catch (e) {}
    } else if (therapist.workDays) {
      const days = therapist.workDays.split(',').map(Number);
      isWorking = days.includes(dayIdx);
    }

    if (!isWorking) {
      return `${therapist.name} is not scheduled to work on ${dayNames[dayIdx]}.`;
    }

    if (workStart && workEnd) {
      const sessionStartMins = startTime.getHours() * 60 + startTime.getMinutes();
      const sessionEndMins = endTime.getHours() * 60 + endTime.getMinutes();

      const [wsH, wsM] = workStart.split(':').map(Number);
      const workStartMins = wsH * 60 + wsM;
      const [weH, weM] = workEnd.split(':').map(Number);
      const workEndMins = weH * 60 + weM;

      if (sessionStartMins < workStartMins || sessionEndMins > workEndMins) {
        return `${therapist.name}'s hours on ${dayNames[dayIdx]} are ${formatTime(workStart)} to ${formatTime(workEnd)}. This session falls outside their shift.`;
      }
    }
    return null;
  }, [therapistById]);

  // Lunch (12:00-1:00) is bookable, but flagged as an override warning rather than silently
  // allowed -- staff should notice they're cutting into it, not just get it by accident. Pure
  // function of its arguments (no component state), so it's hoisted as a stable module-level
  // function rather than recreated every render.
  const checkLunchOverlap = checkLunchOverlapPure;

  const processWarnings = useCallback((warnings: (string | null | undefined)[], onComplete: () => void) => {
    const activeWarnings = warnings.filter(Boolean) as string[];
    if (activeWarnings.length === 0) {
      onComplete();
      return;
    }
    let currentIndex = 0;
    const showNext = () => {
      if (currentIndex >= activeWarnings.length) {
        setOverrideWarning(null);
        onComplete();
      } else {
        setOverrideWarning({
          message: activeWarnings[currentIndex],
          onConfirm: () => {
            currentIndex++;
            showNext();
          },
        });
      }
    };
    showNext();
  }, [setOverrideWarning]);

  // Tiles per patient row, keyed by start slot. Reuses the previous merged object when the
  // underlying tile and its conflict flag haven't changed, so the memoized GridCell/SessionTile
  // below only re-render for the one slot that actually changed.
  const tileWithConflictCacheRef = useRef(new Map<string, { source: SessionTileData; hasConflict: boolean; merged: SessionTileData }>());
  const tilesByPatientSlot = useMemo(() => {
    const cache = tileWithConflictCacheRef.current;
    const nextCache = new Map<string, { source: SessionTileData; hasConflict: boolean; merged: SessionTileData }>();
    const map = new Map<string, SessionTileData>();
    visibleTiles.forEach((t) => {
      const key = `${t.patientId}-${t.slotIndex}`;
      const hasConflict = conflictIds.has(t.id);
      const cached = cache.get(key);
      const merged = cached && cached.source === t && cached.hasConflict === hasConflict
        ? cached.merged
        : { ...t, hasConflict };
      nextCache.set(key, { source: t, hasConflict, merged });
      map.set(key, merged);
    });
    tileWithConflictCacheRef.current = nextCache;
    return map;
  }, [visibleTiles, conflictIds]);

  // Per-patient session lists, for PatientDayQuickView's popover -- reuses the previous array
  // reference for a patient whose own sessions haven't changed, so passing this into the
  // memoized PatientRow doesn't force every row to re-render just because some other patient's
  // session moved (tiles/visibleTiles are whole-day arrays and change reference on any edit).
  const tilesByPatientRef = useRef(new Map<number, SessionTileData[]>());
  const tilesByPatient = useMemo(() => {
    const grouped = new Map<number, SessionTileData[]>();
    tiles.forEach((t) => {
      const arr = grouped.get(t.patientId);
      if (arr) arr.push(t);
      else grouped.set(t.patientId, [t]);
    });
    const prev = tilesByPatientRef.current;
    grouped.forEach((arr, patientId) => {
      const prevArr = prev.get(patientId);
      if (prevArr && prevArr.length === arr.length && prevArr.every((t, i) => t === arr[i])) {
        grouped.set(patientId, prevArr);
      }
    });
    tilesByPatientRef.current = grouped;
    return grouped;
  }, [tiles]);

  // Cells occupied by a multi-slot tile (so we don't render an add button there)
  const occupiedCells = useMemo(() => {
    const set = new Set<string>();
    visibleTiles.forEach((t) => {
      for (let i = 1; i < t.slotSpan; i++) {
        set.add(`${t.patientId}-${t.slotIndex + i}`);
      }
    });
    return set;
  }, [visibleTiles]);

  // Total daily minutes per patient (completed or scheduled, not missed or block). Sourced from
  // `tiles`, not `visibleTiles` -- this is the patient's true daily total and must not shrink
  // when the discipline filter (PT/OT/SLP/Eval/Block toggle) is narrowed to one type.
  const dailyMinutesByPatient = useMemo(() => {
    const map = new Map<number, number>();
    tiles.forEach(t => {
      if ((t.status !== "scheduled" && t.status !== "completed") || t.therapyType === "Block") return;
      // If completed, use actualDurationMinutes if provided
      const mins = t.status === "completed" ? (t.actualDurationMinutes ?? t.durationMinutes) : t.durationMinutes;
      map.set(t.patientId, (map.get(t.patientId) || 0) + mins);
    });
    return map;
  }, [tiles]);

  // Session count per patient, for the team-section header's session count -- built once per
  // `tiles` change instead of re-filtering the full tile list for every patient on every render.
  const sessionCountByPatient = useMemo(() => {
    const map = new Map<number, number>();
    tiles.forEach((t) => map.set(t.patientId, (map.get(t.patientId) ?? 0) + 1));
    return map;
  }, [tiles]);

  const sensors = useSensors(
    // Leave enough movement tolerance that a slightly shaky single click still opens the
    // session editor; deliberate movement beyond this threshold starts a drag.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );



  // Session dialog handlers -- useCallback so these keep a stable identity across renders,
  // otherwise every memoized PatientRow/GridCell down the tree would see a "new" prop on every
  // render and re-render regardless of React.memo.
  const openNewSession = useCallback((patientId: number, slotIndex: number) => {
    setSessionDraft({
      patientId,
      therapyType: "PT",
      therapistId: canEdit ? null : currentTherapistId,
      slotIndex,
      durationMinutes: 30,
      deliveryMode: "individual",
      status: "scheduled",
      notes: "",
    });
    setSessionDialogOpen(true);
  }, [canEdit, currentTherapistId, setSessionDraft, setSessionDialogOpen]);

  const openEditSession = useCallback((tile: SessionTileData) => {
    setSessionDraft({
      id: tile.id,
      patientId: tile.patientId,
      therapyType: tile.therapyType,
      therapistId: tile.therapistId,
      slotIndex: tile.slotIndex,
      durationMinutes: tile.durationMinutes,
      actualDurationMinutes: tile.actualDurationMinutes ?? null,
      deliveryMode: tile.deliveryMode || "individual",
      status: tile.status || "scheduled",
      missedReason: tile.missedReason || undefined,
      notes: tile.notes ?? "",
    });
    setSessionDialogOpen(true);
  }, [setSessionDraft, setSessionDialogOpen]);

  const handleResizeSession = useCallback((sessionId: number, newDurationMinutes: number) => {
    if (!canEdit) return;
    const session = rawSessions.find(s => s.id === sessionId);
    if (!session) return;

    const tile = tiles.find(t => t.id === sessionId);
    if (!tile) return;

    const slotsNeeded = newDurationMinutes / 30;
    if (tile.slotIndex + slotsNeeded > TIME_SLOTS.length) {
      toast.error("Session exceeds clinical hours (6 PM limit)");
      return;
    }

    const start = new Date(session.startTime);
    const end = new Date(start.getTime() + newDurationMinutes * 60000);

    const doUpdate = () => {
      updateSession.mutate({
        id: session.id,
        patientId: session.patientId,
        startTime: start,
        endTime: end,
        durationMinutes: newDurationMinutes,
        ignoreConflicts: true,
      });
    };

    const warnings = [checkLunchOverlap(start, end), checkTherapistAvailability(session.therapistId, start, end), checkDoubleBooking(session.therapistId, session.deliveryMode, start, end, session.id)];
    processWarnings(warnings, doUpdate);
  }, [rawSessions, tiles, checkTherapistAvailability, checkDoubleBooking, processWarnings, updateSession.mutate]);

  // Books a slot proposed by this morning's auto-generated gap-fill digest directly, without
  // opening the full session dialog -- one click from the "At Risk" popover in BoardHeader.
  function quickBookDigestSlot(patientId: number, slot: { startTime: string; durationMinutes: number; therapistId: number | null; therapyType: "PT" | "OT" | "SLP" }) {
    if (!requireEdit()) return;
    const start = new Date(slot.startTime);
    const end = new Date(start.getTime() + slot.durationMinutes * 60000);

    const doBook = () => {
      createSession.mutate({
        patientId,
        therapyType: slot.therapyType,
        therapistId: slot.therapistId,
        startTime: start,
        endTime: end,
        durationMinutes: slot.durationMinutes,
        notes: "Booked from morning digest",
        ignoreConflicts: true,
      });
    };

    const warnings = [checkLunchOverlap(start, end), checkTherapistAvailability(slot.therapistId, start, end), checkDoubleBooking(slot.therapistId, "individual", start, end)];
    processWarnings(warnings, doBook);
  }

  function saveSession(value: SessionFormValue) {
    const managesOwnSession = canEdit;
    const chartOnly = Boolean(value.id) && role === "staff" && canChart && value.therapistId === currentTherapistId;
    if (!managesOwnSession && !chartOnly) {
      toast.error("You can only change sessions assigned to you.");
      return;
    }
    const start = slotIndexToDate(day, value.slotIndex);
    const end = new Date(start.getTime() + value.durationMinutes * 60000);

    const doSave = () => {
      if (value.id) {
        updateSession.mutate(chartOnly ? {
          id: value.id,
          actualDurationMinutes: value.actualDurationMinutes ?? undefined,
          notes: value.notes,
          status: value.status,
          missedReason: value.missedReason,
        } : {
          id: value.id,
          therapyType: value.therapyType,
          therapistId: value.therapistId,
          startTime: start,
          endTime: end,
          durationMinutes: value.durationMinutes,
          actualDurationMinutes: value.actualDurationMinutes ?? undefined,
          deliveryMode: value.deliveryMode,
          notes: value.notes,
          status: value.status,
          missedReason: value.missedReason,
          ignoreConflicts: true,
        }, {
          onSuccess: () => setSessionDialogOpen(false),
        });
      } else {
        createSession.mutate({
          patientId: value.patientId,
          therapyType: value.therapyType,
          therapistId: value.therapistId,
          startTime: start,
          endTime: end,
          durationMinutes: value.durationMinutes,
          deliveryMode: value.deliveryMode,
          notes: value.notes,
          status: value.status,
          missedReason: value.missedReason,
          ignoreConflicts: true,
        }, {
          onSuccess: () => setSessionDialogOpen(false),
        });
      }
    };

    // Override warnings are for creating or rescheduling work, not documenting work that
    // already happened. A status-only change (Completed/Missed), note edit, or actual-minutes
    // update must save immediately even when the original appointment sits outside a later
    // edited shift definition.
    const original = value.id
      ? rawSessions.find((session) => session.id === value.id)
      : undefined;
    const scheduleChanged = !original
      || dateToSlotIndex(new Date(original.startTime)) !== value.slotIndex
      || original.durationMinutes !== value.durationMinutes
      || original.therapistId !== value.therapistId
      || (original.deliveryMode || "individual") !== value.deliveryMode;

    if (value.id && !scheduleChanged) {
      doSave();
      return;
    }

    const warnings = [checkLunchOverlap(start, end), checkTherapistAvailability(value.therapistId, start, end), checkDoubleBooking(value.therapistId, value.deliveryMode, start, end, value.id)];
    processWarnings(warnings, doSave);
  }

  async function savePatient(value: PatientFormValue): Promise<boolean> {
    if (!requireEdit()) return false;
    const common = {
      mrn: value.mrn.trim().toUpperCase(),
      roomNumber: value.roomNumber.trim(),
      name: value.name.trim(),
      notes: value.notes.trim(),
      isDischarged: value.isDischarged,
      admissionDate: value.admissionDate || undefined,
      estimatedDischargeDate: value.estimatedDischargeDate || undefined,
      actualDischargeDate: value.actualDischargeDate || undefined,
      weeklyMinuteTarget: value.weeklyMinuteTarget ?? DEFAULT_WEEKLY_MINUTE_TARGET,
      teamId: value.teamId ?? null,
    };
    try {
    if (value.id && !value.isRoomPlaceholder) {
      await updatePatient.mutateAsync({
        id: value.id,
        ...common,
        previousAdmissionId: value.previousAdmissionId ?? undefined,
        isRoomPlaceholder: false,
      });
    } else {
      const newPatient = await createPatient.mutateAsync({
        ...common,
        previousAdmissionId: value.previousAdmissionId ?? undefined,
      });
      if (value.sessionTime && value.sessionTime !== "none" && value.sessionType && value.sessionDuration) {
        const sessionStart = slotIndexToDate(day, Number(value.sessionTime));
        createSession.mutate({
          patientId: newPatient.id,
          therapyType: value.sessionType,
          startTime: sessionStart,
          endTime: new Date(sessionStart.getTime() + value.sessionDuration * 60000),
          durationMinutes: value.sessionDuration,
          therapistId: value.sessionTherapist,
          notes: "",
        });
      }
    }
      return true;
    } catch {
      return false;
    }
  }

  async function handleSnapshot(note?: string) {
    if (!requireEdit()) return null;
    return saveSnapshot.mutateAsync({ date: day, note });
  }

  async function handleCopyDay() {
    if (!requireEdit()) return null;
    return copyDayToNextDay.mutateAsync({ date: day });
  }

  // Group patients by team and filter based on teamFilter selection
  const patientsBySection = useMemo(() => {
    const sectionsToRender = teamFilter === "all" ? teams : teams.filter(t => t.id === teamFilter);
    const result = sectionsToRender.map((section) => ({
      ...section,
      patients: boardPatients.filter((p) => p.teamId === section.id),
    }));

    if (teamFilter === "all") {
      const unassigned = boardPatients.filter(p => !p.teamId);
      if (unassigned.length > 0) {
        result.push({
          id: 0,
          name: "Unassigned",
          color: "#94a3b8",
          createdAt: new Date(),
          patients: unassigned
        });
      }
    }
    return result;
  }, [boardPatients, teams, teamFilter]);

  const { customCollisionDetection, handleDragStart, handleDragEnd, handleDragCancel } = useBoardDnd({
    day,
    patientsBySection,
    setActiveDrag,
    setActiveDragPatient,
    reorderPatient,
    updateSession,
    checkLunchOverlap,
    checkTherapistAvailability,
    checkDoubleBooking,
    processWarnings,
    canEdit,
  });


  const toggleSection = useCallback((id: number) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [setCollapsedSections]);

  // Hoisted out of the patient .map() below -- one stable function shared by every row instead of
  // a fresh closure allocated per patient on every render.
  const handleToggleFlag = useCallback(async (patientId: number, flag: FlagType, active: boolean) => {
    if (!canEdit) return;
    await toggleFlag.mutateAsync({ patientId, flagType: flag, date: day, active });
  }, [toggleFlag.mutateAsync, day, canEdit]);

  const handleCopyPatientSessions = useCallback((patientId: number) => {
    if (!requireEdit()) return;
    copyPatientSessions.mutate({ patientId, date: day });
  }, [copyPatientSessions.mutate, day, requireEdit]);

  const totalSessions = tiles.length;
  const conflictCount = conflictIds.size;
  const isBoardLoading =
    patientsQuery.isLoading || sessionsQuery.isLoading || therapistsQuery.isLoading;
  const isBoardRefreshing = !isBoardLoading && (
    patientsQuery.isFetching || sessionsQuery.isFetching || therapistsQuery.isFetching ||
    teamsQuery.isFetching || flagsQuery.isFetching
  );
  const isSaving =
    createSession.isPending || updateSession.isPending || deleteSession.isPending ||
    createPatient.isPending || updatePatient.isPending || reorderPatient.isPending || archivePatient.isPending ||
    restorePatient.isPending || toggleFlag.isPending || saveSnapshot.isPending ||
    createTherapist.isPending || updateTherapist.isPending || archiveTherapist.isPending ||
    restoreTherapist.isPending || copyDayToNextDay.isPending || copyPatientSessions.isPending ||
    completeAllSessions.isPending || completeOwnSession.isPending || undoOwnCompletion.isPending;
  const boardError =
    patientsQuery.error || sessionsQuery.error || therapistsQuery.error || teamsQuery.error ||
    flagsQuery.error || createSession.error || updateSession.error || deleteSession.error ||
    createPatient.error || updatePatient.error || archivePatient.error || restorePatient.error ||
    toggleFlag.error || saveSnapshot.error || createTherapist.error || updateTherapist.error ||
    archiveTherapist.error || restoreTherapist.error || copyDayToNextDay.error || copyPatientSessions.error ||
    completeAllSessions.error || completeOwnSession.error || undoOwnCompletion.error;
  const mobilePatients = patientsBySection
    .flatMap((section) => section.patients)
    .filter((patient) => !patient.isRoomPlaceholder);
  const mobilePatientIds = new Set(mobilePatients.map((patient) => patient.id));
  const mobileSessions = visibleTiles.filter((session) => mobilePatientIds.has(session.patientId));
  const hasVisiblePatients = patientsBySection.some((section) => section.patients.length > 0);
  const isBoardUnavailable = Boolean(boardError) && patientsQuery.data === undefined;
  const needsAccountSetup = role !== null && !hasBoardAccess;
  const sessionDischargeFlag = sessionDraft
    ? (flagsByPatient.get(sessionDraft.patientId) ?? []).find((flag) => flag.flagType === "DC")
    : undefined;
  const sessionDischargeAt = sessionDischargeFlag
    && formatDateKey(new Date(sessionDischargeFlag.date)) === formatDateKey(day)
      ? new Date(sessionDischargeFlag.date)
      : null;

  return (
    <div className="min-h-screen bg-transparent">
      <BoardHeader
        day={day}
        setDay={setDay}
        filter={filter}
        setFilter={setFilter}
        teamFilter={teamFilter}
        setTeamFilter={setTeamFilter}
        teams={teams}
        patientsUnderTarget={patientsUnderTarget}
        weekMinsByPatient={weekMinsByPatient}
        projectedWeekMinsByPatient={projectedWeekMinsByPatient}
        conflictCount={conflictCount}
        conflictPairs={conflictPairs}
        therapists={therapists}
        patients={patients}
        jumpToPatient={jumpToPatient}
        setPanelOpen={setPanelOpen}
        setStaffPanelOpen={setStaffPanelOpen}
        setWeeklyMinutesPanelOpen={setWeeklyMinutesPanelOpen}
        setAskSchedulerPanelOpen={setAskSchedulerPanelOpen}
        setHistoryOpen={setHistoryOpen}
        setDataAnalysisOpen={setDataAnalysisOpen}
        handleSnapshot={handleSnapshot}
        mySchedTherapist={mySchedTherapist}
        setMySchedTherapist={setMySchedTherapist}
        tiles={tiles}
        sourceSessions={rawSessions}
        handleCopyDay={handleCopyDay}
        digestByPatientId={digestByPatientId}
        onBookSuggestion={quickBookDigestSlot}
        onOpenSickCall={() => setSickCallModalOpen(true)}
        onOpenComplianceSentinel={() => setComplianceSentinelOpen(true)}
        onOpenPredictiveStaffing={() => setPredictiveStaffingOpen(true)}
        onOpenProductivityHub={() => {
          setProductivityHubTherapistId(null);
          setProductivityHubViewMode("admin");
          setProductivityHubOpen(true);
        }}
        onViewStats={setStatsTherapistId}
        canCompleteAll={role === "admin" || role === "team_lead" || role === "staff"}
        completionSessionCount={!canEdit ? tiles.filter((tile) => tile.therapistId === currentTherapistId && tile.therapyType !== "Block" && tile.status === "scheduled").length : undefined}
        personalCompletion={!canEdit}
        isCompletingAllSessions={completeAllSessions.isPending}
        onCompleteAllSessions={() => completeAllSessions.mutateAsync({ date: day })}
      />

      {/* Board */}
      <main className="space-y-4 p-3 sm:p-5">
        {!needsAccountSetup && <BoardStatusSummary
          conflictCount={conflictCount}
          isLoading={isBoardLoading}
          isRefreshing={isBoardRefreshing}
          isSaving={isSaving}
          errorMessage={boardError?.message}
          onRetry={() => {
            createSession.reset();
            updateSession.reset();
            deleteSession.reset();
            createPatient.reset();
            updatePatient.reset();
            archivePatient.reset();
            restorePatient.reset();
            toggleFlag.reset();
            saveSnapshot.reset();
            createTherapist.reset();
            updateTherapist.reset();
            archiveTherapist.reset();
            restoreTherapist.reset();
            copyDayToNextDay.reset();
            copyPatientSessions.reset();
            completeAllSessions.reset();
            completeOwnSession.reset();
            undoOwnCompletion.reset();
            if (!hasBoardAccess) return;
            void Promise.all([
              patientsQuery.refetch(), sessionsQuery.refetch(), therapistsQuery.refetch(),
              teamsQuery.refetch(), flagsQuery.refetch(), weekSessionsQuery.refetch(),
            ]);
          }}
          onReviewConflicts={conflictPairs[0] ? () => jumpToPatient(conflictPairs[0].sessionA.patientId) : undefined}
        />}
        <TeamHuddle day={day} />
        {needsAccountSetup ? (
          <div className="rounded-xl border border-amber-300 bg-white px-5 py-12 text-center shadow-sm" role="status">
            <UserCircle2 className="mx-auto h-10 w-10 text-amber-700" />
            <h1 className="mt-3 text-lg font-bold text-slate-950">Your board access needs one setup step</h1>
            <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-slate-600">
              An administrator must connect your account to the correct staff profile before the full schedule can be displayed. A team assignment is not required.
            </p>
            <p className="mx-auto mt-3 max-w-lg text-xs font-semibold text-amber-800">No patient data was requested or exposed.</p>
          </div>
        ) : isBoardLoading ? (
          <div className="overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
            <div className="flex border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="h-3 w-20 animate-pulse rounded bg-slate-200" />
            </div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                <div className="h-8 w-44 animate-pulse rounded bg-slate-100" />
                <div className="h-7 flex-1 animate-pulse rounded bg-slate-50" />
              </div>
            ))}
          </div>
        ) : isBoardUnavailable ? (
          <div className="rounded-xl border border-rose-200 bg-white px-5 py-12 text-center shadow-sm">
            <AlertTriangle className="mx-auto h-10 w-10 text-rose-700" />
            <h1 className="mt-3 text-lg font-bold text-slate-950">Schedule unavailable</h1>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">We couldn't load enough information to safely display the board. Use Refresh board above when your connection is available.</p>
          </div>
        ) : (
        <>
        <MobileTodayList
          day={day}
          patients={mobilePatients}
          teams={teams}
          therapists={therapists}
          sessions={mobileSessions}
          conflictIds={conflictIds}
          canEdit={canEdit}
          onAddSession={openNewSession}
          onEditSession={openEditSession}
          onAddPatient={() => { setPatientDraft(null); setPatientDialogOpen(true); }}
        />
        <div className="hidden md:block">
        <DndContext
          sensors={canEdit ? sensors : []}
          collisionDetection={customCollisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="mx-auto flex h-[calc(100vh-11rem)] min-h-[420px] w-fit max-w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Keep the time ruler outside the vertical scroller so it can never move out
                of view. Its horizontal position follows the schedule below. */}
            <div ref={timeHeaderScrollRef} className="w-full shrink-0 overflow-hidden">
              <div className="min-w-max">
                <TimeHeaderRow />
              </div>
            </div>

            <div
              className="min-h-0 w-full flex-1 overflow-auto touch-pan-x overscroll-contain scroll-smooth"
              style={{ WebkitOverflowScrolling: "touch" }}
              onScroll={(event) => {
                if (timeHeaderScrollRef.current) {
                  timeHeaderScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
                }
              }}
            >
            <div className="min-w-max pb-16">
              {/* Team sections */}
              {!hasVisiblePatients ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <Users className="h-10 w-10 text-slate-300" />
                  <div>
                    <p className="text-base font-bold text-slate-900">No active admissions</p>
                    <p className="mt-1 text-sm text-slate-600">Add an admission to begin scheduling this team.</p>
                  </div>
                  {isAdmin && (
                    <Button
                      className="h-11"
                      onClick={() => { setPatientDraft(null); setPatientDialogOpen(true); }}
                    >
                      <Plus className="mr-2 h-4 w-4" /> Add admission
                    </Button>
                  )}
                </div>
              ) : (
                patientsBySection.map((section) => {
                  const isCollapsed = collapsedSections.has(section.id);
                  const sectionSessionCount = section.patients.reduce(
                    (acc, p) => acc + (sessionCountByPatient.get(p.id) ?? 0),
                    0,
                  );

                  return (
                    <TeamDroppable key={section.id} section={section}>
                      <TeamHeaderRow
                        section={section}
                        isCollapsed={isCollapsed}
                        sectionSessionCount={sectionSessionCount}
                        onToggle={toggleSection}
                        onAddPatient={(teamId) => {
                          setPatientDraft({ ...EMPTY_PATIENT, teamId });
                          setPatientDialogOpen(true);
                        }}
                      />

                      {/* Patient rows (collapsible) */}
                      {!isCollapsed && (
                        <SortableContext
                          items={section.patients.map(p => `patient-${p.id}`)}
                          strategy={verticalListSortingStrategy}
                        >
                          {section.patients.map((patient, rowIdx) => {
                            const pFlags = flagsByPatient.get(patient.id) ?? EMPTY_FLAGS;
                            const isDC = patient.isDischarged;
                            const isPlaceholder = patient.isRoomPlaceholder;
                            const isMedicalHold = !isPlaceholder && pFlags.some((f) => f.flagType === "Medical Hold");
                            
                            // Check if patient had therapy in the last 2 days (or has it scheduled today)
                            const hasTherapyRecent = recentTherapyPatientIds.has(patient.id);
                            const missedTherapyAlert = !isPlaceholder && !isDC && !isMedicalHold && !hasTherapyRecent;

                            // Missing Exit Eval Alert
                            let missingExitEvalAlert = false;
                            const estimatedDC = patient.estimatedDischargeDate;
                            if (estimatedDC && !isPlaceholder && !isDC) {
                               const dcDate = new Date(estimatedDC + "T00:00:00");
                               const dcDaysAway = differenceInDays(dcDate, day);
                               if (dcDaysAway >= 0 && dcDaysAway <= 2) {
                                  // Approaching discharge. Check if there is an Eval session on dcDate or dcDate - 1 day.
                                  const evalExists = upcomingSessions.some((s) => {
                                      if (s.patientId !== patient.id || !isEvaluationTherapyType(s.therapyType)) return false;
                                      const sDate = new Date(s.startTime);
                                      const diffToDC = differenceInDays(dcDate, startOfDay(sDate));
                                      return diffToDC === 0 || diffToDC === -1;
                                  });
                                  if (!evalExists) {
                                      missingExitEvalAlert = true;
                                  }
                               }
                            }

                            return (
                              <PatientRow
                                key={patient.id}
                                patient={patient}
                                canEdit={canEdit}
                                isAdmin={isAdmin}
                                canChart={canChart}
                                viewerTherapistId={currentTherapistId}
                                rowIdx={rowIdx}
                                day={day}
                                tiles={tilesByPatient.get(patient.id) ?? EMPTY_TILES}
                                therapists={therapists}
                                pFlags={pFlags}
                                weekMinsByPatient={weekMinsByPatient}
                                projectedWeekMinsByPatient={projectedWeekMinsByPatient}
                                tilesByPatientSlot={tilesByPatientSlot}
                                occupiedCells={occupiedCells}
                                dailyMinutesByPatient={dailyMinutesByPatient}
                                missedTherapyAlert={missedTherapyAlert}
                                missingExitEvalAlert={missingExitEvalAlert}
                                isDC={isDC}
                                isMedicalHold={isMedicalHold}
                                setPatientDraft={setPatientDraft}
                                setPatientDialogOpen={setPatientDialogOpen}
                                toggleFlag={handleToggleFlag}
                                copyPatientSessions={handleCopyPatientSessions}
                                isCopying={copyPatientSessions.isPending}
                                openNewSession={openNewSession}
                                openEditSession={openEditSession}
                                handleResizeSession={handleResizeSession}
                                therapistName={therapistName}
                                therapistColor={therapistColor}
                              />
                            );
                          })}
                        </SortableContext>
                      )}
                    </TeamDroppable>
                  );
                })
              )}
            </div>
            </div>
          </div>

          <DragOverlay>
            {activeDrag ? (
              <div
                style={{
                  height: 40,
                  width: activeDrag.slotSpan * SLOT_WIDTH,
                }}
              >
                <SessionTile
                  session={activeDrag}
                  therapistName={therapistName(activeDrag.therapistId)}
                  therapistColor={therapistColor(activeDrag.therapistId)}
                  slotWidth={SLOT_WIDTH}
                  isOverlay
                />
              </div>
            ) : activeDragPatient ? (
              <div className="flex w-52 cursor-grabbing items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-2 shadow-xl sm:w-72">
                <span className="truncate text-sm font-bold text-slate-800">{activeDragPatient.name}</span>
                <span className="shrink-0 inline-flex min-w-[2.5rem] justify-center rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-600">
                  {activeDragPatient.roomNumber}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        </div>
        </>
        )}

        <section aria-label="Schedule legend" className="mt-3 hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                <UserCircle2 className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-800">Schedule key</h2>
                <p className="text-[11px] text-slate-500">How to read the board at a glance</p>
              </div>
            </div>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold tabular-nums text-slate-700">
              {activePatientCount} active patient{activePatientCount === 1 ? "" : "s"}
            </span>
          </div>

          <div className="grid divide-y divide-slate-200 xl:grid-cols-[1fr_0.8fr_1.7fr] xl:divide-x xl:divide-y-0">
            <div className="min-w-0 px-4 py-3">
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Tile labels</p>
              <div className="flex flex-wrap gap-1.5">
                {["PT", "OT", "SLP"].map((type) => (
                  <span key={type} className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-extrabold text-slate-800">
                    {type}
                  </span>
                ))}
                <span className="inline-flex h-7 items-center rounded-md border border-violet-200 bg-violet-50 px-2.5 text-xs font-extrabold text-violet-800">Eval</span>
                <span className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-slate-200 px-2.5 text-xs font-extrabold text-slate-700">Block</span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Evaluations include the discipline on the tile, such as PT Eval.</p>
            </div>

            <div className="min-w-0 px-4 py-3">
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Color</p>
              <div className="flex items-center gap-2.5">
                <span className="relative h-8 w-12 shrink-0 rounded-md border border-sky-300 bg-sky-100 shadow-sm">
                  <span className="absolute inset-y-0 left-0 w-1 rounded-l-md bg-sky-600" />
                </span>
                <p className="text-xs font-semibold leading-snug text-slate-700">Tile color identifies the assigned therapist.</p>
              </div>
            </div>

            <div className="min-w-0 px-4 py-3">
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Session state</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <span className="h-3 w-3 rounded-sm border border-blue-300 bg-blue-100" /> Scheduled
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" strokeWidth={2.5} /> Completed
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <XCircle className="h-4 w-4 text-rose-600" strokeWidth={2.5} /> Missed
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <LogOut className="h-4 w-4 text-slate-500" strokeWidth={2.5} /> Canceled — D/C
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <span className="h-4 w-5 rounded-sm border-l-2 border-l-rose-500 bg-slate-200 bg-[repeating-linear-gradient(135deg,rgba(100,116,139,0.18),rgba(100,116,139,0.18)_3px,transparent_3px,transparent_6px)]" /> After D/C cutoff
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <AlertTriangle className="h-4 w-4 text-amber-600" strokeWidth={2.5} /> Needs review
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Dialogs */}
      <Suspense fallback={null}>
      {sessionDialogOpen && <SessionDialog
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
        initial={sessionDraft}
        patients={patients}
        therapists={therapists}
        referenceDate={day}
        previousTherapistName={sessionDraft?.id ? assignmentHistoryBySessionId.get(sessionDraft.id)?.previousTherapistName : undefined}
        onSave={saveSession}
        canComplete={role === "viewer" && currentTherapistId != null && sessionDraft?.therapistId === currentTherapistId && sessionDraft?.status === "scheduled"}
        isCompleting={completeOwnSession.isPending}
        onComplete={(id) => completeOwnSession.mutate({ id })}
        canUndoComplete={role === "viewer" && currentTherapistId != null && sessionDraft?.therapistId === currentTherapistId && sessionDraft?.status === "completed"}
        isUndoingCompletion={undoOwnCompletion.isPending}
        onUndoComplete={(id) => undoOwnCompletion.mutate({ id })}
        dischargeAt={sessionDischargeAt}
        isUpdatingDischargeToday={toggleFlag.isPending}
        onSetDischargeTime={isAdmin || role === "team_lead" ? (value) => {
          if (!sessionDraft) return;
          toggleFlag.mutate(
            { patientId: sessionDraft.patientId, flagType: "DC", date: value ?? day, active: value !== null },
            { onSuccess: () => toast.success(value ? `D/C cutoff set for ${value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "D/C Today notice removed") },
          );
        } : undefined}
        onDelete={(id) => {
          if (!requireEdit()) return;
          deleteSession.mutate({ id });
          setSessionDialogOpen(false);
        }}
        readOnly={!(canEdit || (role === "staff" && canChart && currentTherapistId != null && sessionDraft?.therapistId === currentTherapistId))}
        chartOnly={role === "staff" && canChart && currentTherapistId != null && sessionDraft?.therapistId === currentTherapistId}
      />}

      {patientDialogOpen && <PatientDialog
        open={patientDialogOpen}
        onOpenChange={setPatientDialogOpen}
        initial={patientDraft}
        teams={teams}
        therapists={therapists}
        onSave={savePatient}
      />}

      {weeklyMinutesPanelOpen && <WeeklyMinutesPanel
        open={weeklyMinutesPanelOpen}
        onOpenChange={setWeeklyMinutesPanelOpen}
        referenceDate={day}
      />}
      {askSchedulerPanelOpen && (
        <AskSchedulerPanel
          open={askSchedulerPanelOpen}
          onOpenChange={setAskSchedulerPanelOpen}
          referenceDate={day}
        />
      )}

      {historyOpen && <BoardHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />}

      {dataAnalysisOpen && <DataAnalysisModal
        open={dataAnalysisOpen}
        onOpenChange={setDataAnalysisOpen}
        referenceDate={day}
        patients={(patientsQuery.data ?? []).filter((patient) => !patient.isRoomPlaceholder)}
        onEditPatient={(id) => {
          const patient = patientsQuery.data?.find(p => p.id === id);
          if (patient) {
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
              actualDischargeDate: patient.actualDischargeDate ?? "",
              weeklyMinuteTarget: patient.weeklyMinuteTarget ?? DEFAULT_WEEKLY_MINUTE_TARGET,
              teamId: patient.teamId ?? null,
              isRoomPlaceholder: patient.isRoomPlaceholder,
            });
            setPatientDialogOpen(true);
          }
        }}
      />}

      {panelOpen && <PatientPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        patients={patients}
        archivedPatients={archivedPatientsQuery.data ?? []}
        onAdd={(initialData) => {
          if (initialData) {
            setPatientDraft({
              mrn: initialData.mrn ?? "",
              previousAdmissionId: initialData.previousAdmissionId,
              roomNumber: initialData.roomNumber ?? "",
              name: initialData.name ?? "",
              notes: initialData.notes ?? "",
              isDischarged: false,
              weeklyMinuteTarget: DEFAULT_WEEKLY_MINUTE_TARGET,
              teamId: initialData.teamId ?? null,
            });
          } else {
            setPatientDraft(null);
          }
          setPatientDialogOpen(true);
        }}
        onEdit={(p) => {
          setPatientDraft({
            id: p.id,
            mrn: p.mrn ?? "",
            previousAdmissionId: p.previousAdmissionId,
            roomNumber: p.roomNumber,
            name: p.name,
            notes: p.notes ?? "",
            isDischarged: p.isDischarged,
            admissionDate: p.admissionDate ?? "",
            estimatedDischargeDate: p.estimatedDischargeDate ?? "",
            actualDischargeDate: p.actualDischargeDate ?? "",
            weeklyMinuteTarget: p.weeklyMinuteTarget ?? DEFAULT_WEEKLY_MINUTE_TARGET,
            teamId: p.teamId ?? null,
            isRoomPlaceholder: p.isRoomPlaceholder,
          });
          setPatientDialogOpen(true);
        }}
        onReadmit={(p) => {
          setPatientDraft({
            mrn: p.mrn ?? "",
            previousAdmissionId: p.id,
            roomNumber: "",
            name: p.name,
            notes: p.notes ?? "",
            isDischarged: false,
            admissionDate: "",
            estimatedDischargeDate: "",
            weeklyMinuteTarget: p.weeklyMinuteTarget ?? DEFAULT_WEEKLY_MINUTE_TARGET,
            teamId: p.teamId ?? null,
          });
          setPatientDialogOpen(true);
        }}
        onArchive={(id, reason) => {
          if (!requireAdmin()) return;
          archivePatient.mutate({ id, reason });
        }}
        onRestore={(id) => {
          if (!requireAdmin()) return;
          restorePatient.mutate({ id });
        }}
      />}

      {staffPanelOpen && <TherapistPanel
        open={staffPanelOpen}
        onOpenChange={setStaffPanelOpen}
        therapists={therapists}
        archivedTherapists={archivedTherapistsQuery.data ?? []}
        teams={teams}
        onAdd={(data) => {
          if (!requireAdmin()) return;
          createTherapist.mutate({
            name: data.name,
            email: data.email,
            teamId: data.teamId,
            therapyType: data.therapyType,
            employmentType: data.employmentType,
            weekendRotation: data.weekendRotation,
            ...data.schedule,
          });
        }}
        onEdit={(id, data) => {
          if (!requireAdmin()) return;
          updateTherapist.mutate({
            id,
            name: data.name,
            email: data.email,
            teamId: data.teamId,
            therapyType: data.therapyType,
            employmentType: data.employmentType,
            weekendRotation: data.weekendRotation,
            ...data.schedule,
          });
        }}
        onArchive={(id, reason) => {
          if (!requireAdmin()) return;
          archiveTherapist.mutate({ id, reason });
        }}
        onRestore={(id) => {
          if (!requireAdmin()) return;
          restoreTherapist.mutate({ id });
        }}
        onInviteAsUser={(email, role) => {
          if (!requireAdmin()) return;
          inviteUser.mutate({ email, role });
        }}
        onViewStats={setStatsTherapistId}
        onOpenProductivityHub={(tId?: number) => {
          setProductivityHubTherapistId(tId ?? null);
          setProductivityHubViewMode(tId ? "staff" : "admin");
          setProductivityHubOpen(true);
        }}
        onSendTomorrowAssignments={(therapistIds) => {
          if (!requireEdit()) return;
          sendTomorrowAssignments.mutate({ referenceDate: day, therapistIds });
        }}
        sendingTomorrowAssignments={sendTomorrowAssignments.isPending}
        sendingTherapistIds={sendTomorrowAssignments.isPending ? sendTomorrowAssignments.variables?.therapistIds ?? [] : []}
        onOpenWeekendStaffing={() => setWeekendStaffingOpen(true)}
      />}

      {weekendStaffingOpen && <WeekendStaffingModal
        open={weekendStaffingOpen}
        onOpenChange={setWeekendStaffingOpen}
        referenceDate={day}
      />}

      {productivityHubOpen && <ProductivityHubModal
        open={productivityHubOpen}
        onOpenChange={setProductivityHubOpen}
        therapists={therapists}
        date={day}
        initialTherapistId={productivityHubTherapistId}
        initialViewMode={productivityHubViewMode}
      />}

      {sickCallModalOpen && <SickCallModal
        open={sickCallModalOpen}
        onOpenChange={setSickCallModalOpen}
        therapists={therapists}
        day={day}
        onSuccess={() => {
          sessionsQuery.refetch();
        }}
        onViewStats={setStatsTherapistId}
      />}

      {statsTherapistId !== null && <StaffStatsModal
        open={statsTherapistId !== null}
        onOpenChange={(open) => {
          if (!open) setStatsTherapistId(null);
        }}
        therapistId={statsTherapistId}
        date={day}
      />}

      {complianceSentinelOpen && <ComplianceSentinelModal
        open={complianceSentinelOpen}
        onOpenChange={setComplianceSentinelOpen}
        day={day}
        onFixPatient={(patientId) => {
          jumpToPatient(patientId);
        }}
      />}

      {predictiveStaffingOpen && <PredictiveStaffingPanel
        open={predictiveStaffingOpen}
        onOpenChange={setPredictiveStaffingOpen}
        day={day}
      />}

      </Suspense>
      {/* Override Warning Modal */}
      <AlertDialog open={!!overrideWarning} onOpenChange={(open) => !open && setOverrideWarning(null)}>
        <AlertDialogContent className="sm:max-w-[425px] overflow-hidden rounded-2xl glass-panel p-6">
          <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-slate-100/40 pointer-events-none" />
          <div className="relative">
            <AlertDialogHeader className="mb-4">
              <AlertDialogTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-sky-600" />
                Schedule Override
              </AlertDialogTitle>
              <AlertDialogDescription>
                {overrideWarning?.message}
                <br /><br />
                <span className="font-medium text-slate-700">Are you sure you want to schedule this session anyway?</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-0 mt-6">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  if (overrideWarning) {
                    e.preventDefault();
                    overrideWarning.onConfirm();
                  }
                }}
                className="bg-sky-600 hover:bg-sky-700 font-bold"
              >
                Schedule Anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
  color,
  activeBg,
  activeFg,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
  activeBg?: string;
  activeFg?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={active && activeBg ? { backgroundColor: activeBg, color: activeFg } : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-all duration-150",
        active
          ? (!activeBg ? "bg-slate-100 text-slate-800 shadow-sm" : "")
          : "bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700",
      )}
    >
      {color ? (
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      ) : null}
      {children}
    </button>
  );
}
