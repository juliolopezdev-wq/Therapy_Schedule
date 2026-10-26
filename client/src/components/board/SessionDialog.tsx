import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
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
import { CheckCircle2, History, Loader2, LogOut, RotateCcw, Trash2 } from "lucide-react";
import {
  TIME_SLOTS,
  SESSION_STATUSES,
  SESSION_STATUS_META,
  isMissedStatus,
  isEvaluationTherapyType,
  therapyDiscipline,
  dateToSlotIndex,
  slotIndexToDate,
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
  referenceDate: Date;
  onSave: (value: SessionFormValue) => void;
  onDelete?: (id: number) => void;
  /** Viewer role -- show details but hide Save/Delete. */
  readOnly?: boolean;
  /** Staff may document outcomes, minutes, and notes without changing the appointment. */
  chartOnly?: boolean;
  /** A view-only clinician may verify only their own scheduled session as completed. */
  canComplete?: boolean;
  isCompleting?: boolean;
  onComplete?: (id: number) => void;
  /** A view-only clinician may correct an accidental completion on their own session. */
  canUndoComplete?: boolean;
  isUndoingCompletion?: boolean;
  onUndoComplete?: (id: number) => void;
  /** Patient-level notice only; it does not discharge the admission or alter session minutes. */
  dischargeAt?: Date | null;
  isUpdatingDischargeToday?: boolean;
  onSetDischargeTime?: (value: Date | null) => void;
  /** Therapist assigned immediately before the latest call-off coverage change. */
  previousTherapistName?: string;
}

const DURATIONS = [30, 60, 90, 120];

export function SessionDialog({
  open,
  onOpenChange,
  initial,
  patients,
  therapists,
  referenceDate,
  onSave,
  onDelete,
  readOnly = false,
  chartOnly = false,
  canComplete = false,
  isCompleting = false,
  onComplete,
  canUndoComplete = false,
  isUndoingCompletion = false,
  onUndoComplete,
  dischargeAt = null,
  isUpdatingDischargeToday = false,
  onSetDischargeTime,
  previousTherapistName,
}: SessionDialogProps) {
  const [form, setForm] = useState<SessionFormValue | null>(initial);
  const [customDurationMode, setCustomDurationMode] = useState(false);
  const [dismissedCarryForward, setDismissedCarryForward] = useState(false);
  const [dischargeSlot, setDischargeSlot] = useState(12); // 1:00 PM

  useEffect(() => {
    setForm(initial);
    setDismissedCarryForward(false);
    if (initial) {
      setCustomDurationMode(!DURATIONS.includes(initial.durationMinutes));
    }
  }, [initial]);

  useEffect(() => {
    if (dischargeAt) setDischargeSlot(dateToSlotIndex(new Date(dischargeAt)));
    else setDischargeSlot(12);
  }, [dischargeAt, open]);

  const isEditing = Boolean(form?.id);

  const lastNoteQuery = trpc.sessions.lastNote.useQuery(
    {
      patientId: form?.patientId ?? 0,
      therapyType: form?.therapyType ?? "PT",
      referenceDate,
      excludeSessionId: form?.id,
    },
    { enabled: open && !isEditing && !!form && form.therapyType !== "Block" },
  );
  const lastNote = lastNoteQuery.data;
  const showCarryForward =
    !isEditing && !dismissedCarryForward && !!lastNote && !form?.notes;

  if (!form) return null;

  const patient = patients.find((p) => p.id === form.patientId);
  const requiredDiscipline = therapyDiscipline(form.therapyType);
  const eligibleTherapists = requiredDiscipline
    ? therapists.filter((therapist) => therapist.therapyType === requiredDiscipline)
    : therapists;

  const selectedTherapistDiscipline = therapists.find((therapist) => therapist.id === form.therapistId)?.therapyType;
  const currentDiscipline = therapyDiscipline(form.therapyType)
    ?? (selectedTherapistDiscipline === "PT" || selectedTherapistDiscipline === "OT" || selectedTherapistDiscipline === "SLP"
      ? selectedTherapistDiscipline
      : "PT");
  const visitKind = form.therapyType === "Block"
    ? "block"
    : isEvaluationTherapyType(form.therapyType)
      ? "evaluation"
      : "treatment";

  const evaluationTypeByDiscipline = {
    PT: "PT Eval",
    OT: "OT Eval",
    SLP: "SLP Eval",
  } as const;

  const chooseTherapyType = (therapyType: TherapyType) => {
    const discipline = therapyDiscipline(therapyType);
    const selectedTherapist = therapists.find((therapist) => therapist.id === form.therapistId);
    const therapistId = discipline && selectedTherapist?.therapyType !== discipline
      ? null
      : form.therapistId;
    setForm({ ...form, therapyType, therapistId });
  };

  const chooseVisitKind = (kind: "treatment" | "evaluation" | "block") => {
    if (kind === "block") {
      chooseTherapyType("Block");
      return;
    }
    chooseTherapyType(kind === "evaluation" ? evaluationTypeByDiscipline[currentDiscipline] : currentDiscipline);
  };

  const chooseDiscipline = (discipline: "PT" | "OT" | "SLP") => {
    chooseTherapyType(visitKind === "evaluation" ? evaluationTypeByDiscipline[discipline] : discipline);
  };

  const maxDur = (TIME_SLOTS.length - form.slotIndex) * 30;
  const durationIsValid = Number.isInteger(form.durationMinutes) && form.durationMinutes > 0;
  const durationExceedsEndOfDay = form.durationMinutes > maxDur;
  const startSlot = TIME_SLOTS[form.slotIndex];
  const durationSpansLunch =
    !durationExceedsEndOfDay &&
    !!startSlot &&
    startSlot.hour < 12 &&
    form.slotIndex + form.durationMinutes / 30 > TIME_SLOTS.findIndex((s) => s.hour === 12);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white p-5 sm:max-w-lg sm:p-6">
        <DialogHeader>
          <DialogTitle>{chartOnly ? "Chart Session" : isEditing ? "Edit Session" : "New Session"}</DialogTitle>
          <DialogDescription>
            {patient ? `${patient.name} · Room ${patient.roomNumber}` : "Schedule a therapy session"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Visit type and discipline are selected independently, then mapped to the stored
              PT/OT/SLP or discipline-specific evaluation session type. */}
          <div className="space-y-2">
            <Label>Visit Type</Label>
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: "treatment", label: "Treatment" },
                    { value: "evaluation", label: "Evaluation" },
                    { value: "block", label: "Block Time" },
                  ] as const).map((option) => {
                    const active = visitKind === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={readOnly || chartOnly}
                        onClick={() => chooseVisitKind(option.value)}
                        aria-pressed={active}
                        className={`min-h-10 rounded-lg border px-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50"}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {visitKind !== "block" && (
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Discipline</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["PT", "OT", "SLP"] as const).map((discipline) => {
                      const active = currentDiscipline === discipline;
                      return (
                        <button
                          key={discipline}
                          type="button"
                          disabled={readOnly || chartOnly}
                          onClick={() => chooseDiscipline(discipline)}
                          aria-pressed={active}
                          className={`min-h-10 rounded-lg border px-2 text-xs font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? "border-slate-800 bg-slate-800 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100"}`}
                        >
                          {discipline}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {form.therapyType === "Eval" ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-tight text-amber-800">
                  This older evaluation has no discipline. Choose PT, OT, or SLP before saving.
                </div>
              ) : null}
            </div>
          </div>

          {onSetDischargeTime && (
            <div className={`rounded-xl border p-3 ${dischargeAt ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`flex items-center gap-2 text-sm font-bold ${dischargeAt ? "text-rose-900" : "text-slate-900"}`}>
                    <LogOut className="h-4 w-4" /> D/C Today
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Sessions at or after this time will be visually flagged. They are canceled only when the admission is formally discharged.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Select value={String(dischargeSlot)} onValueChange={(value) => setDischargeSlot(Number(value))} disabled={readOnly || chartOnly || isUpdatingDischargeToday}>
                  <SelectTrigger className="h-10 flex-1 border-rose-200 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_SLOTS.map((slot) => <SelectItem key={slot.index} value={String(slot.index)}>{slot.shortLabel}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant={dischargeAt ? "destructive" : "outline"}
                  className="h-10 shrink-0"
                  disabled={readOnly || chartOnly || isUpdatingDischargeToday}
                  onClick={() => onSetDischargeTime(slotIndexToDate(referenceDate, dischargeSlot))}
                >
                  {isUpdatingDischargeToday ? <Loader2 className="h-4 w-4 animate-spin" /> : dischargeAt ? "Update" : "Mark"}
                </Button>
                {dischargeAt && (
                  <Button type="button" variant="ghost" className="h-10 shrink-0 text-slate-600" disabled={readOnly || chartOnly || isUpdatingDischargeToday} onClick={() => onSetDischargeTime(null)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Start time */}
          <div className="space-y-2">
            <Label>Start Time</Label>
            <Select
              disabled={readOnly || chartOnly}
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
                  disabled={readOnly || chartOnly}
                  type="number"
                  value={form.durationMinutes}
                  onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
                  className="w-full"
                  min={1}
                  step={1}
                />
                <Button type="button" variant="outline" disabled={readOnly || chartOnly} onClick={() => {
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
                disabled={readOnly || chartOnly}
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
            {!durationIsValid ? (
              <p className="text-xs text-red-500">Enter a positive whole number of minutes.</p>
            ) : durationExceedsEndOfDay ? (
              <p className="text-xs text-red-500">Duration exceeds end of day.</p>
            ) : durationSpansLunch ? (
              <p className="text-xs text-orange-500">Warning: Session spans into lunch break.</p>
            ) : null}
          </div>

          {/* Therapist */}
          <div className="space-y-2">
            <Label>Therapist</Label>
            <Select
              disabled={readOnly || chartOnly}
              value={form.therapistId ? String(form.therapistId) : "none"}
              onValueChange={(v) => {
                if (v === "none") {
                  setForm({ ...form, therapistId: null });
                } else {
                  const id = Number(v);
                  setForm({ ...form, therapistId: id });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {eligibleTherapists.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}{t.therapyType ? ` · ${t.therapyType}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEditing && (
              <div
                className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                role="status"
                aria-label="Assignment history"
              >
                <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-600">
                  <History className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                  Previous assignment
                </span>
                <span className={`truncate text-right text-xs font-bold ${previousTherapistName ? "text-slate-900" : "text-slate-500"}`}>
                  {previousTherapistName ?? "None recorded"}
                </span>
              </div>
            )}
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>Status</Label>
            {form.status === "canceled_discharge" && (
              <div className="flex gap-2 rounded-lg border border-slate-300 bg-slate-100 p-3 text-slate-700">
                <LogOut className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-xs leading-relaxed">
                  <strong>Canceled because the patient was discharged.</strong> If treatment actually occurred, choose Completed and enter the delivered minutes. Choose Scheduled only to restore the appointment.
                </p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {(["scheduled", "completed"] as const).map((s) => {
                const active = form.status === s;
                const meta = SESSION_STATUS_META[s];
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={readOnly}
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
                disabled={readOnly}
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
              disabled={readOnly || chartOnly}
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
                disabled={readOnly}
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
                disabled={readOnly}
                value={form.missedReason || ""}
                onChange={(e) => setForm({ ...form, missedReason: e.target.value })}
                placeholder="Optional note, e.g. patient in wheelchair for outing"
              />
            </div>
          )}

          {form.status === "completed" && (
            <div className="space-y-2">
              <Label htmlFor="actual-session-minutes">Actual treatment minutes</Label>
              <Input
                id="actual-session-minutes"
                type="number"
                min={1}
                step={1}
                disabled={readOnly}
                value={form.actualDurationMinutes ?? form.durationMinutes}
                onChange={(event) => setForm({ ...form, actualDurationMinutes: Number(event.target.value) })}
              />
              <p className="text-xs text-slate-500">Defaults to the scheduled duration. Change it when delivered minutes differ.</p>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            {showCarryForward && (
              <div className="flex items-center justify-between gap-2 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
                <span>Note from last {form.therapyType} session ({new Date(lastNote!.startTime).toLocaleDateString()}) available.</span>
                <div className="flex gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    onClick={() => setForm({ ...form, notes: lastNote!.notes })}
                  >
                    Use it
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => setDismissedCarryForward(true)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
            <Textarea
              disabled={readOnly}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. 60 min ST, around meals only"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          {isEditing && onDelete && !readOnly && !chartOnly ? (
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
            {isEditing && readOnly && canComplete && onComplete && (
              <Button
                className="bg-emerald-700 text-white hover:bg-emerald-800"
                disabled={isCompleting}
                onClick={() => onComplete(form.id!)}
              >
                {isCompleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {isCompleting ? "Completing…" : "Complete session"}
              </Button>
            )}
            {isEditing && readOnly && canUndoComplete && onUndoComplete && (
              <Button
                variant="outline"
                className="border-amber-300 bg-amber-50 font-bold text-amber-900 hover:bg-amber-100 hover:text-amber-950"
                disabled={isUndoingCompletion}
                onClick={() => onUndoComplete(form.id!)}
              >
                {isUndoingCompletion ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                {isUndoingCompletion ? "Undoing…" : "Undo completion"}
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button
                disabled={!durationIsValid || durationExceedsEndOfDay}
                onClick={() => onSave(form)}
              >
                {isEditing ? "Save" : "Add Session"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
