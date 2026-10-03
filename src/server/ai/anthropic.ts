import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { detectCategory, normalizePartNumber, parseMessage, resolvePlace } from "@/core/conversation/parser";
import type { Intent, ParsedMessage } from "@/core/conversation/types";
import { env } from "@/server/env";
import type { ExtractContext, RequirementExtractor } from "./extractor";

const CONDITIONS = ["NEW", "NEW_OR_APPROVED_ALTERNATIVE", "ANY", "NEW_SURPLUS", "OVERHAULED", "SERVICEABLE", "REPAIRED", "AS_REMOVED"] as const;
const INTENTS = ["GREETING", "DONT_KNOW", "GET_QUOTES", "WHO_MAKES", "AVAILABILITY", "PRICE", "ALTERNATIVE", "FIND_SUPPLIERS", "WHAT_NEEDED", "DIFFERENCE", "RESET", "UPLOAD", "YES", "NO", "LEAD_TIME"] as const;

const Quantity = z.object({
  value: z.number(),
  unit: z.enum(["EA", "SET", "PR", "KT", "BX", "PK", "M", "KG", "L", "RL", "DR", "LOT", "CTN"]),
  approximate: z.boolean(),
  text: z.string(),
});

const Extraction = z.object({
  items: z.array(
    z.object({
      quantity: Quantity.nullable(),
      part_number: z.string().nullable(),
      nsn: z.string().nullable(),
      description: z.string().nullable(),
    }),
  ),
  bare_quantity: Quantity.nullable(),
  condition: z.enum(CONDITIONS).nullable(),
  destination_text: z.string().nullable(),
  source_region_text: z.string().nullable(),
  required_by_iso_date: z.string().nullable(),
  certification: z.string().nullable(),
  intents: z.array(z.enum(INTENTS)),
  purchase_intent: z.boolean(),
});

const SYSTEM = `You convert a buyer's message in a procurement conversation into structured data.
Rules:
- Extract ONLY what the user wrote. Never invent or correct part numbers, NSNs, manufacturers, places or dates.
- part_number must be copied exactly as written by the user. If unsure, leave it null.
- bare_quantity is a quantity with no item (e.g. "I need 50", "two dozen").
- "awaiting" tells you which question the assistant just asked; a short answer usually answers it.
- destination_text is where goods must be delivered. source_region_text is where to look for suppliers ("in Europe").
- condition NEW_OR_APPROVED_ALTERNATIVE only when the user accepts alternatives.`;

/** Uses Claude for extraction, guarded so its output can only restate what the user typed. Falls back to rules on any failure. */
export class AnthropicExtractor implements RequirementExtractor {
  readonly name = "anthropic";
  private client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 15_000, maxRetries: 1 });

  constructor(private fallback: RequirementExtractor) {}

  async extract(text: string, ctx: ExtractContext): Promise<ParsedMessage> {
    const rules = parseMessage(text, ctx);
    if (text.length > 4000) return rules;
    try {
      // Only the message text and the pending question are sent — no user, organisation or RFQ data.
      const response = await this.client.messages.parse({
        model: env.AI_MODEL,
        max_tokens: 2000,
        output_config: { effort: env.AI_EFFORT, format: zodOutputFormat(Extraction) },
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify({ awaiting: ctx.awaiting ?? null, message: text }) }],
      });
      if (response.stop_reason === "refusal" || !response.parsed_output) return rules;
      return toParsed(text, response.parsed_output, rules);
    } catch (err) {
      if (err instanceof Anthropic.APIError) console.warn(`AI extraction unavailable (${err.status}); using rules.`);
      else console.warn("AI extraction failed; using rules.", err);
      return this.fallback.extract(text, ctx);
    }
  }
}

/** Anti-fabrication guard: an identifier is kept only if it literally appears in the user's text. */
function appearsInText(value: string, text: string) {
  const v = normalizePartNumber(value);
  return v.length > 0 && normalizePartNumber(text).includes(v);
}

function toParsed(raw: string, x: z.infer<typeof Extraction>, rules: ParsedMessage): ParsedMessage {
  const items = x.items
    .map((i) => {
      const partNumber = i.part_number && appearsInText(i.part_number, raw) ? i.part_number : undefined;
      const nsn = i.nsn && appearsInText(i.nsn, raw) ? i.nsn : undefined;
      const text = i.description?.trim() || undefined;
      return { quantity: i.quantity ?? undefined, partNumber, nsn, text, category: text ? detectCategory(text) : undefined };
    })
    .filter((i) => i.partNumber || i.nsn || i.text);
  const destination = x.destination_text && raw.toLowerCase().includes(x.destination_text.toLowerCase().split(",")[0].trim())
    ? resolvePlace(x.destination_text) ?? { text: x.destination_text }
    : rules.destination;
  return {
    raw,
    items,
    quantity: x.bare_quantity ?? undefined,
    condition: x.condition ?? undefined,
    destination,
    sourceRegion: rules.sourceRegion,
    requiredBy: x.required_by_iso_date && /^\d{4}-\d{2}-\d{2}$/.test(x.required_by_iso_date) ? x.required_by_iso_date : rules.requiredBy,
    requiredByText: x.required_by_iso_date ?? rules.requiredByText,
    certification: x.certification ?? undefined,
    intents: x.intents as Intent[],
    purchaseIntent: x.purchase_intent,
  };
}
