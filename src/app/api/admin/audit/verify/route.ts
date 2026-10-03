import { requirePlatformAdmin } from "@/server/auth/session";
import { route } from "@/server/http";
import { verifyAuditChain } from "@/server/services/audit";

export const GET = route(async () => {
  await requirePlatformAdmin();
  return verifyAuditChain();
});
