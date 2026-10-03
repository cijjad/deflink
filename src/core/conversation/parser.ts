/**
 * Deterministic natural-language parser for procurement requests.
 *
 * It extracts STRUCTURE from what the user typed (quantities, part numbers, conditions,
 * destinations...). It never produces facts about products, suppliers or prices.
 */
import { CITY_LOOKUP, COUNTRY_LOOKUP, REGIONS, titleCase } from "../geo/countries";
import type { Awaiting, Condition, Destination, Intent, ParsedItem, ParsedMessage, ParsedQuantity } from "./types";

/* ------------------------------------------------------------------ units */

const UNIT_WORDS: [RegExp, string][] = [
  [/^(units?|pcs?|pieces?|piece|ea|each|nos?|numbers?|items?|qty)$/, "EA"],
  [/^(sets?)$/, "SET"],
  [/^(pairs?|prs?)$/, "PR"],
  [/^(kits?)$/, "KT"],
  [/^(box|boxes|bx)$/, "BX"],
  [/^(packs?|packets?|pk|pkts?)$/, "PK"],
  [/^(meters?|metres?|mtrs?|m)$/, "M"],
  [/^(kgs?|kilograms?|kilos?)$/, "KG"],
  [/^(liters?|litres?|ltrs?|l)$/, "L"],
  [/^(rolls?|rl)$/, "RL"],
  [/^(drums?)$/, "DR"],
  [/^(lots?)$/, "LOT"],
  [/^(cartons?|ctns?)$/, "CTN"],
  [/^(assy|assemblies|assembly)$/, "EA"],
];

export const UNIT_LABEL: Record<string, [string, string]> = {
  EA: ["unit", "units"],
  SET: ["set", "sets"],
  PR: ["pair", "pairs"],
  KT: ["kit", "kits"],
  BX: ["box", "boxes"],
  PK: ["pack", "packs"],
  M: ["metre", "metres"],
  KG: ["kg", "kg"],
  L: ["litre", "litres"],
  RL: ["roll", "rolls"],
  DR: ["drum", "drums"],
  LOT: ["lot", "lots"],
  CTN: ["carton", "cartons"],
};

export function formatQuantity(value: number | undefined, unit: string | undefined): string {
  if (value === undefined) return "";
  const [one, many] = UNIT_LABEL[unit ?? "EA"] ?? [unit ?? "unit", unit ?? "units"];
  const n = Number.isInteger(value) ? value.toLocaleString("en-US") : String(value);
  return `${n} ${value === 1 ? one : many}`;
}

function unitFor(word: string): string | undefined {
  const w = word.toLowerCase().replace(/\.$/, "");
  for (const [re, code] of UNIT_WORDS) if (re.test(w)) return code;
  return undefined;
}

/* ---------------------------------------------------------- word numbers */

const SMALL: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const MULT: Record<string, number> = { hundred: 100, thousand: 1000, dozen: 12, score: 20 };

/** Parses a leading run of number words. Returns null when the words are not a number. */
export function parseWordNumber(tokens: string[]): { value: number; consumed: number } | null {
  let i = 0;
  let total = 0;
  let current = 0;
  let sawNumber = false;
  if (tokens[0] === "half" && tokens[1] === "a" && tokens[2] === "dozen") return { value: 6, consumed: 3 };
  if ((tokens[0] === "a" || tokens[0] === "one") && (tokens[1] === "pair" || tokens[1] === "couple")) {
    return { value: 2, consumed: tokens[2] === "of" ? 3 : 2 };
  }
  while (i < tokens.length) {
    const parts = tokens[i].split("-");
    if (parts.every((p) => p in SMALL)) {
      // "a"/"an" only count as a number when followed by a multiplier ("a dozen", "a hundred").
      if ((tokens[i] === "a" || tokens[i] === "an") && !(tokens[i + 1] in MULT)) break;
      current += parts.reduce((s, p) => s + SMALL[p], 0);
      sawNumber = true;
      i++;
      continue;
    }
    if (tokens[i] in MULT && sawNumber) {
      const m = MULT[tokens[i]];
      if (m === 1000) {
        total += (current || 1) * m;
        current = 0;
      } else {
        current = (current || 1) * m;
      }
      i++;
      continue;
    }
    if (tokens[i] === "and" && sawNumber && tokens[i + 1] && tokens[i + 1] in SMALL) {
      i++;
      continue;
    }
    break;
  }
  if (!sawNumber) return null;
  const value = total + current;
  return value > 0 ? { value, consumed: i } : null;
}

/* ------------------------------------------------------------- categories */

/** Generic item types we can recognise in plain language. Keyword (singular) → category label. */
const CATEGORY_KEYWORDS: [string, string][] = [
  ["hydraulic pump", "Hydraulic Pump"], ["fuel pump", "Pump"], ["water pump", "Pump"], ["pump", "Pump"],
  ["ball bearing", "Bearing"], ["roller bearing", "Bearing"], ["bearing", "Bearing"],
  ["oil filter", "Filter"], ["air filter", "Filter"], ["fuel filter", "Filter"], ["hydraulic filter", "Filter"], ["filter element", "Filter"], ["filter", "Filter"],
  ["check valve", "Valve"], ["ball valve", "Valve"], ["gate valve", "Valve"], ["solenoid valve", "Valve"], ["valve", "Valve"],
  ["o-ring", "Seal"], ["oring", "Seal"], ["seal kit", "Seal"], ["seal", "Seal"], ["gasket", "Gasket"],
  ["hose assembly", "Hose"], ["hose", "Hose"], ["fitting", "Fitting"], ["coupling", "Coupling"],
  ["electric motor", "Motor"], ["motor", "Motor"], ["sensor", "Sensor"], ["transducer", "Sensor"], ["actuator", "Actuator"],
  ["bolt", "Fastener"], ["nut", "Fastener"], ["screw", "Fastener"], ["washer", "Fastener"], ["rivet", "Fastener"], ["fastener", "Fastener"],
  ["cable", "Cable"], ["wire", "Cable"], ["connector", "Connector"], ["battery", "Battery"], ["tyre", "Tyre"], ["tire", "Tyre"],
  ["compressor", "Compressor"], ["generator", "Generator"], ["alternator", "Alternator"], ["starter", "Starter"], ["gearbox", "Gearbox"],
  ["gear", "Gear"], ["belt", "Belt"], ["chain", "Chain"], ["lamp", "Lighting"], ["light", "Lighting"], ["switch", "Switch"], ["relay", "Relay"],
  ["circuit breaker", "Circuit Breaker"], ["breaker", "Circuit Breaker"], ["fuse", "Fuse"], ["transformer", "Transformer"],
  ["pipe", "Pipe"], ["tube", "Pipe"], ["spring", "Spring"], ["gauge", "Gauge"], ["injector", "Injector"], ["turbocharger", "Turbocharger"],
  ["radiator", "Radiator"], ["heat exchanger", "Heat Exchanger"], ["brake pad", "Brake"], ["brake", "Brake"], ["clutch", "Clutch"],
  ["lubricant", "Lubricant"], ["grease", "Lubricant"], ["oil", "Lubricant"], ["paint", "Coating"], ["coating", "Coating"],
  ["glove", "PPE"], ["helmet", "PPE"], ["coverall", "PPE"], ["boot", "PPE"], ["tool", "Tool"], ["wrench", "Tool"], ["drill", "Tool"],
  ["printer", "IT Equipment"], ["laptop", "IT Equipment"], ["monitor", "IT Equipment"], ["toner", "Office Supplies"], ["paper", "Office Supplies"],
  ["antenna", "Antenna"], ["radio", "Radio"], ["propeller", "Propeller"], ["impeller", "Impeller"], ["shaft", "Shaft"], ["piston", "Piston"],
  ["cylinder", "Cylinder"], ["nozzle", "Nozzle"], ["regulator", "Regulator"], ["thermostat", "Thermostat"], ["fan", "Fan"], ["blower", "Fan"],
].sort((a, b) => b[0].length - a[0].length) as [string, string][];

export function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + "y";
  if (/(ses|xes|ches|shes|zes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

export function detectCategory(text: string): string | undefined {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean)
    .map(singularize);
  const joined = ` ${words.join(" ")} `;
  for (const [kw, cat] of CATEGORY_KEYWORDS) {
    if (joined.includes(` ${kw} `)) return cat;
  }
  return undefined;
}

/* ---------------------------------------------------------- part numbers */

/** Upper-case and remove separators so "hp-4521", "HP 4521" and "HP4521" compare equal. */
export function normalizePartNumber(pn: string): string {
  return pn.toUpperCase().replace(/[\s\-./_]/g, "");
}

const NSN_RE = /\b(\d{4})-?(\d{2})-?(\d{3})-?(\d{4})\b/g;
const EXPLICIT_PN_RE =
  /\b(?:part\s*(?:no\.?|number|num|#)?|p\s*\/\s*n|pn|model\s*(?:no\.?|number)?|mpn|ref(?:erence)?\s*(?:no\.?)?)\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9\-./]{1,40}[A-Za-z0-9])/gi;

const NOT_A_PN = [
  /^\d+(pcs?|units?|ea|sets?|kgs?|m|l|nos?|prs?|pairs?|kits?|days?|weeks?|months?|hrs?|h|x)$/i,
  /^x\d+$/i,
  /^\d+(st|nd|rd|th)$/i,
  /^rfq-?\d+$/i,
  /^\d{4}-\d{2}-\d{2}$/,
  /^(covid-19|24\/7|b2b|iso9001|as9100)$/i,
];

function looksLikePartNumber(token: string): boolean {
  if (token.length < 4 || token.length > 40) return false;
  if (NOT_A_PN.some((re) => re.test(token))) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-./]*[A-Za-z0-9]$/.test(token)) return false;
  const hasDigit = /\d/.test(token);
  const hasLetter = /[A-Za-z]/.test(token);
  if (hasDigit && hasLetter) return true;
  // Pure numeric with separators, e.g. "12345-678" (but not a plain quantity).
  return hasDigit && /[-./]/.test(token) && token.replace(/\D/g, "").length >= 5;
}

/* ------------------------------------------------------------ conditions */

const CONDITION_PATTERNS: [RegExp, Condition][] = [
  [/\bnew\s+(?:or|\/)\s+(?:an?\s+)?(?:approved\s+)?(?:alternatives?|equivalents?)\b|\b(?:approved\s+)?alternatives?\s+(?:is\s+|are\s+)?(?:ok|okay|fine|acceptable)\b/i, "NEW_OR_APPROVED_ALTERNATIVE"],
  [/\bany\s+condition\b|\bcondition\s+(?:doesn'?t|does not)\s+matter\b|\bany\s+is\s+fine\b/i, "ANY"],
  [/\bnew\s+surplus\b/i, "NEW_SURPLUS"],
  [/\b(?:overhauled|overhaul)\b/i, "OVERHAULED"],
  [/\b(?:serviceable|used|second[- ]hand|refurbished)\b/i, "SERVICEABLE"],
  [/\brepaired\b/i, "REPAIRED"],
  [/\bas[- ]removed\b/i, "AS_REMOVED"],
  [/\b(?:brand[- ]new|factory[- ]new|new\s+only|only\s+new|new)\b/i, "NEW"],
];

const CONDITION_REPLIES_WHEN_ASKED: [RegExp, Condition][] = [
  [/^\s*(any|either|whatever|doesn'?t matter|does not matter|no preference|all)\b/i, "ANY"],
  [/^\s*(ns)\s*$/i, "NEW_SURPLUS"],
  [/^\s*(oh)\s*$/i, "OVERHAULED"],
  [/^\s*(sv)\s*$/i, "SERVICEABLE"],
  [/^\s*(alternative|alternatives|equivalent)\b/i, "NEW_OR_APPROVED_ALTERNATIVE"],
];

/* ----------------------------------------------------------- destination */

/** Finds a city and/or country in a short place string. */
export function resolvePlace(text: string): Destination | null {
  const lower = ` ${text.toLowerCase().replace(/[^a-z\s.'-]/g, " ").replace(/\s+/g, " ")} `;
  let city: string | undefined;
  let country: string | undefined;
  for (const [name, code] of CITY_LOOKUP) {
    if (lower.includes(` ${name} `)) {
      // "texas"/"california"/"florida" are states but are useful as places.
      city = titleCase(name);
      country = code;
      break;
    }
  }
  for (const [name, code] of COUNTRY_LOOKUP) {
    if (lower.includes(` ${name} `)) {
      // If a city was found in a different country, the explicit country wins and the city is dropped.
      if (country && country !== code) city = undefined;
      country = code;
      break;
    }
  }
  // City-states: "Singapore", "Hong Kong" are both.
  if (city && (city === "Singapore" || city === "Hong Kong") && !country) country = city === "Singapore" ? "SG" : "HK";
  if (!city && !country) return null;
  return { city, country, text: text.trim().replace(/[.!?]+$/, "") };
}

const DELIVERY_RE =
  /\b(?:deliver(?:ed|y)?|ship(?:ped|ping)?|send|sent|dispatch(?:ed)?|destination(?:\s+is)?|consignee\s+(?:is\s+)?(?:in|at))\s*(?:it\s+|them\s+|these\s+|this\s+)?(?:to|at|in|into|:)?\s+([A-Za-z][A-Za-z .,'-]{1,60}?)(?=$|[.;!?]|\s+(?:by|before|within|and|with|asap|urgent|no later)\b)/i;
const SOURCE_REGION_RE =
  /\b(?:in|from|within|across)\s+(europe|the middle east|middle east|the gulf|gulf|gcc|north america|south america|latin america|asia|the far east|far east|south asia|southeast asia|africa|oceania|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/;

/* ----------------------------------------------------------- required by */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseRequiredBy(text: string, now: Date): { date?: string; text: string; match: string } | null {
  let m = text.match(/\b(?:by|before|no later than|required by|needed by)\s+(\d{4}-\d{2}-\d{2})\b/i);
  if (m) return { date: m[1], text: m[1], match: m[0] };
  m = text.match(/\bwithin\s+(\d{1,3})\s*(days?|weeks?|months?)\b/i);
  if (m) {
    const n = Number(m[1]);
    const d = new Date(now);
    if (/^day/i.test(m[2])) d.setUTCDate(d.getUTCDate() + n);
    else if (/^week/i.test(m[2])) d.setUTCDate(d.getUTCDate() + 7 * n);
    else d.setUTCMonth(d.getUTCMonth() + n);
    return { date: isoDate(d), text: m[0], match: m[0] };
  }
  m = text.match(
    /\b(?:by|before|no later than)\s+(?:(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})|([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?)(?:,?\s+(\d{4}))?\b/i,
  );
  if (m) {
    const day = Number(m[1] ?? m[4]);
    const monthIdx = MONTHS.indexOf((m[2] ?? m[3]).slice(0, 3).toLowerCase());
    if (monthIdx >= 0 && day >= 1 && day <= 31) {
      let year = m[5] ? Number(m[5]) : now.getUTCFullYear();
      let d = new Date(Date.UTC(year, monthIdx, day));
      if (!m[5] && d < now) {
        year += 1;
        d = new Date(Date.UTC(year, monthIdx, day));
      }
      return { date: isoDate(d), text: m[0].replace(/^(by|before|no later than)\s+/i, ""), match: m[0] };
    }
  }
  m = text.match(/\b(asap|as soon as possible|urgent(?:ly)?|immediately|aog)\b/i);
  if (m) return { text: "As soon as possible", match: "" };
  return null;
}

/* --------------------------------------------------------- certification */

const CERT_RE =
  /\b(c\.?o\.?c\.?|certificate of (?:conformity|conformance)|faa\s*8130(?:-3)?|8130-3|easa\s*form\s*1|form\s*1|mill\s*cert(?:ificate)?s?|material\s*cert(?:ificate)?s?|test\s*reports?|oem\s*cert(?:ificate)?s?|full\s*traceability|traceability)\b/gi;

/* --------------------------------------------------------------- intents */

const INTENT_PATTERNS: [Intent, RegExp][] = [
  ["RESET", /^\s*(start over|start again|new request|reset|clear|new search)\b/i],
  ["GREETING", /^\s*(hi|hello|hey|salam|assalam[ -]?o?[ -]?alaikum|good (morning|afternoon|evening))\b[\s!.]*$/i],
  ["DONT_KNOW", /\b(i\s*(?:do\s*n[o']?t|dont|don't)\s*know|not sure|no idea|unknown|(?:do\s*n[o']?t|don't|dont)\s+have\s+(?:a\s+|the\s+|any\s+)?(?:part|p\/?n|oem|number))/i],
  ["GET_QUOTES", /\b(?:get|request|send|create|raise|issue|need)\s+(?:an?\s+|the\s+|me\s+|for\s+)?(?:quote|quotes|quotation|quotations|rfq)\b|^\s*(?:get\s+quotes?|rfq|quote)\s*[.!]?\s*$/i],
  ["WHO_MAKES", /\bwho\s+(?:makes|made|manufactures|produces|is\s+the\s+(?:oem|manufacturer))\b|\b(?:manufacturer|oem)\s+(?:of|for)\b/i],
  ["FIND_SUPPLIERS", /\bwho\s+(?:supplies|sells|stocks|distributes)\b|\b(?:find|show|list|any)\s+(?:me\s+)?(?:suppliers?|sources?|stockists?|distributors?)\b|\bwhere\s+can\s+(?:i|we)\s+(?:buy|get|find|source)\b|\bfind\s+(?:this|it)\s+(?:item\s+)?in\b/i],
  ["AVAILABILITY", /\b(?:available|availability|in\s+stock)\b/i],
  ["PRICE", /\b(?:price|prices|pricing|cost|how\s+much|budget)\b/i],
  ["LEAD_TIME", /\b(?:lead\s*time|delivery\s+time|how\s+long)\b/i],
  ["ALTERNATIVE", /\b(?:alternatives?|substitutes?|equivalents?|replacements?|cross[- ]?ref(?:erences?)?|interchangeable|superseded)\b/i],
  ["WHAT_NEEDED", /\bwhat\s+(?:information|info|details|else)\s+do\s+you\s+need|\bwhat\s+do\s+you\s+need\s+from\s+me\b/i],
  ["DIFFERENCE", /\bdifference\s+between\b|\bcompare\s+[A-Za-z0-9-]+\s+(?:and|with|vs\.?)\b/i],
  ["UPLOAD", /\b(?:attached|attach|upload(?:ed)?)\b.*\b(?:excel|spreadsheet|csv|list|file|document|pdf)\b/i],
  ["YES", /^\s*(yes|yeah|yep|sure|ok|okay|go ahead|please do|correct|confirm)\b[\s!.]*$/i],
  ["NO", /^\s*(no|nope|not now|none)\b[\s!.]*$/i],
];

/* ------------------------------------------------------------------ main */

const LEAD_FILLER =
  /^(?:(?:hi|hello|hey|please|pls|kindly|also|and|so|ok|okay|well|then)[,\s]+)*(?:(?:i|we)\s+(?:also\s+)?(?:would\s+like|need|needs|require|want|am\s+looking\s+for|are\s+looking\s+for)|(?:i|we)'?d\s+like|(?:can|could)\s+you\s+(?:please\s+)?(?:find|get|source|quote)(?:\s+me|\s+us)?|looking\s+for|need|require|requirement\s+(?:of|for)|please\s+find|find(?:\s+me)?|search(?:\s+for)?|get\s+me|source|quote\s+(?:me|for)|supply)\s*:?\s*/i;

const STOPWORDS = new Set(
  "i we me us you need needs needed require required requirement want would like looking for find search get please pls kindly can could buy purchase procure source supply quote quotation quotes rfq a an the of some this that these those it them item items part parts no number num p/n pn oem manufacturer who makes made supplies supplier suppliers is are there any available availability with on qty quantity about around approx approximately roughly delivered delivery deliver also and just only my our to in from x hello hi hey sources source show me what which where how much price cost stock urgent asap condition new used please. also, is it do does have has fine ok okay acceptable thanks thank good great".split(
    /\s+/,
  ),
);

function cleanItemText(text: string): string {
  return text
    .replace(/[“”"()[\]{}]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()))
    .join(" ")
    .trim();
}

const QTY_PREFIX_RE =
  /^(?:(around|about|approx(?:imately)?\.?|roughly|circa|~|at\s+least|up\s+to|min(?:imum)?\.?)\s+)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:x\s+)?([A-Za-z]+\.?)?/i;

/** Parses a quantity at the start of a segment. */
function parseLeadingQuantity(segment: string): { qty: ParsedQuantity; rest: string } | null {
  const s = segment.trim();
  const m = s.match(QTY_PREFIX_RE);
  if (m && m.index === 0) {
    const value = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) return null;
    // Do not treat "30 days" or "2026" style tokens as quantities.
    if (m[3] && /^(days?|weeks?|months?|years?|hours?|hrs?)$/i.test(m[3])) return null;
    let consumed = m[0].length;
    let unit = "EA";
    if (m[3]) {
      const u = unitFor(m[3]);
      if (u) unit = u;
      else consumed -= m[3].length; // the word belongs to the item ("50 bearings")
    }
    let rest = s.slice(consumed).replace(/^\s*(?:of|x)\b\s*/i, "");
    // "2 dozen" → 24
    const dz = rest.match(/^dozens?\b\s*(?:of\s+)?/i);
    let finalValue = value;
    if (dz) {
      finalValue = value * 12;
      rest = rest.slice(dz[0].length);
      consumed += dz[0].length;
    }
    const text = s.slice(0, s.length - rest.length).trim().replace(/\s+of$/i, "");
    return { qty: { value: finalValue, unit, approximate: Boolean(m[1]), text }, rest: rest.trim() };
  }
  // Word numbers: "two dozen", "twenty five", "a hundred"
  const approxMatch = s.match(/^(around|about|approx(?:imately)?\.?|roughly|circa)\s+/i);
  const body = approxMatch ? s.slice(approxMatch[0].length) : s;
  const tokens = body.toLowerCase().split(/\s+/);
  const wn = parseWordNumber(tokens.map((t) => t.replace(/[^a-z-]/g, "")));
  if (wn) {
    let consumedTokens = wn.consumed;
    let unit = "EA";
    const next = tokens[consumedTokens];
    if (next && unitFor(next)) {
      unit = unitFor(next)!;
      consumedTokens++;
    }
    if (tokens[consumedTokens] === "of") consumedTokens++;
    const bodyWords = body.split(/\s+/);
    const rest = bodyWords.slice(consumedTokens).join(" ");
    const text = (approxMatch ? approxMatch[0] : "") + bodyWords.slice(0, consumedTokens).join(" ");
    return { qty: { value: wn.value, unit, approximate: Boolean(approxMatch), text: text.replace(/\s+of$/i, "").trim() }, rest };
  }
  return null;
}

/** Quantity mentioned after the item: "ABC123 x 25", "ABC123 qty: 25", "ABC123 - 25 pcs". */
function parseTrailingQuantity(segment: string): { qty: ParsedQuantity; rest: string } | null {
  const patterns = [
    /\b(?:qty|quantity)\s*[:=]?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*([A-Za-z]+)?/i,
    /(?:^|\s)x\s*(\d+)\b()/i,
    /\b(\d{1,3}(?:,\d{3})+|\d+)\s*(units?|pcs?|pieces?|nos?|ea|sets?|pairs?|kits?|boxes|box)\b/i,
  ];
  for (const re of patterns) {
    const m = segment.match(re);
    if (m && m.index !== undefined) {
      const value = Number(m[1].replace(/,/g, ""));
      if (!value) continue;
      const unit = (m[2] && unitFor(m[2])) || "EA";
      const rest = (segment.slice(0, m.index) + " " + segment.slice(m.index + m[0].length)).trim();
      return { qty: { value, unit, approximate: false, text: m[0].trim() }, rest };
    }
  }
  return null;
}

export interface ParseOptions {
  awaiting?: Awaiting;
  now?: Date;
}

export function parseMessage(raw: string, opts: ParseOptions = {}): ParsedMessage {
  const now = opts.now ?? new Date();
  const awaiting = opts.awaiting;
  let work = raw.replace(/\s+/g, " ").trim();
  const result: ParsedMessage = { raw, items: [], intents: [], purchaseIntent: false };

  /* intents on the original text */
  for (const [intent, re] of INTENT_PATTERNS) if (re.test(work)) result.intents.push(intent);
  if (result.intents.includes("DONT_KNOW")) {
    // "I don't know" is not a "No".
    result.intents = result.intents.filter((i) => i !== "NO");
  }

  /* certification */
  const certs = new Set<string>();
  work = work.replace(CERT_RE, (m) => {
    certs.add(m.replace(/\s+/g, " ").trim());
    return " ";
  });
  if (certs.size) result.certification = [...certs].join(", ");

  /* required-by date */
  const rb = parseRequiredBy(work, now);
  if (rb) {
    result.requiredBy = rb.date;
    result.requiredByText = rb.text;
    if (rb.match) work = work.replace(rb.match, " ");
    work = work.replace(/\b(asap|as soon as possible|urgent(?:ly)?|immediately)\b/gi, " ");
  }

  /* destination: explicit delivery phrase */
  const dm = work.match(DELIVERY_RE);
  if (dm) {
    const place = resolvePlace(dm[1]);
    result.destination = place ?? { text: dm[1].trim() };
    work = work.replace(dm[0], " ");
  }

  /* source region: "in Europe", "from Germany", "suppliers in the UAE" */
  if (!result.destination || awaiting !== "DESTINATION") {
    const sm = work.match(SOURCE_REGION_RE);
    if (sm) {
      const key = sm[1].toLowerCase().replace(/^the\s+/, "");
      if (REGIONS[key]) {
        result.sourceRegion = key;
        work = work.replace(sm[0], " ");
      } else {
        const p = resolvePlace(sm[1]);
        const isSourcing = /\b(suppliers?|sources?|stock|stockists?|find|available|availability|distributors?)\b/i.test(raw);
        if (p?.country && isSourcing && !dm) {
          result.sourceRegion = p.country;
          work = work.replace(sm[0], " ");
        }
      }
    }
  }

  /* bare place answer: "Islamabad, Pakistan." / "Pakistan" / "to Dubai" */
  if (!result.destination) {
    const stripped = work
      .replace(/^(?:(?:it'?s|it\s+is|to|deliver(?:ed)?\s+to|destination(?:\s+is)?|ship\s+to|in|at)\s+)+/i, "")
      .replace(/[.!?]+$/, "")
      .trim();
    const place = stripped.length <= 60 ? resolvePlace(stripped) : null;
    if (place) {
      // Accept only if nothing else meaningful is left once the place words are removed.
      const leftover = cleanItemText(
        stripped
          .toLowerCase()
          .replace((place.city ?? "").toLowerCase(), " ")
          .replace(/[,]/g, " ")
          .split(/\s+/)
          .filter((w) => !COUNTRY_LOOKUP.some(([n]) => n.split(" ").includes(w)))
          .join(" "),
      );
      if (!leftover || awaiting === "DESTINATION") {
        result.destination = place;
        work = "";
      }
    } else if (awaiting === "DESTINATION" && stripped && !/\d/.test(stripped) && stripped.split(" ").length <= 6 && result.intents.length === 0) {
      // Unknown place name — keep the user's words rather than guessing.
      result.destination = { text: stripped };
      work = "";
    }
  }

  /* condition */
  if (awaiting === "CONDITION") {
    for (const [re, c] of CONDITION_REPLIES_WHEN_ASKED) {
      if (re.test(work)) {
        result.condition = c;
        work = work.replace(re, " ");
        break;
      }
    }
  }
  if (!result.condition) {
    for (const [re, c] of CONDITION_PATTERNS) {
      const m = work.match(re);
      if (m) {
        result.condition = c;
        work = work.replace(m[0], " ");
        break;
      }
    }
  }
  if (result.condition === "NEW_OR_APPROVED_ALTERNATIVE") {
    result.intents = result.intents.filter((i) => i !== "ALTERNATIVE");
  }

  /* NSNs */
  const placeholders: { token: string; kind: "PN" | "NSN"; value: string }[] = [];
  work = work.replace(NSN_RE, (m, a, b, c, d) => {
    const token = `⟦${placeholders.length}⟧`;
    placeholders.push({ token, kind: "NSN", value: `${a}-${b}-${c}-${d}` });
    return ` ${token} `;
  });

  /* explicit part numbers: "Part No. ABC-12345", "P/N 4521" */
  work = work.replace(EXPLICIT_PN_RE, (m, pn: string) => {
    if (!/\d/.test(pn) || (/^\d+$/.test(pn) && pn.length < 3)) return m;
    if (NOT_A_PN.some((re) => re.test(pn))) return m;
    const token = `⟦${placeholders.length}⟧`;
    placeholders.push({ token, kind: "PN", value: pn.replace(/[.]$/, "") });
    return ` ${token} `;
  });

  /* implicit part-number-like tokens */
  work = work
    .split(" ")
    .map((tok) => {
      const core = tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
      if (core && !core.startsWith("⟦") && looksLikePartNumber(core)) {
        const token = `⟦${placeholders.length}⟧`;
        placeholders.push({ token, kind: "PN", value: core });
        return tok.replace(core, ` ${token} `);
      }
      return tok;
    })
    .join(" ");

  /* segments → items */
  const body = work
    .replace(/(\d),(\d{3})\b/g, "$1$2")
    .replace(LEAD_FILLER, "").replace(/\s+/g, " ").trim();
  const segments = body
    .split(/\s*(?:[,;\n]|\band\b|\bplus\b|&|\+)\s*/i)
    .map((s) => s.replace(LEAD_FILLER, "").trim())
    .filter(Boolean);

  for (const seg of segments) {
    let rest = seg;
    let qty: ParsedQuantity | undefined;
    const lead = parseLeadingQuantity(rest);
    if (lead) {
      qty = lead.qty;
      rest = lead.rest;
    } else {
      const trail = parseTrailingQuantity(rest);
      if (trail) {
        qty = trail.qty;
        rest = trail.rest;
      }
    }
    let partNumber: string | undefined;
    let nsn: string | undefined;
    rest = rest.replace(/⟦(\d+)⟧/g, (_m, idx: string) => {
      const ph = placeholders[Number(idx)];
      if (ph.kind === "NSN") nsn ??= ph.value;
      else partNumber ??= ph.value;
      return " ";
    });
    if (!qty && (partNumber || nsn)) {
      const trail = parseTrailingQuantity(rest);
      if (trail) {
        qty = trail.qty;
        rest = trail.rest;
      }
    }
    const text = cleanItemText(rest);
    const meaningfulText = text.length >= 2 && /[a-z]{2,}/i.test(text) ? text : undefined;
    if (!partNumber && !nsn && !meaningfulText) {
      if (qty && !result.quantity) result.quantity = qty;
      continue;
    }
    const item: ParsedItem = { quantity: qty, partNumber, nsn, text: meaningfulText };
    if (meaningfulText) item.category = detectCategory(meaningfulText);
    result.items.push(item);
  }

  // Placeholders not consumed by any segment (should be rare) still count as items.
  for (const ph of placeholders) {
    const used = result.items.some((i) => i.partNumber === ph.value || i.nsn === ph.value);
    if (!used) result.items.push(ph.kind === "NSN" ? { nsn: ph.value } : { partNumber: ph.value });
  }

  // Questions about the current item ("who makes this?") are not new items.
  const questionOnly = result.intents.some((i) =>
    ["WHO_MAKES", "AVAILABILITY", "PRICE", "ALTERNATIVE", "FIND_SUPPLIERS", "WHAT_NEEDED", "LEAD_TIME", "DONT_KNOW", "GET_QUOTES", "GREETING", "RESET", "UPLOAD", "YES", "NO"].includes(i),
  );
  if (questionOnly) {
    result.items = result.items.filter((i) => i.partNumber || i.nsn || (i.quantity && i.category));
  }

  // When we asked for a description, keep whatever the user typed as the description.
  if (awaiting === "DESCRIPTION" && result.items.length === 0 && !result.intents.includes("DONT_KNOW")) {
    const text = cleanItemText(work.replace(/⟦\d+⟧/g, " "));
    if (text) result.items.push({ text, category: detectCategory(text) });
  }

  result.purchaseIntent =
    /\b(need|needs|require|required|want|buy|purchase|procure|order|quote|quotation|rfq)\b/i.test(raw) ||
    Boolean(result.quantity) ||
    result.items.some((i) => i.quantity);

  return result;
}
