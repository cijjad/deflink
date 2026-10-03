import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { RfqStatus, VerificationBadges } from "@/components/ui/Badges";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
import { date, humanize, num, place } from "@/lib/format";
import { db } from "@/server/db/client";
import { supplierVerifications } from "@/server/db/schema";
import { pageSession } from "@/server/page-guard";
import { listSupplierRfqs, rfqRef } from "@/server/services/rfq";
import { supplierBadges } from "@/server/services/search";

export const metadata: Metadata = { title: "Incoming RFQs" };

export default async function SupplierHome(props: { searchParams: Promise<{ view?: string }> }) {
  const sp = await props.searchParams;
  const s = await pageSession("/supplier", "SUPPLIER");
  const all = await listSupplierRfqs(s.org.id);
  const badges = (await supplierBadges([s.org.id])).get(s.org.id) ?? [];
  const pending = await db.select().from(supplierVerifications).where(and(eq(supplierVerifications.organizationId, s.org.id), eq(supplierVerifications.state, "PENDING")));
  const view = sp.view === "quoted" ? "quoted" : sp.view === "open" ? "open" : "all";
  const rfqs = all.filter((r) => (view === "quoted" ? r.recipientStatus === "QUOTED" : view === "open" ? r.recipientStatus !== "QUOTED" : true));
  const newCount = all.filter((r) => r.recipientStatus === "SENT").length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader title="Incoming RFQs" subtitle={<span className="flex flex-wrap items-center gap-2">{s.org.name} <VerificationBadges levels={badges} /></span>} />
      {pending.length > 0 && !badges.includes("BUSINESS_VERIFIED") && (
        <div className="mb-6 rounded-lg bg-warn-50 px-4 py-3 text-sm text-warn-600">
          Business verification is in progress. You will start receiving RFQs once it is approved.
        </div>
      )}
      <div className="mb-4 flex gap-2 text-sm">
        {[
          ["all", `All (${all.length})`],
          ["open", `To quote (${all.filter((r) => r.recipientStatus !== "QUOTED").length})`],
          ["quoted", `Quoted (${all.filter((r) => r.recipientStatus === "QUOTED").length})`],
        ].map(([v, l]) => (
          <Link key={v} href={v === "all" ? "/supplier" : `/supplier?view=${v}`} className={`rounded-full px-3 py-1.5 font-semibold ${view === v ? "bg-navy-800 text-white" : "bg-white text-graphite-700 ring-1 ring-graphite-200"}`}>
            {l}
          </Link>
        ))}
      </div>
      {newCount > 0 && view !== "quoted" && <p className="mb-3 text-sm font-semibold text-accent-600">{newCount} new RFQ{newCount === 1 ? "" : "s"}</p>}
      {rfqs.length === 0 ? (
        <EmptyState title="Nothing here yet" text="RFQs matched to your products, OEM relationships and categories appear here." />
      ) : (
        <div className="grid gap-2">
          {rfqs.map((r) => {
            const [qty, unit] = (r.firstQty ?? "").split(" ");
            return (
              <Link key={r.id} href={`/supplier/rfq/${r.id}`} className={`card flex flex-wrap items-center justify-between gap-3 p-4 hover:border-navy-700/40 ${r.recipientStatus === "SENT" ? "border-l-4 border-l-accent-500" : ""}`} data-testid="supplier-rfq-row">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-navy-900">{rfqRef(r.refNo)}</span>
                    {r.recipientStatus === "SENT" && <span className="chip bg-accent-500 text-white">New</span>}
                    <RfqStatus status={r.status} />
                  </div>
                  <div className="mt-1 text-sm">
                    {r.firstLine} · {num(qty)} {unit}
                    {r.lineCount > 1 && <span className="text-graphite-500"> + {r.lineCount - 1} more</span>}
                  </div>
                  <div className="text-xs text-graphite-500">
                    Destination {place(r.destinationCity, r.destinationCountry)} · received {date(r.createdAt)}
                  </div>
                </div>
                <span className="chip bg-graphite-100 text-graphite-700">{humanize(r.recipientStatus)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
