import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { confirmMfaSetup } from "@/server/services/auth";

export const POST = route(async (req) => {
  const s = await requireUser();
  const { code } = await readJson(req, z.object({ code: z.string().max(10) }));
  await confirmMfaSetup(s, code, clientIp(req));
  return { ok: true };
});
