import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type { User } from "../../drizzle/schema";
import { notifyDataChanged, shouldNotify } from "../liveUpdates";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // Default tRPC error shape includes `data.stack` -- a full server-side stack trace (absolute
  // file paths, library internals) handed to any caller, including unauthenticated ones, on
  // every validation/runtime error. Strip it; log it server-side instead.
  errorFormatter({ shape, error }) {
    console.error(`[tRPC] ${error.code}:`, error.stack ?? error.message);
    return {
      ...shape,
      data: {
        ...shape.data,
        stack: undefined,
      },
    };
  },
});

export const router = t.router;

// After a successful save, tell open browsers to refresh.
const notifyOnChange = t.middleware(async ({ type, path, next }) => {
  const result = await next();
  if (type === "mutation" && result.ok && shouldNotify(path)) notifyDataChanged();
  return result;
});

const baseProcedure = t.procedure.use(notifyOnChange);

export const publicProcedure = baseProcedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/** Any logged-in user, any role (includes viewers) -- read access. */
export const protectedProcedure = baseProcedure.use(requireUser);

function requireRole(allowed: Array<User["role"]>) {
  return t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || !allowed.includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  });
}

/** Admin, Team Lead, or staff. Resource-level ownership is enforced inside each procedure. */
export const staffProcedure = baseProcedure.use(requireRole(["admin", "team_lead", "staff"]));

/** Admins and Team Leads can manage schedules across all teams. */
export const schedulerProcedure = baseProcedure.use(requireRole(["admin", "team_lead"]));

/** Admin only -- destructive/config actions (deletes, user management, settings). */
export const adminProcedure = baseProcedure.use(requireRole(["admin"]));
