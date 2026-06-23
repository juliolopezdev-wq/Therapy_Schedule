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
import { Bot, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface AskSchedulerPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ChatEntry {
  question: string;
  answer: string;
  usedFallback: boolean;
}

const SUGGESTED_PROMPTS = [
  "Which patients are at risk of missing their 900-minute target this week?",
  "Who has open slots to help Room 214 catch up?",
  "Summarize this week's staffing gaps by team.",
];

export function AskSchedulerPanel({ open, onOpenChange }: AskSchedulerPanelProps) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<ChatEntry[]>([]);

  const ask = trpc.ai.ask.useMutation({
    onSuccess: (result, variables) => {
      setHistory((h) => [
        ...h,
        { question: variables.question, answer: result.answer, usedFallback: result.usedFallback },
      ]);
      setQuestion("");
    },
  });

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || ask.isPending) return;
    ask.mutate({ question: trimmed });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-slate-200 p-5">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-slate-500" /> Ask the Scheduler
          </SheetTitle>
          <SheetDescription>
            Runs entirely on a free, local model via Ollama — no cloud API, no
            cost. Start <code className="rounded bg-slate-100 px-1">ollama serve</code> on
            this machine first.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {history.length === 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Try asking
              </p>
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => submit(p)}
                  className="flex w-full items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50"
                >
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  {p}
                </button>
              ))}
            </div>
          )}

          {history.map((entry, i) => (
            <div key={i} className="space-y-1.5">
              <div className="ml-auto max-w-[85%] rounded-lg bg-slate-800 px-3 py-2 text-xs text-white">
                {entry.question}
              </div>
              <div
                className={cn(
                  "max-w-[90%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-xs",
                  entry.usedFallback
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                )}
              >
                {entry.answer}
              </div>
            </div>
          ))}

          {ask.isPending && (
            <p className="text-xs text-slate-400">Thinking…</p>
          )}
        </div>

        <div className="flex items-end gap-2 border-t border-slate-200 p-3">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(question);
              }
            }}
            placeholder="Ask about gaps, staffing, or who's available…"
            className="min-h-[40px] flex-1 resize-none text-sm"
          />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => submit(question)} disabled={ask.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
