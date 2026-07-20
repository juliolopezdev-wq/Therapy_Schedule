import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Pencil, Plus, Trash2, Users, UserPlus } from "lucide-react";

interface Patient {
  id: number;
  roomNumber: string;
  name: string;
  notes: string | null;
  isDischarged: boolean;
}

interface PatientPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: Patient[];
  onAdd: (initialData?: Partial<Patient>) => void;
  onEdit: (patient: Patient) => void;
  onDelete: (id: number) => void;
  therapists: { id: number; name: string; teamId: number | null }[];
  teams: { id: number; name: string; color: string }[];
}

export function PatientPanel({
  open,
  onOpenChange,
  patients,
  onAdd,
  onEdit,
  onDelete,
}: PatientPanelProps) {
  const [showDischarged, setShowDischarged] = useState(false);
  
  const activePatients = patients.filter((p) => !p.isDischarged);
  const dischargedPatients = patients.filter((p) => p.isDischarged);
  
  const displayedPatients = showDischarged ? dischargedPatients : activePatients;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-slate-200 p-5">
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-500" /> Patient Management
          </SheetTitle>
          <SheetDescription>
            Add, edit, and remove patients on the board.
          </SheetDescription>
        </SheetHeader>

        <div className="border-b border-slate-100 p-4 space-y-3">
          <Button className="w-full" onClick={() => onAdd()}>
            <Plus className="mr-1 h-4 w-4" /> Add Patient
          </Button>
          
          <div className="flex rounded-md bg-slate-100 p-1">
            <button
              className={`flex-1 rounded py-1.5 text-sm font-medium transition-all ${!showDischarged ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              onClick={() => setShowDischarged(false)}
            >
              Active ({activePatients.length})
            </button>
            <button
              className={`flex-1 rounded py-1.5 text-sm font-medium transition-all ${showDischarged ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              onClick={() => setShowDischarged(true)}
            >
              Discharged ({dischargedPatients.length})
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {displayedPatients.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Users className="h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">
                {showDischarged ? "No discharged patients." : "No active patients yet."}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {displayedPatients.map((patient) => (
                <li
                  key={patient.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                        {patient.roomNumber}
                      </span>
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {patient.name}
                      </span>
                      {patient.isDischarged ? (
                        <Badge variant="outline" className="border-red-200 bg-red-50 text-[10px] text-red-700">
                          DC
                        </Badge>
                      ) : null}
                    </div>
                    {patient.notes ? (
                      <p className="mt-0.5 truncate text-xs text-slate-400">{patient.notes}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {showDischarged ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs font-semibold text-blue-600 border-blue-200 bg-blue-50 hover:bg-blue-100"
                        onClick={() => onAdd({ name: patient.name, notes: patient.notes, isDischarged: false })}
                      >
                        <UserPlus className="mr-1 h-3 w-3" /> Re-admit
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-500"
                        onClick={() => onEdit(patient)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-500 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {patient.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove the patient and all of their scheduled
                            sessions. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => onDelete(patient.id)}
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
