import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  History,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

interface SnapshotSourceSession {
  id: number;
  patientId: number;
  therapistId: number | null;
  therapyType: string;
  durationMinutes: number;
}

interface SaveResult {
  revision: number;
  summary: { sessions: number; patients: number; therapists: number; minutes: number };
}

interface SaveSnapshotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date;
  sessions: SnapshotSourceSession[];
  conflictCount: number;
  onSave: (note?: string) => Promise<SaveResult | null>;
  onViewHistory: () => void;
}

export function SaveSnapshotDialog({
  open,
  onOpenChange,
  date,
  sessions,
  conflictCount,
  onSave,
  onViewHistory,
}: SaveSnapshotDialogProps) {
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const historyQuery = trpc.history.list.useQuery(undefined, { enabled: open, staleTime: 0 });

  useEffect(() => {
    if (!open) return;
    setNote("");
    setSaveError(null);
    setResult(null);
  }, [open, date]);

  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const existingRevisions = useMemo(() => {
    const key = date.toLocaleDateString();
    return (historyQuery.data ?? []).filter((snapshot) => new Date(snapshot.date).toLocaleDateString() === key).length;
  }, [date, historyQuery.data]);
  const patientCount = useMemo(
    () => new Set(sessions.filter((session) => session.therapyType !== "Block").map((session) => session.patientId)).size,
    [sessions],
  );
  const therapistCount = useMemo(
    () => new Set(sessions.map((session) => session.therapistId).filter((id): id is number => id != null)).size,
    [sessions],
  );
  const totalMinutes = useMemo(
    () => sessions.reduce((total, session) => total + session.durationMinutes, 0),
    [sessions],
  );

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const saved = await onSave(note.trim() || undefined);
      if (saved) setResult(saved);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The board record could not be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSaving && onOpenChange(nextOpen)}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-2xl gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl">
        <div className="bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-6 py-5 pr-20 text-white">
          <DialogHeader className="text-left">
            <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <Camera className="h-5 w-5" />
            </div>
            <DialogTitle className="text-xl font-bold tracking-tight text-white">Save board snapshot</DialogTitle>
            <DialogDescription className="max-w-lg text-sm text-blue-50">
              Create a permanent point-in-time record without changing the live schedule.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Schedule date</p>
            <p className="mt-1 text-base font-bold text-slate-950">{dateLabel}</p>
            <p className="mt-1 text-sm text-slate-600">
              {historyQuery.isLoading
                ? "Checking saved revisions…"
                : existingRevisions > 0
                  ? `${existingRevisions} earlier revision${existingRevisions === 1 ? "" : "s"} will be preserved.`
                  : "This will be the first saved revision for this date."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {[
              { label: "Sessions", value: sessions.length, icon: Camera },
              { label: "Patients", value: patientCount, icon: Users },
              { label: "Staff", value: therapistCount, icon: ShieldCheck },
              { label: "Minutes", value: totalMinutes, icon: Clock3 },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-center shadow-sm">
                <Icon className="mx-auto h-4 w-4 text-blue-600" />
                <p className="mt-1 text-lg font-extrabold tabular-nums text-slate-950">{value}</p>
                <p className="text-xs font-medium text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          {!result && (
            <div>
              <label htmlFor="snapshot-note" className="text-sm font-bold text-slate-800">Snapshot note <span className="font-normal text-slate-500">(optional)</span></label>
              <Textarea
                id="snapshot-note"
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 500))}
                placeholder="Example: Final schedule after morning staffing huddle"
                className="mt-2 min-h-24 resize-none border-slate-300 bg-white text-sm"
                disabled={isSaving}
              />
              <p className="mt-1 text-right text-xs text-slate-500">{note.length}/500</p>
            </div>
          )}

          {!result && conflictCount > 0 && (
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-bold">{conflictCount} unresolved scheduling conflict{conflictCount === 1 ? "" : "s"}</p>
                <p className="mt-0.5 text-sm text-amber-800">You can still save this revision; the conflicts will be recorded as they currently appear.</p>
              </div>
            </div>
          )}

          {!result && (
            <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-slate-700">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              <p className="text-sm">The server creates this record from the current board. Clinical notes, MRNs, staff emails, and availability details are excluded.</p>
            </div>
          )}

          {saveError && (
            <div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-950">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
              <div><p className="text-sm font-bold">Snapshot not saved</p><p className="mt-0.5 text-sm text-rose-800">{saveError}</p></div>
            </div>
          )}

          {result && (
            <div role="status" className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              <div>
                <p className="text-sm font-bold">Revision {result.revision} saved</p>
                <p className="mt-0.5 text-sm text-emerald-800">Recorded {result.summary.sessions} sessions and {result.summary.minutes} scheduled minutes.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
          {result ? (
            <>
              <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Close</Button>
              <Button className="h-11 bg-blue-600 px-5 hover:bg-blue-700" onClick={onViewHistory}>
                <History className="mr-2 h-4 w-4" /> View saved records
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="h-11" disabled={isSaving} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button className="h-11 bg-blue-600 px-5 hover:bg-blue-700" disabled={isSaving || historyQuery.isLoading} onClick={handleSave}>
                {isSaving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                {isSaving ? "Saving snapshot…" : "Save new revision"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
