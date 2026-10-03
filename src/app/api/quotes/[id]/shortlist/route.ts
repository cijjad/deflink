import { z } from "zod";
import { requireBuyer } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { setShortlist } from "@/server/services/rfq";

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const s = await requireBuyer("quote.shortlist");
  const { id } = await ctx.params;
  const { shortlisted } = await readJson(req, z.object({ shortlisted: z.boolean() }));
  await setShortlist(s, z.string().uuid().parse(id), shortlisted, clientIp(req));
  return { ok: true };
});
