import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  closestCenter,
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

  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDraft, setSessionDraft] = useState<SessionFormValue | null>(null);
  const [patientDialogOpen, setPatientDialogOpen] = useState(false);
  const [patientDraft, setPatientDraft] = useState<PatientFormValue | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [staffPanelOpen, setStaffPanelOpen] = useState(false);
  const [weeklyMinutesPanelOpen, setWeeklyMinutesPanelOpen] = useState(false);
  const [askSchedulerPanelOpen, setAskSchedulerPanelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dataAnalysisOpen, setDataAnalysisOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<SessionTileData | null>(null);
  const [activeDragPatient, setActiveDragPatient] = useState<any | null>(null);
  const [targetAlertData, setTargetAlertData] = useState<{
    patientName: string;
    target: number;
    totalMinutes: number;
    weekSessions: WeekSessionRow[];
  } | null>(null);

  const [overrideWarning, setOverrideWarning] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());

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
    utils.sessions.listForWeek.invalidate();
    utils.patients.list.invalidate();
    utils.statusFlags.listForDate.invalidate();
  };

  const createSession = trpc.sessions.create.useMutation({ 
    onSuccess: () => { invalidateBoard(); toast.success("Session added"); }, 
    onError: (err) => toast.error(err.message) 
  });
  const updateSession = trpc.sessions.update.useMutation({ 
    onSuccess: () => { invalidateBoard(); toast.success("Session updated"); }, 
    onError: (err) => toast.error(err.message) 
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
    onSuccess: () => { invalidateBoard(); }, 
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

  // Weekly minutes per patient (Mon–Sun of the viewed week)
  const weekMinsByPatient = useMemo(() => {
    const map = new Map<number, number>();
    patients.forEach((p) => {
      if (p.isDischarged) return;
      const bounds = getPatientWeekBounds((p as any).admissionDate, day);
      const patientSessions = weekSessions.filter((s) => {
        if (s.patientId !== p.id) return false;
        const sessionStart = new Date(s.startTime);
        return sessionStart >= bounds.start && sessionStart <= bounds.end;
      });
      const sum = patientSessions.reduce((acc, curr) => acc + curr.durationMinutes, 0);
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

  // Total daily minutes per patient (completed or scheduled, not missed or block)
  const dailyMinutesByPatient = useMemo(() => {
    const map = new Map<number, number>();
    visibleTiles.forEach(t => {
      if (isMissedStatus(t.status) || t.therapyType === "Block") return;
      // If completed, use actualDurationMinutes if provided
      const mins = t.status === "completed" ? (t.actualDurationMinutes ?? t.durationMinutes) : t.durationMinutes;
      map.set(t.patientId, (map.get(t.patientId) || 0) + mins);
    });
    return map;
  }, [visibleTiles]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as any;
    if (data?.session) {
      setActiveDrag(data.session);
    } else if (data?.patient) {
      setActiveDragPatient(data.patient);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    setActiveDragPatient(null);
    const { active, over } = event;
    if (!over) return;
    
    const data = active.data.current as any;
    
    // Handle patient drag
    if (data?.patient) {
      const targetData = over.data.current as any;
      if (targetData?.teamId !== undefined) {
        let newOrderIndex = data.patient.orderIndex ?? 0;

        if (targetData.isPatientDrop) {
          const targetPatientId = Number(over.id.toString().replace("patient-", ""));
          const targetSection = patientsBySection.find(s => 
            s.id === targetData.teamId || (s.id === 0 && targetData.teamId === null)
          );
          
          if (targetSection) {
            const overIndex = targetSection.patients.findIndex(p => p.id === targetPatientId);
            const activeIndex = data.patient.teamId === targetData.teamId 
              ? targetSection.patients.findIndex(p => p.id === data.patient.id)
              : -1;

            if (overIndex !== -1) {
              if (activeIndex === overIndex) return; // Dropped in the exact same spot

              const isMovingDown = activeIndex !== -1 && activeIndex < overIndex;
              const prevPatient = targetSection.patients[isMovingDown ? overIndex : overIndex - 1];
              const nextPatient = targetSection.patients[isMovingDown ? overIndex + 1 : overIndex];

              const prevOrder = prevPatient ? ((prevPatient as any).orderIndex ?? 0) : (nextPatient ? ((nextPatient as any).orderIndex ?? 0) - 100 : 0);
              const nextOrder = nextPatient ? ((nextPatient as any).orderIndex ?? 0) : (prevPatient ? ((prevPatient as any).orderIndex ?? 0) + 100 : 100);

              newOrderIndex = (prevOrder + nextOrder) / 2;
            }
          }
        } else if (data.patient.teamId === targetData.teamId) {
           // Dropped onto the same team header, don't move
           return;
        }
        
        updatePatient.mutate({
          id: data.patient.id,
          roomNumber: data.patient.roomNumber,
          name: data.patient.name,
          notes: data.patient.notes ?? "",
          isDischarged: data.patient.isDischarged,
          admissionDate: data.patient.admissionDate ?? undefined,
          weeklyMinuteTarget: data.patient.weeklyMinuteTarget ?? 900,
          teamId: targetData.teamId === 0 ? null : targetData.teamId,
          orderIndex: newOrderIndex,
        });
        toast.success(`Patient moved to ${targetData.teamName || (targetData.teamId ? "another team" : "Unassigned")}`);
      }
      return;
    }

    // Handle session drag
    const session = data?.session;
    let target = over.data.current as any;
    if (!session || !target) return;

    // If dropped onto a patient row header, keep the same time slot but change the patient
    if (target.isPatientDrop) {
      target = { patientId: target.patient.id, slotIndex: session.slotIndex };
    }

    if (target.patientId === undefined || target.slotIndex === undefined) return;
    if (session.patientId === target.patientId && session.slotIndex === target.slotIndex) return;

    const newStart = slotIndexToDate(day, target.slotIndex);
    const newEnd = new Date(newStart.getTime() + session.durationMinutes * 60000);

    const slotsNeeded = session.durationMinutes / 30;
    if (target.slotIndex + slotsNeeded > TIME_SLOTS.length) {
      toast.error("Session exceeds clinical hours (5 PM limit)");
      return;
    }

    const doMove = () => {
      updateSession.mutate({
        id: session.id,
        patientId: target.patientId,
        startTime: newStart,
        endTime: newEnd,
        ignoreConflicts: true,
      }, {
        onSuccess: () => toast.success("Session moved")
      });
    };

    const warnings = [checkLunchOverlap(newStart, newEnd), checkTherapistAvailability(session.therapistId, newStart, newEnd), checkDoubleBooking(session.therapistId, session.deliveryMode, newStart, newEnd, session.id)];
    processWarnings(warnings, doMove);
  }

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
    <div className="min-h-screen bg-[#f1f4f7]">
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
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="overflow-auto rounded-xl border border-slate-200/60 bg-white shadow-sm touch-pan-x overscroll-x-contain scroll-smooth" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="min-w-max pb-16">
              {/* Time header */}
              <div className="flex border-b border-slate-200/80 bg-white/80 backdrop-blur-md shadow-[0_4px_15px_-3px_rgba(0,0,0,0.06)] sticky top-0 z-20 transition-colors">
                <div className="sticky left-0 z-30 flex w-72 shrink-0 items-center border-r border-slate-200/60 bg-slate-100/90 backdrop-blur px-4 py-2 shadow-[2px_0_10px_-3px_rgba(0,0,0,0.02)]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Patient / Room
                  </span>
                </div>
                <div
                  className="sticky z-30 flex w-11 shrink-0 flex-col items-center justify-center gap-0.5 border-r border-slate-200/60 bg-slate-100/90 backdrop-blur py-2 shadow-[6px_0_15px_-4px_rgba(0,0,0,0.08)]"
                  style={{ left: 288 }}
                >
                  <CalendarClock className="h-3 w-3 text-slate-400" strokeWidth={2.5} />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
                    EOW
                  </span>
                </div>
                {TIME_SLOTS.map((slot) => {
                  const isHour = slot.minute === 0;

                  if (slot.hour === 12 && slot.minute === 30) {
                    return null;
                  }

                  if (slot.hour === 12 && slot.minute === 0) {
                    return (
                      <div
                        key={slot.index}
                        className="shrink-0 py-2.5 text-center border-r border-slate-200 bg-slate-200/40 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,0.03)_4px,rgba(0,0,0,0.03)_8px)]"
                        style={{ flex: `0 0 ${SLOT_WIDTH * 2}px`, width: SLOT_WIDTH * 2, minWidth: SLOT_WIDTH * 2 }}
                      >
                        <span className="text-[10px] font-bold text-slate-600 tracking-widest">
                          LUNCH
                        </span>
                      </div>
                    );
                  }

                  const isLastSlot = slot.index === TIME_SLOTS.length - 1;

                  return (
                    <div
                      key={slot.index}
                      className={cn(
                        "shrink-0 py-1.5 text-center border-r transition-colors flex flex-col items-center justify-center gap-0.5",
                        !isHour ? "border-slate-200" : "border-slate-100/50",
                      )}
                      style={{ flex: `0 0 ${SLOT_WIDTH}px`, width: SLOT_WIDTH, minWidth: SLOT_WIDTH }}
                    >
                      <span
                        className={cn(
                          "text-[10px] tabular-nums tracking-tight leading-none",
                          isHour ? "font-bold text-slate-700" : "font-medium text-slate-400",
                        )}
                      >
                        {isHour ? slot.shortLabel.replace(":00", "") : slot.label}
                      </span>
                      {/* The grid's closing boundary -- there's no slot that *starts* at 6 PM
                          (the last real slot starts at 5:30 and runs to 6), so without this the
                          header never shows the hour the board actually closes at. */}
                      {isLastSlot && (
                        <span className="flex items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 py-[1px] text-[8px] font-extrabold uppercase leading-none tracking-wide text-white shadow-sm shadow-amber-500/40">
                          <Sunset className="h-2.5 w-2.5" strokeWidth={2.5} />
                          6 PM
                        </span>
                      )}
                    </div>
                  );
                })}
                
                {/* Daily Total Column */}
                <div
                  className="sticky right-0 z-30 flex w-14 shrink-0 flex-col items-center justify-center border-l border-slate-200/60 bg-slate-100/90 backdrop-blur py-2 shadow-[-6px_0_15px_-4px_rgba(0,0,0,0.08)]"
                >
                  <BicepsFlexed className="h-3.5 w-3.5 text-rose-500 mb-0.5 drop-shadow-sm" strokeWidth={2.5} />
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                    Total
                  </span>
                </div>
              </div>

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
                      {/* Section header */}
                      <div 
                        className="flex items-center border-b border-slate-200/50 relative overflow-hidden"
                        style={{ 
                          borderTop: `2px solid ${section.color}80`,
                          background: `linear-gradient(to right, ${section.color}15, transparent 1000px)`
                        }}
                      >
                        {/* Colored accent + label (sticky) */}
                        <div
                          className="sticky left-0 z-20 flex w-72 shrink-0 items-center gap-2 border-r border-slate-200/60 px-3 py-2 shadow-[6px_0_15px_-4px_rgba(0,0,0,0.08)] backdrop-blur-md"
                          style={{ backgroundColor: `${section.color}05` }}
                        >
                          <button
                            onClick={() => toggleSection(section.id)}
                            className="flex flex-1 items-center gap-2 text-left"
                          >
                            <span
                              className="h-3 w-1 shrink-0 rounded-full"
                              style={{ backgroundColor: section.color }}
                            />
                            <span className="text-xs font-bold text-slate-800">{section.name}</span>
                            <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                              style={{ backgroundColor: section.color }}>
                              {section.patients.length}
                            </span>
                            {sectionSessionCount > 0 && (
                              <span className="text-[10px] text-slate-500 font-medium">{sectionSessionCount} session{sectionSessionCount !== 1 ? "s" : ""} today</span>
                            )}
                            <ChevronRight
                              className={cn("ml-auto h-4 w-4 text-slate-500 transition-transform", !isCollapsed && "rotate-90")}
                            />
                          </button>
                          <button
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-white/60 transition-colors"
                            title={`Add patient to ${section.name}`}
                            onClick={() => {
                              setPatientDraft({ ...EMPTY_PATIENT, teamId: section.id });
                              setPatientDialogOpen(true);
                            }}
                          >
                            <Plus className="h-4 w-4 text-slate-600" />
                          </button>
                        </div>
                        {/* Extend header across time grid */}
                        <div className="flex-1" style={{ minWidth: TIME_SLOTS.length * SLOT_WIDTH }} />
                      </div>

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
                                      return diffToDC === 0 || diffToDC === 1;
                                  });
                                  if (!evalExists) {
                                      missingExitEvalAlert = true;
                                  }
                               }
                            }

                            return (
                              <div key={patient.id} id={`patient-row-${patient.id}`} className={cn("group/row flex h-14 border-b border-slate-100 transition-colors last:border-b-0 hover:bg-slate-50/60", isDC && "bg-slate-200 opacity-60 grayscale")}>
                                {/* Patient label */}
                                <PatientDraggable patient={patient}
                                  className={cn(
                                    "sticky left-0 z-10 flex h-full w-72 shrink-0 items-center justify-between gap-1.5 border-r border-slate-200 px-2 py-1 transition-colors cursor-grab active:cursor-grabbing shadow-[2px_0_10px_-3px_rgba(0,0,0,0.02)]",
                                    isDC ? "bg-slate-200" : (rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50"),
                                    "group-hover/row:bg-slate-100",
                                  )}
                                >
                                  <button
                                    className="flex min-w-0 flex-col gap-0.5 text-left w-full justify-center"
                                    onClick={() => {
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
                                    }}
                                  >
                                    <div className="flex items-center gap-1.5 w-full overflow-hidden">
                                      <span className={cn("truncate text-[11px] font-bold text-slate-800", isDC && "text-slate-400 line-through")}>
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
                                      <span className="shrink-0 inline-flex min-w-[2rem] justify-center rounded border border-slate-200 bg-slate-100 px-1 text-[9px] font-bold tabular-nums text-slate-600">
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
                                        <span className="truncate text-[9px] italic text-slate-400 w-full">{patient.notes}</span>
                                      </div>
                                    )}
                                    {!isDC && (() => {
                                      const weekMins = weekMinsByPatient.get(patient.id) ?? 0;
                                      const target = (patient as any).weeklyMinuteTarget ?? 900;
                                      const pct = Math.min(100, Math.round((weekMins / target) * 100));
                                      const isOnTrack = weekMins >= target;
                                      const isClose = !isOnTrack && pct >= 67;
                                      return (
                                        <div className="flex items-center gap-1.5 w-full mt-0.5">
                                          <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                                            <div
                                              className={cn("h-full rounded-full transition-all", isOnTrack ? "bg-emerald-500" : isClose ? "bg-amber-400" : "bg-red-400")}
                                              style={{ width: `${pct}%` }}
                                            />
                                          </div>
                                          <span className={cn("shrink-0 text-[9px] font-semibold tabular-nums", isOnTrack ? "text-emerald-600" : isClose ? "text-amber-600" : "text-red-600")}>
                                            {weekMins}<span className="font-normal text-slate-400">/{target}</span>
                                          </span>
                                        </div>
                                      );
                                    })()}
                                  </button>
                                  <div className="flex items-center shrink-0 ml-0.5 gap-0.5">
                                    <FlagToggle
                                      activeFlags={pFlags.map((f) => f.flagType)}
                                      onToggle={(flag, active) =>
                                        toggleFlag.mutate({ patientId: patient.id, flagType: flag, date: day, active })
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
                                              disabled={copyPatientSessions.isPending}
                                            >
                                              <Copy className="h-3.5 w-3.5" />
                                            </Button>
                                          </AlertDialogTrigger>
                                        </TooltipTrigger>
                                        <TooltipContent>Copy to Tomorrow</TooltipContent>
                                      </Tooltip>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Copy Sessions</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Copy all of {patient.name}&apos;s sessions from today to tomorrow?
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => {
                                            copyPatientSessions.mutate({ patientId: patient.id, date: day });
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

                                {/* EOW (End Of Week) column -- which day this patient's personalized week resets on */}
                                {(() => {
                                  const eowDayIndex = getPatientWeekBounds((patient as any).admissionDate, day).end.getDay();
                                  return (
                                    <div
                                      className={cn(
                                        "sticky z-10 flex h-full w-11 shrink-0 items-center justify-center border-r border-slate-200 transition-colors shadow-[6px_0_15px_-4px_rgba(0,0,0,0.08)]",
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

                                {/* Time cells -- lunch (12:00-1:00) renders as two normal, fully
                                    bookable half-hour cells like any other slot, just flagged
                                    isLunch for the visual hatch; the confirm-before-booking
                                    happens in saveSession/handleDragEnd/handleResizeSession via
                                    checkLunchOverlap, not by disabling the cell here. */}
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
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-slate-200 bg-white px-4 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Legend</span>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {THERAPY_TYPES.map((t) => {
              const meta = THERAPY_META[t];
              return (
                <div key={t} className="flex items-center gap-1.5">
                  <span className="flex h-4 w-7 items-center justify-center rounded border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-500">
                    {meta.label}
                  </span>
                  <span className="text-xs text-slate-600">{meta.full}</span>
                </div>
              );
            })}
          </div>

          <div className="h-4 w-px bg-slate-200" />

          <div className="flex items-center gap-1.5">
            <UserCircle2 className="h-4 w-4 text-slate-400" />
            <span className="text-xs text-slate-600">Tile color = assigned therapist</span>
          </div>

          <div className="h-4 w-px bg-slate-200" />

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" strokeWidth={2.5} />
              <span className="text-xs text-slate-600">Completed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5 text-red-600" strokeWidth={2.5} />
              <span className="text-xs text-slate-600">Missed</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
            <span className="tabular-nums font-semibold text-slate-600">{patients.length}</span> patient{patients.length !== 1 ? "s" : ""}
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
