import { useState } from "react";
import { usePermissions } from "@/_core/hooks/usePermissions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Plus, Archive, RotateCcw, UserRound, Pencil, Clock, BarChart3, Calendar, Mail, Send, X, Loader2, ListChecks, TrendingUp, Repeat, UserPlus, ChevronDown, ChevronUp, Search, Users, CheckSquare, Square, Link2, AlertTriangle, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { StaffAvailabilityModal } from "@/components/board/StaffAvailabilityModal";
import { Therapist } from "../../../../drizzle/schema";
import { trpc } from "@/lib/trpc";

/** `getTherapists()`/`listArchived()` left-join the linked login account, if any. */
export type TherapistWithUser = Therapist & {
  linkedUserEmail?: string | null;
  linkedUserRole?: string | null;
};

// 0=Sun..6=Sat, matching JS Date#getDay() -- what auto-placement compares against.
const DAY_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "Su" },
  { value: "1", label: "Mo" },
  { value: "2", label: "Tu" },
  { value: "3", label: "We" },
  { value: "4", label: "Th" },
  { value: "5", label: "Fr" },
  { value: "6", label: "Sa" },
];
const ALL_DAYS = DAY_OPTIONS.map((d) => d.value);
const DEFAULT_START_TIME = "07:00";
const DEFAULT_END_TIME = "18:00"; // matches the board's full grid (shared/timeGrid.ts)

export type EmploymentType = "full_time" | "part_time" | "prn";

const EMPLOYMENT_TYPE_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "prn", label: "PRN" },
];

const EMPLOYMENT_TYPE_BADGE: Record<EmploymentType, string> = {
  full_time: "bg-slate-100 text-slate-500",
  part_time: "bg-amber-50 text-amber-700",
  prn: "bg-violet-50 text-violet-700",
};

const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  prn: "PRN",
};

// Weekend rotation is scoped to Fri/Sat/Sun -- covers classic "every other weekend" (Sat+Sun) as
// well as "every other Friday" and similar single-day cycles, without opening up every day of
// the week (that's what the regular Works/workDays chips above are for).
const WEEKEND_DAY_OPTIONS: { value: string; label: string }[] = [
  { value: "5", label: "Fri" },
  { value: "6", label: "Sat" },
  { value: "0", label: "Sun" },
];

const ROTATION_INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "Every week" },
  { value: "2", label: "Every other week" },
  { value: "3", label: "Every 3rd week" },
  { value: "4", label: "Every 4th week" },
];

export interface WeekendRotationInput {
  days: number[];
  intervalWeeks: number;
  anchorDate: string;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Short client-side preview, e.g. "Every other week (Sat, Sun)" -- mirrors server/weekendRotation.ts's describeWeekendRotation. */
function describeRotationPreview(days: string[], intervalWeeks: string): string | null {
  if (days.length === 0) return null;
  const dayLabels = WEEKEND_DAY_OPTIONS.filter((d) => days.includes(d.value)).map((d) => d.label);
  const interval = Number(intervalWeeks);
  const freqLabel = ROTATION_INTERVAL_OPTIONS.find((o) => o.value === intervalWeeks)?.label ?? `Every ${interval}th week`;
  if (interval === 1) return `Every ${dayLabels.join("/")}`;
  return `${freqLabel} (${dayLabels.join(", ")})`;
}

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function staffAvatarColor(color: string | null | undefined): string {
  if (!color) return "#2563eb";
  const hue = Number(color);
  return Number.isFinite(hue) ? `hsl(${hue}, 75%, 42%)` : color;
}

/** Short "Mon–Fri 7:00 AM–3:00 PM" summary, or null if it's unrestricted (works every day, full board hours). */
function describeSchedule(t: Pick<Therapist, "workDays" | "workStartTime" | "workEndTime" | "workHours">): string | null {
  if ((t as any).workHours) {
    try {
      const parsed = JSON.parse((t as any).workHours);
      const activeDays = DAY_OPTIONS.filter((d) => parsed[d.value]?.active);
      if (activeDays.length === 0) return "No working days configured";
      const dayLabels = activeDays.map((d) => d.label);
      const daysText =
        dayLabels.length === 7
          ? "Every day"
          : dayLabels.length === 5 && !dayLabels.includes("Su") && !dayLabels.includes("Sa")
            ? "Mon–Fri"
            : dayLabels.join("/");
      const firstActive = parsed[activeDays[0].value];
      const sameShift = activeDays.every((d) => parsed[d.value]?.start === firstActive.start && parsed[d.value]?.end === firstActive.end);
      if (sameShift && firstActive) {
        return `${daysText} ${formatTime12h(firstActive.start)}–${formatTime12h(firstActive.end)}`;
      } else {
        return `${daysText} (Custom shift hours)`;
      }
    } catch (e) {
      console.warn("[TherapistPanel] Failed to parse workHours JSON:", e);
    }
  }
  const days = t.workDays ? t.workDays.split(",") : ALL_DAYS;
  const start = t.workStartTime ?? DEFAULT_START_TIME;
  const end = t.workEndTime ?? DEFAULT_END_TIME;
  if (days.length === 7 && start === DEFAULT_START_TIME && end === DEFAULT_END_TIME) return null;

  const dayLabels = DAY_OPTIONS.filter((d) => days.includes(d.value)).map((d) => d.label);
  const daysText =
    dayLabels.length === 7
      ? "Every day"
      : dayLabels.length === 5 && !dayLabels.includes("Su") && !dayLabels.includes("Sa")
        ? "Mon–Fri"
        : dayLabels.join("/");
  return `${daysText} ${formatTime12h(start)}–${formatTime12h(end)}`;
}

function getDayScheduleInfo(t: Therapist, dayIdx: number): { active: boolean; start: string; end: string } {
  if (t.workHours) {
    try {
      const parsed = JSON.parse(t.workHours);
      if (parsed[String(dayIdx)]) {
        return {
          active: !!parsed[String(dayIdx)].active,
          start: parsed[String(dayIdx)].start || DEFAULT_START_TIME,
          end: parsed[String(dayIdx)].end || DEFAULT_END_TIME,
        };
      }
    } catch (e) {
      console.warn("[TherapistPanel] Failed to parse workHours JSON:", e);
    }
  }
  const days = t.workDays ? t.workDays.split(",") : ALL_DAYS;
  const active = days.includes(String(dayIdx));
  return {
    active,
    start: t.workStartTime || DEFAULT_START_TIME,
    end: t.workEndTime || DEFAULT_END_TIME,
  };
}

interface Team {
  id: number;
  name: string;
  color: string;
}

interface WorkSchedule {
  workDays: number[] | null;
  workStartTime: string | null;
  workEndTime: string | null;
  workHours?: string | null;
}

export interface TherapistFormData {
  name: string;
  email: string | null;
  teamId: number | null;
  therapyType: "PT" | "OT" | "SLP";
  employmentType: EmploymentType;
  weekendRotation: WeekendRotationInput | null;
  schedule: WorkSchedule;
}

interface TherapistPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  therapists: TherapistWithUser[];
  archivedTherapists: TherapistWithUser[];
  teams: Team[];
  onAdd: (data: TherapistFormData) => void;
  onEdit: (id: number, data: TherapistFormData) => void;
  onArchive: (id: number, reason?: string) => void;
  onRestore: (id: number) => void;
  /** Invites `email` to log in with `role` -- offered inline when adding/editing staff with an
   *  email, so onboarding a new hire's profile and their login don't require two separate trips
   *  (Staff Management here, then the separate /admin/users page). */
  onInviteAsUser?: (email: string, role: "admin" | "team_lead" | "staff" | "viewer") => void;
  onOpenWeekendStaffing?: () => void;
  onViewStats?: (id: number) => void;
  onOpenProductivityHub?: (id?: number) => void;
  onSendTomorrowAssignments?: (therapistIds?: number[]) => void;
  sendingTomorrowAssignments?: boolean;
  /** Therapist ids currently in-flight for a send -- undefined/empty while nothing is sending, all ids while a bulk send is running. */
  sendingTherapistIds?: number[];
}

const EMPTY_FORM = {
  name: "",
  email: "",
  teamId: "none",
  therapyType: "PT" as "PT" | "OT" | "SLP",
  workDays: ALL_DAYS as string[],
  workStartTime: DEFAULT_START_TIME,
  workEndTime: DEFAULT_END_TIME,
  workHours: null as string | null,
  employmentType: "full_time" as EmploymentType,
  weekendDays: [] as string[],
  weekendInterval: "2",
  weekendAnchor: todayIso(),
  inviteAsUser: false,
  inviteRole: "staff" as "admin" | "team_lead" | "staff" | "viewer",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function TherapistPanel({
  open,
  onOpenChange,
  therapists,
  archivedTherapists,
  teams,
  onAdd,
  onEdit,
  onArchive,
  onRestore,
  onInviteAsUser,
  onViewStats,
  onOpenProductivityHub,
  onOpenWeekendStaffing,
  onSendTomorrowAssignments,
  sendingTomorrowAssignments,
  sendingTherapistIds,
}: TherapistPanelProps) {
  const { isAdmin, canEdit } = usePermissions();
  const [view, setView] = useState<"active" | "archived">("active");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [disciplineFilter, setDisciplineFilter] = useState<string>("all");

  const trimmedName = form.name.trim();
  const isDuplicateName = trimmedName.length > 0 && therapists.some(
    (t) => t.id !== editingId && t.name.trim().toLowerCase() === trimmedName.toLowerCase(),
  );
  const trimmedEmail = form.email.trim();
  const isEmailInvalid = trimmedEmail.length > 0 && !EMAIL_PATTERN.test(trimmedEmail);

  function toggleTeamCollapse(teamKey: string) {
    setCollapsedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamKey)) next.delete(teamKey);
      else next.add(teamKey);
      return next;
    });
  }

  // Picking specific staff to email their next-day schedule to.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSendSelected() {
    if (selectedIds.size === 0 || !onSendTomorrowAssignments) return;
    onSendTomorrowAssignments(Array.from(selectedIds));
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  // Only the bulk "everyone" send should show as busy on the bulk button -- an individual row
  // send or a select-mode send is tracked separately via sendingTherapistIds.
  const isBulkSending = !!sendingTomorrowAssignments && !sendingTherapistIds?.length;

  // Availability modal state
  const [availabilityTherapist, setAvailabilityTherapist] = useState<Therapist | null>(null);
  const [availabilityDayIndex, setAvailabilityDayIndex] = useState<number>(1);

  function handleOpenAvailability(therapist: Therapist, dayIdx: number = 1) {
    setAvailabilityTherapist(therapist);
    setAvailabilityDayIndex(dayIdx);
  }

  function handleSave() {
    const name = form.name.trim();
    if (!name || isDuplicateName || isEmailInvalid) return;
    const email = form.email.trim() || null;
    const teamIdVal = form.teamId === "none" ? null : Number(form.teamId);
    const isUnrestricted =
      form.workDays.length === 7 &&
      form.workStartTime === DEFAULT_START_TIME &&
      form.workEndTime === DEFAULT_END_TIME &&
      !form.workHours;
    const schedule: WorkSchedule = isUnrestricted
      ? { workDays: null, workStartTime: null, workEndTime: null, workHours: null }
      : {
          workDays: form.workDays.map(Number),
          workStartTime: form.workStartTime,
          workEndTime: form.workEndTime,
          workHours: form.workHours,
        };
    const weekendRotation: WeekendRotationInput | null =
      form.employmentType !== "full_time" && form.weekendDays.length > 0
        ? { days: form.weekendDays.map(Number), intervalWeeks: Number(form.weekendInterval), anchorDate: form.weekendAnchor }
        : null;
    const data: TherapistFormData = {
      name,
      email,
      teamId: teamIdVal,
      therapyType: form.therapyType,
      employmentType: form.employmentType,
      weekendRotation,
      schedule,
    };
    if (editingId) {
      onEdit(editingId, data);
      setEditingId(null);
    } else {
      onAdd(data);
    }
    if (email && form.inviteAsUser) {
      onInviteAsUser?.(email, form.inviteRole);
    }
    setForm(EMPTY_FORM);
    setIsFormExpanded(false);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setIsFormExpanded(false);
  }

  function handleEditClick(t: Therapist) {
    setEditingId(t.id);
    setIsFormExpanded(true);
    let weekendDays: string[] = [];
    let weekendInterval = "2";
    let weekendAnchor = todayIso();
    if ((t as any).weekendRotation) {
      try {
        const parsed = JSON.parse((t as any).weekendRotation);
        if (Array.isArray(parsed.days)) weekendDays = parsed.days.map(String);
        if (parsed.intervalWeeks) weekendInterval = String(parsed.intervalWeeks);
        if (parsed.anchorDate) weekendAnchor = parsed.anchorDate;
      } catch (e) {
        console.warn("[TherapistPanel] Failed to parse weekendRotation JSON:", e);
      }
    }
    setForm({
      name: t.name,
      email: (t as any).email ?? "",
      teamId: t.teamId ? String(t.teamId) : "none",
      therapyType: t.therapyType as "PT" | "OT" | "SLP",
      workDays: t.workDays ? t.workDays.split(",") : ALL_DAYS,
      workStartTime: t.workStartTime ?? DEFAULT_START_TIME,
      workEndTime: t.workEndTime ?? DEFAULT_END_TIME,
      workHours: t.workHours ?? null,
      employmentType: ((t as any).employmentType as EmploymentType) ?? "full_time",
      weekendDays,
      weekendInterval,
      weekendAnchor,
      inviteAsUser: false,
      inviteRole: "staff",
    });
  }

  // Filter by the fields staff coordinators actually remember: name, email, or team.
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const matchesStaffSearch = (therapist: TherapistWithUser) => {
    if (!normalizedSearch) return true;
    const teamName = teams.find((team) => team.id === therapist.teamId)?.name ?? "unassigned";
    return [therapist.name, therapist.email, therapist.linkedUserEmail, teamName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch));
  };

  // Filter and group therapists by team & discipline
  const filteredTherapists = therapists.filter((t) => {
    const matchesSearch = matchesStaffSearch(t);
    const matchesDisc = disciplineFilter === "all" || t.therapyType === disciplineFilter;
    return matchesSearch && matchesDisc;
  }).sort((a, b) => a.name.localeCompare(b.name));

  const allFilteredSelected =
    filteredTherapists.length > 0 &&
    filteredTherapists.every((t) => selectedIds.has(t.id));

  function handleSelectAllToggle() {
    if (!selectMode) setSelectMode(true);
    if (allFilteredSelected) {
      const next = new Set(selectedIds);
      filteredTherapists.forEach((t) => next.delete(t.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      filteredTherapists.forEach((t) => next.add(t.id));
      setSelectedIds(next);
    }
  }

  const grouped = teams.map((team) => ({
    team,
    members: filteredTherapists.filter((t) => t.teamId === team.id),
  }));
  const unassigned = filteredTherapists.filter((t) => t.teamId === null);

  const filteredArchived = archivedTherapists.filter((t) => {
    const matchesSearch = matchesStaffSearch(t);
    const matchesDisc = disciplineFilter === "all" || t.therapyType === disciplineFilter;
    return matchesSearch && matchesDisc;
  }).sort((a, b) => a.name.localeCompare(b.name));

  const disciplineCounts = {
    PT: therapists.filter((therapist) => therapist.therapyType === "PT").length,
    OT: therapists.filter((therapist) => therapist.therapyType === "OT").length,
    SLP: therapists.filter((therapist) => therapist.therapyType === "SLP").length,
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-slate-50 p-0 sm:max-w-xl lg:max-w-2xl [&>[data-slot=sheet-close]]:flex [&>[data-slot=sheet-close]]:h-10 [&>[data-slot=sheet-close]]:w-10 [&>[data-slot=sheet-close]]:items-center [&>[data-slot=sheet-close]]:justify-center [&>[data-slot=sheet-close]]:rounded-xl [&>[data-slot=sheet-close]]:border [&>[data-slot=sheet-close]]:border-white/30 [&>[data-slot=sheet-close]]:bg-white/15 [&>[data-slot=sheet-close]]:text-white [&>[data-slot=sheet-close]]:opacity-100 [&>[data-slot=sheet-close]]:shadow-sm [&>[data-slot=sheet-close]]:hover:bg-white/25 [&>[data-slot=sheet-close]]:focus:ring-white [&>[data-slot=sheet-close]>svg]:size-5">
          <SheetHeader className="border-b border-blue-700 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 p-5 pr-16 text-white">
            <div className="flex items-start gap-3 text-left">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
                <UserRound className="h-6 w-6 text-blue-100" />
              </div>
              <div>
                <SheetTitle className="text-xl font-bold text-white">Staff Management</SheetTitle>
                <SheetDescription className="mt-1 text-sm text-blue-100">
                  Manage the active roster, disciplines, availability, and staff access.
                </SheetDescription>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2" aria-label="Active staff summary">
              {[
                { label: "Active", value: therapists.length, tone: "text-white" },
                { label: "PT", value: disciplineCounts.PT, tone: "text-amber-200" },
                { label: "OT", value: disciplineCounts.OT, tone: "text-violet-200" },
                { label: "SLP", value: disciplineCounts.SLP, tone: "text-sky-200" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-left">
                  <div className={cn("text-lg font-bold tabular-nums", stat.tone)}>{stat.value}</div>
                  <div className="text-xs font-semibold text-blue-100">{stat.label}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
            {onOpenWeekendStaffing && (
              <Button
                size="sm"
                variant="outline"
                className="h-10 border-white/20 bg-white/10 font-semibold text-white hover:bg-white/20 hover:text-white"
                onClick={onOpenWeekendStaffing}
              >
                <Calendar className="mr-2 h-4 w-4" />
                Weekend Staffing
              </Button>
            )}
            {onSendTomorrowAssignments && canEdit && (
              <div className={cn("space-y-2", !onOpenWeekendStaffing && "col-span-2")}>
                {selectMode ? (
                  <div className="col-span-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10 border-white/20 bg-white/10 font-semibold text-white hover:bg-white/20 hover:text-white"
                      onClick={handleSelectAllToggle}
                    >
                      {allFilteredSelected ? (
                        <Square className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
                      ) : (
                        <CheckSquare className="mr-1.5 h-3.5 w-3.5 text-sky-600" />
                      )}
                      {allFilteredSelected ? "Deselect All" : "Select All"}
                    </Button>
                    <Button
                      size="sm"
                      className="h-10 flex-1 bg-white font-bold text-blue-900 hover:bg-blue-50 disabled:opacity-60"
                      disabled={selectedIds.size === 0 || sendingTomorrowAssignments}
                      onClick={handleSendSelected}
                    >
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                      {sendingTomorrowAssignments ? "Sending…" : `Email (${selectedIds.size})`}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10 w-10 border-white/20 bg-white/10 p-0 text-white hover:bg-white/20 hover:text-white"
                      title="Cancel selection"
                      onClick={toggleSelectMode}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10 flex-1 border-white/20 bg-white/10 font-semibold text-white hover:bg-white/20 hover:text-white"
                      disabled={isBulkSending}
                      onClick={() => onSendTomorrowAssignments()}
                    >
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                      {isBulkSending ? "Sending…" : "Email Tomorrow's Assignments"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10 w-10 border-white/20 bg-white/10 p-0 text-white hover:bg-white/20 hover:text-white"
                      title="Pick specific staff to email"
                      onClick={toggleSelectMode}
                    >
                      <ListChecks className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                {selectMode && (
                  <p className="text-xs font-medium text-blue-100">
                    Select staff below using checkboxes or 'Select All', then send assignments.
                  </p>
                )}
              </div>
            )}
            </div>
          </SheetHeader>

          {/* Add therapist form expandable section -- create/edit is admin-only on the backend */}
          {isAdmin && (!isFormExpanded && !editingId ? (
            <div className="border-b border-slate-200 bg-white p-4">
              <Button
                type="button"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setEditingId(null);
                  setIsFormExpanded(true);
                }}
                className="group flex h-11 w-full cursor-pointer items-center justify-between rounded-xl bg-blue-600 px-4 font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-white/15 p-1.5 text-white">
                    <UserPlus className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-bold">Add staff member</span>
                </div>
                <div className="flex items-center gap-2 text-white/90">
                  <ChevronDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                </div>
              </Button>
            </div>
          ) : (
            <div className="max-h-[52vh] space-y-4 overflow-y-auto border-b border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-blue-100 p-2 text-blue-700">
                    {editingId ? <Pencil className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                  </div>
                  <p className="text-sm font-bold text-slate-900">
                    {editingId ? "Edit staff details" : "New staff member"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex h-10 items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
                  onClick={() => {
                    setIsFormExpanded(false);
                    handleCancelEdit();
                  }}
                >
                  <span>Collapse</span>
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="First Last"
                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                    className="h-10 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Type</Label>
                  <Select
                    value={form.therapyType}
                    onValueChange={(v: "PT" | "OT" | "SLP") => setForm({ ...form, therapyType: v })}
                  >
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PT">PT</SelectItem>
                      <SelectItem value="OT">OT</SelectItem>
                      <SelectItem value="SLP">SLP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Team</Label>
                  <Select
                    value={form.teamId}
                    onValueChange={(v) => setForm({ ...form, teamId: v })}
                  >
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue placeholder="Team" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No team</SelectItem>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          <span className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: t.color }}
                            />
                            {t.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label className="flex items-center gap-1 text-xs text-slate-500">
                  <Mail className="h-3 w-3" /> Email
                </Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="name@example.com"
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  className={cn("h-10 text-sm", isEmailInvalid && "border-red-300 focus-visible:ring-red-300")}
                />
                {isEmailInvalid ? (
                  <p className="flex items-center gap-1 text-xs font-semibold text-red-600">
                    <AlertTriangle className="h-3 w-3" /> Enter a valid email address.
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">Used to email next-day assignment notices.</p>
                )}
                {!isEmailInvalid && trimmedEmail && onInviteAsUser && (
                  <div className="flex items-center gap-2 pt-1.5">
                    <Checkbox
                      id="invite-as-user"
                      checked={form.inviteAsUser}
                      onCheckedChange={(checked) => setForm({ ...form, inviteAsUser: Boolean(checked) })}
                    />
                    <Label htmlFor="invite-as-user" className="cursor-pointer text-xs font-semibold text-slate-700">
                      Also invite this email to log in
                    </Label>
                    {form.inviteAsUser && (
                      <Select
                        value={form.inviteRole}
                        onValueChange={(v: "admin" | "team_lead" | "staff" | "viewer") => setForm({ ...form, inviteRole: v })}
                      >
                        <SelectTrigger className="ml-auto h-10 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">admin</SelectItem>
                          <SelectItem value="team_lead">team lead</SelectItem>
                          <SelectItem value="staff">staff</SelectItem>
                          <SelectItem value="viewer">viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </div>
              {trimmedName && (
                isDuplicateName ? (
                  <p className="-mt-2 flex items-center gap-1 text-xs font-semibold text-red-600">
                    <AlertTriangle className="h-3 w-3" /> A staff member named "{trimmedName}" already exists.
                  </p>
                ) : null
              )}

              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Employment Type</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={form.employmentType}
                  onValueChange={(v: string) => v && setForm({ ...form, employmentType: v as EmploymentType })}
                  className="w-full"
                >
                  {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                    <ToggleGroupItem key={o.value} value={o.value} className="h-10 flex-1 text-xs">
                      {o.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {form.employmentType !== "full_time" && (
                <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <Label className="flex items-center gap-1 text-xs text-sky-700 font-bold">
                    <Repeat className="h-3 w-3 text-sky-600" /> Weekend Rotation (optional)
                  </Label>
                  <p className="text-xs text-slate-600">
                    For staff who only work certain weekends -- e.g. every other Sat/Sun, or every other Friday.
                  </p>
                  <ToggleGroup
                    type="multiple"
                    variant="outline"
                    size="sm"
                    value={form.weekendDays}
                    onValueChange={(v: string[]) => setForm({ ...form, weekendDays: v })}
                    className="w-full"
                  >
                    {WEEKEND_DAY_OPTIONS.map((d) => (
                      <ToggleGroupItem key={d.value} value={d.value} className="h-10 flex-1 text-xs">
                        {d.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {form.weekendDays.length > 0 && (
                    <>
                      <div className="flex items-center gap-2">
                        <Select
                          value={form.weekendInterval}
                          onValueChange={(v) => setForm({ ...form, weekendInterval: v })}
                        >
                          <SelectTrigger className="h-10 flex-1 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROTATION_INTERVAL_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="date"
                          value={form.weekendAnchor}
                          onChange={(e) => setForm({ ...form, weekendAnchor: e.target.value })}
                          className="h-10 w-40 text-sm"
                          title="A date that falls in an 'on' week"
                        />
                      </div>
                      <p className="text-xs font-semibold text-blue-800">
                        {describeRotationPreview(form.weekendDays, form.weekendInterval)} -- starting the week of {form.weekendAnchor}
                      </p>
                    </>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs text-slate-500">
                  <Clock className="h-3 w-3" /> Works
                </Label>
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  size="sm"
                  value={form.workDays}
                  onValueChange={(v: string[]) => setForm({ ...form, workDays: v })}
                  className="w-full"
                >
                  {DAY_OPTIONS.map((d) => (
                    <ToggleGroupItem key={d.value} value={d.value} className="h-10 flex-1 text-xs">
                      {d.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={form.workStartTime}
                    onChange={(e) => setForm({ ...form, workStartTime: e.target.value })}
                    className="h-10 text-sm"
                  />
                  <span className="text-xs text-slate-400">to</span>
                  <Input
                    type="time"
                    value={form.workEndTime}
                    onChange={(e) => setForm({ ...form, workEndTime: e.target.value })}
                    className="h-10 text-sm"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Click any day chip below on a staff card to set specific per-day times.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="h-11 flex-1 rounded-xl bg-blue-600 font-bold text-white shadow-sm hover:bg-blue-700"
                  disabled={!form.name.trim() || isDuplicateName || isEmailInvalid}
                  onClick={handleSave}
                >
                  {editingId ? "Save Changes" : <><Plus className="mr-1.5 h-3.5 w-3.5" /> Add Staff Member</>}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 rounded-xl px-4 text-xs font-semibold"
                  onClick={() => {
                    setIsFormExpanded(false);
                    handleCancelEdit();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ))}

          {/* Active / Archived tabs */}
          <div className="border-b border-slate-200 bg-white px-4 pt-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              {([
                { id: "active" as const, label: "Active", count: therapists.length },
                { id: "archived" as const, label: "Archived", count: archivedTherapists.length },
              ]).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setView(tab.id)}
                  className={cn(
                    "min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors",
                    view === tab.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
                  )}
                >
                  {tab.label} ({tab.count})
                </button>
              ))}
            </div>
          </div>

          {/* Search & Discipline Filter Toolbar */}
          <div className="space-y-3 border-b border-slate-200 bg-white px-4 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search name, email, or team..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 rounded-xl border-slate-300 bg-white pl-10 pr-10 text-sm shadow-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-1.5 top-0.5 flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                {(["all", "PT", "OT", "SLP"] as const).map((disc) => (
                  <button
                    key={disc}
                    type="button"
                    onClick={() => setDisciplineFilter(disc)}
                    className={cn(
                      "min-h-10 cursor-pointer rounded-lg border px-3 text-xs font-bold uppercase transition-colors",
                      disciplineFilter === disc
                        ? disc === "PT"
                          ? "bg-amber-100 text-amber-900 border-amber-300 shadow-2xs"
                          : disc === "OT"
                          ? "bg-purple-100 text-purple-900 border-purple-300 shadow-2xs"
                          : disc === "SLP"
                          ? "bg-sky-100 text-sky-900 border-sky-300 shadow-2xs"
                          : "bg-slate-900 text-white border-slate-800 shadow-2xs"
                        : "bg-white text-slate-500 border-slate-200/80 hover:bg-slate-100"
                    )}
                  >
                    {disc === "all" ? "All Staff" : disc}
                  </button>
                ))}
              </div>
              <span className="text-xs font-semibold tabular-nums text-slate-500">
                {view === "active"
                  ? `${filteredTherapists.length} of ${therapists.length}`
                  : `${filteredArchived.length} of ${archivedTherapists.length}`}
              </span>
            </div>
          </div>

          {/* Therapist list */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4">
            {view === "archived" ? (
              filteredArchived.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Archive className="h-8 w-8 text-slate-300" />
                  <p className="text-sm text-slate-500">
                    {archivedTherapists.length === 0 ? "No archived staff." : "No archived staff matching filters."}
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {filteredArchived.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/30 text-xs font-black text-white opacity-70 shadow-sm"
                          style={{ backgroundColor: staffAvatarColor(t.color) }}
                        >
                          {t.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <span className="truncate text-sm font-extrabold text-slate-700">{t.name}</span>
                          <p className="mt-0.5 text-xs font-medium text-slate-500">
                            {t.therapyType}
                            {t.archiveReason ? ` -- ${t.archiveReason}` : ""}
                          </p>
                        </div>
                      </div>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-10 shrink-0 text-xs font-semibold"
                          onClick={() => onRestore(t.id)}
                        >
                          <RotateCcw className="mr-1 h-3 w-3" /> Restore
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : therapists.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <UserRound className="h-8 w-8 text-slate-300" />
                <p className="text-sm text-slate-500">No staff added yet.</p>
              </div>
            ) : filteredTherapists.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <Users className="h-8 w-8 text-slate-300" />
                <p className="text-sm font-semibold text-slate-600">No staff matching filters</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setDisciplineFilter("all");
                  }}
                  className="min-h-10 rounded-lg px-3 text-xs font-bold text-blue-700 hover:bg-blue-50"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <>
                {(() => {
                  const activeTeamKeys = [
                    ...grouped.filter((g) => g.members.length > 0).map((g) => String(g.team.id)),
                    ...(unassigned.length > 0 ? ["unassigned"] : []),
                  ];
                  const allCollapsed = activeTeamKeys.length > 0 && activeTeamKeys.every((key) => collapsedTeams.has(key));

                  return (
                    <div className="mb-1 flex items-center justify-between px-1">
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Staff Directory ({filteredTherapists.length})
                      </span>
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={handleSelectAllToggle}
                          className="flex min-h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-50"
                        >
                          {allFilteredSelected ? (
                            <Square className="h-3 w-3 text-slate-400" />
                          ) : (
                            <CheckSquare className="h-3 w-3 text-sky-600" />
                          )}
                          {allFilteredSelected ? "Deselect All" : "Select All"}
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (allCollapsed) setCollapsedTeams(new Set());
                            else setCollapsedTeams(new Set(activeTeamKeys));
                          }}
                          className="min-h-9 cursor-pointer rounded-lg px-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-50"
                        >
                          {allCollapsed ? "Expand All" : "Collapse All"}
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {grouped.map(({ team, members }) => {
                  if (members.length === 0) return null;
                  const teamKey = String(team.id);
                  const isCollapsed = collapsedTeams.has(teamKey);

                  return (
                    <div
                      key={team.id}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => toggleTeamCollapse(teamKey)}
                        className="group flex min-h-12 w-full cursor-pointer items-center justify-between bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="h-3 w-3 rounded-full shrink-0 shadow-2xs group-hover:scale-110 transition-transform border border-white/40"
                            style={{ backgroundColor: team.color }}
                          />
                          <span className="text-sm font-bold text-slate-900">
                            {team.name}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600">
                            {members.length} {members.length === 1 ? "Staff Member" : "Staff Members"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400 group-hover:text-slate-700 transition-colors">
                          <span className="hidden text-xs font-bold sm:inline">
                            {isCollapsed ? "Expand" : "Collapse"}
                          </span>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 transition-transform duration-200",
                              isCollapsed ? "-rotate-90 text-slate-400" : "rotate-0 text-slate-600"
                            )}
                          />
                        </div>
                      </button>

                      {!isCollapsed && (
                        <div className="border-t border-slate-200 bg-white p-3">
                          <ul className="space-y-2">
                            {members.map((t) => (
                              <TherapistRow
                                key={t.id}
                                therapist={t}
                                onArchive={onArchive}
                                onEditClick={handleEditClick}
                                onViewStats={onViewStats}
                                onOpenProductivityHub={onOpenProductivityHub}
                                onOpenAvailability={handleOpenAvailability}
                                onSendAssignments={onSendTomorrowAssignments}
                                isSending={!!sendingTherapistIds?.includes(t.id)}
                                selectMode={selectMode}
                                selected={selectedIds.has(t.id)}
                                onToggleSelected={toggleSelected}
                              />
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}

                {unassigned.length > 0 && (() => {
                  const unassignedKey = "unassigned";
                  const isCollapsed = collapsedTeams.has(unassignedKey);

                  return (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <button
                        type="button"
                        onClick={() => toggleTeamCollapse(unassignedKey)}
                        className="group flex min-h-12 w-full cursor-pointer items-center justify-between bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="h-3 w-3 rounded-full shrink-0 bg-slate-400 shadow-2xs group-hover:scale-110 transition-transform" />
                          <span className="text-sm font-bold text-slate-900">
                            Unassigned Staff
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600">
                            {unassigned.length} {unassigned.length === 1 ? "Staff Member" : "Staff Members"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400 group-hover:text-slate-700 transition-colors">
                          <span className="hidden text-xs font-bold sm:inline">
                            {isCollapsed ? "Expand" : "Collapse"}
                          </span>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 transition-transform duration-200",
                              isCollapsed ? "-rotate-90 text-slate-400" : "rotate-0 text-slate-600"
                            )}
                          />
                        </div>
                      </button>

                      {!isCollapsed && (
                        <div className="border-t border-slate-200 bg-white p-3">
                          <ul className="space-y-2">
                            {unassigned.map((t) => (
                              <TherapistRow
                                key={t.id}
                                therapist={t}
                                onArchive={onArchive}
                                onEditClick={handleEditClick}
                                onViewStats={onViewStats}
                                onOpenProductivityHub={onOpenProductivityHub}
                                onOpenAvailability={handleOpenAvailability}
                                onSendAssignments={onSendTomorrowAssignments}
                                isSending={!!sendingTherapistIds?.includes(t.id)}
                                selectMode={selectMode}
                                selected={selectedIds.has(t.id)}
                                onToggleSelected={toggleSelected}
                              />
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Staff Availability & Schedule Modal */}
      <StaffAvailabilityModal
        open={availabilityTherapist !== null}
        onOpenChange={(open) => {
          if (!open) setAvailabilityTherapist(null);
        }}
        therapist={availabilityTherapist}
        initialDayIndex={availabilityDayIndex}
      />
    </>
  );
}

function TherapistRow({
  therapist,
  onArchive,
  onEditClick,
  onViewStats,
  onOpenProductivityHub,
  onOpenAvailability,
  onSendAssignments,
  isSending,
  selectMode,
  selected,
  onToggleSelected,
}: {
  therapist: TherapistWithUser;
  onArchive: (id: number, reason?: string) => void;
  onEditClick: (t: Therapist) => void;
  onViewStats?: (id: number) => void;
  onOpenProductivityHub?: (id?: number) => void;
  onOpenAvailability: (therapist: Therapist, dayIdx: number) => void;
  onSendAssignments?: (therapistIds?: number[]) => void;
  isSending?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelected?: (id: number) => void;
}) {
  const { isAdmin, canEdit, isTeamLead, teamId: viewerTeamId, therapistId: viewerTherapistId } = usePermissions();
  const canManageThisTherapist = isAdmin || (isTeamLead && therapist.teamId === viewerTeamId);
  const canViewThisTherapistAnalytics = isAdmin || therapist.id === viewerTherapistId;
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const sessionCountQuery = trpc.therapists.upcomingSessionCount.useQuery(
    { therapistId: therapist.id },
    { enabled: archiveDialogOpen },
  );
  const scheduleSummary = describeSchedule(therapist);
  const email = (therapist as any).email as string | null | undefined;
  const employmentType = ((therapist as any).employmentType as EmploymentType) ?? "full_time";
  const rotationRaw = (therapist as any).weekendRotation as string | null | undefined;
  let rotationSummary: string | null = null;
  if (rotationRaw) {
    try {
      const parsed = JSON.parse(rotationRaw);
      rotationSummary = describeRotationPreview(
        (parsed.days ?? []).map(String),
        String(parsed.intervalWeeks ?? 2),
      );
    } catch (e) {
      console.warn("[TherapistPanel] Failed to parse weekendRotation JSON:", e);
    }
  }

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 transition-colors hover:border-slate-300",
        selectMode && selected && "border-blue-400 bg-blue-50 ring-2 ring-blue-100",
      )}
      onClick={selectMode ? () => onToggleSelected?.(therapist.id) : undefined}
      role={selectMode ? "button" : undefined}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {selectMode && (
            <Checkbox
              checked={!!selected}
              onCheckedChange={() => onToggleSelected?.(therapist.id)}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0"
            />
          )}
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/30 text-sm font-black text-white shadow-sm"
            style={{ backgroundColor: staffAvatarColor(therapist.color) }}
          >
            {therapist.name
              .split(" ")
              .map((w) => w[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate flex-wrap">
              <span className="truncate text-base font-bold text-slate-950">
                {therapist.name}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-md border px-2 py-0.5 text-xs font-bold",
                  therapist.therapyType === "PT"
                    ? "bg-amber-50 text-amber-900 border-amber-200/80"
                    : therapist.therapyType === "OT"
                    ? "bg-purple-50 text-purple-900 border-purple-200/80"
                    : "bg-sky-50 text-sky-900 border-sky-200/80"
                )}
              >
                {therapist.therapyType}
              </span>
              {employmentType !== "full_time" && (
                <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-bold", EMPLOYMENT_TYPE_BADGE[employmentType])}>
                  {EMPLOYMENT_TYPE_LABEL[employmentType]}
                </span>
              )}
              {isAdmin && (
                therapist.linkedUserEmail ? (
                  <span
                    className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700"
                    title={`Can log in as ${therapist.linkedUserEmail} (${therapist.linkedUserRole})`}
                  >
                    <Link2 className="h-3.5 w-3.5" /> Linked
                  </span>
                ) : (
                  <span
                    className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500"
                    title="No login account linked -- roster entry only"
                  >
                    <KeyRound className="h-3.5 w-3.5" /> No login
                  </span>
                )
              )}
            </div>
            {scheduleSummary && (
              <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <Clock className="h-3.5 w-3.5 text-slate-400" /> {scheduleSummary}
              </span>
            )}
            {rotationSummary && (
              <span className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                <Repeat className="h-3.5 w-3.5 text-blue-500" /> {rotationSummary}
              </span>
            )}
          </div>
        </div>

        <div className={cn("flex shrink-0 items-center gap-1 self-end rounded-xl border border-slate-200 bg-slate-50 p-1 sm:self-start", selectMode && "hidden")}>
          {canManageThisTherapist && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-lg text-slate-600 transition-colors hover:bg-white hover:text-blue-700"
              aria-label={`Edit ${therapist.name}'s availability`}
              title="Edit Shift Hours, Availability & Email"
              onClick={() => onOpenAvailability(therapist, 1)}
            >
              <Clock className="h-4 w-4 text-blue-600" />
            </Button>
          )}
          {onSendAssignments && canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-lg text-slate-600 transition-colors hover:bg-white hover:text-blue-700 disabled:opacity-50"
              aria-label={`Email ${therapist.name}'s schedule`}
              title={email ? `Email ${therapist.name}'s schedule for tomorrow` : "No email on file -- add one to enable"}
              disabled={!email || isSending}
              onClick={() => onSendAssignments([therapist.id])}
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 text-blue-600" />}
            </Button>
          )}
          {onViewStats && canViewThisTherapistAnalytics && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-lg text-slate-600 transition-colors hover:bg-white hover:text-blue-700"
              aria-label={`View ${therapist.name}'s statistics`}
              title="View Staff Statistics"
              onClick={() => onViewStats(therapist.id)}
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
          )}
          {onOpenProductivityHub && canViewThisTherapistAnalytics && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-lg text-slate-600 transition-colors hover:bg-white hover:text-emerald-700"
              aria-label={`View ${therapist.name}'s productivity`}
              title="View 81% Productivity Metrics"
              onClick={() => onOpenProductivityHub(therapist.id)}
            >
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </Button>
          )}
          {isAdmin && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-lg text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                aria-label={`Edit ${therapist.name}`}
                title="Edit Staff Member Details"
                onClick={() => onEditClick(therapist)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 rounded-lg text-slate-500 transition-colors hover:bg-amber-50 hover:text-amber-800"
                    title="Archive Staff Member"
                    aria-label={`Archive ${therapist.name}`}
                    onClick={() => {
                      setArchiveReason("");
                      setArchiveDialogOpen(true);
                    }}
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-slate-200 bg-white p-6" onCloseAutoFocus={() => setArchiveDialogOpen(false)}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive {therapist.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      They will leave the active roster, but their sessions, productivity history,
                      and audit history will be retained. An admin can restore them later.
                      {sessionCountQuery.data
                        ? ` They are assigned to ${sessionCountQuery.data} current or upcoming session${sessionCountQuery.data === 1 ? "" : "s"}.`
                        : ""}
                    </AlertDialogDescription>
                    <Input
                      value={archiveReason}
                      onChange={(event) => setArchiveReason(event.target.value)}
                      placeholder="Reason (optional)"
                      maxLength={500}
                    />
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="h-11 bg-amber-600 hover:bg-amber-700"
                      onClick={() => onArchive(therapist.id, archiveReason || undefined)}
                    >
                      Archive
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>

      {/* Interactive Day Chips for Staff Availability -- editing is admin-only, same as the Clock icon above */}
      {isAdmin && (
        <div className="mt-0.5 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Availability</span>
          <div className="grid grid-cols-7 gap-1">
            {DAY_OPTIONS.map((d) => {
              const dayIdx = Number(d.value);
              const dayInfo = getDayScheduleInfo(therapist, dayIdx);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => onOpenAvailability(therapist, dayIdx)}
                  title={dayInfo.active ? `${d.label}: ${formatTime12h(dayInfo.start)} – ${formatTime12h(dayInfo.end)} (Click to edit)` : `${d.label}: Off (Click to edit)`}
                  className={cn(
                    "h-9 min-w-9 cursor-pointer select-none rounded-lg border px-2 text-xs font-bold transition-colors",
                    dayInfo.active
                      ? "bg-sky-50 text-sky-700 border-sky-200/80 hover:bg-sky-100 hover:border-sky-300 hover:shadow-2xs"
                      : "bg-slate-100/60 text-slate-400 border-slate-200/60 hover:bg-slate-100 hover:text-slate-600"
                  )}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </li>
  );
}
