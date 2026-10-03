import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { markRead } from "@/server/services/notifications";

export const POST = route(async (req) => {
  const s = await requireUser();
  const { ids } = await readJson(req, z.object({ ids: z.array(z.string().uuid()).max(200).optional() }));
  await markRead(s.user.id, ids);
  return { ok: true };
});
