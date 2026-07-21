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
import { Input } from "@/components/ui/input";
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
  SESSION_STATUSES,
  SESSION_STATUS_META,
  isMissedStatus,
  DELIVERY_MODES,
  type TherapyType,
  type SessionStatus,
  type DeliveryMode,
} from "@/lib/board";

export interface SessionFormValue {
  id?: number;
  patientId: number;
  therapyType: TherapyType;
  therapistId: number | null;
  slotIndex: number;
  durationMinutes: number;
  actualDurationMinutes?: number | null;
  deliveryMode: DeliveryMode;
  status: SessionStatus;
  missedReason?: string;
  notes: string;
}

interface SessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: SessionFormValue | null;
  patients: { id: number; name: string; roomNumber: string }[];
  therapists: { id: number; name: string; therapyType?: string }[];
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
  const [customDurationMode, setCustomDurationMode] = useState(false);

  useEffect(() => {
    setForm(initial);
    if (initial) {
      setCustomDurationMode(!DURATIONS.includes(initial.durationMinutes));
    }
  }, [initial]);

  if (!form) return null;

  const isEditing = Boolean(form.id);
  const patient = patients.find((p) => p.id === form.patientId);

  const maxDur = (TIME_SLOTS.length - form.slotIndex) * 30;
  const durationExceedsEndOfDay = form.durationMinutes > maxDur;
  const startSlot = TIME_SLOTS[form.slotIndex];
  const durationSpansLunch =
    !durationExceedsEndOfDay &&
    !!startSlot &&
    startSlot.hour < 12 &&
    form.slotIndex + form.durationMinutes / 30 > TIME_SLOTS.findIndex((s) => s.hour === 12);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md glass-panel p-6">
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
                    className={`rounded-md px-2 py-2 text-xs font-bold transition-all ${!active ? 'glass-surface text-slate-600' : ''}`}
                    style={{
                      ...(active ? { backgroundColor: meta.bg, color: meta.fg, outline: "2px solid rgba(0,0,0,0.15)" } : {})
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
            <Label>Duration (minutes)</Label>
            {customDurationMode ? (
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={form.durationMinutes}
                  onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
                  className="w-full"
                  min={1}
                />
                <Button type="button" variant="outline" onClick={() => {
                   setCustomDurationMode(false);
                   if (!DURATIONS.includes(form.durationMinutes)) {
                     setForm({ ...form, durationMinutes: DURATIONS[0] });
                   }
                }}>
                  Standard
                </Button>
              </div>
            ) : (
              <Select
                value={String(form.durationMinutes)}
                onValueChange={(v) => {
                  if (v === "custom") {
                    setCustomDurationMode(true);
                  } else {
                    setForm({ ...form, durationMinutes: Number(v) });
                  }
                }}
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
                  <SelectItem value="custom">Custom...</SelectItem>
                </SelectContent>
              </Select>
            )}
            {durationExceedsEndOfDay ? (
              <p className="text-xs text-red-500">Duration exceeds end of day.</p>
            ) : durationSpansLunch ? (
              <p className="text-xs text-orange-500">Warning: Session spans into lunch break.</p>
            ) : null}
          </div>

          {/* Therapist */}
          <div className="space-y-2">
            <Label>Therapist</Label>
            <Select
              value={form.therapistId ? String(form.therapistId) : "none"}
              onValueChange={(v) => {
                if (v === "none") {
                  setForm({ ...form, therapistId: null });
                } else {
                  const id = Number(v);
                  const selectedTherapist = therapists.find(t => t.id === id);
                  setForm({ 
                    ...form, 
                    therapistId: id,
                    ...(selectedTherapist?.therapyType && { therapyType: selectedTherapist.therapyType as TherapyType })
                  });
                }
              }}
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

          {/* Status */}
          <div className="space-y-2">
            <Label>Status</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["scheduled", "completed"] as const).map((s) => {
                const active = form.status === s;
                const meta = SESSION_STATUS_META[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm({ ...form, status: s, missedReason: undefined })}
                    className={`rounded-md px-2 py-2 text-xs font-bold transition-all ${!active ? 'glass-surface text-slate-600' : ''}`}
                    style={{
                      ...(active ? { backgroundColor: meta.bg, color: meta.fg, outline: "2px solid rgba(0,0,0,0.15)" } : {})
                    }}
                  >
                    {meta.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setForm({ ...form, status: isMissedStatus(form.status) ? form.status : "missed_other" })}
                className={`rounded-md px-2 py-2 text-xs font-bold transition-all ${!isMissedStatus(form.status) ? 'glass-surface text-slate-600' : ''}`}
                style={{
                  ...(isMissedStatus(form.status) ? { backgroundColor: "#fee2e2", color: "#991b1b", outline: "2px solid rgba(0,0,0,0.15)" } : {})
                }}
              >
                Missed
              </button>
            </div>
          </div>

          {/* Delivery Mode */}
          <div className="space-y-2">
            <Label>Delivery Mode</Label>
            <Select
              value={form.deliveryMode}
              onValueChange={(v) => setForm({ ...form, deliveryMode: v as DeliveryMode })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIVERY_MODES.map((m) => (
                  <SelectItem key={m} value={m} className="capitalize">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Missed reason code (required — this is what makes the status a specific missed_* value) */}
          {isMissedStatus(form.status) && (
            <div className="space-y-2">
              <Label className="text-red-600">Reason Code</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as SessionStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SESSION_STATUSES.filter(isMissedStatus).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SESSION_STATUS_META[s].label.replace("Missed — ", "")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={form.missedReason || ""}
                onChange={(e) => setForm({ ...form, missedReason: e.target.value })}
                placeholder="Optional note, e.g. patient in wheelchair for outing"
              />
            </div>
          )}

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
              disabled={durationExceedsEndOfDay}
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
