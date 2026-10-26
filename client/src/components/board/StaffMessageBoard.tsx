import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DirectMessagesPanel } from "./DirectMessagesPanel";
import {
  Archive,
  BellRing,
  Check,
  CheckCheck,
  CircleAlert,
  HeartHandshake,
  Loader2,
  Megaphone,
  MessageSquareText,
  MessagesSquare,
  Pin,
  PinOff,
  Plus,
  Radio,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";

type Channel = "general" | "handoff" | "coverage" | "kudos";
type Priority = "normal" | "important" | "urgent";

const CHANNELS: Record<Channel, { label: string; icon: typeof Users; className: string }> = {
  general: { label: "Team updates", icon: Megaphone, className: "bg-blue-50 text-blue-800 border-blue-200" },
  handoff: { label: "Shift handoff", icon: HeartHandshake, className: "bg-violet-50 text-violet-800 border-violet-200" },
  coverage: { label: "Coverage", icon: Users, className: "bg-amber-50 text-amber-900 border-amber-200" },
  kudos: { label: "Kudos", icon: Sparkles, className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
};

function relativeTime(value: Date | string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function StaffMessageBoard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const query = trpc.messageBoard.list.useQuery(undefined, { refetchInterval: 30_000 });
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<Channel>("general");
  const [priority, setPriority] = useState<Priority>("normal");
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(false);
  const [view, setView] = useState<"board" | "direct">("board");
  const directThreads = trpc.directMessages.threads.useQuery(undefined, { refetchInterval: 10_000 });
  const directUnread = (directThreads.data ?? []).reduce((total, thread) => total + thread.unreadCount, 0);

  const refresh = () => utils.messageBoard.list.invalidate();
  const create = trpc.messageBoard.create.useMutation({
    onSuccess: () => {
      toast.success(priority === "urgent" ? "Urgent alert broadcast to all staff" : "Posted to the staff board");
      setTitle(""); setBody(""); setChannel("general"); setPriority("normal"); setRequiresAcknowledgement(false); setComposing(false);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const acknowledge = trpc.messageBoard.acknowledge.useMutation({ onSuccess: refresh, onError: (error) => toast.error(error.message) });
  const resolve = trpc.messageBoard.resolve.useMutation({ onSuccess: refresh, onError: (error) => toast.error(error.message) });
  const archive = trpc.messageBoard.archive.useMutation({ onSuccess: refresh, onError: (error) => toast.error(error.message) });
  const pin = trpc.messageBoard.pin.useMutation({ onSuccess: refresh, onError: (error) => toast.error(error.message) });

  const messages = query.data ?? [];
  const filtered = channelFilter === "all" ? messages : messages.filter((message) => message.channel === channelFilter);
  const needsMyAck = messages.filter((message) => message.requiresAcknowledgement && !message.acknowledgedByMe && !message.resolvedAt).length;
  const urgent = messages.filter((message) => message.priority === "urgent" && !message.resolvedAt).length;
  const openCoverage = messages.filter((message) => message.channel === "coverage" && !message.resolvedAt).length;

  const channelCounts = useMemo(() => Object.fromEntries(
    (Object.keys(CHANNELS) as Channel[]).map((key) => [key, messages.filter((message) => message.channel === key).length]),
  ) as Record<Channel, number>, [messages]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto border-l-slate-200 bg-slate-50 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-blue-700 bg-gradient-to-r from-blue-800 to-sky-700 px-5 py-5 text-left text-white">
          <div className="flex items-start gap-3 pr-10">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20"><MessageSquareText className="h-5 w-5" /></span>
            <div>
              <SheetTitle className="text-xl font-black text-white">Staff Signal Board</SheetTitle>
              <SheetDescription className="mt-1 text-sm text-blue-100">Live operational updates for techs, clinicians, leads, and admins.</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="grid grid-cols-2 border-b border-slate-200 bg-white p-2">
          <Button type="button" variant={view === "board" ? "default" : "ghost"} className="h-10" onClick={() => setView("board")}><Megaphone className="mr-2 h-4 w-4" />Team board</Button>
          <Button type="button" variant={view === "direct" ? "default" : "ghost"} className="relative h-10" onClick={() => setView("direct")}><MessagesSquare className="mr-2 h-4 w-4" />Direct messages{directUnread > 0 && <span className="ml-2 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white">{directUnread}</span>}</Button>
        </div>

        {view === "direct" ? <DirectMessagesPanel /> : (
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Need my acknowledgment", value: needsMyAck, icon: BellRing, tone: needsMyAck ? "text-rose-700" : "text-slate-600" },
              { label: "Urgent signals", value: urgent, icon: ShieldAlert, tone: urgent ? "text-rose-700" : "text-slate-600" },
              { label: "Coverage open", value: openCoverage, icon: Radio, tone: openCoverage ? "text-amber-700" : "text-slate-600" },
            ].map(({ label, value, icon: Icon, tone }) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-1.5"><Icon className={cn("h-4 w-4", tone)} /><span className="text-xl font-black tabular-nums text-slate-950">{value}</span></div>
                <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          <div role="note" className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-xs leading-5"><strong>Keep it operational.</strong> Do not post patient names, room numbers, MRNs, diagnoses, or clinical details. Use the patient chart for clinical communication.</p>
          </div>

          {!composing ? (
            <Button className="h-11 w-full bg-blue-700 font-bold hover:bg-blue-800" onClick={() => setComposing(true)}><Plus className="mr-2 h-4 w-4" />Post an update</Button>
          ) : (
            <form className="space-y-3 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm" onSubmit={(event) => {
              event.preventDefault();
              create.mutate({ title, body, channel, priority, requiresAcknowledgement });
            }}>
              <div className="flex items-center justify-between"><h3 className="font-extrabold text-slate-950">New signal</h3><span className="text-xs font-semibold text-slate-500">Posting as {user?.name || user?.email}</span></div>
              <div><Label htmlFor="signal-title">Headline</Label><Input id="signal-title" className="mt-1 h-11" maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What does the team need to know?" /></div>
              <div><Label htmlFor="signal-body">Details</Label><Textarea id="signal-body" className="mt-1 min-h-24 resize-none" maxLength={1200} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add the operational context, owner, and next step—without patient identifiers." /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Channel</Label><Select value={channel} onValueChange={(value) => setChannel(value as Channel)}><SelectTrigger className="mt-1 h-11"><SelectValue /></SelectTrigger><SelectContent>{(Object.entries(CHANNELS) as [Channel, typeof CHANNELS[Channel]][]).map(([key, value]) => <SelectItem key={key} value={key}>{value.label}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Priority</Label><Select value={priority} onValueChange={(value) => { const next = value as Priority; setPriority(next); if (next === "urgent") setRequiresAcknowledgement(true); }}><SelectTrigger className="mt-1 h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">Normal</SelectItem><SelectItem value="important">Important</SelectItem><SelectItem value="urgent">Urgent broadcast</SelectItem></SelectContent></Select></div>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={requiresAcknowledgement} disabled={priority === "urgent"} onChange={(event) => setRequiresAcknowledgement(event.target.checked)} className="h-4 w-4 accent-blue-700" />{priority === "urgent" ? "Urgent broadcasts require acknowledgment from every reader" : "Require each reader to acknowledge"}</label>
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setComposing(false)}>Cancel</Button><Button type="submit" disabled={!title.trim() || !body.trim() || create.isPending} className="bg-blue-700 hover:bg-blue-800">{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Post signal</Button></div>
            </form>
          )}

          <div className="flex gap-2 overflow-x-auto pb-1">
            <Button size="sm" variant={channelFilter === "all" ? "default" : "outline"} className="h-10 shrink-0" onClick={() => setChannelFilter("all")}>All {messages.length}</Button>
            {(Object.entries(CHANNELS) as [Channel, typeof CHANNELS[Channel]][]).map(([key, value]) => <Button key={key} size="sm" variant={channelFilter === key ? "default" : "outline"} className="h-10 shrink-0" onClick={() => setChannelFilter(key)}>{value.label} {channelCounts[key]}</Button>)}
          </div>

          {query.isLoading ? <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><MessageSquareText className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 font-bold text-slate-900">No signals in this channel</p><p className="mt-1 text-sm text-slate-500">Post the first update when the team needs alignment.</p></div>
          ) : filtered.map((message) => {
            const channelMeta = CHANNELS[message.channel];
            const ChannelIcon = channelMeta.icon;
            const canModerate = user?.role === "admin" || user?.id === message.authorUserId;
            return (
              <article key={message.id} className={cn("overflow-hidden rounded-2xl border bg-white shadow-sm", message.priority === "urgent" ? "border-rose-300" : message.pinned ? "border-blue-300" : "border-slate-200", message.resolvedAt && "opacity-70")}>
                <div className={cn("h-1", message.priority === "urgent" ? "bg-rose-600" : message.priority === "important" ? "bg-amber-500" : "bg-blue-500")} />
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold", channelMeta.className)}><ChannelIcon className="h-3 w-3" />{channelMeta.label}</span>{message.priority !== "normal" && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-black uppercase", message.priority === "urgent" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800")}>{message.priority}</span>}{message.pinned && <Pin className="h-4 w-4 text-blue-700" />}{message.resolvedAt && <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><Check className="h-3.5 w-3.5" />Resolved</span>}</div><h3 className="mt-2 text-base font-black text-slate-950">{message.title}</h3></div>
                    <span className="shrink-0 text-xs text-slate-400">{relativeTime(message.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.body}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <div><p className="text-xs font-bold text-slate-700">{message.authorName || message.authorEmail || "Staff member"}</p><p className="text-[11px] capitalize text-slate-500">{message.authorRole?.replace("_", " ")} · {message.acknowledgementCount} acknowledged</p></div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {message.requiresAcknowledgement && !message.acknowledgedByMe && <Button size="sm" className="h-9 bg-emerald-700 hover:bg-emerald-800" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate({ id: message.id })}><CheckCheck className="mr-1.5 h-4 w-4" />Acknowledge</Button>}
                      {message.requiresAcknowledgement && message.acknowledgedByMe && <span className="inline-flex h-9 items-center gap-1 rounded-lg bg-emerald-50 px-3 text-xs font-bold text-emerald-800"><CheckCheck className="h-4 w-4" />Acknowledged</span>}
                      {canModerate && <Button size="sm" variant="outline" className="h-9" onClick={() => resolve.mutate({ id: message.id, resolved: !message.resolvedAt })}><Check className="mr-1.5 h-4 w-4" />{message.resolvedAt ? "Reopen" : "Resolve"}</Button>}
                      {user?.role === "admin" && <Button size="icon" variant="ghost" className="h-9 w-9" title={message.pinned ? "Unpin" : "Pin"} onClick={() => pin.mutate({ id: message.id, pinned: !message.pinned })}>{message.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</Button>}
                      {canModerate && <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-500 hover:text-rose-700" title="Archive" onClick={() => archive.mutate({ id: message.id })}><Archive className="h-4 w-4" /></Button>}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
