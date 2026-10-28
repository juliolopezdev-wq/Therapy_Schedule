import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

// Listens for "something changed" from the server and reloads whatever is on screen.
// The browser reconnects on its own if the connection drops.
export default function LiveUpdates() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const signedIn = Boolean(user);

  useEffect(() => {
    if (!signedIn) return;
    let firstVersion: string | null = null;
    const source = new EventSource("/api/live", { withCredentials: true });

    source.addEventListener("change", () => {
      void queryClient.invalidateQueries();
    });

    source.addEventListener("version", (event) => {
      const version = JSON.parse((event as MessageEvent<string>).data) as string;
      if (firstVersion === null) {
        firstVersion = version;
        return;
      }
      // reconnected after a restart: catch up on anything missed while disconnected
      void queryClient.invalidateQueries();
      if (version !== firstVersion) {
        toast("A new version of MinuteMinder is available.", {
          id: "new-version",
          duration: Infinity,
          action: { label: "Reload", onClick: () => window.location.reload() },
        });
      }
    });

    return () => source.close();
  }, [signedIn, queryClient]);

  return null;
}
