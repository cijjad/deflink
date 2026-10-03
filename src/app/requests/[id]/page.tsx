import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BuyerQuotes, type QuoteDTO } from "@/components/rfq/BuyerQuotes";
import { IdentificationBadge, RfqStatus } from "@/components/ui/Badges";
import { CONDITION_LABEL, type Condition } from "@/core/conversation/types";
import { countryName } from "@/core/geo/countries";
import { date, humanize, num } from "@/lib/format";
import { can } from "@/server/auth/rbac";
import { pageSession } from "@/server/page-guard";
import { getBuyerRfq } from "@/server/services/rfq";

export const metadata: Metadata = { title: "Request" };

export default async function RfqPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ supplier?: string }> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const s = await pageSession(`/requests/${id}`, "BUYER");
  const data = /^[0-9a-f-]{36}$/i.test(id) ? await getBuyerRfq(s.org.id, id) : null;
  if (!data) notFound();
  const { rfq, ref, lines, recipients, quotes, reviews } = data;
  const quotesDto = JSON.parse(JSON.stringify(quotes)) as QuoteDTO[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/requests" className="text-sm font-semibold text-accent-600">
        ← My requests
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold text-navy-900">{ref}</h1>
        <RfqStatus status={rfq.status} />
      </div>
      <p className="mt-1 text-sm text-graphite-500">
        Created {date(rfq.createdAt)} · Deliver to {rfq.destinationText ?? "—"} · Required by {rfq.requiredBy ? date(rfq.requiredBy) : "not specified"}
      </p>

      {rfq.status === "COMPLIANCE_REVIEW" && (
        <div className="mt-4 rounded-lg bg-warn-50 px-4 py-3 text-sm text-warn-600" role="note">
          <strong>Compliance review required.</strong> This request will be sent to suppliers only after a compliance officer approves it.
          {rfq.complianceReason && <div className="mt-1 whitespace-pre-line text-graphite-700">{rfq.complianceReason}</div>}
        </div>
      )}
      {rfq.status === "REJECTED" && (
        <div className="mt-4 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-600">Not approved by compliance review. {reviews[0]?.notes}</div>
      )}

      <section className="mt-6">
        <h2 className="label">Items</h2>
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Quantity</th>
                <th>Condition</th>
                <th>Identification</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="text-graphite-400">{l.lineNo}</td>
                  <td>
                    {l.partNumber && <div className="font-mono font-semibold">{l.partNumber}</div>}
                    <div>{l.description}</div>
                    {l.manufacturerName && <div className="text-xs text-graphite-500">{l.manufacturerName}</div>}
                  </td>
                  <td>
                    {num(l.quantity)} {l.unit}
                    {l.quantityApproximate && <span className="text-xs text-graphite-500"> (approx.)</span>}
                  </td>
                  <td>{CONDITION_LABEL[l.condition as Condition]}</td>
                  <td>
                    <IdentificationBadge status={l.identification} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rfq.notes && <p className="mt-2 whitespace-pre-line text-sm text-graphite-700">{rfq.notes}</p>}
      </section>

      <section className="mt-8">
        <h2 className="label">Quotations received</h2>
        <BuyerQuotes
          rfqId={rfq.id}
          quotes={quotesDto}
          lines={lines.map((l) => ({ id: l.id, lineNo: l.lineNo, partNumber: l.partNumber, description: l.description, quantity: l.quantity, unit: l.unit }))}
          canMessage={can(s.user.role, "message.send")}
          initialSupplier={sp.supplier}
        />
      </section>

      <section className="mt-8">
        <h2 className="label">Suppliers contacted</h2>
        {recipients.length === 0 ? (
          <p className="text-sm text-graphite-500">{rfq.status === "COMPLIANCE_REVIEW" ? "Not sent yet — awaiting compliance review." : "No eligible supplier matched automatically. Our sourcing team has been notified."}</p>
        ) : (
          <div className="card divide-y divide-graphite-100">
            {recipients.map((r) => (
              <div key={r.orgId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-xs text-graphite-500">
                    {countryName(r.country)} · matched because: {r.matchReason}
                  </div>
                </div>
                <span className="chip bg-graphite-100 text-graphite-700">{humanize(r.status)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-graphite-500">Your organization&apos;s name is not shown to suppliers.</p>
      </section>
    </div>
  );
}
