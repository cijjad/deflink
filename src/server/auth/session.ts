import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/server/db/client";
import { organizations, sessions, users } from "@/server/db/schema";
import { env } from "@/server/env";
import { forbidden, unauthorized } from "@/server/errors";
import { can, type Permission } from "./rbac";

export const SESSION_COOKIE = "dl_session";
export const ANON_COOKIE = "dl_anon";
const ABSOLUTE_MS = 7 * 24 * 3600 * 1000;
const IDLE_MS = 12 * 3600 * 1000;

const secureCookies = env.NODE_ENV === "production" || env.APP_URL.startsWith("https://");

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function createSession(userId: string, opts: { mfaPassed: boolean; ip?: string; userAgent?: string }) {
  const token = randomToken();
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    mfaPassed: opts.mfaPassed,
    expiresAt: new Date(Date.now() + ABSOLUTE_MS),
    ip: opts.ip,
    userAgent: opts.userAgent?.slice(0, 300),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: ABSOLUTE_MS / 1000,
  });
  return token;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

export type CurrentUser = Awaited<ReturnType<typeof loadSession>>;

async function loadSession(token: string) {
  const now = new Date();
  const rows = await db
    .select({ session: sessions, user: users, org: organizations })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (now.getTime() - row.session.lastSeenAt.getTime() > IDLE_MS) {
    await db.delete(sessions).where(eq(sessions.tokenHash, row.session.tokenHash));
    return null;
  }
  if (!row.user.isActive || row.org.isSuspended) return null;
  // Slide the idle window at most once a minute.
  if (now.getTime() - row.session.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, row.session.tokenHash));
  }
  const { passwordHash: _ph, mfaSecret: _ms, ...safeUser } = row.user;
  return { user: safeUser, org: row.org, mfaPassed: row.session.mfaPassed, tokenHash: row.session.tokenHash };
}

/** The signed-in user, or null. Sessions awaiting an MFA code are treated as signed out. */
export async function getCurrentUser(opts: { allowMfaPending?: boolean } = {}) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await loadSession(token);
  if (!s) return null;
  if (s.user.mfaEnabled && !s.mfaPassed && !opts.allowMfaPending) return null;
  return s;
}

export async function requireUser() {
  const s = await getCurrentUser();
  if (!s) throw unauthorized();
  return s;
}

export async function requirePermission(permission: Permission) {
  const s = await requireUser();
  if (!can(s.user.role, permission)) throw forbidden();
  return s;
}

export async function requireBuyer(permission: Permission = "rfq.view") {
  const s = await requirePermission(permission);
  if (s.org.kind !== "BUYER") throw forbidden("This area is for buyer organizations.");
  return s;
}

export async function requireSupplier(permission: Permission = "rfq.view") {
  const s = await requirePermission(permission);
  if (s.org.kind !== "SUPPLIER") throw forbidden("This area is for supplier organizations.");
  return s;
}

export async function requirePlatformAdmin() {
  const s = await requireUser();
  if (!s.user.isPlatformAdmin) throw forbidden();
  return s;
}

/** Anonymous visitor token so people can search and converse before registering. */
export async function getAnonToken(create: boolean): Promise<string | null> {
  const jar = await cookies();
  let token = jar.get(ANON_COOKIE)?.value ?? null;
  if (!token && create) {
    token = randomToken();
    jar.set(ANON_COOKIE, token, { httpOnly: true, secure: secureCookies, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 });
  }
  return token;
}

export async function purgeExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
