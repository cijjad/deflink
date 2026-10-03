import type { DataLabel } from "@/core/conversation/types";

const DATA: Record<DataLabel, { label: string; cls: string; title: string }> = {
  VERIFIED: { label: "Verified", cls: "bg-ok-50 text-ok-600", title: "Checked by the platform" },
  SUPPLIER_PROVIDED: { label: "Supplier provided", cls: "bg-accent-50 text-accent-600", title: "Reported by the supplier, not independently verified" },
  ESTIMATED: { label: "Estimated", cls: "bg-warn-50 text-warn-600", title: "An estimate — not a quotation" },
  HISTORICAL: { label: "Historical", cls: "bg-graphite-100 text-graphite-700", title: "From past transactions — may be out of date" },
  PENDING_VERIFICATION: { label: "Pending verification", cls: "bg-graphite-100 text-graphite-500", title: "Not yet verified" },
};

export function DataBadge({ status }: { status: DataLabel | string }) {
  const d = DATA[status as DataLabel] ?? DATA.PENDING_VERIFICATION;
  return (
    <span className={`chip ${d.cls}`} title={d.title}>
      {d.label}
    </span>
  );
}

export function DemoBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="chip bg-warn-50 text-warn-600 ring-1 ring-warn-600/20" title="Fictional sample data for development and testing">
      Demo
    </span>
  );
}

const VERIFICATION: Record<string, string> = {
  BUSINESS_VERIFIED: "Business verified",
  SUPPLIER_VERIFIED: "Supplier verified",
  AUTHORIZED_DISTRIBUTOR: "Authorized distributor",
  COMPLIANCE_VERIFIED: "Compliance verified",
};

/** Only renders levels whose verification was actually approved (the server passes approved levels only). */
export function VerificationBadges({ levels }: { levels: string[] }) {
  if (!levels.length) return <span className="chip bg-graphite-100 text-graphite-500">Not verified</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {levels.map((l) => (
        <span key={l} className="chip bg-navy-800/5 text-navy-700 ring-1 ring-navy-700/15">
          <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
            <path fill="currentColor" d="M6.5 11.2 3.3 8l1-1 2.2 2.2 5.2-5.2 1 1z" />
          </svg>
          {VERIFICATION[l] ?? l}
        </span>
      ))}
    </span>
  );
}

const RFQ_STATUS: Record<string, string> = {
  DRAFT: "bg-graphite-100 text-graphite-700",
  COMPLIANCE_REVIEW: "bg-warn-50 text-warn-600",
  OPEN: "bg-accent-50 text-accent-600",
  QUOTED: "bg-ok-50 text-ok-600",
  CLOSED: "bg-graphite-100 text-graphite-700",
  CANCELLED: "bg-graphite-100 text-graphite-500",
  REJECTED: "bg-danger-50 text-danger-600",
};
const RFQ_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  COMPLIANCE_REVIEW: "Compliance review",
  OPEN: "Awaiting quotes",
  QUOTED: "Quotes received",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  REJECTED: "Not approved",
};

export function RfqStatus({ status }: { status: string }) {
  return <span className={`chip ${RFQ_STATUS[status] ?? RFQ_STATUS.DRAFT}`}>{RFQ_LABEL[status] ?? status}</span>;
}

const ID: Record<string, [string, string]> = {
  EXACT: ["Exact match", "bg-ok-50 text-ok-600"],
  ITEM_TYPE: ["Identified · item type", "bg-accent-50 text-accent-600"],
  NEEDS_CONFIRMATION: ["Needs confirmation", "bg-warn-50 text-warn-600"],
  NOT_IDENTIFIED: ["Not identified", "bg-danger-50 text-danger-600"],
  PENDING: ["Checking", "bg-graphite-100 text-graphite-500"],
};

export function IdentificationBadge({ status }: { status: string }) {
  const [label, cls] = ID[status] ?? ID.PENDING;
  return <span className={`chip ${cls}`}>{label}</span>;
}

const MATCH: Record<string, [string, string]> = {
  EXACT: ["Exact match", "bg-ok-50 text-ok-600"],
  CROSS_REFERENCE: ["Documented cross-reference", "bg-accent-50 text-accent-600"],
  POSSIBLE: ["Possible match", "bg-warn-50 text-warn-600"],
  ALTERNATIVE: ["Alternative · unverified", "bg-graphite-100 text-graphite-700"],
};

export function MatchBadge({ match }: { match: string }) {
  const [label, cls] = MATCH[match] ?? MATCH.POSSIBLE;
  return <span className={`chip ${cls}`}>{label}</span>;
}
