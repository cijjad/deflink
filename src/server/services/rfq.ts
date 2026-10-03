import "server-only";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { destinationLabel, lineLabel, missingFields } from "@/core/conversation/engine";
import { formatQuantity } from "@/core/conversation/parser";
import type { ConversationState } from "@/core/conversation/types";
import { countryName } from "@/core/geo/countries";
import type { CurrentUser } from "@/server/auth/session";
import { db, type Tx } from "@/server/db/client";
import {
  complianceCountryRules,
  complianceReviews,
  conversations,
  inventoryListings,
  messageThreads,
  organizations,
  products,
  quotationLines,
  quotations,
  rfqLines,
  rfqRecipients,
  rfqs,
  supplierOemRelationships,
  supplierProfiles,
  supplierVerifications,
} from "@/server/db/schema";
import { AppError, badRequest, forbidden, notFound } from "@/server/errors";
import { audit } from "./audit";
import { getConversation, markConversationSubmitted, type Owner } from "./conversation";
import { notifyOrg, notifyPlatformAdmins } from "./notifications";

type Session = NonNullable<CurrentUser>;

export const rfqRef = (refNo: number) => `RFQ-${refNo}`;
const MAX_RECIPIENTS = 15;

/* --------------------------------------------------------- compliance */

export interface ComplianceOutcome {
  action: "PROCEED" | "REVIEW" | "BLOCK";
  reasons: string[];
}

export async function evaluateCompliance(state: ConversationState): Promise<ComplianceOutcome> {
  const reasons: string[] = [];
  let action: ComplianceOutcome["action"] = "PROCEED";
  const country = state.destination?.country;
  if (country) {
    const [rule] = await db.select().from(complianceCountryRules).where(eq(complianceCountryRules.country, country)).limit(1);
    if (rule?.action === "BLOCK") return { action: "BLOCK", reasons: [`Destination ${countryName(country)}: ${rule.reason}`] };
    if (rule?.action === "REVIEW") {
      action = "REVIEW";
      reasons.push(`Destination ${countryName(country)} requires review: ${rule.reason} (source: ${rule.source})`);
    }
  }
  const productIds = state.lines.map((l) => l.productId).filter((x): x is string => Boolean(x));
  if (productIds.length) {
    const controlled = await db
      .select({ pn: products.partNumber, cls: products.controlClassification })
      .from(products)
      .where(and(inArray(products.id, productIds), eq(products.exportControlStatus, "CONTROLLED")));
    for (const c of controlled) {
      action = "REVIEW";
      reasons.push(`${c.pn} is recorded as export-controlled${c.cls ? ` (${c.cls})` : ""}. End-user and end-use documentation may be required.`);
    }
  }
  if (action === "REVIEW" && !country) reasons.push("Destination country could not be resolved.");
  return { action, reasons };
}

/* ----------------------------------------------------- supplier match */

interface Match {
  orgId: string;
  reasons: string[];
  score: number;
}

/** Suppliers eligible to receive an RFQ: not suspended, with an approved and unexpired business verification. */
async function eligibleSupplierIds(tx: Tx, requireCompliance: boolean): Promise<Set<string>> {
  const levels = requireCompliance ? (["COMPLIANCE_VERIFIED"] as const) : (["BUSINESS_VERIFIED"] as const);
  const rows = await tx
    .select({ orgId: supplierVerifications.organizationId })
    .from(supplierVerifications)
    .innerJoin(organizations, eq(organizations.id, supplierVerifications.organizationId))
    .where(
      and(
        inArray(supplierVerifications.level, [...levels]),
        eq(supplierVerifications.state, "APPROVED"),
        or(isNull(supplierVerifications.expiresAt), gt(supplierVerifications.expiresAt, new Date())),
        eq(organizations.kind, "SUPPLIER"),
        eq(organizations.isSuspended, false),
      ),
    );
  return new Set(rows.map((r) => r.orgId));
}

export async function matchSuppliers(tx: Tx, lines: (typeof rfqLines.$inferSelect)[], controlled: boolean): Promise<Match[]> {
  const eligible = await eligibleSupplierIds(tx, controlled);
  const matches = new Map<string, Match>();
  const add = (orgId: string, reason: string, score: number) => {
    if (!eligible.has(orgId)) return;
    const m = matches.get(orgId) ?? { orgId, reasons: [], score: 0 };
    if (!m.reasons.includes(reason)) m.reasons.push(reason);
    m.score += score;
    matches.set(orgId, m);
  };

  const productIds = lines.map((l) => l.productId).filter((x): x is string => Boolean(x));
  if (productIds.length) {
    const listings = await tx
      .select({ orgId: inventoryListings.supplierOrgId, pn: products.partNumber, qty: inventoryListings.quantityAvailable })
      .from(inventoryListings)
      .innerJoin(products, eq(products.id, inventoryListings.productId))
      .where(inArray(inventoryListings.productId, productIds));
    for (const l of listings) add(l.orgId, `Lists ${l.pn}`, (l.qty ?? 0) > 0 ? 10 : 6);

    const oem = await tx
      .select({ orgId: supplierOemRelationships.supplierOrgId, pn: products.partNumber })
      .from(products)
      .innerJoin(supplierOemRelationships, eq(supplierOemRelationships.manufacturerId, products.manufacturerId))
      .where(inArray(products.id, productIds));
    for (const o of oem) add(o.orgId, `OEM relationship for ${o.pn}`, 5);
  }

  const categories = [...new Set(lines.map((l) => l.category).filter((c): c is string => Boolean(c)))];
  if (categories.length) {
    const profiles = await tx.select({ orgId: supplierProfiles.organizationId, categories: supplierProfiles.categories }).from(supplierProfiles);
    for (const p of profiles) {
      for (const c of categories) {
        if (p.categories.some((pc) => pc.toLowerCase() === c.toLowerCase() || (c === "Hydraulic Pump" && pc === "Pump"))) add(p.orgId, `Supplies ${c}`, 2);
      }
    }
  }
  return [...matches.values()].sort((a, b) => b.score - a.score).slice(0, MAX_RECIPIENTS);
}

async function distribute(tx: Tx, rfqId: string, actorUserId: string | null, ip?: string) {
  const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId)).limit(1);
  const lines = await tx.select().from(rfqLines).where(eq(rfqLines.rfqId, rfqId));
  const productIds = lines.map((l) => l.productId).filter((x): x is string => Boolean(x));
  const controlled =
    productIds.length > 0 &&
    (await tx.select({ id: products.id }).from(products).where(and(inArray(products.id, productIds), eq(products.exportControlStatus, "CONTROLLED")))).length > 0;
  const matches = await matchSuppliers(tx, lines, controlled);
  const ref = rfqRef(rfq.refNo);
  const summary = lines.map((l) => `${formatQuantity(Number(l.quantity), l.unit)} × ${l.partNumber ?? l.description}`).join(", ");
  if (matches.length) {
    await tx.insert(rfqRecipients).values(matches.map((m) => ({ rfqId, supplierOrgId: m.orgId, matchReason: m.reasons.join("; ") })));
    for (const m of matches) {
      await notifyOrg(tx, m.orgId, {
        type: "RFQ_RECEIVED",
        title: `New RFQ ${ref}`,
        body: `${summary}. Destination: ${rfq.destinationCountry ? countryName(rfq.destinationCountry) : rfq.destinationText ?? "not specified"}.`,
        link: `/supplier/rfq/${rfqId}`,
      });
    }
  } else {
    await notifyPlatformAdmins(tx, { type: "RFQ_UNMATCHED", title: `${ref} has no matching supplier`, body: summary, link: `/admin/rfqs` });
  }
  await audit(tx, { actorUserId, organizationId: rfq.buyerOrgId, action: "rfq.distributed", entityType: "rfq", entityId: rfqId, metadata: { recipients: matches.map((m) => m.orgId), controlled }, ip });
  return matches.length;
}

/* ------------------------------------------------------------- create */

export async function createRfqFromConversation(session: Session, conversationId: string, owner: Owner, ip?: string) {
  if (session.org.kind !== "BUYER") throw forbidden("Only buyer organizations can request quotations.");
  const conv = await getConversation(conversationId, owner);
  if (!conv) throw notFound("Requirement not found.");
  const state = conv.state;
  if (conv.rfqId) {
    const [existing] = await db.select().from(rfqs).where(and(eq(rfqs.id, conv.rfqId), eq(rfqs.buyerOrgId, session.org.id))).limit(1);
    if (existing) return { rfqId: existing.id, ref: rfqRef(existing.refNo), status: existing.status, recipients: 0, existing: true };
  }
  const missing = missingFields(state);
  if (missing.length) throw new AppError(422, "INCOMPLETE", `Still needed: ${missing.join(", ")}.`, { missing });

  const compliance = await evaluateCompliance(state);
  if (compliance.action === "BLOCK") {
    throw new AppError(403, "COMPLIANCE_BLOCKED", `This request cannot be processed. ${compliance.reasons.join(" ")}`);
  }

  const result = await db.transaction(async (tx) => {
    const status = compliance.action === "REVIEW" ? "COMPLIANCE_REVIEW" : "OPEN";
    const [rfq] = await tx
      .insert(rfqs)
      .values({
        buyerOrgId: session.org.id,
        createdByUserId: session.user.id,
        status,
        destinationCity: state.destination?.city ?? null,
        destinationCountry: state.destination?.country ?? null,
        destinationText: state.destination ? destinationLabel(state.destination) : null,
        requiredBy: state.requiredBy ?? null,
        notes: [state.notes, state.certification ? `Certification required: ${state.certification}` : null, state.requiredByText && !state.requiredBy ? `Required: ${state.requiredByText}` : null]
          .filter(Boolean)
          .join("\n") || null,
        complianceReason: compliance.reasons.join("\n") || null,
        sourceConversationId: conversationId,
      })
      .returning();
    const lines = await tx
      .insert(rfqLines)
      .values(
        state.lines.map((l, i) => ({
          rfqId: rfq.id,
          lineNo: i + 1,
          productId: l.productId ?? null,
          partNumber: l.partNumber ?? null,
          manufacturerName: l.manufacturer ?? null,
          description: l.description ?? l.category ?? lineLabel(l),
          category: l.category ?? null,
          quantity: String(l.quantity),
          unit: l.unit ?? "EA",
          quantityText: l.quantityText ?? null,
          quantityApproximate: Boolean(l.approximate),
          condition: state.condition ?? "NEW",
          certificationRequired: state.certification ?? null,
          identification: l.identification === "PENDING" ? "NOT_IDENTIFIED" : l.identification,
        })),
      )
      .returning();
    await audit(tx, {
      actorUserId: session.user.id,
      organizationId: session.org.id,
      action: "rfq.created",
      entityType: "rfq",
      entityId: rfq.id,
      metadata: { ref: rfqRef(rfq.refNo), lines: lines.length, status },
      ip,
    });
    let recipients = 0;
    if (status === "COMPLIANCE_REVIEW") {
      await tx.insert(complianceReviews).values({ rfqId: rfq.id, reasons: compliance.reasons });
      await notifyPlatformAdmins(tx, { type: "COMPLIANCE_REVIEW", title: `${rfqRef(rfq.refNo)} needs compliance review`, body: compliance.reasons.join(" "), link: `/admin/compliance` });
      await notifyOrg(tx, session.org.id, { type: "COMPLIANCE_REVIEW", title: `${rfqRef(rfq.refNo)} is in compliance review`, body: "Suppliers will receive it once the review is complete.", link: `/requests/${rfq.id}` });
    } else {
      recipients = await distribute(tx, rfq.id, session.user.id, ip);
    }
    return { rfqId: rfq.id, ref: rfqRef(rfq.refNo), status, recipients, existing: false };
  });
  await markConversationSubmitted(conversationId, result.rfqId, result.ref);
  return result;
}

/* --------------------------------------------------------- compliance */

export async function decideCompliance(session: Session, reviewId: string, decision: "APPROVED" | "REJECTED", notes: string, ip?: string) {
  if (!session.user.isPlatformAdmin) throw forbidden();
  return db.transaction(async (tx) => {
    const [review] = await tx.select().from(complianceReviews).where(eq(complianceReviews.id, reviewId)).for("update").limit(1);
    if (!review) throw notFound();
    if (review.decision !== "PENDING") throw badRequest("This review has already been decided.");
    await tx.update(complianceReviews).set({ decision, notes, reviewerUserId: session.user.id, decidedAt: new Date() }).where(eq(complianceReviews.id, reviewId));
    const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, review.rfqId)).limit(1);
    await audit(tx, { actorUserId: session.user.id, organizationId: rfq.buyerOrgId, action: `compliance.${decision.toLowerCase()}`, entityType: "rfq", entityId: rfq.id, metadata: { reviewId, notes }, ip });
    if (decision === "APPROVED") {
      await tx.update(rfqs).set({ status: "OPEN", updatedAt: new Date() }).where(eq(rfqs.id, rfq.id));
      const n = await distribute(tx, rfq.id, session.user.id, ip);
      await notifyOrg(tx, rfq.buyerOrgId, { type: "COMPLIANCE_APPROVED", title: `${rfqRef(rfq.refNo)} approved`, body: `Compliance review completed. Sent to ${n} supplier${n === 1 ? "" : "s"}.`, link: `/requests/${rfq.id}` });
    } else {
      await tx.update(rfqs).set({ status: "REJECTED", updatedAt: new Date() }).where(eq(rfqs.id, rfq.id));
      await notifyOrg(tx, rfq.buyerOrgId, { type: "COMPLIANCE_REJECTED", title: `${rfqRef(rfq.refNo)} not approved`, body: notes || "The compliance review did not approve this request.", link: `/requests/${rfq.id}` });
    }
  });
}

/* ----------------------------------------------------------- buyer read */

export async function listBuyerRfqs(orgId: string) {
  return db
    .select({
      id: rfqs.id,
      refNo: rfqs.refNo,
      status: rfqs.status,
      createdAt: rfqs.createdAt,
      destinationText: rfqs.destinationText,
      // Correlated subqueries are written with explicit aliases: Drizzle renders bare column names here.
      lineCount: sql<number>`(select count(*)::int from rfq_lines rl where rl.rfq_id = "rfqs"."id")`,
      firstLine: sql<string>`(select coalesce(rl.part_number, rl.description) from rfq_lines rl where rl.rfq_id = "rfqs"."id" order by rl.line_no limit 1)`,
      firstQty: sql<string>`(select rl.quantity::text || ' ' || rl.unit from rfq_lines rl where rl.rfq_id = "rfqs"."id" order by rl.line_no limit 1)`,
      recipientCount: sql<number>`(select count(*)::int from rfq_recipients rr where rr.rfq_id = "rfqs"."id")`,
      quoteCount: sql<number>`(select count(distinct q.supplier_org_id)::int from quotations q where q.rfq_id = "rfqs"."id" and q.status = 'SUBMITTED')`,
    })
    .from(rfqs)
    .where(eq(rfqs.buyerOrgId, orgId))
    .orderBy(desc(rfqs.createdAt))
    .limit(100);
}

async function loadQuotes(rfqId: string, supplierOrgId?: string) {
  const where = supplierOrgId ? and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, supplierOrgId)) : eq(quotations.rfqId, rfqId);
  const qs = await db
    .select({ q: quotations, supplierName: organizations.name, supplierCountry: organizations.country, supplierCity: organizations.city })
    .from(quotations)
    .innerJoin(organizations, eq(organizations.id, quotations.supplierOrgId))
    .where(where)
    .orderBy(desc(quotations.revision));
  const ids = qs.map((x) => x.q.id);
  const lines = ids.length ? await db.select().from(quotationLines).where(inArray(quotationLines.quotationId, ids)) : [];
  return qs.map((x) => ({
    ...x.q,
    supplierName: x.supplierName,
    supplierCountry: x.supplierCountry,
    supplierCity: x.supplierCity,
    lines: lines.filter((l) => l.quotationId === x.q.id),
  }));
}

export type QuoteView = Awaited<ReturnType<typeof loadQuotes>>[number];

export async function getBuyerRfq(orgId: string, rfqId: string) {
  const [rfq] = await db.select().from(rfqs).where(and(eq(rfqs.id, rfqId), eq(rfqs.buyerOrgId, orgId))).limit(1);
  if (!rfq) return null;
  const lines = await db.select().from(rfqLines).where(eq(rfqLines.rfqId, rfqId)).orderBy(rfqLines.lineNo);
  const recipients = await db
    .select({ orgId: rfqRecipients.supplierOrgId, status: rfqRecipients.status, name: organizations.name, country: organizations.country, matchReason: rfqRecipients.matchReason, sentAt: rfqRecipients.sentAt })
    .from(rfqRecipients)
    .innerJoin(organizations, eq(organizations.id, rfqRecipients.supplierOrgId))
    .where(eq(rfqRecipients.rfqId, rfqId));
  const quotes = await loadQuotes(rfqId);
  const threads = await db.select().from(messageThreads).where(eq(messageThreads.rfqId, rfqId));
  const reviews = await db.select().from(complianceReviews).where(eq(complianceReviews.rfqId, rfqId)).orderBy(desc(complianceReviews.createdAt));
  return { rfq, ref: rfqRef(rfq.refNo), lines, recipients, quotes, threads, reviews };
}

export async function setShortlist(session: Session, quotationId: string, shortlisted: boolean, ip?: string) {
  const [row] = await db
    .select({ q: quotations, buyerOrgId: rfqs.buyerOrgId })
    .from(quotations)
    .innerJoin(rfqs, eq(rfqs.id, quotations.rfqId))
    .where(eq(quotations.id, quotationId))
    .limit(1);
  if (!row || row.buyerOrgId !== session.org.id) throw notFound();
  await db.transaction(async (tx) => {
    await tx.update(quotations).set({ isShortlisted: shortlisted }).where(eq(quotations.id, quotationId));
    await audit(tx, { actorUserId: session.user.id, organizationId: session.org.id, action: shortlisted ? "quote.shortlisted" : "quote.unshortlisted", entityType: "quotation", entityId: quotationId, ip });
  });
}

/* -------------------------------------------------------- supplier read */

export async function listSupplierRfqs(supplierOrgId: string) {
  return db
    .select({
      id: rfqs.id,
      refNo: rfqs.refNo,
      status: rfqs.status,
      destinationCountry: rfqs.destinationCountry,
      destinationCity: rfqs.destinationCity,
      createdAt: rfqs.createdAt,
      recipientStatus: rfqRecipients.status,
      lineCount: sql<number>`(select count(*)::int from rfq_lines rl where rl.rfq_id = "rfqs"."id")`,
      firstLine: sql<string>`(select coalesce(rl.part_number, rl.description) from rfq_lines rl where rl.rfq_id = "rfqs"."id" order by rl.line_no limit 1)`,
      firstQty: sql<string>`(select rl.quantity::text || ' ' || rl.unit from rfq_lines rl where rl.rfq_id = "rfqs"."id" order by rl.line_no limit 1)`,
    })
    .from(rfqRecipients)
    .innerJoin(rfqs, eq(rfqs.id, rfqRecipients.rfqId))
    .where(eq(rfqRecipients.supplierOrgId, supplierOrgId))
    .orderBy(desc(rfqRecipients.sentAt))
    .limit(100);
}

/** Supplier view of an RFQ. The buyer's identity is withheld; only its country is shown. */
export async function getSupplierRfq(supplierOrgId: string, rfqId: string) {
  const [rec] = await db
    .select()
    .from(rfqRecipients)
    .where(and(eq(rfqRecipients.rfqId, rfqId), eq(rfqRecipients.supplierOrgId, supplierOrgId)))
    .limit(1);
  if (!rec) return null;
  const [rfq] = await db.select().from(rfqs).where(eq(rfqs.id, rfqId)).limit(1);
  const [buyer] = await db.select({ country: organizations.country }).from(organizations).where(eq(organizations.id, rfq.buyerOrgId)).limit(1);
  if (!rec.viewedAt) {
    await db
      .update(rfqRecipients)
      .set({ viewedAt: new Date(), status: rec.status === "SENT" ? "VIEWED" : rec.status })
      .where(and(eq(rfqRecipients.rfqId, rfqId), eq(rfqRecipients.supplierOrgId, supplierOrgId)));
  }
  const lines = await db.select().from(rfqLines).where(eq(rfqLines.rfqId, rfqId)).orderBy(rfqLines.lineNo);
  const quotes = await loadQuotes(rfqId, supplierOrgId);
  const [thread] = await db.select().from(messageThreads).where(and(eq(messageThreads.rfqId, rfqId), eq(messageThreads.supplierOrgId, supplierOrgId))).limit(1);
  return {
    rfq: {
      id: rfq.id,
      ref: rfqRef(rfq.refNo),
      status: rfq.status,
      destinationCity: rfq.destinationCity,
      destinationCountry: rfq.destinationCountry,
      destinationText: rfq.destinationText,
      requiredBy: rfq.requiredBy,
      notes: rfq.notes,
      createdAt: rfq.createdAt,
    },
    buyer: { label: `Buyer organization · ${countryName(buyer?.country)}` },
    matchReason: rec.matchReason,
    recipientStatus: rec.status,
    lines,
    quotes,
    threadId: thread?.id ?? null,
  };
}

/** Used by conversation views to show the RFQ after submission. */
export async function rfqIdForConversation(conversationId: string) {
  const [c] = await db.select({ rfqId: conversations.rfqId }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  return c?.rfqId ?? null;
}
