import type { Metadata } from "next";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
import { dateTime } from "@/lib/format";
import { db } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import { pageSession } from "@/server/page-guard";
import { threadsForOrg } from "@/server/services/quotation";
import { rfqRef } from "@/server/services/rfq";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const s = await pageSession("/messages");
  const threads = await threadsForOrg(s);
  const supplierIds = [...new Set(threads.map((t) => t.supplierOrgId))];
  const names = supplierIds.length ? new Map((await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, supplierIds))).map((o) => [o.id, o.name])) : new Map();
  const isSupplier = s.org.kind === "SUPPLIER";
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Messages" subtitle="Every conversation is attached to its request" />
      {threads.length === 0 ? (
        <EmptyState title="No messages yet" text={isSupplier ? "Questions from buyers about your RFQs will appear here." : "Ask suppliers questions from any quotation."} />
      ) : (
        <div className="card divide-y divide-graphite-100">
          {threads.map((t) => (
            <Link
              key={`${t.rfqId}-${t.supplierOrgId}`}
              href={isSupplier ? `/supplier/rfq/${t.rfqId}#messages` : `/requests/${t.rfqId}?supplier=${t.supplierOrgId}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-graphite-50"
            >
              <div>
                <div className="font-semibold">{isSupplier ? "Buyer" : names.get(t.supplierOrgId)}</div>
                <div className="font-mono text-xs text-graphite-500">{rfqRef(t.refNo)}</div>
              </div>
              <span className="text-xs text-graphite-500">{dateTime(t.lastMessageAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
