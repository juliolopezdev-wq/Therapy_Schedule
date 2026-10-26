import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, LoaderCircle, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BoardStatusSummaryProps {
  conflictCount: number;
  isLoading: boolean;
  isRefreshing: boolean;
  isSaving: boolean;
  errorMessage?: string | null;
  onRetry: () => void;
  onReviewConflicts?: () => void;
}

export function BoardStatusSummary({
  conflictCount,
  isLoading,
  isRefreshing,
  isSaving,
  errorMessage,
  onRetry,
  onReviewConflicts,
}: BoardStatusSummaryProps) {
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const hasSystemState = !isOnline || Boolean(errorMessage) || isLoading || isSaving || isRefreshing;

  return (
    <div className="space-y-2" aria-live="polite" aria-atomic="false">
      {!isOnline && (
        <div role="alert" className="flex min-h-11 items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
          <CloudOff className="h-5 w-5 shrink-0" />
          <div className="flex-1"><strong>Offline.</strong> You can review loaded information, but changes cannot be saved.</div>
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-950">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1"><strong>Board update failed.</strong> {errorMessage}</div>
          <Button variant="outline" size="sm" className="h-10 border-rose-300 bg-white" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh board
          </Button>
        </div>
      )}

      {!errorMessage && (isLoading || isRefreshing || isSaving) && (
        <div className="flex min-h-11 items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-950" role="status">
          {isSaving ? <Save className="h-5 w-5 shrink-0" /> : <LoaderCircle className="h-5 w-5 shrink-0 animate-spin" />}
          <span className="font-semibold">
            {isSaving ? "Saving changes…" : isLoading ? "Loading the schedule…" : "Refreshing the schedule…"}
          </span>
        </div>
      )}

      {conflictCount > 0 && (
        <div role="alert" className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-rose-700" />
          <div className="min-w-0 flex-1">
            <strong>{conflictCount} session{conflictCount === 1 ? " has" : "s have"} a scheduling conflict.</strong>
            <span className="ml-1 text-slate-600">Review the patient and therapist assignments before finalizing the day.</span>
          </div>
          {onReviewConflicts && (
            <Button variant="outline" size="sm" className="h-10 border-slate-300 bg-white" onClick={onReviewConflicts}>
              Review first conflict
            </Button>
          )}
        </div>
      )}

      {!hasSystemState && conflictCount === 0 && (
        <div className="sr-only" role="status"><CheckCircle2 /> Schedule loaded with no detected conflicts.</div>
      )}
    </div>
  );
}
