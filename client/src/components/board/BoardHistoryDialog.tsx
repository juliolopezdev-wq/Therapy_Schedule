import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { History, Loader2 } from "lucide-react";
import { THERAPY_META, type TherapyType } from "@/lib/board";

interface BoardHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SnapshotSession {
  therapyType: string;
  durationMinutes: number;
}

export function BoardHistoryDialog({ open, onOpenChange }: BoardHistoryDialogProps) {
  const historyQuery = trpc.history.list.useQuery(undefined, { enabled: open });
  const snapshots = historyQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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
                const data = snap.snapshot as { sessions?: SnapshotSession[] } | null;
                const sessions = data?.sessions ?? [];
                const counts: Record<string, number> = {};
                sessions.forEach((s) => {
                  counts[s.therapyType] = (counts[s.therapyType] ?? 0) + 1;
                });
                return (
                  <li
                    key={snap.id}
                    className="rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-800">
                        {new Date(snap.date).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                      <span className="text-xs text-slate-400">
                        Saved {new Date(snap.createdAt).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
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
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
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
      </DialogContent>
    </Dialog>
  );
}
