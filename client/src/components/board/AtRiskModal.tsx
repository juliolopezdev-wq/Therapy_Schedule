import { useMemo, useState } from "react";
import { format } from "date-fns";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowUpRight, CalendarPlus, CheckCircle2, Clock3, Search, ShieldAlert, Target } from "lucide-react";
import type { Patient } from "../../../../drizzle/schema";
import { formatDateKey } from "@/lib/board";
import { cn } from "@/lib/utils";

export interface AtRiskSlot {
  startTime: string;
  durationMinutes: number;
  therapistId: number | null;
  therapistName: string | null;
  therapyType: "PT" | "OT" | "SLP";
  reason?: string;
}

export interface AtRiskDigestEntry {
  patientId: number;
  proposedSlots: AtRiskSlot[];
}

interface AtRiskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date;
  patients: Patient[];
  completedMinutes: Map<number, number>;
  projectedMinutes: Map<number, number>;
  digestByPatientId?: Map<number, AtRiskDigestEntry>;
  onOpenPatient: (patientId: number) => void;
  onBookSuggestion?: (patientId: number, slot: AtRiskSlot) => void;
}

type RiskFilter = "all" | "large_gap" | "suggestions";
type RiskSort = "largest_gap" | "least_progress" | "name";

export function AtRiskModal({ open, onOpenChange, day, patients, completedMinutes, projectedMinutes, digestByPatientId, onOpenPatient, onBookSuggestion }: AtRiskModalProps) {
  const { canEdit } = usePermissions();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RiskFilter>("all");
  const [sort, setSort] = useState<RiskSort>("largest_gap");
  const [booking, setBooking] = useState<{ patient: Patient; slot: AtRiskSlot } | null>(null);
  const suggestionsAreCurrent = formatDateKey(day) === formatDateKey(new Date());

  const riskRows = useMemo(() => patients.map((patient) => {
    const target = Math.max(1, patient.weeklyMinuteTarget);
    const completed = completedMinutes.get(patient.id) ?? 0;
    const projected = projectedMinutes.get(patient.id) ?? completed;
    const scheduled = Math.max(0, projected - completed);
    const gap = Math.max(0, target - projected);
    const suggestions = suggestionsAreCurrent ? digestByPatientId?.get(patient.id)?.proposedSlots ?? [] : [];
    return { patient, target, completed, projected, scheduled, gap, suggestions };
  }), [completedMinutes, digestByPatientId, patients, projectedMinutes, suggestionsAreCurrent]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return riskRows
      .filter((row) => {
        if (filter === "large_gap" && row.gap < 180) return false;
        if (filter === "suggestions" && row.suggestions.length === 0) return false;
        return !term || row.patient.name.toLowerCase().includes(term) || row.patient.roomNumber.toLowerCase().includes(term) || row.patient.mrn?.toLowerCase().includes(term);
      })
      .sort((a, b) => {
        if (sort === "name") return a.patient.name.localeCompare(b.patient.name);
        if (sort === "least_progress") return (a.projected / a.target) - (b.projected / b.target);
        return b.gap - a.gap;
      });
  }, [filter, riskRows, search, sort]);

  const totalGap = riskRows.reduce((total, row) => total + row.gap, 0);
  const totalCompleted = riskRows.reduce((total, row) => total + row.completed, 0);
  const suggestionCount = riskRows.filter((row) => row.suggestions.length > 0).length;
  const largeGapCount = riskRows.filter((row) => row.gap >= 180).length;

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (nextOpen) {
      setSearch("");
      setFilter("all");
      setSort("largest_gap");
    } else {
      setBooking(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex h-[90vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl xl:max-w-6xl">
          <div className="shrink-0 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-5 py-5 pr-20 text-white sm:px-6">
            <DialogHeader className="text-left">
              <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25"><ShieldAlert className="h-5 w-5"/></div><div><DialogTitle className="text-xl font-bold tracking-tight text-white">Patients at risk</DialogTitle><DialogDescription className="mt-1 text-sm text-blue-50">Review patients who are behind pace or can no longer reach their weekly-minute target as of {format(day, "EEEE, MMMM d, yyyy")}.</DialogDescription></div></div>
            </DialogHeader>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-200 bg-white p-4 sm:px-6 lg:grid-cols-4">
            {[{ label: "Patients", value: riskRows.length, note: "projected below target", tone: "text-amber-700" }, { label: "Remaining gap", value: `${totalGap}m`, note: "after planned sessions", tone: "text-rose-700" }, { label: "Completed", value: `${totalCompleted}m`, note: "documented treatment", tone: "text-emerald-700" }, { label: "Large gaps", value: largeGapCount, note: suggestionsAreCurrent ? `${suggestionCount} with suggestions` : "suggestions hidden", tone: largeGapCount ? "text-rose-700" : "text-emerald-700" }].map((stat) => <div key={stat.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{stat.label}</p><p className={cn("mt-1 text-xl font-extrabold tabular-nums", stat.tone)}>{stat.value}</p><p className="text-xs text-slate-500">{stat.note}</p></div>)}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"/><p className="text-sm"><strong>Projected risk:</strong> completed and currently scheduled treatment still falls below the patient’s configured weekly target. Confirm clinical appropriateness before adding minutes.</p></div>

            {!suggestionsAreCurrent && <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950"><Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-blue-700"/><p className="text-sm">Gap-fill suggestions are generated for today only and are hidden while viewing {format(day, "MMM d")}. Patient risk totals still reflect the selected board date.</p></div>}

            <div className="flex flex-col gap-2 lg:flex-row"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient, room, or MRN…" className="h-11 border-slate-300 bg-white pl-10"/></div><Select value={filter} onValueChange={(value: RiskFilter) => setFilter(value)}><SelectTrigger className="h-11 w-full border-slate-300 bg-white lg:w-48"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All at-risk patients</SelectItem><SelectItem value="large_gap">Gap of 180+ minutes</SelectItem><SelectItem value="suggestions">Has suggestions</SelectItem></SelectContent></Select><Select value={sort} onValueChange={(value: RiskSort) => setSort(value)}><SelectTrigger className="h-11 w-full border-slate-300 bg-white lg:w-44"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="largest_gap">Largest gap</SelectItem><SelectItem value="least_progress">Least progress</SelectItem><SelectItem value="name">Patient name</SelectItem></SelectContent></Select></div>

            <ScrollArea className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
              {filteredRows.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center"><Search className="h-9 w-9 text-slate-300"/><h3 className="mt-3 font-bold text-slate-950">No matching patients</h3><p className="mt-1 text-sm text-slate-600">Try another search or risk filter.</p><Button variant="outline" className="mt-4 h-10" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</Button></div> : <div className="divide-y divide-slate-100">{filteredRows.map((row) => {
                const completedPct = Math.min(100, (row.completed / row.target) * 100);
                const scheduledPct = Math.min(100 - completedPct, (row.scheduled / row.target) * 100);
                return <div key={row.patient.id} className="space-y-4 p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-bold text-slate-950">{row.patient.name}</h3><span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">Room {row.patient.roomNumber}</span>{row.patient.mrn && <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">MRN {row.patient.mrn}</span>}{row.gap >= 180 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">Large gap</span>}</div><p className="mt-1 text-sm text-slate-600">{row.completed}m completed · {row.scheduled}m scheduled · {row.gap}m still needed</p></div><Button variant="outline" className="h-10 shrink-0 border-blue-200 text-blue-800 hover:bg-blue-50" onClick={() => { onOpenChange(false); onOpenPatient(row.patient.id); }}>Open on board <ArrowUpRight className="ml-2 h-4 w-4"/></Button></div><div><div className="flex h-2.5 overflow-hidden rounded-full bg-rose-100"><div className="bg-emerald-500" style={{ width: `${completedPct}%` }}/><div className="bg-amber-400" style={{ width: `${scheduledPct}%` }}/></div><div className="mt-1 flex justify-between text-xs text-slate-500"><span>{row.projected}m projected</span><span>{row.target}m target</span></div></div>{row.suggestions.length > 0 && <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-blue-800">Suggested open times</p><div className="grid gap-2 lg:grid-cols-3">{row.suggestions.map((slot, index) => <div key={`${slot.startTime}-${index}`} className="flex items-center justify-between gap-2 rounded-lg border border-blue-100 bg-white p-2.5"><div className="min-w-0"><p className="text-sm font-bold text-slate-950">{slot.therapyType} · {slot.durationMinutes}m</p><p className="truncate text-xs text-slate-500">{new Date(slot.startTime).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })} · {slot.therapistName ?? "Unassigned"}</p></div><Button size="sm" className="h-10 shrink-0 bg-blue-700 hover:bg-blue-800" disabled={!canEdit || !onBookSuggestion || slot.therapistId == null} onClick={() => setBooking({ patient: row.patient, slot })}><CalendarPlus className="mr-1.5 h-4 w-4"/>Book</Button></div>)}</div></div>}</div>;
              })}</div>}
            </ScrollArea>
          </div>

          <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="text-xs text-slate-500">Green is completed treatment; amber is scheduled treatment. Missed sessions are excluded.</p><Button className="h-11 bg-blue-700 px-6 hover:bg-blue-800" onClick={() => onOpenChange(false)}>Close review</Button></div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!booking} onOpenChange={(nextOpen) => !nextOpen && setBooking(null)}>
        <AlertDialogContent className="max-w-lg overflow-hidden border-slate-200 bg-white p-0"><div className="bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-6 py-5 text-white"><AlertDialogHeader><AlertDialogTitle className="text-xl text-white">Book suggested session?</AlertDialogTitle><AlertDialogDescription className="text-blue-100">Add {booking?.slot.durationMinutes} minutes of {booking?.slot.therapyType} for {booking?.patient.name}.</AlertDialogDescription></AlertDialogHeader></div><div className="space-y-3 p-6"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Time</p><p className="mt-1 text-sm font-bold text-slate-950">{booking ? new Date(booking.slot.startTime).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</p></div><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Therapist</p><p className="mt-1 text-sm font-bold text-slate-950">{booking?.slot.therapistName ?? "Unassigned"}</p></div></div><p className="text-sm text-slate-600">Availability, lunch, and double-booking checks will run before the session is created.</p></div><AlertDialogFooter className="border-t border-slate-200 bg-slate-50 px-6 py-4"><AlertDialogCancel className="h-11">Keep reviewing</AlertDialogCancel><AlertDialogAction className="h-11 bg-blue-700 hover:bg-blue-800" onClick={() => { if (booking && onBookSuggestion) onBookSuggestion(booking.patient.id, booking.slot); setBooking(null); }}>Book session</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </>
  );
}
