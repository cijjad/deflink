import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ enums */

export const orgKind = pgEnum("org_kind", ["BUYER", "SUPPLIER", "PLATFORM"]);
export const orgRole = pgEnum("org_role", [
  "ORG_ADMIN",
  "PROCUREMENT_OFFICER",
  "PROCUREMENT_MANAGER",
  "FINANCE",
  "COMPLIANCE_OFFICER",
  "LOGISTICS",
  "APPROVER",
  "VIEWER",
]);
/** Provenance of any fact that may be uncertain (price, availability, lead time, certification...). */
export const dataStatus = pgEnum("data_status", [
  "VERIFIED",
  "SUPPLIER_PROVIDED",
  "ESTIMATED",
  "HISTORICAL",
  "PENDING_VERIFICATION",
]);
export const verificationLevel = pgEnum("verification_level", [
  "BUSINESS_VERIFIED",
  "SUPPLIER_VERIFIED",
  "AUTHORIZED_DISTRIBUTOR",
  "COMPLIANCE_VERIFIED",
]);
export const verificationState = pgEnum("verification_state", ["PENDING", "APPROVED", "REJECTED", "REVOKED"]);
export const supplierType = pgEnum("supplier_type", [
  "OEM",
  "MANUFACTURER",
  "AUTHORIZED_DISTRIBUTOR",
  "STOCKIST",
  "DEALER",
  "MRO",
  "INDUSTRIAL_SUPPLIER",
  "LOGISTICS_PROVIDER",
  "SOURCING_COMPANY",
]);
export const itemCondition = pgEnum("item_condition", [
  "NEW",
  "NEW_OR_APPROVED_ALTERNATIVE",
  "ANY",
  "NEW_SURPLUS",
  "OVERHAULED",
  "SERVICEABLE",
  "REPAIRED",
  "AS_REMOVED",
]);
export const exportControlStatus = pgEnum("export_control_status", ["NOT_CONTROLLED", "UNKNOWN", "CONTROLLED"]);
export const crossRefType = pgEnum("cross_ref_type", ["SUPERSEDED_BY", "DOCUMENTED_CROSS_REFERENCE", "ALTERNATIVE"]);
export const priceType = pgEnum("price_type", ["EXACT", "RANGE", "ON_REQUEST"]);
export const rfqStatus = pgEnum("rfq_status", [
  "DRAFT",
  "COMPLIANCE_REVIEW",
  "OPEN",
  "QUOTED",
  "CLOSED",
  "CANCELLED",
  "REJECTED",
]);
export const recipientStatus = pgEnum("recipient_status", ["SENT", "VIEWED", "QUOTED", "DECLINED"]);
export const quotationStatus = pgEnum("quotation_status", ["SUBMITTED", "SUPERSEDED", "WITHDRAWN"]);
export const identificationStatus = pgEnum("identification_status", [
  "EXACT",
  "ITEM_TYPE",
  "NEEDS_CONFIRMATION",
  "NOT_IDENTIFIED",
]);
export const complianceDecision = pgEnum("compliance_decision", ["PENDING", "APPROVED", "REJECTED"]);
export const countryRuleAction = pgEnum("country_rule_action", ["REVIEW", "BLOCK"]);

/* --------------------------------------------------------------- identity */

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: orgKind("kind").notNull(),
  country: text("country").notNull(), // ISO 3166-1 alpha-2
  city: text("city"),
  isSuspended: boolean("is_suspended").notNull().default(false),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    mobile: text("mobile"),
    country: text("country"),
    passwordHash: text("password_hash").notNull(),
    role: orgRole("role").notNull().default("PROCUREMENT_OFFICER"),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    mfaSecret: text("mfa_secret"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`), index("users_org_idx").on(t.organizationId)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token. The raw token only lives in the user's cookie. */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mfaPassed: boolean("mfa_passed").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* -------------------------------------------------------------- catalogue */

export const manufacturers = pgTable(
  "manufacturers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    country: text("country"),
    cageCode: text("cage_code"),
    website: text("website"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("manufacturers_name_uq").on(sql`lower(${t.name})`)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partNumber: text("part_number").notNull(),
    /** Upper-case, with spaces/hyphens/dots/slashes removed — used for exact & fuzzy matching. */
    pnNormalized: text("pn_normalized").notNull(),
    manufacturerId: uuid("manufacturer_id").references(() => manufacturers.id),
    description: text("description").notNull(),
    category: text("category").notNull(),
    nsn: text("nsn"),
    modelNumber: text("model_number"),
    specs: jsonb("specs").$type<Record<string, string>>().notNull().default({}),
    unitOfMeasure: text("unit_of_measure").notNull().default("EA"),
    isActive: boolean("is_active").notNull().default(true),
    exportControlStatus: exportControlStatus("export_control_status").notNull().default("UNKNOWN"),
    /** Classification entered by a qualified person (e.g. ECCN). Never inferred automatically. */
    controlClassification: text("control_classification"),
    dataStatus: dataStatus("data_status").notNull().default("PENDING_VERIFICATION"),
    isDemo: boolean("is_demo").notNull().default(false),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(part_number,'') || ' ' || coalesce(description,'') || ' ' || coalesce(category,'') || ' ' || coalesce(model_number,'') || ' ' || coalesce(nsn,''))`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_pn_mfr_uq").on(t.pnNormalized, t.manufacturerId),
    index("products_pn_trgm_idx").using("gin", sql`${t.pnNormalized} gin_trgm_ops`),
    index("products_search_idx").using("gin", t.searchVector),
    index("products_nsn_idx").on(t.nsn),
    index("products_category_idx").on(sql`lower(${t.category})`),
  ],
);

export const productCrossReferences = pgTable(
  "product_cross_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    relatedProductId: uuid("related_product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    type: crossRefType("type").notNull(),
    /** Where the relationship is documented (OEM bulletin, IPC reference...). Required: no evidence, no cross-reference. */
    evidence: text("evidence").notNull(),
    dataStatus: dataStatus("data_status").notNull().default("PENDING_VERIFICATION"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("xref_product_idx").on(t.productId)],
);

/* ----------------------------------------------------------------- supply */

export const supplierProfiles = pgTable("supplier_profiles", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  supplierType: supplierType("supplier_type").notNull(),
  region: text("region"),
  categories: text("categories").array().notNull().default(sql`'{}'::text[]`),
  marketsServed: text("markets_served").array().notNull().default(sql`'{}'::text[]`),
  about: text("about"),
  /** Derived from real response history; null until enough RFQs exist. */
  responseRate: numeric("response_rate", { precision: 5, scale: 2 }),
  avgResponseHours: numeric("avg_response_hours", { precision: 8, scale: 2 }),
  createdAt: createdAt(),
});

export const supplierVerifications = pgTable(
  "supplier_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    level: verificationLevel("level").notNull(),
    state: verificationState("state").notNull().default("PENDING"),
    evidenceNote: text("evidence_note"),
    evidenceDocumentId: uuid("evidence_document_id"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("supver_org_idx").on(t.organizationId)],
);

export const supplierOemRelationships = pgTable(
  "supplier_oem_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    manufacturerId: uuid("manufacturer_id")
      .notNull()
      .references(() => manufacturers.id, { onDelete: "cascade" }),
    relationship: supplierType("relationship").notNull(),
    dataStatus: dataStatus("data_status").notNull().default("PENDING_VERIFICATION"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sor_uq").on(t.supplierOrgId, t.manufacturerId)],
);

export const inventoryListings = pgTable(
  "inventory_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    condition: itemCondition("condition").notNull(),
    quantityAvailable: integer("quantity_available"),
    city: text("city"),
    country: text("country").notNull(),
    priceType: priceType("price_type").notNull().default("ON_REQUEST"),
    priceMin: numeric("price_min", { precision: 14, scale: 2 }),
    priceMax: numeric("price_max", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    priceStatus: dataStatus("price_status").notNull().default("PENDING_VERIFICATION"),
    availabilityStatus: dataStatus("availability_status").notNull().default("SUPPLIER_PROVIDED"),
    leadTimeDays: integer("lead_time_days"),
    certification: text("certification"),
    certificationStatus: dataStatus("certification_status").notNull().default("PENDING_VERIFICATION"),
    isDemo: boolean("is_demo").notNull().default(false),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("inv_product_idx").on(t.productId), index("inv_supplier_idx").on(t.supplierOrgId)],
);

/* ----------------------------------------------------------- conversation */

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** SHA-256 of an anonymous visitor token, so visitors can converse before registering. */
    anonTokenHash: text("anon_token_hash"),
    state: jsonb("state").notNull(),
    rfqId: uuid("rfq_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conv_user_idx").on(t.userId), index("conv_anon_idx").on(t.anonTokenHash)],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    content: jsonb("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("convmsg_conv_idx").on(t.conversationId, t.createdAt)],
);

/* ------------------------------------------------------------ procurement */

export const rfqs = pgTable(
  "rfqs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    refNo: integer("ref_no").generatedAlwaysAsIdentity({ startWith: 10001 }).notNull(),
    buyerOrgId: uuid("buyer_org_id")
      .notNull()
      .references(() => organizations.id),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    status: rfqStatus("status").notNull().default("DRAFT"),
    destinationCity: text("destination_city"),
    destinationCountry: text("destination_country"),
    destinationText: text("destination_text"),
    requiredBy: date("required_by"),
    notes: text("notes"),
    complianceReason: text("compliance_reason"),
    sourceConversationId: uuid("source_conversation_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("rfqs_ref_uq").on(t.refNo), index("rfqs_buyer_idx").on(t.buyerOrgId, t.createdAt)],
);

export const rfqLines = pgTable(
  "rfq_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").references(() => products.id),
    partNumber: text("part_number"),
    manufacturerName: text("manufacturer_name"),
    description: text("description").notNull(),
    category: text("category"),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unit: text("unit").notNull().default("EA"),
    /** The user's own words, kept for traceability ("two dozen", "around 50"). */
    quantityText: text("quantity_text"),
    quantityApproximate: boolean("quantity_approximate").notNull().default(false),
    condition: itemCondition("condition").notNull().default("NEW"),
    certificationRequired: text("certification_required"),
    identification: identificationStatus("identification").notNull(),
  },
  (t) => [uniqueIndex("rfq_lines_uq").on(t.rfqId, t.lineNo)],
);

export const rfqRecipients = pgTable(
  "rfq_recipients",
  {
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id),
    status: recipientStatus("status").notNull().default("SENT"),
    matchReason: text("match_reason").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.rfqId, t.supplierOrgId] }), index("rfqrec_supplier_idx").on(t.supplierOrgId)],
);

export const quotations = pgTable(
  "quotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id),
    submittedByUserId: uuid("submitted_by_user_id")
      .notNull()
      .references(() => users.id),
    revision: integer("revision").notNull().default(1),
    status: quotationStatus("status").notNull().default("SUBMITTED"),
    currency: text("currency").notNull(),
    incoterm: text("incoterm"),
    freight: numeric("freight", { precision: 14, scale: 2 }),
    insurance: numeric("insurance", { precision: 14, scale: 2 }),
    paymentTerms: text("payment_terms"),
    validUntil: date("valid_until"),
    remarks: text("remarks"),
    revisionNote: text("revision_note"),
    isShortlisted: boolean("is_shortlisted").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("quotations_rev_uq").on(t.rfqId, t.supplierOrgId, t.revision),
    index("quotations_rfq_idx").on(t.rfqId),
  ],
);

export const quotationLines = pgTable("quotation_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  quotationId: uuid("quotation_id")
    .notNull()
    .references(() => quotations.id, { onDelete: "cascade" }),
  rfqLineId: uuid("rfq_line_id")
    .notNull()
    .references(() => rfqLines.id, { onDelete: "cascade" }),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  availability: text("availability").notNull(), // IN_STOCK | FACTORY_ORDER | PARTIAL
  leadTimeDays: integer("lead_time_days").notNull(),
  condition: itemCondition("condition").notNull(),
  certification: text("certification"),
  countryOfOrigin: text("country_of_origin"),
  warranty: text("warranty"),
  shipFromCountry: text("ship_from_country"),
  shipFromCity: text("ship_from_city"),
});

export const messageThreads = pgTable(
  "message_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("thread_uq").on(t.rfqId, t.supplierOrgId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => messageThreads.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id),
    senderOrgId: uuid("sender_org_id")
      .notNull()
      .references(() => organizations.id),
    body: text("body").notNull(),
    quotationId: uuid("quotation_id").references(() => quotations.id),
    createdAt: createdAt(),
  },
  (t) => [index("messages_thread_idx").on(t.threadId, t.createdAt)],
);

/* ------------------------------------------------------------------ files */

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerOrgId: uuid("owner_org_id").references(() => organizations.id),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id),
    conversationId: uuid("conversation_id"),
    rfqId: uuid("rfq_id"),
    quotationId: uuid("quotation_id"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("documents_org_idx").on(t.ownerOrgId), index("documents_rfq_idx").on(t.rfqId)],
);

/* ---------------------------------------------------------------- control */

export const complianceReviews = pgTable(
  "compliance_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    reasons: text("reasons").array().notNull(),
    decision: complianceDecision("decision").notNull().default("PENDING"),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id),
    notes: text("notes"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("compliance_rfq_idx").on(t.rfqId)],
);

/** Operator-maintained from official sources. Nothing is seeded as "real" sanctions data. */
export const complianceCountryRules = pgTable("compliance_country_rules", {
  country: text("country").primaryKey(), // ISO alpha-2
  action: countryRuleAction("action").notNull(),
  reason: text("reason").notNull(),
  source: text("source").notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
  updatedAt: updatedAt(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const emailOutbox = pgTable("email_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("QUEUED"), // QUEUED | SENT | FAILED
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

/** Append-only. Each row's hash covers its content and the previous row's hash (tamper-evident chain). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    seq: integer("seq").generatedAlwaysAsIdentity().primaryKey(),
    actorUserId: uuid("actor_user_id"),
    organizationId: uuid("organization_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").notNull().default({}),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_org_idx").on(t.organizationId)],
);

/* ------------------------------------------------------------- commercial */

/** Flexible: any combination of subscription and fee components. No model is hard-coded. */
export const commercialPlans = pgTable("commercial_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  audience: orgKind("audience").notNull(),
  components: jsonb("components").notNull().default([]), // [{type:'SUBSCRIPTION'|'TRANSACTION_FEE'|'SERVICE_FEE', ...}]
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const organizationSubscriptions = pgTable("organization_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  planId: uuid("plan_id")
    .notNull()
    .references(() => commercialPlans.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: createdAt(),
});
