import { useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  CalendarDays,
  CalendarOff,
  Check,
  CheckCheck,
  Clock3,
  Loader2,
  Plane,
  Plus,
  Repeat2,
  X,
} from "lucide-react";

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  denied: "bg-rose-50 text-rose-800 ring-rose-200",
  canceled: "bg-slate-100 text-slate-600 ring-slate-200",
};

function formatRequestDate(value: string) {
  const date = parseISO(value);
  return isValid(date) ? format(date, "MMM d, yyyy") : value;
}

export function ScheduleRequestsPanel({
  open,
  onOpenChange,
  therapists,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  therapists: { id: number; name: string }[];
}) {
  const { isAdmin, isTeamLead, therapistId } = usePermissions();
  const canReview = isAdmin || isTeamLead;
  const [tab, setTab] = useState<"mine" | "review">("mine");
  const utils = trpc.useUtils();

  const myRequests = trpc.scheduleRequests.list.useQuery(undefined, {
    enabled: open,
  });
  const queue = trpc.scheduleRequests.list.useQuery(
    { status: "pending" },
    { enabled: open && canReview }
  );

  const [requestType, setRequestType] = useState<"pto" | "shift_swap">("pto");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [swapWithTherapistId, setSwapWithTherapistId] = useState("");
  const [reason, setReason] = useState("");
  const [composing, setComposing] = useState(false);

  const create = trpc.scheduleRequests.create.useMutation({
    onSuccess: () => {
      toast.success("Request submitted");
      setStartDate("");
      setEndDate("");
      setReason("");
      setSwapWithTherapistId("");
      setComposing(false);
      utils.scheduleRequests.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const cancel = trpc.scheduleRequests.cancel.useMutation({
    onSuccess: () => {
      toast.success("Request canceled");
      utils.scheduleRequests.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const review = trpc.scheduleRequests.review.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(variables.decision === "approved" ? "Approved" : "Denied");
      utils.scheduleRequests.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const activeQuery = tab === "review" ? queue : myRequests;
  const list = activeQuery.data ?? [];
  const pendingCount = queue.data?.length ?? 0;
  const invalidDateRange = Boolean(startDate && endDate && endDate < startDate);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden border-l-0 bg-slate-50 p-0 sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b border-blue-700 bg-gradient-to-r from-blue-800 to-sky-700 px-5 pb-6 pt-7 pr-16 text-left sm:px-7 sm:pr-20">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-100">
            <CalendarOff className="h-4 w-4" /> Staff scheduling
          </div>
          <SheetTitle className="text-2xl font-semibold tracking-tight text-white">
            Time off & shift swaps
          </SheetTitle>
          <SheetDescription className="mt-1 max-w-sm text-sm leading-relaxed text-blue-100">
            Plan time away, coordinate a swap, and keep track of your requests.
          </SheetDescription>
        </SheetHeader>

        {canReview && (
          <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
            <div
              className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
              role="group"
              aria-label="Request view"
            >
              {(["mine", "review"] as const).map(view => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={tab === view}
                  onClick={() => setTab(view)}
                  className={cn(
                    "flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600",
                    tab === view
                      ? "bg-sky-600 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  {view === "mine" ? "My requests" : "Review queue"}
                  {view === "review" && pendingCount > 0 && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs tabular-nums text-sky-700 ring-1 ring-inset ring-sky-200">
                      {pendingCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {tab === "review" ? "Awaiting review" : "Your requests"}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {tab === "review"
                  ? "Review your team’s upcoming schedule changes."
                  : "Your time away and shift changes, in one place."}
              </p>
            </div>
            {tab === "mine" && !composing && (
              <Button
                className="gap-2 rounded-xl bg-sky-600 text-white shadow-sm hover:bg-sky-700"
                onClick={() => setComposing(true)}
              >
                <Plus className="h-4 w-4" /> New request
              </Button>
            )}
          </div>

          {tab === "mine" && composing && (
            <form
              className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm"
              onSubmit={event => {
                event.preventDefault();
                if (!startDate || invalidDateRange || create.isPending) return;
                create.mutate({
                  requestType,
                  startDate,
                  endDate: endDate || startDate,
                  reason: reason || undefined,
                  swapWithTherapistId:
                    requestType === "shift_swap" && swapWithTherapistId
                      ? Number(swapWithTherapistId)
                      : undefined,
                });
              }}
            >
              <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
                <h4 className="font-semibold text-slate-900">New request</h4>
                <p className="mt-1 text-xs text-slate-500">
                  Choose a request type and the dates you need.
                </p>
              </div>
              <fieldset
                disabled={create.isPending}
                className="min-w-0 space-y-5 p-4 sm:p-5"
              >
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-slate-700">
                    Request type
                  </legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(["pto", "shift_swap"] as const).map(type => (
                      <label key={type} className="relative cursor-pointer">
                        <input
                          className="peer sr-only"
                          type="radio"
                          name="schedule-request-type"
                          value={type}
                          checked={requestType === type}
                          onChange={() => setRequestType(type)}
                        />
                        <span className="flex min-h-16 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-600 transition-colors peer-checked:border-sky-600 peer-checked:bg-sky-50 peer-checked:text-sky-800 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-600 peer-focus-visible:ring-offset-2 peer-disabled:opacity-60">
                          {type === "pto" ? (
                            <Plane className="h-4 w-4 shrink-0" />
                          ) : (
                            <Repeat2 className="h-4 w-4 shrink-0" />
                          )}
                          {type === "pto" ? "Time off" : "Shift swap"}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="request-start-date">Start date</Label>
                    <Input
                      id="request-start-date"
                      type="date"
                      required
                      className="h-11 w-full min-w-0 rounded-xl bg-white"
                      value={startDate}
                      onChange={event => setStartDate(event.target.value)}
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="request-end-date">
                      End date{" "}
                      <span className="font-normal text-slate-400">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="request-end-date"
                      type="date"
                      min={startDate || undefined}
                      aria-invalid={invalidDateRange}
                      aria-describedby="request-date-help"
                      className="h-11 w-full min-w-0 rounded-xl bg-white"
                      value={endDate}
                      onChange={event => setEndDate(event.target.value)}
                    />
                  </div>
                </div>
                <p
                  id="request-date-help"
                  className={cn(
                    "!mt-2 text-xs",
                    invalidDateRange ? "text-rose-700" : "text-slate-500"
                  )}
                >
                  {invalidDateRange
                    ? "End date must be on or after the start date."
                    : "For a single day, leave the end date blank."}
                </p>
                {requestType === "shift_swap" && (
                  <div className="space-y-2">
                    <Label htmlFor="request-swap-colleague">Swap with</Label>
                    <Select
                      value={swapWithTherapistId}
                      onValueChange={setSwapWithTherapistId}
                      disabled={create.isPending}
                    >
                      <SelectTrigger
                        id="request-swap-colleague"
                        className="w-full min-w-0 rounded-xl bg-white data-[size=default]:h-11"
                      >
                        <SelectValue placeholder="Choose a colleague" />
                      </SelectTrigger>
                      <SelectContent>
                        {therapists
                          .filter(person => person.id !== therapistId)
                          .map(person => (
                            <SelectItem
                              key={person.id}
                              value={String(person.id)}
                            >
                              {person.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="request-reason">
                    Reason{" "}
                    <span className="font-normal text-slate-400">
                      (optional)
                    </span>
                  </Label>
                  <Textarea
                    id="request-reason"
                    className="min-h-24 resize-y rounded-xl bg-white"
                    maxLength={500}
                    placeholder="Add a note for your reviewer…"
                    value={reason}
                    onChange={event => setReason(event.target.value)}
                  />
                </div>
              </fieldset>
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={create.isPending}
                  className="rounded-xl"
                  onClick={() => setComposing(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="gap-2 rounded-xl bg-sky-600 text-white hover:bg-sky-700"
                  disabled={!startDate || invalidDateRange || create.isPending}
                >
                  {create.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {create.isPending ? "Submitting…" : "Submit request"}
                </Button>
              </div>
            </form>
          )}

          {activeQuery.isLoading ? (
            <div role="status" className="space-y-3">
              <span className="sr-only">Loading requests</span>
              {[0, 1, 2].map(item => (
                <div
                  key={item}
                  className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white"
                />
              ))}
            </div>
          ) : activeQuery.isError ? (
            <div
              role="alert"
              className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-6 text-center"
            >
              <p className="text-sm font-medium text-rose-800">
                Requests could not be loaded.
              </p>
              <Button
                variant="outline"
                className="mt-3 rounded-xl bg-white"
                onClick={() => activeQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : list.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                {tab === "review" ? (
                  <CheckCheck className="h-6 w-6" />
                ) : (
                  <CalendarDays className="h-6 w-6" />
                )}
              </div>
              <p className="text-sm font-semibold text-slate-800">
                {tab === "review" ? "You’re all caught up" : "No requests yet"}
              </p>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-500">
                {tab === "review"
                  ? "New requests from your team will appear here for review."
                  : "Submit a time-off or shift-swap request to get started."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {list.map(req => (
                <article
                  key={req.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="space-y-4 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
                          {req.requestType === "pto" ? (
                            <Plane className="h-5 w-5" />
                          ) : (
                            <Repeat2 className="h-5 w-5" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-slate-900">
                            {req.requestType === "pto"
                              ? "Time off"
                              : "Shift swap"}
                          </h4>
                          {tab === "review" && (
                            <p className="mt-0.5 break-words text-xs text-slate-500">
                              {req.therapistName}
                            </p>
                          )}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset",
                          STATUS_CLASS[req.status]
                        )}
                      >
                        {req.status === "pending" && (
                          <Clock3 className="h-3 w-3" />
                        )}
                        {req.status}
                      </span>
                    </div>
                    <div className="space-y-2 text-sm text-slate-600">
                      <p className="flex items-start gap-2">
                        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <span>
                          {formatRequestDate(req.startDate)}
                          {req.endDate !== req.startDate
                            ? ` – ${formatRequestDate(req.endDate)}`
                            : ""}
                        </span>
                      </p>
                      {req.requestType === "shift_swap" &&
                        req.swapWithTherapistId && (
                          <p className="flex items-start gap-2">
                            <Repeat2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                            <span>
                              With{" "}
                              {therapists.find(
                                person => person.id === req.swapWithTherapistId
                              )?.name ?? "colleague"}
                            </span>
                          </p>
                        )}
                    </div>
                    {req.reason && (
                      <p className="whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl bg-slate-50 px-3 py-2.5 text-sm leading-relaxed text-slate-600">
                        {req.reason}
                      </p>
                    )}
                  </div>
                  {req.status === "pending" && (
                    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
                      {tab === "mine" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate({ id: req.id })}
                        >
                          {cancel.isPending &&
                          cancel.variables?.id === req.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}{" "}
                          Cancel request
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-lg border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                            disabled={review.isPending}
                            onClick={() =>
                              review.mutate({ id: req.id, decision: "denied" })
                            }
                          >
                            Deny
                          </Button>
                          <Button
                            size="sm"
                            className="gap-1.5 rounded-lg bg-sky-600 text-white hover:bg-sky-700"
                            disabled={review.isPending}
                            onClick={() =>
                              review.mutate({
                                id: req.id,
                                decision: "approved",
                              })
                            }
                          >
                            {review.isPending &&
                            review.variables?.id === req.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}{" "}
                            Approve
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
