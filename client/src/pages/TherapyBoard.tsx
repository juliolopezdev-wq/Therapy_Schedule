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
import { SessionDialog, type SessionFormValue } from "@/components/board/SessionDialog";
import { PatientDialog, type PatientFormValue } from "@/components/board/PatientDialog";
import { PatientPanel } from "@/components/board/PatientPanel";
import { TherapistPanel } from "@/components/board/TherapistPanel";
import { MySchedule } from "@/components/board/MySchedule";
import { BoardHistoryDialog } from "@/components/board/BoardHistoryDialog";
import { TargetReachedDialog, type WeekSessionRow } from "@/components/board/TargetReachedDialog";
import { WeeklyMinutesPanel } from "@/components/board/WeeklyMinutesPanel";
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
  const [activeDrag, setActiveDrag] = useState<SessionTileData | null>(null);
  const [targetAlertData, setTargetAlertData] = useState<{
    patientName: string;
    target: number;
    totalMinutes: number;
    weekSessions: WeekSessionRow[];
  } | null>(null);

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
        notes: s.notes,
      };
    });
  }, [rawSessions]);

  // Conflict detection: same therapist overlapping in time, or same patient overlapping
  const conflictIds = useMemo(() => {
    const ids = new Set<number>();
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
          }
        }
      }
    });
    return ids;
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
        notes: value.notes,
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
        notes: value.notes,
      });
      toast.success("Session added");
    }
  }

  function savePatient(value: PatientFormValue) {
    if (value.id) {
      updatePatient.mutate({
        id: value.id,
        roomNumber: value.roomNumber,
        name: value.name,
        notes: value.notes,
        isDischarged: value.isDischarged,
        admissionDate: value.admissionDate || undefined,
        weeklyMinuteTarget: value.weeklyMinuteTarget ?? 900,
        teamId: value.teamId ?? null,
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
    saveSnapshot.mutate(
      {
        date: day,
        snapshot: { sessions: rawSessions, patients, flags },
      },
      {
        onSuccess: () => toast.success("Board snapshot saved"),
        onError: () => toast.error("Could not save snapshot"),
      },
    );
  }

  // Group patients by team and filter based on teamFilter selection
  const patientsBySection = useMemo(() => {
    const sectionsToRender = teamFilter === "all" ? teams : teams.filter(t => t.id === teamFilter);
    const result = sectionsToRender.map((section) => ({
      ...section,
      patients: patients.filter((p) => p.teamId === section.id),
    }));

    if (teamFilter === "all") {
      const unassigned = patients.filter(p => !p.teamId);
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
  }, [patients, teams, teamFilter]);

  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());

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
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
        {/* Primary toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 sm:px-6">
          {/* Logo */}
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <div className="hidden flex-col leading-none sm:flex">
              <span className="text-sm font-extrabold tracking-tight text-slate-900">PAM</span>
              <span className="text-[9px] font-semibold uppercase tracking-widest text-primary">Rehab Scheduler</span>
            </div>
          </div>

          <div className="mx-2 hidden h-5 w-px bg-slate-200 sm:block" />

          {/* Date navigation */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-500 hover:text-slate-800"
              onClick={() => setDay(addDays(day, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex min-w-[140px] items-center justify-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 sm:min-w-[200px]">
              <CalendarIcon className="h-3 w-3 shrink-0 text-primary" />
              <span className="hidden sm:inline">{formatLongDate(day)}</span>
              <span className="sm:hidden">{day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-500 hover:text-slate-800"
              onClick={() => setDay(addDays(day, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2.5 text-xs font-medium text-slate-500 hover:text-slate-800"
              onClick={() => setDay(startOfDay(new Date()))}
            >
              Today
            </Button>
          </div>

          <div className="flex-1" />

          {/* Live stats */}
          <div className="hidden items-center gap-3 md:flex">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
              <span className="tabular-nums font-semibold text-slate-700">{totalSessions}</span>
              <span>sessions today</span>
            </div>
            {patientsUnderTarget.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex cursor-pointer items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>{patientsUnderTarget.length} under target</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="end" className="w-80 p-0 overflow-hidden shadow-lg border-amber-200/60 bg-amber-50/95 backdrop-blur">
                  <div className="p-3 border-b border-amber-200/40 bg-amber-100/50">
                    <p className="font-semibold text-amber-900 text-sm">Patients Under Target</p>
                    <p className="text-xs text-amber-700/80 mt-0.5">Custom weekly targets based on admission</p>
                  </div>
                  <ScrollArea className="h-[300px]">
                    <ul className="p-3 space-y-2">
                      {patientsUnderTarget.map((p) => {
                        const mins = weekMinsByPatient.get(p.id) ?? 0;
                        const target = (p as any).weeklyMinuteTarget ?? 900;
                        const minsNeeded = Math.max(0, target - mins);
                        const hoursNeeded = (minsNeeded / 60).toFixed(1);
                        const bounds = getPatientWeekBounds((p as any).admissionDate, day);
                        const startLabel = bounds.start.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
                        const endLabel = bounds.end.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
                        const adminStr = (p as any).admissionDate;
                        const adminDate = adminStr ? new Date(`${adminStr}T12:00:00`) : null;
                        const adminLabel = adminDate 
                          ? adminDate.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" })
                          : "N/A";
                        
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
                              {adminStr ? (
                                <span>Ends: <span className="font-medium">{endLabel}</span></span>
                              ) : null}
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
              <div className="flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{conflictCount} conflict{conflictCount !== 1 ? "s" : ""}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                No conflicts
              </div>
            )}
          </div>

          <div className="mx-2 hidden h-5 w-px bg-slate-200 md:block" />

          {/* Action buttons */}
          <div className="flex items-center gap-1.5">

            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-200 font-medium text-slate-600 hover:bg-slate-50"
              onClick={() => setPanelOpen(true)}
            >
              <Users className="mr-1.5 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Patients</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-200 font-medium text-slate-600 hover:bg-slate-50"
              onClick={() => setStaffPanelOpen(true)}
            >
              <UserRound className="mr-1.5 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Staff</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-200 font-medium text-slate-600 hover:bg-slate-50"
              onClick={() => setWeeklyMinutesPanelOpen(true)}
            >
              <Clock className="mr-1.5 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Weekly Minutes</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-200 font-medium text-slate-600 hover:bg-slate-50"
              onClick={() => setAskSchedulerPanelOpen(true)}
            >
              <Bot className="mr-1.5 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Ask Scheduler</span>
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 border-slate-200 text-slate-500 hover:bg-slate-50"
                  onClick={handleSnapshot}
                >
                  <History className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save board snapshot</TooltipContent>
            </Tooltip>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-200 font-medium text-slate-600 hover:bg-slate-50"
              onClick={() => setHistoryOpen(true)}
            >
              History
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Discipline</span>
            <div className="flex items-center gap-0.5 rounded border border-slate-200 bg-white p-0.5">
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

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Team</span>
            <div className="flex flex-wrap items-center gap-0.5 rounded border border-slate-200 bg-white p-0.5">
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
      </header>

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
          <div className="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
            <div className="min-w-max">
              {/* Time header */}
              <div className="flex border-b border-slate-200 bg-slate-50">
                <div className="sticky left-0 z-20 flex w-64 shrink-0 items-center border-r border-slate-200 bg-slate-100 px-4 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
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
                        style={{ width: SLOT_WIDTH * 2 }}
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
                        isHour ? "border-slate-200" : "border-slate-100/50",
                      )}
                      style={{ width: SLOT_WIDTH }}
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
                        className="flex items-center border-b border-slate-200 sticky left-0"
                        style={{ 
                          borderTop: `3px solid ${section.color}`,
                          backgroundColor: `${section.color}0A`
                        }}
                      >
                        {/* Colored accent + label (sticky) */}
                        <div
                          className="sticky left-0 z-20 flex w-64 shrink-0 items-center gap-2 border-r border-slate-200 px-3 py-2"
                          style={{ backgroundColor: `${section.color}1A` }}
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
                        return (
                          <div key={patient.id} className={cn("group/row flex border-b border-slate-100 transition-colors last:border-b-0 hover:bg-slate-50/60", isDC && "bg-slate-200 opacity-60 grayscale")}>
                            {/* Patient label */}
                            <div
                              className={cn(
                                "sticky left-0 z-10 flex w-64 shrink-0 items-center justify-between gap-1.5 border-r border-slate-200 px-2 py-1 transition-colors",
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
                                  <span className="shrink-0 inline-flex min-w-[2rem] justify-center rounded border border-slate-200 bg-slate-100 px-1 text-[9px] font-bold tabular-nums text-slate-600">
                                    {patient.roomNumber}
                                  </span>
                                  {pFlags.map((f) => <FlagBadge key={f.id} flag={f.flagType} />)}
                                  {patient.notes && <span className="truncate text-[9px] italic text-slate-400 flex-1">{patient.notes}</span>}
                                </div>
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
                            </div>

                            {/* Time cells */}
                            {TIME_SLOTS.map((slot) => {
                              if (slot.hour === 12 && slot.minute === 30) return null;
                              const tile = tilesByPatientSlot.get(`${patient.id}-${slot.index}`);
                              const isOccupied = occupiedCells.has(`${patient.id}-${slot.index}`);

                              if (slot.hour === 12 && slot.minute === 0) {
                                return (
                                  <div key={slot.index} style={{ width: SLOT_WIDTH * 2 }} className="shrink-0">
                                    <GridCell patientId={patient.id} slotIndex={slot.index} onAdd={openNewSession} isAlternate={rowIdx % 2 !== 0} isLunch={true} />
                                  </div>
                                );
                              }
                              if (isOccupied) {
                                return <div key={slot.index} style={{ width: SLOT_WIDTH }} className="shrink-0 border-r border-slate-100" />;
                              }
                              return (
                                <div key={slot.index} style={{ width: SLOT_WIDTH }} className="shrink-0">
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

      <WeeklyMinutesPanel open={weeklyMinutesPanelOpen} onOpenChange={setWeeklyMinutesPanelOpen} />
      <AskSchedulerPanel open={askSchedulerPanelOpen} onOpenChange={setAskSchedulerPanelOpen} />

      <BoardHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />

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
        onAdd={(name, teamId) => {
          createTherapist.mutate({ name, teamId });
          toast.success("Staff member added");
        }}
        onDelete={(id) => {
          deleteTherapist.mutate({ id });
          toast.success("Staff member removed");
        }}
      />

      <BoardHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />

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
