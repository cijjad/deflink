import { z } from "zod";
import { requirePlatformAdmin } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { deleteCountryRule, upsertCountryRule } from "@/server/services/admin";

export const POST = route(async (req) => {
  const s = await requirePlatformAdmin();
  const body = await readJson(req, z.object({ country: z.string().length(2), action: z.enum(["REVIEW", "BLOCK"]), reason: z.string().min(3).max(500), source: z.string().max(500) }));
  await upsertCountryRule(s, body, clientIp(req));
  return { ok: true };
});

export const DELETE = route(async (req) => {
  const s = await requirePlatformAdmin();
  const { country } = await readJson(req, z.object({ country: z.string().length(2) }));
  await deleteCountryRule(s, country, clientIp(req));
  return { ok: true };
});
