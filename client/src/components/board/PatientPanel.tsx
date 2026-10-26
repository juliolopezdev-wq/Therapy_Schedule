import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { Archive, Bed, CalendarDays, Pencil, Plus, RotateCcw, Search, Users, UserPlus, X } from "lucide-react";
import type { Patient } from "../../../../drizzle/schema";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { cn } from "@/lib/utils";

interface PatientPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: Array<Patient & { accessLevel?: "full" | "schedule" }>;
  archivedPatients: Patient[];
  onAdd: (initialData?: Partial<Patient>) => void;
  onEdit: (patient: Patient) => void;
  onReadmit: (patient: Patient) => void;
  onArchive: (id: number, reason?: string) => void;
  onRestore: (id: number) => void;
}

type PatientView = "active" | "discharged" | "archived" | "available";

function maskedMrn(mrn: string | null) {
  if (!mrn) return "MRN missing";
  return `MRN ••••${mrn.slice(-4)}`;
}

function formatClinicalDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function PatientPanel({
  open,
  onOpenChange,
  patients,
  archivedPatients,
  onAdd,
  onEdit,
  onReadmit,
  onArchive,
  onRestore,
}: PatientPanelProps) {
  const { canEdit, isAdmin } = usePermissions();
  const [view, setView] = useState<PatientView>("active");
  const [archiveReason, setArchiveReason] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  
  const activePatients = patients.filter((p) => !p.isDischarged && !p.isRoomPlaceholder);
  const dischargedPatients = patients.filter((p) => p.isDischarged && !p.isRoomPlaceholder);
  const availableRooms = patients.filter((p) => p.isRoomPlaceholder);
  
  const patientsForView = view === "active"
    ? activePatients
    : view === "discharged"
      ? dischargedPatients
      : view === "archived"
        ? archivedPatients
        : availableRooms;

  const displayedPatients = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return patientsForView
      .filter((patient) => !query || [patient.name, patient.roomNumber, patient.mrn, patient.notes]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)))
      .sort((a, b) => {
        const roomComparison = a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
        return roomComparison || a.name.localeCompare(b.name);
      });
  }, [patientsForView, searchQuery]);

  const tabs: { id: PatientView; label: string; count: number }[] = [
    { id: "active", label: "Active", count: activePatients.length },
    { id: "discharged", label: "Discharged", count: dischargedPatients.length },
    { id: "available", label: "Available", count: availableRooms.length },
    { id: "archived", label: "Archived", count: archivedPatients.length },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-slate-50 p-0 sm:max-w-xl lg:max-w-2xl [&>[data-slot=sheet-close]]:flex [&>[data-slot=sheet-close]]:h-10 [&>[data-slot=sheet-close]]:w-10 [&>[data-slot=sheet-close]]:items-center [&>[data-slot=sheet-close]]:justify-center [&>[data-slot=sheet-close]]:rounded-xl [&>[data-slot=sheet-close]]:border [&>[data-slot=sheet-close]]:border-white/30 [&>[data-slot=sheet-close]]:bg-white/15 [&>[data-slot=sheet-close]]:text-white [&>[data-slot=sheet-close]]:opacity-100 [&>[data-slot=sheet-close]]:shadow-sm [&>[data-slot=sheet-close]]:hover:bg-white/25 [&>[data-slot=sheet-close]]:focus:ring-white [&>[data-slot=sheet-close]>svg]:size-5">
        <SheetHeader className="border-b border-blue-700 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 p-5 pr-16 text-white">
          <div className="flex items-start gap-3 text-left">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
              <Users className="h-6 w-6 text-blue-100" />
            </div>
            <div>
              <SheetTitle className="text-xl font-bold text-white">Patient Management</SheetTitle>
              <SheetDescription className="mt-1 text-sm text-blue-100">
                Manage active admissions, discharge history, rooms, and archived records.
              </SheetDescription>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2" aria-label="Admission summary">
            {[
              { label: "Active", value: activePatients.length, tone: "text-white" },
              { label: "History", value: dischargedPatients.length, tone: "text-sky-200" },
              { label: "Rooms", value: availableRooms.length, tone: "text-emerald-200" },
              { label: "Archived", value: archivedPatients.length, tone: "text-amber-200" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-left">
                <div className={cn("text-lg font-bold tabular-nums", stat.tone)}>{stat.value}</div>
                <div className="truncate text-xs font-semibold text-blue-100">{stat.label}</div>
              </div>
            ))}
          </div>
        </SheetHeader>

        <div className="space-y-4 border-b border-slate-200 bg-white p-4">
          {isAdmin && (
            <Button className="h-11 w-full rounded-xl bg-blue-600 font-bold text-white shadow-sm hover:bg-blue-700" onClick={() => onAdd()}>
              <Plus className="mr-2 h-4 w-4" /> Add admission
            </Button>
          )}

          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  "min-h-10 rounded-lg px-2 text-xs font-semibold transition-colors",
                  view === tab.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
                )}
                onClick={() => {
                  setView(tab.id);
                  setSearchQuery("");
                }}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search patient, room, MRN, or notes..."
              className="h-11 rounded-xl border-slate-300 bg-white pl-10 pr-11 text-sm shadow-sm"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear patient search"
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 top-0.5 flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
          {displayedPatients.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <Users className="h-10 w-10 text-slate-300" />
              <p className="mt-3 text-base font-bold text-slate-800">
                {searchQuery
                  ? "No matching records"
                  : view === "active" ? "No active admissions" : view === "discharged" ? "No discharged admissions" : view === "archived" ? "No archived admissions" : "No available rooms"}
              </p>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                {searchQuery ? "Try a different patient name, room, MRN, or keyword." : "Records for this category will appear here."}
              </p>
              {searchQuery && (
                <Button variant="outline" className="mt-4 h-10" onClick={() => setSearchQuery("")}>Clear search</Button>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {displayedPatients.map((patient) => (
                <li
                  key={patient.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={cn(
                        "flex min-w-[72px] shrink-0 flex-col items-center justify-center rounded-xl border px-3 py-2",
                        patient.isRoomPlaceholder ? "border-emerald-200 bg-emerald-50" : "border-blue-200 bg-blue-50",
                      )}>
                        <span className={cn("text-xs font-semibold", patient.isRoomPlaceholder ? "text-emerald-700" : "text-blue-700")}>Room</span>
                        <span className={cn("text-lg font-black tabular-nums", patient.isRoomPlaceholder ? "text-emerald-950" : "text-blue-950")}>{patient.roomNumber || "—"}</span>
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-bold text-slate-950">
                            {patient.isRoomPlaceholder ? "Available room" : patient.name}
                          </h3>
                          {patient.isRoomPlaceholder && <Badge className="bg-emerald-100 text-xs text-emerald-800 hover:bg-emerald-100">Open</Badge>}
                          {patient.isDischarged && <Badge variant="outline" className="border-sky-200 bg-sky-50 text-xs text-sky-800">Discharged</Badge>}
                          {view === "archived" && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-xs text-amber-800">Archived</Badge>}
                        </div>

                        {!patient.isRoomPlaceholder && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                            <span className="font-semibold">{maskedMrn(patient.mrn)}</span>
                            {patient.admissionDate && (
                              <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Admitted {formatClinicalDate(patient.admissionDate)}</span>
                            )}
                            <span>{patient.weeklyMinuteTarget} min/week</span>
                          </div>
                        )}

                        {patient.estimatedDischargeDate && !patient.isRoomPlaceholder && (
                          <p className="mt-1 text-xs font-medium text-slate-600">Estimated discharge: {formatClinicalDate(patient.estimatedDischargeDate)}</p>
                        )}
                        {view === "archived" && patient.archiveReason && (
                          <p className="mt-1 text-xs font-medium text-amber-800">Archive reason: {patient.archiveReason}</p>
                        )}
                        {patient.notes && (
                          <p className="mt-2 line-clamp-2 text-sm text-slate-600">{patient.notes}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-2 self-end sm:self-start">
                    {(isAdmin || (canEdit && view === "active" && "accessLevel" in patient && patient.accessLevel === "full")) && (view === "available" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                        onClick={() => onEdit(patient)}
                      >
                        <Bed className="mr-2 h-4 w-4" /> Admit
                      </Button>
                    ) : view === "discharged" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 border-blue-200 bg-blue-50 text-xs font-semibold text-blue-800 hover:bg-blue-100"
                        onClick={() => onReadmit(patient)}
                      >
                        <UserPlus className="mr-2 h-4 w-4" /> New admission
                      </Button>
                    ) : view === "active" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 border-slate-300 text-xs font-semibold text-slate-700"
                        onClick={() => onEdit(patient)}
                        aria-label={`Edit ${patient.name}`}
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </Button>
                    ) : null)}
                    {isAdmin && view === "archived" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 text-xs font-semibold"
                        onClick={() => onRestore(patient.id)}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" /> Restore
                      </Button>
                    )}
                    {isAdmin && view !== "archived" && view !== "available" && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-10 border-amber-200 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                            aria-label={`Archive ${patient.name}`}
                            onClick={() => setArchiveReason("")}
                          >
                            <Archive className="mr-2 h-4 w-4" /> Archive
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="border-slate-200 bg-white p-6">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Archive {patient.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              The admission will leave the board, but schedules, adjustments,
                              flags, and audit history will be retained. An admin can restore it.
                            </AlertDialogDescription>
                            <Input
                              value={archiveReason}
                              onChange={(event) => setArchiveReason(event.target.value)}
                              placeholder="Reason (optional)"
                            />
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="h-11 bg-amber-600 hover:bg-amber-700"
                              onClick={() => onArchive(patient.id, archiveReason || undefined)}
                            >
                              Archive
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
