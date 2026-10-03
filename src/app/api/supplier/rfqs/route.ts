import { requireSupplier } from "@/server/auth/session";
import { route } from "@/server/http";
import { listSupplierRfqs } from "@/server/services/rfq";

export const GET = route(async () => {
  const s = await requireSupplier();
  return { rfqs: await listSupplierRfqs(s.org.id) };
});
