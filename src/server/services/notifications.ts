import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/server/db/client";
import { emailOutbox, notifications, users } from "@/server/db/schema";
import { env } from "@/server/env";

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  link?: string;
}

/**
 * Notifies every active user of an organisation: in-app notification + queued e-mail.
 * E-mail delivery is performed by a channel worker (see docs/DEPLOYMENT.md); in development the outbox is the record.
 */
export async function notifyOrg(tx: Tx, organizationId: string, n: NotificationInput) {
  const members = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.isActive, true)));
  if (!members.length) return;
  await tx.insert(notifications).values(members.map((m) => ({ userId: m.id, ...n })));
  await tx.insert(emailOutbox).values(
    members.map((m) => ({
      toEmail: m.email,
      subject: n.title,
      body: `${n.body}${n.link ? `\n\nOpen: ${env.APP_URL}${n.link}` : ""}`,
    })),
  );
}

export async function notifyPlatformAdmins(tx: Tx, n: NotificationInput) {
  const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.isPlatformAdmin, true), eq(users.isActive, true)));
  if (admins.length) await tx.insert(notifications).values(admins.map((a) => ({ userId: a.id, ...n })));
}

export async function listNotifications(userId: string, limit = 30) {
  const items = await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit);
  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return { items, unread };
}

export async function markRead(userId: string, ids?: string[]) {
  const where = ids?.length
    ? and(eq(notifications.userId, userId), inArray(notifications.id, ids), isNull(notifications.readAt))
    : and(eq(notifications.userId, userId), isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: new Date() }).where(where);
}
