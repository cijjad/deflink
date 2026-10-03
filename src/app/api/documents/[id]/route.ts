import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { readDocument } from "@/server/services/documents";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, ctx) => {
  const s = await requireUser();
  const { id } = await ctx.params;
  const { doc, data } = await readDocument(s.org.id, z.string().uuid().parse(id));
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${doc.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
