import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Users, UserRound, ClipboardList, Clock, BarChart3, Sparkles, MoreHorizontal } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import UserMenu from "@/components/UserMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavAction {
  label: string;
  icon: typeof Users;
  onClick: () => void;
  badgeCount?: number;
}

export interface MoreAction extends NavAction {
  destructive?: boolean;
}

/**
 * The dark blue top bar: logo/wordmark plus the panel-opening nav (Patients/Staff/Attendance/
 * Mins/Data) and the "Ask PAMi" CTA. Split out of BoardHeader -- this part of the header never
 * reads filter/date/status state, so it doesn't need to re-render when any of that changes.
 */
function CommandBarImpl({
  actions,
  moreActions,
  onAskPami,
}: {
  actions: NavAction[];
  moreActions: MoreAction[];
  onAskPami?: () => void;
}) {
  return (
    <div className="relative flex min-h-[68px] items-center justify-between gap-3 border-b border-blue-700 bg-gradient-to-r from-blue-800 via-blue-700 to-sky-600 px-3 py-2 text-blue-50 shadow-md sm:px-6">
      {/* Left: Logo */}
      <div className="flex min-w-0 shrink-0 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
          <BrandLogo className="h-6 w-6 text-white" />
        </div>
        <div className="hidden flex-col leading-none sm:flex">
          <span className="text-lg font-bold tracking-tight text-white">MinuteMinder</span>
          <span className="mt-1 text-xs font-semibold text-slate-300">Rehab scheduling</span>
        </div>
      </div>

      {/* Right: Global Actions */}
      <div className="ml-auto flex min-w-0 items-center justify-end gap-1 sm:gap-2">
        {actions.map(({ label, icon: Icon, onClick, badgeCount }) => (
          <Button
            key={label}
            variant="ghost"
            size="sm"
            aria-label={label}
            className="relative h-11 shrink-0 rounded-lg px-2.5 font-semibold text-blue-50 hover:bg-blue-500/30 hover:text-white sm:px-3"
            onClick={onClick}
          >
            <Icon className="h-5 w-5 lg:mr-2" />
            <span className="hidden text-sm lg:inline">{label}</span>
            {!!badgeCount && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-blue-700 bg-rose-500 px-1 text-[10px] font-black leading-none text-white shadow-sm" aria-label={`${badgeCount} unread staff items`}>
                {badgeCount > 9 ? "9+" : badgeCount}
              </span>
            )}
          </Button>
        ))}

        {onAskPami && <Button
          variant="ghost"
          size="sm"
          aria-label="Ask PAMi"
          className="h-11 shrink-0 rounded-lg border border-white/70 bg-white px-2.5 font-bold text-blue-800 shadow-sm hover:bg-blue-50 hover:text-blue-950 sm:px-3"
          onClick={onAskPami}
        >
          <div className="flex items-center">
            <Sparkles className="h-5 w-5 text-blue-600 lg:mr-2" />
            <span className="hidden text-sm lg:inline">Ask PAMi</span>
          </div>
        </Button>}

        {moreActions.length > 0 && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="More tools"
              className="h-11 shrink-0 rounded-lg px-2.5 font-semibold text-blue-50 hover:bg-blue-500/30 hover:text-white sm:px-3"
            >
              <MoreHorizontal className="h-5 w-5 lg:mr-2" />
              <span className="hidden text-sm lg:inline">More</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 border-slate-200 bg-white p-1.5 shadow-xl">
            {moreActions.map(({ label, icon: Icon, onClick, destructive }) => (
              <DropdownMenuItem
                key={label}
                onClick={onClick}
                className={destructive ? "min-h-10 cursor-pointer text-rose-700" : "min-h-10 cursor-pointer text-slate-700"}
              >
                <Icon className="mr-3 h-4 w-4" />
                <span className="text-sm font-medium">{label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>}

        <UserMenu inline />
      </div>
    </div>
  );
}

export const CommandBar = memo(CommandBarImpl);
export const COMMAND_BAR_ICONS = { Users, UserRound, ClipboardList, Clock, BarChart3 };
