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
import { Plus, Trash2, UserRound, Pencil, Clock, BarChart3 } from "lucide-react";

interface Therapist {
  id: number;
  name: string;
  therapyType: string;
  color: string;
  teamId: number | null;
  workDays?: string | null;
  workStartTime?: string | null;
  workEndTime?: string | null;
}

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

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Short "Mon–Fri 7:00 AM–3:00 PM" summary, or null if it's unrestricted (works every day, full board hours). */
function describeSchedule(t: Pick<Therapist, "workDays" | "workStartTime" | "workEndTime">): string | null {
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

interface Team {
  id: number;
  name: string;
  color: string;
}

interface WorkSchedule {
  workDays: number[] | null;
  workStartTime: string | null;
  workEndTime: string | null;
}

interface TherapistPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  therapists: Therapist[];
  teams: Team[];
  onAdd: (name: string, teamId: number | null, therapyType: "PT" | "OT" | "SLP", schedule: WorkSchedule) => void;
  onEdit: (id: number, name: string, teamId: number | null, therapyType: "PT" | "OT" | "SLP", schedule: WorkSchedule) => void;
  onDelete: (id: number) => void;
  onViewStats?: (id: number) => void;
}

const EMPTY_FORM = {
  name: "",
  teamId: "none",
  therapyType: "PT" as "PT" | "OT" | "SLP",
  workDays: ALL_DAYS as string[],
  workStartTime: DEFAULT_START_TIME,
  workEndTime: DEFAULT_END_TIME,
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
}: TherapistPanelProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);

  function handleSave() {
    const name = form.name.trim();
    if (!name) return;
    const teamIdVal = form.teamId === "none" ? null : Number(form.teamId);
    // Store "no restriction" as null rather than the literal default values -- otherwise a
    // therapist who never touched these fields would silently gain a hard cutoff at whatever
    // the grid's end hour happened to be the day they were added, even if the grid later grows.
    const isUnrestricted =
      form.workDays.length === 7 &&
      form.workStartTime === DEFAULT_START_TIME &&
      form.workEndTime === DEFAULT_END_TIME;
    const schedule: WorkSchedule = isUnrestricted
      ? { workDays: null, workStartTime: null, workEndTime: null }
      : {
          workDays: form.workDays.map(Number),
          workStartTime: form.workStartTime,
          workEndTime: form.workEndTime,
        };
    if (editingId) {
      onEdit(editingId, name, teamIdVal, form.therapyType, schedule);
      setEditingId(null);
    } else {
      onAdd(name, teamIdVal, form.therapyType, schedule);
    }
    setForm(EMPTY_FORM);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function handleEditClick(t: Therapist) {
    setEditingId(t.id);
    setForm({
      name: t.name,
      teamId: t.teamId ? String(t.teamId) : "none",
      therapyType: t.therapyType as "PT" | "OT" | "SLP",
      workDays: t.workDays ? t.workDays.split(",") : ALL_DAYS,
      workStartTime: t.workStartTime ?? DEFAULT_START_TIME,
      workEndTime: t.workEndTime ?? DEFAULT_END_TIME,
    });
  }

  // Group therapists by team
  const grouped = teams.map((team) => ({
    team,
    members: therapists.filter((t) => t.teamId === team.id),
  }));
  const unassigned = therapists.filter((t) => t.teamId === null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md glass-panel border-r-0 rounded-l-2xl">
        <SheetHeader className="glass-header p-5">
          <SheetTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-slate-500" /> Staff Management
          </SheetTitle>
          <SheetDescription>
            Add and remove therapy staff by discipline.
          </SheetDescription>
        </SheetHeader>

        {/* Add therapist form */}
        <div className="border-b border-white/40 p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            {editingId ? "Edit Staff" : "Add Staff"}
          </p>
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
              PAMi only auto-places this therapist within these days/hours. Select every day and 7:00 AM–5:00 PM for no restriction.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 h-8 bg-sky-600 hover:bg-sky-700 text-white font-bold"
              disabled={!form.name.trim()}
              onClick={handleSave}
            >
              {editingId ? "Save Changes" : <><Plus className="mr-1.5 h-3.5 w-3.5" /> Add Staff Member</>}
            </Button>
            {editingId && (
              <Button size="sm" variant="outline" className="h-8" onClick={handleCancelEdit}>
                Cancel
              </Button>
            )}
          </div>
        </div>

        {/* Therapist list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {therapists.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <UserRound className="h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">No staff added yet.</p>
            </div>
          ) : (
            <>
              {grouped.map(({ team, members }) =>
                members.length === 0 ? null : (
                  <div key={team.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: team.color }}
                      />
                      <span className="text-micro font-semibold uppercase tracking-widest text-slate-500">
                        {team.name}
                      </span>
                      <span className="text-micro text-slate-400">({members.length})</span>
                    </div>
                    <ul className="space-y-2">
                      {members.map((t) => (
                        <TherapistRow key={t.id} therapist={t} onDelete={onDelete} onEditClick={handleEditClick} onViewStats={onViewStats} />
                      ))}
                    </ul>
                  </div>
                )
              )}
              {unassigned.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-slate-300 shrink-0" />
                    <span className="text-micro font-semibold uppercase tracking-widest text-slate-500">
                      Unassigned
                    </span>
                    <span className="text-micro text-slate-400">({unassigned.length})</span>
                  </div>
                  <ul className="space-y-2">
                    {unassigned.map((t) => (
                      <TherapistRow key={t.id} therapist={t} onDelete={onDelete} onEditClick={handleEditClick} onViewStats={onViewStats} />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TherapistRow({
  therapist,
  onDelete,
  onEditClick,
  onViewStats,
}: {
  therapist: Therapist;
  onDelete: (id: number) => void;
  onEditClick: (t: Therapist) => void;
  onViewStats?: (id: number) => void;
}) {
  const scheduleSummary = describeSchedule(therapist);
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-white/40 glass-surface p-3">
      <div className="flex items-center gap-2 min-w-0">
        <div 
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm"
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
          <div className="flex items-center gap-2 truncate">
            <span className="truncate text-sm font-medium text-slate-800">
              {therapist.name}
            </span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-micro font-bold text-slate-400">
              {therapist.therapyType}
            </span>
          </div>
          {scheduleSummary && (
            <span className="flex items-center gap-1 text-micro text-slate-400">
              <Clock className="h-2.5 w-2.5" /> {scheduleSummary}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onViewStats && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-slate-400 hover:text-sky-600"
            title="View Staff Statistics"
            onClick={() => onViewStats(therapist.id)}
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-slate-400 hover:text-emerald-600"
          onClick={() => onEditClick(therapist)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-slate-400 hover:text-red-600"
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
    </li>
  );
}
