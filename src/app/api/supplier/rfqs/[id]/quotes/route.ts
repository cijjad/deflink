import { z } from "zod";
import { requireSupplier } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { rateLimit } from "@/server/security/rate-limit";
import { quoteSchema, submitQuotation } from "@/server/services/quotation";

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const s = await requireSupplier("quote.submit");
  rateLimit(`quote:${s.user.id}`, 30, 3600_000);
  const { id } = await ctx.params;
  const input = await readJson(req, quoteSchema);
  return submitQuotation(s, z.string().uuid().parse(id), input, clientIp(req));
});
