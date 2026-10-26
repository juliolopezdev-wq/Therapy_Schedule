import { useEffect, useMemo, useRef, useState } from "react";
import { usePermissions } from "@/_core/hooks/usePermissions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { addDays, startOfDay, startOfWeek, subDays, weekRangeLabel } from "@/lib/board";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface DataAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: { id: number; name: string; roomNumber: string; isDischarged: boolean }[];
  onEditPatient: (patientId: number) => void;
  referenceDate: Date;
}

interface AnalysisMessage {
  role: "user" | "assistant";
  content: string;
  usedFallback?: boolean;
}

const MAX_QUESTION_LENGTH = 2_000;
const ANALYSIS_PROMPTS = [
  "Summarize the most important patterns in this table.",
  "Who has the highest and lowest delivered minutes, and what should I review?",
  "Are there unusual session-count or minutes-per-session patterns?",
];

export function DataAnalysisModal({
  open,
  onOpenChange,
  patients,
  onEditPatient,
  referenceDate,
}: DataAnalysisModalProps) {
  const { canEdit } = usePermissions();
  const [rangeType, setRangeType] = useState<"day" | "week">("week");
  const [currentDate, setCurrentDate] = useState(() => startOfDay(referenceDate));
  const [populationFilter, setPopulationFilter] = useState<"all" | "active" | "discharged">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<AnalysisMessage[]>([]);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const analysisRequestRef = useRef(0);

  useEffect(() => {
    if (open) setCurrentDate(startOfDay(referenceDate));
  }, [open, referenceDate]);

  const { startDate, endDate, dateLabel } = useMemo(() => {
    if (rangeType === "day") {
      const start = startOfDay(currentDate);
      return {
        startDate: start,
        endDate: new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1),
        dateLabel: start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
      };
    }
    const start = startOfWeek(currentDate);
    return {
      startDate: start,
      endDate: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1),
      dateLabel: weekRangeLabel(start),
    };
  }, [rangeType, currentDate]);

  const sessionsQuery = trpc.sessions.listForDateRange.useQuery(
    { startDate, endDate },
    { enabled: open },
  );
  const sessions = sessionsQuery.data ?? [];

  const tableData = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return patients
      .filter((patient) => {
        if (populationFilter === "active" && patient.isDischarged) return false;
        if (populationFilter === "discharged" && !patient.isDischarged) return false;
        return !normalizedSearch || patient.name.toLowerCase().includes(normalizedSearch) || patient.roomNumber.toLowerCase().includes(normalizedSearch);
      })
      .map((patient) => {
        const completedSessions = sessions.filter(
          (session) => session.patientId === patient.id && session.therapyType !== "Block" && session.status === "completed",
        );
        const totalMinutes = completedSessions.reduce(
          (total, session) => total + (session.actualDurationMinutes ?? session.durationMinutes),
          0,
        );
        return {
          ...patient,
          totalMinutes,
          sessionCount: completedSessions.length,
          averageMinutes: completedSessions.length ? Math.round(totalMinutes / completedSessions.length) : 0,
        };
      })
      .sort((a, b) => b.totalMinutes - a.totalMinutes || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  }, [patients, sessions, populationFilter, searchQuery]);

  const totalMinutes = tableData.reduce((total, patient) => total + patient.totalMinutes, 0);
  const totalSessions = tableData.reduce((total, patient) => total + patient.sessionCount, 0);
  const patientsWithMinutes = tableData.filter((patient) => patient.totalMinutes > 0).length;
  const averagePerPatient = patientsWithMinutes ? Math.round(totalMinutes / patientsWithMinutes) : 0;

  const scopeKey = `${startDate.toISOString()}|${endDate.toISOString()}|${populationFilter}|${searchQuery.trim().toLowerCase()}`;
  useEffect(() => {
    analysisRequestRef.current += 1;
    setChatHistory([]);
    setAnalysisError(null);
  }, [scopeKey]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chatHistory.length, analysisError]);

  const ask = trpc.ai.analyzeData.useMutation();

  const askPami = (value: string) => {
    const trimmed = value.trim();
    if (!canEdit || !trimmed || ask.isPending || trimmed.length > MAX_QUESTION_LENGTH) return;

    const requestId = ++analysisRequestRef.current;
    const priorHistory = chatHistory.slice(-12).map(({ role, content }) => ({ role, content }));
    const contextData = JSON.stringify({
      timeframe: { start: startDate.toISOString(), end: endDate.toISOString(), label: dateLabel },
      population: populationFilter,
      search: searchQuery.trim() || undefined,
      totals: { totalMinutes, totalSessions, patientsWithMinutes, averagePerPatient },
      patients: tableData.map((patient) => ({
        name: patient.name,
        room: patient.roomNumber,
        admissionStatus: patient.isDischarged ? "discharged" : "active",
        completedSessions: patient.sessionCount,
        deliveredMinutes: patient.totalMinutes,
        averageMinutesPerSession: patient.averageMinutes,
      })),
    });

    setChatHistory((history) => [...history, { role: "user", content: trimmed }]);
    setQuestion("");
    setAnalysisError(null);
    ask.mutate(
      { question: trimmed, contextData, referenceDate: currentDate, history: priorHistory },
      {
        onSuccess: (result) => {
          if (requestId !== analysisRequestRef.current) return;
          setChatHistory((history) => [...history, { role: "assistant", content: result.answer, usedFallback: result.usedFallback }]);
        },
        onError: (error) => {
          if (requestId !== analysisRequestRef.current) return;
          setAnalysisError(error.message || "PAMi couldn't analyze this table.");
        },
      },
    );
  };

  const exportCsv = () => {
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = [
      ["Room", "Patient", "Status", "Completed sessions", "Delivered minutes", "Average minutes per session"],
      ...tableData.map((patient) => [
        patient.roomNumber,
        patient.name,
        patient.isDischarged ? "Discharged" : "Active",
        patient.sessionCount,
        patient.totalMinutes,
        patient.averageMinutes,
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `therapy-analysis-${startDate.toISOString().slice(0, 10)}-${endDate.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const shiftRange = (direction: -1 | 1) => {
    const days = rangeType === "day" ? direction : direction * 7;
    setCurrentDate((date) => direction < 0 ? subDays(date, Math.abs(days)) : addDays(date, days));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl xl:max-w-6xl">
        <DialogHeader className="shrink-0 border-b border-blue-700 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-5 py-4 pr-16 text-left text-white sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
              <BarChart3 className="h-6 w-6 text-blue-100" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold text-white">Data Analysis</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-blue-100">
                Completed therapy sessions and delivered minutes for {dateLabel}.
              </DialogDescription>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2" aria-label="Analysis summary">
            {[
              { label: "Patients", value: tableData.length },
              { label: "Sessions", value: totalSessions },
              { label: "Minutes", value: totalMinutes },
              { label: "Avg/treated", value: averagePerPatient },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">
                <div className="text-lg font-bold tabular-nums text-white">{stat.value.toLocaleString()}</div>
                <div className="truncate text-xs font-semibold text-blue-100">{stat.label}</div>
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="shrink-0 border-b border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2">
              <div className="flex rounded-xl bg-slate-100 p-1">
                {(["day", "week"] as const).map((type) => (
                  <button key={type} type="button" onClick={() => setRangeType(type)} className={cn("min-h-10 rounded-lg px-4 text-xs font-bold capitalize", rangeType === type ? "bg-white text-blue-700 shadow-sm" : "text-slate-600")}>
                    {type}
                  </button>
                ))}
              </div>

              <div className="flex items-center rounded-xl border border-slate-300 bg-white p-1 shadow-sm">
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-lg" onClick={() => shiftRange(-1)} aria-label="Previous date range"><ChevronLeft className="h-5 w-5" /></Button>
                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" className="h-10 min-w-[150px] rounded-lg px-3 text-sm font-bold text-slate-800">
                      <CalendarIcon className="mr-2 h-4 w-4 text-blue-600" /> {dateLabel}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto border-slate-200 bg-white p-0 shadow-xl" align="center">
                    <Calendar mode="single" selected={currentDate} onSelect={(date) => { if (date) { setCurrentDate(date); setIsCalendarOpen(false); } }} initialFocus />
                  </PopoverContent>
                </Popover>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-lg" onClick={() => shiftRange(1)} aria-label="Next date range"><ChevronRight className="h-5 w-5" /></Button>
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
              <div className="relative min-w-0 flex-1 lg:max-w-xs">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search patient or room..." className="h-10 rounded-xl border-slate-300 pl-10 pr-10 text-sm" />
                {searchQuery && <button type="button" aria-label="Clear search" onClick={() => setSearchQuery("")} className="absolute right-1 top-0 flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
              </div>
              <Select value={populationFilter} onValueChange={(value: "all" | "active" | "discharged") => setPopulationFilter(value)}>
                <SelectTrigger className="h-10 w-full rounded-xl border-slate-300 text-sm font-semibold sm:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All patients</SelectItem>
                  <SelectItem value="active">Active admissions</SelectItem>
                  <SelectItem value="discharged">Discharged history</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" className="h-10 rounded-xl border-slate-300" onClick={exportCsv} disabled={tableData.length === 0}>
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)] lg:overflow-hidden">
          <section className="flex min-h-[380px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="analysis-table-heading">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <h2 id="analysis-table-heading" className="text-sm font-bold text-slate-900">Completed therapy by patient</h2>
                <p className="mt-0.5 text-xs text-slate-500">Only sessions marked completed contribute delivered minutes.</p>
              </div>
              <span className="text-xs font-semibold text-slate-500">{tableData.length} records</span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {sessionsQuery.isLoading ? (
                <div className="space-y-2 p-4">{Array.from({ length: 7 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}</div>
              ) : sessionsQuery.error ? (
                <div role="alert" className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-950">
                  <AlertTriangle className="mx-auto h-8 w-8" /><h3 className="mt-2 font-bold">Couldn't load session data</h3><p className="mt-1 text-xs">{sessionsQuery.error.message}</p>
                  <Button variant="outline" className="mt-4 h-10 border-rose-300 bg-white" onClick={() => void sessionsQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" /> Retry</Button>
                </div>
              ) : tableData.length === 0 ? (
                <div className="m-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center"><BarChart3 className="h-9 w-9 text-slate-300" /><h3 className="mt-3 font-bold text-slate-800">No matching records</h3><p className="mt-1 text-sm text-slate-500">Try another date range or clear the patient filters.</p></div>
              ) : (
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-600">
                    <tr><th className="px-4 py-3">Room</th><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Sessions</th><th className="px-4 py-3 text-right">Delivered</th><th className="px-4 py-3 text-right">Avg/session</th><th className="w-16 px-4 py-3"><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tableData.map((patient) => (
                      <tr key={patient.id} className="hover:bg-blue-50/60">
                        <td className="px-4 py-3"><span className="inline-flex min-w-12 justify-center rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 font-bold tabular-nums text-blue-900">{patient.roomNumber}</span></td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{patient.name}</td>
                        <td className="px-4 py-3"><Badge variant="outline" className={patient.isDischarged ? "border-sky-200 bg-sky-50 text-xs text-sky-800" : "border-emerald-200 bg-emerald-50 text-xs text-emerald-800"}>{patient.isDischarged ? "Discharged" : "Active"}</Badge></td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-700">{patient.sessionCount}</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-emerald-700">{patient.totalMinutes} min</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-600">{patient.averageMinutes} min</td>
                        <td className="px-4 py-3 text-right"><Button variant="ghost" size="icon" className="h-10 w-10 rounded-lg text-slate-500 hover:bg-blue-100 hover:text-blue-800" onClick={() => { onOpenChange(false); onEditPatient(patient.id); }} aria-label={`Edit ${patient.name}`}><Edit className="h-4 w-4" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <aside className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="analysis-assistant-heading">
            <div className="border-b border-slate-200 bg-blue-50 p-4">
              <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><Bot className="h-5 w-5" /></div><div><h2 id="analysis-assistant-heading" className="text-sm font-bold text-blue-950">Ask PAMi about this table</h2><p className="mt-0.5 text-xs text-blue-800">Read-only analysis · {tableData.length} visible patients</p></div></div>
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-white/70 px-3 py-2 text-xs text-blue-900"><ShieldCheck className="h-4 w-4 shrink-0" /> This assistant analyzes the current table and cannot change the schedule.</div>
            </div>

            <div ref={chatScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3">
              {chatHistory.length === 0 && !ask.isPending && (
                <div className="space-y-2">
                  <p className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">Suggested questions</p>
                  {ANALYSIS_PROMPTS.map((prompt) => <button key={prompt} type="button" onClick={() => askPami(prompt)} disabled={!canEdit} className="flex min-h-12 w-full items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs font-semibold leading-relaxed text-slate-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />{prompt}</button>)}
                </div>
              )}
              {chatHistory.map((message, index) => (
                <div key={`${index}-${message.content.slice(0, 20)}`} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[92%] rounded-xl px-3 py-2.5 text-sm leading-relaxed shadow-sm", message.role === "user" ? "rounded-br-sm bg-blue-700 text-white" : message.usedFallback ? "rounded-bl-sm border border-amber-200 bg-amber-50 text-amber-950" : "rounded-bl-sm border border-slate-200 bg-white text-slate-700")}>
                    {message.role === "assistant" ? <div className="[&>p]:mb-2 [&>p:last-child]:mb-0 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div> : message.content}
                  </div>
                </div>
              ))}
              {ask.isPending && <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-600"><RefreshCw className="h-4 w-4 animate-spin text-blue-600" /> Analyzing the current table…</div>}
              {analysisError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950"><div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> Analysis failed</div><p className="mt-1 break-words text-xs">{analysisError}</p></div>}
            </div>

            <div className="border-t border-slate-200 bg-white p-3">
              {!canEdit && <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">Staff or admin access is required to ask PAMi.</div>}
              <Textarea value={question} maxLength={MAX_QUESTION_LENGTH} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); askPami(question); } }} disabled={!canEdit || ask.isPending} placeholder="Ask about trends, outliers, or comparisons…" className="min-h-[72px] resize-none rounded-xl border-slate-300 text-sm" />
              <div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-slate-500">{question.length}/{MAX_QUESTION_LENGTH}</span><Button className="h-10 bg-blue-600 font-bold text-white hover:bg-blue-700" disabled={!canEdit || !question.trim() || ask.isPending} onClick={() => askPami(question)}><Send className="mr-2 h-4 w-4" /> Analyze</Button></div>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
