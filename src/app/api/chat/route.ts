import { z } from "zod";
import { readJson, route } from "@/server/http";
import { resolveOwner } from "@/server/owner";
import { rateLimit } from "@/server/security/rate-limit";
import { clientIp } from "@/server/security/request";
import { chatTurn } from "@/server/services/conversation";

const schema = z.object({
  conversationId: z.string().uuid().optional(),
  text: z.string().max(4000).optional(),
  action: z.object({ type: z.string().max(40), value: z.string().max(200).optional() }).optional(),
});

export const POST = route(async (req) => {
  rateLimit(`chat:${clientIp(req)}`, 60, 60_000);
  const body = await readJson(req, schema);
  const { owner } = await resolveOwner();
  return chatTurn({ conversationId: body.conversationId, text: body.text, action: body.action as never }, owner);
});
