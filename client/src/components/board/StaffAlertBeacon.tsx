import { BellRing, CheckCheck, MessageSquareText, Radio } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { cn, staffDisplayName } from "@/lib/utils";
import { toast } from "sonner";

export function StaffAlertBeacon({ onOpenBoard }: { onOpenBoard: () => void }) {
  const utils = trpc.useUtils();
  const query = trpc.messageBoard.list.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });
  const acknowledge = trpc.messageBoard.acknowledge.useMutation({
    onSuccess: async () => {
      toast.success("Staff alert acknowledged");
      await utils.messageBoard.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const alerts = (query.data ?? [])
    .filter((message) => !message.resolvedAt && !message.acknowledgedByMe && (message.priority === "urgent" || message.requiresAcknowledgement))
    .sort((a, b) => {
      if (a.priority === "urgent" && b.priority !== "urgent") return -1;
      if (b.priority === "urgent" && a.priority !== "urgent") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const alert = alerts[0];
  if (!alert) return null;

  const urgent = alert.priority === "urgent";

  return (
    <aside
      role="alert"
      aria-live={urgent ? "assertive" : "polite"}
      className={cn(
        "fixed bottom-4 right-4 z-[70] w-[calc(100vw-2rem)] max-w-md overflow-hidden rounded-2xl border bg-white shadow-2xl",
        urgent ? "border-rose-300 shadow-rose-950/20" : "border-amber-300 shadow-amber-950/15",
      )}
    >
      <div className={cn("h-1.5", urgent ? "bg-gradient-to-r from-rose-700 via-rose-500 to-orange-400" : "bg-gradient-to-r from-amber-600 to-yellow-400")} />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className={cn("relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", urgent ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800")}>
            {urgent ? <BellRing className="h-5 w-5" /> : <Radio className="h-5 w-5" />}
            <span className={cn("absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white", urgent ? "animate-pulse bg-rose-600" : "bg-amber-500")} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className={cn("text-[11px] font-black uppercase tracking-widest", urgent ? "text-rose-700" : "text-amber-800")}>
                {urgent ? "Urgent staff broadcast" : "Staff acknowledgment needed"}
              </p>
              {alerts.length > 1 && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">1 of {alerts.length}</span>}
            </div>
            <h2 className="mt-1 text-base font-black leading-5 text-slate-950">{alert.title}</h2>
            <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-700">{alert.body}</p>
            <p className="mt-2 text-[11px] font-semibold text-slate-500">
              From {staffDisplayName({ name: alert.authorName, role: alert.authorRole })} · Acknowledge to clear this alert
            </p>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={onOpenBoard}>
            <MessageSquareText className="mr-1.5 h-4 w-4" /> Open staff board
          </Button>
          <Button
            type="button"
            size="sm"
            className={cn("h-10 font-bold", urgent ? "bg-rose-700 hover:bg-rose-800" : "bg-amber-600 text-white hover:bg-amber-700")}
            disabled={acknowledge.isPending}
            onClick={() => acknowledge.mutate({ id: alert.id })}
          >
            <CheckCheck className="mr-1.5 h-4 w-4" /> I acknowledge
          </Button>
        </div>
      </div>
    </aside>
  );
}
