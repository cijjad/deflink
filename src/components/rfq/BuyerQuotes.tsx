"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CONDITION_LABEL, type Condition } from "@/core/conversation/types";
import { AVAILABILITY_LABEL, date, money, num, place } from "@/lib/format";
import { Thread } from "./Thread";

export interface QuoteLineDTO {
  rfqLineId: string;
  unitPrice: string;
  quantity: string;
  availability: string;
  leadTimeDays: number;
  condition: string;
  certification: string | null;
  countryOfOrigin: string | null;
  warranty: string | null;
  shipFromCountry: string | null;
  shipFromCity: string | null;
}

export interface QuoteDTO {
  id: string;
  supplierOrgId: string;
  supplierName: string;
  supplierCountry: string;
  supplierCity: string | null;
  revision: number;
  status: string;
  currency: string;
  incoterm: string | null;
  freight: string | null;
  insurance: string | null;
  paymentTerms: string | null;
  validUntil: string | null;
  remarks: string | null;
  revisionNote: string | null;
  isShortlisted: boolean;
  createdAt: string;
  lines: QuoteLineDTO[];
}

export interface LineDTO {
  id: string;
  lineNo: number;
  partNumber: string | null;
  description: string;
  quantity: string;
  unit: string;
}

export function BuyerQuotes({ rfqId, quotes, lines, canMessage, initialSupplier }: { rfqId: string; quotes: QuoteDTO[]; lines: LineDTO[]; canMessage: boolean; initialSupplier?: string }) {
  const router = useRouter();
  const current = quotes.filter((q) => q.status === "SUBMITTED");
  const [view, setView] = useState<"cards" | "compare">("cards");
  const [lineId, setLineId] = useState(lines[0]?.id);
  const [sort, setSort] = useState<"price" | "lead" | "supplier">("price");
  const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(initialSupplier ?? null);

  const rows = useMemo(() => {
    const r = current
      .map((q) => ({ q, l: q.lines.find((x) => x.rfqLineId === lineId) }))
      .filter((x): x is { q: QuoteDTO; l: QuoteLineDTO } => Boolean(x.l));
    return r.sort((a, b) =>
      sort === "price" ? Number(a.l.unitPrice) - Number(b.l.unitPrice) : sort === "lead" ? a.l.leadTimeDays - b.l.leadTimeDays : a.q.supplierName.localeCompare(b.q.supplierName),
    );
  }, [current, lineId, sort]);

  async function shortlist(q: QuoteDTO) {
    await fetch(`/api/quotes/${q.id}/shortlist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shortlisted: !q.isShortlisted }) });
    router.refresh();
  }

  if (!current.length) {
    return <div className="card p-6 text-center text-sm text-graphite-500">No quotations yet. You&apos;ll be notified as soon as a supplier responds.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-graphite-100 p-1" role="tablist">
          {(["cards", "compare"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === v ? "bg-white text-navy-900 shadow-sm" : "text-graphite-500"}`}>
              {v === "cards" ? "Quotations" : "Compare"}
            </button>
          ))}
        </div>
        {view === "compare" && (
          <div className="flex flex-wrap gap-2">
            {lines.length > 1 && (
              <select className="input !min-h-9 !w-auto !py-1.5" value={lineId} onChange={(e) => setLineId(e.target.value)} aria-label="Line">
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    Line {l.lineNo}: {l.partNumber ?? l.description}
                  </option>
                ))}
              </select>
            )}
            <select className="input !min-h-9 !w-auto !py-1.5" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
              <option value="price">Sort: unit price</option>
              <option value="lead">Sort: lead time</option>
              <option value="supplier">Sort: supplier</option>
            </select>
          </div>
        )}
      </div>

      {view === "compare" ? (
        <div className="card overflow-x-auto" data-testid="compare">
          <table className="table-base min-w-[760px]">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Unit price</th>
                <th>Qty</th>
                <th>Line total</th>
                <th>Lead time</th>
                <th>Availability</th>
                <th>Condition</th>
                <th>Certification</th>
                <th>Incoterm</th>
                <th>Valid until</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ q, l }) => (
                <tr key={q.id}>
                  <td>
                    <div className="font-semibold">{q.supplierName}</div>
                    <div className="text-xs text-graphite-500">{place(l.shipFromCity, l.shipFromCountry)}</div>
                    {q.isShortlisted && <span className="chip mt-1 bg-accent-50 text-accent-600">Shortlisted</span>}
                  </td>
                  <td className="font-semibold">{money(l.unitPrice, q.currency)}</td>
                  <td>{num(l.quantity)}</td>
                  <td>{money(Number(l.unitPrice) * Number(l.quantity), q.currency)}</td>
                  <td>{l.leadTimeDays} days</td>
                  <td>{AVAILABILITY_LABEL[l.availability] ?? l.availability}</td>
                  <td>{CONDITION_LABEL[l.condition as Condition] ?? l.condition}</td>
                  <td>{l.certification ?? "—"}</td>
                  <td>{q.incoterm ?? "—"}</td>
                  <td>{date(q.validUntil)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-graphite-100 px-3 py-2 text-xs text-graphite-500">
            Objective comparison of supplier-provided figures. Currencies are not converted. DefLink does not recommend a supplier — the decision is yours.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {current.map((q) => {
            const first = q.lines[0];
            const history = quotes.filter((x) => x.supplierOrgId === q.supplierOrgId && x.id !== q.id);
            return (
              <div key={q.id} className="card p-4" data-testid="quote-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{q.supplierName}</span>
                      {q.revision > 1 && <span className="chip bg-accent-50 text-accent-600">Updated · rev {q.revision}</span>}
                      {q.isShortlisted && <span className="chip bg-ok-50 text-ok-600">Shortlisted</span>}
                    </div>
                    <div className="text-sm text-graphite-500">{place(first?.shipFromCity ?? q.supplierCity, first?.shipFromCountry ?? q.supplierCountry)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-navy-900">{first ? money(first.unitPrice, q.currency) : "—"}</div>
                    <div className="text-xs text-graphite-500">per unit · supplier quotation</div>
                  </div>
                </div>
                {first && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
                    <Fact k="Quantity" v={num(first.quantity)} />
                    <Fact k="Availability" v={AVAILABILITY_LABEL[first.availability] ?? first.availability} />
                    <Fact k="Lead time" v={`${first.leadTimeDays} days`} />
                    <Fact k="Condition" v={CONDITION_LABEL[first.condition as Condition] ?? first.condition} />
                    <Fact k="Certification" v={first.certification ?? "Not stated"} />
                    <Fact k="Origin" v={first.countryOfOrigin ?? "Not stated"} />
                    <Fact k="Incoterm" v={q.incoterm ?? "—"} />
                    <Fact k="Valid until" v={date(q.validUntil)} />
                  </dl>
                )}
                {open === q.id && (
                  <div className="mt-3 space-y-3 rounded-lg bg-graphite-50 p-3 text-sm">
                    {q.lines.length > 1 && (
                      <table className="table-base">
                        <thead>
                          <tr>
                            <th>Line</th>
                            <th>Unit price</th>
                            <th>Qty</th>
                            <th>Lead</th>
                          </tr>
                        </thead>
                        <tbody>
                          {q.lines.map((l) => {
                            const rl = lines.find((x) => x.id === l.rfqLineId);
                            return (
                              <tr key={l.rfqLineId}>
                                <td>{rl?.partNumber ?? rl?.description}</td>
                                <td>{money(l.unitPrice, q.currency)}</td>
                                <td>{num(l.quantity)}</td>
                                <td>{l.leadTimeDays} d</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Fact k="Freight" v={q.freight ? money(q.freight, q.currency) : "Not stated"} />
                      <Fact k="Insurance" v={q.insurance ? money(q.insurance, q.currency) : "Not stated"} />
                      <Fact k="Payment terms" v={q.paymentTerms ?? "Not stated"} />
                      <Fact k="Warranty" v={first?.warranty ?? "Not stated"} />
                      <Fact k="Submitted" v={date(q.createdAt)} />
                    </dl>
                    {q.remarks && <p className="text-graphite-700">Remarks: {q.remarks}</p>}
                    {q.revisionNote && <p className="text-graphite-700">Revision note: {q.revisionNote}</p>}
                    {history.length > 0 && (
                      <div>
                        <div className="label !mb-1">Revision history</div>
                        <ul className="space-y-1 text-xs text-graphite-700">
                          {history.map((h) => (
                            <li key={h.id}>
                              Rev {h.revision} · {date(h.createdAt)} · {h.lines[0] ? money(h.lines[0].unitPrice, h.currency) : "—"}/unit · {h.lines[0]?.leadTimeDays} days · superseded
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-secondary !min-h-9 !py-1.5" onClick={() => setOpen(open === q.id ? null : q.id)} data-testid="view-quote">
                    {open === q.id ? "Hide quote" : "View quote"}
                  </button>
                  {canMessage && (
                    <button className="btn-secondary !min-h-9 !py-1.5" onClick={() => setThread(q.supplierOrgId)} data-testid="ask-supplier">
                      Ask supplier
                    </button>
                  )}
                  <button className="btn-ghost !min-h-9 !py-1.5" onClick={() => shortlist(q)}>
                    {q.isShortlisted ? "Remove from shortlist" : "Shortlist"}
                  </button>
                </div>
                {thread === q.supplierOrgId && (
                  <div className="mt-3">
                    <Thread rfqId={rfqId} supplierOrgId={q.supplierOrgId} title={`Conversation with ${q.supplierName}`} canSend={canMessage} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-graphite-400">{k}</dt>
      <dd className="text-graphite-900">{v}</dd>
    </div>
  );
}
