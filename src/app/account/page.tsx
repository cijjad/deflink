import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { MfaSetup, SignOutButton } from "@/components/account/AccountActions";
import { VerificationBadges } from "@/components/ui/Badges";
import { PageHeader } from "@/components/ui/PageHeader";
import { countryName } from "@/core/geo/countries";
import { date, humanize } from "@/lib/format";
import { ROLE_LABEL } from "@/server/auth/rbac";
import { db } from "@/server/db/client";
import { supplierVerifications } from "@/server/db/schema";
import { pageSession } from "@/server/page-guard";
import { supplierBadges } from "@/server/services/search";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const s = await pageSession("/account");
  const vers = s.org.kind === "SUPPLIER" ? await db.select().from(supplierVerifications).where(eq(supplierVerifications.organizationId, s.org.id)).orderBy(desc(supplierVerifications.createdAt)) : [];
  const badges = s.org.kind === "SUPPLIER" ? ((await supplierBadges([s.org.id])).get(s.org.id) ?? []) : [];
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <PageHeader title="Account" action={<SignOutButton />} />
      <div className="card divide-y divide-graphite-100">
        <Row k="Name" v={s.user.name} />
        <Row k="E-mail" v={s.user.email} />
        <Row k="Organization" v={`${s.org.name}${s.org.isDemo ? " (DEMO)" : ""}`} />
        <Row k="Account type" v={humanize(s.org.kind)} />
        <Row k="Role" v={ROLE_LABEL[s.user.role]} />
        <Row k="Country" v={countryName(s.org.country)} />
      </div>
      {s.org.kind === "SUPPLIER" && (
        <section className="mt-6">
          <h2 className="label">Verification</h2>
          <div className="card space-y-3 p-4">
            <VerificationBadges levels={badges} />
            <ul className="space-y-1 text-sm text-graphite-700">
              {vers.map((v) => (
                <li key={v.id}>
                  {humanize(v.level)} — {humanize(v.state)}
                  {v.reviewedAt ? ` · ${date(v.reviewedAt)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <section className="mt-6">
        <h2 className="label">Security</h2>
        <div className="card p-4">
          <MfaSetup enabled={s.user.mfaEnabled} />
        </div>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-3 text-sm">
      <span className="text-graphite-500">{k}</span>
      <span>{v}</span>
    </div>
  );
}
