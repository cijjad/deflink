import { destroySession } from "@/server/auth/session";
import { route } from "@/server/http";

export const POST = route(async () => {
  await destroySession();
  return { ok: true };
});
