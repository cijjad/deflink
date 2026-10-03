export type Condition =
  | "NEW"
  | "NEW_OR_APPROVED_ALTERNATIVE"
  | "ANY"
  | "NEW_SURPLUS"
  | "OVERHAULED"
  | "SERVICEABLE"
  | "REPAIRED"
  | "AS_REMOVED";

export const CONDITION_LABEL: Record<Condition, string> = {
  NEW: "New",
  NEW_OR_APPROVED_ALTERNATIVE: "New or approved alternative",
  ANY: "Any condition",
  NEW_SURPLUS: "New surplus",
  OVERHAULED: "Overhauled",
  SERVICEABLE: "Used / serviceable",
  REPAIRED: "Repaired",
  AS_REMOVED: "As removed",
};

export type Identification = "PENDING" | "EXACT" | "ITEM_TYPE" | "NEEDS_CONFIRMATION" | "NOT_IDENTIFIED";

export interface ParsedQuantity {
  value: number;
  /** Normalised unit code: EA, SET, PR, KT, BX, PK, M, KG, L, RL, DR, LOT */
  unit: string;
  approximate: boolean;
  /** The user's original words, e.g. "two dozen". */
  text: string;
}

export interface Destination {
  city?: string;
  /** ISO 3166-1 alpha-2 */
  country?: string;
  /** What the user typed, kept when we cannot resolve a place. */
  text: string;
}

export interface Candidate {
  productId: string;
  partNumber: string;
  manufacturer: string | null;
  description: string;
  match: "EXACT" | "POSSIBLE" | "CROSS_REFERENCE" | "ALTERNATIVE";
}

export interface RequirementLine {
  key: string;
  /** The words the user used for this item. */
  query: string;
  partNumber?: string;
  nsn?: string;
  productId?: string;
  manufacturer?: string;
  description?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  quantityText?: string;
  approximate?: boolean;
  identification: Identification;
  candidates?: Candidate[];
  isDemo?: boolean;
  exportControlled?: boolean;
}

export type Awaiting =
  | "ITEM"
  | "QUANTITY"
  | "CONDITION"
  | "DESTINATION"
  | "IDENTIFIER"
  | "DESCRIPTION"
  | "CONFIRM_CANDIDATE";

export interface ConversationState {
  version: 1;
  lines: RequirementLine[];
  activeLineKey?: string;
  condition?: Condition;
  destination?: Destination;
  requiredBy?: string;
  requiredByText?: string;
  certification?: string;
  notes?: string;
  /** Source region the user wants to look in, e.g. "europe". Not the destination. */
  sourceRegion?: string;
  awaiting?: Awaiting;
  /** The user explicitly wants to buy (said "need", gave a quantity, pressed GET QUOTE). */
  purchaseIntent: boolean;
  askedIdentifier?: boolean;
  /** A quantity given before the item ("I need 50" with nothing identified yet). */
  pendingQuantity?: ParsedQuantity;
  rfqId?: string;
  rfqRef?: string;
}

export const emptyState = (): ConversationState => ({ version: 1, lines: [], purchaseIntent: false });

export type Intent =
  | "GREETING"
  | "DONT_KNOW"
  | "GET_QUOTES"
  | "WHO_MAKES"
  | "AVAILABILITY"
  | "PRICE"
  | "ALTERNATIVE"
  | "FIND_SUPPLIERS"
  | "WHAT_NEEDED"
  | "DIFFERENCE"
  | "RESET"
  | "UPLOAD"
  | "YES"
  | "NO"
  | "LEAD_TIME";

export interface ParsedItem {
  quantity?: ParsedQuantity;
  partNumber?: string;
  nsn?: string;
  /** Free-text description that remains after removing quantity and filler words. */
  text?: string;
  category?: string;
}

export interface ParsedMessage {
  raw: string;
  items: ParsedItem[];
  /** A bare quantity with no item ("I need 50"). */
  quantity?: ParsedQuantity;
  condition?: Condition;
  destination?: Destination;
  requiredBy?: string;
  requiredByText?: string;
  certification?: string;
  sourceRegion?: string;
  intents: Intent[];
  purchaseIntent: boolean;
}

/* ---------------------------------------------------------------- replies */

export type DataLabel = "VERIFIED" | "SUPPLIER_PROVIDED" | "ESTIMATED" | "HISTORICAL" | "PENDING_VERIFICATION";

export interface ProductHit {
  productId: string;
  partNumber: string;
  manufacturer: string | null;
  description: string;
  category: string;
  nsn?: string | null;
  match: "EXACT" | "POSSIBLE" | "CROSS_REFERENCE" | "ALTERNATIVE";
  evidence?: string;
  sourceCount: number;
  availableCount: number;
  isDemo: boolean;
  exportControlled: boolean;
}

export interface SourceCard {
  listingId: string;
  supplierName: string;
  supplierType: string;
  supplierCountry: string;
  city?: string | null;
  country: string;
  partNumber: string;
  description: string;
  manufacturer: string | null;
  condition: Condition;
  quantityAvailable: number | null;
  availabilityStatus: DataLabel;
  priceType: "EXACT" | "RANGE" | "ON_REQUEST";
  priceMin: number | null;
  priceMax: number | null;
  currency: string;
  priceStatus: DataLabel;
  leadTimeDays: number | null;
  certification: string | null;
  certificationStatus: DataLabel;
  verifications: string[];
  reportedAt: string;
  isDemo: boolean;
}

export type ReplyBlock =
  | { type: "text"; text: string }
  | { type: "notice"; tone: "info" | "warning" | "danger"; text: string }
  | {
      type: "results";
      query: string;
      exact: ProductHit[];
      possible: ProductHit[];
      alternatives: ProductHit[];
    }
  | { type: "sources"; partNumber: string; sources: SourceCard[]; region?: string }
  | { type: "candidates"; lineKey: string; query: string; candidates: Candidate[] }
  | { type: "lines"; lines: RequirementLine[] }
  | { type: "requirement"; state: ConversationState; ready: boolean; missing: string[] }
  | { type: "facts"; title: string; rows: { label: string; value: string; status?: DataLabel }[] };

export type ActionType =
  | "GET_QUOTE"
  | "GET_QUOTES"
  | "VIEW_SOURCES"
  | "ASK_ANOTHER"
  | "SET_CONDITION"
  | "ENTER_QUANTITY"
  | "ADD_DESTINATION"
  | "PART_NUMBER"
  | "OEM"
  | "DONT_KNOW"
  | "CHOOSE_CANDIDATE"
  | "NONE_OF_THESE"
  | "EDIT"
  | "UPLOAD"
  | "NEW_SEARCH"
  | "VIEW_RFQ"
  | "REVIEW_ITEMS"
  | "SKIP";

export interface Action {
  type: ActionType;
  label: string;
  primary?: boolean;
  /** For SET_CONDITION: a Condition; for CHOOSE_CANDIDATE: `${lineKey}:${productId}`; VIEW_SOURCES: productId */
  value?: string;
  /** Text to place in the input (for "type your answer" actions). */
  hint?: string;
}

export interface AssistantReply {
  blocks: ReplyBlock[];
  actions: Action[];
}

export interface ClientAction {
  type: ActionType;
  value?: string;
}
