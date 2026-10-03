import { z } from "zod";
import { requirePermission, requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { clientIp } from "@/server/security/request";
import { rateLimit } from "@/server/security/rate-limit";
import { listMessages, postMessage } from "@/server/services/quotation";

type Ctx = { params: Promise<{ id: string; supplierId: string }> };
const uuid = z.string().uuid();

export const GET = route<Ctx>(async (_req, ctx) => {
  const s = await requireUser();
  const { id, supplierId } = await ctx.params;
  return { messages: await listMessages(s, uuid.parse(id), uuid.parse(supplierId)) };
});

export const POST = route<Ctx>(async (req, ctx) => {
  const s = await requirePermission("message.send");
  rateLimit(`msg:${s.user.id}`, 60, 60_000);
  const { id, supplierId } = await ctx.params;
  const { body } = await readJson(req, z.object({ body: z.string().min(1).max(4000) }));
  return { message: await postMessage(s, uuid.parse(id), uuid.parse(supplierId), body, clientIp(req)) };
});
