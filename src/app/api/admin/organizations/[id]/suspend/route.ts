import { z } from "zod";
import { requirePlatformAdmin } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { setSuspended } from "@/server/services/admin";

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const s = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const { suspended } = await readJson(req, z.object({ suspended: z.boolean() }));
  await setSuspended(s, z.string().uuid().parse(id), suspended, clientIp(req));
  return { ok: true };
});
