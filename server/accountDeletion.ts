import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLog,
  invites,
  magicLinks,
  sessions,
  therapists,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { ENV } from "./_core/env";

/** Delete login credentials atomically while retaining operational history. */
export async function permanentlyDeleteAccount(
  userId: number,
  actorUserId: number
) {
  if (userId === actorUserId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "You cannot permanently delete your own account.",
    });
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async tx => {
    // Recheck the actor inside the write transaction, including concurrent deletions.
    const [actor] = await tx
      .select({
        role: users.role,
        email: users.email,
        deactivatedAt: users.deactivatedAt,
      })
      .from(users)
      .where(eq(users.id, actorUserId))
      .limit(1);
    if (!actor || actor.role !== "admin" || actor.deactivatedAt) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "An active administrator account is required.",
      });
    }
    const [account] = await tx
      .select({ email: users.email, openId: users.openId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!account)
      throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });

    const emails = new Set(
      [
        account.email?.trim().toLowerCase(),
        account.openId.startsWith("email:")
          ? account.openId.slice(6).trim().toLowerCase()
          : undefined,
      ].filter((email): email is string => Boolean(email))
    );
    if (ENV.ownerEmail && emails.has(ENV.ownerEmail.trim().toLowerCase())) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Change the configured owner email before deleting this account.",
      });
    }

    await tx.delete(sessions).where(eq(sessions.userId, userId));
    for (const email of Array.from(emails)) {
      await tx
        .delete(magicLinks)
        .where(sql`lower(trim(${magicLinks.email})) = ${email}`);
      await tx
        .delete(invites)
        .where(sql`lower(trim(${invites.email})) = ${email}`);
    }
    await tx
      .update(therapists)
      .set({ userId: null, updatedAt: new Date() })
      .where(eq(therapists.userId, userId));
    await tx.delete(users).where(eq(users.id, userId));
    // History keeps the original numeric IDs, including encrypted message contexts.
    await tx.insert(auditLog).values({
      actorUserId,
      actorEmail: actor.email,
      action: "user.delete",
      targetType: "user",
      targetId: String(userId),
    });
  });
}
