import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { History, Loader2, Printer, Eye, ArrowLeft, Trash2 } from "lucide-react";
import { THERAPY_META, SESSION_STATUS_META, type TherapyType, type SessionStatus } from "@/lib/board";

interface BoardHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SnapshotSession {
  id: number;
  patientId: number;
  therapistId: number | null;
  therapyType: TherapyType;
  startTime: string | Date;
  endTime: string | Date;
  durationMinutes: number;
  status?: SessionStatus;
  missedReason?: string | null;
  notes?: string | null;
}

interface SnapshotPatient {
  id: number;
  roomNumber: string;
  name: string;
  isDischarged: boolean;
}

interface SnapshotTherapist {
  id: number;
  name: string;
}

interface SnapshotData {
  sessions?: SnapshotSession[];
  patients?: SnapshotPatient[];
  therapists?: SnapshotTherapist[];
  flags?: unknown[];
}

interface SnapshotRow {
  patientLabel: string;
  time: string;
  durationMinutes: number;
  typeMeta: (typeof THERAPY_META)[TherapyType];
  therapistName: string;
  statusMeta: (typeof SESSION_STATUS_META)[SessionStatus];
  note: string;
}

function buildSnapshotRows(data: SnapshotData): SnapshotRow[] {
  const sessions = data.sessions ?? [];
  const patientsById = new Map((data.patients ?? []).map((p) => [p.id, p]));
  const therapistsById = new Map((data.therapists ?? []).map((t) => [t.id, t]));

  return [...sessions]
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .map((s) => {
      const patient = patientsById.get(s.patientId);
      const therapist = s.therapistId != null ? therapistsById.get(s.therapistId) : null;
      const status = s.status ?? "scheduled";
      return {
        patientLabel: patient ? `${patient.roomNumber} — ${patient.name}` : `Patient #${s.patientId}`,
        time: new Date(s.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        durationMinutes: s.durationMinutes,
        typeMeta: THERAPY_META[s.therapyType] ?? THERAPY_META.PT,
        therapistName: therapist ? therapist.name : "Unassigned",
        statusMeta: SESSION_STATUS_META[status] ?? SESSION_STATUS_META.scheduled,
        note: s.missedReason || s.notes || "",
      };
    });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function buildPrintHtml(dateLabel: string, rows: SnapshotRow[]): string {
  const tableRows = rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.patientLabel)}</td>
        <td>${escapeHtml(r.time)}</td>
        <td>${escapeHtml(r.durationMinutes.toString())} min</td>
        <td><span class="pill" style="background:${r.typeMeta.bg};color:${r.typeMeta.fg}">${escapeHtml(r.typeMeta.label)}</span></td>
        <td>${escapeHtml(r.therapistName)}</td>
        <td><span class="pill" style="background:${r.statusMeta.bg};color:${r.statusMeta.fg}">${escapeHtml(r.statusMeta.label)}</span></td>
        <td>${escapeHtml(r.note)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Board Snapshot — ${escapeHtml(dateLabel)}</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1e293b; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { font-size: 12px; color: #64748b; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  th { text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; color: #64748b; border-bottom: 2px solid #cbd5e1; }
  .pill { display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 10px; white-space: nowrap; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>Board Snapshot — ${escapeHtml(dateLabel)}</h1>
  <p class="sub">${rows.length} session${rows.length !== 1 ? "s" : ""}</p>
  <table>
    <thead>
      <tr><th>Patient</th><th>Time</th><th>Duration</th><th>Type</th><th>Therapist</th><th>Status</th><th>Note</th></tr>
    </thead>
    <tbody>${tableRows || `<tr><td colspan="7">No sessions recorded for this day.</td></tr>`}</tbody>
  </table>
</body>
</html>`;
}

function printSnapshot(dateLabel: string, rows: SnapshotRow[]) {
  const html = buildPrintHtml(dateLabel, rows);
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // Give the new document a tick to finish rendering before invoking the print dialog.
  setTimeout(() => win.print(), 300);
}

export function BoardHistoryDialog({ open, onOpenChange }: BoardHistoryDialogProps) {
  const utils = trpc.useUtils();
  const historyQuery = trpc.history.list.useQuery(undefined, { enabled: open });
  const snapshots = historyQuery.data ?? [];
  const [viewingId, setViewingId] = useState<number | null>(null);

  const deleteSnapshot = trpc.history.delete.useMutation({
    onSuccess: () => {
      utils.history.list.invalidate();
      toast.success("Snapshot deleted");
    },
    onError: () => toast.error("Could not delete snapshot"),
  });

  const viewing = snapshots.find((s) => s.id === viewingId) ?? null;
  const viewingRows = viewing ? buildSnapshotRows((viewing.snapshot ?? {}) as SnapshotData) : [];
  const viewingDateLabel = viewing
    ? new Date(viewing.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "";

  const handleClose = (v: boolean) => {
    if (!v) setViewingId(null);
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg glass-panel p-6">
        {viewing ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewingId(null)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  title="Back to list"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                Board Snapshot — {viewingDateLabel}
              </DialogTitle>
              <DialogDescription>
                {viewingRows.length} session{viewingRows.length !== 1 ? "s" : ""} recorded this day.
              </DialogDescription>
            </DialogHeader>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => printSnapshot(viewingDateLabel, viewingRows)}
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this snapshot?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove the {viewingDateLabel} board snapshot. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700"
                      onClick={() => {
                        if (viewing) {
                          deleteSnapshot.mutate({ id: viewing.id });
                          setViewingId(null);
                        }
                      }}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <ScrollArea className="h-96 rounded-lg glass-surface border-white/20">
              <table className="w-full text-xs">
                <thead className="sticky top-0 glass-header text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide">Patient</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide">Time</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide">Type</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide">Therapist</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-2 py-6 text-center text-slate-400">
                        No sessions recorded for this day.
                      </td>
                    </tr>
                  ) : (
                    viewingRows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-medium text-slate-700">{r.patientLabel}</td>
                        <td className="px-2 py-1.5 text-slate-500">{r.time}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                            style={{ backgroundColor: r.typeMeta.bg, color: r.typeMeta.fg }}
                          >
                            {r.typeMeta.label}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-slate-500">{r.therapistName}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                            style={{ backgroundColor: r.statusMeta.bg, color: r.statusMeta.fg }}
                          >
                            {r.statusMeta.label}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-slate-500" /> Board History
              </DialogTitle>
              <DialogDescription>
                Daily snapshots saved for auditing and progress tracking.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-96 overflow-y-auto">
              {historyQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
                </div>
              ) : snapshots.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <History className="h-8 w-8 text-slate-300" />
                  <p className="text-sm text-slate-500">
                    No snapshots yet. Use the snapshot button to save today's board.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {snapshots.map((snap) => {
                    const data = snap.snapshot as SnapshotData | null;
                    const sessions = data?.sessions ?? [];
                    const counts: Record<string, number> = {};
                    sessions.forEach((s) => {
                      counts[s.therapyType] = (counts[s.therapyType] ?? 0) + 1;
                    });
                    const dateLabel = new Date(snap.date).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    });
                    return (
                      <li
                        key={snap.id}
                        className="rounded-lg border border-white/40 glass-surface p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-800">{dateLabel}</span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-400 mr-1">
                              Saved {new Date(snap.createdAt).toLocaleTimeString("en-US", {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-slate-500 hover:bg-white/60"
                              title="View this snapshot"
                              onClick={() => setViewingId(snap.id)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-slate-500 hover:bg-white/60"
                              title="Print this snapshot"
                              onClick={() => printSnapshot(dateLabel, buildSnapshotRows((snap.snapshot ?? {}) as SnapshotData))}
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-7 w-7 shrink-0 text-slate-500 hover:bg-red-50 hover:text-red-600"
                                  title="Delete this snapshot"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete this snapshot?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently remove the {dateLabel} board snapshot. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-red-600 hover:bg-red-700"
                                    onClick={() => deleteSnapshot.mutate({ id: snap.id })}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-400">
                            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
                          </span>
                          {(Object.keys(counts) as TherapyType[]).map((t) => {
                            const meta = THERAPY_META[t];
                            if (!meta) return null;
                            return (
                              <span
                                key={t}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro font-bold"
                                style={{ backgroundColor: meta.bg, color: meta.fg }}
                              >
                                {meta.label} {counts[t]}
                              </span>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
