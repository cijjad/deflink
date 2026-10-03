import { getCurrentUser } from "@/server/auth/session";
import { route } from "@/server/http";

export const GET = route(async () => {
  const s = await getCurrentUser();
  if (!s) return { user: null };
  return { user: { id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role, isPlatformAdmin: s.user.isPlatformAdmin, mfaEnabled: s.user.mfaEnabled }, org: { id: s.org.id, name: s.org.name, kind: s.org.kind } };
});
