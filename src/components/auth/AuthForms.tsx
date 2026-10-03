"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { COUNTRIES } from "@/core/geo/countries";

function safeNext(next: string | undefined) {
  // Only allow same-site relative paths (prevents open redirects).
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

async function postJson(url: string, body: object) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function LoginForm({ next, reason }: { next?: string; reason?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await postJson("/api/auth/login", { email, password });
        setBusy(false);
        if (!r.ok) return setError(r.data?.error?.message ?? "Sign-in failed.");
        const dest = next ? safeNext(next) : (r.data.home as string | undefined) ?? "/";
        if (r.data.mfaRequired) router.push(`/mfa?next=${encodeURIComponent(dest)}`);
        else {
          router.push(dest);
          router.refresh();
        }
      }}
    >
      {reason === "quote" && <p className="rounded-lg bg-accent-50 px-3 py-2.5 text-sm text-navy-700">Sign in to request quotations. Your requirement is saved and will be sent right after.</p>}
      <div>
        <label className="label" htmlFor="email">Business e-mail</label>
        <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <p className="text-center text-sm text-graphite-500">
        New here? <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-accent-600">Create an account</Link>
      </p>
    </form>
  );
}

const SUPPLIER_TYPES: [string, string][] = [
  ["OEM", "OEM"],
  ["MANUFACTURER", "Manufacturer"],
  ["AUTHORIZED_DISTRIBUTOR", "Authorized distributor"],
  ["STOCKIST", "Stockist"],
  ["DEALER", "Dealer"],
  ["MRO", "MRO organization"],
  ["INDUSTRIAL_SUPPLIER", "Industrial supplier"],
  ["LOGISTICS_PROVIDER", "Logistics / service provider"],
  ["SOURCING_COMPANY", "Sourcing / indenting company"],
];

export function RegisterForm({ next }: { next?: string }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", organization: "", email: "", country: "", mobile: "", password: "", accountType: "BUYER", supplierType: "STOCKIST", categories: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const countries = Object.entries(COUNTRIES).sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const body = {
          ...f,
          categories: f.accountType === "SUPPLIER" ? f.categories.split(",").map((c) => c.trim()).filter(Boolean) : undefined,
          supplierType: f.accountType === "SUPPLIER" ? f.supplierType : undefined,
        };
        const r = await postJson("/api/auth/register", body);
        setBusy(false);
        if (!r.ok) {
          const detail = Array.isArray(r.data?.error?.details) ? r.data.error.details.map((d: { message: string }) => d.message).join(" ") : "";
          return setError(`${r.data?.error?.message ?? "Registration failed."} ${detail}`.trim());
        }
        router.push(f.accountType === "SUPPLIER" ? "/supplier" : safeNext(next));
        router.refresh();
      }}
    >
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-graphite-100 p-1" role="radiogroup" aria-label="Account type">
        {[
          ["BUYER", "I need to buy"],
          ["SUPPLIER", "I supply products"],
        ].map(([v, l]) => (
          <button
            type="button"
            key={v}
            role="radio"
            aria-checked={f.accountType === v}
            onClick={() => setF({ ...f, accountType: v })}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${f.accountType === v ? "bg-white text-navy-900 shadow-sm" : "text-graphite-500"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input id="name" className="input" autoComplete="name" required value={f.name} onChange={set("name")} />
        </div>
        <div>
          <label className="label" htmlFor="org">Organization</label>
          <input id="org" className="input" autoComplete="organization" required value={f.organization} onChange={set("organization")} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="remail">Business e-mail</label>
        <input id="remail" className="input" type="email" autoComplete="email" required value={f.email} onChange={set("email")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="country">Country</label>
          <select id="country" className="input" required value={f.country} onChange={set("country")}>
            <option value="">Select…</option>
            {countries.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="mobile">Mobile</label>
          <input id="mobile" className="input" type="tel" autoComplete="tel" placeholder="+92 300 1234567" value={f.mobile} onChange={set("mobile")} />
        </div>
      </div>
      {f.accountType === "SUPPLIER" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="stype">Supplier type</label>
            <select id="stype" className="input" value={f.supplierType} onChange={set("supplierType")}>
              {SUPPLIER_TYPES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="cats">Product categories</label>
            <input id="cats" className="input" placeholder="Pumps, Filters, Bearings" value={f.categories} onChange={set("categories")} />
          </div>
        </div>
      )}
      <div>
        <label className="label" htmlFor="rpassword">Password</label>
        <input id="rpassword" className="input" type="password" autoComplete="new-password" required minLength={10} value={f.password} onChange={set("password")} />
        <p className="mt-1 text-xs text-graphite-500">At least 10 characters, with letters and a number.</p>
      </div>
      {f.accountType === "SUPPLIER" && (
        <p className="rounded-lg bg-graphite-100 px-3 py-2.5 text-xs text-graphite-700">
          Supplier accounts receive RFQs after business verification is completed by our team. You&apos;ll be notified.
        </p>
      )}
      {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      <p className="text-center text-sm text-graphite-500">
        Already registered? <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-accent-600">Sign in</Link>
      </p>
    </form>
  );
}

export function MfaForm({ next }: { next?: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await postJson("/api/auth/mfa/verify", { code });
        if (!r.ok) return setError(r.data?.error?.message ?? "Invalid code.");
        router.push(safeNext(next));
        router.refresh();
      }}
    >
      <div>
        <label className="label" htmlFor="code">6-digit code from your authenticator app</label>
        <input id="code" className="input text-center font-mono text-xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      </div>
      {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
      <button className="btn-primary w-full">Verify</button>
    </form>
  );
}
