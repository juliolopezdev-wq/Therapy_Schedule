import { useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { PatientMoveQueue } from "@shared/patientOrder";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type Patient = inferRouterOutputs<AppRouter>["patients"]["list"][number];
export function usePatientReorder(day: Date) {
  const utils = trpc.useUtils();
  const queues = useRef(new Map<number, PatientMoveQueue<Patient>>());
  const sequence = useRef(0);
  return trpc.patients.reorder.useMutation({
    // Requests reach the server in gesture order; onMutate still paints queued gestures immediately.
    scope: { id: "patient-row-reorder" },
    onMutate: async move => {
      const queryInput = { date: new Date(day) };
      const key = day.getTime();
      let queue = queues.current.get(key);
      if (!queue) {
        queue = new PatientMoveQueue(
          utils.patients.list.getData(queryInput) ?? []
        );
        queues.current.set(key, queue);
      }
      const id = ++sequence.current;
      queue.add(id, move);
      await utils.patients.list.cancel(queryInput);
      utils.patients.list.setData(queryInput, queue.view());
      return { queryInput, key, id, queue };
    },
    onSuccess: (result, _move, context) => {
      if (!context) return;
      context.queue.settle(context.id, result.positions);
      utils.patients.list.setData(context.queryInput, context.queue.view());
    },
    onError: (error, _move, context) => {
      if (context) {
        context.queue.settle(context.id);
        utils.patients.list.setData(context.queryInput, context.queue.view());
      }
      toast.error(`Could not move patient: ${error.message}`);
    },
    onSettled: (_result, _error, _move, context) => {
      if (context && context.queue.size === 0) {
        queues.current.delete(context.key);
        // Earlier saves must not refetch over a newer gesture that is still queued.
        void utils.patients.list.invalidate(context.queryInput);
      }
    },
  });
}
