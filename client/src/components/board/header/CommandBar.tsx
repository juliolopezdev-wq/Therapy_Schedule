import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Users, UserRound, ClipboardList, Clock, BarChart3, Bot, Sparkles } from "lucide-react";

interface NavAction {
  label: string;
  icon: typeof Users;
  onClick: () => void;
}

/**
 * The dark blue top bar: logo/wordmark plus the panel-opening nav (Patients/Staff/Attendance/
 * Mins/Data) and the "Ask PAMi" CTA. Split out of BoardHeader -- this part of the header never
 * reads filter/date/status state, so it doesn't need to re-render when any of that changes.
 */
function CommandBarImpl({ actions, onAskPami }: { actions: NavAction[]; onAskPami: () => void }) {
  return (
    <div className="relative flex flex-wrap items-center justify-between px-4 py-3 sm:px-6 bg-gradient-to-r from-blue-800 via-sky-600 to-blue-800 text-blue-50 min-h-[88px] shadow-md border-b border-blue-700/50">
      {/* Left: Logo */}
      <div className="flex shrink-0 items-center gap-4 w-1/3 group cursor-default">
        <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 via-blue-600 to-sky-600 shadow-glow-lg border border-white/20 overflow-hidden transition-all duration-500 group-hover:shadow-glow-lg-hover group-hover:-translate-y-0.5">
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent mix-blend-overlay" />
          <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
          <svg viewBox="0 0 24 24" className="relative z-10 h-7 w-7 text-white drop-shadow-[0_2px_5px_rgba(0,0,0,0.4)] transform transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 3 3 8 12 13 21 8 12 3" fill="currentColor" fillOpacity="0.25" />
            <polyline points="3 13 12 18 21 13" />
            <polyline points="3 18 12 23 21 18" />
          </svg>
        </div>
        <div className="hidden flex-col leading-none sm:flex">
          <span className="text-[20px] font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-200 drop-shadow-sm">PAM</span>
          <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-blue-300 mt-1 opacity-90">Rehab Scheduler</span>
        </div>
      </div>

      {/* Right: Global Actions */}
      <div className="flex items-center justify-end gap-2.5 w-1/3 ml-auto">
        {actions.map(({ label, icon: Icon, onClick }) => (
          <Button
            key={label}
            variant="ghost"
            size="sm"
            aria-label={label}
            className="h-10 rounded-full px-3 xl:px-4 font-medium text-blue-100 hover:bg-blue-500/20 hover:text-white transition-all"
            onClick={onClick}
          >
            <Icon className="xl:mr-2 h-4.5 w-4.5" />
            <span className="hidden xl:inline text-sm">{label}</span>
          </Button>
        ))}

        <div className="mx-1.5 h-6 w-[1px] bg-blue-500/20" />

        <Button
          variant="ghost"
          size="sm"
          aria-label="Ask PAMi"
          className="group relative h-10 overflow-hidden rounded-full px-3 xl:px-6 font-extrabold text-white transition-all duration-500 hover:scale-105 hover:shadow-glow-md"
          onClick={onAskPami}
        >
          {/* Animated Gradient Background */}
          <div className="absolute inset-0 bg-gradient-to-r from-sky-500 via-blue-600 to-blue-700 bg-[length:200%_auto] animate-[gradient_3s_ease_infinite]" />
          
          {/* Glow overlay on hover */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-white/20 transition-opacity duration-300" />
          
          <div className="relative flex items-center z-10">
            <Sparkles className="xl:mr-2 h-4 w-4 text-white drop-shadow-sm animate-pulse" />
            <span className="hidden xl:inline text-sm tracking-wide drop-shadow-sm">Ask PAMi</span>
          </div>
        </Button>
      </div>
    </div>
  );
}

export const CommandBar = memo(CommandBarImpl);
export const COMMAND_BAR_ICONS = { Users, UserRound, ClipboardList, Clock, BarChart3 };
