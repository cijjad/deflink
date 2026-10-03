"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="btn-secondary"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        try {
          sessionStorage.clear();
        } catch {
          /* ignore */
        }
        router.push("/");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

export function MfaSetup({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (enabled) return <p className="text-sm text-ok-600">Two-factor authentication is on.</p>;
  return (
    <div className="space-y-3">
      {!setup ? (
        <button
          className="btn-secondary"
          onClick={async () => {
            const res = await fetch("/api/auth/mfa/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            const data = await res.json();
            if (res.ok) setSetup(data);
            else setMsg(data?.error?.message);
          }}
        >
          Turn on two-factor authentication
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-graphite-700">Scan with an authenticator app (e.g. Microsoft Authenticator, Google Authenticator), then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated server-side */}
          <img src={setup.qrDataUrl} alt="QR code for authenticator app" width={180} height={180} className="rounded-lg border border-graphite-200" />
          <p className="break-all font-mono text-xs text-graphite-500">Key: {setup.secret}</p>
          <div className="flex gap-2">
            <input className="input max-w-40 font-mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Code" />
            <button
              className="btn-primary"
              onClick={async () => {
                const res = await fetch("/api/auth/mfa/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
                const data = await res.json();
                if (!res.ok) return setMsg(data?.error?.message);
                router.refresh();
              }}
            >
              Confirm
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-danger-600">{msg}</p>}
    </div>
  );
}
