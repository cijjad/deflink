import "server-only";
import { and, asc, eq } from "drizzle-orm";
import {
  activeLine,
  applyAction,
  applyMessage,
  chooseCandidate,
  composeReply,
  missingFields,
  newLineKey,
  summariseCounts,
  type ComposeContext,
} from "@/core/conversation/engine";
import { detectCategory, formatQuantity, resolvePlace } from "@/core/conversation/parser";
import {
  emptyState,
  type AssistantReply,
  type ClientAction,
  type ConversationState,
  type DataLabel,
  type ParsedMessage,
  type ProductHit,
  type ReplyBlock,
  type RequirementLine,
} from "@/core/conversation/types";
import { countryName, REGIONS, titleCase } from "@/core/geo/countries";
import { getExtractor } from "@/server/ai/extractor";
import { sha256 } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { conversationMessages, conversations, organizations, supplierOemRelationships } from "@/server/db/schema";
import { badRequest } from "@/server/errors";
import {
  findManufacturer,
  getProduct,
  productSources,
  searchNsn,
  searchPartNumber,
  searchText,
  supplierBadges,
  toCandidate,
  type PartSearchResult,
} from "./search";

export interface Owner {
  userId?: string | null;
  anonToken?: string | null;
}

export interface TurnInput {
  conversationId?: string;
  text?: string;
  action?: ClientAction;
}

export interface TurnResult {
  conversationId: string;
  state: ConversationState;
  reply: AssistantReply;
  ready: boolean;
}

/* ------------------------------------------------------- persistence */

async function loadOwned(id: string | undefined, owner: Owner) {
  if (!id) return null;
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  const conv = rows[0];
  if (!conv) return null;
  const anonHash = owner.anonToken ? sha256(owner.anonToken) : null;
  const ownedByUser = owner.userId && conv.userId === owner.userId;
  const ownedByAnon = anonHash && conv.anonTokenHash === anonHash;
  if (!ownedByUser && !ownedByAnon) return null;
  // A visitor who signs in keeps their draft.
  if (owner.userId && !conv.userId && ownedByAnon) {
    await db.update(conversations).set({ userId: owner.userId }).where(eq(conversations.id, conv.id));
    conv.userId = owner.userId;
  }
  return conv;
}

export async function getConversation(id: string, owner: Owner) {
  const conv = await loadOwned(id, owner);
  if (!conv) return null;
  const msgs = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conv.id))
    .orderBy(asc(conversationMessages.createdAt));
  return { id: conv.id, state: conv.state as ConversationState, rfqId: conv.rfqId, messages: msgs.map((m) => ({ role: m.role, content: m.content })) };
}

async function save(convId: string | null, owner: Owner, state: ConversationState, userContent: object, reply: AssistantReply) {
  return db.transaction(async (tx) => {
    let id = convId;
    if (!id) {
      const [row] = await tx
        .insert(conversations)
        .values({ userId: owner.userId ?? null, anonTokenHash: owner.anonToken ? sha256(owner.anonToken) : null, state })
        .returning({ id: conversations.id });
      id = row.id;
    } else {
      await tx.update(conversations).set({ state, updatedAt: new Date() }).where(eq(conversations.id, id));
    }
    await tx.insert(conversationMessages).values([
      { conversationId: id, role: "user", content: userContent },
      { conversationId: id, role: "assistant", content: reply },
    ]);
    return id;
  });
}

/* ------------------------------------------------------ identification */

type Hits = ComposeContext["hits"][string];

async function identifyLine(line: RequirementLine): Promise<Hits | undefined> {
  let result: PartSearchResult | undefined;
  if (line.partNumber) result = await searchPartNumber(line.partNumber);
  else if (line.nsn) result = await searchNsn(line.nsn);

  if (result) {
    if (result.exact.length === 1) {
      fillFromHit(line, result.exact[0]);
      line.identification = "EXACT";
    } else if (result.exact.length > 1) {
      line.identification = "NEEDS_CONFIRMATION";
      line.candidates = result.exact.map(toCandidate);
    } else if (result.possible.length) {
      line.identification = "NEEDS_CONFIRMATION";
      line.candidates = result.possible.slice(0, 3).map(toCandidate);
    } else {
      line.identification = line.category ? "ITEM_TYPE" : "NOT_IDENTIFIED";
      if (line.identification === "ITEM_TYPE") line.description ??= line.category;
    }
    return result;
  }

  // Description only.
  const text = line.description ?? line.query;
  const hits = await searchText(text, line.category);
  if (line.category) {
    line.identification = "ITEM_TYPE";
    return { exact: [], possible: hits.slice(0, 4), alternatives: [] };
  }
  if (hits.length) {
    line.identification = "NEEDS_CONFIRMATION";
    line.candidates = hits.slice(0, 3).map(toCandidate);
    return { exact: [], possible: hits, alternatives: [] };
  }
  line.identification = "NOT_IDENTIFIED";
  return undefined;
}

function fillFromHit(line: RequirementLine, hit: ProductHit) {
  line.productId = hit.productId;
  line.partNumber = hit.partNumber;
  line.manufacturer = hit.manufacturer ?? undefined;
  line.description = hit.description;
  line.category = hit.category;
  line.nsn = hit.nsn ?? line.nsn;
  line.isDemo = hit.isDemo;
  line.exportControlled = hit.exportControlled;
  line.candidates = undefined;
}

export async function identifyLines(lines: RequirementLine[], keys?: string[]) {
  const hits: ComposeContext["hits"] = {};
  for (const line of lines) {
    if (keys && !keys.includes(line.key)) continue;
    const h = await identifyLine(line);
    if (h) hits[line.key] = h;
  }
  return hits;
}

/* --------------------------------------------------------------- facts */

const STATUS_TEXT: Record<string, string> = {
  VERIFIED: "verified",
  SUPPLIER_PROVIDED: "supplier-provided",
  ESTIMATED: "estimated",
  HISTORICAL: "historical",
  PENDING_VERIFICATION: "pending verification",
};

async function sourcesBlock(productId: string, region?: string): Promise<ReplyBlock[]> {
  const product = await getProduct(productId);
  if (!product) return [];
  const sources = await productSources(productId, region);
  const regionLabel = region ? (REGIONS[region] ? titleCase(region) : countryName(region)) : undefined;
  if (!sources.length) {
    return [
      {
        type: "text",
        text: regionLabel
          ? `I have no sources on record for ${product.partNumber} in ${regionLabel}. I can request supplier confirmation.`
          : `I have no sources on record for ${product.partNumber}. I can request supplier confirmation.`,
      },
    ];
  }
  const available = sources.filter((s) => (s.quantityAvailable ?? 0) > 0).length;
  return [
    {
      type: "text",
      text: `${sources.length} source${sources.length === 1 ? "" : "s"} for ${product.partNumber}${regionLabel ? ` in ${regionLabel}` : ""}; ${available} report${available === 1 ? "s" : ""} availability. Availability and prices are as reported by suppliers — confirm with a quotation.`,
    },
    { type: "sources", partNumber: product.partNumber, sources, region: regionLabel },
  ];
}

async function oemSuppliersBlock(text: string): Promise<ReplyBlock[] | null> {
  const mfr = await findManufacturer(text);
  if (!mfr) return null;
  const rows = await db
    .select({ orgId: organizations.id, name: organizations.name, country: organizations.country, relationship: supplierOemRelationships.relationship, status: supplierOemRelationships.dataStatus })
    .from(supplierOemRelationships)
    .innerJoin(organizations, eq(organizations.id, supplierOemRelationships.supplierOrgId))
    .where(and(eq(supplierOemRelationships.manufacturerId, mfr.id), eq(organizations.isSuspended, false)));
  if (!rows.length) {
    return [{ type: "text", text: `I have ${mfr.name} on record, but no supplier relationships recorded for it. I can request supplier confirmation.` }];
  }
  const badges = await supplierBadges(rows.map((r) => r.orgId));
  return [
    { type: "text", text: `${rows.length} supplier${rows.length === 1 ? "" : "s"} on record for ${mfr.name}${mfr.isDemo ? " (DEMO data)" : ""}.` },
    {
      type: "facts",
      title: `Suppliers for ${mfr.name}`,
      rows: rows.map((r) => ({
        label: r.name,
        value: `${r.relationship.replace(/_/g, " ").toLowerCase()} · ${countryName(r.country)}${(badges.get(r.orgId) ?? []).includes("AUTHORIZED_DISTRIBUTOR") ? " · authorization documents verified" : ""}`,
        status: r.status,
      })),
    },
  ];
}

async function answerQuestions(parsed: ParsedMessage, state: ConversationState): Promise<ReplyBlock[]> {
  const blocks: ReplyBlock[] = [];
  const intents = new Set(parsed.intents);
  const line = activeLine(state);
  const productId = line?.productId;
  const asksSomething = ["WHO_MAKES", "AVAILABILITY", "PRICE", "ALTERNATIVE", "FIND_SUPPLIERS", "LEAD_TIME"].some((i) => intents.has(i as never));
  if (!asksSomething) {
    if (intents.has("WHAT_NEEDED")) {
      const missing = missingFields(state);
      blocks.push({
        type: "text",
        text: missing.length ? `To request quotations I still need: ${missing.join(", ")}.` : "I have everything needed to request quotations.",
      });
    }
    return blocks;
  }

  if (!productId) {
    if (intents.has("FIND_SUPPLIERS") || intents.has("WHO_MAKES")) {
      const oem = await oemSuppliersBlock(parsed.raw.replace(/\b(who|supplies|suppliers?|for|find|makes|of|this|oem|manufacturer|the|\?)\b/gi, " ").replace(/[?]/g, " ").trim());
      if (oem) return oem;
    }
    if (line) {
      blocks.push({ type: "text", text: `I don't have verified information for ${line.partNumber ?? line.description ?? "this item"}. I can request supplier confirmation.` });
    } else {
      blocks.push({ type: "text", text: "Which item do you mean? Give me a part number, OEM or description." });
    }
    return blocks;
  }

  const product = await getProduct(productId);
  if (!product) return blocks;

  if (intents.has("WHO_MAKES")) {
    blocks.push({
      type: "facts",
      title: product.partNumber,
      rows: [
        { label: "Manufacturer / OEM", value: product.manufacturer ?? "Not on record", status: product.dataStatus },
        { label: "Description", value: product.description },
        { label: "Category", value: product.category },
        ...(product.nsn ? [{ label: "NSN", value: product.nsn }] : []),
      ],
    });
  }

  if (intents.has("AVAILABILITY") || intents.has("FIND_SUPPLIERS")) {
    blocks.push(...(await sourcesBlock(productId, state.sourceRegion)));
  }

  if (intents.has("PRICE") || intents.has("LEAD_TIME")) {
    const sources = await productSources(productId, state.sourceRegion);
    const priced = sources.filter((s) => s.priceType !== "ON_REQUEST" && s.priceMin !== null);
    const rows: { label: string; value: string; status?: DataLabel }[] = [];
    if (intents.has("PRICE")) {
      if (priced.length) {
        for (const s of priced) {
          const price = s.priceType === "EXACT" || s.priceMin === s.priceMax ? `${s.currency} ${fmt(s.priceMin!)}/unit` : `${s.currency} ${fmt(s.priceMin!)}–${fmt(s.priceMax!)}/unit`;
          rows.push({ label: `${s.supplierName}`, value: `${price} · ${STATUS_TEXT[s.priceStatus]}`, status: s.priceStatus });
        }
      } else {
        blocks.push({ type: "text", text: `I don't have a verified price for ${product.partNumber}. A quotation request will get you confirmed prices.` });
      }
    }
    if (intents.has("LEAD_TIME")) {
      const withLead = sources.filter((s) => s.leadTimeDays !== null);
      if (withLead.length) {
        for (const s of withLead) rows.push({ label: `${s.supplierName} — lead time`, value: `${s.leadTimeDays} days · ${STATUS_TEXT[s.availabilityStatus]}`, status: s.availabilityStatus });
      } else {
        blocks.push({ type: "text", text: `No lead-time information on record for ${product.partNumber}. Suppliers will state it in their quotations.` });
      }
    }
    if (rows.length) {
      blocks.push({ type: "facts", title: `${product.partNumber} — indicative (not a quotation)`, rows });
    }
  }

  if (intents.has("ALTERNATIVE")) {
    const res = await searchPartNumber(product.partNumber);
    if (res.alternatives.length) {
      blocks.push({ type: "text", text: `${res.alternatives.length} documented reference${res.alternatives.length === 1 ? "" : "s"} for ${product.partNumber}. Interchangeability must be confirmed for your application.` });
      blocks.push({ type: "results", query: product.partNumber, exact: [], possible: [], alternatives: res.alternatives });
    } else {
      blocks.push({
        type: "text",
        text: `No documented alternatives for ${product.partNumber} on record. I can ask suppliers to propose alternatives — they will be marked as unverified.`,
      });
    }
  }
  return blocks;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/* ---------------------------------------------------------------- turn */

export async function chatTurn(input: TurnInput, owner: Owner): Promise<TurnResult> {
  const existing = await loadOwned(input.conversationId, owner);
  const prevState: ConversationState = existing ? (existing.state as ConversationState) : emptyState();
  const convId = existing?.id ?? null;

  let result: { state: ConversationState; reply: AssistantReply };
  let userContent: object;

  if (input.action) {
    userContent = { action: input.action };
    result = await handleAction(prevState, input.action);
  } else if (input.text && input.text.trim()) {
    const text = input.text.trim().slice(0, 4000);
    userContent = { text };
    result = await handleText(prevState, text);
  } else {
    throw badRequest("Type a message or choose an option.");
  }

  const id = await save(convId, owner, result.state, userContent, result.reply);
  return { conversationId: id, state: result.state, reply: result.reply, ready: missingFields(result.state).length === 0 };
}

async function handleText(prev: ConversationState, text: string): Promise<{ state: ConversationState; reply: AssistantReply }> {
  const parsed = await getExtractor().extract(text, { awaiting: prev.awaiting });

  // "What's the difference between A and B?" — compare, don't add lines.
  if (parsed.intents.includes("DIFFERENCE") && parsed.items.filter((i) => i.partNumber).length >= 2) {
    const blocks: ReplyBlock[] = [];
    for (const item of parsed.items.filter((i) => i.partNumber).slice(0, 2)) {
      const res = await searchPartNumber(item.partNumber!);
      const p = res.exact[0] ? await getProduct(res.exact[0].productId) : null;
      blocks.push(
        p
          ? { type: "facts", title: p.partNumber, rows: [{ label: "Manufacturer", value: p.manufacturer ?? "Not on record" }, { label: "Description", value: p.description }, ...Object.entries(p.specs ?? {}).map(([k, v]) => ({ label: k, value: String(v) }))] }
          : { type: "text", text: `I don't have verified information for ${item.partNumber}.` },
      );
    }
    blocks.push({ type: "notice", tone: "info", text: "Recorded specifications only. Technical interchangeability is not implied." });
    return { state: prev, reply: { blocks, actions: [{ type: "ASK_ANOTHER", label: "Ask another question" }] } };
  }

  const applied = applyMessage(prev, parsed);
  const state = applied.state;
  const hits = await identifyLines(state.lines, applied.pendingKeys);
  // A part number supplied in answer to "do you have a part number?" is reported like a new line.
  const newKeys = [...new Set([...applied.newKeys, ...applied.pendingKeys])];
  const facts = await answerQuestions(parsed, state);
  const understoodSomething =
    parsed.items.length > 0 || parsed.quantity || parsed.condition || parsed.destination || parsed.intents.length > 0 || parsed.requiredByText || parsed.certification || parsed.sourceRegion;

  if (parsed.sourceRegion && activeLine(state)?.productId && !facts.length) {
    facts.push(...(await sourcesBlock(activeLine(state)!.productId!, parsed.sourceRegion)));
  }

  return composeReply(state, {
    newKeys,
    ack: applied.ack,
    hits,
    facts,
    wantsQuotes: parsed.intents.includes("GET_QUOTES"),
    notUnderstood: !understoodSomething,
    greeting: parsed.intents.includes("GREETING"),
    dontKnow: parsed.intents.includes("DONT_KNOW"),
  });
}

async function handleAction(prev: ConversationState, action: ClientAction): Promise<{ state: ConversationState; reply: AssistantReply }> {
  const base: ComposeContext = { newKeys: [], ack: [], hits: {}, facts: [], wantsQuotes: false };
  switch (action.type) {
    case "CHOOSE_CANDIDATE": {
      const [lineKey, productId] = (action.value ?? "").split(":");
      const product = productId ? await getProduct(productId) : null;
      if (!product || !prev.lines.some((l) => l.key === lineKey)) throw badRequest("That option is no longer available.");
      const state = chooseCandidate(prev, lineKey, {
        productId: product.id,
        partNumber: product.partNumber,
        manufacturer: product.manufacturer,
        description: product.description,
        match: "EXACT",
        category: product.category,
      });
      const line = state.lines.find((l) => l.key === lineKey)!;
      line.isDemo = product.isDemo;
      line.exportControlled = product.exportControlStatus === "CONTROLLED";
      const hits = await identifyLines(state.lines, [lineKey]);
      return composeReply(state, { ...base, newKeys: [lineKey], hits });
    }
    case "VIEW_SOURCES": {
      const productId = action.value ?? activeLine(prev)?.productId;
      if (!productId) throw badRequest("No item selected.");
      const facts = await sourcesBlock(productId, prev.sourceRegion);
      return composeReply(prev, { ...base, facts });
    }
    case "DONT_KNOW": {
      return composeReply({ ...prev, awaiting: "IDENTIFIER" }, { ...base, dontKnow: true });
    }
    case "GET_QUOTE":
    case "GET_QUOTES": {
      const { state, ack } = applyAction(prev, action);
      return composeReply(state, { ...base, ack, wantsQuotes: true });
    }
    case "REVIEW_ITEMS": {
      return { state: prev, reply: { blocks: [{ type: "lines", lines: prev.lines }], actions: [{ type: "GET_QUOTES", label: "Create RFQ", primary: true }] } };
    }
    default: {
      const { state, ack } = applyAction(prev, action);
      return composeReply(state, { ...base, ack });
    }
  }
}

/* ------------------------------------------------------- direct edits */

export interface RequirementPatch {
  destination?: string;
  condition?: ConversationState["condition"];
  requiredBy?: string | null;
  certification?: string | null;
  notes?: string | null;
  lines?: { key?: string; partNumber?: string | null; description?: string | null; quantity?: number | null; unit?: string; remove?: boolean }[];
}

/** Edit any field of the requirement without restarting the conversation. */
export async function patchRequirement(conversationId: string, owner: Owner, patch: RequirementPatch): Promise<TurnResult> {
  const conv = await loadOwned(conversationId, owner);
  if (!conv) throw badRequest("Conversation not found.");
  const state = structuredClone(conv.state as ConversationState);
  if (state.rfqId) throw badRequest("This requirement has already been submitted as an RFQ.");

  if (patch.destination !== undefined) {
    const d = patch.destination.trim();
    state.destination = d ? resolvePlace(d) ?? { text: d } : undefined;
  }
  if (patch.condition) state.condition = patch.condition;
  if (patch.requiredBy !== undefined) {
    state.requiredBy = patch.requiredBy ?? undefined;
    state.requiredByText = patch.requiredBy ?? undefined;
  }
  if (patch.certification !== undefined) state.certification = patch.certification ?? undefined;
  if (patch.notes !== undefined) state.notes = patch.notes ?? undefined;

  const reidentify: string[] = [];
  for (const lp of patch.lines ?? []) {
    let line = lp.key ? state.lines.find((l) => l.key === lp.key) : undefined;
    if (lp.remove) {
      state.lines = state.lines.filter((l) => l.key !== lp.key);
      continue;
    }
    if (!line) {
      line = { key: newLineKey(), query: lp.partNumber ?? lp.description ?? "", identification: "PENDING" };
      state.lines.push(line);
      reidentify.push(line.key);
    }
    if (lp.quantity !== undefined) {
      line.quantity = lp.quantity && lp.quantity > 0 ? lp.quantity : undefined;
      line.quantityText = lp.quantity ? String(lp.quantity) : undefined;
      line.approximate = false;
    }
    if (lp.unit) line.unit = lp.unit;
    const pnChanged = lp.partNumber !== undefined && (lp.partNumber ?? "") !== (line.partNumber ?? "");
    const descChanged = lp.description !== undefined && (lp.description ?? "") !== (line.description ?? "");
    if (pnChanged) {
      line.partNumber = lp.partNumber || undefined;
      line.productId = undefined;
      line.manufacturer = undefined;
      line.candidates = undefined;
      if (!line.partNumber && lp.description) line.description = lp.description;
      reidentify.push(line.key);
    } else if (descChanged) {
      line.description = lp.description || undefined;
      if (!line.productId) {
        line.category = line.description ? detectCategory(line.description) : undefined;
        reidentify.push(line.key);
      }
    }
  }
  if (reidentify.length) await identifyLines(state.lines, reidentify);
  state.purchaseIntent = state.purchaseIntent || state.lines.length > 0;
  const lineCount = state.lines.length;
  const { state: next, reply } = composeReply(state, {
    newKeys: [],
    ack: [`Updated. ${lineCount} item${lineCount === 1 ? "" : "s"}${state.lines[0]?.quantity ? ` — ${state.lines.map((l) => `${formatQuantity(l.quantity, l.unit)} ${l.partNumber ?? l.description ?? ""}`.trim()).join(", ")}` : ""}.`],
    hits: {},
    facts: lineCount > 1 ? [{ type: "lines", lines: state.lines }] : [],
    wantsQuotes: true,
  });
  const id = await save(conv.id, owner, next, { edit: patch }, reply);
  return { conversationId: id, state: next, reply, ready: missingFields(next).length === 0 };
}

/** Adds lines extracted from an uploaded file to the conversation. */
export async function addExtractedLines(
  conversationId: string | undefined,
  owner: Owner,
  filename: string,
  rows: { partNumber?: string; description?: string; quantity?: number; unit?: string; quantityText?: string; manufacturer?: string }[],
  meta: { destination?: string; condition?: ConversationState["condition"] } = {},
): Promise<TurnResult> {
  const existing = await loadOwned(conversationId, owner);
  const base = existing && !(existing.state as ConversationState).rfqId ? (existing.state as ConversationState) : emptyState();
  const state = structuredClone(base);
  const keys: string[] = [];
  for (const r of rows) {
    const line: RequirementLine = {
      key: newLineKey(),
      query: [r.partNumber, r.description].filter(Boolean).join(" "),
      partNumber: r.partNumber || undefined,
      description: r.description || undefined,
      manufacturer: r.manufacturer || undefined,
      category: r.description ? detectCategory(r.description) : undefined,
      quantity: r.quantity,
      unit: r.unit ?? "EA",
      quantityText: r.quantityText,
      identification: "PENDING",
    };
    state.lines.push(line);
    keys.push(line.key);
  }
  if (meta.destination && !state.destination) state.destination = resolvePlace(meta.destination) ?? { text: meta.destination };
  if (meta.condition && !state.condition) state.condition = meta.condition;
  state.purchaseIntent = true;
  await identifyLines(state.lines, keys);
  const newLines = state.lines.filter((l) => keys.includes(l.key));
  const count = (s: RequirementLine["identification"]) => newLines.filter((l) => l.identification === s).length;
  const reply: AssistantReply = {
    blocks: [
      { type: "text", text: `${summariseCounts(newLines.length, count("EXACT"), count("ITEM_TYPE"), count("NEEDS_CONFIRMATION"), count("NOT_IDENTIFIED"))} Please review them before requesting quotations.` },
      { type: "lines", lines: state.lines },
    ],
    actions: [
      { type: "REVIEW_ITEMS", label: "Review", primary: false },
      { type: "GET_QUOTES", label: "Create RFQ", primary: true },
    ],
  };
  state.awaiting = undefined;
  const id = await save(existing?.id ?? null, owner, state, { upload: filename }, reply);
  return { conversationId: id, state, reply, ready: missingFields(state).length === 0 };
}

export async function markConversationSubmitted(conversationId: string, rfqId: string, rfqRef: string) {
  const rows = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!rows[0]) return;
  const state = { ...(rows[0].state as ConversationState), rfqId, rfqRef, awaiting: undefined };
  await db.update(conversations).set({ state, rfqId, updatedAt: new Date() }).where(eq(conversations.id, conversationId));
}
