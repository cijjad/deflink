import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QuoteForm } from "@/components/rfq/QuoteForm";
import { Thread } from "@/components/rfq/Thread";
import { RfqStatus } from "@/components/ui/Badges";
import { CONDITION_LABEL, type Condition } from "@/core/conversation/types";
import { date, isoDaysFromNow, money, num, place } from "@/lib/format";
import { can } from "@/server/auth/rbac";
import { pageSession } from "@/server/page-guard";
import { getSupplierRfq } from "@/server/services/rfq";

export const metadata: Metadata = { title: "RFQ" };

export default async function SupplierRfqPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const s = await pageSession(`/supplier/rfq/${id}`, "SUPPLIER");
  const data = /^[0-9a-f-]{36}$/i.test(id) ? await getSupplierRfq(s.org.id, id) : null;
  if (!data) notFound();
  const { rfq, buyer, lines, quotes, matchReason } = data;
  const latest = quotes[0] ?? null;
  const accepting = rfq.status === "OPEN" || rfq.status === "QUOTED";
  const previous = latest ? (JSON.parse(JSON.stringify(latest)) as Parameters<typeof QuoteForm>[0]["previous"]) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/supplier" className="text-sm font-semibold text-accent-600">
        ← Incoming RFQs
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold text-navy-900">{rfq.ref}</h1>
        <RfqStatus status={rfq.status} />
      </div>
      <p className="mt-1 text-sm text-graphite-500">
        {buyer.label} · Deliver to {rfq.destinationText ?? place(rfq.destinationCity, rfq.destinationCountry)} · Required by {rfq.requiredBy ? date(rfq.requiredBy) : "not specified"}
      </p>
      <p className="mt-1 text-xs text-graphite-400">You received this RFQ because: {matchReason}</p>

      <section className="mt-6">
        <h2 className="label">Requested items</h2>
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>Part number</th>
                <th>Description</th>
                <th>Quantity</th>
                <th>Condition</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="text-graphite-400">{l.lineNo}</td>
                  <td className="font-mono font-semibold">{l.partNumber ?? "—"}</td>
                  <td>
                    {l.description}
                    {l.manufacturerName && <div className="text-xs text-graphite-500">OEM: {l.manufacturerName}</div>}
                  </td>
                  <td>
                    {num(l.quantity)} {l.unit}
                  </td>
                  <td>{CONDITION_LABEL[l.condition as Condition]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rfq.notes && <p className="mt-2 whitespace-pre-line text-sm text-graphite-700">{rfq.notes}</p>}
      </section>

      <section className="mt-8">
        <h2 className="label">{latest ? `Your quotation · revision ${latest.revision}` : "Submit quotation"}</h2>
        {latest && (
          <div className="card mb-4 p-4 text-sm">
            <div className="font-semibold">
              {money(latest.lines[0]?.unitPrice, latest.currency)}/unit · {latest.lines[0]?.leadTimeDays} days · valid until {date(latest.validUntil)}
            </div>
            {quotes.length > 1 && (
              <ul className="mt-2 space-y-0.5 text-xs text-graphite-500">
                {quotes.slice(1).map((q) => (
                  <li key={q.id}>
                    Rev {q.revision} · {date(q.createdAt)} · {money(q.lines[0]?.unitPrice, q.currency)}/unit · superseded
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {accepting && can(s.user.role, "quote.submit") ? (
          <QuoteForm rfqId={rfq.id} lines={lines.map((l) => ({ id: l.id, lineNo: l.lineNo, partNumber: l.partNumber, description: l.description, quantity: l.quantity, unit: l.unit, condition: l.condition }))} previous={previous} defaultValidUntil={isoDaysFromNow(30)} />
        ) : (
          <p className="text-sm text-graphite-500">This RFQ is not accepting quotations.</p>
        )}
      </section>

      <section className="mt-8" id="messages">
        <h2 className="label">Messages with the buyer</h2>
        <Thread rfqId={rfq.id} supplierOrgId={s.org.id} title="Buyer conversation" canSend={can(s.user.role, "message.send")} />
      </section>
    </div>
  );
}
