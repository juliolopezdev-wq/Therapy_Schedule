import { useState, useMemo, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, BarChart3, Edit, Calendar as CalendarIcon, Bot, Send } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { startOfDay, addDays, startOfWeek, subDays, weekRangeLabel } from "@/lib/board";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface DataAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: { id: number; name: string; roomNumber: string; isDischarged: boolean }[];
  onEditPatient: (patientId: number) => void;
}

export function DataAnalysisModal({ open, onOpenChange, patients, onEditPatient }: DataAnalysisModalProps) {
  const [rangeType, setRangeType] = useState<"day" | "week">("week");
  const [currentDate, setCurrentDate] = useState<Date>(startOfDay(new Date()));
  const [selectedPatientId, setSelectedPatientId] = useState<string>("all");
  const [searchName, setSearchName] = useState("");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // AI Chat State
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const { startDate, endDate, dateLabel } = useMemo(() => {
    if (rangeType === "day") {
      const start = startOfDay(currentDate);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
      return { 
        startDate: start, 
        endDate: end, 
        dateLabel: start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) 
      };
    } else {
      const start = startOfWeek(currentDate);
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
      return { 
        startDate: start, 
        endDate: end, 
        dateLabel: weekRangeLabel(start) 
      };
    }
  }, [rangeType, currentDate]);

  const prevRange = () => setCurrentDate(subDays(currentDate, rangeType === "day" ? 1 : 7));
  const nextRange = () => setCurrentDate(addDays(currentDate, rangeType === "day" ? 1 : 7));

  // Query sessions for the selected range
  const { data: sessions = [], isLoading } = trpc.sessions.listForDateRange.useQuery(
    { startDate, endDate },
    { enabled: open }
  );

  const dischargedPatientsData = useMemo(() => {
    let selectedPatients = patients;
    if (selectedPatientId === "all_discharged") {
      selectedPatients = selectedPatients.filter(p => p.isDischarged);
    }
    if (searchName.trim()) {
      const lowerSearch = searchName.toLowerCase();
      selectedPatients = selectedPatients.filter(p => p.name.toLowerCase().includes(lowerSearch));
    }
    return selectedPatients.map(p => {
      const pSessions = sessions.filter(s => s.patientId === p.id && s.therapyType !== "Block");
      const totalMinutes = pSessions.reduce((acc, curr) => acc + curr.durationMinutes, 0);
      return { ...p, totalMinutes, sessionCount: pSessions.length };
    }).sort((a, b) => b.totalMinutes - a.totalMinutes); // sort by highest minutes
  }, [patients, sessions, selectedPatientId, searchName]);

  // AI Integration
  const ask = trpc.ai.analyzeData.useMutation({
    onSuccess: (result) => {
      setChatHistory((h) => [...h, { role: "assistant", content: result.answer }]);
    },
    onError: (error) => {
      setChatHistory((h) => [...h, { role: "assistant", content: `Error: ${error.message}` }]);
    }
  });

  const handleAskAI = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!question.trim() || ask.isPending) return;
    
    setChatHistory((h) => [...h, { role: "user", content: question }]);
    
    // Prepare minimal context for the AI
    const contextData = JSON.stringify({
      timeframe: `${startDate.toISOString()} to ${endDate.toISOString()}`,
      filter: selectedPatientId === "all" ? "All Patients" : "All Discharged Patients",
      search: searchName.trim() || undefined,
      data: dischargedPatientsData.map(p => ({
        name: p.name,
        room: p.roomNumber,
        sessionsCount: p.sessionCount,
        totalMinutes: p.totalMinutes
      }))
    });

    ask.mutate({ question, contextData, history: chatHistory });
    setQuestion("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAskAI();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-4xl h-[90vh] sm:h-[85vh] flex flex-col p-0 glass-panel rounded-2xl overflow-hidden">
        <DialogHeader className="px-6 py-5 bg-gradient-to-r from-blue-50 via-white to-sky-50 border-b border-blue-100/50 shrink-0">
          <DialogTitle className="text-xl font-bold text-slate-800">
            Patient Session Analytics
          </DialogTitle>
          <DialogDescription className="text-slate-500 font-medium">
            Review and analyze completed therapy minutes for all patients.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-4 px-4 sm:px-6 overflow-y-auto flex-1">
          {/* Controls */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 bg-white/60 backdrop-blur-md rounded-2xl border border-white p-3 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)]">
            <div className="flex justify-between items-center w-full md:w-auto gap-2">
              <div className="flex glass-surface p-1 rounded-xl shadow-inner">
              <button 
                onClick={() => setRangeType("day")} 
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 ${rangeType === "day" ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-white/60"}`}
              >
                Day
              </button>
              <button 
                onClick={() => setRangeType("week")} 
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 ${rangeType === "week" ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-white/60"}`}
              >
                Week
              </button>
              </div>

              <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-200/80 shadow-sm px-1.5 py-1">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-sky-50 hover:text-sky-600 rounded-lg transition-colors" onClick={prevRange}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className="h-8 px-3 text-sm font-bold text-slate-700 min-w-[140px] justify-center hover:bg-sky-50 hover:text-sky-700 rounded-lg transition-colors">
                    <CalendarIcon className="mr-2 h-4 w-4 text-sky-400" />
                    {dateLabel}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 rounded-2xl shadow-xl border-slate-200" align="center">
                  <Calendar
                    mode="single"
                    selected={currentDate}
                    onSelect={(date) => {
                      if (date) {
                        setCurrentDate(date);
                        setIsCalendarOpen(false);
                      }
                    }}
                    initialFocus
                    className="rounded-2xl"
                  />
                </PopoverContent>
              </Popover>

              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-sky-50 hover:text-sky-600 rounded-lg transition-colors" onClick={nextRange}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row md:ml-auto items-stretch sm:items-center gap-3 w-full md:w-auto">
            <div className="relative w-full sm:w-56">
              <Input
                placeholder="Search patient..."
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                className="h-10 w-full pl-9 text-sm bg-white/80 border-slate-200/80 shadow-sm rounded-xl focus-visible:ring-sky-500 transition-all placeholder:text-slate-400"
              />
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
            <div className="w-full sm:w-56">
              <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                <SelectTrigger className="h-10 text-sm font-bold bg-white/80 border-slate-200/80 shadow-sm rounded-xl focus:ring-sky-500 transition-all text-slate-700">
                    <SelectValue placeholder="All Patients" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Patients</SelectItem>
                    <SelectItem value="all_discharged">All Discharged Patients</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Data Table Container */}
          <div className="flex flex-col flex-1 min-h-0 rounded-2xl border border-slate-200/80 bg-white/70 overflow-hidden shadow-sm">
            {/* Table Header */}
            <div className="grid grid-cols-[2fr_1fr_1fr_auto] sm:grid-cols-[3fr_1fr_1fr_auto] gap-4 px-4 py-2.5 text-[11px] font-extrabold text-slate-400 uppercase tracking-wider bg-slate-100/80 border-b border-slate-200/80 shrink-0">
              <div>Patient</div>
              <div className="text-right">Sessions</div>
              <div className="text-right">Total Min</div>
              <div className="w-8 sm:w-10"></div>
            </div>
            
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1.5">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center p-8 text-sm text-slate-400 bg-white/40 rounded-xl border border-dashed border-slate-200">
                    <div className="h-5 w-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                    Loading data...
                  </div>
                ) : dischargedPatientsData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-sm text-slate-400 bg-white/40 rounded-xl border border-dashed border-slate-200">
                    <BarChart3 className="h-7 w-7 text-slate-300 mb-1.5" />
                    No records found for selected filters.
                  </div>
                ) : (
                  dischargedPatientsData.map(p => (
                    <div 
                      key={p.id} 
                      className="group grid grid-cols-[2fr_1fr_1fr_auto] sm:grid-cols-[3fr_1fr_1fr_auto] gap-4 px-3.5 py-2.5 items-center bg-white border border-slate-200/70 shadow-2xs rounded-xl hover:shadow-sm hover:border-sky-300 hover:bg-sky-50/30 transition-all duration-200"
                    >
                      <div className="flex flex-col min-w-0 gap-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-slate-800 text-sm truncate tracking-tight">{p.name}</span>
                          {p.isDischarged && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-micro font-extrabold text-rose-600 uppercase shrink-0 border border-rose-100">DC</span>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="flex items-center justify-center h-3.5 w-3.5 rounded bg-slate-100 text-[8px] font-bold text-slate-500">RM</span>
                          <span className="text-micro font-semibold text-slate-500 truncate">{p.roomNumber}</span>
                        </div>
                      </div>
                      <div className="text-right font-extrabold text-slate-700 tabular-nums text-sm">
                        {p.sessionCount}
                      </div>
                      <div className="text-right flex justify-end">
                        <span className="inline-flex items-center justify-center min-w-[3.25rem] rounded-lg bg-emerald-50 px-2 py-0.5 text-xs font-extrabold text-emerald-700 border border-emerald-200/60">
                          {p.totalMinutes}
                          <span className="text-[9px] font-semibold text-emerald-500 ml-0.5">m</span>
                        </span>
                      </div>
                      <div className="flex justify-end pl-1 sm:pl-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200"
                          onClick={() => {
                            onOpenChange(false);
                            onEditPatient(p.id);
                          }}
                          title="Edit Patient"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* AI Chat Integration */}
          <div className="mt-1 rounded-xl border border-slate-200/80 bg-slate-50/70 overflow-hidden flex flex-col shadow-2xs shrink-0">
            <div className="bg-white px-3.5 py-2 border-b border-slate-200/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-sky-100 rounded-md">
                  <Bot className="h-3.5 w-3.5 text-sky-600" />
                </div>
                <span className="text-micro font-extrabold text-sky-900 uppercase tracking-wider">Ask PAMi</span>
              </div>
              <span className="text-micro font-extrabold text-slate-500 uppercase tracking-wider">Clinical Analytics Assistant</span>
            </div>
            
            {chatHistory.length > 0 && (
              <div 
                ref={scrollRef}
                className="p-3 max-h-[120px] sm:max-h-[140px] overflow-y-auto space-y-3 flex-1 min-h-[60px]"
              >
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs shadow-2xs ${
                      msg.role === 'user' 
                        ? 'bg-sky-600 text-white rounded-br-xs font-medium' 
                        : 'bg-white border border-slate-200 text-slate-700 rounded-bl-xs'
                    }`}>
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-xs prose-slate max-w-none leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <div className="font-medium leading-relaxed">{msg.content}</div>
                      )}
                    </div>
                  </div>
                ))}
                {ask.isPending && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-xl rounded-bl-xs px-3 py-2 text-xs bg-white border border-slate-200 text-slate-400 shadow-2xs flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 bg-sky-400 rounded-full animate-bounce" />
                      <span className="h-1.5 w-1.5 bg-sky-400 rounded-full animate-bounce delay-75" />
                      <span className="h-1.5 w-1.5 bg-sky-400 rounded-full animate-bounce delay-150" />
                    </div>
                  </div>
                )}
              </div>
            )}
            
            <div className="p-2 bg-white border-t border-slate-200/70">
              <form onSubmit={handleAskAI} className="relative flex items-center">
                <Textarea 
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask PAMi e.g., 'Who had the most minutes this week?'..."
                  className="min-h-[36px] h-[36px] resize-none pr-10 py-2 bg-slate-50/50 border-slate-200/80 rounded-lg focus-visible:ring-sky-500 placeholder:text-slate-400 text-xs"
                  rows={1}
                />
                <Button 
                  type="submit" 
                  size="icon" 
                  disabled={!question.trim() || ask.isPending}
                  className="absolute right-1 h-7 w-7 rounded-md bg-sky-600 hover:bg-sky-700 text-white shadow-2xs disabled:opacity-40 transition-all"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </form>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
