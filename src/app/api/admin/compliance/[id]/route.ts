import { z } from "zod";
import { requirePlatformAdmin } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { decideCompliance } from "@/server/services/rfq";

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const s = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const { decision, notes } = await readJson(req, z.object({ decision: z.enum(["APPROVED", "REJECTED"]), notes: z.string().min(3).max(2000) }));
  await decideCompliance(s, z.string().uuid().parse(id), decision, notes, clientIp(req));
  return { ok: true };
});
