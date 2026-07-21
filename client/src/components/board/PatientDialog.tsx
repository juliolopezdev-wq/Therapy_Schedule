import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  THERAPY_TYPES,
  THERAPY_META,
  TIME_SLOTS,
  type TherapyType,
} from "@/lib/board";
import { trpc } from "@/lib/trpc";
import { Trash2 } from "lucide-react";

export interface PatientFormValue {
  id?: number;
  roomNumber: string;
  name: string;
  notes: string;
  isDischarged: boolean;
  admissionDate?: string;
  estimatedDischargeDate?: string;
  weeklyMinuteTarget?: number;
  teamId?: number | null;
  sessionTime?: string;
  sessionType?: TherapyType;
  sessionDuration?: number;
  sessionTherapist?: number | null;
}

interface PatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: PatientFormValue | null;
  onSave: (value: PatientFormValue) => void;
  therapists?: { id: number; name: string }[];
  teams?: { id: number; name: string; color: string }[];
}

const EMPTY: PatientFormValue = {
  roomNumber: "",
  name: "",
  notes: "",
  isDischarged: false,
  admissionDate: "",
  estimatedDischargeDate: "",
  weeklyMinuteTarget: 900,
  teamId: null,
  sessionTime: "none",
  sessionType: "PT",
  sessionDuration: 30,
  sessionTherapist: null,
};

export function PatientDialog({ open, onOpenChange, initial, onSave, therapists = [], teams = [] }: PatientDialogProps) {
  const [form, setForm] = useState<PatientFormValue>(() => {
    const val = initial ?? EMPTY;
    return val.name === "Available" ? { ...val, name: "" } : val;
  });

  useEffect(() => {
    const val = initial ?? EMPTY;
    setForm(val.name === "Available" ? { ...val, name: "" } : val);
  }, [initial, open]);

  const isEditing = Boolean(form.id);
  const canSave = form.roomNumber.trim() && form.name.trim();

  // Additional Minutes Data
  const utils = trpc.useUtils();
  const { data: additionalMinutes = [] } = trpc.additionalMinutes.listByPatient.useQuery(
    { patientId: form.id as number },
    { enabled: isEditing }
  );
  const createAdditionalMinutes = trpc.additionalMinutes.create.useMutation({
    onSuccess: () => {
      utils.additionalMinutes.listByPatient.invalidate({ patientId: form.id as number });
      setNewAdjDate("");
      setNewAdjMinutes(0);
      setNewAdjReason("");
    },
  });
  const deleteAdditionalMinutes = trpc.additionalMinutes.delete.useMutation({
    onSuccess: () => {
      utils.additionalMinutes.listByPatient.invalidate({ patientId: form.id as number });
    },
  });

  const [newAdjDate, setNewAdjDate] = useState("");
  const [newAdjMinutes, setNewAdjMinutes] = useState(0);
  const [newAdjReason, setNewAdjReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md glass-panel p-6">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Patient" : "Add Patient"}</DialogTitle>
          <DialogDescription>
            Enter patient details and scheduling notes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Room</Label>
              <Input
                value={form.roomNumber}
                onChange={(e) => setForm({ ...form, roomNumber: e.target.value })}
                placeholder="106"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Patient Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Available"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Admission Date</Label>
              <Input
                type="date"
                value={form.admissionDate ?? ""}
                onChange={(e) => setForm({ ...form, admissionDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Est. Discharge</Label>
              <Input
                type="date"
                value={form.estimatedDischargeDate ?? ""}
                onChange={(e) => setForm({ ...form, estimatedDischargeDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Target (min)</Label>
              <Input
                type="number"
                min={0}
                step={30}
                value={form.weeklyMinuteTarget ?? 900}
                onChange={(e) => setForm({ ...form, weeklyMinuteTarget: Number(e.target.value) })}
              />
            </div>
          </div>

          {teams.length > 0 && (
            <div className="space-y-2">
              <Label>Team / Discipline</Label>
              <Select
                value={form.teamId ? String(form.teamId) : "none"}
                onValueChange={(v) => setForm({ ...form, teamId: v === "none" ? null : Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Scheduling Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. around meals only, 3x/wk, 60 min ST"
              rows={2}
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="discharged"
              checked={form.isDischarged}
              onCheckedChange={(checked) => setForm({ ...form, isDischarged: checked })}
            />
            <Label htmlFor="discharged" className="cursor-pointer font-normal text-slate-700">
              Mark as Discharged (DC)
            </Label>
          </div>

          {isEditing && (
            <div className="rounded-lg glass-surface p-5 space-y-4 mt-6">
              <div className="border-b border-white/20 pb-3">
                <Label className="text-base font-semibold text-slate-800">Daily Minute Adjustments</Label>
                <p className="text-xs text-slate-500 mt-1">Add or subtract extra target minutes for specific dates.</p>
              </div>

              {additionalMinutes.length > 0 ? (
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {additionalMinutes.map((adj) => (
                    <div key={adj.id} className="flex items-center justify-between glass-surface p-2.5 rounded-md text-sm">
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-slate-700 min-w-[70px]">
                          {new Date(adj.date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                        </span>
                        <span className={`font-bold ${adj.additionalMinutes > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {adj.additionalMinutes > 0 ? `+${adj.additionalMinutes}` : adj.additionalMinutes} min
                        </span>
                        {adj.reason && <span className="text-slate-500 italic text-xs truncate max-w-[120px]">({adj.reason})</span>}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        onClick={() => deleteAdditionalMinutes.mutate({ id: adj.id })}
                        disabled={deleteAdditionalMinutes.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center border-2 border-dashed border-white/40 rounded-md glass-surface">
                  <p className="text-sm text-slate-500 italic">No adjustments currently.</p>
                </div>
              )}

              <div className="flex flex-col gap-3 pt-3 border-t border-slate-200/60">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">Date</Label>
                    <Input className="h-9" type="date" value={newAdjDate} onChange={(e) => setNewAdjDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">Minutes (+ or -)</Label>
                    <Input className="h-9" type="number" step={15} value={newAdjMinutes} onChange={(e) => setNewAdjMinutes(Number(e.target.value))} />
                  </div>
                </div>
                <div className="flex items-end gap-3">
                  <div className="space-y-1.5 flex-1">
                    <Label className="text-xs font-semibold text-slate-600">Reason (optional)</Label>
                    <Input className="h-9" placeholder="e.g. Missed session makeup" value={newAdjReason} onChange={(e) => setNewAdjReason(e.target.value)} />
                  </div>
                  <Button
                    size="sm"
                    className="h-9 px-5 shadow-sm"
                    disabled={!newAdjDate || newAdjMinutes === 0 || createAdditionalMinutes.isPending}
                    onClick={() => {
                      const dateObj = new Date(newAdjDate + "T12:00:00");
                      createAdditionalMinutes.mutate({
                        patientId: form.id as number,
                        date: dateObj,
                        additionalMinutes: newAdjMinutes,
                        reason: newAdjReason || undefined,
                      });
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Initial Session Scheduling (Optional) */}
          {!isEditing && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4 mt-6">
              <div className="border-b border-slate-200 pb-2">
                <Label className="text-sm font-bold text-slate-700">Initial Therapy Session (Optional)</Label>
                <p className="text-xs text-slate-500">Schedule a session directly to the board.</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Time</Label>
                  <Select
                    value={form.sessionTime}
                    onValueChange={(v) => {
                      let duration = form.sessionDuration || 30;
                      if (v !== "none") {
                        const maxDur = (TIME_SLOTS.length - Number(v)) * 30;
                        if (duration > maxDur) duration = maxDur;
                      }
                      setForm({ ...form, sessionTime: v, sessionDuration: duration });
                    }}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder="Do not schedule" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Do not schedule</SelectItem>
                      {TIME_SLOTS.filter(s => s.hour !== 12).map((slot) => (
                        <SelectItem key={slot.index} value={String(slot.index)}>
                          {slot.shortLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Duration</Label>
                  <Select
                    disabled={form.sessionTime === "none"}
                    value={String(form.sessionDuration)}
                    onValueChange={(v) => setForm({ ...form, sessionDuration: Number(v) })}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[30, 60, 90, 120].filter(d => {
                        if (form.sessionTime === "none") return true;
                        const maxDur = (TIME_SLOTS.length - Number(form.sessionTime)) * 30;
                        if (d > maxDur) return false;
                        
                        // Prevent spanning into lunch
                        const startSlot = TIME_SLOTS[Number(form.sessionTime)];
                        if (startSlot && startSlot.hour < 12) {
                          const endSlotIndex = Number(form.sessionTime) + (d / 30);
                          const firstLunchIndex = TIME_SLOTS.findIndex(s => s.hour === 12);
                          if (endSlotIndex > firstLunchIndex) return false;
                        }
                        return true;
                      }).map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d} minutes
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Therapy Type</Label>
                <div className="grid grid-cols-4 gap-2">
                  {THERAPY_TYPES.map((t) => {
                    const meta = THERAPY_META[t];
                    const active = form.sessionType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={form.sessionTime === "none"}
                        onClick={() => setForm({ ...form, sessionType: t })}
                        className="rounded-md px-2 py-2 text-xs font-bold transition-all disabled:opacity-50"
                        style={{
                          backgroundColor: active ? meta.bg : "#ffffff",
                          color: active ? meta.fg : "#64748b",
                          outline: active ? "2px solid rgba(0,0,0,0.15)" : "1px solid #e2e8f0",
                        }}
                      >
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Therapist (Optional)</Label>
                <Select
                  disabled={form.sessionTime === "none"}
                  value={form.sessionTherapist ? String(form.sessionTherapist) : "none"}
                  onValueChange={(v) =>
                    setForm({ ...form, sessionTherapist: v === "none" ? null : Number(v) })
                  }
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {therapists.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => {
              onSave(form);
              onOpenChange(false);
            }}
          >
            {isEditing ? "Save" : "Add Patient"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
