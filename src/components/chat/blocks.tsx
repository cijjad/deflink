"use client";
import { useState } from "react";
import { destinationLabel } from "@/core/conversation/engine";
import { formatQuantity } from "@/core/conversation/parser";
import {
  CONDITION_LABEL,
  type Candidate,
  type Condition,
  type ConversationState,
  type ProductHit,
  type ReplyBlock,
  type RequirementLine,
  type SourceCard as Source,
} from "@/core/conversation/types";
import { countryName } from "@/core/geo/countries";
import { DataBadge, DemoBadge, IdentificationBadge, MatchBadge, VerificationBadges } from "@/components/ui/Badges";
import { Icon } from "@/components/ui/Icon";
import { date } from "@/lib/format";

export interface BlockHandlers {
  act: (type: string, value?: string) => void;
  patch: (body: object) => Promise<void>;
  interactive: boolean;
  busy: boolean;
}

export function Block({ block, h }: { block: ReplyBlock; h: BlockHandlers }) {
  switch (block.type) {
    case "text":
      return <p className="text-[15px] leading-relaxed text-graphite-900">{block.text}</p>;
    case "notice":
      return (
        <div
          className={`rounded-lg px-3 py-2.5 text-sm ${block.tone === "warning" ? "bg-warn-50 text-warn-600" : block.tone === "danger" ? "bg-danger-50 text-danger-600" : "bg-accent-50 text-navy-700"}`}
          role="note"
        >
          {block.text}
        </div>
      );
    case "results":
      return <Results block={block} h={h} />;
    case "sources":
      return <Sources sources={block.sources} h={h} />;
    case "candidates":
      return <Candidates candidates={block.candidates} />;
    case "lines":
      return <LinesTable lines={block.lines} h={h} />;
    case "requirement":
      return <RequirementCard state={block.state} h={h} />;
    case "facts":
      return (
        <div className="overflow-hidden rounded-lg border border-graphite-200">
          <div className="border-b border-graphite-100 bg-graphite-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-graphite-500">{block.title}</div>
          <dl className="divide-y divide-graphite-100">
            {block.rows.map((r, i) => (
              <div key={i} className="grid grid-cols-1 gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-3">
                <dt className="text-graphite-500">{r.label}</dt>
                <dd className="flex flex-wrap items-center gap-2 text-graphite-900">
                  {r.value}
                  {r.status && <DataBadge status={r.status} />}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      );
  }
}

/* ---------------------------------------------------------------- results */

function Results({ block, h }: { block: Extract<ReplyBlock, { type: "results" }>; h: BlockHandlers }) {
  const [showAll, setShowAll] = useState(false);
  const groups: [string, ProductHit[]][] = [
    ["Exact match", block.exact],
    ["Possible matches", block.possible],
    ["Alternatives & cross-references", block.alternatives],
  ];
  const total = block.exact.length + block.possible.length + block.alternatives.length;
  return (
    <div className="space-y-4" data-testid="results">
      {groups.map(([title, hits]) =>
        hits.length ? (
          <section key={title}>
            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-graphite-500">
              {title}
              <span className="rounded bg-graphite-100 px-1.5 text-graphite-700">{hits.length}</span>
            </h4>
            <div className="grid gap-2">
              {(showAll || title === "Exact match" ? hits : hits.slice(0, 2)).map((hit) => (
                <ProductCard key={hit.productId + title} hit={hit} h={h} />
              ))}
            </div>
          </section>
        ) : null,
      )}
      {total > block.exact.length + Math.min(2, block.possible.length) + Math.min(2, block.alternatives.length) && !showAll && (
        <button onClick={() => setShowAll(true)} className="text-sm font-semibold text-accent-600">
          View all {total}
        </button>
      )}
    </div>
  );
}

function ProductCard({ hit, h }: { hit: ProductHit; h: BlockHandlers }) {
  return (
    <div className="rounded-lg border border-graphite-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[15px] font-semibold text-navy-900">{hit.partNumber}</span>
        <MatchBadge match={hit.match} />
        <DemoBadge show={hit.isDemo} />
        {hit.exportControlled && <span className="chip bg-danger-50 text-danger-600">Export-controlled</span>}
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-graphite-500">Manufacturer</dt>
        <dd>{hit.manufacturer ?? "Not on record"}</dd>
        <dt className="text-graphite-500">Description</dt>
        <dd>{hit.description}</dd>
        <dt className="text-graphite-500">Availability</dt>
        <dd>
          {hit.sourceCount
            ? `${hit.sourceCount} potential source${hit.sourceCount === 1 ? "" : "s"} · ${hit.availableCount} reporting stock`
            : "No sources on record"}
        </dd>
      </dl>
      {hit.evidence && <p className="mt-2 text-xs text-graphite-500">{hit.evidence}</p>}
      {h.interactive && hit.sourceCount > 0 && (
        <div className="mt-3">
          <button className="btn-secondary !min-h-9 !py-1.5" onClick={() => h.act("VIEW_SOURCES", hit.productId)} disabled={h.busy}>
            Show sources
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- sources */

const PRICE_SOURCE: Record<string, string> = {
  SUPPLIER_PROVIDED: "Supplier-reported price",
  ESTIMATED: "Estimated price",
  HISTORICAL: "Historical price",
  VERIFIED: "Verified price",
  PENDING_VERIFICATION: "Unverified price",
};

function priceText(s: Source) {
  if (s.priceType === "ON_REQUEST" || s.priceMin === null) return "Price on request";
  const f = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (s.priceType === "EXACT" || s.priceMin === s.priceMax) return `${s.currency} ${f(s.priceMin)}/unit`;
  return `${s.currency} ${f(s.priceMin)}–${f(s.priceMax!)}`;
}

function Sources({ sources, h }: { sources: Source[]; h: BlockHandlers }) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, 3);
  return (
    <div className="grid gap-2" data-testid="sources">
      {shown.map((s) => (
        <SourceCard key={s.listingId} s={s} h={h} />
      ))}
      {sources.length > 3 && !all && (
        <button onClick={() => setAll(true)} className="justify-self-start text-sm font-semibold text-accent-600">
          View all {sources.length} sources
        </button>
      )}
    </div>
  );
}

function SourceCard({ s, h }: { s: Source; h: BlockHandlers }) {
  const [open, setOpen] = useState(false);
  const inStock = (s.quantityAvailable ?? 0) > 0;
  return (
    <div className="rounded-lg border border-graphite-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-graphite-900">{s.supplierName}</span>
            <DemoBadge show={s.isDemo} />
          </div>
          <div className="mt-1 flex items-center gap-1 text-sm text-graphite-500">
            <Icon name="pin" className="h-4 w-4" />
            {[s.city, countryName(s.country)].filter(Boolean).join(", ")}
            <span className="mx-1 text-graphite-300">·</span>
            {s.supplierType.replace(/_/g, " ").toLowerCase()}
          </div>
        </div>
        <div className="text-right">
          <div className="font-semibold text-navy-900">{priceText(s)}</div>
          <div className="text-xs text-graphite-500">{s.priceType === "ON_REQUEST" ? "Request a quote" : `${PRICE_SOURCE[s.priceStatus]} · not a quotation`}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
        <Fact label="Condition" value={CONDITION_LABEL[s.condition]} />
        <Fact label="Availability" value={s.quantityAvailable === null ? "Not reported" : inStock ? `${s.quantityAvailable} available` : "Factory order"} />
        <Fact label="Lead time" value={s.leadTimeDays === null ? "Not reported" : `${s.leadTimeDays} days`} />
        <Fact label="Certification" value={s.certification ?? "Not stated"} />
      </div>
      <div className="mt-3">
        <VerificationBadges levels={s.verifications} />
      </div>
      {open && (
        <div className="mt-3 space-y-1.5 rounded-md bg-graphite-50 p-3 text-xs text-graphite-700">
          <div className="flex flex-wrap items-center gap-2">
            Price: <DataBadge status={s.priceStatus} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            Availability: <DataBadge status={s.availabilityStatus} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            Certification: <DataBadge status={s.certificationStatus} />
          </div>
          <div>Last reported {date(s.reportedAt)}. Location shown at city level only.</div>
        </div>
      )}
      {h.interactive && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary !min-h-9 !py-1.5" onClick={() => h.act("GET_QUOTE")} disabled={h.busy}>
            Get quote
          </button>
          <button className="btn-secondary !min-h-9 !py-1.5" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide details" : "View details"}
          </button>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-graphite-400">{label}</div>
      <div className="text-graphite-900">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------- candidates */

function Candidates({ candidates }: { candidates: Candidate[] }) {
  return (
    <div className="grid gap-2">
      {candidates.map((c) => (
        <div key={c.productId} className="rounded-lg border border-graphite-200 bg-white px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-navy-900">{c.partNumber}</span>
            <MatchBadge match={c.match} />
          </div>
          <div className="text-sm text-graphite-700">
            {c.description} · {c.manufacturer ?? "Manufacturer not on record"}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ lines table */

function LinesTable({ lines, h }: { lines: RequirementLine[]; h: BlockHandlers }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => lines.map((l) => ({ key: l.key, partNumber: l.partNumber ?? "", description: l.description ?? l.category ?? "", quantity: l.quantity ?? "" })));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const changes = draft
        .map((d) => {
          const orig = lines.find((l) => l.key === d.key)!;
          const out: Record<string, unknown> = { key: d.key };
          if (d.partNumber !== (orig.partNumber ?? "")) out.partNumber = d.partNumber || null;
          if (d.description !== (orig.description ?? orig.category ?? "")) out.description = d.description || null;
          if (String(d.quantity) !== String(orig.quantity ?? "")) out.quantity = d.quantity === "" ? null : Number(d.quantity);
          return out;
        })
        .filter((c) => Object.keys(c).length > 1);
      if (changes.length) await h.patch({ lines: changes });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-graphite-200 bg-white" data-testid="lines">
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Item</th>
              <th className="w-28">Quantity</th>
              <th className="w-44">Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key} data-testid="line-row">
                <td className="text-graphite-400">{i + 1}</td>
                <td>
                  {editing ? (
                    <div className="grid gap-1.5">
                      <input
                        className="input !min-h-9 !py-1.5 font-mono"
                        placeholder="Part number"
                        aria-label={`Part number line ${i + 1}`}
                        value={draft[i].partNumber}
                        onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, partNumber: e.target.value } : x)))}
                      />
                      <input
                        className="input !min-h-9 !py-1.5"
                        placeholder="Description"
                        aria-label={`Description line ${i + 1}`}
                        value={draft[i].description}
                        onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                      />
                    </div>
                  ) : (
                    <>
                      {l.partNumber && <div className="font-mono font-semibold text-navy-900">{l.partNumber}</div>}
                      <div className="text-graphite-700">{l.description ?? l.category ?? l.query}</div>
                      {l.manufacturer && <div className="text-xs text-graphite-500">{l.manufacturer}</div>}
                      {l.identification === "NEEDS_CONFIRMATION" && l.candidates?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {l.candidates.map((c) => (
                            <button
                              key={c.productId}
                              disabled={!h.interactive || h.busy}
                              onClick={() => h.act("CHOOSE_CANDIDATE", `${l.key}:${c.productId}`)}
                              className="rounded border border-accent-500/40 bg-accent-50 px-2 py-0.5 font-mono text-xs text-accent-600 hover:bg-accent-100"
                            >
                              Use {c.partNumber}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}
                </td>
                <td>
                  {editing ? (
                    <input
                      className="input !min-h-9 !py-1.5"
                      inputMode="decimal"
                      aria-label={`Quantity line ${i + 1}`}
                      value={draft[i].quantity}
                      onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                    />
                  ) : l.quantity ? (
                    <span title={l.quantityText}>{formatQuantity(l.quantity, l.unit)}</span>
                  ) : (
                    <span className="text-warn-600">Missing</span>
                  )}
                </td>
                <td>
                  <IdentificationBadge status={l.identification} />
                  {l.isDemo && <DemoBadge />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {h.interactive && (
        <div className="flex flex-wrap gap-2 border-t border-graphite-100 px-3 py-2">
          {editing ? (
            <>
              <button className="btn-primary !min-h-9 !py-1.5" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button className="btn-ghost !min-h-9 !py-1.5" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn-ghost !min-h-9 !py-1.5" onClick={() => setEditing(true)} data-testid="edit-lines">
              <Icon name="edit" className="h-4 w-4" /> Correct items
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- requirement card */

export function RequirementCard({ state, h, startEditing = false }: { state: ConversationState; h: BlockHandlers; startEditing?: boolean }) {
  const [editing, setEditing] = useState(startEditing);
  const [dest, setDest] = useState(destinationLabel(state.destination));
  const [condition, setCondition] = useState<Condition>(state.condition ?? "NEW");
  const [requiredBy, setRequiredBy] = useState(state.requiredBy ?? "");
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(state.lines.map((l) => [l.key, String(l.quantity ?? "")])));
  const [saving, setSaving] = useState(false);
  const single = state.lines.length === 1 ? state.lines[0] : null;

  async function save() {
    setSaving(true);
    try {
      await h.patch({
        destination: dest,
        condition,
        requiredBy: requiredBy || null,
        lines: state.lines.filter((l) => String(l.quantity ?? "") !== qty[l.key]).map((l) => ({ key: l.key, quantity: qty[l.key] ? Number(qty[l.key]) : null })),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border-2 border-navy-800/80 bg-white" data-testid="requirement-card">
      <div className="flex items-center justify-between bg-navy-800 px-4 py-2.5 text-white">
        <span className="text-xs font-semibold uppercase tracking-[0.12em]">Ready to request quotes</span>
        <Icon name="check" className="h-4 w-4" />
      </div>
      {!editing ? (
        <dl className="divide-y divide-graphite-100 text-sm">
          {single ? (
            <>
              <Row label="Item" value={<span className="font-mono font-semibold">{single.partNumber ?? single.description ?? single.category}</span>} />
              {single.partNumber && <Row label="Description" value={single.description ?? "—"} />}
              {single.manufacturer && <Row label="OEM / Manufacturer" value={single.manufacturer} />}
              <Row label="Quantity" value={formatQuantity(single.quantity, single.unit) + (single.approximate ? " (approx.)" : "")} />
            </>
          ) : (
            <Row label="Items" value={state.lines.map((l) => `${formatQuantity(l.quantity, l.unit)} × ${l.partNumber ?? l.description ?? l.category}`).join("; ")} />
          )}
          <Row label="Condition" value={state.condition ? CONDITION_LABEL[state.condition] : "—"} />
          <Row label="Destination" value={destinationLabel(state.destination) || "—"} />
          <Row label="Required by" value={state.requiredBy ? date(state.requiredBy) : state.requiredByText ?? <span className="text-graphite-400">Optional</span>} />
          {state.certification && <Row label="Certification" value={state.certification} />}
        </dl>
      ) : (
        <div className="grid gap-3 p-4">
          {state.lines.map((l) => (
            <div key={l.key}>
              <label className="label" htmlFor={`q-${l.key}`}>
                Quantity — {l.partNumber ?? l.description ?? l.category}
              </label>
              <input id={`q-${l.key}`} className="input" inputMode="decimal" value={qty[l.key]} onChange={(e) => setQty({ ...qty, [l.key]: e.target.value.replace(/[^\d.]/g, "") })} />
            </div>
          ))}
          <div>
            <label className="label" htmlFor="cond">
              Condition
            </label>
            <select id="cond" className="input" value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
              {(["NEW", "NEW_OR_APPROVED_ALTERNATIVE", "ANY", "NEW_SURPLUS", "OVERHAULED", "SERVICEABLE"] as Condition[]).map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="dest">
              Destination
            </label>
            <input id="dest" className="input" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="City, country" />
          </div>
          <div>
            <label className="label" htmlFor="reqby">
              Required by (optional)
            </label>
            <input id="reqby" type="date" className="input" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {/* Triggered by the EDIT action button below the card. */}
      {h.interactive && !editing && <button type="button" hidden onClick={() => setEditing(true)} data-testid="edit-requirement" />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-4 py-2.5 sm:grid-cols-[10rem_1fr]">
      <dt className="text-xs font-semibold uppercase tracking-wide text-graphite-500">{label}</dt>
      <dd className="text-graphite-900">{value}</dd>
    </div>
  );
}
