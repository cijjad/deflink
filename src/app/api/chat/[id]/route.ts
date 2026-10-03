import { notFound } from "@/server/errors";
import { route } from "@/server/http";
import { resolveOwner } from "@/server/owner";
import { getConversation } from "@/server/services/conversation";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { owner } = await resolveOwner(false);
  const conv = /^[0-9a-f-]{36}$/i.test(id) ? await getConversation(id, owner) : null;
  if (!conv) throw notFound();
  return conv;
});
