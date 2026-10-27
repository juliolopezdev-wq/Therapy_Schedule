import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn, staffDisplayName } from "@/lib/utils";
import { toast } from "sonner";
import { SECTION_GG_ITEMS, SECTION_GG_SCALE, assessmentProgress } from "@shared/sectionGG";
import {
  CheckCheck,
  Lock,
  Plus,
  Target,
  FileText,
  Eye,
  Loader2,
} from "lucide-react";
import type { SessionTileData } from "./SessionTile";
import { TIME_SLOTS } from "@/lib/board";

interface PatientChartModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: {
    id: number;
    name: string;
    roomNumber: string;
    accessLevel?: "full" | "schedule";
  };
  sessions: SessionTileData[];
}

function relativeDate(value: Date | string) {
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const GOAL_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  met: "Met",
  discontinued: "Discontinued",
};
const GOAL_STATUS_CLASS: Record<string, string> = {
  not_started: "bg-slate-100 text-slate-600",
  in_progress: "bg-blue-100 text-blue-800",
  met: "bg-emerald-100 text-emerald-800",
  discontinued: "bg-slate-200 text-slate-500",
};

export function PatientChartModal({
  open,
  onOpenChange,
  patient,
  sessions,
}: PatientChartModalProps) {
  const { isAdmin, therapistId: myTherapistId } = usePermissions();
  const [tab, setTab] = useState<"notes" | "goals" | "functional" | "access">(
    "notes"
  );

  const logView = trpc.charting.logView.useMutation();
  useEffect(() => {
    if (open) logView.mutate({ patientId: patient.id });
    // Only fire once per time the chart is opened, never on re-renders while it stays open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient.id]);

  const patientSessions = useMemo(
    () =>
      sessions.filter(
        s => s.patientId === patient.id && s.therapyType !== "Block"
      ),
    [sessions, patient.id]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-y-auto overscroll-contain rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl sm:max-w-3xl">
        <DialogHeader className="shrink-0 bg-gradient-to-r from-blue-800 to-sky-700 px-5 py-6 text-left sm:px-6">
          <div className="mb-3 flex items-center gap-2 pr-12 text-xs font-semibold uppercase tracking-[0.14em] text-blue-100">
            <FileText className="h-4 w-4 shrink-0" /> Patient chart
          </div>
          <DialogTitle className="break-words text-2xl font-bold leading-tight text-white [overflow-wrap:anywhere]">
            {patient.name}
          </DialogTitle>
          <DialogDescription className="mt-2 flex flex-wrap items-center gap-3 text-sm text-blue-100">
            <span className="rounded-lg bg-white/15 px-2.5 py-1 font-semibold text-white ring-1 ring-inset ring-white/20">
              Room {patient.roomNumber}
            </span>
            Treatment notes, goals, and functional outcomes.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          key={patient.id}
          value={isAdmin || tab !== "access" ? tab : "notes"}
          onValueChange={value => setTab(value as typeof tab)}
          className="shrink-0 gap-0"
        >
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
            <TabsList
              className={cn(
                "grid h-auto w-full gap-1 rounded-xl bg-slate-100 p-1",
                isAdmin ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"
              )}
            >
              {[
                { value: "notes", label: "Notes" },
                { value: "goals", label: "Goals" },
                { value: "functional", label: "Section GG" },
                ...(isAdmin ? [{ value: "access", label: "Access log" }] : []),
              ].map(item => (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  className="min-h-10 rounded-lg text-xs font-semibold text-slate-600 data-[state=active]:bg-sky-600 data-[state=active]:text-white sm:text-sm"
                >
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="min-w-0 p-4 sm:p-6">
            <TabsContent value="notes">
              <NotesTab
                patientId={patient.id}
                patientSessions={patientSessions}
                myTherapistId={myTherapistId}
                isAdmin={isAdmin}
              />
            </TabsContent>
            <TabsContent value="goals">
              <GoalsTab patientId={patient.id} />
            </TabsContent>
            <TabsContent value="functional">
              <FunctionalTab patientId={patient.id} isAdmin={isAdmin} myTherapistId={myTherapistId} />
            </TabsContent>
            {isAdmin && (
              <TabsContent value="access">
                <AccessLogTab patientId={patient.id} />
              </TabsContent>
            )}
          </div>
        </Tabs>
        <div className="flex shrink-0 justify-end border-t border-slate-200 bg-white px-5 py-3 sm:px-6">
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            Close chart
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NotesTab({
  patientId,
  patientSessions,
  myTherapistId,
  isAdmin,
}: {
  patientId: number;
  patientSessions: SessionTileData[];
  myTherapistId: number | null;
  isAdmin: boolean;
}) {
  const utils = trpc.useUtils();
  const notesQuery = trpc.charting.notes.list.useQuery({ patientId });
  const [composing, setComposing] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [subjective, setSubjective] = useState("");
  const [objective, setObjective] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");

  const myOpenSessions = patientSessions.filter(
    s => isAdmin || s.therapistId === myTherapistId
  );

  const reset = () => {
    setSessionId("");
    setSubjective("");
    setObjective("");
    setAssessment("");
    setPlan("");
    setComposing(false);
  };

  const create = trpc.charting.notes.create.useMutation({
    onSuccess: () => {
      toast.success("Note saved");
      reset();
      utils.charting.notes.list.invalidate({ patientId });
    },
    onError: e => toast.error(e.message),
  });
  const sign = trpc.charting.notes.sign.useMutation({
    onSuccess: () => {
      toast.success("Note signed and locked");
      utils.charting.notes.list.invalidate({ patientId });
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          Treatment notes
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          Document each session and review signed notes.
        </p>
      </div>
      {!composing ? (
        <Button
          size="sm"
          className="h-10 gap-2 rounded-xl bg-sky-600 text-white hover:bg-sky-700"
          onClick={() => setComposing(true)}
          disabled={myOpenSessions.length === 0}
        >
          <Plus className="h-4 w-4" /> New treatment note
        </Button>
      ) : (
        <form
          className="space-y-5 rounded-2xl border border-sky-200 bg-white p-4 shadow-sm sm:p-5"
          onSubmit={e => {
            e.preventDefault();
            if (!sessionId || create.isPending) return;
            create.mutate({
              sessionId: Number(sessionId),
              patientId,
              subjective,
              objective,
              assessment,
              plan,
            });
          }}
        >
          <div>
            <Label
              htmlFor="note-session"
              className="text-sm font-medium text-slate-700"
            >
              Treatment session
            </Label>
            <Select
              value={sessionId}
              onValueChange={setSessionId}
              disabled={create.isPending}
            >
              <SelectTrigger
                id="note-session"
                className="mt-2 h-11 w-full min-w-0 rounded-xl bg-white data-[size=default]:h-11"
              >
                <SelectValue placeholder="Choose which session this documents" />
              </SelectTrigger>
              <SelectContent>
                {myOpenSessions.map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.therapyType} ·{" "}
                    {TIME_SLOTS[s.slotIndex]?.shortLabel ?? ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                key: "subjective",
                label: "Subjective",
                value: subjective,
                update: setSubjective,
                placeholder: "Patient-reported status, complaints, tolerance…",
              },
              {
                key: "objective",
                label: "Objective",
                value: objective,
                update: setObjective,
                placeholder:
                  "Measurable observations, interventions performed…",
              },
              {
                key: "assessment",
                label: "Assessment",
                value: assessment,
                update: setAssessment,
                placeholder: "Clinical interpretation, progress toward goals…",
              },
              {
                key: "plan",
                label: "Plan",
                value: plan,
                update: setPlan,
                placeholder: "Next steps, frequency or duration changes…",
              },
            ].map((field, index) => (
              <div
                key={field.key}
                className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-3"
              >
                <Label
                  htmlFor={`note-${field.key}`}
                  className="flex items-center gap-2 text-sm font-semibold text-slate-800"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-100 text-xs font-bold text-sky-700">
                    {index + 1}
                  </span>
                  {field.label}
                </Label>
                <Textarea
                  id={`note-${field.key}`}
                  className="mt-3 min-h-32 rounded-lg bg-white"
                  value={field.value}
                  onChange={event => field.update(event.target.value)}
                  placeholder={field.placeholder}
                  disabled={create.isPending}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-10 rounded-xl bg-sky-600 text-white hover:bg-sky-700"
              disabled={!sessionId || create.isPending}
            >
              {create.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Save note"
              )}
            </Button>
          </div>
        </form>
      )}

      {notesQuery.isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      ) : (notesQuery.data ?? []).length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
          No treatment notes yet.
        </p>
      ) : (
        (notesQuery.data ?? []).map(note => (
          <div
            key={note.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="break-words font-semibold text-slate-800 [overflow-wrap:anywhere]">
                {note.therapistName || "Therapist"} · {note.therapyType}
                {note.isAddendum && (
                  <span className="ml-1.5 text-xs font-normal text-amber-700">
                    (addendum)
                  </span>
                )}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">
                  {relativeDate(note.createdAt)}
                </span>
                {note.signedAt ? (
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-emerald-50 text-emerald-700"
                  >
                    <Lock className="h-3 w-3" /> Signed
                  </Badge>
                ) : isAdmin || note.therapistId === myTherapistId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 rounded-lg border-sky-200 text-xs text-sky-700 hover:bg-sky-50"
                    disabled={sign.isPending}
                    onClick={() => sign.mutate({ id: note.id })}
                  >
                    <CheckCheck className="h-3.5 w-3.5" /> Sign
                  </Button>
                ) : null}
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-slate-600 sm:grid-cols-2 [&>div]:min-w-0 [&>div]:rounded-xl [&>div]:bg-slate-50 [&>div]:p-3">
              {note.subjective && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                    Subjective
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                    {note.subjective}
                  </dd>
                </div>
              )}
              {note.objective && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                    Objective
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                    {note.objective}
                  </dd>
                </div>
              )}
              {note.assessment && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                    Assessment
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                    {note.assessment}
                  </dd>
                </div>
              )}
              {note.plan && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                    Plan
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                    {note.plan}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        ))
      )}
    </div>
  );
}

function GoalsTab({ patientId }: { patientId: number }) {
  const utils = trpc.useUtils();
  const goalsQuery = trpc.charting.goals.list.useQuery({ patientId });
  const [composing, setComposing] = useState(false);
  const [therapyType, setTherapyType] = useState<"PT" | "OT" | "SLP">("PT");
  const [termType, setTermType] = useState<"long_term" | "short_term">(
    "short_term"
  );
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const create = trpc.charting.goals.create.useMutation({
    onSuccess: () => {
      toast.success("Goal added");
      setDescription("");
      setTargetDate("");
      setComposing(false);
      utils.charting.goals.list.invalidate({ patientId });
    },
    onError: e => toast.error(e.message),
  });
  const update = trpc.charting.goals.update.useMutation({
    onSuccess: () => utils.charting.goals.list.invalidate({ patientId }),
    onError: e => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          Treatment goals
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          Track progress toward short- and long-term goals.
        </p>
      </div>
      {!composing ? (
        <Button
          size="sm"
          className="h-10 gap-2 rounded-xl bg-sky-600 text-white hover:bg-sky-700"
          onClick={() => setComposing(true)}
        >
          <Plus className="h-4 w-4" /> New goal
        </Button>
      ) : (
        <form
          className="space-y-5 rounded-2xl border border-sky-200 bg-white p-4 shadow-sm sm:p-5"
          onSubmit={e => {
            e.preventDefault();
            if (!description.trim()) return;
            create.mutate({
              patientId,
              therapyType,
              termType,
              description,
              targetDate: targetDate || undefined,
            });
          }}
        >
          <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2">
            <div>
              <Label className="text-sm font-medium text-slate-700">
                Discipline
              </Label>
              <Select
                value={therapyType}
                onValueChange={v => setTherapyType(v as typeof therapyType)}
              >
                <SelectTrigger className="mt-2 h-11 w-full min-w-0 rounded-xl bg-white data-[size=default]:h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PT">PT</SelectItem>
                  <SelectItem value="OT">OT</SelectItem>
                  <SelectItem value="SLP">SLP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium text-slate-700">Term</Label>
              <Select
                value={termType}
                onValueChange={v => setTermType(v as typeof termType)}
              >
                <SelectTrigger className="mt-2 h-11 w-full min-w-0 rounded-xl bg-white data-[size=default]:h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short_term">Short-term</SelectItem>
                  <SelectItem value="long_term">Long-term</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium text-slate-700">Goal</Label>
            <Textarea
              className="mt-2 min-h-28 rounded-xl bg-slate-50/60"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Patient will... within N days, given..."
            />
          </div>
          <div>
            <Label className="text-sm font-medium text-slate-700">
              Target date
            </Label>
            <Input
              type="date"
              className="mt-2 h-11 w-full min-w-0 rounded-xl bg-white data-[size=default]:h-11"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setComposing(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-10 rounded-xl bg-sky-600 text-white hover:bg-sky-700"
              disabled={!description.trim() || create.isPending}
            >
              Add goal
            </Button>
          </div>
        </form>
      )}

      {goalsQuery.isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      ) : (goalsQuery.data ?? []).length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
          No goals recorded yet.
        </p>
      ) : (
        (goalsQuery.data ?? []).map(goal => (
          <div
            key={goal.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <Target className="h-4 w-4 text-slate-400" />
                <span className="break-words font-semibold text-slate-800 [overflow-wrap:anywhere]">
                  {goal.therapyType}
                </span>
                <span className="text-xs capitalize text-slate-500">
                  {goal.termType.replace("_", "-")}
                </span>
              </div>
              <Select
                value={goal.status}
                onValueChange={v =>
                  update.mutate({
                    id: goal.id,
                    patientId,
                    status: v as typeof goal.status,
                  })
                }
              >
                <SelectTrigger
                  className={cn(
                    "w-40 rounded-lg border-0 text-xs font-semibold data-[size=default]:h-9",
                    GOAL_STATUS_CLASS[goal.status]
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GOAL_STATUS_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="mt-3 whitespace-pre-wrap leading-relaxed text-slate-700 [overflow-wrap:anywhere]">
              {goal.description}
            </p>
            {goal.targetDate && (
              <p className="mt-1 text-xs text-slate-400">
                Target: {goal.targetDate}
              </p>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function FunctionalTab({ patientId, isAdmin, myTherapistId }: { patientId: number; isAdmin: boolean; myTherapistId: number | null }) {
  const utils = trpc.useUtils();
  const assessmentsQuery = trpc.charting.functionalAssessments.list.useQuery({
    patientId,
  });
  const refreshAssessments = () => {
    void utils.charting.functionalAssessments.list.invalidate({ patientId });
    void utils.charting.ggCompleteness.invalidate(); void utils.charting.ggTrend.invalidate(); void utils.charting.ggScoringConsistency.invalidate();
  };
  const [editingId, setEditingId] = useState<number | null>(null);
  const update = trpc.charting.functionalAssessments.update.useMutation({
    onSuccess: () => { toast.success("Assessment draft updated"); setComposing(false); setEditingId(null); setScores({}); refreshAssessments(); },
    onError: error => toast.error(error.message),
  });
  const sign = trpc.charting.functionalAssessments.sign.useMutation({
    onSuccess: () => { toast.success("Assessment signed"); refreshAssessments(); },
    onError: error => toast.error(error.message),
  });
  const [composing, setComposing] = useState(false);
  const [assessmentType, setAssessmentType] = useState<
    "admission" | "interim" | "discharge"
  >("admission");
  const [assessmentDate, setAssessmentDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [scores, setScores] = useState<Record<string, number>>({});

  const create = trpc.charting.functionalAssessments.create.useMutation({
    onSuccess: () => {
      toast.success("Functional assessment saved");
      setScores({});
      setComposing(false);
      refreshAssessments();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          Functional assessments
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          Record self-care and mobility scores for this patient.
        </p>
      </div>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
        IRF reference scoring only. This is not an IRF-PAI submission tool or an official CMS outcome measure. Use your approved clinical record and current IRF-PAI manual for official reporting.
      </p>
      {!composing ? (
        <Button
          size="sm"
          className="h-10 gap-2 rounded-xl bg-sky-600 text-white hover:bg-sky-700"
          onClick={() => { setEditingId(null); setScores({}); setComposing(true); }}
        >
          <Plus className="h-4 w-4" /> New assessment
        </Button>
      ) : (
        <form
          className="space-y-5 rounded-2xl border border-sky-200 bg-white p-4 shadow-sm sm:p-5"
          onSubmit={e => {
            e.preventDefault();
            if (editingId != null) update.mutate({ id: editingId, patientId, assessmentDate, itemScores: scores });
            else create.mutate({ patientId, assessmentType, assessmentDate, itemScores: scores });
          }}
        >
          <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2">
            <div>
              <Label className="text-sm font-medium text-slate-700">Type</Label>
              <Select
                value={assessmentType}
                disabled={editingId !== null}
                onValueChange={v =>
                  setAssessmentType(v as typeof assessmentType)
                }
              >
                <SelectTrigger className="mt-2 h-11 w-full min-w-0 rounded-xl bg-white data-[size=default]:h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admission">Admission</SelectItem>
                  <SelectItem value="interim">Interim</SelectItem>
                  <SelectItem value="discharge">Discharge</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium text-slate-700">Date</Label>
              <Input
                type="date"
                className="mt-2 h-11 w-full min-w-0 rounded-xl bg-white data-[size=default]:h-11"
                value={assessmentDate}
                onChange={e => setAssessmentDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            {(["self_care", "mobility"] as const).map(group => (
              <div key={group}>
                <p className="mb-1 text-xs font-bold uppercase text-slate-400">
                  {group === "self_care" ? "Self-care" : "Mobility"}
                </p>
                <div className="space-y-1.5">
                  {SECTION_GG_ITEMS.filter(item => item.group === group).map(
                    item => (
                      <div
                        key={item.code}
                        className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center"
                      >
                        <span className="text-xs text-slate-700">
                          {item.label}
                        </span>
                        <Select
                          value={
                            scores[item.code] != null
                              ? String(scores[item.code])
                              : ""
                          }
                          onValueChange={v =>
                            setScores(prev => ({
                              ...prev,
                              [item.code]: Number(v),
                            }))
                          }
                        >
                          <SelectTrigger className="w-full min-w-0 rounded-lg text-xs data-[size=default]:h-10 [&_[data-slot=select-value]]:min-w-0">
                            <SelectValue placeholder="Score" />
                          </SelectTrigger>
                          <SelectContent>
                            {SECTION_GG_SCALE.map(s => (
                              <SelectItem key={s.value} value={String(s.value)}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setComposing(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-10 rounded-xl bg-sky-600 text-white hover:bg-sky-700"
              disabled={create.isPending || update.isPending}
            >
              {editingId != null ? "Update draft" : "Save draft"}
            </Button>
          </div>
        </form>
      )}

      {assessmentsQuery.isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      ) : (assessmentsQuery.data ?? []).length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
          No functional assessments recorded yet.
        </p>
      ) : (
        (assessmentsQuery.data ?? []).map(a => {
          const itemScores = (a.itemScores ?? {}) as Record<string, number>;
          const progress = assessmentProgress(itemScores, a.signedAt);
          const scored = Object.values(itemScores).filter(v => v >= 1 && v <= 6);
          const total = scored.reduce((sum, v) => sum + v, 0);
          return (
            <div
              key={a.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold capitalize text-slate-800">
                  {a.assessmentType}{" "}
                  <span className="font-normal text-slate-400">
                    · {a.assessmentDate}
                  </span>
                </span>
                {!a.signedAt && <Badge variant="secondary">{progress.status}</Badge>}
                {a.signedAt ? (
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-emerald-50 text-emerald-700"
                  >
                    <Lock className="h-3 w-3" /> Signed
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {progress.answered} of {SECTION_GG_ITEMS.length} reference items answered ·
                {scored.length} performance scores (sum {total}; not a CMS measure)
                {a.therapistName ? ` · by ${a.therapistName}` : ""}
              </p>
              {!a.signedAt && (isAdmin || a.completedByTherapistId === myTherapistId) && <Button variant="ghost" size="sm" className="mt-3 mr-2" onClick={() => { setEditingId(a.id); setScores(itemScores); setAssessmentType(a.assessmentType); setAssessmentDate(a.assessmentDate); setComposing(true); }}>Edit draft</Button>}
              {!a.signedAt && (isAdmin || a.completedByTherapistId === myTherapistId) && <Button className="mt-3" size="sm" variant="outline" disabled={!progress.complete || sign.isPending} onClick={() => sign.mutate({ id: a.id, patientId })}>Sign completed assessment</Button>}
            </div>
          );
        })
      )}
    </div>
  );
}

function AccessLogTab({ patientId }: { patientId: number }) {
  const logQuery = trpc.charting.accessLog.useQuery({ patientId });
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Chart access</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          Review when this chart was opened.
        </p>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Eye className="h-3.5 w-3.5" /> Last {logQuery.data?.length ?? 0} chart
        views, most recent first.
      </p>
      {logQuery.isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      ) : (logQuery.data ?? []).length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
          No recorded chart views yet.
        </p>
      ) : (
        (logQuery.data ?? []).map(entry => (
          <div
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm"
          >
            <span className="break-words font-medium text-slate-700 [overflow-wrap:anywhere]">
              {staffDisplayName({ name: entry.userName, role: entry.userRole })}
            </span>
            <span className="text-xs text-slate-400">
              {new Date(entry.accessedAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
