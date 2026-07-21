import { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Bot, Send, Sparkles, CheckCircle2, Copy, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AskSchedulerPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ChatEntry {
  question: string;
  answer: string;
  usedFallback: boolean;
  actionsTaken: string[];
}

const SUGGESTED_PROMPTS = [
  "Give me a full shift-start briefing.",
  "Any refusal patterns or group therapy opportunities I should know about?",
  "Which patients are at risk of missing target this week, and why?",
  "Undo that.",
];

function CopyAnswerButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy answer"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function AskSchedulerPanel({ open, onOpenChange }: AskSchedulerPanelProps) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<ChatEntry[]>([]);
  // Echoed the instant a question is sent, before the response lands -- otherwise the user has
  // zero confirmation of what they asked while waiting (this can now take 10-20+ seconds).
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Bumped on every submit and on cancel, so a response that lands after the user gave up
  // waiting on it doesn't silently append to history out of nowhere.
  const requestIdRef = useRef(0);

  // Bare hook: all business logic lives in per-call options below (not the hook-level
  // onSuccess/onError), so a cancelled/superseded request's eventual response can be told apart
  // from the current one and discarded instead of unconditionally appending to history.
  const ask = trpc.ai.ask.useMutation();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history.length, pendingQuestion]);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || pendingQuestion !== null) return;
    setQuestion("");
    setPendingQuestion(trimmed);
    const chatHistory = history.flatMap((h) => [
      { role: "user" as const, content: h.question },
      { role: "assistant" as const, content: h.answer },
    ]);
    const myRequestId = ++requestIdRef.current;
    ask.mutate(
      { question: trimmed, history: chatHistory },
      {
        onSuccess: (result) => {
          if (myRequestId !== requestIdRef.current) return; // cancelled or superseded -- discard
          setPendingQuestion(null);
          setHistory((h) => [
            ...h,
            {
              question: trimmed,
              answer: result.answer,
              usedFallback: result.usedFallback,
              actionsTaken: result.actionsTaken ?? [],
            },
          ]);
          if ((result.actionsTaken ?? []).length > 0) {
            // The AI created/moved/cancelled/auto-scheduled real sessions -- refresh the board.
            utils.sessions.list.invalidate();
            utils.sessions.listForWeek.invalidate();
            utils.weeklyMinutes.summary.invalidate();
            utils.gapFill.suggestions.invalidate();
          }
        },
        onError: (error) => {
          if (myRequestId !== requestIdRef.current) return;
          setPendingQuestion(null);
          toast.error("PAMi couldn't respond", { description: error.message });
        },
      },
    );
  };

  const cancelPending = () => {
    // The in-flight server request keeps running (there's no cheap way to abort an
    // already-dispatched Ollama tool-calling loop) -- this bumps requestIdRef so that request's
    // eventual response gets discarded above, and immediately frees the UI to send another.
    requestIdRef.current += 1;
    setPendingQuestion(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md glass-panel border-r-0 rounded-l-2xl">
        <SheetHeader className="glass-header p-5">
          <SheetTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-sm">
              <Bot className="h-4 w-4" />
            </div>
            PAMi
          </SheetTitle>
          <SheetDescription>
            Ask about gaps, coverage, or compliance — or tell it to book, move, or cancel a session and it'll do it for real.
          </SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-transparent p-4 pb-8">
          {history.length === 0 && (
            <div className="space-y-2">
              <p className="pl-1 text-xs font-bold uppercase tracking-wider text-slate-400">
                Suggested questions
              </p>
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => submit(p)}
                  className="group flex w-full items-start gap-3 rounded-xl border border-white/40 glass-surface p-3 text-left text-sm text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                >
                  <div className="mt-0.5 rounded-full bg-blue-50 p-1 text-blue-500 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <span className="leading-snug pt-0.5">{p}</span>
                </button>
              ))}
            </div>
          )}

          {history.map((entry, i) => (
            <div key={i} className="space-y-2">
              {/* User Bubble */}
              <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-white shadow-md">
                {entry.question}
              </div>
              
              {/* AI Bubble */}
              <div
                className={cn(
                  "group relative w-fit max-w-[95%] rounded-2xl rounded-tl-sm border px-4 py-3 text-sm shadow-sm",
                  entry.usedFallback
                    ? "border-amber-300/60 bg-amber-50/80 text-amber-900"
                    : "border-white/40 glass-surface text-slate-700",
                  "[&>p]:mb-2 [&>p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ul:last-child]:mb-0 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol:last-child]:mb-0 [&_strong]:font-semibold"
                )}
              >
                <div className="absolute right-1.5 top-1.5">
                  <CopyAnswerButton text={entry.answer} />
                </div>
                <div className="pr-4">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.answer}</ReactMarkdown>
                </div>
              </div>
              {entry.actionsTaken.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {entry.actionsTaken.map((a, j) => (
                    <span
                      key={j}
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/60 bg-emerald-50 px-3 py-1 text-micro font-bold uppercase tracking-wider text-emerald-700 shadow-sm"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {a}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {pendingQuestion !== null && (
            <div className="space-y-2">
              {/* Echo the question immediately -- otherwise there's no confirmation of what was
                  asked while waiting, which can now take 10-20+ seconds. */}
              <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-white shadow-md">
                {pendingQuestion}
              </div>
              <div className="flex items-center gap-2 pl-2 pt-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-sm">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-white border border-slate-100 px-3 py-2 shadow-sm">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]"></span>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]"></span>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"></span>
                </div>
                <button
                  type="button"
                  onClick={cancelPending}
                  className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-400 shadow-sm transition-colors hover:border-red-200 hover:text-red-500"
                >
                  <X className="h-3 w-3" /> Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="glass-header border-t-white/40 p-4 z-10 border-t shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)]">
          <div className="flex items-end gap-2 rounded-xl glass-surface border border-white/40 p-2 focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring transition-all shadow-sm">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(question);
                }
              }}
              placeholder="Ask PAMi anything..."
              className="min-h-[44px] flex-1 resize-none border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 px-2 py-3 shadow-none"
            />
            <Button
              size="icon"
              className={cn(
                "mb-1 mr-1 h-9 w-9 shrink-0 rounded-lg shadow-sm transition-all",
                question.trim() ? "bg-primary hover:bg-primary/90 text-primary-foreground" : "bg-slate-200 text-slate-400 hover:bg-slate-300"
              )}
              onClick={() => submit(question)}
              disabled={pendingQuestion !== null || !question.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
