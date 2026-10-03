import { z } from "zod";
import { requireBuyer } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { resolveOwner } from "@/server/owner";
import { clientIp } from "@/server/security/request";
import { rateLimit } from "@/server/security/rate-limit";
import { createRfqFromConversation, listBuyerRfqs } from "@/server/services/rfq";

export const GET = route(async () => {
  const s = await requireBuyer();
  return { rfqs: await listBuyerRfqs(s.org.id) };
});

export const POST = route(async (req) => {
  const s = await requireBuyer("rfq.create");
  rateLimit(`rfq:${s.user.id}`, 30, 3600_000);
  const { conversationId } = await readJson(req, z.object({ conversationId: z.string().uuid() }));
  const { owner } = await resolveOwner(false);
  return createRfqFromConversation(s, conversationId, owner, clientIp(req));
});
