import { useState } from "react";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { AlertCircle, UserMinus } from "lucide-react";
import { toast } from "sonner";
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

export function DailyAttendance({
  day,
  therapists,
  open,
  onOpenChange,
}: {
  day: Date;
  therapists: any[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpcContext = trpc.useContext();
  const [confirmCallOff, setConfirmCallOff] = useState<{ therapistId: number; name: string } | null>(null);
  
  const { data: absences = [] } = trpc.attendance.getAbsences.useQuery(
    { date: day },
    { enabled: open }
  );

  const callOffMutation = trpc.attendance.callOff.useMutation({
    onSuccess: (data) => {
      trpcContext.attendance.getAbsences.invalidate();
      trpcContext.sessions.list.invalidate(); // refresh the board sessions
      trpcContext.sessions.listForWeek.invalidate();

      let description = `Successfully re-assigned ${data.reAssignedCount} sessions. ${data.unassignedCount} sessions could not be covered and remain as gaps.`;
      
      const reassignedTo = data.reassignedTo || {};
      if (data.reAssignedCount > 0 && Object.keys(reassignedTo).length > 0) {
        const reassignmentDetails = Object.entries(reassignedTo).map(([idStr, count]) => {
          const therapist = therapists.find(t => t.id === parseInt(idStr));
          return `${count} to ${therapist?.name || 'Unknown'}`;
        }).join(", ");
        description += `\nReassignments: ${reassignmentDetails}`;
      }

      toast.success("Call-Off Processed", {
        description,
      });
    },
  });

  const cancelCallOffMutation = trpc.attendance.cancelCallOff.useMutation({
    onSuccess: () => {
      trpcContext.attendance.getAbsences.invalidate();
    },
  });

  const isAbsent = (therapistId: number) => {
    return absences.some((a) => a.therapistId === therapistId);
  };

  const handleToggle = async (therapistId: number, name: string, currentAbsent: boolean) => {
    if (!currentAbsent) {
      setConfirmCallOff({ therapistId, name });
    } else {
      cancelCallOffMutation.mutate({ therapistId, date: day });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[540px] flex flex-col p-0">
        <div className="flex flex-col h-full bg-slate-50">
          <SheetHeader className="px-6 py-5 bg-white border-b border-slate-200">
            <div className="flex items-center gap-2">
              <UserMinus className="h-5 w-5 text-indigo-500" />
              <SheetTitle>Daily Attendance</SheetTitle>
            </div>
            <SheetDescription>
              Manage staff call-offs for {format(day, "EEEE, MMMM do, yyyy")}.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="flex items-start gap-3 bg-amber-50 text-amber-800 p-3 rounded-lg border border-amber-200/60 mb-4">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-amber-500" />
              <p className="text-sm">
                Marking a therapist as <strong>Call-Off</strong> will automatically attempt to reassign all their scheduled sessions today to another available therapist of the same discipline. Any sessions that cannot be covered will become <em>unassigned gaps</em>.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="grid grid-cols-1 divide-y divide-slate-100">
                {therapists.map((t) => {
                  const absent = isAbsent(t.id);
                  return (
                    <div key={t.id} className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: t.color }}
                        />
                        <div>
                          <p className="font-semibold text-sm text-slate-800">{t.name}</p>
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-widest">{t.therapyType}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-bold uppercase tracking-wider ${absent ? "text-rose-500" : "text-emerald-500"}`}>
                          {absent ? "Absent" : "Present"}
                        </span>
                        <Switch
                          checked={!absent}
                          onCheckedChange={() => handleToggle(t.id, t.name, absent)}
                          className={absent ? "bg-rose-500" : "bg-emerald-500"}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
      <AlertDialog open={!!confirmCallOff} onOpenChange={(open) => !open && setConfirmCallOff(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {confirmCallOff?.name} as Absent?</AlertDialogTitle>
            <AlertDialogDescription>
              The system will attempt to automatically reassign all their sessions for {format(day, "MMM d")} to another available therapist of the same discipline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={() => {
                if (confirmCallOff) {
                  callOffMutation.mutate({ therapistId: confirmCallOff.therapistId, date: day, reason: "Call-Off" });
                }
                setConfirmCallOff(null);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
