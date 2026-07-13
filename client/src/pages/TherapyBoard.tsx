import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
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
  Bot
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
import { WeeklyMinutesPanel } from "@/components/board/WeeklyMinutesPanel";
import { DataAnalysisModal } from "@/components/board/DataAnalysisModal";
import { AskSchedulerPanel } from "@/components/board/AskSchedulerPanel";
import { cn } from "@/lib/utils";

const SLOT_WIDTH = 72; // px per 30-min slot

import { getPatientWeekBounds } from "@/../../shared/weekUtils";

const BOARD_SECTIONS = [
  { id: 1, name: "Team One",   color: "#3b82f6" },
  { id: 2, name: "Team Two",   color: "#10b981" },
  { id: 3, name: "Team Three", color: "#f59e0b" },
] as const;

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
  const [teamFilter, setTeamFilter] = useState<number | "all">("all");
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
  const [targetAlertData, setTargetAlertData] = useState<{
    patientName: string;
    target: number;
    totalMinutes: number;
    weekSessions: WeekSessionRow[];
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

  const patients = patientsQuery.data ?? [];
  const therapists = therapistsQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const rawSessions = sessionsQuery.data ?? [];
  const weekSessions = weekSessionsQuery.data ?? [];
  const flags = flagsQuery.data ?? [];

  // Mutations
  const invalidateBoard = () => {
    utils.sessions.list.invalidate();
    utils.sessions.listForWeek.invalidate();
    utils.patients.list.invalidate();
    utils.statusFlags.listForDate.invalidate();
  };

  const createSession = trpc.sessions.create.useMutation({ onSuccess: invalidateBoard });
  const updateSession = trpc.sessions.update.useMutation({ onSuccess: invalidateBoard });
  const deleteSession = trpc.sessions.delete.useMutation({ onSuccess: invalidateBoard });
  const createPatient = trpc.patients.create.useMutation({ onSuccess: invalidateBoard });
  const updatePatient = trpc.patients.update.useMutation({ onSuccess: invalidateBoard });
  const deletePatient = trpc.patients.delete.useMutation({ onSuccess: invalidateBoard });
  const toggleFlag = trpc.statusFlags.toggle.useMutation({ onSuccess: invalidateBoard });
  const saveSnapshot = trpc.history.save.useMutation();
  const createTherapist = trpc.therapists.create.useMutation({
    onSuccess: () => utils.therapists.list.invalidate(),
  });
  const updateTherapist = trpc.therapists.update.useMutation({
    onSuccess: () => utils.therapists.list.invalidate(),
  });
  const deleteTherapist = trpc.therapists.delete.useMutation({
    onSuccess: () => utils.therapists.list.invalidate(),
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { session?: SessionTileData } | undefined;
    if (data?.session) setActiveDrag(data.session);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const session = (active.data.current as { session?: SessionTileData })?.session;
    const target = over.data.current as { patientId: number; slotIndex: number } | undefined;
    if (!session || !target) return;
    if (session.patientId === target.patientId && session.slotIndex === target.slotIndex) return;

    const newStart = slotIndexToDate(day, target.slotIndex);
    const newEnd = new Date(newStart.getTime() + session.durationMinutes * 60000);

    const slotsNeeded = session.durationMinutes / 30;
    if (target.slotIndex + slotsNeeded > TIME_SLOTS.length) {
      toast.error("Session exceeds clinical hours (5 PM limit)");
      return;
    }

    // Prevent scheduling during lunch (12:00 PM - 1:00 PM)
    for (let i = 0; i < slotsNeeded; i++) {
      const slot = TIME_SLOTS[target.slotIndex + i];
      if (slot && slot.hour === 12) {
        toast.error("Cannot schedule sessions during lunch (12:00 PM - 1:00 PM)");
        return;
      }
    }

    updateSession.mutate({
      id: session.id,
      patientId: target.patientId,
      startTime: newStart,
      endTime: newEnd,
    });
    toast.success("Session rescheduled");
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

    for (let i = 0; i < slotsNeeded; i++) {
      const slot = TIME_SLOTS[tile.slotIndex + i];
      if (slot && slot.hour === 12) {
        toast.error("Cannot extend session into lunch (12:00 PM - 1:00 PM)");
        return;
      }
    }

    const end = new Date(new Date(session.startTime).getTime() + newDurationMinutes * 60000);
    updateSession.mutate({
      id: session.id,
      patientId: session.patientId,
      startTime: new Date(session.startTime),
      endTime: end,
      durationMinutes: newDurationMinutes,
      therapyType: session.therapyType,
      therapistId: session.therapistId,
      notes: session.notes ?? undefined,
    });
    toast.success("Session duration updated");
  }

  function saveSession(value: SessionFormValue) {
    const start = slotIndexToDate(day, value.slotIndex);
    const end = new Date(start.getTime() + value.durationMinutes * 60000);
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
      });
      toast.success("Session updated");
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
      });
      toast.success("Session added");
    }
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
        weeklyMinuteTarget: value.weeklyMinuteTarget ?? 900,
        teamId: value.teamId ?? null,
      }, {
        onSuccess: () => {
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
      toast.success("Patient updated");
    } else {
      createPatient.mutate({
        roomNumber: value.roomNumber,
        name: value.name,
        notes: value.notes,
        isDischarged: value.isDischarged,
        admissionDate: value.admissionDate || undefined,
        weeklyMinuteTarget: value.weeklyMinuteTarget ?? 900,
        teamId: value.teamId ?? null,
      }, {
        onSuccess: (newPatient) => {
          if (value.sessionTime && value.sessionTime !== "none" && value.sessionType && value.sessionDuration) {
            createSession.mutate({
              patientId: newPatient.id,
              therapyType: value.sessionType,
              startTime: new Date(day.getTime() + Number(value.sessionTime) * 30 * 60000), // Note: db uses actual datetime? Wait, createSession needs startTime and endTime.
              endTime: new Date(day.getTime() + (Number(value.sessionTime) * 30 + value.sessionDuration) * 60000),
              durationMinutes: value.sessionDuration,
              therapistId: value.sessionTherapist,
              notes: ""
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
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="overflow-auto rounded-xl border border-slate-200/60 bg-white shadow-sm touch-pan-x overscroll-x-contain scroll-smooth" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="min-w-max pb-16">
              {/* Time header */}
              <div className="flex border-b border-slate-200/60 bg-slate-50/50 backdrop-blur-sm sticky top-0 z-20">
                <div className="sticky left-0 z-30 flex w-64 shrink-0 items-center border-r border-slate-200/60 bg-slate-100/90 backdrop-blur px-4 py-2 shadow-[2px_0_10px_-3px_rgba(0,0,0,0.05)]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Patient / Room
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

                  return (
                    <div
                      key={slot.index}
                      className={cn(
                        "shrink-0 py-2.5 text-center border-r transition-colors",
                        !isHour ? "border-slate-200" : "border-slate-100/50",
                      )}
                      style={{ flex: `0 0 ${SLOT_WIDTH}px`, width: SLOT_WIDTH, minWidth: SLOT_WIDTH }}
                    >
                      <span
                        className={cn(
                          "text-[10px] tabular-nums tracking-tight",
                          isHour ? "font-bold text-slate-700" : "font-medium text-slate-400",
                        )}
                      >
                        {isHour ? slot.shortLabel.replace(":00", "") : slot.label}
                      </span>
                    </div>
                  );
                })}
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
                    <div key={section.id}>
                      {/* Section header */}
                      <div 
                        className="flex items-center border-b border-slate-200/50"
                        style={{ 
                          borderTop: `2px solid ${section.color}`,
                          backgroundColor: `${section.color}05`
                        }}
                      >
                        {/* Colored accent + label (sticky) */}
                        <div
                          className="sticky left-0 z-20 flex w-64 shrink-0 items-center gap-2 border-r border-slate-200/60 px-3 py-2 shadow-[2px_0_10px_-3px_rgba(0,0,0,0.02)] backdrop-blur-md"
                          style={{ backgroundColor: `${section.color}0A` }}
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
                      {!isCollapsed && section.patients.map((patient, rowIdx) => {
                        const pFlags = flagsByPatient.get(patient.id) ?? [];
                        const isDC = patient.isDischarged || pFlags.some((f) => f.flagType === "DC");
                        const isMedicalHold = pFlags.some((f) => f.flagType === "Medical Hold");
                        
                        // Check if patient had therapy in the last 2 days (or has it scheduled today)
                        const hasTherapyRecent = recentTherapyPatientIds.has(patient.id);
                        const missedTherapyAlert = !isDC && !isMedicalHold && !hasTherapyRecent;

                        return (
                          <div key={patient.id} id={`patient-row-${patient.id}`} className={cn("group/row flex h-14 border-b border-slate-100 transition-colors last:border-b-0 hover:bg-slate-50/60", isDC && "bg-slate-200 opacity-60 grayscale")}>
                            {/* Patient label */}
                            <div
                              className={cn(
                                "sticky left-0 z-10 flex h-full w-64 shrink-0 items-center justify-between gap-1.5 border-r border-slate-200 px-2 py-1 transition-colors",
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
                                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500 animate-pulse" strokeWidth={2.5} />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="text-xs font-semibold text-red-700 bg-red-50 border-red-200">
                                        No therapy in 2+ days
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
                              <FlagToggle
                                activeFlags={pFlags.map((f) => f.flagType)}
                                onToggle={(flag, active) =>
                                  toggleFlag.mutate({ patientId: patient.id, flagType: flag, date: day, active })
                                }
                              />
                              <PatientDayQuickView
                                patient={patient}
                                day={day}
                                sessions={tiles}
                                therapists={therapists}
                              />
                            </div>

                            {/* Time cells */}
                            {TIME_SLOTS.map((slot) => {
                              if (slot.hour === 12 && slot.minute === 30) return null;
                              const tile = tilesByPatientSlot.get(`${patient.id}-${slot.index}`);
                              const isOccupied = occupiedCells.has(`${patient.id}-${slot.index}`);

                              const isHourEnd = slot.index % 2 === 1;
                              const borderClass = isHourEnd ? "border-r border-slate-200" : "border-r border-slate-100";

                              if (slot.hour === 12 && slot.minute === 0) {
                                return (
                                  <div key={slot.index} style={{ flex: `0 0 ${SLOT_WIDTH * 2}px`, width: SLOT_WIDTH * 2, minWidth: SLOT_WIDTH * 2 }} className={cn("shrink-0", "border-r border-slate-200", isMedicalHold && "bg-slate-200/50 bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.03),rgba(0,0,0,0.03)_4px,transparent_4px,transparent_8px)] grayscale pointer-events-none opacity-80")}>
                                    <GridCell patientId={patient.id} slotIndex={slot.index} onAdd={openNewSession} isAlternate={rowIdx % 2 !== 0} isLunch={true} />
                                  </div>
                                );
                              }
                              if (isOccupied) {
                                return <div key={slot.index} style={{ flex: `0 0 ${SLOT_WIDTH}px`, width: SLOT_WIDTH, minWidth: SLOT_WIDTH }} className={cn("shrink-0", borderClass, isMedicalHold && "bg-slate-200/50 bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.03),rgba(0,0,0,0.03)_4px,transparent_4px,transparent_8px)] grayscale pointer-events-none opacity-80")} />;
                              }
                              return (
                                <div key={slot.index} style={{ flex: `0 0 ${SLOT_WIDTH}px`, width: SLOT_WIDTH, minWidth: SLOT_WIDTH }} className={cn("shrink-0 transition-colors duration-300", borderClass, isMedicalHold && "bg-slate-200/50 bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.03),rgba(0,0,0,0.03)_4px,transparent_4px,transparent_8px)] grayscale opacity-80")}>
                                  <GridCell patientId={patient.id} slotIndex={slot.index} onAdd={openNewSession} isAlternate={rowIdx % 2 !== 0} isLunch={false}>
                                    {tile ? (
                                      <div
                                        className="absolute inset-y-1 left-1 z-10"
                                        style={{ width: tile.slotSpan * SLOT_WIDTH - 6 }}
                                      >
                                        <SessionTile session={tile} therapistName={therapistName(tile.therapistId)} onClick={openEditSession} slotWidth={SLOT_WIDTH} onResize={handleResizeSession} />
                                      </div>
                                    ) : null}
                                  </GridCell>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <DragOverlay>
            {activeDrag ? (
              <div style={{ height: 40 }}>
                <SessionTile
                  session={activeDrag}
                  therapistName={therapistName(activeDrag.therapistId)}
                  slotWidth={SLOT_WIDTH}
                  isOverlay
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        )}

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-slate-200 bg-white px-4 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Legend</span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {THERAPY_TYPES.map((t) => {
              const meta = THERAPY_META[t];
              return (
                <div key={t} className="flex items-center gap-1.5">
                  <span
                    className="flex h-4 w-7 items-center justify-center rounded text-[9px] font-bold"
                    style={{ backgroundColor: meta.bg, color: meta.fg }}
                  >
                    {meta.label}
                  </span>
                  <span className="text-xs text-slate-600">{meta.full}</span>
                </div>
              );
            })}
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
          toast.success("Session deleted");
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
        onAdd={() => {
          setPatientDraft(null);
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
        onAdd={(name, teamId, therapyType) => {
          createTherapist.mutate({ name, teamId, therapyType });
          toast.success("Staff member added");
        }}
        onEdit={(id, name, teamId, therapyType) => {
          updateTherapist.mutate({ id, name, teamId, therapyType });
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
