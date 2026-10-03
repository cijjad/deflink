import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { messages, messageThreads, quotationLines, quotations, rfqLines, rfqRecipients, rfqs } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/errors";
import { audit } from "./audit";
import { notifyOrg } from "./notifications";
import { rfqRef } from "./rfq";

type Session = NonNullable<CurrentUser>;

const CONDITIONS = ["NEW", "NEW_OR_APPROVED_ALTERNATIVE", "ANY", "NEW_SURPLUS", "OVERHAULED", "SERVICEABLE", "REPAIRED", "AS_REMOVED"] as const;
const money = z.coerce.number().nonnegative().max(1e12);

export const quoteSchema = z.object({
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. USD."),
  incoterm: z.string().trim().max(40).optional().nullable(),
  freight: money.optional().nullable(),
  insurance: money.optional().nullable(),
  paymentTerms: z.string().trim().max(200).optional().nullable(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  remarks: z.string().trim().max(2000).optional().nullable(),
  revisionNote: z.string().trim().max(500).optional().nullable(),
  lines: z
    .array(
      z.object({
        rfqLineId: z.string().uuid(),
        unitPrice: money,
        quantity: z.coerce.number().positive().max(1e9),
        availability: z.enum(["IN_STOCK", "FACTORY_ORDER", "PARTIAL"]),
        leadTimeDays: z.coerce.number().int().min(0).max(3650),
        condition: z.enum(CONDITIONS),
        certification: z.string().trim().max(200).optional().nullable(),
        countryOfOrigin: z.string().trim().max(60).optional().nullable(),
        warranty: z.string().trim().max(200).optional().nullable(),
        shipFromCountry: z.string().trim().max(2).optional().nullable(),
        shipFromCity: z.string().trim().max(80).optional().nullable(),
      }),
    )
    .min(1, "Quote at least one line."),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

/** Submit a new quotation, or a new revision that supersedes the previous one. History is kept. */
export async function submitQuotation(session: Session, rfqId: string, input: QuoteInput, ip?: string) {
  return db.transaction(async (tx) => {
    const [rec] = await tx
      .select()
      .from(rfqRecipients)
      .where(and(eq(rfqRecipients.rfqId, rfqId), eq(rfqRecipients.supplierOrgId, session.org.id)))
      .limit(1);
    if (!rec) throw notFound("RFQ not found.");
    const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId)).for("update").limit(1);
    if (!["OPEN", "QUOTED"].includes(rfq.status)) throw badRequest("This RFQ is not accepting quotations.");
    const validLineIds = new Set((await tx.select({ id: rfqLines.id }).from(rfqLines).where(eq(rfqLines.rfqId, rfqId))).map((l) => l.id));
    if (input.lines.some((l) => !validLineIds.has(l.rfqLineId))) throw badRequest("Quotation lines do not match this RFQ.");
    if (new Set(input.lines.map((l) => l.rfqLineId)).size !== input.lines.length) throw badRequest("Each RFQ line can be quoted once per revision.");
    if (input.validUntil && input.validUntil < new Date().toISOString().slice(0, 10)) throw badRequest("Quote validity date is in the past.");

    const [prev] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, session.org.id)))
      .orderBy(desc(quotations.revision))
      .limit(1);
    const revision = (prev?.revision ?? 0) + 1;
    if (prev && !input.revisionNote) throw badRequest("Add a short note explaining what changed in this revision.");
    if (prev) await tx.update(quotations).set({ status: "SUPERSEDED" }).where(and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, session.org.id), eq(quotations.status, "SUBMITTED")));

    const [q] = await tx
      .insert(quotations)
      .values({
        rfqId,
        supplierOrgId: session.org.id,
        submittedByUserId: session.user.id,
        revision,
        currency: input.currency,
        incoterm: input.incoterm ?? null,
        freight: input.freight == null ? null : String(input.freight),
        insurance: input.insurance == null ? null : String(input.insurance),
        paymentTerms: input.paymentTerms ?? null,
        validUntil: input.validUntil ?? null,
        remarks: input.remarks ?? null,
        revisionNote: input.revisionNote ?? null,
        isShortlisted: prev?.isShortlisted ?? false,
      })
      .returning();
    await tx.insert(quotationLines).values(
      input.lines.map((l) => ({
        quotationId: q.id,
        rfqLineId: l.rfqLineId,
        unitPrice: String(l.unitPrice),
        quantity: String(l.quantity),
        availability: l.availability,
        leadTimeDays: l.leadTimeDays,
        condition: l.condition,
        certification: l.certification ?? null,
        countryOfOrigin: l.countryOfOrigin ?? null,
        warranty: l.warranty ?? null,
        shipFromCountry: l.shipFromCountry ? l.shipFromCountry.toUpperCase() : session.org.country,
        shipFromCity: l.shipFromCity ?? session.org.city ?? null,
      })),
    );
    await tx.update(rfqRecipients).set({ status: "QUOTED" }).where(and(eq(rfqRecipients.rfqId, rfqId), eq(rfqRecipients.supplierOrgId, session.org.id)));
    if (rfq.status === "OPEN") await tx.update(rfqs).set({ status: "QUOTED", updatedAt: new Date() }).where(eq(rfqs.id, rfqId));

    const ref = rfqRef(rfq.refNo);
    if (prev) {
      // Revision is recorded in the conversation thread so the negotiation history stays in one place.
      const thread = await ensureThread(tx, rfqId, session.org.id);
      await tx.insert(messages).values({ threadId: thread.id, senderUserId: session.user.id, senderOrgId: session.org.id, body: `Updated quotation (revision ${revision}): ${input.revisionNote}`, quotationId: q.id });
      await tx.update(messageThreads).set({ lastMessageAt: new Date() }).where(eq(messageThreads.id, thread.id));
    }
    await notifyOrg(tx, rfq.buyerOrgId, {
      type: prev ? "QUOTE_UPDATED" : "QUOTE_RECEIVED",
      title: prev ? `Updated quotation for ${ref}` : `Quotation received for ${ref}`,
      body: `${session.org.name} ${prev ? `revised its quotation (revision ${revision})` : "submitted a quotation"}.`,
      link: `/requests/${rfqId}`,
    });
    await audit(tx, { actorUserId: session.user.id, organizationId: session.org.id, action: prev ? "quote.revised" : "quote.submitted", entityType: "quotation", entityId: q.id, metadata: { rfqId, revision }, ip });
    return { quotationId: q.id, revision };
  });
}

/* ------------------------------------------------------------ messaging */

type TxLike = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function ensureThread(tx: TxLike, rfqId: string, supplierOrgId: string) {
  const [existing] = await tx.select().from(messageThreads).where(and(eq(messageThreads.rfqId, rfqId), eq(messageThreads.supplierOrgId, supplierOrgId))).limit(1);
  if (existing) return existing;
  const [created] = await tx.insert(messageThreads).values({ rfqId, supplierOrgId }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await tx.select().from(messageThreads).where(and(eq(messageThreads.rfqId, rfqId), eq(messageThreads.supplierOrgId, supplierOrgId))).limit(1);
  return again;
}

/** Resolves which side the caller is on for an RFQ/supplier pair, or throws not-found. */
async function threadAccess(session: Session, rfqId: string, supplierOrgId: string) {
  const [rfq] = await db.select().from(rfqs).where(eq(rfqs.id, rfqId)).limit(1);
  if (!rfq) throw notFound();
  const [rec] = await db.select().from(rfqRecipients).where(and(eq(rfqRecipients.rfqId, rfqId), eq(rfqRecipients.supplierOrgId, supplierOrgId))).limit(1);
  if (!rec) throw notFound();
  if (session.org.id === rfq.buyerOrgId) return { rfq, side: "BUYER" as const };
  if (session.org.id === supplierOrgId) return { rfq, side: "SUPPLIER" as const };
  throw notFound();
}

export async function postMessage(session: Session, rfqId: string, supplierOrgId: string, body: string, ip?: string) {
  const text = body.trim();
  if (!text) throw badRequest("Message is empty.");
  if (text.length > 4000) throw badRequest("Message is too long (max 4,000 characters).");
  const { rfq, side } = await threadAccess(session, rfqId, supplierOrgId);
  return db.transaction(async (tx) => {
    const thread = await ensureThread(tx, rfqId, supplierOrgId);
    const [msg] = await tx.insert(messages).values({ threadId: thread.id, senderUserId: session.user.id, senderOrgId: session.org.id, body: text }).returning();
    await tx.update(messageThreads).set({ lastMessageAt: new Date() }).where(eq(messageThreads.id, thread.id));
    const ref = rfqRef(rfq.refNo);
    if (side === "BUYER") {
      await notifyOrg(tx, supplierOrgId, { type: "BUYER_QUESTION", title: `Buyer message on ${ref}`, body: text.slice(0, 200), link: `/supplier/rfq/${rfqId}` });
    } else {
      await notifyOrg(tx, rfq.buyerOrgId, { type: "SUPPLIER_MESSAGE", title: `${session.org.name} replied on ${ref}`, body: text.slice(0, 200), link: `/requests/${rfqId}?supplier=${supplierOrgId}` });
    }
    await audit(tx, { actorUserId: session.user.id, organizationId: session.org.id, action: "message.sent", entityType: "rfq", entityId: rfqId, metadata: { supplierOrgId, messageId: msg.id }, ip });
    return msg;
  });
}

/** Messages for a thread. Supplier viewers never see the buyer organisation's name. */
export async function listMessages(session: Session, rfqId: string, supplierOrgId: string) {
  const { side } = await threadAccess(session, rfqId, supplierOrgId);
  const [thread] = await db.select().from(messageThreads).where(and(eq(messageThreads.rfqId, rfqId), eq(messageThreads.supplierOrgId, supplierOrgId))).limit(1);
  if (!thread) return [];
  const rows = await db.select().from(messages).where(eq(messages.threadId, thread.id)).orderBy(messages.createdAt);
  return rows.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt,
    mine: m.senderOrgId === session.org.id,
    fromSupplier: m.senderOrgId === supplierOrgId,
    sender: m.senderOrgId === supplierOrgId ? (side === "BUYER" ? "Supplier" : "You") : side === "BUYER" ? "You" : "Buyer",
    quotationId: m.quotationId,
  }));
}

export async function threadsForOrg(session: Session) {
  if (session.org.kind === "SUPPLIER") {
    return db
      .select({ rfqId: messageThreads.rfqId, supplierOrgId: messageThreads.supplierOrgId, lastMessageAt: messageThreads.lastMessageAt, refNo: rfqs.refNo })
      .from(messageThreads)
      .innerJoin(rfqs, eq(rfqs.id, messageThreads.rfqId))
      .where(eq(messageThreads.supplierOrgId, session.org.id))
      .orderBy(desc(messageThreads.lastMessageAt));
  }
  const own = await db.select({ id: rfqs.id }).from(rfqs).where(eq(rfqs.buyerOrgId, session.org.id));
  if (!own.length) return [];
  return db
    .select({ rfqId: messageThreads.rfqId, supplierOrgId: messageThreads.supplierOrgId, lastMessageAt: messageThreads.lastMessageAt, refNo: rfqs.refNo })
    .from(messageThreads)
    .innerJoin(rfqs, eq(rfqs.id, messageThreads.rfqId))
    .where(inArray(messageThreads.rfqId, own.map((r) => r.id)))
    .orderBy(desc(messageThreads.lastMessageAt));
}
