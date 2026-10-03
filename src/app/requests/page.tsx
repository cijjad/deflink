import type { Metadata } from "next";
import Link from "next/link";
import { RfqStatus } from "@/components/ui/Badges";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
import { date, num } from "@/lib/format";
import { pageSession } from "@/server/page-guard";
import { listBuyerRfqs, rfqRef } from "@/server/services/rfq";

export const metadata: Metadata = { title: "My requests" };

export default async function RequestsPage() {
  const s = await pageSession("/requests", "BUYER");
  const rfqs = await listBuyerRfqs(s.org.id);
  const action = rfqs.filter((r) => r.status === "QUOTED" || r.status === "COMPLIANCE_REVIEW" || r.status === "REJECTED");
  const active = rfqs.filter((r) => !["CLOSED", "CANCELLED"].includes(r.status));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader
        title="My requests"
        subtitle={s.org.name}
        action={
          <Link href="/" className="btn-primary">
            New request
          </Link>
        }
      />
      {rfqs.length === 0 ? (
        <EmptyState title="No requests yet" text="Tell us what you need and we'll find sources and request quotations for you." action={<Link href="/" className="btn-primary">What do you need?</Link>} />
      ) : (
        <div className="space-y-8">
          {action.length > 0 && (
            <section>
              <h2 className="label">Action required</h2>
              <div className="grid gap-2">
                {action.map((r) => (
                  <RfqRow key={r.id} r={r} highlight />
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="label">Active requests</h2>
            <div className="grid gap-2">
              {active.map((r) => (
                <RfqRow key={r.id} r={r} />
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function RfqRow({ r, highlight = false }: { r: Awaited<ReturnType<typeof listBuyerRfqs>>[number]; highlight?: boolean }) {
  const [qty, unit] = (r.firstQty ?? "").split(" ");
  const cta = r.quoteCount ? "View quotes" : "View";
  return (
    <Link href={`/requests/${r.id}`} className={`card flex flex-wrap items-center justify-between gap-3 p-4 hover:border-navy-700/40 ${highlight ? "border-l-4 border-l-accent-500" : ""}`} data-testid="rfq-row">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-navy-900">{rfqRef(r.refNo)}</span>
          <RfqStatus status={r.status} />
        </div>
        <div className="mt-1 truncate text-sm text-graphite-900">
          {num(qty)} {unit === "EA" ? "×" : unit} {r.firstLine}
          {r.lineCount > 1 && <span className="text-graphite-500"> + {r.lineCount - 1} more</span>}
        </div>
        <div className="mt-0.5 text-xs text-graphite-500">
          {date(r.createdAt)} · {r.destinationText ?? "—"} · sent to {r.recipientCount} supplier{r.recipientCount === 1 ? "" : "s"}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold text-graphite-900">
          {r.quoteCount} quotation{r.quoteCount === 1 ? "" : "s"} received
        </div>
        <span className="text-sm font-semibold text-accent-600">{cta} →</span>
      </div>
    </Link>
  );
}
