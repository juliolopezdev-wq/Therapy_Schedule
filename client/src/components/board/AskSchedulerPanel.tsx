import { useState } from "react";
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
import { Bot, Send, Sparkles, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
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
  "Which patients are at risk of missing target this week, and why?",
  "Who can see Room 214 if their usual therapist is out?",
  "Find an open slot for Room 214 and book it.",
];

export function AskSchedulerPanel({ open, onOpenChange }: AskSchedulerPanelProps) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const utils = trpc.useUtils();

  const ask = trpc.ai.ask.useMutation({
    onSuccess: (result, variables) => {
      setHistory((h) => [
        ...h,
        {
          question: variables.question,
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
  });

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || ask.isPending) return;
    setQuestion("");
    ask.mutate({ question: trimmed });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="bg-white/80 p-5 backdrop-blur-md border-b border-slate-100 shadow-sm z-10">
          <SheetTitle className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md">
              <Bot className="h-4 w-4" />
            </div>
            Scheduler Copilot
          </SheetTitle>
          <SheetDescription className="text-slate-500">
            Ask about gaps, coverage, or compliance — or tell it to book, move, or cancel a session and it'll do it for real.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/50 p-4 pb-8">
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
                  className="group flex w-full items-start gap-3 rounded-xl border border-indigo-100/50 bg-white p-3 text-left text-[13px] text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
                >
                  <div className="mt-0.5 rounded-full bg-indigo-50 p-1 text-indigo-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
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
              <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 text-[13px] text-white shadow-md">
                {entry.question}
              </div>
              
              {/* AI Bubble */}
              <div
                className={cn(
                  "w-fit max-w-[95%] rounded-2xl rounded-tl-sm border px-4 py-3 text-[13px] shadow-sm",
                  entry.usedFallback
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-slate-100 bg-white text-slate-700",
                  "[&>p]:mb-2 [&>p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ul:last-child]:mb-0 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol:last-child]:mb-0 [&_strong]:font-semibold"
                )}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.answer}</ReactMarkdown>
              </div>
              {entry.actionsTaken.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {entry.actionsTaken.map((a, j) => (
                    <span
                      key={j}
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/60 bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 shadow-sm"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {a}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {ask.isPending && (
            <div className="flex items-center gap-2 pl-2 pt-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
                <Bot className="h-3.5 w-3.5" />
              </div>
              <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-white border border-slate-100 px-3 py-2 shadow-sm">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]"></span>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]"></span>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"></span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white p-4 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)] z-10 border-t border-slate-100">
          <div className="flex items-end gap-2 rounded-xl bg-slate-50 border border-slate-200 p-2 focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-300 transition-all shadow-sm">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(question);
                }
              }}
              placeholder="Ask Copilot anything..."
              className="min-h-[44px] flex-1 resize-none border-0 bg-transparent text-[13px] focus-visible:ring-0 focus-visible:ring-offset-0 px-2 py-3 shadow-none"
            />
            <Button
              size="icon"
              className={cn(
                "mb-1 mr-1 h-9 w-9 shrink-0 rounded-lg shadow-sm transition-all",
                question.trim() ? "bg-emerald-500 hover:bg-emerald-600 text-white" : "bg-slate-200 text-slate-400 hover:bg-slate-300"
              )}
              onClick={() => submit(question)}
              disabled={ask.isPending || !question.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
