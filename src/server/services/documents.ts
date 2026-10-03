import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { parseMessage } from "@/core/conversation/parser";
import { db } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import { AppError, badRequest, notFound } from "@/server/errors";
import { storage } from "@/server/storage";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 500;

type Kind = "xlsx" | "csv" | "pdf" | "docx" | "png" | "jpeg" | "webp";

const MIME: Record<Kind, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Identify the file by its extension AND its leading bytes; reject anything that does not agree. */
export function detectKind(filename: string, buf: Buffer): Kind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const zip = buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (ext === "xlsx" && zip) return "xlsx";
  if (ext === "docx" && zip) return "docx";
  if (ext === "pdf" && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (ext === "png" && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if ((ext === "jpg" || ext === "jpeg") && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (ext === "webp" && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if ((ext === "csv" || ext === "txt") && !buf.includes(0)) return "csv";
  throw new AppError(415, "UNSUPPORTED_FILE", "Supported files: Excel (.xlsx), CSV, PDF, Word (.docx), PNG, JPEG, WEBP.");
}

export interface ExtractedRow {
  partNumber?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  quantityText?: string;
  manufacturer?: string;
}

const HEADERS: Record<keyof ExtractedRow | "nsn", RegExp> = {
  partNumber: /^(part\s*(no\.?|number|#)?|p\/?n|pn|mpn|item\s*code|part\s*code|model(\s*no\.?)?|reference|ref)$/i,
  description: /^(description|desc\.?|nomenclature|item|item\s*name|name|product|details?)$/i,
  quantity: /^(qty\.?|quantity|req(uired)?\s*qty\.?|qty\s*req(uired)?|no\.?\s*of\s*units|units\s*required)$/i,
  unit: /^(unit|uom|u\/m|unit\s*of\s*measure)$/i,
  quantityText: /^$/,
  manufacturer: /^(manufacturer|mfr|mfg|oem|make|brand|maker)$/i,
  nsn: /^(nsn|nato\s*stock\s*number)$/i,
};

function mapHeader(cells: string[]): Partial<Record<keyof typeof HEADERS, number>> {
  const map: Partial<Record<keyof typeof HEADERS, number>> = {};
  cells.forEach((c, i) => {
    const v = c.trim();
    for (const [k, re] of Object.entries(HEADERS) as [keyof typeof HEADERS, RegExp][]) {
      if (k !== "quantityText" && map[k] === undefined && re.test(v)) map[k] = i;
    }
  });
  return map;
}

function rowsFromTable(table: string[][]): ExtractedRow[] {
  const headerIdx = table.slice(0, 10).findIndex((r) => Object.keys(mapHeader(r)).length >= 2);
  if (headerIdx < 0) throw badRequest("I couldn't find a header row. Use columns such as Part Number, Description and Quantity.");
  const map = mapHeader(table[headerIdx]);
  const out: ExtractedRow[] = [];
  for (const r of table.slice(headerIdx + 1)) {
    const get = (k: keyof typeof HEADERS) => (map[k] !== undefined ? (r[map[k]!] ?? "").toString().trim() : "");
    const pn = get("partNumber") || get("nsn");
    const desc = get("description");
    if (!pn && !desc) continue;
    const qtyRaw = get("quantity");
    let quantity: number | undefined;
    let unit = get("unit") ? get("unit").toUpperCase().slice(0, 6) : undefined;
    if (qtyRaw) {
      const n = Number(qtyRaw.replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) quantity = n;
      else {
        const parsed = parseMessage(qtyRaw, { awaiting: "QUANTITY" }).quantity;
        if (parsed) {
          quantity = parsed.value;
          unit ??= parsed.unit;
        }
      }
    }
    out.push({ partNumber: pn || undefined, description: desc || undefined, quantity, unit, quantityText: qtyRaw || undefined, manufacturer: get("manufacturer") || undefined });
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

async function tableFromXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) return [];
  const table: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (table.length > MAX_ROWS + 10) return;
    const values = (row.values as unknown[]).slice(1).map((v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "object") {
        const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
        if (o.richText) return o.richText.map((t) => t.text).join("");
        if (o.text) return String(o.text);
        if (o.result !== undefined) return String(o.result);
        return "";
      }
      return String(v);
    });
    table.push(values);
  });
  return table;
}

export async function extractRequirementRows(kind: Kind, buf: Buffer): Promise<ExtractedRow[] | null> {
  if (kind === "xlsx") return rowsFromTable(await tableFromXlsx(buf));
  if (kind === "csv") {
    const parsed = Papa.parse<string[]>(buf.toString("utf8"), { skipEmptyLines: true });
    return rowsFromTable(parsed.data.slice(0, MAX_ROWS + 10));
  }
  // PDF, Word and images need document intelligence that is not enabled in this version.
  return null;
}

export async function storeDocument(opts: { filename: string; buf: Buffer; kind: Kind; ownerOrgId?: string | null; userId?: string | null; conversationId?: string | null; rfqId?: string | null }) {
  const id = randomUUID();
  const key = `docs/${new Date().toISOString().slice(0, 7)}/${id}`;
  await storage.put(key, opts.buf);
  const [row] = await db
    .insert(documents)
    .values({
      id,
      ownerOrgId: opts.ownerOrgId ?? null,
      uploadedByUserId: opts.userId ?? null,
      conversationId: opts.conversationId ?? null,
      rfqId: opts.rfqId ?? null,
      filename: opts.filename.replace(/[^\w.\- ()]/g, "_").slice(0, 200),
      mimeType: MIME[opts.kind],
      sizeBytes: opts.buf.length,
      sha256: createHash("sha256").update(opts.buf).digest("hex"),
      storageKey: key,
    })
    .returning();
  return row;
}

/** Only the owning organisation may download a document. */
export async function readDocument(orgId: string, documentId: string) {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.ownerOrgId, orgId))).limit(1);
  if (!doc) throw notFound();
  return { doc, data: await storage.get(doc.storageKey) };
}
