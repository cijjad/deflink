import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { unauthorized } from "@/server/errors";
import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { verifyMfaLogin } from "@/server/services/auth";

export const POST = route(async (req) => {
  const s = await getCurrentUser({ allowMfaPending: true });
  if (!s) throw unauthorized();
  const { code } = await readJson(req, z.object({ code: z.string().max(10) }));
  await verifyMfaLogin(s, code, clientIp(req));
  return { ok: true };
});
