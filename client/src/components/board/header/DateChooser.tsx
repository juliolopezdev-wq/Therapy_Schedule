import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatLongDate, startOfWeek, weekRangeLabel, addDays, subDays, startOfDay } from "@/lib/board";

/**
 * Date navigation pill plus the Daily Forecast popover -- split out of BoardHeader so the
 * forecast query's loading/error/success states live next to the UI that renders them instead
 * of 90 lines buried in the middle of an unrelated component.
 */
function DateChooserImpl({ day, onDayChange }: { day: Date; onDayChange: (day: Date) => void }) {
  const weekStart = startOfWeek(day);
  const weekLabel = weekRangeLabel(weekStart);
  const forecastQuery = trpc.forecast.useQuery({ date: day });
  const forecast = forecastQuery.data;

  return (
    <div className="flex items-center gap-2 bg-white/95 backdrop-blur-md rounded-full p-1.5 border border-slate-200 shadow-sm transition-all hover:shadow-md">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous day"
        className="h-9 w-9 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-all"
        onClick={() => onDayChange(subDays(day, 1))}
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>

      <div className="flex flex-col items-center px-6 min-w-[190px] cursor-default">
        <span className="text-base font-extrabold tracking-tight text-slate-800">{formatLongDate(day)}</span>
        <span className="text-[10.5px] font-bold text-sky-600 uppercase tracking-widest mt-0.5">{weekLabel}</span>
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Next day"
        className="h-9 w-9 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-all"
        onClick={() => onDayChange(addDays(day, 1))}
      >
        <ChevronRight className="h-5 w-5" />
      </Button>

      <div className="ml-2 pl-3 border-l border-slate-200 py-0.5 flex items-center">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-4 text-xs font-bold tracking-wider text-slate-500 hover:text-sky-700 hover:bg-sky-50 transition-colors"
          onClick={() => onDayChange(startOfDay(new Date()))}
        >
          TODAY
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            {/* Filled sky/blue gradient, matching the app's brand treatment -- previously a bare
                ghost icon that blended into the white pill it sits in. */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Daily forecast"
              className="h-8 w-8 ml-1 shrink-0 rounded-full bg-gradient-to-br from-sky-500 via-blue-600 to-blue-700 text-white shadow-glow-sm hover:shadow-glow-sm-hover hover:-translate-y-0.5 transition-all duration-300"
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
                  <div className="mt-3 bg-gradient-to-br from-sky-50 to-blue-50 p-2.5 rounded-lg border border-sky-200">
                    <p className="text-xs font-medium text-sky-900 mb-2">Coverage Recommendation</p>
                    <p className="text-xs text-sky-700/90 mb-2">
                      Stage ~{Math.round(forecast.suggestedBufferMinutes / 60 * 10) / 10} hours of float buffer to absorb {forecast.dayOfWeek} surges.
                    </p>
                    {forecast.topAvailableTherapists.length > 0 && (
                      <div className="text-[10px] space-y-1">
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
        </Popover>
      </div>
    </div>
  );
}

export const DateChooser = memo(DateChooserImpl);
