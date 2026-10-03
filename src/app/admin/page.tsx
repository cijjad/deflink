import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ComplianceDecision, CountryRuleForm, DeleteRule, SuspendButton, VerifyChain, VerifyForm } from "@/components/admin/AdminActions";
import { DataBadge, DemoBadge, RfqStatus } from "@/components/ui/Badges";
import { PageHeader } from "@/components/ui/PageHeader";
import { countryName } from "@/core/geo/countries";
import { date, dateTime, humanize } from "@/lib/format";
import { pageSession } from "@/server/page-guard";
import { complianceQueue, listAllRfqs, listCountryRules, listOrganizations, listProducts, recentAudit } from "@/server/services/admin";
import { rfqRef } from "@/server/services/rfq";

export const metadata: Metadata = { title: "Administration" };

const TABS = [
  ["organizations", "Organizations"],
  ["compliance", "Compliance"],
  ["rfqs", "RFQs"],
  ["products", "Products"],
  ["audit", "Audit log"],
] as const;

export default async function AdminPage(props: { searchParams: Promise<{ tab?: string }> }) {
  const s = await pageSession("/admin");
  if (!s.user.isPlatformAdmin) notFound();
  const tab = (await props.searchParams).tab ?? "organizations";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader title="Administration" subtitle="Platform operations" />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-graphite-200">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/admin?tab=${k}`} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === k ? "border-navy-800 text-navy-900" : "border-transparent text-graphite-500"}`}>
            {l}
          </Link>
        ))}
      </nav>
      {tab === "organizations" && <Organizations />}
      {tab === "compliance" && <Compliance />}
      {tab === "rfqs" && <Rfqs />}
      {tab === "products" && <Products />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

async function Organizations() {
  const orgs = await listOrganizations();
  return (
    <div className="grid gap-3">
      {orgs.map((o) => (
        <div key={o.id} className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{o.name}</span>
              <span className="chip bg-graphite-100 text-graphite-700">{humanize(o.kind)}</span>
              <DemoBadge show={o.isDemo} />
              {o.isSuspended && <span className="chip bg-danger-50 text-danger-600">Suspended</span>}
            </div>
            <div className="flex items-center gap-2 text-xs text-graphite-500">
              {countryName(o.country)} · {o.userCount} user{o.userCount === 1 ? "" : "s"}
              {o.kind !== "PLATFORM" && <SuspendButton orgId={o.id} suspended={o.isSuspended} />}
            </div>
          </div>
          {o.kind === "SUPPLIER" && (
            <>
              <ul className="mt-2 space-y-0.5 text-xs text-graphite-700">
                {o.verifications.map((v) => (
                  <li key={v.id}>
                    {humanize(v.level)} — <strong>{humanize(v.state)}</strong>
                    {v.evidenceNote ? ` · ${v.evidenceNote}` : ""}
                  </li>
                ))}
              </ul>
              <VerifyForm orgId={o.id} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

async function Compliance() {
  const [queue, rules] = await Promise.all([complianceQueue(), listCountryRules()]);
  return (
    <div className="space-y-8">
      <section>
        <h2 className="label">Review queue</h2>
        {queue.length === 0 ? (
          <p className="text-sm text-graphite-500">No reviews.</p>
        ) : (
          <div className="grid gap-3">
            {queue.map((q) => (
              <div key={q.review.id} className="card p-4" data-testid="compliance-item">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{q.ref}</span>
                  <span className="chip bg-graphite-100 text-graphite-700">{humanize(q.review.decision)}</span>
                  <span className="text-sm text-graphite-500">
                    {q.buyer} → {q.destination}
                  </span>
                </div>
                <ul className="mt-2 list-disc pl-5 text-sm text-graphite-700">
                  {q.review.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                {q.review.decision === "PENDING" ? <ComplianceDecision reviewId={q.review.id} /> : <p className="mt-2 text-xs text-graphite-500">Notes: {q.review.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="label">Destination country rules</h2>
        <p className="mb-3 text-sm text-graphite-500">
          No sanctions list ships with DefLink. Maintain rules from official sources (e.g. UN Security Council Consolidated List, OFAC SDN, EU and UK consolidated lists) and cite the source for each rule.
        </p>
        <div className="card p-4">
          <CountryRuleForm />
          {rules.length > 0 && (
            <table className="table-base mt-4">
              <thead>
                <tr>
                  <th>Country</th>
                  <th>Action</th>
                  <th>Reason</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.country}>
                    <td>{countryName(r.country)}</td>
                    <td>{humanize(r.action)}</td>
                    <td>{r.reason}</td>
                    <td className="text-xs">{r.source}</td>
                    <td>
                      <DeleteRule country={r.country} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

async function Rfqs() {
  const rows = await listAllRfqs();
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>RFQ</th>
            <th>Status</th>
            <th>Buyer</th>
            <th>Destination</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="font-mono">{rfqRef(r.refNo)}</td>
              <td>
                <RfqStatus status={r.status} />
              </td>
              <td>{r.buyer}</td>
              <td>{r.destination}</td>
              <td>{date(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Products() {
  const rows = await listProducts();
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>Part number</th>
            <th>Description</th>
            <th>Manufacturer</th>
            <th>Export control</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="font-mono">{p.partNumber}</td>
              <td>{p.description}</td>
              <td>{p.manufacturer}</td>
              <td>{humanize(p.exportControlStatus)}</td>
              <td className="space-x-1">
                <DataBadge status={p.dataStatus} />
                <DemoBadge show={p.isDemo} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Audit() {
  const rows = await recentAudit();
  return (
    <div className="space-y-3">
      <VerifyChain />
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Actor</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seq}>
                <td className="text-graphite-400">{r.seq}</td>
                <td className="whitespace-nowrap">{dateTime(r.createdAt)}</td>
                <td className="font-mono text-xs">{r.action}</td>
                <td className="text-xs">
                  {r.entityType} {r.entityId?.slice(0, 8)}
                </td>
                <td className="font-mono text-xs">{r.actorUserId?.slice(0, 8) ?? "—"}</td>
                <td className="text-xs">{r.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
