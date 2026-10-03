import { z } from "zod";
import { requirePlatformAdmin } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { revokeVerification } from "@/server/services/admin";

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const s = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const { reason } = await readJson(req, z.object({ reason: z.string().min(3).max(500) }));
  await revokeVerification(s, z.string().uuid().parse(id), reason, clientIp(req));
  return { ok: true };
});
