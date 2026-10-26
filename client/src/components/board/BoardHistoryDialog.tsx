import { useMemo, useState } from "react";
import { usePermissions } from "@/_core/hooks/usePermissions";
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Camera,
  Clock3,
  Eye,
  FileClock,
  History,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
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
  schemaVersion?: number;
  metadata?: {
    revision?: number;
    source?: string;
    note?: string | null;
    savedByUserId?: number;
    savedByEmail?: string | null;
  };
  summary?: { sessions: number; patients: number; therapists: number; minutes: number };
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
  const patientsById = new Map((data.patients ?? []).map((patient) => [patient.id, patient]));
  const therapistsById = new Map((data.therapists ?? []).map((therapist) => [therapist.id, therapist]));

  return [...sessions]
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .map((session) => {
      const patient = patientsById.get(session.patientId);
      const therapist = session.therapistId != null ? therapistsById.get(session.therapistId) : null;
      const status = session.status ?? "scheduled";
      return {
        patientLabel: patient ? `${patient.roomNumber} — ${patient.name}` : `Patient #${session.patientId}`,
        time: new Date(session.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        durationMinutes: session.durationMinutes,
        typeMeta: THERAPY_META[session.therapyType] ?? THERAPY_META.PT,
        therapistName: therapist?.name ?? "Unassigned",
        statusMeta: SESSION_STATUS_META[status] ?? SESSION_STATUS_META.scheduled,
        note: session.missedReason || session.notes || "",
      };
    });
}

function getSnapshotSummary(data: SnapshotData) {
  if (data.summary) return data.summary;
  const sessions = data.sessions ?? [];
  return {
    sessions: sessions.length,
    patients: new Set(sessions.filter((session) => session.therapyType !== "Block").map((session) => session.patientId)).size,
    therapists: new Set(sessions.map((session) => session.therapistId).filter((id) => id != null)).size,
    minutes: sessions.reduce((total, session) => total + session.durationMinutes, 0),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

function buildPrintHtml(title: string, rows: SnapshotRow[]): string {
  const tableRows = rows.map((row) => `<tr>
    <td>${escapeHtml(row.patientLabel)}</td><td>${escapeHtml(row.time)}</td>
    <td>${row.durationMinutes} min</td>
    <td><span class="pill" style="background:${row.typeMeta.bg};color:${row.typeMeta.fg}">${escapeHtml(row.typeMeta.label)}</span></td>
    <td>${escapeHtml(row.therapistName)}</td>
    <td><span class="pill" style="background:${row.statusMeta.bg};color:${row.statusMeta.fg}">${escapeHtml(row.statusMeta.label)}</span></td>
    <td>${escapeHtml(row.note)}</td>
  </tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>
    body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1e293b;padding:24px}h1{font-size:18px;margin:0 0 4px}.sub{font-size:12px;color:#64748b;margin:0 0 20px}
    table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0}th{text-transform:uppercase;font-size:10px;letter-spacing:.05em;color:#64748b;border-bottom:2px solid #cbd5e1}.pill{display:inline-block;padding:2px 6px;border-radius:4px;font-weight:700;font-size:10px;white-space:nowrap}@media print{body{padding:0}}
  </style></head><body><h1>${escapeHtml(title)}</h1><p class="sub">${rows.length} session${rows.length === 1 ? "" : "s"}</p><table><thead><tr><th>Patient</th><th>Time</th><th>Duration</th><th>Type</th><th>Therapist</th><th>Status</th><th>Note</th></tr></thead><tbody>${tableRows || '<tr><td colspan="7">No sessions recorded for this day.</td></tr>'}</tbody></table></body></html>`;
}

function printSnapshot(title: string, rows: SnapshotRow[]) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) {
    toast.error("Allow pop-ups to print this snapshot.");
    return;
  }
  win.document.open();
  win.document.write(buildPrintHtml(title, rows));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function formatSnapshotDate(value: Date | string) {
  return new Date(value).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function BoardHistoryDialog({ open, onOpenChange }: BoardHistoryDialogProps) {
  const { isAdmin } = usePermissions();
  const utils = trpc.useUtils();
  const historyQuery = trpc.history.list.useQuery(undefined, { enabled: open });
  const snapshots = historyQuery.data ?? [];
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const deleteSnapshot = trpc.history.delete.useMutation({
    onSuccess: () => {
      void utils.history.list.invalidate();
      setViewingId(null);
      toast.success("Snapshot deleted");
    },
    onError: (error) => toast.error(error.message || "Could not delete snapshot"),
  });

  const filteredSnapshots = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return snapshots;
    return snapshots.filter((snapshot) => {
      const data = (snapshot.snapshot ?? {}) as SnapshotData;
      return [formatSnapshotDate(snapshot.date), data.metadata?.note, data.metadata?.savedByEmail, `revision ${data.metadata?.revision ?? 1}`]
        .some((value) => value?.toLowerCase().includes(term));
    });
  }, [search, snapshots]);

  const uniqueDays = useMemo(() => new Set(snapshots.map((snapshot) => new Date(snapshot.date).toLocaleDateString())).size, [snapshots]);
  const viewing = snapshots.find((snapshot) => snapshot.id === viewingId) ?? null;
  const viewingData = (viewing?.snapshot ?? {}) as SnapshotData;
  const viewingRows = viewing ? buildSnapshotRows(viewingData) : [];
  const viewingSummary = getSnapshotSummary(viewingData);
  const viewingDateLabel = viewing ? formatSnapshotDate(viewing.date) : "";
  const viewingRevision = viewingData.metadata?.revision ?? 1;
  const printTitle = `Board Snapshot — ${viewingDateLabel} · Revision ${viewingRevision}`;

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setViewingId(null);
      setSearch("");
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex h-[90vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl xl:max-w-6xl">
        <div className="shrink-0 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-6 py-5 pr-20 text-white">
          <DialogHeader className="text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25"><History className="h-5 w-5" /></div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight text-white">Saved board records</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-blue-50">Point-in-time schedule snapshots saved for review, printing, and auditing.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {viewing ? (
            <div className="flex h-full flex-col">
              <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setViewingId(null)} title="Back to history"><ArrowLeft className="h-4 w-4" /></Button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-extrabold text-slate-950">{viewingDateLabel}</h2><span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800">Revision {viewingRevision}</span></div>
                      <p className="mt-1 text-sm text-slate-600">Saved {new Date(viewing.createdAt).toLocaleString()} {viewingData.metadata?.savedByEmail ? `by ${viewingData.metadata.savedByEmail}` : ""}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pl-[52px] sm:pl-0">
                    <Button variant="outline" className="h-10" onClick={() => printSnapshot(printTitle, viewingRows)}><Printer className="mr-2 h-4 w-4" />Print</Button>
                    {isAdmin && <DeleteButton pending={deleteSnapshot.isPending} label={viewingDateLabel} onDelete={() => deleteSnapshot.mutate({ id: viewing.id })} />}
                  </div>
                </div>
                {viewingData.metadata?.note && <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-950">{viewingData.metadata.note}</p>}
              </div>

              <div className="grid shrink-0 grid-cols-2 gap-2 p-4 sm:grid-cols-4 sm:gap-3 sm:px-6">
                {[
                  { label: "Sessions", value: viewingSummary.sessions, icon: Camera },
                  { label: "Patients", value: viewingSummary.patients, icon: Users },
                  { label: "Staff", value: viewingSummary.therapists, icon: FileClock },
                  { label: "Minutes", value: viewingSummary.minutes, icon: Clock3 },
                ].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-center gap-2 text-slate-500"><Icon className="h-4 w-4 text-blue-600"/><span className="text-xs font-bold uppercase tracking-wide">{label}</span></div><p className="mt-1 text-xl font-extrabold tabular-nums text-slate-950">{value}</p></div>)}
              </div>

              <div className="min-h-0 flex-1 px-4 pb-4 sm:px-6 sm:pb-6">
                <ScrollArea className="h-full rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-4 py-3 text-left">Patient</th><th className="px-4 py-3 text-left">Time</th><th className="px-4 py-3 text-left">Duration</th><th className="px-4 py-3 text-left">Type</th><th className="px-4 py-3 text-left">Therapist</th><th className="px-4 py-3 text-left">Status</th></tr></thead>
                    <tbody>{viewingRows.length === 0 ? <tr><td colSpan={6} className="px-4 py-16 text-center text-sm text-slate-500">No sessions were recorded in this revision.</td></tr> : viewingRows.map((row, index) => <tr key={`${row.patientLabel}-${row.time}-${index}`} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold text-slate-900">{row.patientLabel}</td><td className="px-4 py-3 text-slate-600">{row.time}</td><td className="px-4 py-3 tabular-nums text-slate-600">{row.durationMinutes} min</td><td className="px-4 py-3"><span className="rounded-md px-2 py-1 text-xs font-bold" style={{backgroundColor:row.typeMeta.bg,color:row.typeMeta.fg}}>{row.typeMeta.label}</span></td><td className="px-4 py-3 text-slate-600">{row.therapistName}</td><td className="px-4 py-3"><span className="rounded-md px-2 py-1 text-xs font-bold" style={{backgroundColor:row.statusMeta.bg,color:row.statusMeta.fg}}>{row.statusMeta.label}</span></td></tr>)}</tbody>
                  </table>
                </ScrollArea>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="shrink-0 space-y-4 border-b border-slate-200 bg-white p-4 sm:px-6">
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <SummaryCard label="Saved records" value={snapshots.length} icon={Camera} />
                  <SummaryCard label="Schedule days" value={uniqueDays} icon={CalendarDays} />
                  <SummaryCard label="Latest revision" value={snapshots[0] ? ((snapshots[0].snapshot as SnapshotData)?.metadata?.revision ?? 1) : "—"} icon={FileClock} />
                </div>
                <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by date, note, creator, or revision…" className="h-11 border-slate-300 bg-white pl-10 text-sm"/></div>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="p-4 sm:p-6">
                  {historyQuery.isLoading ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-slate-500"><Loader2 className="h-7 w-7 animate-spin text-blue-600"/><p className="text-sm">Loading saved records…</p></div>
                  : historyQuery.isError ? <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center"><AlertTriangle className="h-8 w-8 text-rose-700"/><h3 className="mt-3 font-bold text-slate-950">Saved records unavailable</h3><p className="mt-1 text-sm text-slate-600">Check your connection and try again.</p><Button variant="outline" className="mt-4 h-10" onClick={() => historyQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Retry</Button></div>
                  : snapshots.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center"><History className="h-9 w-9 text-slate-300"/><h3 className="mt-3 font-bold text-slate-950">No snapshots yet</h3><p className="mt-1 max-w-sm text-sm text-slate-600">Use Save snapshot from the More menu to create your first board record.</p></div>
                  : filteredSnapshots.length === 0 ? <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center"><Search className="h-8 w-8 text-slate-300"/><h3 className="mt-3 font-bold text-slate-950">No matching snapshots</h3><p className="mt-1 text-sm text-slate-600">Try a different date, note, creator, or revision.</p></div>
                  : <div className="grid gap-3 lg:grid-cols-2">{filteredSnapshots.map((snapshot) => {
                    const data = (snapshot.snapshot ?? {}) as SnapshotData;
                    const summary = getSnapshotSummary(data);
                    const revision = data.metadata?.revision ?? 1;
                    const title = `${formatSnapshotDate(snapshot.date)} · Revision ${revision}`;
                    return <article key={snapshot.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
                      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold text-slate-950">{formatSnapshotDate(snapshot.date)}</h3><span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800">Revision {revision}</span></div><p className="mt-1 text-xs text-slate-500">Saved {new Date(snapshot.createdAt).toLocaleString()}{data.metadata?.savedByEmail ? ` by ${data.metadata.savedByEmail}` : ""}</p></div><div className="flex shrink-0 gap-1"><Button variant="outline" size="icon" className="h-10 w-10" title="View snapshot" onClick={() => setViewingId(snapshot.id)}><Eye className="h-4 w-4"/></Button><Button variant="outline" size="icon" className="h-10 w-10" title="Print snapshot" onClick={() => printSnapshot(`Board Snapshot — ${title}`, buildSnapshotRows(data))}><Printer className="h-4 w-4"/></Button>{isAdmin && <DeleteButton compact pending={deleteSnapshot.isPending} label={formatSnapshotDate(snapshot.date)} onDelete={() => deleteSnapshot.mutate({id:snapshot.id})}/>}</div></div>
                      {data.metadata?.note && <p className="mt-3 line-clamp-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{data.metadata.note}</p>}
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-600"><span>{summary.sessions} sessions</span><span>{summary.patients} patients</span><span>{summary.minutes} minutes</span></div>
                    </article>;
                  })}</div>}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Camera }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-blue-600"/><span className="hidden text-xs font-bold uppercase tracking-wide text-slate-500 sm:inline">{label}</span></div><p className="mt-1 text-xl font-extrabold tabular-nums text-slate-950">{value}</p><p className="text-xs text-slate-500 sm:hidden">{label}</p></div>;
}

function DeleteButton({ pending, label, onDelete, compact = false }: { pending: boolean; label: string; onDelete: () => void; compact?: boolean }) {
  return <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" size={compact ? "icon" : "default"} className={compact ? "h-10 w-10 text-rose-700 hover:bg-rose-50 hover:text-rose-800" : "h-10 text-rose-700 hover:bg-rose-50 hover:text-rose-800"} disabled={pending}>{pending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className={compact ? "h-4 w-4" : "mr-2 h-4 w-4"}/>} {!compact && "Delete"}</Button></AlertDialogTrigger><AlertDialogContent className="border-slate-200 bg-white"><AlertDialogHeader><AlertDialogTitle>Delete this snapshot?</AlertDialogTitle><AlertDialogDescription>This permanently removes the {label} snapshot. The deletion will be recorded in the administrative audit log.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-11">Cancel</AlertDialogCancel><AlertDialogAction className="h-11 bg-rose-700 hover:bg-rose-800" onClick={onDelete}>Delete snapshot</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
