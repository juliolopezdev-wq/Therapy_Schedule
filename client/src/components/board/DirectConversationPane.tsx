import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Send, UserRound } from "lucide-react";
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
  const lastTypingPing = useRef(0);
  const conversation = trpc.directMessages.conversation.useQuery(
    { peerUserId },
    { refetchInterval: 4_000 },
  );
  const peerTyping = trpc.directMessages.peerTyping.useQuery(
    { peerUserId },
    { refetchInterval: 2_000 },
  );
  const setTyping = trpc.directMessages.setTyping.useMutation();
  const send = trpc.directMessages.send.useMutation({
    onSuccess: async () => {
      setBody("");
      lastTypingPing.current = 0;
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

  const messages = conversation.data ?? [];
  const hasUnread = messages.some((message) => message.senderUserId === peerUserId && !message.readAt);
  const peerIsTyping = peerTyping.data === true;

  // Mark read whenever new messages land while this chat is open, not only when it's first
  // opened -- otherwise the sender never sees "Read" for replies that arrive mid-conversation.
  useEffect(() => {
    if (hasUnread && !markRead.isPending) markRead.mutate({ peerUserId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerUserId, hasUnread, messages.length]);

  // Stop showing "typing" on the other side when switching away from this chat.
  useEffect(() => {
    lastTypingPing.current = 0;
    return () => setTyping.mutate({ peerUserId, typing: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerUserId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, peerUserId, peerIsTyping]);

  const lastMine = [...messages].reverse().find((message) => message.senderUserId === user?.id);

  const changeBody = (value: string) => {
    setBody(value);
    const now = Date.now();
    if (!value.trim()) {
      if (lastTypingPing.current) setTyping.mutate({ peerUserId, typing: false });
      lastTypingPing.current = 0;
    } else if (now - lastTypingPing.current > 2_500) {
      lastTypingPing.current = now;
      setTyping.mutate({ peerUserId, typing: true });
    }
  };

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
        {conversation.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-slate-200" /> : messages.length === 0 && !peerIsTyping ? (
          <p className="py-12 text-center text-sm text-slate-500">No messages yet. Start with a brief operational update.</p>
        ) : messages.map((message) => {
          const mine = message.senderUserId === user?.id;
          return (
            <div key={message.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm", mine ? "rounded-br-md bg-blue-700 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-800")}>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere] leading-5">{message.body}</p>
                <p className={cn("mt-1 text-right text-[10px]", mine ? "text-blue-100" : "text-slate-400")}>{messageTime(message.createdAt)}</p>
              </div>
              {message === lastMine && <ReadReceipt readAt={message.readAt} />}
            </div>
          );
        })}
        {peerIsTyping && <TypingBubble name={name} />}
        <div ref={messageEndRef} />
      </div>
      <form onSubmit={submit} className="flex shrink-0 items-end gap-2 border-t border-slate-200 p-3">
        <Textarea value={body} onChange={(event) => changeBody(event.target.value)} maxLength={1200} rows={2} className="min-h-11 resize-none" aria-label="Message" placeholder={`Message ${name}…`} />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0 bg-blue-700 hover:bg-blue-800" disabled={!body.trim() || send.isPending} aria-label="Send message"><Send className="h-4 w-4" /></Button>
      </form>
    </section>
  );
}

function ReadReceipt({ readAt }: { readAt: Date | string | null }) {
  if (readAt) {
    return (
      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <CheckCheck className="h-3.5 w-3.5" />
        Read {messageTime(readAt)}
      </span>
    );
  }
  return (
    <span className="mt-1 inline-flex items-center gap-1 px-2 text-[11px] font-medium text-slate-400">
      <Check className="h-3.5 w-3.5" />
      Sent
    </span>
  );
}

function TypingBubble({ name }: { name: string }) {
  return (
    <div className="flex justify-start" role="status" aria-label={`${name} is typing`}>
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </div>
    </div>
  );
}
