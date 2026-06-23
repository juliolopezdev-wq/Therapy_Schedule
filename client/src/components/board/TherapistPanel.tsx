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
import { Plus, Trash2, UserRound } from "lucide-react";

interface Therapist {
  id: number;
  name: string;
  teamId: number | null;
}

interface Team {
  id: number;
  name: string;
  color: string;
}

interface TherapistPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  therapists: Therapist[];
  teams: Team[];
  onAdd: (name: string, teamId: number | null) => void;
  onDelete: (id: number) => void;
}

const EMPTY_FORM = { name: "", teamId: "none" };

export function TherapistPanel({
  open,
  onOpenChange,
  therapists,
  teams,
  onAdd,
  onDelete,
}: TherapistPanelProps) {
  const [form, setForm] = useState(EMPTY_FORM);

  function handleAdd() {
    const name = form.name.trim();
    if (!name) return;
    onAdd(name, form.teamId === "none" ? null : Number(form.teamId));
    setForm(EMPTY_FORM);
  }

  // Group therapists by team
  const grouped = teams.map((team) => ({
    team,
    members: therapists.filter((t) => t.teamId === team.id),
  }));
  const unassigned = therapists.filter((t) => t.teamId === null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-slate-200 p-5">
          <SheetTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-slate-500" /> Staff Management
          </SheetTitle>
          <SheetDescription>
            Add and remove therapy staff by discipline.
          </SheetDescription>
        </SheetHeader>

        {/* Add therapist form */}
        <div className="border-b border-slate-100 p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Add Staff</p>
          <div className="grid grid-cols-5 gap-2">
            <div className="col-span-3 space-y-1">
              <Label className="text-xs text-slate-500">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="First Last"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className="h-8 text-sm"
              />
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
          <Button
            size="sm"
            className="w-full h-8"
            disabled={!form.name.trim()}
            onClick={handleAdd}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Staff Member
          </Button>
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
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                        {team.name}
                      </span>
                      <span className="text-[10px] text-slate-400">({members.length})</span>
                    </div>
                    <ul className="space-y-1.5">
                      {members.map((t) => (
                        <TherapistRow key={t.id} therapist={t} onDelete={onDelete} />
                      ))}
                    </ul>
                  </div>
                )
              )}
              {unassigned.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-slate-300 shrink-0" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      Unassigned
                    </span>
                    <span className="text-[10px] text-slate-400">({unassigned.length})</span>
                  </div>
                  <ul className="space-y-1.5">
                    {unassigned.map((t) => (
                      <TherapistRow key={t.id} therapist={t} onDelete={onDelete} />
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
}: {
  therapist: Therapist;
  onDelete: (id: number) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
          {therapist.name
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </div>
        <span className="truncate text-sm font-medium text-slate-800">
          {therapist.name}
        </span>
      </div>
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
        <AlertDialogContent>
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
    </li>
  );
}
