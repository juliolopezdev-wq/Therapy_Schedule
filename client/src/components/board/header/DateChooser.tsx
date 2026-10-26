import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { formatLongDate, startOfWeek, weekRangeLabel, addDays, subDays, startOfDay } from "@/lib/board";

/**
 * Date navigation pill plus the Daily Forecast popover -- split out of BoardHeader so the
 * forecast query's loading/error/success states live next to the UI that renders them instead
 * of 90 lines buried in the middle of an unrelated component.
 */
function DateChooserImpl({ day, onDayChange }: { day: Date; onDayChange: (day: Date) => void }) {
  const { isAdmin } = usePermissions();
  const weekStart = startOfWeek(day);
  const weekLabel = weekRangeLabel(weekStart);
  const forecastQuery = trpc.forecast.useQuery({ date: day }, { enabled: isAdmin });
  const forecast = forecastQuery.data;

  return (
    <div className="flex w-full max-w-[560px] items-center gap-1 rounded-xl border border-slate-300 bg-white p-1 shadow-sm sm:gap-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous day"
        className="h-11 w-11 shrink-0 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        onClick={() => onDayChange(subDays(day, 1))}
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>

      <div className="flex min-w-0 flex-1 cursor-default flex-col items-center px-1 sm:min-w-[190px] sm:px-4">
        <span className="max-w-full truncate text-sm font-extrabold tracking-tight text-slate-900 sm:text-base">{formatLongDate(day)}</span>
        <span className="mt-0.5 hidden text-xs font-bold uppercase tracking-wide text-blue-700 sm:block">{weekLabel}</span>
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Next day"
        className="h-11 w-11 shrink-0 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        onClick={() => onDayChange(addDays(day, 1))}
      >
        <ChevronRight className="h-5 w-5" />
      </Button>

      <div className="flex items-center border-l border-slate-200 pl-1 sm:ml-1 sm:pl-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-11 rounded-lg px-2 text-xs font-bold tracking-wide text-slate-600 hover:bg-blue-50 hover:text-blue-800 sm:px-3"
          onClick={() => onDayChange(startOfDay(new Date()))}
        >
          TODAY
        </Button>

        {isAdmin && <Popover>
          <PopoverTrigger asChild>
            {/* Filled sky/blue gradient, matching the app's brand treatment -- previously a bare
                ghost icon that blended into the white pill it sits in. */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Daily forecast"
              className="ml-1 h-11 w-11 shrink-0 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="center" className="w-80 p-4 border-sky-200 shadow-xl shadow-sky-900/10 z-50">
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-sky-100 pb-2">
                <Sparkles className="h-4 w-4 text-sky-600" />
                <h4 className="font-semibold text-sm text-sky-950">Daily Forecast</h4>
              </div>
              {forecastQuery.isError ? (
                <p className="text-xs text-rose-600">Couldn't load the forecast. Try again in a moment.</p>
              ) : forecast ? (
                <div className="text-sm text-slate-600 space-y-2">
                  <p>Historical trends for a <strong>{forecast.dayOfWeek}</strong>:</p>
                  <ul className="list-disc pl-5 space-y-1 text-slate-500 text-xs">
                    <li>Expected call-off rate: <span className="font-semibold text-slate-700">{(forecast.expectedMissedRate * 100).toFixed(0)}%</span></li>
                    <li>Avg new admissions: <span className="font-semibold text-slate-700">{forecast.expectedAdmissions.toFixed(1)}</span></li>
                  </ul>
                  <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-2.5">
                    <p className="text-xs font-medium text-sky-900 mb-2">Coverage Recommendation</p>
                    <p className="text-xs text-sky-700/90 mb-2">
                      Stage ~{Math.round(forecast.suggestedBufferMinutes / 60 * 10) / 10} hours of float buffer to absorb {forecast.dayOfWeek} surges.
                    </p>
                    {forecast.topAvailableTherapists.length > 0 && (
                      <div className="space-y-1 text-xs">
                        <span className="font-semibold text-sky-900/70 uppercase tracking-wider">Top Available Float Staff:</span>
                        {forecast.topAvailableTherapists.map((t: any) => (
                          <div key={t.id} className="flex justify-between items-center bg-white border border-sky-100 rounded px-2 py-1">
                            <span className="font-medium text-slate-700">{t.name}</span>
                            <span className="text-blue-600 font-semibold">{Math.round(t.availableMinutes / 60 * 10) / 10}h open</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 animate-pulse">Calculating forecast...</p>
              )}
            </div>
          </PopoverContent>
        </Popover>}
      </div>
    </div>
  );
}

export const DateChooser = memo(DateChooserImpl);
