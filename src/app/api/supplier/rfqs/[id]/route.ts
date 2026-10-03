import { requireSupplier } from "@/server/auth/session";
import { notFound } from "@/server/errors";
import { route } from "@/server/http";
import { getSupplierRfq } from "@/server/services/rfq";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, ctx) => {
  const s = await requireSupplier();
  const { id } = await ctx.params;
  const rfq = /^[0-9a-f-]{36}$/i.test(id) ? await getSupplierRfq(s.org.id, id) : null;
  if (!rfq) throw notFound();
  return rfq;
});
