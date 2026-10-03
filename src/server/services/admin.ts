import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { COUNTRIES } from "@/core/geo/countries";
import type { CurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import {
  auditLogs,
  complianceCountryRules,
  complianceReviews,
  manufacturers,
  organizations,
  products,
  rfqs,
  supplierVerifications,
  users,
} from "@/server/db/schema";
import { badRequest, forbidden, notFound } from "@/server/errors";
import { audit } from "./audit";
import { notifyOrg } from "./notifications";
import { rfqRef } from "./rfq";

type Session = NonNullable<CurrentUser>;

function assertAdmin(s: Session) {
  if (!s.user.isPlatformAdmin) throw forbidden();
}

export async function listOrganizations() {
  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      kind: organizations.kind,
      country: organizations.country,
      city: organizations.city,
      isSuspended: organizations.isSuspended,
      isDemo: organizations.isDemo,
      createdAt: organizations.createdAt,
      userCount: sql<number>`(select count(*)::int from users u where u.organization_id = "organizations"."id")`,
    })
    .from(organizations)
    .orderBy(organizations.kind, organizations.name);
  const vers = await db.select().from(supplierVerifications).orderBy(desc(supplierVerifications.createdAt));
  return orgs.map((o) => ({ ...o, verifications: vers.filter((v) => v.organizationId === o.id) }));
}

type Level = "BUSINESS_VERIFIED" | "SUPPLIER_VERIFIED" | "AUTHORIZED_DISTRIBUTOR" | "COMPLIANCE_VERIFIED";

/** Records a completed verification. An evidence note is mandatory — no badge without a documented check. */
export async function grantVerification(s: Session, orgId: string, level: Level, evidenceNote: string, ip?: string) {
  assertAdmin(s);
  if (evidenceNote.trim().length < 10) throw badRequest("Describe the evidence reviewed (at least 10 characters).");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org || org.kind !== "SUPPLIER") throw notFound();
  await db.transaction(async (tx) => {
    await tx
      .update(supplierVerifications)
      .set({ state: "APPROVED", reviewedByUserId: s.user.id, reviewedAt: new Date(), evidenceNote: evidenceNote.trim() })
      .where(sql`${supplierVerifications.organizationId} = ${orgId} and ${supplierVerifications.level} = ${level} and ${supplierVerifications.state} = 'PENDING'`);
    const [existing] = await tx
      .select()
      .from(supplierVerifications)
      .where(sql`${supplierVerifications.organizationId} = ${orgId} and ${supplierVerifications.level} = ${level} and ${supplierVerifications.state} = 'APPROVED'`)
      .limit(1);
    if (!existing) {
      await tx.insert(supplierVerifications).values({ organizationId: orgId, level, state: "APPROVED", evidenceNote: evidenceNote.trim(), reviewedByUserId: s.user.id, reviewedAt: new Date() });
    }
    await notifyOrg(tx, orgId, { type: "VERIFICATION", title: "Verification approved", body: `${level.replace(/_/g, " ").toLowerCase()} — approved.`, link: "/account" });
    await audit(tx, { actorUserId: s.user.id, organizationId: orgId, action: "verification.granted", entityType: "organization", entityId: orgId, metadata: { level, evidenceNote }, ip });
  });
}

export async function revokeVerification(s: Session, verificationId: string, reason: string, ip?: string) {
  assertAdmin(s);
  const [v] = await db.select().from(supplierVerifications).where(eq(supplierVerifications.id, verificationId)).limit(1);
  if (!v) throw notFound();
  await db.transaction(async (tx) => {
    await tx.update(supplierVerifications).set({ state: "REVOKED", reviewedByUserId: s.user.id, reviewedAt: new Date() }).where(eq(supplierVerifications.id, verificationId));
    await audit(tx, { actorUserId: s.user.id, organizationId: v.organizationId, action: "verification.revoked", entityType: "organization", entityId: v.organizationId, metadata: { level: v.level, reason }, ip });
  });
}

export async function setSuspended(s: Session, orgId: string, suspended: boolean, ip?: string) {
  assertAdmin(s);
  if (orgId === s.org.id) throw badRequest("You cannot suspend your own organization.");
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ isSuspended: suspended }).where(eq(organizations.id, orgId));
    await audit(tx, { actorUserId: s.user.id, organizationId: orgId, action: suspended ? "organization.suspended" : "organization.reinstated", entityType: "organization", entityId: orgId, ip });
  });
}

export async function complianceQueue() {
  return db
    .select({ review: complianceReviews, refNo: rfqs.refNo, rfqId: rfqs.id, buyer: organizations.name, destination: rfqs.destinationText })
    .from(complianceReviews)
    .innerJoin(rfqs, eq(rfqs.id, complianceReviews.rfqId))
    .innerJoin(organizations, eq(organizations.id, rfqs.buyerOrgId))
    .orderBy(desc(complianceReviews.createdAt))
    .limit(200)
    .then((rows) => rows.map((r) => ({ ...r, ref: rfqRef(r.refNo) })));
}

export async function listCountryRules() {
  return db.select().from(complianceCountryRules).orderBy(complianceCountryRules.country);
}

export async function upsertCountryRule(s: Session, input: { country: string; action: "REVIEW" | "BLOCK"; reason: string; source: string }, ip?: string) {
  assertAdmin(s);
  const country = input.country.toUpperCase();
  if (!(country in COUNTRIES)) throw badRequest("Unknown country code.");
  if (input.source.trim().length < 5) throw badRequest("Cite the official source for this rule.");
  await db.transaction(async (tx) => {
    await tx
      .insert(complianceCountryRules)
      .values({ country, action: input.action, reason: input.reason, source: input.source, updatedByUserId: s.user.id })
      .onConflictDoUpdate({ target: complianceCountryRules.country, set: { action: input.action, reason: input.reason, source: input.source, updatedByUserId: s.user.id, updatedAt: new Date() } });
    await audit(tx, { actorUserId: s.user.id, organizationId: s.org.id, action: "compliance.country_rule_set", entityType: "country_rule", entityId: country, metadata: input, ip });
  });
}

export async function deleteCountryRule(s: Session, country: string, ip?: string) {
  assertAdmin(s);
  await db.transaction(async (tx) => {
    await tx.delete(complianceCountryRules).where(eq(complianceCountryRules.country, country.toUpperCase()));
    await audit(tx, { actorUserId: s.user.id, organizationId: s.org.id, action: "compliance.country_rule_deleted", entityType: "country_rule", entityId: country, ip });
  });
}

export async function recentAudit(limit = 200) {
  return db.select().from(auditLogs).orderBy(desc(auditLogs.seq)).limit(limit);
}

export async function listProducts() {
  return db
    .select({ id: products.id, partNumber: products.partNumber, description: products.description, category: products.category, manufacturer: manufacturers.name, exportControlStatus: products.exportControlStatus, dataStatus: products.dataStatus, isDemo: products.isDemo })
    .from(products)
    .leftJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .orderBy(products.partNumber)
    .limit(500);
}

export async function listAllRfqs() {
  return db
    .select({ id: rfqs.id, refNo: rfqs.refNo, status: rfqs.status, buyer: organizations.name, destination: rfqs.destinationText, createdAt: rfqs.createdAt })
    .from(rfqs)
    .innerJoin(organizations, eq(organizations.id, rfqs.buyerOrgId))
    .orderBy(desc(rfqs.createdAt))
    .limit(300);
}
