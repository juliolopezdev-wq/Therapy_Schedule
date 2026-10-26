import { FormEvent, useEffect, useRef, useState } from "react";
import { CheckCheck, Send, UserRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn, staffDisplayName } from "@/lib/utils";
import { toast } from "sonner";

function messageTime(value: Date | string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface DirectConversationPaneProps {
  peerUserId: number;
  peerName: string | null;
  peerRole: string | null;
}

/** The reading/composing half of a direct-message conversation. Owns no directory or thread
 *  list -- the parent inbox picks who's selected and this just renders that one conversation. */
export function DirectConversationPane({ peerUserId, peerName, peerRole }: DirectConversationPaneProps) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [body, setBody] = useState("");
  const messageEndRef = useRef<HTMLDivElement>(null);
  const conversation = trpc.directMessages.conversation.useQuery(
    { peerUserId },
    { refetchInterval: 10_000 },
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

  useEffect(() => {
    markRead.mutate({ peerUserId });
    // Mark-read on every switch to this peer; mutation identity changes each render so it's
    // deliberately left out of the deps list to avoid re-firing in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerUserId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [conversation.data?.length, peerUserId]);

  const name = staffDisplayName({ name: peerName, role: peerRole });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim() || send.isPending) return;
    send.mutate({ recipientUserId: peerUserId, body: body.trim() });
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-slate-200 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700"><UserRound className="h-4 w-4" /></span>
        <div><p className="break-words text-sm font-extrabold text-slate-950">{name}</p>{peerRole && <p className="text-[11px] capitalize text-slate-500">{peerRole.replace("_", " ")}</p>}</div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain bg-slate-50/70 p-4">
        {conversation.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-slate-200" /> : (conversation.data ?? []).length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">No messages yet. Start with a brief operational update.</p>
        ) : (conversation.data ?? []).map((message) => {
          const mine = message.senderUserId === user?.id;
          return (
            <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm", mine ? "rounded-br-md bg-blue-700 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-800")}>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere] leading-5">{message.body}</p>
                <p className={cn("mt-1 flex items-center justify-end gap-1 text-[9px]", mine ? "text-blue-100" : "text-slate-400")}>{messageTime(message.createdAt)}{mine && message.readAt && <><CheckCheck className="h-3 w-3" /> Read</>}</p>
              </div>
            </div>
          );
        })}
        <div ref={messageEndRef} />
      </div>
      <form onSubmit={submit} className="flex shrink-0 items-end gap-2 border-t border-slate-200 p-3">
        <Textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={1200} rows={2} className="min-h-11 resize-none" aria-label="Message" placeholder={`Message ${name}…`} />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0 bg-blue-700 hover:bg-blue-800" disabled={!body.trim() || send.isPending} aria-label="Send message"><Send className="h-4 w-4" /></Button>
      </form>
    </section>
  );
}
