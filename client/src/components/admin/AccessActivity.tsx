import { useEffect, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  History,
  Laptop,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDate } from "@/lib/utils";

type Output = inferRouterOutputs<AppRouter>["admin"];
type Session = Output["listSessions"][number];
type AuditEntry = Output["auditLog"][number];
type ListQuery<T> = {
  data?: T[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
};

const PAGE_SIZE = 8;
const RECENTLY_ACTIVE_MS = 15 * 60_000;
const ACTIONS: Record<string, string> = {
  "ai.propose": "AI plan proposed", "ai.apply": "AI plan applied", "ai.undo": "AI changes undone", "functional_assessment.update": "Assessment draft updated", "functional_assessment.sign": "Assessment signed", "patient_goal.update": "Patient goal updated", "patient_goal.archive": "Patient goal archived", "treatment_note.update": "Treatment note updated",
  "invite.create": "Invitation sent",
  "invite.resend": "Invitation resent",
  "invite.revoke": "Invitation revoked",
  "invite.role_change": "Invitation role changed",
  "user.role_change": "Account role changed",
  "user.name_change": "Account name updated",
  "user.staff_link": "Staff profile linked",
  "user.staff_unlink": "Staff profile unlinked",
  "user.deactivate": "Account deactivated",
  "user.reactivate": "Account reactivated",
  "user.delete": "Account deleted",
  "session.revoke": "Device signed out",
  "attendance.call_off": "Absence recorded",
  "attendance.mark_present": "Staff marked present",
  "attendance.call_off_coverage": "Absence coverage updated",
  "admission.create": "Admission added",
  "admission.readmit": "Patient readmitted",
  "admission.discharge": "Patient discharged",
  "admission.update": "Admission updated",
  "admission.reorder": "Patient order changed",
  "admission.archive": "Admission archived",
  "admission.restore": "Admission restored",
  "session.reassign": "Therapy reassigned",
  "session.complete_own": "Therapy marked complete",
  "session.undo_complete_own": "Therapy completion undone",
  "sessions.complete_all": "All therapy marked complete",
  "staff.create": "Staff profile added",
  "staff.update": "Staff profile updated",
  "staff.update_own_contact": "Contact information updated",
  "staff.archive": "Staff profile archived",
  "staff.restore": "Staff profile restored",
  "board_snapshot.create": "Board snapshot saved",
  "board_snapshot.delete": "Board snapshot deleted",
  "message.create": "Board message posted",
  "direct_message.send": "Direct message sent",
  "treatment_note.create": "Treatment note added",
  "treatment_note.sign": "Treatment note signed",
  "functional_assessment.create": "Functional assessment added",
  "schedule_request.approved": "Schedule request approved",
  "schedule_request.denied": "Schedule request denied",
  "schedule_request.rejected": "Schedule request rejected",
};
const CATEGORY_STYLES: Record<string, string> = {
  Access: "bg-blue-50 text-blue-600",
  Messages: "bg-violet-50 text-violet-600",
  "Clinical & scheduling": "bg-teal-50 text-teal-600",
};

function readable(value: string) {
  const words = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function actionLabel(action: string) {
  return ACTIONS[action] || readable(action);
}

function dateLabel(value: Date | string | number) {
  return formatDate(value, "Time unavailable");
}

function dayLabel(value: Date | string | number) {
  return new Date(value).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function relative(value: Date | string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

function getOs(ua: string) {
  if (/iPhone|iPad/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Macintosh|Mac OS/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

// check Edge and Opera before Chrome, and Chrome before Safari,
// since their user agents also contain "Chrome" / "Safari"
function getBrowser(ua: string) {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox|FxiOS/.test(ua)) return "Firefox";
  if (/Chrome|CriOS/.test(ua)) return "Chrome";
  if (/Safari/.test(ua)) return "Safari";
  return "Browser";
}

function deviceInfo(agent: string | null) {
  const ua = agent ?? "";
  if (!ua) return { mobile: false, label: "Unknown device" };
  const os = getOs(ua);
  const browser = getBrowser(ua);
  return {
    mobile: /iPhone|iPad|Android|Mobile/i.test(ua),
    label: os ? `${browser} on ${os}` : browser,
  };
}

function category(action: string) {
  if (/^(invite|user)\.|^session\.revoke$/.test(action)) return "Access";
  if (/^(message|direct_message)\./.test(action)) return "Messages";
  return "Clinical & scheduling";
}

function formatMeta(key: string, value: unknown) {
  if (value == null) return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  if (key === "role" || key === "emailDelivery") return readable(String(value));
  return String(value);
}

function Pager({
  page,
  count,
  onChange,
}: {
  page: number;
  count: number;
  onChange: (value: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
      <p className="text-xs text-slate-500" aria-live="polite">
        {count
          ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, count)} of ${count}`
          : "0 results"}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous page"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-slate-600">
          Page {page + 1} of {pages}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next page"
          disabled={page + 1 >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SearchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search
        aria-hidden
        className="absolute left-3 top-3 h-4 w-4 text-slate-400"
      />
      <Input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 bg-white pl-9"
      />
    </div>
  );
}

function ListState({
  loading,
  error,
  empty,
  filtered,
  onRetry,
  onClear,
}: {
  loading: boolean;
  error: boolean;
  empty: string;
  filtered: boolean;
  onRetry: () => void;
  onClear: () => void;
}) {
  if (loading)
    return (
      <div
        role="status"
        aria-label="Loading activity"
        className="space-y-4 p-6"
      >
        {[0, 1, 2].map(i => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    );
  return (
    <div className="px-6 py-12 text-center">
      <p className={`text-sm ${error ? "text-rose-700" : "text-slate-500"}`}>
        {error
          ? "This information could not be loaded."
          : filtered
            ? "No results match your filters."
            : empty}
      </p>
      {(error || filtered) && (
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={error ? onRetry : onClear}
        >
          {error ? "Try again" : "Clear filters"}
        </Button>
      )}
    </div>
  );
}

function SignedInDevices({
  query,
  currentUserId,
  onRevoke,
  revoking,
}: {
  query: ListQuery<Session>;
  currentUserId?: number;
  onRevoke: (id: number) => Promise<unknown>;
  revoking: boolean;
}) {
  const sessions = query.data ?? [];
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [page, setPage] = useState(0);
  const [toRevoke, setToRevoke] = useState<Session | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const searchText = search.trim().toLowerCase();
  const filtered = sessions.filter(session => {
    if (scope === "mine" && session.userId !== currentUserId) return false;
    const text = `${session.userName ?? ""} ${session.userEmail ?? ""} ${session.ipAddress ?? ""} ${deviceInfo(session.userAgent).label}`;
    return text.toLowerCase().includes(searchText);
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  );

  const hasFilters = search !== "" || scope !== "all";
  const clearFilters = () => {
    setSearch("");
    setScope("all");
    setPage(0);
  };
  const refresh = () => {
    query.refetch();
  };

  return (
    <section
      id="signed-in-devices"
      aria-labelledby="sessions-title"
      className="scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div className="flex gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 id="sessions-title" className="text-lg font-bold text-slate-900">
              Signed-in devices{" "}
              <span className="ml-1 text-sm font-medium text-slate-400">
                {query.isLoading || query.isError ? "" : sessions.length}
              </span>
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Review account access and sign out devices you no longer
              recognize.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={refresh}
        >
          <RefreshCw
            className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`}
          />
          Refresh devices
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-y border-slate-100 bg-slate-50/70 px-5 py-3 sm:flex-row sm:px-6">
        <SearchField
          label="Search people, devices, or IP addresses"
          value={search}
          onChange={value => {
            setSearch(value);
            setPage(0);
          }}
        />
        <Select
          value={scope}
          onValueChange={value => {
            setScope(value);
            setPage(0);
          }}
        >
          <SelectTrigger
            aria-label="Filter devices by account"
            className="h-10 w-full bg-white sm:w-44"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            <SelectItem value="mine">My account</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      <p className="px-5 pt-4 text-xs leading-relaxed text-slate-500 sm:px-6">
        A signed-in device may be idle. “Recently active” means it contacted
        the app in the last 15 minutes. Other administrators’ devices are
        hidden.
      </p>

      {query.isLoading || query.isError || filtered.length === 0 ? (
        <ListState
          loading={query.isLoading}
          error={query.isError}
          empty="No devices are currently signed in."
          filtered={hasFilters}
          onRetry={refresh}
          onClear={clearFilters}
        />
      ) : (
        <div className="divide-y divide-slate-100 px-5 sm:px-6">
          {pageRows.map(session => {
            const device = deviceInfo(session.userAgent);
            const DeviceIcon = device.mobile ? Smartphone : Laptop;
            const lastSeen = new Date(session.lastSeenAt).getTime();
            const recent = now - lastSeen < RECENTLY_ACTIVE_MS;
            return (
              <article
                key={session.id}
                className="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-slate-500">
                    <DeviceIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-slate-900">
                      {session.userName || session.userEmail || "Unknown account"}
                    </p>
                    {session.userName && session.userEmail && (
                      <p className="break-all text-xs text-slate-500">
                        {session.userEmail}
                      </p>
                    )}
                    <p className="mt-1.5 text-xs text-slate-600">
                      {device.label}
                    </p>
                    {session.userId === currentUserId && (
                      <Badge
                        variant="secondary"
                        className="mt-2 bg-sky-50 text-sky-700"
                      >
                        Your account
                      </Badge>
                    )}
                  </div>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${recent ? "bg-emerald-500" : "bg-slate-300"}`}
                    />
                    <span className="text-xs font-semibold text-slate-700">
                      {recent ? "Recently active" : "Idle"}
                    </span>
                    <time
                      title={dateLabel(session.lastSeenAt)}
                      className="text-xs text-slate-500"
                    >
                      {relative(session.lastSeenAt)}
                    </time>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    Signed in {dateLabel(session.createdAt)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Expires {dateLabel(session.expiresAt)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    IP: {session.ipAddress || "Unavailable"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-self-start border-rose-200 text-rose-700 hover:bg-rose-50 sm:justify-self-end"
                  aria-label={`Sign out ${device.label} for ${session.userEmail || session.userName || "unknown account"}`}
                  disabled={revoking}
                  onClick={() => setToRevoke(session)}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out device
                </Button>
              </article>
            );
          })}
        </div>
      )}

      {!query.isError && !query.isLoading && (
        <Pager page={currentPage} count={filtered.length} onChange={setPage} />
      )}

      <AlertDialog
        open={toRevoke !== null}
        onOpenChange={open => {
          if (!open && !revoking) setToRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out this device?</AlertDialogTitle>
            <AlertDialogDescription>
              {toRevoke && (
                <>
                  {deviceInfo(toRevoke.userAgent).label} for{" "}
                  <strong>
                    {toRevoke.userEmail || toRevoke.userName || "this account"}
                  </strong>{" "}
                  will lose access. They can sign in again with a new email
                  link.
                  {toRevoke.userId === currentUserId &&
                    " This belongs to your account, so you may be signed out too."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>
              Keep signed in
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={revoking}
              className="bg-rose-700 hover:bg-rose-800"
              onClick={async event => {
                event.preventDefault();
                if (!toRevoke) return;
                try {
                  await onRevoke(toRevoke.id);
                  setToRevoke(null);
                } catch {
                  /* Mutation displays the error; keep the dialog open for retry. */
                }
              }}
            >
              {revoking ? "Signing out…" : "Sign out device"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function AuditLog({
  query,
  users,
}: {
  query: ListQuery<AuditEntry>;
  users: Output["listUsers"];
}) {
  const entries = query.data ?? [];
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [period, setPeriod] = useState("all");
  const [page, setPage] = useState(0);

  const userLabel = (id: string) => {
    const user = users.find(u => String(u.id) === id);
    return user?.name || user?.email || null;
  };
  const targetLabel = (entry: AuditEntry) => {
    if (!entry.targetId) {
      return entry.targetType ? readable(entry.targetType) : "No specific record";
    }
    if (entry.targetType === "user") {
      return userLabel(entry.targetId) || `Account #${entry.targetId}`;
    }
    if (entry.targetType === "invite") return entry.targetId;
    return `${readable(entry.targetType || "Record")} #${entry.targetId}`;
  };

  const searchText = search.trim().toLowerCase();
  const since =
    period === "all" ? 0 : Date.now() - Number(period) * 86_400_000;
  const filtered = entries.filter(entry => {
    if (categoryFilter !== "all" && category(entry.action) !== categoryFilter) {
      return false;
    }
    if (new Date(entry.createdAt).getTime() < since) return false;
    const text = `${entry.actorEmail ?? "System"} ${actionLabel(entry.action)} ${entry.action} ${targetLabel(entry)}`;
    return text.toLowerCase().includes(searchText);
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  );

  const hasFilters = search !== "" || categoryFilter !== "all" || period !== "all";
  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setPeriod("all");
    setPage(0);
  };
  const refresh = () => {
    query.refetch();
  };

  return (
    <section
      id="audit-log"
      aria-labelledby="audit-title"
      className="scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div className="flex gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
            <History className="h-5 w-5" />
          </span>
          <div>
            <h2 id="audit-title" className="text-lg font-bold text-slate-900">
              Audit log
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              See who changed what, and when. Times use your device’s time
              zone.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={refresh}
        >
          <RefreshCw
            className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`}
          />
          Refresh activity
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-y border-slate-100 bg-slate-50/70 px-5 py-3 lg:flex-row sm:px-6">
        <SearchField
          label="Search activity, people, or records"
          value={search}
          onChange={value => {
            setSearch(value);
            setPage(0);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Select
            value={categoryFilter}
            onValueChange={value => {
              setCategoryFilter(value);
              setPage(0);
            }}
          >
            <SelectTrigger
              aria-label="Filter activity by category"
              className="h-10 w-full bg-white sm:w-48"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All activity</SelectItem>
              <SelectItem value="Access">Access</SelectItem>
              <SelectItem value="Clinical & scheduling">
                Clinical & scheduling
              </SelectItem>
              <SelectItem value="Messages">Messages</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={period}
            onValueChange={value => {
              setPeriod(value);
              setPage(0);
            }}
          >
            <SelectTrigger
              aria-label="Filter activity by time"
              className="h-10 w-full bg-white sm:w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any time</SelectItem>
              <SelectItem value="1">Last 24 hours</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <p className="px-5 pt-4 text-xs text-slate-500 sm:px-6">
        Search and filters apply to the latest {entries.length} loaded events
        (up to 100).
      </p>

      {query.isLoading || query.isError || filtered.length === 0 ? (
        <ListState
          loading={query.isLoading}
          error={query.isError}
          empty="No activity has been recorded yet."
          filtered={hasFilters}
          onRetry={refresh}
          onClear={clearFilters}
        />
      ) : (
        <div className="px-5 pb-2 sm:px-6">
          {pageRows.map((entry, index) => {
            const day = dayLabel(entry.createdAt);
            const previousDay =
              index > 0 ? dayLabel(pageRows[index - 1].createdAt) : null;
            const group = category(entry.action);
            let metadata: [string, unknown][] = [];
            if (entry.metadata && typeof entry.metadata === "object") {
              metadata = Object.entries(entry.metadata);
            }
            return (
              <div key={entry.id}>
                {day !== previousDay && (
                  <h3 className="border-b border-slate-100 pb-2 pt-6 text-xs font-semibold text-slate-500">
                    {day}
                  </h3>
                )}
                <article className="flex gap-3 border-b border-slate-100 py-4 last:border-0">
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${CATEGORY_STYLES[group]}`}
                  >
                    <Activity className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {actionLabel(entry.action)}
                      </p>
                      <time
                        title={dateLabel(entry.createdAt)}
                        className="text-xs tabular-nums text-slate-500"
                      >
                        {new Date(entry.createdAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p className="mt-1 break-all text-sm text-slate-600">
                      {targetLabel(entry)}
                    </p>
                    <p className="mt-1 break-all text-xs text-slate-500">
                      By{" "}
                      {entry.actorEmail ||
                        (entry.actorUserId
                          ? `Account #${entry.actorUserId}`
                          : "System")}
                    </p>
                    <details className="mt-2 text-xs text-slate-500">
                      <summary className="w-fit cursor-pointer rounded py-1 font-medium text-sky-700 focus-visible:outline-2 focus-visible:outline-sky-600">
                        View details
                      </summary>
                      <dl className="mt-2 grid gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-2">
                        <div>
                          <dt className="text-slate-400">Category</dt>
                          <dd className="mt-0.5 text-slate-700">{group}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-400">Recorded</dt>
                          <dd className="mt-0.5 text-slate-700">
                            {dateLabel(entry.createdAt)}
                          </dd>
                        </div>
                        {metadata.map(([key, value]) => (
                          <div key={key} className="min-w-0">
                            <dt className="text-slate-400">{readable(key)}</dt>
                            <dd className="mt-0.5 break-words text-slate-700">
                              {formatMeta(key, value)}
                            </dd>
                          </div>
                        ))}
                        <div>
                          <dt className="text-slate-400">Event reference</dt>
                          <dd className="mt-0.5 text-slate-700">
                            #{entry.id} · {entry.action}
                          </dd>
                        </div>
                      </dl>
                    </details>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      )}

      {!query.isError && !query.isLoading && (
        <Pager page={currentPage} count={filtered.length} onChange={setPage} />
      )}
    </section>
  );
}

export default function AccessActivity(props: {
  sessions: ListQuery<Session>;
  audit: ListQuery<AuditEntry>;
  users: Output["listUsers"];
  currentUserId?: number;
  onRevoke: (id: number) => Promise<unknown>;
  revoking: boolean;
}) {
  return (
    <>
      <SignedInDevices
        query={props.sessions}
        currentUserId={props.currentUserId}
        onRevoke={props.onRevoke}
        revoking={props.revoking}
      />
      <AuditLog query={props.audit} users={props.users} />
    </>
  );
}
