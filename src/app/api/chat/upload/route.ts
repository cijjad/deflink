import { badRequest } from "@/server/errors";
import { route } from "@/server/http";
import { resolveOwner } from "@/server/owner";
import { rateLimit } from "@/server/security/rate-limit";
import { clientIp } from "@/server/security/request";
import { addExtractedLines } from "@/server/services/conversation";
import { detectKind, extractRequirementRows, MAX_UPLOAD_BYTES, storeDocument } from "@/server/services/documents";

export const POST = route(async (req) => {
  rateLimit(`upload:${clientIp(req)}`, 20, 3600_000);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) throw badRequest("File is too large (max 10 MB).");
  const form = await req.formData();
  const file = form.get("file");
  const conversationId = (form.get("conversationId") as string | null) || undefined;
  if (!(file instanceof File)) throw badRequest("Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw badRequest("File is too large (max 10 MB).");
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = detectKind(file.name, buf);
  const { session, owner } = await resolveOwner();
  const rows = await extractRequirementRows(kind, buf);
  const result = rows
    ? await addExtractedLines(conversationId, owner, file.name, rows)
    : null;
  await storeDocument({ filename: file.name, buf, kind, ownerOrgId: session?.org.id ?? null, userId: session?.user.id ?? null, conversationId: result?.conversationId ?? conversationId ?? null });
  if (!result) {
    return {
      conversationId: conversationId ?? null,
      unsupported: true,
      reply: {
        blocks: [{ type: "text", text: "I've stored the file securely. Automatic extraction from PDF, Word and image files is not enabled yet — please upload an Excel or CSV list, or type the items." }],
        actions: [{ type: "UPLOAD", label: "Upload Excel / CSV" }],
      },
    };
  }
  if (!rows!.length) throw badRequest("No requirement lines were found in that file.");
  return result;
});
