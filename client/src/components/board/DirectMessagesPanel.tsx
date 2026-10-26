import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, LockKeyhole, MessageCircle, Send, UserRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function displayName(person: { name?: string | null; email?: string | null; peerName?: string | null; peerEmail?: string | null }) {
  return person.name || person.peerName || person.email || person.peerEmail || "Staff member";
}

function messageTime(value: Date | string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function DirectMessagesPanel() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [selectedPeerId, setSelectedPeerId] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const messageEndRef = useRef<HTMLDivElement>(null);
  const directory = trpc.directMessages.directory.useQuery();
  const threads = trpc.directMessages.threads.useQuery(undefined, { refetchInterval: 10_000 });
  const conversation = trpc.directMessages.conversation.useQuery(
    { peerUserId: selectedPeerId ?? 0 },
    { enabled: selectedPeerId != null, refetchInterval: 10_000 },
  );
  const send = trpc.directMessages.send.useMutation({
    onSuccess: async () => {
      setBody("");
      await Promise.all([
        utils.directMessages.threads.invalidate(),
        utils.directMessages.conversation.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const markRead = trpc.directMessages.markRead.useMutation({
    onSuccess: () => utils.directMessages.threads.invalidate(),
  });

  const threadRows = threads.data ?? [];
  const activeThread = selectedPeerId == null ? undefined : threadRows.find((thread) => thread.peerUserId === selectedPeerId);
  const activePeer = selectedPeerId == null ? undefined : directory.data?.find((person) => person.id === selectedPeerId);
  const peer = activePeer ?? activeThread;
  const unreadForActive = activeThread?.unreadCount ?? 0;

  useEffect(() => {
    if (selectedPeerId == null && threadRows.length > 0) setSelectedPeerId(threadRows[0].peerUserId);
  }, [selectedPeerId, threadRows]);

  useEffect(() => {
    if (selectedPeerId != null && unreadForActive > 0 && !markRead.isPending) {
      markRead.mutate({ peerUserId: selectedPeerId });
    }
  }, [selectedPeerId, unreadForActive]); // Mutation state intentionally omitted to avoid retrigger loops.

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [conversation.data?.length, selectedPeerId]);

  const totalUnread = useMemo(() => threadRows.reduce((total, thread) => total + thread.unreadCount, 0), [threadRows]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (selectedPeerId == null || !body.trim()) return;
    send.mutate({ recipientUserId: selectedPeerId, body: body.trim() });
  };

  return (
    <div className="space-y-3 p-4 sm:p-5">
      <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
        <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
        <div>
          <p className="text-sm font-extrabold">Private participant-only conversations</p>
          <p className="mt-0.5 text-xs leading-5 text-blue-800">Only you and the selected account can open these messages. Keep patient names, rooms, MRNs, diagnoses, and clinical details in the patient chart.</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid sm:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-slate-50 sm:border-b-0 sm:border-r">
          <div className="border-b border-slate-200 p-3">
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Start a conversation</p>
            <Select value={selectedPeerId?.toString() ?? ""} onValueChange={(value) => setSelectedPeerId(Number(value))}>
              <SelectTrigger className="h-10 bg-white"><SelectValue placeholder="Choose staff" /></SelectTrigger>
              <SelectContent>
                {(directory.data ?? []).map((person) => (
                  <SelectItem key={person.id} value={person.id.toString()}>{displayName(person)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-52 overflow-y-auto sm:max-h-[430px]">
            <div className="flex items-center justify-between px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500">
              <span>Conversations</span>
              {totalUnread > 0 && <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-white">{totalUnread} new</span>}
            </div>
            {threads.isLoading ? (
              <div className="m-3 h-20 animate-pulse rounded-xl bg-slate-200" />
            ) : threadRows.length === 0 ? (
              <p className="px-3 pb-4 text-xs leading-5 text-slate-500">Choose a staff member above to begin.</p>
            ) : threadRows.map((thread) => (
              <button
                key={thread.peerUserId}
                type="button"
                onClick={() => setSelectedPeerId(thread.peerUserId)}
                className={cn("flex w-full items-start gap-2.5 border-t border-slate-200 px-3 py-3 text-left transition-colors hover:bg-white", selectedPeerId === thread.peerUserId && "bg-white shadow-[inset_3px_0_0_#2563eb]")}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-800">{displayName(thread).slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-1"><strong className="min-w-0 truncate text-xs text-slate-900">{displayName(thread)}</strong>{thread.unreadCount > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white">{thread.unreadCount}</span>}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">{thread.sentByMe ? "You: " : ""}{thread.lastMessage}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-h-[430px] flex-col">
          {!peer || selectedPeerId == null ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <MessageCircle className="h-10 w-10 text-slate-300" />
              <p className="mt-3 font-bold text-slate-900">Choose someone to message</p>
              <p className="mt-1 text-sm text-slate-500">Coordinate a handoff, coverage, or workflow question privately.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-700"><UserRound className="h-4 w-4" /></span>
                <div><p className="text-sm font-extrabold text-slate-950">{displayName(peer)}</p><p className="text-[11px] capitalize text-slate-500">{activeThread?.peerRole.replace("_", " ") ?? activePeer?.role.replace("_", " ")}</p></div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50/70 p-4 sm:max-h-[330px]">
                {conversation.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-slate-200" /> : (conversation.data ?? []).length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-500">No messages yet. Start with a brief operational update.</p>
                ) : (conversation.data ?? []).map((message) => {
                  const mine = message.senderUserId === user?.id;
                  return (
                    <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                      <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm", mine ? "rounded-br-md bg-blue-700 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-800")}>
                        <p className="whitespace-pre-wrap leading-5">{message.body}</p>
                        <p className={cn("mt-1 flex items-center justify-end gap-1 text-[9px]", mine ? "text-blue-100" : "text-slate-400")}>{messageTime(message.createdAt)}{mine && message.readAt && <><CheckCheck className="h-3 w-3" /> Read</>}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messageEndRef} />
              </div>
              <form onSubmit={submit} className="flex items-end gap-2 border-t border-slate-200 p-3">
                <Textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={1200} rows={2} className="min-h-11 resize-none" placeholder={`Message ${displayName(peer)}…`} />
                <Button type="submit" size="icon" className="h-11 w-11 shrink-0 bg-blue-700 hover:bg-blue-800" disabled={!body.trim() || send.isPending} aria-label="Send message"><Send className="h-4 w-4" /></Button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
