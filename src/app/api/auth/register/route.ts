import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { register, registerSchema } from "@/server/services/auth";

export const POST = route(async (req) => {
  const input = await readJson(req, registerSchema);
  return register(input, { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? undefined });
});
