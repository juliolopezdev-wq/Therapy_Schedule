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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import {
  THERAPY_TYPES,
  THERAPY_META,
  TIME_SLOTS,
  type TherapyType,
} from "@/lib/board";

export interface SessionFormValue {
  id?: number;
  patientId: number;
  therapyType: TherapyType;
  therapistId: number | null;
  slotIndex: number;
  durationMinutes: number;
  notes: string;
}

interface SessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: SessionFormValue | null;
  patients: { id: number; name: string; roomNumber: string }[];
  therapists: { id: number; name: string }[];
  onSave: (value: SessionFormValue) => void;
  onDelete?: (id: number) => void;
}

const DURATIONS = [30, 60, 90, 120];

export function SessionDialog({
  open,
  onOpenChange,
  initial,
  patients,
  therapists,
  onSave,
  onDelete,
}: SessionDialogProps) {
  const [form, setForm] = useState<SessionFormValue | null>(initial);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  if (!form) return null;

  const isEditing = Boolean(form.id);
  const patient = patients.find((p) => p.id === form.patientId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Session" : "New Session"}</DialogTitle>
          <DialogDescription>
            {patient ? `${patient.name} · Room ${patient.roomNumber}` : "Schedule a therapy session"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Therapy type */}
          <div className="space-y-2">
            <Label>Therapy Type</Label>
            <div className="grid grid-cols-4 gap-2">
              {THERAPY_TYPES.map((t) => {
                const meta = THERAPY_META[t];
                const active = form.therapyType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, therapyType: t })}
                    className="rounded-md px-2 py-2 text-xs font-bold transition-all"
                    style={{
                      backgroundColor: active ? meta.bg : "#f1f5f9",
                      color: active ? meta.fg : "#64748b",
                      outline: active ? "2px solid rgba(0,0,0,0.15)" : "none",
                    }}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Start time */}
          <div className="space-y-2">
            <Label>Start Time</Label>
            <Select
              value={String(form.slotIndex)}
              onValueChange={(v) => {
                let duration = form.durationMinutes;
                const maxDur = (TIME_SLOTS.length - Number(v)) * 30;
                if (duration > maxDur) duration = maxDur;
                setForm({ ...form, slotIndex: Number(v), durationMinutes: duration });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_SLOTS.filter(s => s.hour !== 12).map((slot) => (
                  <SelectItem key={slot.index} value={String(slot.index)}>
                    {slot.shortLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label>Duration</Label>
            <Select
              value={String(form.durationMinutes)}
              onValueChange={(v) => setForm({ ...form, durationMinutes: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATIONS.filter(d => {
                  const maxDur = (TIME_SLOTS.length - form.slotIndex) * 30;
                  if (d > maxDur) return false;
                  
                  // Prevent spanning into lunch
                  const startSlot = TIME_SLOTS[form.slotIndex];
                  if (startSlot && startSlot.hour < 12) {
                    const endSlotIndex = form.slotIndex + (d / 30);
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

          {/* Therapist */}
          <div className="space-y-2">
            <Label>Therapist</Label>
            <Select
              value={form.therapistId ? String(form.therapistId) : "none"}
              onValueChange={(v) =>
                setForm({ ...form, therapistId: v === "none" ? null : Number(v) })
              }
            >
              <SelectTrigger>
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

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. 60 min ST, around meals only"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          {isEditing && onDelete ? (
            <Button
              variant="outline"
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => {
                onDelete(form.id!);
                onOpenChange(false);
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onSave(form);
                onOpenChange(false);
              }}
            >
              {isEditing ? "Save" : "Add Session"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
