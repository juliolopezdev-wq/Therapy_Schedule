import { useEffect, useMemo, useRef, useState } from "react";
import { usePermissions } from "@/_core/hooks/usePermissions";
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
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AskSchedulerPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referenceDate: Date;
}

interface ChatEntry {
  question: string;
  answer: string;
  usedFallback: boolean;
  actionsTaken: string[];
}

const MAX_QUESTION_LENGTH = 2_000;

const SUGGESTED_PROMPTS = [
  {
    title: "Shift briefing",
    description: "Risks, gaps, status updates, and priorities",
    prompt: "Give me a concise shift-start briefing. Lead with anything that needs action today.",
    icon: ClipboardList,
  },
  {
    title: "Patients at risk",
    description: "Weekly targets and specific shortfalls",
    prompt: "Which patients are at risk of missing their weekly targets, why, and what specific openings could help?",
    icon: AlertTriangle,
  },
  {
    title: "Coverage review",
    description: "Team capacity and overloaded staff",
    prompt: "Review coverage for this board date. Which teams are thin, and who has capacity to help?",
    icon: Users,
  },
  {
    title: "Status cleanup",
    description: "Sessions that still need documentation",
    prompt: "Which past sessions still need a completed or missed status, and what should staff review first?",
    icon: Clock3,
  },
];

function CopyAnswerButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      aria-label="Copy PAMi response"
      title="Copy response"
      onClick={copy}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

export function AskSchedulerPanel({ open, onOpenChange, referenceDate }: AskSchedulerPanelProps) {
  const { canEdit } = usePermissions();
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastFailedQuestion, setLastFailedQuestion] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestIdRef = useRef(0);
  const ask = trpc.ai.ask.useMutation({
    onSuccess: (result) => {
      if ((result.actionsTaken ?? []).length === 0) return;
      void utils.sessions.list.invalidate();
      void utils.sessions.listForDateRange.invalidate();
      void utils.weeklyMinutes.summary.invalidate();
      void utils.gapFill.suggestions.invalidate();
      void utils.digest.today.invalidate();
    },
  });

  const dateLabel = useMemo(
    () => referenceDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
    [referenceDate],
  );
  const actionCount = history.reduce((total, entry) => total + entry.actionsTaken.length, 0);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history.length, pendingQuestion, errorMessage]);

  useEffect(() => {
    if (open && pendingQuestion === null) {
      const timeout = window.setTimeout(() => textareaRef.current?.focus(), 150);
      return () => window.clearTimeout(timeout);
    }
  }, [open, pendingQuestion]);

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!canEdit || !trimmed || pendingQuestion !== null || trimmed.length > MAX_QUESTION_LENGTH) return;

    setQuestion("");
    setErrorMessage(null);
    setLastFailedQuestion(null);
    setPendingQuestion(trimmed);
    const chatHistory = history.slice(-6).flatMap((entry) => [
      { role: "user" as const, content: entry.question },
      { role: "assistant" as const, content: entry.answer },
    ]);
    const requestId = ++requestIdRef.current;

    ask.mutate(
      { question: trimmed, referenceDate, history: chatHistory },
      {
        onSuccess: (result) => {
          if (requestId !== requestIdRef.current) return;
          setPendingQuestion(null);
          setHistory((current) => [
            ...current,
            {
              question: trimmed,
              answer: result.answer,
              usedFallback: result.usedFallback,
              actionsTaken: result.actionsTaken ?? [],
            },
          ]);
        },
        onError: (error) => {
          if (requestId !== requestIdRef.current) return;
          setPendingQuestion(null);
          setErrorMessage(error.message || "PAMi couldn't complete that request.");
          setLastFailedQuestion(trimmed);
        },
      },
    );
  };

  const clearConversation = () => {
    setHistory([]);
    setQuestion("");
    setErrorMessage(null);
    setLastFailedQuestion(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-slate-50 p-0 sm:max-w-xl lg:max-w-2xl [&>[data-slot=sheet-close]]:flex [&>[data-slot=sheet-close]]:h-10 [&>[data-slot=sheet-close]]:w-10 [&>[data-slot=sheet-close]]:items-center [&>[data-slot=sheet-close]]:justify-center [&>[data-slot=sheet-close]]:rounded-xl [&>[data-slot=sheet-close]]:border [&>[data-slot=sheet-close]]:border-white/30 [&>[data-slot=sheet-close]]:bg-white/15 [&>[data-slot=sheet-close]]:text-white [&>[data-slot=sheet-close]]:opacity-100 [&>[data-slot=sheet-close]]:shadow-sm [&>[data-slot=sheet-close]]:hover:bg-white/25 [&>[data-slot=sheet-close]]:focus:ring-white [&>[data-slot=sheet-close]>svg]:size-5">
        <SheetHeader className="border-b border-blue-700 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 p-5 pr-16 text-white">
          <div className="flex items-start gap-3 text-left">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
              <Bot className="h-6 w-6 text-blue-100" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="text-xl font-bold text-white">Ask PAMi</SheetTitle>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                  <span className="h-2 w-2 rounded-full bg-emerald-300" /> Live board
                </span>
              </div>
              <SheetDescription className="mt-1 text-sm text-blue-100">
                Scheduling guidance and controlled board changes for {dateLabel}.
              </SheetDescription>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-blue-100">
            <span className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">
              {history.length} response{history.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">
              {actionCount} board change{actionCount === 1 ? "" : "s"}
            </span>
            {history.length > 0 && pendingQuestion === null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-10 text-blue-100 hover:bg-white/10 hover:text-white"
                onClick={clearConversation}
              >
                <Trash2 className="mr-2 h-4 w-4" /> New conversation
              </Button>
            )}
          </div>
        </SheetHeader>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50 p-4 sm:p-5">
          {history.length === 0 && pendingQuestion === null && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-blue-100 p-2 text-blue-700"><Sparkles className="h-5 w-5" /></div>
                  <div>
                    <h2 className="text-sm font-bold text-blue-950">Start with a board review</h2>
                    <p className="mt-1 text-sm leading-relaxed text-blue-900/80">
                      PAMi reads the selected board date and can explain risks or recommend exact slots. It only changes the schedule when you explicitly ask it to.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-500">Helpful starting points</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SUGGESTED_PROMPTS.map(({ title, description, prompt, icon: Icon }) => (
                    <button
                      key={title}
                      type="button"
                      onClick={() => submit(prompt)}
                      disabled={!canEdit}
                      className="group flex min-h-[92px] w-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="rounded-lg bg-slate-100 p-2 text-slate-600 transition-colors group-hover:bg-blue-100 group-hover:text-blue-700">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">{title}</div>
                        <div className="mt-1 text-xs leading-relaxed text-slate-600">{description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {history.map((entry, index) => (
            <div key={`${index}-${entry.question}`} className="space-y-3">
              <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-blue-700 px-4 py-3 text-sm leading-relaxed text-white shadow-sm">
                {entry.question}
              </div>

              <div className="flex items-start gap-2.5">
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                  <Bot className="h-4 w-4" />
                </div>
                <div className={cn(
                  "min-w-0 flex-1 rounded-2xl rounded-tl-md border bg-white px-4 py-3 text-sm leading-relaxed text-slate-700 shadow-sm",
                  entry.usedFallback ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200",
                )}>
                  {entry.usedFallback && (
                    <div className="mb-3 flex items-center gap-2 border-b border-amber-200 pb-2 text-xs font-bold text-amber-900">
                      <AlertTriangle className="h-4 w-4" />
                      {entry.actionsTaken.length > 0
                        ? "PAMi service interrupted — verify the completed changes below"
                        : "PAMi service unavailable — no changes were made"}
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 [&>p]:mb-2 [&>p:last-child]:mb-0 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-bold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.answer}</ReactMarkdown>
                    </div>
                    <CopyAnswerButton text={entry.answer} />
                  </div>
                </div>
              </div>

              {entry.actionsTaken.length > 0 && (
                <div className="ml-10 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-900">
                    <CheckCircle2 className="h-4 w-4" /> Changes completed
                  </p>
                  <ul className="space-y-1.5">
                    {entry.actionsTaken.map((action, actionIndex) => (
                      <li key={actionIndex} className="flex items-start gap-2 text-sm text-emerald-900">
                        <Check className="mt-0.5 h-4 w-4 shrink-0" /> {action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}

          {pendingQuestion !== null && (
            <div className="space-y-3">
              <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-blue-700 px-4 py-3 text-sm text-white shadow-sm">
                {pendingQuestion}
              </div>
              <div className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><Bot className="h-4 w-4" /></div>
                <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <RefreshCw className="h-4 w-4 animate-spin text-blue-600" /> Reviewing the live schedule…
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Complex scheduling checks can take several seconds. Requested changes may complete even if this panel is closed.</p>
                </div>
              </div>
            </div>
          )}

          {errorMessage && (
            <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-950">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">PAMi couldn't complete that request</p>
                  <p className="mt-1 break-words text-xs text-rose-800">{errorMessage}</p>
                </div>
                {lastFailedQuestion && (
                  <Button variant="outline" size="sm" className="h-10 border-rose-300 bg-white" onClick={() => submit(lastFailedQuestion)}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Retry
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-white p-4 shadow-[0_-8px_24px_rgba(15,23,42,0.05)]">
          {!canEdit && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              Staff or admin access is required to ask PAMi questions.
            </div>
          )}
          <div className="rounded-xl border border-slate-300 bg-white p-2 shadow-sm transition-shadow focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
            <Textarea
              ref={textareaRef}
              value={question}
              maxLength={MAX_QUESTION_LENGTH}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit(question);
                }
              }}
              placeholder="Ask about risks, coverage, open slots, or request a specific schedule change…"
              disabled={!canEdit || pendingQuestion !== null}
              className="min-h-[64px] resize-none border-0 bg-transparent px-2 py-2 text-sm leading-relaxed text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-2 pt-2">
              <div className="text-xs text-slate-500">
                <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line · </span>
                {question.length}/{MAX_QUESTION_LENGTH}
              </div>
              <Button
                className="h-10 rounded-lg bg-blue-600 px-4 font-bold text-white hover:bg-blue-700"
                onClick={() => submit(question)}
                disabled={!canEdit || pendingQuestion !== null || !question.trim()}
              >
                <Send className="mr-2 h-4 w-4" /> Ask PAMi
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
