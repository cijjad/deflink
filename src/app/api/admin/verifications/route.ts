import { z } from "zod";
import { requirePlatformAdmin } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { grantVerification } from "@/server/services/admin";

export const POST = route(async (req) => {
  const s = await requirePlatformAdmin();
  const body = await readJson(
    req,
    z.object({ orgId: z.string().uuid(), level: z.enum(["BUSINESS_VERIFIED", "SUPPLIER_VERIFIED", "AUTHORIZED_DISTRIBUTOR", "COMPLIANCE_VERIFIED"]), evidenceNote: z.string().max(2000) }),
  );
  await grantVerification(s, body.orgId, body.level, body.evidenceNote, clientIp(req));
  return { ok: true };
});
