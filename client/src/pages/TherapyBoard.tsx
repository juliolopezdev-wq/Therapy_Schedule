import { useEffect, useMemo, useRef, useState } from "react";
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
  ChevronLeft,
  ChevronRight,
  Plus,
  Users,
  UserRound,
  AlertTriangle,
  Calendar as CalendarIcon,
  History,
  LayoutGrid,
  Smartphone,
  Clock,
  Bot,
  Copy,
  CalendarClock,
  Sunset,
  BicepsFlexed,
  CheckCircle2,
  XCircle,
  UserCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
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
  THERAPY_TYPES,
  THERAPY_META,
  TIME_SLOTS,
  type TherapyType,
  type FlagType,
  isMissedStatus,
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
} from "@/lib/board";
import { SessionTile, type SessionTileData } from "@/components/board/SessionTile";
import { GridCell } from "@/components/board/GridCell";
import { FlagBadge, FlagToggle } from "@/components/board/StatusFlags";
import { PatientDayQuickView, printAllPatientSchedules } from "@/components/board/PatientDayQuickView";
import { BoardHeader } from "@/components/board/BoardHeader";
import { SessionDialog, type SessionFormValue } from "@/components/board/SessionDialog";
import { PatientDialog, type PatientFormValue } from "@/components/board/PatientDialog";
import { PatientPanel } from "@/components/board/PatientPanel";
import { TherapistPanel } from "@/components/board/TherapistPanel";
import { MySchedule } from "@/components/board/MySchedule";
import { BoardHistoryDialog } from "@/components/board/BoardHistoryDialog";
import { TargetReachedDialog, type WeekSessionRow } from "@/components/board/TargetReachedDialog";
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
import { WeeklyMinutesPanel } from "@/components/board/WeeklyMinutesPanel";
import { DataAnalysisModal } from "@/components/board/DataAnalysisModal";
import { AskSchedulerPanel } from "@/components/board/AskSchedulerPanel";
import { cn } from "@/lib/utils";
import { PatientDraggable } from "@/components/board/PatientDraggable";
import { TeamDroppable } from "@/components/board/TeamDroppable";
import { TimeHeaderRow } from "@/components/board/grid/TimeHeaderRow";
import { TeamHeaderRow } from "@/components/board/grid/TeamHeaderRow";
import { PatientRow } from "@/components/board/grid/PatientRow";
import { useBoardUI } from "@/hooks/useBoardUI";
import { useBoardDnd } from "@/hooks/useBoardDnd";

const SLOT_WIDTH = 72; // px per 30-min slot

import { getPatientWeekBounds } from "@/../../shared/weekUtils";

const BOARD_SECTIONS = [
  { id: 1, name: "Team One",   color: "#3b82f6" },
  { id: 2, name: "Team Two",   color: "#10b981" },
  { id: 3, name: "Team Three", color: "#f59e0b" },
] as const;

// For the EOW (End Of Week) column -- single-letter day labels, indexed by Date#getDay() (0=Sun..6=Sat).
const EOW_DAY_LETTERS = ["S", "M", "T", "W", "TH", "F", "S"];
const EOW_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const EMPTY_PATIENT: PatientFormValue = {
  roomNumber: "",
  name: "",
  notes: "",
  isDischarged: false,
  admissionDate: "",
  weeklyMinuteTarget: 900,
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

export default function TherapyBoard() {
  const utils = trpc.useUtils();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [teamFilter, setTeamFilter] = useState<number | "all">(1); // Default to Team One on load
  const [mySchedTherapist, setMySchedTherapist] = useState<number | null>(null);

  const [activeDrag, setActiveDrag] = useState<SessionTileData | null>(null);
  const [activeDragPatient, setActiveDragPatient] = useState<any | null>(null);
  
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
    targetAlertData,
    setTargetAlertData,
    overrideWarning,
    setOverrideWarning,
    collapsedSections,
    setCollapsedSections,
  } = useBoardUI();

  const jumpToPatient = (patientId: number) => {
    const patient = patientsQuery.data?.find((p) => p.id === patientId);
    if (patient) {
      if ((patient as any).teamId) {
        setCollapsedSections((prev) => {
          const next = new Set(prev);
          next.delete((patient as any).teamId);
          return next;
        });
      }
      setFilter("all");
      setTeamFilter("all");
      setTimeout(() => {
        const row = document.getElementById(`patient-row-${patientId}`);
        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
          row.classList.add("bg-amber-100/50", "transition-colors", "duration-500");
          setTimeout(() => row.classList.remove("bg-amber-100/50", "transition-colors", "duration-500"), 2000);
        }
      }, 100);
    }
  };

  // Seed teams once on mount
  const seedTeams = trpc.teams.seed.useMutation();
  useEffect(() => {
    seedTeams.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Queries
  const patientsQuery = trpc.patients.list.useQuery();
  const therapistsQuery = trpc.therapists.list.useQuery();
  const teamsQuery = trpc.teams.list.useQuery();
  const sessionsQuery = trpc.sessions.list.useQuery({ date: day });
  const weekSessionsQuery = trpc.sessions.listForDateRange.useQuery({ 
    startDate: subDays(day, 7),
    endDate: addDays(day, 7)
  });
  const flagsQuery = trpc.statusFlags.listForDate.useQuery({ date: day });
  const digestQuery = trpc.digest.today.useQuery();

  // Fetch sessions for the next 2 days to check for exit evals
  const upcomingSessionsQuery = trpc.sessions.listForDateRange.useQuery({
    startDate: day,
    endDate: addDays(day, 2),
  });

  const patients = patientsQuery.data ?? [];
  const therapists = therapistsQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const rawSessions = sessionsQuery.data ?? [];
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
    utils.patients.list.invalidate();
    utils.statusFlags.listForDate.invalidate();
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
    onSuccess: () => { toast.success("Session updated"); },
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
  const deletePatient = trpc.patients.delete.useMutation({ 
    onSuccess: () => { invalidateBoard(); toast.success("Patient removed"); }, 
    onError: (err) => toast.error(err.message) 
  });
  const toggleFlag = trpc.statusFlags.toggle.useMutation({
    onSuccess: (data, variables) => {
      invalidateBoard();
      // Taking a patient off DC status (readmission) but their old room is now occupied by
      // whoever's using it now -- the server left them on DC status rather than silently
      // duplicating the room. Open the edit dialog straight to this patient so staff can pick a
      // real open room right away instead of hunting for why the toggle didn't seem to take.
      if (data.roomConflict) {
        const patient = patients.find((p) => p.id === variables.patientId);
        toast.error(`Room ${data.roomConflict.roomNumber} is occupied by ${data.roomConflict.occupiedByName} -- assign a new room to complete this readmission.`);
        if (patient) {
          setPatientDraft({
            id: patient.id,
            roomNumber: "",
            name: patient.name,
            notes: patient.notes ?? "",
            isDischarged: false,
            admissionDate: (patient as any).admissionDate ?? "",
            estimatedDischargeDate: (patient as any).estimatedDischargeDate ?? "",
            weeklyMinuteTarget: (patient as any).weeklyMinuteTarget ?? 900,
            teamId: (patient as any).teamId ?? null,
          });
          setPatientDialogOpen(true);
        }
      }
    },
    onError: (err) => toast.error(err.message)
  });
  const saveSnapshot = trpc.history.save.useMutation({ 
    onSuccess: () => toast.success("Board snapshot saved"),
    onError: (err) => toast.error(err.message) 
  });
  const createTherapist = trpc.therapists.create.useMutation({
    onSuccess: () => utils.therapists.list.invalidate(),
  });
  const updateTherapist = trpc.therapists.update.useMutation({
    onSuccess: () => utils.therapists.list.invalidate(),
  });
  const deleteTherapist = trpc.therapists.delete.useMutation({
    onSuccess: () => utils.therapists.list.invalidate(),
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

  // Map sessions to tile data with slot positions
  const tiles: SessionTileData[] = useMemo(() => {
    return rawSessions.map((s) => {
      const start = new Date(s.startTime);
      const slotIndex = dateToSlotIndex(start);
      const slotSpan = durationToSlots(s.durationMinutes);
      return {
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
      };
    });
  }, [rawSessions]);


  // Conflict detection: same therapist overlapping in time, or same patient overlapping
  const { conflictIds, conflictPairs } = useMemo(() => {
    const ids = new Set<number>();
    const pairs: ConflictPair[] = [];
    const withTherapist = tiles.filter((t) => t.therapistId != null);
    for (let i = 0; i < withTherapist.length; i++) {
      for (let j = i + 1; j < withTherapist.length; j++) {
        const a = withTherapist[i];
        const b = withTherapist[j];
        if (
          a.therapistId === b.therapistId &&
          sessionsOverlap(a.slotIndex, a.slotSpan, b.slotIndex, b.slotSpan)
        ) {
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
    const byPatient = new Map<number, SessionTileData[]>();
    tiles.forEach((t) => {
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

  // Weekly minutes per patient (their own admission-anchored week, not a shared Mon-Sun). Must
  // count the same way dailyMinutesByPatient and the server's getWeeklyMinutesSummary do -- skip
  // missed sessions (isMissedStatus) and Block time (not real therapy), and use
  // actualDurationMinutes over durationMinutes once a session is completed. Previously this summed
  // raw durationMinutes for every row in range regardless of status/type, so a missed or Block
  // session inflated the "X/900" progress bar with minutes that were never actually delivered.
  const weekMinsByPatient = useMemo(() => {
    const map = new Map<number, number>();
    patients.forEach((p) => {
      if (p.isDischarged) return;
      const bounds = getPatientWeekBounds((p as any).admissionDate, day);
      const patientSessions = weekSessions.filter((s) => {
        if (s.patientId !== p.id) return false;
        if (isMissedStatus(s.status) || s.therapyType === "Block") return false;
        const sessionStart = new Date(s.startTime);
        return sessionStart >= bounds.start && sessionStart <= bounds.end;
      });
      const sum = patientSessions.reduce(
        (acc, curr) => acc + (curr.status === "completed" ? (curr.actualDurationMinutes ?? curr.durationMinutes) : curr.durationMinutes),
        0,
      );
      map.set(p.id, sum);
    });
    return map;
  }, [patients, weekSessions, day]);

  // How many active (non-discharged) patients are below their weekly target
  const patientsUnderTarget = useMemo(() => {
    return patients.filter((p) => {
      if (p.isDischarged) return false;
      if (teamFilter !== "all" && p.teamId !== teamFilter) return false;
      const mins = weekMinsByPatient.get(p.id) ?? 0;
      const target = (p as any).weeklyMinuteTarget ?? 900;
      return mins < target;
    });
  }, [patients, weekMinsByPatient, teamFilter]);

  // Fire a toast when a patient crosses from below to at/above their weekly target
  const prevWeekMinsRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    const prev = prevWeekMinsRef.current;
    patients.forEach((p) => {
      if (p.isDischarged) return;
      const target: number = (p as any).weeklyMinuteTarget ?? 900;
      const prevMins = prev.get(p.id) ?? 0;
      const currMins = weekMinsByPatient.get(p.id) ?? 0;
      if (prevMins < target && currMins >= target) {
        const bounds = getPatientWeekBounds((p as any).admissionDate, day);
        const patientWeekSessions: WeekSessionRow[] = weekSessions
          .filter((s) => {
            if (s.patientId !== p.id) return false;
            // Match weekMinsByPatient's own filter -- a missed or Block session was never
            // counted toward the total, so it can't be a valid "trim this to get under target"
            // recommendation below (TargetReachedDialog's buildRecommendations).
            if (isMissedStatus(s.status) || s.therapyType === "Block") return false;
            const sessionStart = new Date(s.startTime);
            return sessionStart >= bounds.start && sessionStart <= bounds.end;
          })
          .map((s) => ({
            id: s.id,
            therapyType: s.therapyType as TherapyType,
            startTime: s.startTime,
            durationMinutes: s.durationMinutes,
            therapistName: therapists.find((t) => t.id === s.therapistId)?.name,
          }));
        setTargetAlertData({
          patientName: p.name,
          target,
          totalMinutes: currMins,
          weekSessions: patientWeekSessions,
        });
      }
    });
    prevWeekMinsRef.current = new Map(weekMinsByPatient);
  }, [weekMinsByPatient, patients, weekSessions, therapists]);

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
    const map = new Map<number, { id: number; flagType: FlagType }[]>();
    flags.forEach((f) => {
      const arr = map.get(f.patientId) ?? [];
      arr.push({ id: f.id, flagType: f.flagType as FlagType });
      map.set(f.patientId, arr);
    });
    return map;
  }, [flags]);

  // Set of patient IDs who had therapy in the last 2 days (or scheduled today)
  const recentTherapyPatientIds = useMemo(() => {
    const set = new Set<number>();
    weekSessions.forEach((s) => {
      if (s.therapyType === "Block") return;
      const diff = differenceInDays(day, new Date(s.startTime));
      if (diff >= 0 && diff <= 2) {
        set.add(s.patientId);
      }
    });
    return set;
  }, [weekSessions, day]);

  const therapistName = (id: number | null) =>
    id ? therapists.find((t) => t.id === id)?.name : undefined;
  const therapistColor = (id: number | null) =>
    id ? therapists.find((t) => t.id === id)?.color : undefined;

  const checkDoubleBooking = (therapistId: number | null, deliveryMode: string, startTime: Date, endTime: Date, excludeSessionId?: number): string | null => {
    if (!therapistId) return null;
    
    const therapistOverlap = tiles.find(t => {
      if (t.therapistId !== therapistId || t.id === excludeSessionId) return false;
      
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
  };

  const checkTherapistAvailability = (therapistId: number | null, startTime: Date, endTime: Date): string | null => {
    if (!therapistId) return null;
    const therapist = therapists.find((t) => t.id === therapistId);
    if (!therapist) return null;

    if (therapist.workDays) {
      const days = therapist.workDays.split(',').map(Number);
      if (!days.includes(startTime.getDay())) {
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        return `${therapist.name} is not scheduled to work on ${dayNames[startTime.getDay()]}.`;
      }
    }

    if (therapist.workStartTime && therapist.workEndTime) {
      const sessionStartMins = startTime.getHours() * 60 + startTime.getMinutes();
      const sessionEndMins = endTime.getHours() * 60 + endTime.getMinutes();

      const [wsH, wsM] = therapist.workStartTime.split(':').map(Number);
      const workStartMins = wsH * 60 + wsM;
      const [weH, weM] = therapist.workEndTime.split(':').map(Number);
      const workEndMins = weH * 60 + weM;

      if (sessionStartMins < workStartMins || sessionEndMins > workEndMins) {
        // Format to standard 12-hour AM/PM for nicer reading
        const formatTime = (time: string) => {
          const [h, m] = time.split(':').map(Number);
          const ampm = h >= 12 ? 'PM' : 'AM';
          const h12 = h % 12 || 12;
          return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
        };
        return `${therapist.name}'s hours are ${formatTime(therapist.workStartTime)} to ${formatTime(therapist.workEndTime)}. This session falls outside their shift.`;
      }
    }
    return null;
  };

  // Lunch (12:00-1:00) is bookable, but flagged as an override warning rather than silently
  // allowed -- staff should notice they're cutting into it, not just get it by accident.
  const checkLunchOverlap = (startTime: Date, endTime: Date): string | null => {
    const lunchStart = new Date(startTime);
    lunchStart.setHours(12, 0, 0, 0);
    const lunchEnd = new Date(startTime);
    lunchEnd.setHours(13, 0, 0, 0);
    if (startTime.getTime() < lunchEnd.getTime() && endTime.getTime() > lunchStart.getTime()) {
      return "This session overlaps the lunch period (12:00 PM - 1:00 PM).";
    }
    return null;
  };

  const processWarnings = (warnings: (string | null | undefined)[], onComplete: () => void) => {
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
  };

  // Tiles per patient row, keyed by start slot
  const tilesByPatientSlot = useMemo(() => {
    const map = new Map<string, SessionTileData>();
    visibleTiles.forEach((t) => {
      map.set(`${t.patientId}-${t.slotIndex}`, {
        ...t,
        hasConflict: conflictIds.has(t.id),
      });
    });
    return map;
  }, [visibleTiles, conflictIds]);

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
      if (isMissedStatus(t.status) || t.therapyType === "Block") return;
      // If completed, use actualDurationMinutes if provided
      const mins = t.status === "completed" ? (t.actualDurationMinutes ?? t.durationMinutes) : t.durationMinutes;
      map.set(t.patientId, (map.get(t.patientId) || 0) + mins);
    });
    return map;
  }, [tiles]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );



  // Session dialog handlers
  function openNewSession(patientId: number, slotIndex: number) {
    setSessionDraft({
      patientId,
      therapyType: "PT",
      therapistId: null,
      slotIndex,
      durationMinutes: 30,
      deliveryMode: "individual",
      status: "scheduled",
      notes: "",
    });
    setSessionDialogOpen(true);
  }

  function openEditSession(tile: SessionTileData) {
    setSessionDraft({
      id: tile.id,
      patientId: tile.patientId,
      therapyType: tile.therapyType,
      therapistId: tile.therapistId,
      slotIndex: tile.slotIndex,
      durationMinutes: tile.durationMinutes,
      deliveryMode: tile.deliveryMode || "individual",
      status: tile.status || "scheduled",
      missedReason: tile.missedReason || undefined,
      notes: tile.notes ?? "",
    });
    setSessionDialogOpen(true);
  }

  function handleResizeSession(sessionId: number, newDurationMinutes: number) {
    const session = rawSessions.find(s => s.id === sessionId);
    if (!session) return;
    
    const tile = tiles.find(t => t.id === sessionId);
    if (!tile) return;

    const slotsNeeded = newDurationMinutes / 30;
    if (tile.slotIndex + slotsNeeded > TIME_SLOTS.length) {
      toast.error("Session exceeds clinical hours (5 PM limit)");
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
      }, {
        onSuccess: () => toast.success("Session duration updated")
      });
    };

    const warnings = [checkLunchOverlap(start, end), checkTherapistAvailability(session.therapistId, start, end), checkDoubleBooking(session.therapistId, session.deliveryMode, start, end, session.id)];
    processWarnings(warnings, doUpdate);
  }

  // Books a slot proposed by this morning's auto-generated gap-fill digest directly, without
  // opening the full session dialog -- one click from the "At Risk" popover in BoardHeader.
  function quickBookDigestSlot(patientId: number, slot: { startTime: string; durationMinutes: number; therapistId: number | null; therapyType: "PT" | "OT" | "SLP" }) {
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
      }, {
        onSuccess: () => toast.success("Session created")
      });
    };

    const warnings = [checkLunchOverlap(start, end), checkTherapistAvailability(slot.therapistId, start, end), checkDoubleBooking(slot.therapistId, "individual", start, end)];
    processWarnings(warnings, doBook);
  }

  function saveSession(value: SessionFormValue) {
    const start = slotIndexToDate(day, value.slotIndex);
    const end = new Date(start.getTime() + value.durationMinutes * 60000);

    const doSave = () => {
      if (value.id) {
        updateSession.mutate({
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
          onSuccess: () => toast.success("Session updated")
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
          onSuccess: () => toast.success("Session created")
        });
      }
    };

    const warnings = [checkLunchOverlap(start, end), checkTherapistAvailability(value.therapistId, start, end), checkDoubleBooking(value.therapistId, value.deliveryMode, start, end, value.id)];
    processWarnings(warnings, () => {
      doSave();
      setSessionDialogOpen(false);
    });
  }

  function savePatient(value: PatientFormValue) {
    if (value.id) {
      const oldPatient = patients.find((p) => p.id === value.id);
      updatePatient.mutate({
        id: value.id,
        roomNumber: value.roomNumber,
        name: value.name,
        notes: value.notes,
        isDischarged: value.isDischarged,
        admissionDate: value.admissionDate || undefined,
        estimatedDischargeDate: value.estimatedDischargeDate || undefined,
        weeklyMinuteTarget: value.weeklyMinuteTarget ?? 900,
        teamId: value.teamId ?? null,
      }, {
        onSuccess: () => {
          toast.success("Patient updated");
          // If the patient was just marked as discharged, leave an "Available" slot in that room
          if (value.isDischarged && oldPatient && !oldPatient.isDischarged) {
            createPatient.mutate({
              roomNumber: value.roomNumber,
              name: "Available",
              notes: "",
              isDischarged: false,
              weeklyMinuteTarget: 900,
              teamId: oldPatient.teamId ?? null,
            });
          }
        }
      });
    } else {
      createPatient.mutate({
        roomNumber: value.roomNumber,
        name: value.name,
        notes: value.notes,
        isDischarged: value.isDischarged,
        admissionDate: value.admissionDate || undefined,
        estimatedDischargeDate: value.estimatedDischargeDate || undefined,
        weeklyMinuteTarget: value.weeklyMinuteTarget ?? 900,
        teamId: value.teamId ?? null,
      }, {
        onSuccess: (newPatient) => {
          if (value.sessionTime && value.sessionTime !== "none" && value.sessionType && value.sessionDuration) {
            createSession.mutate({
              patientId: newPatient.id,
              therapyType: value.sessionType,
              startTime: new Date(day.getTime() + Number(value.sessionTime) * 30 * 60000),
              endTime: new Date(day.getTime() + (Number(value.sessionTime) * 30 + value.sessionDuration) * 60000),
              durationMinutes: value.sessionDuration,
              therapistId: value.sessionTherapist,
              notes: "",
              ignoreConflicts: true,
            });
            toast.success("Patient and session added");
          } else {
            toast.success("Patient added");
          }
        }
      });
    }
  }

  function handleSnapshot() {
    // Include therapists/teams so a saved snapshot is self-contained and can be printed
    // later without needing today's live data (therapist/team names, not just IDs).
    saveSnapshot.mutate(
      {
        date: day,
        snapshot: { sessions: rawSessions, patients, flags, therapists, teams },
      },
      {
        onSuccess: () => toast.success("Board snapshot saved"),
        onError: () => toast.error("Could not save snapshot"),
      },
    );
  }

  function handlePrintAllPatients() {
    const activePatients = patientsBySection.flatMap((s) => s.patients);
    printAllPatientSchedules(activePatients, day, tiles, therapists);
  }

  function handleCopyDay() {
    copyDayToNextDay.mutate(
      { date: day },
      {
        onSuccess: (res) => toast.success(`Copied ${res.count} sessions to tomorrow.`),
        onError: () => toast.error("Could not copy sessions."),
      }
    );
  }

  // Group patients by team and filter based on teamFilter selection
  const patientsBySection = useMemo(() => {
    const isPatientDC = (p: typeof patients[0]) => {
      const pFlags = flagsByPatient.get(p.id) ?? [];
      return p.isDischarged || pFlags.some((f) => f.flagType === "DC");
    };

    const sectionsToRender = teamFilter === "all" ? teams : teams.filter(t => t.id === teamFilter);
    const result = sectionsToRender.map((section) => ({
      ...section,
      patients: patients.filter((p) => p.teamId === section.id && !isPatientDC(p)),
    }));

    if (teamFilter === "all") {
      const unassigned = patients.filter(p => !p.teamId && !isPatientDC(p));
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
  }, [patients, teams, teamFilter, flagsByPatient]);

  const { customCollisionDetection, handleDragStart, handleDragEnd } = useBoardDnd({
    day,
    patientsBySection,
    setActiveDrag,
    setActiveDragPatient,
    updatePatient,
    updateSession,
    checkLunchOverlap,
    checkTherapistAvailability,
    checkDoubleBooking,
    processWarnings
  });


  function toggleSection(id: number) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalSessions = tiles.length;
  const conflictCount = conflictIds.size;
  const isBoardLoading =
    patientsQuery.isLoading || sessionsQuery.isLoading || therapistsQuery.isLoading;

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
        handlePrintAllPatients={handlePrintAllPatients}
        mySchedTherapist={mySchedTherapist}
        setMySchedTherapist={setMySchedTherapist}
        tiles={tiles}
        handleCopyDay={handleCopyDay}
        digestByPatientId={digestByPatientId}
        onBookSuggestion={quickBookDigestSlot}
      />

      {/* Mobile hint */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-2 text-xs text-slate-500 sm:hidden">
        <Smartphone className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span>Tap <strong className="text-slate-700">My Schedule</strong> for a focused view. Swipe the grid to see all time slots.</span>
      </div>

      {/* Board */}
      <main className="p-4 sm:p-5">
        {isBoardLoading ? (
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
        ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={customCollisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="overflow-x-auto overflow-y-hidden w-fit max-w-full mx-auto rounded-xl glass-panel touch-pan-x overscroll-x-contain scroll-smooth" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="min-w-max pb-16">
              {/* Time header */}
              <TimeHeaderRow />

              {/* Team sections */}
              {patients.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <Users className="h-10 w-10 text-slate-300" />
                  <p className="text-sm text-slate-500">No patients yet.</p>
                  <Button
                    size="sm"
                    onClick={() => { setPatientDraft(null); setPatientDialogOpen(true); }}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Add your first patient
                  </Button>
                </div>
              ) : (
                patientsBySection.map((section) => {
                  const isCollapsed = collapsedSections.has(section.id);
                  const sectionSessionCount = section.patients.reduce((acc, p) => {
                    return acc + tiles.filter((t) => t.patientId === p.id).length;
                  }, 0);

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
                            const pFlags = flagsByPatient.get(patient.id) ?? [];
                            const isDC = patient.isDischarged || pFlags.some((f) => f.flagType === "DC");
                            const isMedicalHold = pFlags.some((f) => f.flagType === "Medical Hold");
                            
                            // Check if patient had therapy in the last 2 days (or has it scheduled today)
                            const hasTherapyRecent = recentTherapyPatientIds.has(patient.id);
                            const missedTherapyAlert = !isDC && !isMedicalHold && !hasTherapyRecent;

                            // Missing Exit Eval Alert
                            let missingExitEvalAlert = false;
                            const estimatedDC = (patient as any).estimatedDischargeDate;
                            if (estimatedDC && !isDC) {
                               const dcDate = new Date(estimatedDC + "T00:00:00");
                               const diffTime = dcDate.getTime() - day.getTime();
                               const dcDaysAway = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                               if (dcDaysAway >= 0 && dcDaysAway <= 2) {
                                  // Approaching discharge. Check if there is an Eval session on dcDate or dcDate - 1 day.
                                  const evalExists = upcomingSessions.some((s) => {
                                      if (s.patientId !== patient.id || s.therapyType !== "Eval") return false;
                                      const sDate = new Date(s.startTime);
                                      const diffToDC = Math.floor((dcDate.getTime() - startOfDay(sDate).getTime()) / (1000 * 60 * 60 * 24));
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
                                rowIdx={rowIdx}
                                day={day}
                                tiles={tiles}
                                therapists={therapists}
                                pFlags={pFlags}
                                weekMinsByPatient={weekMinsByPatient}
                                tilesByPatientSlot={tilesByPatientSlot}
                                occupiedCells={occupiedCells}
                                dailyMinutesByPatient={dailyMinutesByPatient}
                                missedTherapyAlert={missedTherapyAlert}
                                missingExitEvalAlert={missingExitEvalAlert}
                                isDC={isDC}
                                isMedicalHold={isMedicalHold}
                                setPatientDraft={setPatientDraft}
                                setPatientDialogOpen={setPatientDialogOpen}
                                toggleFlag={(patientId, flag, active) => toggleFlag.mutate({ patientId, flagType: flag, date: day, active })}
                                copyPatientSessions={(patientId) => copyPatientSessions.mutate({ patientId, date: day })}
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
              <div className="flex w-72 items-center gap-1.5 border border-slate-300 bg-white px-3 py-2 shadow-xl rounded cursor-grabbing">
                <span className="truncate text-sm font-bold text-slate-800">{activeDragPatient.name}</span>
                <span className="shrink-0 inline-flex min-w-[2.5rem] justify-center rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-600">
                  {activeDragPatient.roomNumber}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        )}

        {/* Legend -- session tiles are colored by assigned therapist (each staff member picks
            their own color in the Staff panel), not by therapy type, so the type key below is
            intentionally plain/uncolored rather than implying a color mapping that no longer
            matches what's actually on the grid. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-white/40 glass-surface px-4 py-3 shadow-sm">
          <span className="text-micro font-semibold uppercase tracking-widest text-slate-500 w-full md:w-auto">Legend</span>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {THERAPY_TYPES.map((t) => {
              const meta = THERAPY_META[t];
              return (
                <div key={t} className="flex items-center gap-1.5">
                  <span className="flex h-5 w-8 items-center justify-center rounded border border-white/50 bg-white/60 shadow-sm text-micro font-bold text-slate-600">
                    {meta.label}
                  </span>
                  <span className="text-xs font-medium text-slate-700">{meta.full}</span>
                </div>
              );
            })}
          </div>

          <div className="hidden md:block h-5 w-px bg-slate-300/50" />

          <div className="flex items-center gap-1.5">
            <UserCircle2 className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-medium text-slate-700">Tile color = assigned therapist</span>
          </div>

          <div className="hidden md:block h-5 w-px bg-slate-300/50" />

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
              <span className="text-xs font-medium text-slate-700">Completed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <XCircle className="h-4 w-4 text-red-500" strokeWidth={2.5} />
              <span className="text-xs font-medium text-slate-700">Missed</span>
            </div>
          </div>

          <div className="w-full md:w-auto md:ml-auto flex items-center justify-between gap-2 text-xs font-medium text-slate-500 pt-3 md:pt-0 border-t border-slate-300/30 md:border-0 mt-1 md:mt-0">
            <div>
              <span className="tabular-nums font-bold text-slate-700">{patients.length}</span> patient{patients.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
      </main>

      {/* Dialogs */}
      <SessionDialog
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
        initial={sessionDraft}
        patients={patients}
        therapists={therapists}
        onSave={saveSession}
        onDelete={(id) => {
          deleteSession.mutate({ id });
          setSessionDialogOpen(false);
        }}
      />

      <PatientDialog
        open={patientDialogOpen}
        onOpenChange={setPatientDialogOpen}
        initial={patientDraft}
        teams={teams}
        therapists={therapists}
        onSave={savePatient}
      />

      <WeeklyMinutesPanel
        open={weeklyMinutesPanelOpen}
        onOpenChange={setWeeklyMinutesPanelOpen}
      />
      <AskSchedulerPanel open={askSchedulerPanelOpen} onOpenChange={setAskSchedulerPanelOpen} />

      <BoardHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />

      <DataAnalysisModal
        open={dataAnalysisOpen}
        onOpenChange={setDataAnalysisOpen}
        patients={patientsQuery.data ?? []}
        onEditPatient={(id) => {
          const patient = patientsQuery.data?.find(p => p.id === id);
          if (patient) {
            setPatientDraft({
              id: patient.id,
              roomNumber: patient.roomNumber,
              name: patient.name,
              notes: patient.notes ?? "",
              isDischarged: patient.isDischarged,
              admissionDate: (patient as any).admissionDate ?? "",
              estimatedDischargeDate: (patient as any).estimatedDischargeDate ?? "",
              weeklyMinuteTarget: (patient as any).weeklyMinuteTarget ?? 900,
              teamId: (patient as any).teamId ?? null,
            });
            setPatientDialogOpen(true);
          }
        }}
      />

      <PatientPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        patients={patients}
        onAdd={(initialData) => {
          if (initialData) {
            setPatientDraft({
              roomNumber: initialData.roomNumber ?? "",
              name: initialData.name ?? "",
              notes: initialData.notes ?? "",
              isDischarged: false,
              weeklyMinuteTarget: 900,
            });
          } else {
            setPatientDraft(null);
          }
          setPatientDialogOpen(true);
        }}
        onEdit={(p) => {
          setPatientDraft({
            id: p.id,
            roomNumber: p.roomNumber,
            name: p.name,
            notes: p.notes ?? "",
            isDischarged: p.isDischarged,
            admissionDate: (p as any).admissionDate ?? "",
            estimatedDischargeDate: (p as any).estimatedDischargeDate ?? "",
            weeklyMinuteTarget: (p as any).weeklyMinuteTarget ?? 900,
            teamId: (p as any).teamId ?? null,
          });
          setPatientDialogOpen(true);
        }}
        onDelete={(id) => {
          deletePatient.mutate({ id });
          toast.success("Patient removed");
        }}
        therapists={therapists}
        teams={teams}
      />

      <TherapistPanel
        open={staffPanelOpen}
        onOpenChange={setStaffPanelOpen}
        therapists={therapists}
        teams={teams}
        onAdd={(name, teamId, therapyType, schedule) => {
          createTherapist.mutate({ name, teamId, therapyType, ...schedule });
          toast.success("Staff member added");
        }}
        onEdit={(id, name, teamId, therapyType, schedule) => {
          updateTherapist.mutate({ id, name, teamId, therapyType, ...schedule });
          toast.success("Staff member updated");
        }}
        onDelete={(id) => {
          deleteTherapist.mutate({ id });
          toast.success("Staff member removed");
        }}
      />

      <TargetReachedDialog
        open={targetAlertData !== null}
        onOpenChange={(o) => { if (!o) setTargetAlertData(null); }}
        patientName={targetAlertData?.patientName ?? ""}
        target={targetAlertData?.target ?? 900}
        totalMinutes={targetAlertData?.totalMinutes ?? 0}
        weekSessions={targetAlertData?.weekSessions ?? []}
      />
      {/* Override Warning Modal */}
      <AlertDialog open={!!overrideWarning} onOpenChange={(open) => !open && setOverrideWarning(null)}>
        <AlertDialogContent className="sm:max-w-[425px] overflow-hidden rounded-2xl border border-white/20 bg-white/80 backdrop-blur-xl shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-slate-100/40 pointer-events-none" />
          <div className="relative">
            <AlertDialogHeader className="mb-4">
              <AlertDialogTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-indigo-500" />
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
                className="bg-indigo-600 hover:bg-indigo-700"
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
