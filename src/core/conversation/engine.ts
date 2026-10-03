/**
 * Dialogue engine: pure functions that update the requirement state and decide
 * the single next thing to ask, plus the context-sensitive action buttons.
 *
 * It never invents facts. Product facts come in via `hits`/`facts` from the search service.
 */
import { countryName } from "../geo/countries";
import { formatQuantity, normalizePartNumber } from "./parser";
import {
  CONDITION_LABEL,
  type Action,
  type AssistantReply,
  type Candidate,
  type ClientAction,
  type Condition,
  type ConversationState,
  type ParsedMessage,
  type ProductHit,
  type ReplyBlock,
  type RequirementLine,
  emptyState,
} from "./types";

export interface ApplyResult {
  state: ConversationState;
  /** Keys of lines that need identification against the catalogue. */
  pendingKeys: string[];
  newKeys: string[];
  ack: string[];
  reset: boolean;
}

let keyCounter = 0;
export function newLineKey(): string {
  keyCounter = (keyCounter + 1) % 1_000_000;
  return `L${Date.now().toString(36)}${keyCounter.toString(36)}`;
}

export function activeLine(state: ConversationState): RequirementLine | undefined {
  return state.lines.find((l) => l.key === state.activeLineKey) ?? state.lines[state.lines.length - 1];
}

export function lineLabel(l: RequirementLine): string {
  if (l.partNumber) return l.partNumber;
  if (l.nsn) return `NSN ${l.nsn}`;
  return l.description ?? l.category ?? l.query;
}

export function destinationLabel(d: ConversationState["destination"]): string {
  if (!d) return "";
  if (d.city && d.country) return `${d.city}, ${countryName(d.country)}`;
  if (d.country) return countryName(d.country);
  return d.text;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Applies a parsed user message to the state. */
export function applyMessage(prev: ConversationState, parsed: ParsedMessage): ApplyResult {
  let state = clone(prev);
  const ack: string[] = [];
  const pendingKeys: string[] = [];
  const newKeys: string[] = [];

  if (parsed.intents.includes("RESET") || state.rfqId) {
    // A submitted RFQ closes this requirement; any new message starts a fresh one.
    state = emptyState();
    if (parsed.intents.includes("RESET")) return { state, pendingKeys, newKeys, ack, reset: true };
  }

  const active = activeLine(state);

  /* Answers to a specific question merge into the active line. */
  if (active && state.awaiting === "IDENTIFIER" && parsed.items.length === 1) {
    const item = parsed.items[0];
    if (item.partNumber || item.nsn) {
      active.partNumber = item.partNumber ?? active.partNumber;
      active.nsn = item.nsn ?? active.nsn;
      active.identification = "PENDING";
      pendingKeys.push(active.key);
    } else if (item.text) {
      active.manufacturer = item.text;
      ack.push(`Manufacturer/OEM noted: ${item.text}.`);
    }
    if (item.quantity) setQuantity(active, item.quantity);
    parsed = { ...parsed, items: [] };
  } else if (active && state.awaiting === "DESCRIPTION" && parsed.items.length >= 1 && !parsed.items.some((i) => i.partNumber)) {
    const text = parsed.items.map((i) => i.text).filter(Boolean).join(", ");
    active.description = active.category ? `${active.category} — ${text}` : text;
    ack.push("Thanks — I've added that description.");
    parsed = { ...parsed, items: [] };
  }

  /* New or updated items */
  if (parsed.items.length) {
    // A pure search (no purchase intent so far) is replaced by the next search.
    if (state.lines.length && !state.purchaseIntent && !parsed.purchaseIntent) {
      state.lines = [];
      state.condition = undefined;
    }
    for (const item of parsed.items) {
      const pn = item.partNumber ? normalizePartNumber(item.partNumber) : undefined;
      const existing = pn ? state.lines.find((l) => l.partNumber && normalizePartNumber(l.partNumber) === pn) : undefined;
      if (existing) {
        if (item.quantity) setQuantity(existing, item.quantity);
        state.activeLineKey = existing.key;
        continue;
      }
      const line: RequirementLine = {
        key: newLineKey(),
        query: [item.quantity?.text, item.partNumber ?? item.nsn, item.text].filter(Boolean).join(" ").trim(),
        partNumber: item.partNumber,
        nsn: item.nsn,
        category: item.category,
        identification: "PENDING",
      };
      if (item.text && !item.partNumber && !item.nsn) {
        line.description = capitalise(item.text);
      }
      if (item.quantity) setQuantity(line, item.quantity);
      else if (state.pendingQuantity && parsed.items.length === 1) {
        setQuantity(line, state.pendingQuantity);
        state.pendingQuantity = undefined;
      }
      state.lines.push(line);
      state.activeLineKey = line.key;
      pendingKeys.push(line.key);
      newKeys.push(line.key);
    }
  }

  /* Bare quantity: "I need 50" */
  if (parsed.quantity) {
    const target = activeLine(state);
    if (target && newKeys.length === 0) {
      setQuantity(target, parsed.quantity);
      ack.push(`Understood — ${formatQuantity(target.quantity, target.unit)} of ${lineLabel(target)}.`);
    } else if (!target) {
      state.pendingQuantity = parsed.quantity;
    }
  }

  if (parsed.condition) {
    state.condition = parsed.condition;
    ack.push(`Condition: ${CONDITION_LABEL[parsed.condition]}.`);
  }
  if (parsed.destination) {
    state.destination = parsed.destination;
    ack.push(`Destination: ${destinationLabel(parsed.destination)}.`);
  }
  if (parsed.requiredByText) {
    state.requiredBy = parsed.requiredBy;
    state.requiredByText = parsed.requiredByText;
    ack.push(`Required by: ${parsed.requiredBy ?? parsed.requiredByText}.`);
  }
  if (parsed.certification) {
    state.certification = parsed.certification;
    ack.push(`Certification required: ${parsed.certification}.`);
  }
  if (parsed.sourceRegion) state.sourceRegion = parsed.sourceRegion;
  if (parsed.purchaseIntent || parsed.intents.includes("GET_QUOTES")) state.purchaseIntent = true;

  return { state, pendingKeys, newKeys, ack, reset: false };
}

function setQuantity(line: RequirementLine, q: NonNullable<ParsedMessage["quantity"]>) {
  line.quantity = q.value;
  line.unit = q.unit;
  line.quantityText = q.text;
  line.approximate = q.approximate;
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Applies a button press. Returns null when the action needs server data (handled by the service). */
export function applyAction(prev: ConversationState, action: ClientAction): { state: ConversationState; ack: string[] } {
  const state = clone(prev);
  const ack: string[] = [];
  switch (action.type) {
    case "SET_CONDITION":
      if (action.value && action.value in CONDITION_LABEL) {
        state.condition = action.value as Condition;
        ack.push(`Condition: ${CONDITION_LABEL[state.condition]}.`);
      }
      break;
    case "GET_QUOTE":
    case "GET_QUOTES":
      state.purchaseIntent = true;
      break;
    case "DONT_KNOW":
      state.awaiting = "DESCRIPTION";
      break;
    case "NONE_OF_THESE": {
      const line = state.lines.find((l) => l.key === action.value) ?? activeLine(state);
      if (line) {
        line.identification = "NOT_IDENTIFIED";
        line.candidates = undefined;
        ack.push(`Understood. I'll keep ${lineLabel(line)} exactly as you entered it and ask suppliers to confirm.`);
      }
      break;
    }
    case "SKIP":
      state.awaiting = undefined;
      state.askedIdentifier = true;
      break;
    case "NEW_SEARCH":
      return { state: emptyState(), ack };
  }
  return { state, ack };
}

/* ------------------------------------------------------------- missing */

export function missingFields(state: ConversationState): string[] {
  const missing: string[] = [];
  if (!state.lines.length) missing.push("item");
  if (state.lines.some((l) => !l.quantity)) missing.push("quantity");
  if (!state.condition) missing.push("condition");
  if (!state.destination) missing.push("destination");
  return missing;
}

export function isReady(state: ConversationState) {
  return missingFields(state).length === 0;
}

/* ------------------------------------------------------------- compose */

export interface ComposeContext {
  newKeys: string[];
  ack: string[];
  /** Search results per newly identified line. */
  hits: Record<string, { exact: ProductHit[]; possible: ProductHit[]; alternatives: ProductHit[] }>;
  /** Answers to questions (who makes / availability / price...), already composed from DB facts. */
  facts: ReplyBlock[];
  /** True when the user explicitly asked to get quotes / create the RFQ. */
  wantsQuotes: boolean;
  /** Free text that could not be understood at all. */
  notUnderstood?: boolean;
  greeting?: boolean;
  dontKnow?: boolean;
  regionNote?: string;
}

const CONDITION_ACTIONS: Action[] = [
  { type: "SET_CONDITION", value: "NEW", label: "New", primary: true },
  { type: "SET_CONDITION", value: "NEW_OR_APPROVED_ALTERNATIVE", label: "New or approved alternative" },
  { type: "SET_CONDITION", value: "ANY", label: "Any condition" },
];

export function composeReply(input: ConversationState, ctx: ComposeContext): { state: ConversationState; reply: AssistantReply } {
  const state = clone(input);
  const blocks: ReplyBlock[] = [];
  let actions: Action[] = [];
  const say = (text: string) => blocks.push({ type: "text", text });

  if (ctx.greeting && !state.lines.length) {
    say("Hello. Tell me what you need — a part number, an OEM, or simply describe the item.");
    state.awaiting = "ITEM";
    return { state, reply: { blocks, actions: [{ type: "UPLOAD", label: "Upload requirement" }] } };
  }

  if (ctx.ack.length) say(ctx.ack.join(" "));
  blocks.push(...ctx.facts);
  if (ctx.regionNote) blocks.push({ type: "notice", tone: "info", text: ctx.regionNote });

  /* Report what we found for new lines */
  const newLines = state.lines.filter((l) => ctx.newKeys.includes(l.key));
  if (newLines.length === 1) {
    const line = newLines[0];
    const hit = ctx.hits[line.key];
    describeSingleLine(line, hit, blocks);
  } else if (newLines.length > 1) {
    const exact = newLines.filter((l) => l.identification === "EXACT").length;
    const type = newLines.filter((l) => l.identification === "ITEM_TYPE").length;
    const confirm = newLines.filter((l) => l.identification === "NEEDS_CONFIRMATION").length;
    const none = newLines.filter((l) => l.identification === "NOT_IDENTIFIED").length;
    say(summariseCounts(newLines.length, exact, type, confirm, none));
    blocks.push({ type: "lines", lines: state.lines });
  }

  if (ctx.dontKnow && state.awaiting === "IDENTIFIER") {
    const line = activeLine(state);
    say(
      `No problem. Describe what the ${(line?.category ?? "item").toLowerCase()} is used for (equipment, size, rating), or upload a photo or specification.`,
    );
    state.awaiting = "DESCRIPTION";
    return { state, reply: { blocks, actions: [{ type: "UPLOAD", label: "Upload photo / spec" }, { type: "SKIP", label: "Skip" }] } };
  }

  if (ctx.notUnderstood && !state.lines.length) {
    say("I didn't catch the item. Tell me a part number, an OEM, or describe what you need — for example \"25 hydraulic pumps\".");
    state.awaiting = "ITEM";
    return { state, reply: { blocks, actions: [{ type: "UPLOAD", label: "Upload requirement" }] } };
  }

  if (!state.lines.length) {
    if (state.pendingQuantity) {
      say(`Understood — ${formatQuantity(state.pendingQuantity.value, state.pendingQuantity.unit)}. What is the item? A part number, OEM or a short description is enough.`);
    } else if (!blocks.length) {
      say("What do you need? A part number, an OEM, or a short description is enough.");
    }
    state.awaiting = "ITEM";
    return { state, reply: { blocks, actions } };
  }

  /* Single line awaiting candidate confirmation */
  const single = state.lines.length === 1 ? state.lines[0] : undefined;
  if (single?.identification === "NEEDS_CONFIRMATION" && single.candidates?.length) {
    state.awaiting = "CONFIRM_CANDIDATE";
    if (!newLines.length) blocks.push({ type: "candidates", lineKey: single.key, query: single.partNumber ?? single.query, candidates: single.candidates });
    actions = single.candidates.slice(0, 3).map((c) => ({ type: "CHOOSE_CANDIDATE", value: `${single.key}:${c.productId}`, label: `Use ${c.partNumber}` }));
    actions.push({ type: "NONE_OF_THESE", value: single.key, label: "None of these" });
    return { state, reply: { blocks, actions } };
  }

  /* Search mode: show results and let the user decide. */
  if (!state.purchaseIntent) {
    state.awaiting = undefined;
    const line = activeLine(state)!;
    actions.push({ type: "GET_QUOTE", label: "Get quote", primary: true });
    if (line.productId) actions.push({ type: "VIEW_SOURCES", value: line.productId, label: "View sources" });
    actions.push({ type: "ASK_ANOTHER", label: "Ask another question" });
    return { state, reply: { blocks, actions } };
  }

  /* Multi-item: let the user review the list, then create the RFQ. Ask the rest only when they proceed. */
  if (state.lines.length > 1 && newLines.length > 1 && !ctx.wantsQuotes) {
    state.awaiting = undefined;
    actions.push({ type: "GET_QUOTES", label: "Create RFQ", primary: true });
    actions.push({ type: "EDIT", label: "Edit items" });
    return { state, reply: { blocks, actions } };
  }

  /* Generic item with no part number: ask once for an identifier. */
  if (single && single.identification === "ITEM_TYPE" && !single.partNumber && !single.manufacturer && !state.askedIdentifier) {
    state.askedIdentifier = true;
    state.awaiting = "IDENTIFIER";
    const what = single.quantity ? formatQuantity(single.quantity, single.unit) + " — " : "";
    say(`Sure. ${what}Do you have a part number or OEM for the ${(single.category ?? "item").toLowerCase()}?`);
    actions = [
      { type: "PART_NUMBER", label: "Part number", hint: "Part number: " },
      { type: "OEM", label: "OEM", hint: "OEM: " },
      { type: "DONT_KNOW", label: "I don't know" },
    ];
    return { state, reply: { blocks, actions } };
  }

  const noQty = state.lines.find((l) => !l.quantity);
  if (noQty) {
    state.awaiting = "QUANTITY";
    state.activeLineKey = noQty.key;
    say(state.lines.length > 1 ? `How many ${lineLabel(noQty)} do you need?` : "How many do you need?");
    actions = [{ type: "ENTER_QUANTITY", label: "Enter quantity", primary: true, hint: "" }];
    return { state, reply: { blocks, actions } };
  }

  if (!state.condition) {
    state.awaiting = "CONDITION";
    say("New only?");
    return { state, reply: { blocks, actions: CONDITION_ACTIONS } };
  }

  if (!state.destination) {
    state.awaiting = "DESTINATION";
    say("Where should it be delivered?");
    return { state, reply: { blocks, actions: [{ type: "ADD_DESTINATION", label: "Add destination", primary: true, hint: "" }] } };
  }

  state.awaiting = undefined;
  say("Everything required is ready.");
  blocks.push({ type: "requirement", state: clone(state), ready: true, missing: [] });
  if (state.lines.some((l) => l.exportControlled)) {
    blocks.push({
      type: "notice",
      tone: "warning",
      text: "One or more items are recorded as export-controlled. Your request will go to compliance review before it is sent to suppliers.",
    });
  }
  actions = [
    { type: "GET_QUOTES", label: "Get quotes", primary: true },
    { type: "EDIT", label: "Edit" },
  ];
  return { state, reply: { blocks, actions } };
}

export function summariseCounts(total: number, exact: number, type: number, confirm: number, none: number): string {
  const parts: string[] = [];
  if (exact) parts.push(`${exact} identified exactly`);
  if (type) parts.push(`${type} identified by item type`);
  if (confirm) parts.push(`${confirm} need${confirm === 1 ? "s" : ""} confirmation`);
  if (none) parts.push(`${none} could not be identified`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `I found ${total} item${total === 1 ? "" : "s"}${list ? `: ${list}` : ""}.`;
}

function describeSingleLine(
  line: RequirementLine,
  hit: { exact: ProductHit[]; possible: ProductHit[]; alternatives: ProductHit[] } | undefined,
  blocks: ReplyBlock[],
) {
  const say = (text: string) => blocks.push({ type: "text", text });
  const label = lineLabel(line);
  switch (line.identification) {
    case "EXACT": {
      const top = hit?.exact[0];
      const refs = (hit?.exact.length ?? 0) + (hit?.possible.length ?? 0) + (hit?.alternatives.length ?? 0);
      let text = refs > 1 ? `I found ${refs} references for ${label}.` : `I found ${label}.`;
      if (top) {
        text += top.sourceCount
          ? ` ${top.sourceCount} potential source${top.sourceCount === 1 ? "" : "s"}, ${top.availableCount} reporting availability.`
          : " No sources on record yet — I can request supplier confirmation.";
      }
      if (line.quantity) text += ` Quantity: ${formatQuantity(line.quantity, line.unit)}.`;
      say(text);
      if (hit) blocks.push({ type: "results", query: label, ...hit });
      break;
    }
    case "NEEDS_CONFIRMATION":
      say(`I couldn't find an exact match for ${label}. Did you mean one of these?`);
      if (line.candidates) blocks.push({ type: "candidates", lineKey: line.key, query: label, candidates: line.candidates });
      break;
    case "ITEM_TYPE": {
      const what = line.quantity ? `${formatQuantity(line.quantity, line.unit)} — ${line.description ?? line.category}` : line.description ?? line.category;
      say(`Understood: ${what}.`);
      if (hit && (hit.exact.length || hit.possible.length)) {
        blocks.push({ type: "results", query: label, ...hit });
      }
      break;
    }
    case "NOT_IDENTIFIED":
      say(`I don't have verified information for ${label}. I can request supplier confirmation.`);
      break;
  }
}

/** Turns a chosen candidate into an identified line. */
export function chooseCandidate(state: ConversationState, lineKey: string, candidate: Candidate & { category?: string }) {
  const next = clone(state);
  const line = next.lines.find((l) => l.key === lineKey);
  if (!line) return next;
  line.productId = candidate.productId;
  line.partNumber = candidate.partNumber;
  line.manufacturer = candidate.manufacturer ?? undefined;
  line.description = candidate.description;
  line.category = candidate.category ?? line.category;
  line.identification = "EXACT";
  line.candidates = undefined;
  next.activeLineKey = line.key;
  next.awaiting = undefined;
  return next;
}
