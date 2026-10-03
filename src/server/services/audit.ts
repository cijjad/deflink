import "server-only";
import { createHash } from "node:crypto";
import { asc, desc, sql } from "drizzle-orm";
import { db, type Tx } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";

export interface AuditEntry {
  actorUserId?: string | null;
  organizationId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

const GENESIS = "0".repeat(64);
const AUDIT_LOCK_KEY = 7_401_001;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
    .join(",")}}`;
}

function computeHash(prevHash: string, e: AuditEntry, createdAt: Date): string {
  const payload = stable({
    actorUserId: e.actorUserId ?? null,
    organizationId: e.organizationId ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    metadata: e.metadata ?? {},
    ip: e.ip ?? null,
    createdAt: createdAt.toISOString(),
  });
  return createHash("sha256").update(prevHash).update(payload).digest("hex");
}

/** Appends a tamper-evident audit record. Must run inside a transaction (the chain is serialised by an advisory lock). */
export async function audit(tx: Tx, entry: AuditEntry) {
  await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
  const last = await tx.select({ hash: auditLogs.hash }).from(auditLogs).orderBy(desc(auditLogs.seq)).limit(1);
  const prevHash = last[0]?.hash ?? GENESIS;
  // Millisecond precision so the timestamp round-trips through Postgres unchanged.
  const createdAt = new Date(Math.floor(Date.now()));
  await tx.insert(auditLogs).values({
    actorUserId: entry.actorUserId ?? null,
    organizationId: entry.organizationId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
    createdAt,
    prevHash,
    hash: computeHash(prevHash, entry, createdAt),
  });
}

export async function auditStandalone(entry: AuditEntry) {
  await db.transaction((tx) => audit(tx, entry));
}

/** Recomputes the whole chain. Returns the first broken sequence number, or null if intact. */
export async function verifyAuditChain(): Promise<{ ok: boolean; checked: number; brokenAt: number | null }> {
  let prev = GENESIS;
  let checked = 0;
  const batch = 1000;
  let lastSeq = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.seq} > ${lastSeq}`)
      .orderBy(asc(auditLogs.seq))
      .limit(batch);
    if (!rows.length) break;
    for (const r of rows) {
      const expected = computeHash(
        prev,
        {
          actorUserId: r.actorUserId,
          organizationId: r.organizationId,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          metadata: r.metadata as Record<string, unknown>,
          ip: r.ip,
        },
        r.createdAt,
      );
      if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked, brokenAt: r.seq };
      prev = r.hash;
      checked++;
      lastSeq = r.seq;
    }
  }
  return { ok: true, checked, brokenAt: null };
}
