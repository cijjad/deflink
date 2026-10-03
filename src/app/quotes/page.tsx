import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
import { date, money, place } from "@/lib/format";
import { db } from "@/server/db/client";
import { organizations, quotationLines, quotations, rfqs } from "@/server/db/schema";
import { pageSession } from "@/server/page-guard";
import { rfqRef } from "@/server/services/rfq";

export const metadata: Metadata = { title: "Quotations" };

export default async function QuotesPage() {
  const s = await pageSession("/quotes", "BUYER");
  const rows = await db
    .select({ q: quotations, refNo: rfqs.refNo, supplier: organizations.name, country: organizations.country, city: organizations.city })
    .from(quotations)
    .innerJoin(rfqs, eq(rfqs.id, quotations.rfqId))
    .innerJoin(organizations, eq(organizations.id, quotations.supplierOrgId))
    .where(and(eq(rfqs.buyerOrgId, s.org.id), eq(quotations.status, "SUBMITTED")))
    .orderBy(desc(quotations.createdAt))
    .limit(200);
  const lines = rows.length ? await db.select().from(quotationLines).where(inArray(quotationLines.quotationId, rows.map((r) => r.q.id))) : [];
  const firstLines = new Map(rows.map((r) => [r.q.id, lines.find((l) => l.quotationId === r.q.id)]));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader title="Quotations" subtitle="Current quotations across your requests" />
      {rows.length === 0 ? (
        <EmptyState title="No quotations yet" text="When suppliers respond to your requests, their quotations appear here." />
      ) : (
        <div className="grid gap-2">
          {rows.map((r) => {
            const l = firstLines.get(r.q.id);
            return (
              <Link key={r.q.id} href={`/requests/${r.q.rfqId}`} className="card flex flex-wrap items-center justify-between gap-3 p-4 hover:border-navy-700/40">
                <div>
                  <div className="font-semibold">{r.supplier}</div>
                  <div className="text-xs text-graphite-500">
                    {rfqRef(r.refNo)} · {place(r.city, r.country)} · {date(r.q.createdAt)}
                    {r.q.revision > 1 ? ` · revision ${r.q.revision}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-navy-900">{l ? money(l.unitPrice, r.q.currency) : "—"}/unit</div>
                  <div className="text-xs text-graphite-500">{l ? `${l.leadTimeDays} days lead time` : ""}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
