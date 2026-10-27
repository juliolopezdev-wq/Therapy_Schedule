import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

export default function SessionTimeoutNotice() {
  const { user, logout } = useAuth();
  const [now, setNow] = useState(Date.now);
  const status = trpc.auth.sessionStatus.useQuery(undefined, {
    enabled: Boolean(user),
    refetchInterval: user ? 60_000 : false,
    retry: false,
  });
  const deadline = useMemo(
    () =>
      status.data
        ? Date.now() +
          Math.max(0, status.data.expiresAt - status.data.serverNow)
        : 0,
    [status.data]
  );
  const extend = trpc.auth.activity.useMutation({
    onSuccess: () => {
      void status.refetch();
    },
  });
  useEffect(() => {
    if (!user || !deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [user?.id, deadline]);
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  if (!user || !deadline || seconds > 300) return null;
  return (
    <aside
      aria-label="Session expiry warning"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-lg"
    >
      <div>
        <p className="text-sm font-semibold">
          <span role="alert">Your session will lock soon. </span>
          <span role="timer" aria-live="off" aria-label="Time until session lock">{seconds
            ? `in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
            : "now"}</span>
        </p>
        <p className="mt-1 text-xs">
          Save unfinished work before leaving this device.{" "}
          {status.data?.canExtend
            ? "Stay signed in if you are still working."
            : "Sign in again to start a new session."}
        </p>
      </div>
      {status.data?.canExtend && seconds > 0 ? (
        <Button
          size="sm"
          disabled={extend.isPending}
          onClick={() => extend.mutate()}
        >
          Stay signed in
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={async () => {
            await logout();
            window.location.href = "/login";
          }}
        >
          Sign in again
        </Button>
      )}
      {extend.error && (
        <p className="w-full text-xs text-rose-700">
          Could not extend the session. Save your work and sign in again.
        </p>
      )}
    </aside>
  );
}
