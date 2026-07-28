import { useState } from "react";
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
import { Plus, Trash2, UserRound, Pencil, Clock, BarChart3, Calendar, Mail, Send, X, Loader2, ListChecks, TrendingUp, Repeat, UserPlus, ChevronDown, ChevronUp, Sparkles, Search, Filter, Users, CheckSquare, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { StaffAvailabilityModal } from "@/components/board/StaffAvailabilityModal";
import { Therapist } from "../../../../drizzle/schema";

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
    } catch (e) {}
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
    } catch (e) {}
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
  therapists: Therapist[];
  teams: Team[];
  onAdd: (data: TherapistFormData) => void;
  onEdit: (id: number, data: TherapistFormData) => void;
  onDelete: (id: number) => void;
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
};

export function TherapistPanel({
  open,
  onOpenChange,
  therapists,
  teams,
  onAdd,
  onEdit,
  onDelete,
  onViewStats,
  onOpenProductivityHub,
  onOpenWeekendStaffing,
  onSendTomorrowAssignments,
  sendingTomorrowAssignments,
  sendingTherapistIds,
}: TherapistPanelProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [disciplineFilter, setDisciplineFilter] = useState<string>("all");

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
    if (!name) return;
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
      } catch {}
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
    });
  }

  // Filter and group therapists by team & discipline
  const filteredTherapists = therapists.filter((t) => {
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDisc = disciplineFilter === "all" || t.therapyType === disciplineFilter;
    return matchesSearch && matchesDisc;
  });

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

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md glass-panel border-r-0 rounded-l-2xl">
          <SheetHeader className="glass-header p-5">
            <SheetTitle className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-slate-500" /> Staff Management
            </SheetTitle>
            <SheetDescription>
              Add and remove therapy staff by discipline and manage shift availability.
            </SheetDescription>
            {onOpenWeekendStaffing && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 h-8 w-full border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 font-bold"
                onClick={onOpenWeekendStaffing}
              >
                <Calendar className="mr-1.5 h-3.5 w-3.5" />
                Weekend Staffing
              </Button>
            )}
            {onSendTomorrowAssignments && (
              <div className="mt-2 space-y-1.5">
                {selectMode ? (
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 font-bold border-slate-200 text-slate-700 hover:bg-slate-100"
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
                      className="h-8 flex-1 bg-sky-600 text-white font-bold hover:bg-sky-700 disabled:opacity-60"
                      disabled={selectedIds.size === 0 || sendingTomorrowAssignments}
                      onClick={handleSendSelected}
                    >
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                      {sendingTomorrowAssignments ? "Sending…" : `Email (${selectedIds.size})`}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5"
                      title="Cancel selection"
                      onClick={toggleSelectMode}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 flex-1 border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 font-bold"
                      disabled={isBulkSending}
                      onClick={() => onSendTomorrowAssignments()}
                    >
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                      {isBulkSending ? "Sending…" : "Email Tomorrow's Assignments"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 text-slate-500"
                      title="Pick specific staff to email"
                      onClick={toggleSelectMode}
                    >
                      <ListChecks className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                {selectMode && (
                  <p className="text-[11px] text-slate-400 font-medium">
                    Select staff below using checkboxes or 'Select All', then send assignments.
                  </p>
                )}
              </div>
            )}
          </SheetHeader>

          {/* Add therapist form expandable section */}
          {!isFormExpanded && !editingId ? (
            <div className="border-b border-white/40 p-3.5 bg-slate-50/50">
              <Button
                type="button"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setEditingId(null);
                  setIsFormExpanded(true);
                }}
                className="w-full h-11 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white font-extrabold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-between px-3.5 group cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-white/20 text-white group-hover:scale-110 transition-transform">
                    <UserPlus className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-black tracking-wide">Add New Staff Member</span>
                </div>
                <div className="flex items-center gap-2 text-white/90">
                  <span className="text-[11px] font-black bg-white/25 px-2 py-0.5 rounded-full border border-white/30 backdrop-blur-xs">
                    + Staff
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                </div>
              </Button>
            </div>
          ) : (
            <div className="border-b border-white/40 p-4 space-y-3.5 bg-sky-50/40 transition-all duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-sky-100 text-sky-600">
                    {editingId ? <Pencil className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                  </div>
                  <p className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    {editingId ? "Edit Staff Details" : "New Staff Registration"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 font-semibold"
                  onClick={() => {
                    setIsFormExpanded(false);
                    handleCancelEdit();
                  }}
                >
                  <span>Collapse</span>
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="grid grid-cols-7 gap-2">
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs text-slate-500">Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="First Last"
                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs text-slate-500">Type</Label>
                  <Select
                    value={form.therapyType}
                    onValueChange={(v: "PT" | "OT" | "SLP") => setForm({ ...form, therapyType: v })}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PT">PT</SelectItem>
                      <SelectItem value="OT">OT</SelectItem>
                      <SelectItem value="SLP">SLP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs text-slate-500">Team</Label>
                  <Select
                    value={form.teamId}
                    onValueChange={(v) => setForm({ ...form, teamId: v })}
                  >
                    <SelectTrigger className="h-8 text-sm">
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

              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-xs text-slate-500">
                  <Mail className="h-3 w-3" /> Email
                </Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="name@example.com"
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  className="h-8 text-sm"
                />
                <p className="text-[11px] text-slate-400">Used to email next-day assignment notices.</p>
              </div>

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
                    <ToggleGroupItem key={o.value} value={o.value} className="h-7 flex-1 text-xs">
                      {o.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {form.employmentType !== "full_time" && (
                <div className="space-y-1.5 rounded-lg border border-sky-200/80 bg-sky-50/60 p-2.5">
                  <Label className="flex items-center gap-1 text-xs text-sky-700 font-bold">
                    <Repeat className="h-3 w-3 text-sky-600" /> Weekend Rotation (optional)
                  </Label>
                  <p className="text-[11px] text-slate-500">
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
                      <ToggleGroupItem key={d.value} value={d.value} className="h-7 flex-1 text-xs">
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
                          <SelectTrigger className="h-8 flex-1 text-sm">
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
                          className="h-8 w-36 text-sm"
                          title="A date that falls in an 'on' week"
                        />
                      </div>
                      <p className="text-[11px] font-semibold text-sky-700">
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
                    <ToggleGroupItem key={d.value} value={d.value} className="h-7 text-xs">
                      {d.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={form.workStartTime}
                    onChange={(e) => setForm({ ...form, workStartTime: e.target.value })}
                    className="h-8 text-sm"
                  />
                  <span className="text-xs text-slate-400">to</span>
                  <Input
                    type="time"
                    value={form.workEndTime}
                    onChange={(e) => setForm({ ...form, workEndTime: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Click any day chip below on a staff card to set specific per-day times.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1 h-8.5 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl shadow-xs"
                  disabled={!form.name.trim()}
                  onClick={handleSave}
                >
                  {editingId ? "Save Changes" : <><Plus className="mr-1.5 h-3.5 w-3.5" /> Add Staff Member</>}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8.5 rounded-xl text-xs font-semibold"
                  onClick={() => {
                    setIsFormExpanded(false);
                    handleCancelEdit();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Search & Discipline Filter Toolbar */}
          <div className="px-4 pt-3 pb-2 border-b border-slate-200/60 space-y-2 bg-slate-50/60">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Filter staff by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 text-xs pl-8 pr-8 rounded-xl bg-white border-slate-200 shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
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
                      "px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase transition-all cursor-pointer border",
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
              <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                {filteredTherapists.length} of {therapists.length}
              </span>
            </div>
          </div>

          {/* Therapist list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {therapists.length === 0 ? (
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
                  className="text-xs font-bold text-sky-600 hover:underline"
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
                    <div className="flex items-center justify-between px-1 mb-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Staff Directory ({filteredTherapists.length})
                      </span>
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={handleSelectAllToggle}
                          className="text-[11px] font-extrabold text-sky-600 hover:text-sky-700 transition-colors cursor-pointer flex items-center gap-1"
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
                          className="text-[11px] font-extrabold text-sky-600 hover:text-sky-700 transition-colors cursor-pointer"
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
                      className="rounded-2xl border border-white/60 glass-panel shadow-2xs overflow-hidden transition-all"
                    >
                      <button
                        type="button"
                        onClick={() => toggleTeamCollapse(teamKey)}
                        className="w-full flex items-center justify-between p-3 bg-slate-50/70 hover:bg-slate-100/70 transition-colors text-left cursor-pointer group"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="h-3 w-3 rounded-full shrink-0 shadow-2xs group-hover:scale-110 transition-transform border border-white/40"
                            style={{ backgroundColor: team.color }}
                          />
                          <span className="text-xs font-black uppercase tracking-wider text-slate-800">
                            {team.name}
                          </span>
                          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-white text-slate-600 border border-slate-200/80 shadow-2xs">
                            {members.length} {members.length === 1 ? "Staff Member" : "Staff Members"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400 group-hover:text-slate-700 transition-colors">
                          <span className="text-[10px] font-extrabold uppercase tracking-wide">
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
                        <div className="p-3 pt-2.5 border-t border-slate-100/80">
                          <ul className="space-y-2">
                            {members.map((t) => (
                              <TherapistRow
                                key={t.id}
                                therapist={t}
                                onDelete={onDelete}
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
                    <div className="rounded-2xl border border-white/60 glass-panel shadow-2xs overflow-hidden transition-all">
                      <button
                        type="button"
                        onClick={() => toggleTeamCollapse(unassignedKey)}
                        className="w-full flex items-center justify-between p-3 bg-slate-50/70 hover:bg-slate-100/70 transition-colors text-left cursor-pointer group"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="h-3 w-3 rounded-full shrink-0 bg-slate-400 shadow-2xs group-hover:scale-110 transition-transform" />
                          <span className="text-xs font-black uppercase tracking-wider text-slate-800">
                            Unassigned Staff
                          </span>
                          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-white text-slate-600 border border-slate-200/80 shadow-2xs">
                            {unassigned.length} {unassigned.length === 1 ? "Staff Member" : "Staff Members"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400 group-hover:text-slate-700 transition-colors">
                          <span className="text-[10px] font-extrabold uppercase tracking-wide">
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
                        <div className="p-3 pt-2.5 border-t border-slate-100/80">
                          <ul className="space-y-2">
                            {unassigned.map((t) => (
                              <TherapistRow
                                key={t.id}
                                therapist={t}
                                onDelete={onDelete}
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
  onDelete,
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
  therapist: Therapist;
  onDelete: (id: number) => void;
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
    } catch {}
  }

  return (
    <li
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border border-white/60 glass-surface p-3 transition-all hover:border-slate-300 hover:shadow-2xs",
        selectMode && selected && "border-sky-300 ring-1 ring-sky-200 bg-sky-50/50",
      )}
      onClick={selectMode ? () => onToggleSelected?.(therapist.id) : undefined}
      role={selectMode ? "button" : undefined}
    >
      <div className="flex items-center justify-between gap-2.5 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {selectMode && (
            <Checkbox
              checked={!!selected}
              onCheckedChange={() => onToggleSelected?.(therapist.id)}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0"
            />
          )}
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white shadow-2xs border border-white/30"
            style={{ backgroundColor: `hsl(${therapist.color || '210'}, 80%, 45%)` }}
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
              <span className="truncate text-sm font-extrabold text-slate-800">
                {therapist.name}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-micro font-extrabold border",
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
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-micro font-bold", EMPLOYMENT_TYPE_BADGE[employmentType])}>
                  {EMPLOYMENT_TYPE_LABEL[employmentType]}
                </span>
              )}
            </div>
            {scheduleSummary && (
              <span className="flex items-center gap-1 text-micro text-slate-500 font-medium mt-0.5">
                <Clock className="h-2.5 w-2.5 text-slate-400" /> {scheduleSummary}
              </span>
            )}
            {rotationSummary && (
              <span className="flex items-center gap-1 text-micro text-sky-600 font-semibold mt-0.5">
                <Repeat className="h-2.5 w-2.5 text-sky-500" /> {rotationSummary}
              </span>
            )}
          </div>
        </div>

        <div className={cn("flex items-center gap-0.5 shrink-0 bg-slate-100/70 p-0.5 rounded-xl border border-slate-200/60 shadow-2xs", selectMode && "hidden")}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-500 hover:text-sky-600 hover:bg-white rounded-lg transition-all"
            title="Edit Shift Hours & Availability"
            onClick={() => onOpenAvailability(therapist, 1)}
          >
            <Clock className="h-3.5 w-3.5 text-sky-600" />
          </Button>
          {onSendAssignments && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-500 hover:text-sky-600 hover:bg-white rounded-lg transition-all disabled:opacity-50"
              title={email ? `Email ${therapist.name}'s schedule for tomorrow` : "No email on file -- add one to enable"}
              disabled={!email || isSending}
              onClick={() => onSendAssignments([therapist.id])}
            >
              {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 text-sky-600" />}
            </Button>
          )}
          {onViewStats && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-500 hover:text-sky-600 hover:bg-white rounded-lg transition-all"
              title="View Staff Statistics"
              onClick={() => onViewStats(therapist.id)}
            >
              <BarChart3 className="h-3.5 w-3.5" />
            </Button>
          )}
          {onOpenProductivityHub && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-500 hover:text-emerald-600 hover:bg-white rounded-lg transition-all"
              title="View 81% Productivity Metrics"
              onClick={() => onOpenProductivityHub(therapist.id)}
            >
              <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-500 hover:text-slate-800 hover:bg-white rounded-lg transition-all"
            title="Edit Staff Member Details"
            onClick={() => onEditClick(therapist)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition-all"
                title="Remove Staff Member"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="glass-panel p-6">
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {therapist.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove them from the staff list. Existing sessions will remain but will show as unassigned.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700"
                  onClick={() => onDelete(therapist.id)}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Interactive Day Chips for Staff Availability */}
      <div className="flex items-center justify-between border-t border-slate-100/80 pt-2 mt-0.5">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Availability:</span>
        <div className="flex items-center gap-1">
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
                  "px-1.5 py-0.5 rounded-md text-[10px] font-extrabold transition-all cursor-pointer border select-none",
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
    </li>
  );
}
