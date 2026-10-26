import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  Printer,
  Search,
  UserRound,
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SessionTileData } from "./SessionTile";
import { getPatientScheduleRows, printAllPatientSchedules } from "./PatientDayQuickView";
import { isCanceledStatus } from "@/lib/board";

interface PrintPatient {
  id: number;
  name: string;
  roomNumber: string;
  isDischarged: boolean;
  isRoomPlaceholder: boolean;
}

interface PrintSchedulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date;
  patients: PrintPatient[];
  sessions: SessionTileData[];
  therapists: { id: number; name: string }[];
}

export function PrintSchedulesDialog({ open, onOpenChange, day, patients, sessions, therapists }: PrintSchedulesDialogProps) {
  const activePatients = useMemo(
    () => patients.filter((patient) => !patient.isDischarged && !patient.isRoomPlaceholder),
    [patients],
  );
  const scheduleByPatient = useMemo(() => new Map(activePatients.map((patient) => [
    patient.id,
    getPatientScheduleRows(patient.id, sessions, therapists),
  ])), [activePatients, sessions, therapists]);
  const scheduledPatientIds = useMemo(
    () => activePatients.filter((patient) => (scheduleByPatient.get(patient.id)?.length ?? 0) > 0).map((patient) => patient.id),
    [activePatients, scheduleByPatient],
  );

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"room" | "name">("room");
  const [includeTherapistNames, setIncludeTherapistNames] = useState(true);
  const [printStatus, setPrintStatus] = useState<"idle" | "opened" | "blocked">("idle");

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set(scheduledPatientIds));
    setSearch("");
    setSortBy("room");
    setIncludeTherapistNames(true);
    setPrintStatus("idle");
  }, [open, day, scheduledPatientIds]);

  const visiblePatients = useMemo(() => {
    const term = search.trim().toLowerCase();
    return activePatients
      .filter((patient) => !term || patient.name.toLowerCase().includes(term) || patient.roomNumber.toLowerCase().includes(term))
      .sort((a, b) => sortBy === "name"
        ? a.name.localeCompare(b.name)
        : a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  }, [activePatients, search, sortBy]);

  const selectedPatients = useMemo(
    () => activePatients.filter((patient) => selectedIds.has(patient.id)),
    [activePatients, selectedIds],
  );
  const selectedSessionCount = selectedPatients.reduce((total, patient) => total + (scheduleByPatient.get(patient.id)?.length ?? 0), 0);
  const selectedMinutes = selectedPatients.reduce((total, patient) => total + (scheduleByPatient.get(patient.id) ?? []).reduce((sum, row) => sum + (isCanceledStatus(row.status) ? 0 : row.durationMinutes), 0), 0);
  const unassignedCount = sessions.filter((session) => selectedIds.has(session.patientId) && session.therapyType !== "Block" && !isCanceledStatus(session.status) && session.therapistId == null).length;

  const togglePatient = (patientId: number) => {
    setPrintStatus("idle");
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(patientId)) next.delete(patientId);
      else next.add(patientId);
      return next;
    });
  };

  const handlePrint = () => {
    const opened = printAllPatientSchedules(selectedPatients, day, sessions, therapists, { includeTherapistNames, sortBy });
    setPrintStatus(opened ? "opened" : "blocked");
  };

  const dateLabel = day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl sm:max-w-3xl">
        <div className="shrink-0 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-6 py-5 pr-20 text-white">
          <DialogHeader className="text-left">
            <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25"><Printer className="h-5 w-5" /></div>
            <DialogTitle className="text-xl font-bold tracking-tight text-white">Print patient schedules</DialogTitle>
            <DialogDescription className="text-sm text-blue-50">Choose exactly which patient schedule sheets to print for {dateLabel}.</DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-slate-200 bg-white p-4 sm:gap-3 sm:px-6">
          {[
            { label: "Pages", value: selectedPatients.length, icon: FileText },
            { label: "Sessions", value: selectedSessionCount, icon: Users },
            { label: "Minutes", value: selectedMinutes, icon: Clock3 },
          ].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center gap-2 text-slate-500"><Icon className="h-4 w-4 text-blue-600"/><span className="text-xs font-bold uppercase tracking-wide">{label}</span></div><p className="mt-1 text-xl font-extrabold tabular-nums text-slate-950">{value}</p></div>)}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient or room…" className="h-11 border-slate-300 bg-white pl-10 text-sm"/></div>
            <Select value={sortBy} onValueChange={(value: "room" | "name") => setSortBy(value)}><SelectTrigger className="h-11 w-full border-slate-300 bg-white sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="room">Sort by room</SelectItem><SelectItem value="name">Sort by name</SelectItem></SelectContent></Select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-10" onClick={() => { setSelectedIds(new Set(scheduledPatientIds)); setPrintStatus("idle"); }}>Scheduled only ({scheduledPatientIds.length})</Button>
              <Button variant="outline" className="h-10" onClick={() => { setSelectedIds(new Set(activePatients.map((patient) => patient.id))); setPrintStatus("idle"); }}>All active ({activePatients.length})</Button>
              <Button variant="ghost" className="h-10 text-slate-600" onClick={() => { setSelectedIds(new Set()); setPrintStatus("idle"); }}>Clear</Button>
            </div>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={includeTherapistNames} onChange={(event) => { setIncludeTherapistNames(event.target.checked); setPrintStatus("idle"); }} className="h-4 w-4 accent-blue-600" />
              Include therapist names
            </label>
          </div>

          <ScrollArea className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
            {visiblePatients.length === 0 ? <div className="flex min-h-52 flex-col items-center justify-center p-6 text-center"><Search className="h-8 w-8 text-slate-300"/><p className="mt-3 text-sm font-bold text-slate-800">No matching patients</p><p className="mt-1 text-sm text-slate-500">Try another patient name or room.</p></div> : <div className="divide-y divide-slate-100">{visiblePatients.map((patient) => {
              const rows = scheduleByPatient.get(patient.id) ?? [];
              const minutes = rows.reduce((total, row) => total + row.durationMinutes, 0);
              return <label key={patient.id} className="flex min-h-16 cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"><input type="checkbox" checked={selectedIds.has(patient.id)} onChange={() => togglePatient(patient.id)} className="h-5 w-5 shrink-0 accent-blue-600"/><span className="flex h-10 min-w-14 shrink-0 items-center justify-center rounded-lg bg-blue-50 px-2 text-sm font-extrabold text-blue-800">Rm {patient.roomNumber}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-950">{patient.name}</span><span className="block text-xs text-slate-500">{rows.length > 0 ? `${rows.length} session${rows.length === 1 ? "" : "s"} · ${minutes} minutes` : "No sessions scheduled — prints a blank schedule"}</span></span>{rows.length === 0 && <span className="hidden rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800 sm:inline">Blank page</span>}</label>;
            })}</div>}
          </ScrollArea>

          {unassignedCount > 0 && <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"/><p className="text-sm"><strong>{unassignedCount} selected session{unassignedCount === 1 ? " is" : "s are"} unassigned.</strong> Those sheets will print without a therapist name.</p></div>}
          {printStatus === "blocked" && <div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700"/><p className="text-sm"><strong>Print preview was blocked.</strong> Allow pop-ups for this site, then try again.</p></div>}
          {printStatus === "opened" && <div role="status" className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-950"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700"/><p className="text-sm"><strong>Print preview opened.</strong> Review the pages in your browser's print dialog.</p></div>}
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Close</Button>
          <Button className="h-11 bg-blue-600 px-5 hover:bg-blue-700" disabled={selectedPatients.length === 0} onClick={handlePrint}><Printer className="mr-2 h-4 w-4"/>Print {selectedPatients.length} schedule{selectedPatients.length === 1 ? "" : "s"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
