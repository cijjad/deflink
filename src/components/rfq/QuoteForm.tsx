"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CONDITION_LABEL, type Condition } from "@/core/conversation/types";
import { num } from "@/lib/format";

interface Line {
  id: string;
  lineNo: number;
  partNumber: string | null;
  description: string;
  quantity: string;
  unit: string;
  condition: string;
}

interface Prev {
  currency: string;
  incoterm: string | null;
  freight: string | null;
  insurance: string | null;
  paymentTerms: string | null;
  validUntil: string | null;
  remarks: string | null;
  revision: number;
  lines: { rfqLineId: string; unitPrice: string; quantity: string; availability: string; leadTimeDays: number; condition: string; certification: string | null; countryOfOrigin: string | null; warranty: string | null }[];
}

const INCOTERMS = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"];

export function QuoteForm({ rfqId, lines, previous, defaultValidUntil }: { rfqId: string; lines: Line[]; previous: Prev | null; defaultValidUntil: string }) {
  const router = useRouter();
  const [head, setHead] = useState({
    currency: previous?.currency ?? "USD",
    incoterm: previous?.incoterm ?? "",
    freight: previous?.freight ?? "",
    insurance: previous?.insurance ?? "",
    paymentTerms: previous?.paymentTerms ?? "",
    validUntil: previous?.validUntil ?? defaultValidUntil,
    remarks: previous?.remarks ?? "",
    revisionNote: "",
  });
  const [rows, setRows] = useState(() =>
    lines.map((l) => {
      const p = previous?.lines.find((x) => x.rfqLineId === l.id);
      return {
        rfqLineId: l.id,
        include: Boolean(p) || !previous,
        unitPrice: p?.unitPrice ?? "",
        quantity: p?.quantity ?? l.quantity,
        availability: p?.availability ?? "IN_STOCK",
        leadTimeDays: String(p?.leadTimeDays ?? ""),
        condition: p?.condition ?? (l.condition === "ANY" || l.condition === "NEW_OR_APPROVED_ALTERNATIVE" ? "NEW" : l.condition),
        certification: p?.certification ?? "",
        countryOfOrigin: p?.countryOfOrigin ?? "",
        warranty: p?.warranty ?? "",
      };
    }),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const revising = Boolean(previous);

  const setRow = (i: number, k: string, v: string | boolean) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const body = {
      currency: head.currency.toUpperCase(),
      incoterm: head.incoterm || null,
      freight: head.freight === "" ? null : head.freight,
      insurance: head.insurance === "" ? null : head.insurance,
      paymentTerms: head.paymentTerms || null,
      validUntil: head.validUntil || null,
      remarks: head.remarks || null,
      revisionNote: revising ? head.revisionNote || null : null,
      lines: rows
        .filter((r) => r.include)
        .map((r) => ({
          rfqLineId: r.rfqLineId,
          unitPrice: r.unitPrice,
          quantity: r.quantity,
          availability: r.availability,
          leadTimeDays: r.leadTimeDays,
          condition: r.condition,
          certification: r.certification || null,
          countryOfOrigin: r.countryOfOrigin || null,
          warranty: r.warranty || null,
        })),
    };
    const res = await fetch(`/api/supplier/rfqs/${rfqId}/quotes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      const details = Array.isArray(data?.error?.details) ? " " + data.error.details.map((d: { path: string; message: string }) => `${d.path}: ${d.message}`).join("; ") : "";
      return setError((data?.error?.message ?? "Could not submit the quotation.") + details);
    }
    setDone(revising ? `Revision ${data.revision} submitted. The buyer has been notified.` : "Quotation submitted. The buyer has been notified.");
    router.refresh();
  }

  if (done) {
    return (
      <div className="rounded-lg bg-ok-50 px-4 py-3 text-sm text-ok-600" role="status" data-testid="quote-done">
        {done}
        <button className="ml-3 font-semibold underline" onClick={() => setDone(null)}>
          Revise again
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="quote-form">
      {rows.map((r, i) => {
        const l = lines[i];
        return (
          <fieldset key={r.rfqLineId} className="card p-4">
            <legend className="sr-only">Line {l.lineNo}</legend>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-mono font-semibold">{l.partNumber ?? `Line ${l.lineNo}`}</div>
                <div className="text-sm text-graphite-500">
                  {l.description} · requested {num(l.quantity)} {l.unit}
                </div>
              </div>
              {lines.length > 1 && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={r.include} onChange={(e) => setRow(i, "include", e.target.checked)} /> Quote this line
                </label>
              )}
            </div>
            {r.include && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label={`Unit price (${head.currency || "USD"})`} id={`p${i}`}>
                  <input id={`p${i}`} className="input" inputMode="decimal" required value={r.unitPrice} onChange={(e) => setRow(i, "unitPrice", e.target.value)} data-testid="unit-price" />
                </Field>
                <Field label="Quantity" id={`q${i}`}>
                  <input id={`q${i}`} className="input" inputMode="decimal" required value={r.quantity} onChange={(e) => setRow(i, "quantity", e.target.value)} />
                </Field>
                <Field label="Availability" id={`a${i}`}>
                  <select id={`a${i}`} className="input" value={r.availability} onChange={(e) => setRow(i, "availability", e.target.value)}>
                    <option value="IN_STOCK">In stock</option>
                    <option value="PARTIAL">Partial stock</option>
                    <option value="FACTORY_ORDER">Factory order</option>
                  </select>
                </Field>
                <Field label="Lead time (days)" id={`l${i}`}>
                  <input id={`l${i}`} className="input" inputMode="numeric" required value={r.leadTimeDays} onChange={(e) => setRow(i, "leadTimeDays", e.target.value)} data-testid="lead-time" />
                </Field>
                <Field label="Condition" id={`c${i}`}>
                  <select id={`c${i}`} className="input" value={r.condition} onChange={(e) => setRow(i, "condition", e.target.value)}>
                    {(["NEW", "NEW_SURPLUS", "OVERHAULED", "SERVICEABLE", "REPAIRED", "AS_REMOVED"] as Condition[]).map((c) => (
                      <option key={c} value={c}>
                        {CONDITION_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Certification" id={`ce${i}`}>
                  <input id={`ce${i}`} className="input" placeholder="e.g. CoC" value={r.certification} onChange={(e) => setRow(i, "certification", e.target.value)} />
                </Field>
                <Field label="Country of origin" id={`o${i}`}>
                  <input id={`o${i}`} className="input" value={r.countryOfOrigin} onChange={(e) => setRow(i, "countryOfOrigin", e.target.value)} />
                </Field>
                <Field label="Warranty" id={`w${i}`}>
                  <input id={`w${i}`} className="input" placeholder="e.g. 12 months" value={r.warranty} onChange={(e) => setRow(i, "warranty", e.target.value)} />
                </Field>
              </div>
            )}
          </fieldset>
        );
      })}
      <div className="card grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <Field label="Currency" id="cur">
          <input id="cur" className="input uppercase" maxLength={3} required value={head.currency} onChange={(e) => setHead({ ...head, currency: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Incoterm" id="inc">
          <select id="inc" className="input" value={head.incoterm} onChange={(e) => setHead({ ...head, incoterm: e.target.value })}>
            <option value="">—</option>
            {INCOTERMS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Freight" id="fr">
          <input id="fr" className="input" inputMode="decimal" value={head.freight} onChange={(e) => setHead({ ...head, freight: e.target.value })} />
        </Field>
        <Field label="Insurance" id="ins">
          <input id="ins" className="input" inputMode="decimal" value={head.insurance} onChange={(e) => setHead({ ...head, insurance: e.target.value })} />
        </Field>
        <Field label="Payment terms" id="pt">
          <input id="pt" className="input" placeholder="e.g. 30% advance, balance before shipment" value={head.paymentTerms} onChange={(e) => setHead({ ...head, paymentTerms: e.target.value })} />
        </Field>
        <Field label="Valid until" id="vu">
          <input id="vu" type="date" className="input" value={head.validUntil} onChange={(e) => setHead({ ...head, validUntil: e.target.value })} />
        </Field>
        <div className="col-span-2">
          <Field label="Remarks" id="rm">
            <input id="rm" className="input" value={head.remarks} onChange={(e) => setHead({ ...head, remarks: e.target.value })} />
          </Field>
        </div>
        {revising && (
          <div className="col-span-2 sm:col-span-4">
            <Field label="What changed in this revision? (required)" id="rn">
              <input id="rn" className="input" required value={head.revisionNote} onChange={(e) => setHead({ ...head, revisionNote: e.target.value })} data-testid="revision-note" />
            </Field>
          </div>
        )}
      </div>
      {error && (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      )}
      <button className="btn-primary w-full sm:w-auto" disabled={busy} data-testid="submit-quote">
        {busy ? "Submitting…" : revising ? `Submit revision ${(previous?.revision ?? 0) + 1}` : "Submit quotation"}
      </button>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}
