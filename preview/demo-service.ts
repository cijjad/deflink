/**
 * In-browser stand-in for the server services, used only by the interactive preview.
 * It runs the REAL parser and dialogue engine (src/core) over the shared DEMO data
 * (scripts/demo-data.ts). Search mirrors the server rules: exact normalised part number,
 * trigram fuzzy match, category/description match, documented cross-references only,
 * and sources from verified suppliers only.
 */
import {
  activeLine,
  applyAction,
  applyMessage,
  chooseCandidate,
  composeReply,
  destinationLabel,
  missingFields,
  newLineKey,
  summariseCounts,
  type ComposeContext,
} from "../src/core/conversation/engine";
import { detectCategory, formatQuantity, normalizePartNumber, parseMessage } from "../src/core/conversation/parser";
import {
  emptyState,
  CONDITION_LABEL,
  type AssistantReply,
  type ClientAction,
  type ConversationState,
  type ProductHit,
  type ReplyBlock,
  type RequirementLine,
  type SourceCard,
} from "../src/core/conversation/types";
import { countryName, REGIONS, titleCase } from "../src/core/geo/countries";
import { CROSS_REFS, LISTINGS, MANUFACTURERS, OEM_RELATIONSHIPS, PRODUCTS, SUPPLIERS } from "../scripts/demo-data";

/* ------------------------------------------------------------- catalogue */

const mfrName = (key: string) => MANUFACTURERS.find((m) => m.key === key)?.name ?? null;
const verified = (key: string) => SUPPLIERS.find((s) => s.key === key)?.levels.includes("BUSINESS_VERIFIED") ?? false;
const product = (pn: string) => PRODUCTS.find((p) => p.pn === pn);

function trigrams(s: string) {
  const padded = `  ${s.toLowerCase()} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}
function similarity(a: string, b: string) {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  ta.forEach((t) => tb.has(t) && shared++);
  return shared / (ta.size + tb.size - shared);
}

function hit(pn: string, match: ProductHit["match"], evidence?: string): ProductHit {
  const p = product(pn)!;
  const listings = LISTINGS.filter((l) => l.pn === pn && verified(l.supplier));
  return {
    productId: pn,
    partNumber: pn,
    manufacturer: mfrName(p.mfr),
    description: p.description,
    category: p.category,
    nsn: null,
    match,
    evidence,
    sourceCount: new Set(listings.map((l) => l.supplier)).size,
    availableCount: new Set(listings.filter((l) => (l.qty ?? 0) > 0).map((l) => l.supplier)).size,
    isDemo: true,
    exportControlled: Boolean(p.controlled),
  };
}

function searchPartNumber(pn: string) {
  const norm = normalizePartNumber(pn);
  const exact = PRODUCTS.filter((p) => normalizePartNumber(p.pn) === norm).map((p) => hit(p.pn, "EXACT"));
  const alternatives = exact.flatMap((e) =>
    CROSS_REFS.filter((x) => x.from === e.partNumber).map((x) => {
      const label = x.type === "SUPERSEDED_BY" ? "Superseded by (documented)" : x.type === "DOCUMENTED_CROSS_REFERENCE" ? "Documented cross-reference" : "Alternative — technical equivalence not verified";
      return hit(x.to, x.type === "ALTERNATIVE" ? "ALTERNATIVE" : "CROSS_REFERENCE", `${label}. Source: ${x.evidence}. Status: ${x.status.replace(/_/g, " ").toLowerCase()}.`);
    }),
  );
  const altIds = new Set(alternatives.map((a) => a.productId));
  const possible = PRODUCTS.map((p) => ({ p, s: similarity(normalizePartNumber(p.pn), norm) }))
    .filter((x) => x.s >= 0.35 && normalizePartNumber(x.p.pn) !== norm && !altIds.has(x.p.pn))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => hit(x.p.pn, "POSSIBLE"));
  return { exact, possible, alternatives };
}

function searchText(text: string, category?: string) {
  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return PRODUCTS.filter((p) => {
    const hay = `${p.description} ${p.category} ${mfrName(p.mfr)}`.toLowerCase();
    return (category && p.category.toLowerCase() === category.toLowerCase()) || words.some((w) => hay.includes(w.replace(/s$/, "")));
  })
    .slice(0, 6)
    .map((p) => hit(p.pn, "POSSIBLE"));
}

export function productSources(pn: string, region?: string): SourceCard[] {
  const p = product(pn)!;
  const countries = region ? (REGIONS[region] ?? [region.toUpperCase()]) : null;
  return LISTINGS.filter((l) => l.pn === pn && verified(l.supplier))
    .map((l) => {
      const s = SUPPLIERS.find((x) => x.key === l.supplier)!;
      const price = l.price;
      return {
        listingId: `${l.supplier}-${l.pn}`,
        supplierName: s.name,
        supplierType: s.type,
        supplierCountry: s.country,
        city: s.city,
        country: s.country,
        partNumber: pn,
        description: p.description,
        manufacturer: mfrName(p.mfr),
        condition: l.condition ?? "NEW",
        quantityAvailable: l.qty,
        availabilityStatus: "SUPPLIER_PROVIDED",
        priceType: price === undefined ? "ON_REQUEST" : Array.isArray(price) ? "RANGE" : "EXACT",
        priceMin: price === undefined ? null : Array.isArray(price) ? price[0] : price,
        priceMax: price === undefined ? null : Array.isArray(price) ? price[1] : price,
        currency: "USD",
        priceStatus: l.priceStatus ?? "PENDING_VERIFICATION",
        leadTimeDays: l.lead,
        certification: l.cert ?? null,
        certificationStatus: l.cert ? "SUPPLIER_PROVIDED" : "PENDING_VERIFICATION",
        verifications: s.levels,
        reportedAt: "2026-10-01T00:00:00Z",
        isDemo: true,
      } satisfies SourceCard;
    })
    .filter((c) => !countries || countries.includes(c.country))
    .sort((a, b) => Number((b.quantityAvailable ?? 0) > 0) - Number((a.quantityAvailable ?? 0) > 0));
}

/* -------------------------------------------------------- identification */

function fill(line: RequirementLine, h: ProductHit) {
  Object.assign(line, { productId: h.productId, partNumber: h.partNumber, manufacturer: h.manufacturer ?? undefined, description: h.description, category: h.category, isDemo: true, exportControlled: h.exportControlled, candidates: undefined });
}
const toCandidate = (h: ProductHit) => ({ productId: h.productId, partNumber: h.partNumber, manufacturer: h.manufacturer, description: h.description, match: h.match });

function identify(lines: RequirementLine[], keys: string[]) {
  const hits: ComposeContext["hits"] = {};
  for (const line of lines.filter((l) => keys.includes(l.key))) {
    if (line.partNumber) {
      const r = searchPartNumber(line.partNumber);
      if (r.exact.length === 1) {
        fill(line, r.exact[0]);
        line.identification = "EXACT";
      } else if (r.possible.length) {
        line.identification = "NEEDS_CONFIRMATION";
        line.candidates = r.possible.slice(0, 3).map(toCandidate);
      } else line.identification = line.category ? "ITEM_TYPE" : "NOT_IDENTIFIED";
      hits[line.key] = r;
      continue;
    }
    const found = searchText(line.description ?? line.query, line.category);
    if (line.category) {
      line.identification = "ITEM_TYPE";
      hits[line.key] = { exact: [], possible: found.slice(0, 4), alternatives: [] };
    } else if (found.length) {
      line.identification = "NEEDS_CONFIRMATION";
      line.candidates = found.slice(0, 3).map(toCandidate);
      hits[line.key] = { exact: [], possible: found, alternatives: [] };
    } else line.identification = "NOT_IDENTIFIED";
  }
  return hits;
}

/* ----------------------------------------------------------------- facts */

function sourcesBlocks(pn: string, region?: string): ReplyBlock[] {
  const sources = productSources(pn, region);
  const where = region ? ` in ${REGIONS[region] ? titleCase(region) : countryName(region)}` : "";
  if (!sources.length) return [{ type: "text", text: `I have no sources on record for ${pn}${where}. I can request supplier confirmation.` }];
  const avail = sources.filter((s) => (s.quantityAvailable ?? 0) > 0).length;
  return [
    { type: "text", text: `${sources.length} source${sources.length === 1 ? "" : "s"} for ${pn}${where}; ${avail} report${avail === 1 ? "s" : ""} availability. Availability and prices are as reported by suppliers — confirm with a quotation.` },
    { type: "sources", partNumber: pn, sources },
  ];
}

function answer(intents: string[], state: ConversationState): ReplyBlock[] {
  const out: ReplyBlock[] = [];
  const line = activeLine(state);
  const pn = line?.productId;
  const asks = ["WHO_MAKES", "AVAILABILITY", "PRICE", "ALTERNATIVE", "FIND_SUPPLIERS", "LEAD_TIME"].filter((i) => intents.includes(i));
  if (intents.includes("WHAT_NEEDED")) {
    const m = missingFields(state);
    out.push({ type: "text", text: m.length ? `To request quotations I still need: ${m.join(", ")}.` : "I have everything needed to request quotations." });
  }
  if (!asks.length) return out;
  if (!pn) {
    if (intents.includes("FIND_SUPPLIERS") || intents.includes("WHO_MAKES")) {
      out.push({ type: "text", text: "Tell me the part number first — for example \"Find ABC123\" — and I'll show who supplies it." });
    } else out.push({ type: "text", text: line ? `I don't have verified information for ${line.partNumber ?? line.description}. I can request supplier confirmation.` : "Which item do you mean? Give me a part number, OEM or description." });
    return out;
  }
  const p = product(pn)!;
  if (intents.includes("WHO_MAKES")) out.push({ type: "facts", title: pn, rows: [{ label: "Manufacturer / OEM", value: mfrName(p.mfr) ?? "Not on record", status: "VERIFIED" }, { label: "Description", value: p.description }, { label: "Category", value: p.category }] });
  if (intents.includes("AVAILABILITY") || intents.includes("FIND_SUPPLIERS")) out.push(...sourcesBlocks(pn, state.sourceRegion));
  if (intents.includes("PRICE") || intents.includes("LEAD_TIME")) {
    const rows: { label: string; value: string; status?: SourceCard["priceStatus"] }[] = [];
    for (const s of productSources(pn, state.sourceRegion)) {
      if (intents.includes("PRICE") && s.priceMin !== null) rows.push({ label: s.supplierName, value: `${s.currency} ${s.priceMin.toLocaleString("en-US")}${s.priceMax !== s.priceMin ? `–${s.priceMax!.toLocaleString("en-US")}` : ""}/unit`, status: s.priceStatus });
      if (intents.includes("LEAD_TIME") && s.leadTimeDays !== null) rows.push({ label: `${s.supplierName} — lead time`, value: `${s.leadTimeDays} days`, status: "SUPPLIER_PROVIDED" });
    }
    out.push(rows.length ? { type: "facts", title: `${pn} — indicative (not a quotation)`, rows } : { type: "text", text: `I don't have a verified price for ${pn}. A quotation request will get you confirmed prices.` });
  }
  if (intents.includes("ALTERNATIVE")) {
    const alts = searchPartNumber(pn).alternatives;
    out.push(
      ...(alts.length
        ? ([{ type: "text", text: `${alts.length} documented reference${alts.length === 1 ? "" : "s"} for ${pn}. Interchangeability must be confirmed for your application.` }, { type: "results", query: pn, exact: [], possible: [], alternatives: alts }] as ReplyBlock[])
        : ([{ type: "text", text: `No documented alternatives for ${pn} on record. I can ask suppliers to propose alternatives — they will be marked as unverified.` }] as ReplyBlock[])),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ turns */

export interface Turn {
  state: ConversationState;
  reply: AssistantReply;
  ready: boolean;
}

const done = (r: { state: ConversationState; reply: AssistantReply }): Turn => ({ ...r, ready: missingFields(r.state).length === 0 && !r.state.rfqId });

export function sendText(prev: ConversationState, text: string): Turn {
  const parsed = parseMessage(text, { awaiting: prev.awaiting });
  const applied = applyMessage(prev, parsed);
  const hits = identify(applied.state.lines, applied.pendingKeys);
  const facts = answer(parsed.intents, applied.state);
  const line = activeLine(applied.state);
  if (parsed.sourceRegion && line?.productId && !facts.length) facts.push(...sourcesBlocks(line.productId, parsed.sourceRegion));
  const understood = parsed.items.length || parsed.quantity || parsed.condition || parsed.destination || parsed.intents.length || parsed.requiredByText || parsed.certification || parsed.sourceRegion;
  return done(
    composeReply(applied.state, {
      newKeys: [...new Set([...applied.newKeys, ...applied.pendingKeys])],
      ack: applied.ack,
      hits,
      facts,
      wantsQuotes: parsed.intents.includes("GET_QUOTES"),
      notUnderstood: !understood,
      greeting: parsed.intents.includes("GREETING"),
      dontKnow: parsed.intents.includes("DONT_KNOW"),
    }),
  );
}

export function sendAction(prev: ConversationState, action: ClientAction): Turn {
  const base: ComposeContext = { newKeys: [], ack: [], hits: {}, facts: [], wantsQuotes: false };
  if (action.type === "CHOOSE_CANDIDATE") {
    const [lineKey, pn] = (action.value ?? "").split(":");
    const p = product(pn)!;
    const state = chooseCandidate(prev, lineKey, { productId: pn, partNumber: pn, manufacturer: mfrName(p.mfr), description: p.description, match: "EXACT", category: p.category });
    const line = state.lines.find((l) => l.key === lineKey)!;
    line.isDemo = true;
    line.exportControlled = Boolean(p.controlled);
    if (state.lines.length > 1) {
      const open = state.lines.filter((l) => l.identification === "NEEDS_CONFIRMATION" || l.identification === "NOT_IDENTIFIED").length;
      const n = state.lines.findIndex((l) => l.key === lineKey) + 1;
      return done({
        state: { ...state, awaiting: undefined },
        reply: {
          blocks: [
            { type: "text", text: `Line ${n} set to ${pn} (${mfrName(p.mfr)}). ${open ? `${open} item${open === 1 ? "" : "s"} still need${open === 1 ? "s" : ""} attention.` : "All items are identified."}` },
            { type: "lines", lines: state.lines },
          ],
          actions: [{ type: "GET_QUOTES", label: "Create RFQ", primary: true }],
        },
      });
    }
    return done(composeReply(state, { ...base, newKeys: [lineKey], hits: identify(state.lines, [lineKey]) }));
  }
  if (action.type === "VIEW_SOURCES") return done(composeReply(prev, { ...base, facts: sourcesBlocks(action.value ?? activeLine(prev)!.productId!, prev.sourceRegion) }));
  if (action.type === "DONT_KNOW") return done(composeReply({ ...prev, awaiting: "IDENTIFIER" }, { ...base, dontKnow: true }));
  if (action.type === "REVIEW_ITEMS") return done({ state: prev, reply: { blocks: [{ type: "lines", lines: prev.lines }], actions: [{ type: "GET_QUOTES", label: "Create RFQ", primary: true }] } });
  const { state, ack } = applyAction(prev, action);
  return done(composeReply(state, { ...base, ack, wantsQuotes: action.type === "GET_QUOTE" || action.type === "GET_QUOTES" }));
}

export function editLines(prev: ConversationState, changes: { key: string; partNumber?: string | null; description?: string | null; quantity?: number | null }[], extra: { destination?: string; condition?: ConversationState["condition"] } = {}): Turn {
  const state = structuredClone(prev);
  const re: string[] = [];
  for (const c of changes) {
    const line = state.lines.find((l) => l.key === c.key);
    if (!line) continue;
    if (c.quantity !== undefined) line.quantity = c.quantity ?? undefined;
    if (c.partNumber !== undefined && (c.partNumber ?? "") !== (line.partNumber ?? "")) {
      Object.assign(line, { partNumber: c.partNumber || undefined, productId: undefined, manufacturer: undefined, candidates: undefined });
      re.push(line.key);
    } else if (c.description !== undefined && !line.productId) {
      line.description = c.description || undefined;
      line.category = line.description ? detectCategory(line.description) : undefined;
      re.push(line.key);
    }
  }
  if (extra.destination !== undefined) state.destination = parseMessage(extra.destination, { awaiting: "DESTINATION" }).destination ?? { text: extra.destination };
  if (extra.condition) state.condition = extra.condition;
  identify(state.lines, re);
  state.purchaseIntent = true;
  const n = state.lines.length;
  return done(composeReply(state, { newKeys: [], ack: [`Updated. ${n} item${n === 1 ? "" : "s"}.`], hits: {}, facts: n > 1 ? [{ type: "lines", lines: state.lines }] : [], wantsQuotes: true }));
}

export function addRows(prev: ConversationState, rows: { partNumber?: string; description?: string; quantity?: number }[]): Turn {
  const state = prev.rfqId ? emptyState() : structuredClone(prev);
  const keys: string[] = [];
  for (const r of rows) {
    const line: RequirementLine = { key: newLineKey(), query: [r.partNumber, r.description].filter(Boolean).join(" "), partNumber: r.partNumber, description: r.description, category: r.description ? detectCategory(r.description) : undefined, quantity: r.quantity, unit: "EA", identification: "PENDING" };
    state.lines.push(line);
    keys.push(line.key);
  }
  state.purchaseIntent = true;
  identify(state.lines, keys);
  const nl = state.lines.filter((l) => keys.includes(l.key));
  const c = (s: string) => nl.filter((l) => l.identification === s).length;
  return done({
    state: { ...state, awaiting: undefined },
    reply: {
      blocks: [
        { type: "text", text: `${summariseCounts(nl.length, c("EXACT"), c("ITEM_TYPE"), c("NEEDS_CONFIRMATION"), c("NOT_IDENTIFIED"))} Please review them before requesting quotations.` },
        { type: "lines", lines: state.lines },
      ],
      actions: [
        { type: "REVIEW_ITEMS", label: "Review" },
        { type: "GET_QUOTES", label: "Create RFQ", primary: true },
      ],
    },
  });
}

/** Which verified suppliers an RFQ would go to, and why — same rules as the server. */
export function matchSuppliers(state: ConversationState) {
  const controlled = state.lines.some((l) => l.exportControlled);
  const out = new Map<string, { key: string; name: string; country: string; reasons: string[]; score: number }>();
  const add = (key: string, reason: string, score: number) => {
    const s = SUPPLIERS.find((x) => x.key === key)!;
    if (!s.levels.includes(controlled ? "COMPLIANCE_VERIFIED" : "BUSINESS_VERIFIED")) return;
    const m = out.get(key) ?? { key, name: s.name, country: s.country, reasons: [], score: 0 };
    if (!m.reasons.includes(reason)) m.reasons.push(reason);
    m.score += score;
    out.set(key, m);
  };
  for (const l of state.lines) {
    if (l.productId) {
      LISTINGS.filter((x) => x.pn === l.productId).forEach((x) => add(x.supplier, `Lists ${x.pn}`, (x.qty ?? 0) > 0 ? 10 : 6));
      const mk = product(l.productId)!.mfr;
      OEM_RELATIONSHIPS.filter((r) => r.mfr === mk).forEach((r) => add(r.supplier, `OEM relationship for ${l.productId}`, 5));
    }
    if (l.category) SUPPLIERS.filter((s) => s.categories.some((c) => c.toLowerCase() === l.category!.toLowerCase() || (l.category === "Hydraulic Pump" && c === "Pump"))).forEach((s) => add(s.key, `Supplies ${l.category}`, 2));
  }
  return { controlled, suppliers: [...out.values()].sort((a, b) => b.score - a.score).slice(0, 15) };
}

export const supplierByKey = (k: string) => SUPPLIERS.find((s) => s.key === k)!;
export const listingFor = (k: string, pn?: string) => LISTINGS.find((l) => l.supplier === k && l.pn === pn);
export { CONDITION_LABEL, countryName, destinationLabel, emptyState, formatQuantity };
