import "server-only";
import { eq, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { z } from "zod";
import { COUNTRIES } from "@/core/geo/countries";
import { DUMMY_HASH, hashPassword, validatePasswordStrength, verifyPassword } from "@/server/auth/password";
import { createSession, type CurrentUser } from "@/server/auth/session";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/server/auth/totp";
import { db } from "@/server/db/client";
import { organizations, sessions, supplierProfiles, supplierVerifications, users } from "@/server/db/schema";
import { AppError, badRequest, conflict, unauthorized } from "@/server/errors";
import { decrypt, encrypt } from "@/server/security/crypto";
import { rateLimit } from "@/server/security/rate-limit";
import { audit } from "./audit";
import { notifyPlatformAdmins } from "./notifications";

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  organization: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(200),
  country: z.string().trim().toUpperCase().refine((c) => c in COUNTRIES, "Choose a country."),
  mobile: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid mobile number.").optional().or(z.literal("")),
  password: z.string().min(1).max(200),
  accountType: z.enum(["BUYER", "SUPPLIER"]).default("BUYER"),
  supplierType: z
    .enum(["OEM", "MANUFACTURER", "AUTHORIZED_DISTRIBUTOR", "STOCKIST", "DEALER", "MRO", "INDUSTRIAL_SUPPLIER", "LOGISTICS_PROVIDER", "SOURCING_COMPANY"])
    .optional(),
  categories: z.array(z.string().trim().min(2).max(60)).max(30).optional(),
});

export async function register(input: z.infer<typeof registerSchema>, meta: { ip: string; userAgent?: string }) {
  rateLimit(`register:${meta.ip}`, 10, 3600_000);
  const weak = validatePasswordStrength(input.password);
  if (weak) throw badRequest(weak, [{ path: "password", message: weak }]);
  const [exists] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`).limit(1);
  if (exists) throw conflict("An account with this e-mail already exists. Sign in instead.");
  const passwordHash = await hashPassword(input.password);

  const user = await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: input.organization, kind: input.accountType, country: input.country }).returning();
    const [u] = await tx
      .insert(users)
      .values({ organizationId: org.id, name: input.name, email: input.email, mobile: input.mobile || null, country: input.country, passwordHash, role: "ORG_ADMIN" })
      .returning();
    if (input.accountType === "SUPPLIER") {
      await tx.insert(supplierProfiles).values({ organizationId: org.id, supplierType: input.supplierType ?? "INDUSTRIAL_SUPPLIER", categories: input.categories ?? [] });
      // Suppliers receive RFQs only after a platform reviewer approves the business verification.
      await tx.insert(supplierVerifications).values({ organizationId: org.id, level: "BUSINESS_VERIFIED", state: "PENDING" });
      await notifyPlatformAdmins(tx, { type: "SUPPLIER_REGISTERED", title: "New supplier awaiting verification", body: input.organization, link: "/admin/organizations" });
    }
    await audit(tx, { actorUserId: u.id, organizationId: org.id, action: "user.registered", entityType: "user", entityId: u.id, metadata: { accountType: input.accountType }, ip: meta.ip });
    return u;
  });
  await createSession(user.id, { mfaPassed: true, ip: meta.ip, userAgent: meta.userAgent });
  return { userId: user.id };
}

export async function login(email: string, password: string, meta: { ip: string; userAgent?: string }) {
  const normalized = email.trim().toLowerCase();
  rateLimit(`login-ip:${meta.ip}`, 30, 15 * 60_000);
  rateLimit(`login-email:${normalized}`, 8, 15 * 60_000);
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${normalized}`).limit(1);
  // Always run the hash so response time does not reveal whether the e-mail exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.isActive) {
    await db.transaction((tx) => audit(tx, { actorUserId: user?.id ?? null, organizationId: user?.organizationId ?? null, action: "auth.login_failed", entityType: "user", entityId: user?.id ?? null, ip: meta.ip }));
    throw unauthorized("E-mail or password is incorrect.");
  }
  const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
  if (org?.isSuspended) throw new AppError(403, "SUSPENDED", "This organization's access is suspended. Contact support.");
  await createSession(user.id, { mfaPassed: !user.mfaEnabled, ip: meta.ip, userAgent: meta.userAgent });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await db.transaction((tx) => audit(tx, { actorUserId: user.id, organizationId: user.organizationId, action: "auth.login", entityType: "user", entityId: user.id, ip: meta.ip }));
  const home = org?.kind === "SUPPLIER" ? "/supplier" : org?.kind === "PLATFORM" ? "/admin" : "/";
  return { mfaRequired: user.mfaEnabled, home };
}

export async function verifyMfaLogin(session: NonNullable<CurrentUser>, code: string, ip: string) {
  rateLimit(`mfa:${session.user.id}`, 6, 5 * 60_000);
  const [u] = await db.select({ secret: users.mfaSecret }).from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!u?.secret || !verifyTotp(decrypt(u.secret), code)) throw unauthorized("That code is not valid. Try the latest code from your app.");
  await db.update(sessions).set({ mfaPassed: true }).where(eq(sessions.tokenHash, session.tokenHash));
  await db.transaction((tx) => audit(tx, { actorUserId: session.user.id, organizationId: session.org.id, action: "auth.mfa_passed", entityType: "user", entityId: session.user.id, ip }));
}

export async function beginMfaSetup(session: NonNullable<CurrentUser>) {
  if (session.user.mfaEnabled) throw badRequest("Two-factor authentication is already on.");
  const secret = generateTotpSecret();
  await db.update(users).set({ mfaSecret: encrypt(secret) }).where(eq(users.id, session.user.id));
  const url = otpauthUrl(secret, session.user.email);
  return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

export async function confirmMfaSetup(session: NonNullable<CurrentUser>, code: string, ip: string) {
  rateLimit(`mfa-setup:${session.user.id}`, 6, 5 * 60_000);
  const [u] = await db.select({ secret: users.mfaSecret }).from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!u?.secret || !verifyTotp(decrypt(u.secret), code)) throw badRequest("That code is not valid.");
  await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, session.user.id));
  await db.update(sessions).set({ mfaPassed: true }).where(eq(sessions.tokenHash, session.tokenHash));
  await db.transaction((tx) => audit(tx, { actorUserId: session.user.id, organizationId: session.org.id, action: "auth.mfa_enabled", entityType: "user", entityId: session.user.id, ip }));
}
