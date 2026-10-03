import { z } from "zod";
import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { login } from "@/server/services/auth";

export const POST = route(async (req) => {
  const { email, password } = await readJson(req, z.object({ email: z.string().max(200), password: z.string().max(200) }));
  return login(email, password, { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? undefined });
});
