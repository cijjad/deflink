import "server-only";
import { parseMessage } from "@/core/conversation/parser";
import type { Awaiting, ParsedMessage } from "@/core/conversation/types";
import { env } from "@/server/env";
import { AnthropicExtractor } from "./anthropic";

export interface ExtractContext {
  awaiting?: Awaiting;
  now?: Date;
}

/**
 * Turns what the user typed into structure. Implementations must never add facts
 * (part numbers, suppliers, prices) that are not in the user's own words.
 */
export interface RequirementExtractor {
  readonly name: string;
  extract(text: string, ctx: ExtractContext): Promise<ParsedMessage>;
}

export class RulesExtractor implements RequirementExtractor {
  readonly name = "rules";
  async extract(text: string, ctx: ExtractContext) {
    return parseMessage(text, ctx);
  }
}

let instance: RequirementExtractor | null = null;

export function getExtractor(): RequirementExtractor {
  if (instance) return instance;
  const provider = env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : "rules");
  instance = provider === "anthropic" && env.ANTHROPIC_API_KEY ? new AnthropicExtractor(new RulesExtractor()) : new RulesExtractor();
  return instance;
}
