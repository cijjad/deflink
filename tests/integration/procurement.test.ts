import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { auditLogs, organizations, users } from "@/server/db/schema";
import { verifyAuditChain } from "@/server/services/audit";
import { chatTurn } from "@/server/services/conversation";
import { listMessages, postMessage, submitQuotation } from "@/server/services/quotation";
import { createRfqFromConversation, decideCompliance, getBuyerRfq, getSupplierRfq, listBuyerRfqs, listSupplierRfqs } from "@/server/services/rfq";
import { productSources, searchPartNumber } from "@/server/services/search";
import { upsertCountryRule } from "@/server/services/admin";

type Session = Parameters<typeof createRfqFromConversation>[0];

async function sessionFor(email: string): Promise<Session> {
  const [row] = await db.select({ user: users, org: organizations }).from(users).innerJoin(organizations, eq(organizations.id, users.organizationId)).where(eq(users.email, email));
  return { user: row.user, org: row.org, mfaPassed: true, tokenHash: "test" } as unknown as Session;
}

async function readyConversation(owner: { userId: string }, text = "I need 25 units of Part ABC123.", dest = "Islamabad, Pakistan.") {
  let r = await chatTurn({ text }, owner);
  r = await chatTurn({ conversationId: r.conversationId, action: { type: "SET_CONDITION", value: "NEW" } }, owner);
  r = await chatTurn({ conversationId: r.conversationId, text: dest }, owner);
  expect(r.ready).toBe(true);
  return r.conversationId;
}

let buyer: Session, buyer2: Session, alpha: Session, golf: Session, admin: Session, bravo: Session;

beforeAll(async () => {
  [buyer, buyer2, alpha, golf, admin, bravo] = await Promise.all(
    ["buyer@demo.test", "buyer2@demo.test", "alpha@supplier.demo.test", "golf@supplier.demo.test", "admin@deflink.test", "bravo@supplier.demo.test"].map(sessionFor),
  );
});

describe("sources", () => {
  it("never present unverified suppliers as sources", async () => {
    const res = await searchPartNumber("ABC123");
    const sources = await productSources(res.exact[0].productId);
    expect(sources.map((s) => s.supplierName)).not.toContain("Golf Demo Sourcing Co");
    expect(res.exact[0].sourceCount).toBe(sources.length);
    for (const s of sources) expect(s.verifications).toContain("BUSINESS_VERIFIED");
  });
});

describe("RFQ lifecycle", () => {
  let rfqId: string;

  it("creates an RFQ and routes it only to eligible suppliers", async () => {
    const conv = await readyConversation({ userId: buyer.user.id });
    const r = await createRfqFromConversation(buyer, conv, { userId: buyer.user.id });
    expect(r.status).toBe("OPEN");
    expect(r.recipients).toBeGreaterThan(0);
    rfqId = r.rfqId;
    const detail = await getBuyerRfq(buyer.org.id, rfqId);
    const names = detail!.recipients.map((x) => x.name);
    expect(names).toContain("Alpha Demo Industrial Supply LLC");
    expect(names).not.toContain("Golf Demo Sourcing Co"); // pending verification
    // Idempotent: pressing GET QUOTES twice does not create a second RFQ.
    const again = await createRfqFromConversation(buyer, conv, { userId: buyer.user.id });
    expect(again.rfqId).toBe(rfqId);
  });

  it("isolates organisations", async () => {
    expect(await getBuyerRfq(buyer2.org.id, rfqId)).toBeNull();
    expect(await getSupplierRfq(golf.org.id, rfqId)).toBeNull();
    await expect(postMessage(buyer2, rfqId, alpha.org.id, "hello")).rejects.toThrow();
    await expect(submitQuotation(golf, rfqId, { currency: "USD", lines: [] } as never)).rejects.toThrow();
  });

  it("hides the buyer's identity from suppliers", async () => {
    const view = await getSupplierRfq(alpha.org.id, rfqId);
    expect(view!.buyer.label).toBe("Buyer organization · Pakistan");
    expect(JSON.stringify(view)).not.toContain("Demo Buyer Organization");
  });

  it("accepts quotes, revisions with history, and messages", async () => {
    const view = await getSupplierRfq(alpha.org.id, rfqId);
    const line = view!.lines[0];
    const base = { currency: "USD", validUntil: "2099-01-01", lines: [{ rfqLineId: line.id, unitPrice: 4700, quantity: 25, availability: "IN_STOCK" as const, leadTimeDays: 7, condition: "NEW" as const }] };
    const q1 = await submitQuotation(alpha, rfqId, base);
    expect(q1.revision).toBe(1);
    await expect(submitQuotation(alpha, rfqId, base)).rejects.toThrow(/note/); // revision needs a note
    const q2 = await submitQuotation(alpha, rfqId, { ...base, revisionNote: "Volume price", lines: [{ ...base.lines[0], unitPrice: 4600 }] });
    expect(q2.revision).toBe(2);
    const bView = await getSupplierRfq(bravo.org.id, rfqId);
    await submitQuotation(bravo, rfqId, { ...base, lines: [{ ...base.lines[0], rfqLineId: bView!.lines[0].id, unitPrice: 4850 }] });

    const detail = await getBuyerRfq(buyer.org.id, rfqId);
    const alphaQuotes = detail!.quotes.filter((q) => q.supplierOrgId === alpha.org.id);
    expect(alphaQuotes.map((q) => [q.revision, q.status])).toEqual([
      [2, "SUBMITTED"],
      [1, "SUPERSEDED"],
    ]);

    await postMessage(buyer, rfqId, alpha.org.id, "Can you supply 100?");
    await postMessage(alpha, rfqId, alpha.org.id, "Yes.");
    const msgs = await listMessages(buyer, rfqId, alpha.org.id);
    expect(msgs.map((m) => m.body)).toEqual(expect.arrayContaining(["Can you supply 100?", "Yes.", "Updated quotation (revision 2): Volume price"]));
    expect((await listMessages(alpha, rfqId, alpha.org.id)).find((m) => m.body === "Can you supply 100?")?.sender).toBe("Buyer");
  });

  it("lists with correct counts", async () => {
    const list = await listBuyerRfqs(buyer.org.id);
    const row = list.find((r) => r.id === rfqId)!;
    expect(row).toMatchObject({ lineCount: 1, firstLine: "ABC123", quoteCount: 2, status: "QUOTED" });
    expect(row.recipientCount).toBeGreaterThan(1);
    const sup = await listSupplierRfqs(alpha.org.id);
    expect(sup.find((r) => r.id === rfqId)).toMatchObject({ lineCount: 1, firstLine: "ABC123", recipientStatus: "QUOTED" });
  });
});

describe("compliance", () => {
  it("routes controlled items to review and distributes only after approval", async () => {
    const conv = await readyConversation({ userId: buyer.user.id }, "I need 2 units of CTRL-900");
    const r = await createRfqFromConversation(buyer, conv, { userId: buyer.user.id });
    expect(r.status).toBe("COMPLIANCE_REVIEW");
    expect(r.recipients).toBe(0);
    const [review] = await db.execute<{ id: string }>(sql`select id from compliance_reviews where rfq_id = ${r.rfqId}`).then((x) => x.rows);
    await expect(decideCompliance(buyer, review.id, "APPROVED", "ok")).rejects.toThrow();
    await decideCompliance(admin, review.id, "APPROVED", "End-user certificate reviewed (test)");
    const detail = await getBuyerRfq(buyer.org.id, r.rfqId);
    expect(detail!.rfq.status).toBe("OPEN");
    // Controlled items go only to suppliers with COMPLIANCE_VERIFIED.
    for (const rec of detail!.recipients) expect(rec.name).toBe("Foxtrot Demo Bearings Inc");
  });

  it("blocks destinations with a BLOCK rule", async () => {
    await upsertCountryRule(admin, { country: "ZW", action: "BLOCK", reason: "Test rule", source: "Integration test fixture" });
    const conv = await readyConversation({ userId: buyer.user.id }, "I need 3 units of ABC123", "Harare, Zimbabwe");
    await expect(createRfqFromConversation(buyer, conv, { userId: buyer.user.id })).rejects.toThrow(/cannot be processed/);
  });
});

describe("audit", () => {
  it("is append-only and hash-chain verifies", async () => {
    const chain = await verifyAuditChain();
    expect(chain.ok).toBe(true);
    expect(chain.checked).toBeGreaterThan(5);
    const cause = (p: Promise<unknown>) => p.then(() => "no error", (e: { cause?: { message?: string } }) => e.cause?.message ?? "");
    expect(await cause(db.update(auditLogs).set({ action: "tampered" }))).toMatch(/append-only/);
    expect(await cause(db.delete(auditLogs))).toMatch(/append-only/);
  });
});
