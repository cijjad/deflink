"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(url: string, body: object, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return res.ok ? null : (data?.error?.message ?? "Request failed.");
}

const LEVELS = [
  ["BUSINESS_VERIFIED", "Business verified"],
  ["SUPPLIER_VERIFIED", "Supplier verified"],
  ["AUTHORIZED_DISTRIBUTOR", "Authorized distributor"],
  ["COMPLIANCE_VERIFIED", "Compliance verified"],
];

export function VerifyForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [level, setLevel] = useState("BUSINESS_VERIFIED");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
      <select className="input !min-h-9 !py-1.5" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
        {LEVELS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <input className="input !min-h-9 !py-1.5" placeholder="Evidence reviewed (registry no., documents…)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Evidence" />
      <button
        className="btn-primary !min-h-9 !py-1.5"
        onClick={async () => {
          const e = await post("/api/admin/verifications", { orgId, level, evidenceNote: note });
          setErr(e);
          if (!e) {
            setNote("");
            router.refresh();
          }
        }}
      >
        Record verification
      </button>
      {err && <p className="text-sm text-danger-600 sm:col-span-3">{err}</p>}
    </div>
  );
}

export function SuspendButton({ orgId, suspended }: { orgId: string; suspended: boolean }) {
  const router = useRouter();
  return (
    <button
      className="btn-ghost !min-h-8 !px-2 !py-1 text-xs"
      onClick={async () => {
        if (!confirm(suspended ? "Reinstate this organization?" : "Suspend this organization? Its users lose access immediately.")) return;
        await post(`/api/admin/organizations/${orgId}/suspend`, { suspended: !suspended });
        router.refresh();
      }}
    >
      {suspended ? "Reinstate" : "Suspend"}
    </button>
  );
}

export function ComplianceDecision({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const decide = async (decision: "APPROVED" | "REJECTED") => {
    const e = await post(`/api/admin/compliance/${reviewId}`, { decision, notes });
    setErr(e);
    if (!e) router.refresh();
  };
  return (
    <div className="mt-2 grid gap-2">
      <input className="input !min-h-9 !py-1.5" placeholder="Decision notes (documents checked, licence ref…)" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Decision notes" />
      <div className="flex gap-2">
        <button className="btn-primary !min-h-9 !py-1.5" onClick={() => decide("APPROVED")}>
          Approve &amp; send
        </button>
        <button className="btn-secondary !min-h-9 !py-1.5" onClick={() => decide("REJECTED")}>
          Reject
        </button>
      </div>
      {err && <p className="text-sm text-danger-600">{err}</p>}
    </div>
  );
}

export function CountryRuleForm() {
  const router = useRouter();
  const [f, setF] = useState({ country: "", action: "REVIEW", reason: "", source: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-2 sm:grid-cols-[6rem_8rem_1fr_1fr_auto]">
      <input className="input !min-h-9 !py-1.5 uppercase" placeholder="ISO" maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} aria-label="Country code" />
      <select className="input !min-h-9 !py-1.5" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} aria-label="Action">
        <option value="REVIEW">Review</option>
        <option value="BLOCK">Block</option>
      </select>
      <input className="input !min-h-9 !py-1.5" placeholder="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-label="Reason" />
      <input className="input !min-h-9 !py-1.5" placeholder="Official source (list, regulation, date)" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} aria-label="Source" />
      <button
        className="btn-primary !min-h-9 !py-1.5"
        onClick={async () => {
          const e = await post("/api/admin/country-rules", f);
          setErr(e);
          if (!e) {
            setF({ country: "", action: "REVIEW", reason: "", source: "" });
            router.refresh();
          }
        }}
      >
        Save rule
      </button>
      {err && <p className="text-sm text-danger-600 sm:col-span-5">{err}</p>}
    </div>
  );
}

export function DeleteRule({ country }: { country: string }) {
  const router = useRouter();
  return (
    <button
      className="text-xs font-semibold text-danger-600"
      onClick={async () => {
        await post("/api/admin/country-rules", { country }, "DELETE");
        router.refresh();
      }}
    >
      Remove
    </button>
  );
}

export function VerifyChain() {
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <button
        className="btn-secondary !min-h-9 !py-1.5"
        onClick={async () => {
          const res = await fetch("/api/admin/audit/verify");
          const d = await res.json();
          setResult(d.ok ? `Chain intact — ${d.checked} records verified.` : `Chain BROKEN at record #${d.brokenAt}.`);
        }}
      >
        Verify integrity
      </button>
      {result && <span className={`text-sm ${result.startsWith("Chain intact") ? "text-ok-600" : "text-danger-600"}`}>{result}</span>}
    </div>
  );
}
