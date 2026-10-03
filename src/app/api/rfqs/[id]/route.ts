import { requireBuyer } from "@/server/auth/session";
import { notFound } from "@/server/errors";
import { route } from "@/server/http";
import { getBuyerRfq } from "@/server/services/rfq";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, ctx) => {
  const s = await requireBuyer();
  const { id } = await ctx.params;
  const rfq = /^[0-9a-f-]{36}$/i.test(id) ? await getBuyerRfq(s.org.id, id) : null;
  if (!rfq) throw notFound();
  return rfq;
});
