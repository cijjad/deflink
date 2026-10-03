import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { listNotifications } from "@/server/services/notifications";

export const GET = route(async () => {
  const s = await requireUser();
  return listNotifications(s.user.id);
});
