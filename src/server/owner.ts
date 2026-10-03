import "server-only";
import { getAnonToken, getCurrentUser } from "@/server/auth/session";

/** Who owns a conversation: the signed-in user, plus any anonymous visitor token (so a draft survives sign-in). */
export async function resolveOwner(createAnon = true) {
  const session = await getCurrentUser();
  const anonToken = await getAnonToken(createAnon && !session);
  return { session, owner: { userId: session?.user.id ?? null, anonToken } };
}
